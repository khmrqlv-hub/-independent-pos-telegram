import assert from "node:assert/strict";
import {createHmac, randomUUID} from "node:crypto";
import {mkdir, readdir, readFile} from "node:fs/promises";
import {join, resolve} from "node:path";
import {spawnSync} from "node:child_process";
import test from "node:test";
import bcrypt from "bcryptjs";
import postgres from "postgres";

const primaryUrl = process.env.PRIMARY_DATABASE_URL;
const testUrl = process.env.TEST_DATABASE_URL;
const restoreUrl = process.env.RESTORE_TEST_DATABASE_URL;
if (!primaryUrl || !testUrl || !restoreUrl) {
  throw new Error("PRIMARY_DATABASE_URL, TEST_DATABASE_URL and RESTORE_TEST_DATABASE_URL are required");
}

type Identity = {database: string; databaseOid: string; server: string};
async function identity(url: string) {
  const client = postgres(url, {max: 1, prepare: false});
  try {
    const rows = await client<Identity[]>`SELECT current_database() database,
      (SELECT oid::text FROM pg_database WHERE datname=current_database()) "databaseOid",
      coalesce(inet_server_addr()::text,'local')||':'||inet_server_port() "server"`;
    return rows[0]!;
  } finally { await client.end(); }
}

const [primaryIdentity, testIdentity, restoreIdentity] = await Promise.all([
  identity(primaryUrl), identity(testUrl), identity(restoreUrl),
]);
assert.match(testIdentity.database, /_test$/);
assert.match(restoreIdentity.database, /_restore_test$/);
assert.notDeepEqual(testIdentity, primaryIdentity, "test DB identity must differ from primary");
assert.notDeepEqual(restoreIdentity, primaryIdentity, "restore DB identity must differ from primary");
assert.notDeepEqual(restoreIdentity, testIdentity, "restore DB identity must differ from test");

const testSql = postgres(testUrl, {max: 30, prepare: false});
await testSql.unsafe("DROP SCHEMA public CASCADE; CREATE SCHEMA public");
await testSql.unsafe("CREATE TABLE schema_migrations(version text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())");
const migrationDir = resolve(process.cwd(), "../../packages/database/migrations");
const migrationFiles = (await readdir(migrationDir)).filter((name) => /^\d{4}_.+\.sql$/.test(name)).sort();
assert.equal(migrationFiles.length, 6);
for (const file of migrationFiles) {
  const migration = await readFile(join(migrationDir, file), "utf8");
  await testSql.begin(async (tx) => {
    await tx.unsafe(migration).simple();
    await tx`INSERT INTO schema_migrations(version) VALUES (${file.slice(0, 4)})`;
  });
}

process.env.NODE_ENV = "test";
process.env.DATABASE_URL = testUrl;
process.env.APP_ORIGIN = "https://miniapp.test";
process.env.SESSION_COOKIE_NAME = "pos_test_session";
process.env.TELEGRAM_BOT_TOKEN = ["1234567890", "test-only-token-material"].join(":");
process.env.TELEGRAM_INIT_DATA_MAX_AGE_SECONDS = "300";
process.env.LOG_LEVEL = "silent";

const {buildApp} = await import("../src/app.js");
const {sql: apiSql} = await import("../src/db.js");

const adminId = randomUUID();
const cashierId = randomUUID();
const categoryId = randomUUID();
const snapshotProductId = randomUUID();
const idemProductId = randomUUID();
const concurrentProductId = randomUUID();
const rollbackProductId = randomUUID();
const emptyProductId = randomUUID();
const password = "test-password-12345";
const passwordHash = await bcrypt.hash(password, 4);

await testSql`INSERT INTO users(id,login,display_name,role) VALUES
  (${adminId},'integration-admin','Integration Admin','ADMIN'),
  (${cashierId},'integration-cashier','Integration Cashier','CASHIER')`;
await testSql`INSERT INTO password_credentials(user_id,password_hash) VALUES
  (${adminId},${passwordHash}),(${cashierId},${passwordHash})`;
