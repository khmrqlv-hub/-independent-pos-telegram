import {createHash, randomUUID} from "node:crypto";
import type {ReturnInput} from "@pos/contracts";
import {sql} from "../db.js";
import {HttpError} from "../http-error.js";
import type {StaffUser} from "../security.js";

type RequestMeta = {ip: string; userAgent: string | null; requestId: string};
type SaleItemRow = {
  id: string;
  productId: string;
  quantity: number;
  lineFinalTotal: string;
  purchasePrice: string;
};

const requestHash = (input: ReturnInput) => createHash("sha256").update(JSON.stringify({
  ...input,
  items: [...input.items].sort((a, b) => a.saleItemId.localeCompare(b.saleItemId)),
})).digest("hex");

export async function createReturn(input: ReturnInput, actor: StaffUser, meta: RequestMeta) {
  if (new Set(input.items.map((item) => item.saleItemId)).size !== input.items.length) {
    throw new HttpError(400, "Duplicate sale item", "DUPLICATE_SALE_ITEM");
  }
  const hash = requestHash(input);
  return sql.begin(async (transaction) => {
    const responseFor = async (returnId: string, replayed: boolean) => {
      const rows = await transaction<{
        returnId: string; originalSaleId: string; createdAt: Date; amount: string; costAmount: string; quantity: string;
      }[]>`SELECT r.id "returnId",r.original_sale_id "originalSaleId",r.created_at "createdAt",
        coalesce(sum(ri.amount),0)::text amount,coalesce(sum(ri.cost_amount),0)::text "costAmount",
        coalesce(sum(ri.quantity),0)::text quantity
        FROM returns r LEFT JOIN return_items ri ON ri.return_id=r.id WHERE r.id=${returnId} GROUP BY r.id`;
      const row = rows[0]!;
      return {...row, createdAt: row.createdAt.toISOString(), replayed};
    };
    const returnId = randomUUID();
    const inserted = await transaction<{id: string}[]>`INSERT INTO returns(
      id,original_sale_id,cashier_id,reason,idempotency_key,request_hash)
      VALUES(${returnId},${input.originalSaleId},${actor.id},${input.reason},${input.idempotencyKey},${hash})
      ON CONFLICT(idempotency_key) DO NOTHING RETURNING id`;
    if (inserted.length === 0) {
      const existing = await transaction<{id: string; cashierId: string; requestHash: string}[]>`
        SELECT id,cashier_id "cashierId",request_hash "requestHash" FROM returns
        WHERE idempotency_key=${input.idempotencyKey} FOR UPDATE`;
      const prior = existing[0];
      if (!prior || prior.cashierId !== actor.id || prior.requestHash !== hash) {
        throw new HttpError(409, "Idempotency key belongs to another return", "IDEMPOTENCY_CONFLICT");
      }
      return responseFor(prior.id, true);
    }

    const ids = [...input.items].sort((a, b) => a.saleItemId.localeCompare(b.saleItemId)).map((item) => item.saleItemId);
    const sold = await transaction<SaleItemRow[]>`SELECT id,product_id "productId",quantity,
      line_final_total::text "lineFinalTotal",purchase_price_at_sale::text "purchasePrice"
      FROM sale_items WHERE id=ANY(${transaction.array(ids, 2950)}::uuid[])
      AND sale_id=${input.originalSaleId} ORDER BY id FOR UPDATE`;
    if (sold.length !== ids.length) throw new HttpError(404, "Sale item not found", "SALE_ITEM_NOT_FOUND");
    const byId = new Map(sold.map((item) => [item.id, item]));
    const returned = await transaction<{saleItemId: string; quantity: string}[]>`
      SELECT sale_item_id "saleItemId",sum(quantity)::text quantity FROM return_items
      WHERE sale_item_id=ANY(${transaction.array(ids, 2950)}::uuid[]) GROUP BY sale_item_id`;
    const returnedById = new Map(returned.map((item) => [item.saleItemId, Number(item.quantity)]));

    const lines = input.items.map((requested) => {
      const item = byId.get(requested.saleItemId)!;
      const before = returnedById.get(item.id) ?? 0;
      const after = before + requested.quantity;
      if (after > item.quantity) throw new HttpError(409, "Return quantity exceeds sold quantity", "RETURN_QUANTITY_EXCEEDED");
      const finalTotal = BigInt(item.lineFinalTotal);
      const amount = finalTotal * BigInt(after) / BigInt(item.quantity)
        - finalTotal * BigInt(before) / BigInt(item.quantity);
      return {
        requested,
        item,
        amount,
        costAmount: BigInt(item.purchasePrice) * BigInt(requested.quantity),
      };
    });

    const productIds = [...new Set(lines.map((line) => line.item.productId))].sort();
    const products = await transaction<{id: string; quantity: number}[]>`SELECT id,quantity FROM products
      WHERE id=ANY(${transaction.array(productIds, 2950)}::uuid[]) ORDER BY id FOR UPDATE`;
    const stock = new Map(products.map((product) => [product.id, product.quantity]));
    const returnItems = [];
    const movements = [];
    for (const line of lines) {
      const before = stock.get(line.item.productId)!;
      const change = line.requested.restock ? line.requested.quantity : 0;
      const after = before + change;
      if (change > 0) {
        await transaction`UPDATE products SET quantity=${after},stock_version=stock_version+1,updated_at=now()
          WHERE id=${line.item.productId}`;
        stock.set(line.item.productId, after);
      }
      returnItems.push({
        id: randomUUID(), return_id: returnId, sale_item_id: line.item.id, product_id: line.item.productId,
        quantity: line.requested.quantity, amount: line.amount.toString(), cost_amount: line.costAmount.toString(),
        restocked: line.requested.restock,
      });
      movements.push({
        id: randomUUID(), product_id: line.item.productId,
        type: line.requested.restock ? "RETURN" : "RETURN_NO_RESTOCK",
        quantity_change: change, quantity_before: before, quantity_after: after,
        reference_id: returnId, user_id: actor.id, reason: input.reason,
      });
    }
    await transaction`INSERT INTO return_items ${transaction(returnItems,
      "id","return_id","sale_item_id","product_id","quantity","amount","cost_amount","restocked")}`;
    await transaction`INSERT INTO stock_movements ${transaction(movements,
      "id","product_id","type","quantity_change","quantity_before","quantity_after","reference_id","user_id","reason")}`;
    await transaction`INSERT INTO audit_log(user_id,action,entity_type,entity_id,new_data,ip,user_agent,request_id)
      VALUES(${actor.id},'RETURN','return',${returnId},${transaction.json({originalSaleId: input.originalSaleId})},
        ${meta.ip},${meta.userAgent},${meta.requestId})`;
    return responseFor(returnId, false);
  });
}
