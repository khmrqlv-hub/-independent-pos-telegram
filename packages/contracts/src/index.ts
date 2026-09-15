import {z} from "zod";

const integerMoney = z.string().regex(/^(0|[1-9]\d*)$/).max(19);

export const loginInput = z.object({
  identifier: z.string().trim().min(3).max(254),
  password: z.string().min(10).max(128),
});

export const telegramLoginInput = z.object({initData: z.string().min(1).max(8192)});

export const saleInput = z.object({
  idempotencyKey: z.string().uuid(),
  items: z.array(z.object({
    productId: z.string().uuid(),
    quantity: z.number().int().positive().max(100_000),
    expectedSalePrice: integerMoney,
  })).min(1).max(200),
  discount: z.discriminatedUnion("type", [
    z.object({type: z.literal("NONE")}),
    z.object({type: z.literal("FIXED"), amount: integerMoney}),
    z.object({type: z.literal("PERCENT"), basisPoints: z.number().int().min(0).max(10_000)}),
  ]),
  paymentMethod: z.enum(["CASH", "CLICK", "PAYME", "CARD", "TRANSFER", "OTHER"]),
});

export const productSearchInput = z.object({
  q: z.string().trim().max(200).default(""),
  categoryId: z.string().uuid().optional(),
  cursor: z.string().uuid().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(40),
});

export type LoginInput = z.infer<typeof loginInput>;
export type TelegramLoginInput = z.infer<typeof telegramLoginInput>;
export type SaleInput = z.infer<typeof saleInput>;

