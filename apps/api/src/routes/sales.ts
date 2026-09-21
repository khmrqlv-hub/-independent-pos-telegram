import type {FastifyInstance} from "fastify";
import {saleInput} from "@pos/contracts";
import {assertSameOrigin, requireStaff} from "../security.js";
import {createSale} from "../services/create-sale.js";
import {z} from "zod";
import {sql} from "../db.js";
import {HttpError} from "../http-error.js";

export async function saleRoutes(app: FastifyInstance) {
  app.get("/api/sales/:id", async request => {
    const actor = await requireStaff(request);
    const {id} = z.object({id:z.string().uuid()}).parse(request.params);
    const [sale] = await sql`SELECT s.id "saleId",s.receipt_number::text "receiptNumber",s.created_at "createdAt",
      s.original_total::text "originalTotal",s.discount_amount::text "discountAmount",s.final_total::text "finalTotal",
      s.payment_method "paymentMethod",u.display_name "cashierName"
      FROM sales s JOIN users u ON u.id=s.cashier_id
      WHERE s.id=${id} AND (${actor.role}='ADMIN' OR s.cashier_id=${actor.id})`;
    if (!sale) throw new HttpError(404,"Sale not found","SALE_NOT_FOUND");
    const items=await sql`SELECT id,sku_at_sale sku,product_name_ru_at_sale "nameRu",product_name_uz_at_sale "nameUz",
      quantity,sale_price_at_sale::text "salePrice",line_discount::text "discountAmount",line_final_total::text "finalTotal"
      FROM sale_items WHERE sale_id=${id} ORDER BY id`;
    return {...sale,items};
  });
  app.post("/api/sales", async (request) => {
    assertSameOrigin(request);
    const actor = await requireStaff(request);
    const input = saleInput.parse(request.body);
    return createSale(input, actor, {
      ip: request.ip,
      userAgent: request.headers["user-agent"] ?? null,
      requestId: request.id,
    });
  });
}
