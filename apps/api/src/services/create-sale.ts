import {createHash, randomUUID} from "node:crypto";
import {calculateSale, type Discount} from "@pos/domain";
import type {SaleInput} from "@pos/contracts";
import {sql} from "../db.js";
import {HttpError} from "../http-error.js";
import type {StaffUser} from "../security.js";

type ProductRow = {
  id: string;
  sku: string;
  barcode: string | null;
  nameRu: string;
  nameUz: string;
  salePrice: string;
  purchasePrice: string;
  quantity: number;
};

const hashRequest = (input: SaleInput) => createHash("sha256")
  .update(JSON.stringify({...input, items: [...input.items].sort((a, b) => a.productId.localeCompare(b.productId))}))
  .digest("hex");

const toDiscount = (discount: SaleInput["discount"]): Discount => {
  if (discount.type === "NONE") return discount;
  if (discount.type === "FIXED") return {type: "FIXED", amount: BigInt(discount.amount)};
  return discount;
};

export async function createSale(input: SaleInput, actor: StaffUser, requestMeta: {
  ip: string;
  userAgent: string | null;
  requestId: string;
}) {
  const sorted = [...input.items].sort((a, b) => a.productId.localeCompare(b.productId));
  if (new Set(sorted.map((item) => item.productId)).size !== sorted.length) {
    throw new HttpError(400, "Duplicate product in cart", "DUPLICATE_PRODUCT");
  }
  const requestHash = hashRequest(input);
  return sql.begin(async (transaction) => {
    const claimed = await transaction`INSERT INTO sale_requests(idempotency_key,actor_id,request_hash)
      VALUES(${input.idempotencyKey},${actor.id},${requestHash}) ON CONFLICT DO NOTHING RETURNING idempotency_key`;
    if (claimed.length === 0) {
      const previous = await transaction<{
        actorId: string; requestHash: string; saleId: string | null;
      }[]>`SELECT actor_id "actorId",request_hash "requestHash",sale_id "saleId" FROM sale_requests
        WHERE idempotency_key=${input.idempotencyKey} FOR UPDATE`;
      const request = previous[0];
      if (!request || request.actorId !== actor.id || request.requestHash !== requestHash) {
        throw new HttpError(409, "Idempotency key belongs to another request", "IDEMPOTENCY_CONFLICT");
      }
      if (!request.saleId) throw new HttpError(409, "Sale is still being checked", "SALE_PENDING");
      const prior = await transaction<{
        saleId: string; receiptNumber: string; createdAt: Date; originalTotal: string;
        discountAmount: string; finalTotal: string; paymentMethod: string;
      }[]>`SELECT id "saleId",receipt_number::text "receiptNumber",created_at "createdAt",
        original_total::text "originalTotal",discount_amount::text "discountAmount",
        final_total::text "finalTotal",payment_method::text "paymentMethod"
        FROM sales WHERE id=${request.saleId}`;
      return {...prior[0]!, createdAt: prior[0]!.createdAt.toISOString(), replayed: true};
    }

    const productIds = sorted.map((item) => item.productId);
    const products = await transaction<ProductRow[]>`SELECT id,sku,barcode,name_ru "nameRu",name_uz "nameUz",
      sale_price::text "salePrice",purchase_price::text "purchasePrice",quantity
      FROM products WHERE id=ANY(${transaction.array(productIds, 2950)}::uuid[]) AND active=true ORDER BY id FOR UPDATE`;
    if (products.length !== sorted.length) throw new HttpError(404, "Product unavailable", "PRODUCT_UNAVAILABLE");
    const byId = new Map(products.map((product) => [product.id, product]));
    const priced = sorted.map((item) => {
      const product = byId.get(item.productId)!;
      if (product.quantity < item.quantity) throw new HttpError(409, `Insufficient stock: ${product.sku}`, "INSUFFICIENT_STOCK");
      if (product.salePrice !== item.expectedSalePrice) throw new HttpError(409, `Price changed: ${product.sku}`, "PRICE_CHANGED");
      return {productId: product.id, quantity: item.quantity, salePrice: BigInt(product.salePrice), purchasePrice: BigInt(product.purchasePrice)};
    });
    const calculation = calculateSale(priced, toDiscount(input.discount));
    if (actor.role === "CASHIER") {
      const settings = await transaction<{limit: number}[]>`SELECT cashier_max_discount_basis_points limit FROM app_settings WHERE id=1`;
      const limit = settings[0]?.limit ?? 0;
      if (calculation.originalTotal > 0n && calculation.discountAmount * 10_000n > calculation.originalTotal * BigInt(limit)) {
        throw new HttpError(403, "Cashier discount limit exceeded", "DISCOUNT_LIMIT");
      }
    }

    const saleId = randomUUID();
    const sales = await transaction<{receiptNumber: string; createdAt: Date}[]>`INSERT INTO sales(
      id,cashier_id,payment_method,original_total,discount_amount,final_total,idempotency_key)
      VALUES(${saleId},${actor.id},${input.paymentMethod},${calculation.originalTotal.toString()},${calculation.discountAmount.toString()},
        ${calculation.finalTotal.toString()},${input.idempotencyKey})
      RETURNING receipt_number::text "receiptNumber",created_at "createdAt"`;

    const saleItems = calculation.lines.map((line) => {
      const product = byId.get(line.productId)!;
      return {
        id: randomUUID(), sale_id: saleId, product_id: product.id,
        sku_at_sale: product.sku, barcode_at_sale: product.barcode,
        product_name_ru_at_sale: product.nameRu, product_name_uz_at_sale: product.nameUz,
        quantity: line.quantity, sale_price_at_sale: line.salePrice.toString(),
        purchase_price_at_sale: line.purchasePrice.toString(), line_original_total: line.originalTotal.toString(),
        line_discount: line.discountAmount.toString(), line_final_total: line.finalTotal.toString(),
      };
    });
    await transaction`INSERT INTO sale_items ${transaction(saleItems,
      "id","sale_id","product_id","sku_at_sale","barcode_at_sale","product_name_ru_at_sale","product_name_uz_at_sale",
      "quantity","sale_price_at_sale","purchase_price_at_sale","line_original_total","line_discount","line_final_total")}`;

    const movements = [];
    for (const line of calculation.lines) {
      const product = byId.get(line.productId)!;
      const updated = await transaction`UPDATE products SET quantity=quantity-${line.quantity},
        stock_version=stock_version+1,updated_at=now()
        WHERE id=${product.id} AND quantity>=${line.quantity} RETURNING id`;
      if (updated.length !== 1) throw new HttpError(409, `Insufficient stock: ${product.sku}`, "INSUFFICIENT_STOCK");
      movements.push({
        id: randomUUID(), product_id: product.id, type: "SALE", quantity_change: -line.quantity,
        quantity_before: product.quantity, quantity_after: product.quantity - line.quantity,
        reference_id: saleId, user_id: actor.id, reason: null,
      });
    }
    await transaction`INSERT INTO stock_movements ${transaction(movements,
      "id","product_id","type","quantity_change","quantity_before","quantity_after","reference_id","user_id","reason")}`;
    await transaction`INSERT INTO sale_payments(sale_id,method,amount)
      VALUES(${saleId},${input.paymentMethod},${calculation.finalTotal.toString()})`;
    await transaction`UPDATE sale_requests SET sale_id=${saleId},result_code='SUCCESS' WHERE idempotency_key=${input.idempotencyKey}`;
    await transaction`INSERT INTO audit_log(user_id,action,entity_type,entity_id,new_data,ip,user_agent,request_id)
      VALUES(${actor.id},'SALE','sale',${saleId},${transaction.json({
        receiptNumber: sales[0]!.receiptNumber,
        finalTotal: calculation.finalTotal.toString(),
      })},${requestMeta.ip},${requestMeta.userAgent},${requestMeta.requestId})`;
    return {
      saleId,
      receiptNumber: sales[0]!.receiptNumber,
      createdAt: sales[0]!.createdAt.toISOString(),
      originalTotal: calculation.originalTotal.toString(),
      discountAmount: calculation.discountAmount.toString(),
      finalTotal: calculation.finalTotal.toString(),
      paymentMethod: input.paymentMethod,
      replayed: false,
    };
  });
}
