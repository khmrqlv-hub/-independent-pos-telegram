import {randomUUID} from "node:crypto";
import type {InventoryCountInput, InventoryStartInput} from "@pos/contracts";
import {sql} from "../db.js";
import {HttpError} from "../http-error.js";
import type {StaffUser} from "../security.js";

type RequestMeta = {ip: string; userAgent: string | null; requestId: string};

export async function startInventory(input: InventoryStartInput, actor: StaffUser, meta: RequestMeta) {
  return sql.begin(async (transaction) => {
    const id = randomUUID();
    const inserted = await transaction<{id: string; createdAt: Date}[]>`INSERT INTO inventory_sessions(
      id,status,created_by,note,start_key) VALUES(${id},'IN_PROGRESS',${actor.id},${input.note ?? null},${input.startKey})
      ON CONFLICT(start_key) DO NOTHING RETURNING id,created_at "createdAt"`;
    if (inserted.length === 0) {
      const existing = await transaction<{id: string; createdAt: Date}[]>`SELECT id,created_at "createdAt"
        FROM inventory_sessions WHERE start_key=${input.startKey} FOR UPDATE`;
      return {sessionId: existing[0]!.id, createdAt: existing[0]!.createdAt.toISOString(), replayed: true};
    }
    await transaction`INSERT INTO inventory_items(session_id,product_id,system_quantity,system_version)
      SELECT ${id},id,quantity,stock_version FROM products WHERE active=true ORDER BY id`;
    await transaction`INSERT INTO audit_log(user_id,action,entity_type,entity_id,new_data,ip,user_agent,request_id)
      VALUES(${actor.id},'INVENTORY','inventory_session',${id},${transaction.json({status: "IN_PROGRESS"})},
        ${meta.ip},${meta.userAgent},${meta.requestId})`;
    return {sessionId: id, createdAt: inserted[0]!.createdAt.toISOString(), replayed: false};
  });
}

export async function countInventory(sessionId: string, input: InventoryCountInput) {
  return sql.begin(async (transaction) => {
    const session = await transaction<{status: string}[]>`SELECT status FROM inventory_sessions WHERE id=${sessionId} FOR UPDATE`;
    if (!session[0]) throw new HttpError(404, "Inventory session not found", "INVENTORY_NOT_FOUND");
    if (session[0].status !== "IN_PROGRESS") throw new HttpError(409, "Inventory session is not active", "INVENTORY_NOT_ACTIVE");
    const updated = await transaction<{systemQuantity: number}[]>`UPDATE inventory_items SET actual_quantity=${input.actualQuantity}
      WHERE session_id=${sessionId} AND product_id=${input.productId} RETURNING system_quantity "systemQuantity"`;
    if (!updated[0]) throw new HttpError(404, "Inventory product not found", "INVENTORY_PRODUCT_NOT_FOUND");
    return {sessionId, productId: input.productId, systemQuantity: updated[0].systemQuantity, actualQuantity: input.actualQuantity};
  });
}

export async function completeInventory(sessionId: string, actor: StaffUser, meta: RequestMeta) {
  return sql.begin(async (transaction) => {
    const sessions = await transaction<{status: string; completedAt: Date | null}[]>`SELECT status,completed_at "completedAt"
      FROM inventory_sessions WHERE id=${sessionId} FOR UPDATE`;
    const session = sessions[0];
    if (!session) throw new HttpError(404, "Inventory session not found", "INVENTORY_NOT_FOUND");
    if (session.status === "COMPLETED") {
      const count = await transaction<{adjustments: number}[]>`SELECT count(*)::int adjustments FROM stock_movements
        WHERE type='INVENTORY_ADJUSTMENT' AND reference_id=${sessionId}`;
      return {sessionId, status: "COMPLETED", completedAt: session.completedAt!.toISOString(), adjustments: count[0]!.adjustments, replayed: true};
    }
    if (session.status !== "IN_PROGRESS") throw new HttpError(409, "Inventory session is not active", "INVENTORY_NOT_ACTIVE");
    const missing = await transaction<{count: number}[]>`SELECT count(*)::int count FROM inventory_items
      WHERE session_id=${sessionId} AND actual_quantity IS NULL`;
    if (missing[0]!.count > 0) throw new HttpError(409, "All inventory items must be counted", "INVENTORY_INCOMPLETE");

    const rows = await transaction<{
      productId: string; systemQuantity: number; systemVersion: string; actualQuantity: number;
      currentQuantity: number; currentVersion: string;
    }[]>`SELECT i.product_id "productId",i.system_quantity "systemQuantity",i.system_version::text "systemVersion",
      i.actual_quantity "actualQuantity",p.quantity "currentQuantity",p.stock_version::text "currentVersion"
      FROM inventory_items i JOIN products p ON p.id=i.product_id
      WHERE i.session_id=${sessionId} ORDER BY p.id FOR UPDATE OF p`;
    const conflicts = rows.filter((row) => row.systemVersion !== row.currentVersion);
    if (conflicts.length > 0) {
      throw new HttpError(409, `Inventory conflict for ${conflicts.length} product(s)`, "INVENTORY_CONFLICT");
    }
    const movements = [];
    for (const row of rows) {
      const difference = row.actualQuantity - row.currentQuantity;
      if (difference === 0) continue;
      await transaction`UPDATE products SET quantity=${row.actualQuantity},stock_version=stock_version+1,updated_at=now()
        WHERE id=${row.productId}`;
      movements.push({
        id: randomUUID(),product_id: row.productId,type: "INVENTORY_ADJUSTMENT",quantity_change: difference,
        quantity_before: row.currentQuantity,quantity_after: row.actualQuantity,reference_id: sessionId,user_id: actor.id,
        reason: "Inventory completion",
      });
    }
    if (movements.length > 0) await transaction`INSERT INTO stock_movements ${transaction(movements,
      "id","product_id","type","quantity_change","quantity_before","quantity_after","reference_id","user_id","reason")}`;
    const completed = await transaction<{completedAt: Date}[]>`UPDATE inventory_sessions
      SET status='COMPLETED',completed_at=now() WHERE id=${sessionId} RETURNING completed_at "completedAt"`;
    await transaction`INSERT INTO audit_log(user_id,action,entity_type,entity_id,old_data,new_data,ip,user_agent,request_id)
      VALUES(${actor.id},'INVENTORY','inventory_session',${sessionId},${transaction.json({status: "IN_PROGRESS"})},
        ${transaction.json({status: "COMPLETED", adjustments: movements.length})},${meta.ip},${meta.userAgent},${meta.requestId})`;
    return {sessionId, status: "COMPLETED", completedAt: completed[0]!.completedAt.toISOString(), adjustments: movements.length, replayed: false};
  });
}