await testSql`INSERT INTO categories(id,name_ru,name_uz) VALUES(${categoryId},'Тест','Test')`;
await testSql`INSERT INTO products(id,sku,barcode,name_ru,name_uz,category_id,sale_price,purchase_price,quantity) VALUES
  (${snapshotProductId},'SNAP-1','990000000001','Snapshot RU','Snapshot UZ',${categoryId},150000,100000,10),
  (${idemProductId},'IDEM-1','990000000002','Idem RU','Idem UZ',${categoryId},200000,120000,30),
  (${concurrentProductId},'CONC-1','990000000003','Concurrent RU','Concurrent UZ',${categoryId},300000,180000,1),
  (${rollbackProductId},'ROLL-1','990000000004','Rollback RU','Rollback UZ',${categoryId},400000,250000,5),
  (${emptyProductId},'EMPTY-1','990000000005','Empty RU','Empty UZ',${categoryId},500000,300000,0)`;
await testSql`UPDATE app_settings SET cashier_max_discount_basis_points=2500 WHERE id=1`;

function cookieFrom(response: {headers: Record<string, string | number | string[] | undefined>}) {
  const header = response.headers["set-cookie"];
  const value = Array.isArray(header) ? header[0] : header;
  assert.ok(value);
  return String(value).split(";", 1)[0]!;
}

function telegramInitData(telegramUserId: number) {
  const params = new URLSearchParams({
    auth_date: String(Math.floor(Date.now() / 1000)),
    query_id: randomUUID(),
    user: JSON.stringify({id: telegramUserId, first_name: "QA"}),
  });
  const check = [...params.entries()].sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => `${key}=${value}`).join("\n");
  const secret = createHmac("sha256", "WebAppData").update(process.env.TELEGRAM_BOT_TOKEN!).digest();
  params.set("hash", createHmac("sha256", secret).update(check).digest("hex"));
  return params.toString();
}

function salePayload(productId: string, expectedSalePrice: string, idempotencyKey = randomUUID(), quantity = 1) {
  return {idempotencyKey, items: [{productId, quantity, expectedSalePrice}], discount: {type: "NONE"}, paymentMethod: "CASH"};
}

test("PostgreSQL cashier core integration", async () => {
  let app = await buildApp();
  try {
    const adminLogin = await app.inject({method: "POST", url: "/api/auth/login", headers: {origin: process.env.APP_ORIGIN!},
      payload: {identifier: "integration-admin", password}});
    const cashierLogin = await app.inject({method: "POST", url: "/api/auth/login", headers: {origin: process.env.APP_ORIGIN!},
      payload: {identifier: "integration-cashier", password}});
    assert.equal(adminLogin.statusCode, 200);
    assert.equal(cashierLogin.statusCode, 200);
    const adminCookie = cookieFrom(adminLogin);
    const cashierCookie = cookieFrom(cashierLogin);

    const cashierDenied = await app.inject({method: "POST", url: "/api/admin/telegram/link",
      headers: {origin: process.env.APP_ORIGIN!, cookie: cashierCookie},
      payload: {userId: cashierId, telegramUserId: 555001, allowed: true}});
    assert.equal(cashierDenied.statusCode, 403);
    const adminAllowed = await app.inject({method: "POST", url: "/api/admin/telegram/link",
      headers: {origin: process.env.APP_ORIGIN!, cookie: adminCookie},
      payload: {userId: cashierId, telegramUserId: 555001, allowed: true}});
    assert.equal(adminAllowed.statusCode, 200);

    const initData = telegramInitData(555001);
    const telegramLogin = await app.inject({method: "POST", url: "/api/auth/telegram",
      headers: {origin: process.env.APP_ORIGIN!}, payload: {initData}});
    assert.equal(telegramLogin.statusCode, 200);
    assert.equal(telegramLogin.json().user.role, "CASHIER");
    const telegramReplay = await app.inject({method: "POST", url: "/api/auth/telegram",
      headers: {origin: process.env.APP_ORIGIN!}, payload: {initData}});
    assert.equal(telegramReplay.statusCode, 200);
    const tamperedInitData = new URLSearchParams(initData);
    tamperedInitData.set("hash", "0".repeat(64));
    const invalidTelegram = await app.inject({method: "POST", url: "/api/auth/telegram",
      headers: {origin: process.env.APP_ORIGIN!}, payload: {initData: tamperedInitData.toString()}});
    assert.equal(invalidTelegram.statusCode, 401);

    const snapshotKey = randomUUID();
    const snapshotSale = await app.inject({method: "POST", url: "/api/sales",
      headers: {origin: process.env.APP_ORIGIN!, cookie: cashierCookie},
      payload: {...salePayload(snapshotProductId, "150000", snapshotKey, 2), discount: {type: "FIXED", amount: "50000"}}});
    assert.equal(snapshotSale.statusCode, 200, snapshotSale.body);
    assert.equal(snapshotSale.json().finalTotal, "250000");
    await testSql`UPDATE products SET sale_price=190000,purchase_price=130000 WHERE id=${snapshotProductId}`;
    const snapshots = await testSql<{salePrice: string; purchasePrice: string; quantity: number; finalTotal: string}[]>`
      SELECT sale_price_at_sale::text "salePrice",purchase_price_at_sale::text "purchasePrice",quantity,
        line_final_total::text "finalTotal" FROM sale_items WHERE sale_id=${snapshotSale.json().saleId}`;
    assert.deepEqual(snapshots[0], {salePrice: "150000", purchasePrice: "100000", quantity: 2, finalTotal: "250000"});
    const [snapshotStock] = await testSql<{quantity: number; movements: number}[]>`SELECT p.quantity,
      (SELECT count(*)::int FROM stock_movements m WHERE m.product_id=p.id) movements FROM products p WHERE p.id=${snapshotProductId}`;
    assert.deepEqual(snapshotStock, {quantity: 8, movements: 1});

    const soldItem = await testSql<{id: string}[]>`SELECT id FROM sale_items WHERE sale_id=${snapshotSale.json().saleId}`;
    const firstReturnKey = randomUUID();
    const firstReturnRequest = {method: "POST" as const, url: "/api/returns",
      headers: {origin: process.env.APP_ORIGIN!, cookie: cashierCookie}, payload: {
        idempotencyKey: firstReturnKey, originalSaleId: snapshotSale.json().saleId, reason: "Damaged",
        items: [{saleItemId: soldItem[0]!.id, quantity: 1, restock: false}],
      }};
    const repeatedReturns = await Promise.all(Array.from({length: 20}, () => app.inject(firstReturnRequest)));
    assert.equal(repeatedReturns.filter((response) => response.statusCode === 200).length, 20);
    assert.equal(new Set(repeatedReturns.map((response) => response.json().returnId)).size, 1);
    assert.equal(repeatedReturns[0]!.json().amount, "125000");
    assert.equal(repeatedReturns[0]!.json().costAmount, "100000");
    const secondReturn = await app.inject({method: "POST", url: "/api/returns",
      headers: {origin: process.env.APP_ORIGIN!, cookie: cashierCookie}, payload: {
        idempotencyKey: randomUUID(), originalSaleId: snapshotSale.json().saleId, reason: "Unopened",
        items: [{saleItemId: soldItem[0]!.id, quantity: 1, restock: true}],
      }});
    assert.equal(secondReturn.statusCode, 200, secondReturn.body);
    assert.equal(secondReturn.json().amount, "125000");
    const excessiveReturn = await app.inject({method: "POST", url: "/api/returns",
      headers: {origin: process.env.APP_ORIGIN!, cookie: cashierCookie}, payload: {
        idempotencyKey: randomUUID(), originalSaleId: snapshotSale.json().saleId, reason: "Too many",
        items: [{saleItemId: soldItem[0]!.id, quantity: 1, restock: true}],
      }});
    assert.equal(excessiveReturn.statusCode, 409);
    assert.equal(excessiveReturn.json().code, "RETURN_QUANTITY_EXCEEDED");
    const [returnState] = await testSql<{quantity: number; returns: number; movements: number}[]>`SELECT p.quantity,
      (SELECT count(*)::int FROM return_items ri WHERE ri.product_id=p.id) returns,
      (SELECT count(*)::int FROM stock_movements sm WHERE sm.product_id=p.id AND sm.type IN ('RETURN','RETURN_NO_RESTOCK')) movements
      FROM products p WHERE p.id=${snapshotProductId}`;
    assert.deepEqual(returnState, {quantity: 9, returns: 2, movements: 2});

    const category = await testSql<{id: string}[]>`SELECT id FROM expense_categories ORDER BY id LIMIT 1`;
    const cashierExpense = await app.inject({method: "POST", url: "/api/expenses",
      headers: {origin: process.env.APP_ORIGIN!, cookie: cashierCookie}, payload: {
        idempotencyKey: randomUUID(),categoryId: category[0]!.id,amount: "1000000",reason: "Denied",
      }});
    assert.equal(cashierExpense.statusCode, 403);
    const expenseKey = randomUUID();
    const expenseRequest = {method: "POST" as const,url: "/api/expenses",
      headers: {origin: process.env.APP_ORIGIN!,cookie: adminCookie},payload: {
        idempotencyKey: expenseKey,categoryId: category[0]!.id,amount: "1000000",reason: "Integration expense",
      }};
    const repeatedExpenses = await Promise.all(Array.from({length: 20}, () => app.inject(expenseRequest)));
    assert.equal(repeatedExpenses.filter((response) => response.statusCode === 200).length, 20);
    assert.equal(new Set(repeatedExpenses.map((response) => response.json().expenseId)).size, 1);
    assert.equal(Number((await testSql`SELECT count(*)::int count FROM expenses WHERE idempotency_key=${expenseKey}`)[0]!.count), 1);

    const cashierInventory = await app.inject({method: "POST",url: "/api/inventory",
      headers: {origin: process.env.APP_ORIGIN!,cookie: cashierCookie},payload: {startKey: randomUUID()}});
    assert.equal(cashierInventory.statusCode, 403);
    const conflictInventory = await app.inject({method: "POST",url: "/api/inventory",
      headers: {origin: process.env.APP_ORIGIN!,cookie: adminCookie},payload: {startKey: randomUUID(),note: "Conflict test"}});
    assert.equal(conflictInventory.statusCode, 200);
    const saleDuringInventory = await app.inject({method: "POST",url: "/api/sales",
      headers: {origin: process.env.APP_ORIGIN!,cookie: cashierCookie},payload: salePayload(snapshotProductId,"190000")});
    assert.equal(saleDuringInventory.statusCode, 200, saleDuringInventory.body);
    const conflictItems = await testSql<{productId: string; quantity: number}[]>`SELECT i.product_id "productId",p.quantity
      FROM inventory_items i JOIN products p ON p.id=i.product_id WHERE i.session_id=${conflictInventory.json().sessionId}`;
    for (const item of conflictItems) {
      const counted = await app.inject({method: "POST",url: `/api/inventory/${conflictInventory.json().sessionId}/count`,
        headers: {origin: process.env.APP_ORIGIN!,cookie: adminCookie},payload: {productId: item.productId,actualQuantity: item.quantity}});
      assert.equal(counted.statusCode, 200, counted.body);
    }
    const conflictCompletion = await app.inject({method: "POST",url: `/api/inventory/${conflictInventory.json().sessionId}/complete`,
      headers: {origin: process.env.APP_ORIGIN!,cookie: adminCookie},payload: {}});
    assert.equal(conflictCompletion.statusCode, 409);
    assert.equal(conflictCompletion.json().code, "INVENTORY_CONFLICT");

    const inventory = await app.inject({method: "POST",url: "/api/inventory",
      headers: {origin: process.env.APP_ORIGIN!,cookie: adminCookie},payload: {startKey: randomUUID(),note: "Completion test"}});
    assert.equal(inventory.statusCode, 200);
    const inventoryItems = await testSql<{productId: string; quantity: number}[]>`SELECT i.product_id "productId",p.quantity
      FROM inventory_items i JOIN products p ON p.id=i.product_id WHERE i.session_id=${inventory.json().sessionId}`;
    for (const item of inventoryItems) {
      const actualQuantity = item.productId === snapshotProductId ? item.quantity - 1 : item.quantity;
      const counted = await app.inject({method: "POST",url: `/api/inventory/${inventory.json().sessionId}/count`,
        headers: {origin: process.env.APP_ORIGIN!,cookie: adminCookie},payload: {productId: item.productId,actualQuantity}});
      assert.equal(counted.statusCode, 200, counted.body);
    }
    const inventoryCompletion = await app.inject({method: "POST",url: `/api/inventory/${inventory.json().sessionId}/complete`,
      headers: {origin: process.env.APP_ORIGIN!,cookie: adminCookie},payload: {}});
    assert.equal(inventoryCompletion.statusCode, 200, inventoryCompletion.body);
    assert.equal(inventoryCompletion.json().adjustments, 1);
    const inventoryReplay = await app.inject({method: "POST",url: `/api/inventory/${inventory.json().sessionId}/complete`,
      headers: {origin: process.env.APP_ORIGIN!,cookie: adminCookie},payload: {}});
    assert.equal(inventoryReplay.statusCode, 200);
    assert.equal(inventoryReplay.json().replayed, true);
    assert.equal(Number((await testSql`SELECT quantity FROM products WHERE id=${snapshotProductId}`)[0]!.quantity), 7);

    const idemKey = randomUUID();
    const idemRequest = {method: "POST" as const, url: "/api/sales", headers: {origin: process.env.APP_ORIGIN!, cookie: cashierCookie},
      payload: salePayload(idemProductId, "200000", idemKey)};
    const idemResponses = await Promise.all(Array.from({length: 100}, () => app.inject(idemRequest)));
    assert.equal(idemResponses.filter((response) => response.statusCode === 200).length, 100);
    const [idemState] = await testSql<{quantity: number; sales: number}[]>`SELECT p.quantity,
      (SELECT count(*)::int FROM sale_items si WHERE si.product_id=p.id) sales FROM products p WHERE p.id=${idemProductId}`;
    assert.deepEqual(idemState, {quantity: 29, sales: 1});

    const concurrentResponses = await Promise.all(Array.from({length: 20}, () => app.inject({
      method: "POST", url: "/api/sales", headers: {origin: process.env.APP_ORIGIN!, cookie: cashierCookie},
      payload: salePayload(concurrentProductId, "300000"),
    })));
    assert.equal(concurrentResponses.filter((response) => response.statusCode === 200).length, 1);
    assert.equal(concurrentResponses.filter((response) => response.statusCode === 409 && response.json().code === "INSUFFICIENT_STOCK").length, 19);
    const [concurrentState] = await testSql<{quantity: number; sales: number}[]>`SELECT p.quantity,
      (SELECT count(*)::int FROM sale_items si WHERE si.product_id=p.id) sales FROM products p WHERE p.id=${concurrentProductId}`;
    assert.deepEqual(concurrentState, {quantity: 0, sales: 1});
    const negativeStockRows = await testSql<{negativeStock: number}[]>`SELECT count(*)::int "negativeStock" FROM products WHERE quantity<0`;
    assert.equal(negativeStockRows[0]?.negativeStock, 0);

    const rollbackKey = randomUUID();
    const rollbackSale = await app.inject({method: "POST", url: "/api/sales",
      headers: {origin: process.env.APP_ORIGIN!, cookie: cashierCookie}, payload: {
        idempotencyKey: rollbackKey,
        items: [
          {productId: rollbackProductId, quantity: 1, expectedSalePrice: "400000"},
          {productId: emptyProductId, quantity: 1, expectedSalePrice: "500000"},
        ],
        discount: {type: "NONE"}, paymentMethod: "CARD",
      }});
    assert.equal(rollbackSale.statusCode, 409);
    const [rollbackState] = await testSql<{quantity: number; sales: number; requests: number}[]>`SELECT p.quantity,
      (SELECT count(*)::int FROM sale_items si WHERE si.product_id=p.id) sales,
      (SELECT count(*)::int FROM sale_requests sr WHERE sr.idempotency_key=${rollbackKey}) requests
      FROM products p WHERE p.id=${rollbackProductId}`;
    assert.deepEqual(rollbackState, {quantity: 5, sales: 0, requests: 0});

    const persistedSaleCount = Number((await testSql`SELECT count(*)::int count FROM sales`)[0]!.count);
    await app.close();
    app = await buildApp();
    const afterRestart = await app.inject({method: "GET", url: "/api/auth/session", headers: {cookie: cashierCookie}});
    assert.equal(afterRestart.statusCode, 200);
    assert.equal(Number((await testSql`SELECT count(*)::int count FROM sales`)[0]!.count), persistedSaleCount);
  } finally {
    await app.close();
    await apiSql.end();
    await testSql.end();
  }

  const artifacts = resolve(process.cwd(), "../../.test-artifacts");
  await mkdir(artifacts, {recursive: true});
  const backupFile = join(artifacts, "pos-test.dump");
  const pgDump = spawnSync(process.env.PG_DUMP_BIN ?? "pg_dump",
    ["--dbname", testUrl, "--format=custom", "--compress=9", "--no-owner", "--no-acl", "--file", backupFile], {encoding: "utf8"});
  assert.equal(pgDump.status, 0, pgDump.error?.message ?? pgDump.stderr);

  const restoreSql = postgres(restoreUrl, {max: 1, prepare: false});
  await restoreSql.unsafe("DROP SCHEMA public CASCADE; CREATE SCHEMA public");
  await restoreSql.end();
  const pgRestore = spawnSync(process.env.PG_RESTORE_BIN ?? "pg_restore",
    ["--dbname", restoreUrl, "--no-owner", "--no-acl", "--exit-on-error", backupFile], {encoding: "utf8"});
  assert.equal(pgRestore.status, 0, pgRestore.error?.message ?? pgRestore.stderr);

  const restored = postgres(restoreUrl, {max: 1, prepare: false});
  const source = postgres(testUrl, {max: 1, prepare: false});
  try {
    const sourceCounts = await source`SELECT
      (SELECT count(*)::int FROM users) users,(SELECT count(*)::int FROM products) products,
      (SELECT count(*)::int FROM sales) sales,(SELECT count(*)::int FROM sale_items) sale_items,
      (SELECT count(*)::int FROM returns) returns,(SELECT count(*)::int FROM return_items) return_items,
      (SELECT count(*)::int FROM expenses) expenses,(SELECT count(*)::int FROM inventory_sessions) inventory_sessions,
      (SELECT count(*)::int FROM inventory_items) inventory_items,
      (SELECT count(*)::int FROM stock_movements) stock_movements,(SELECT count(*)::int FROM audit_log) audit_log`;
    const restoredCounts = await restored`SELECT
      (SELECT count(*)::int FROM users) users,(SELECT count(*)::int FROM products) products,
      (SELECT count(*)::int FROM sales) sales,(SELECT count(*)::int FROM sale_items) sale_items,
      (SELECT count(*)::int FROM returns) returns,(SELECT count(*)::int FROM return_items) return_items,
      (SELECT count(*)::int FROM expenses) expenses,(SELECT count(*)::int FROM inventory_sessions) inventory_sessions,
      (SELECT count(*)::int FROM inventory_items) inventory_items,
      (SELECT count(*)::int FROM stock_movements) stock_movements,(SELECT count(*)::int FROM audit_log) audit_log`;
    assert.deepEqual(restoredCounts[0], sourceCounts[0]);
    assert.equal(Number((await restored`SELECT count(*)::int count FROM schema_migrations`)[0]!.count), 6);
  } finally {
    await source.end();
    await restored.end();
  }
});
