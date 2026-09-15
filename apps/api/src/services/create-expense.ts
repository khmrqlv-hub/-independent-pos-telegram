import {createHash, randomUUID} from "node:crypto";
import type {ExpenseInput} from "@pos/contracts";
import {sql} from "../db.js";
import {HttpError} from "../http-error.js";
import type {StaffUser} from "../security.js";

type RequestMeta = {ip: string; userAgent: string | null; requestId: string};

export async function createExpense(input: ExpenseInput, actor: StaffUser, meta: RequestMeta) {
  const hash = createHash("sha256").update(JSON.stringify(input)).digest("hex");
  return sql.begin(async (transaction) => {
    const expenseId = randomUUID();
    const inserted = await transaction<{id: string; createdAt: Date}[]>`INSERT INTO expenses(
      id,amount,category_id,reason,user_id,idempotency_key,request_hash)
      SELECT ${expenseId},${input.amount},${input.categoryId},${input.reason},${actor.id},${input.idempotencyKey},${hash}
      WHERE EXISTS(SELECT 1 FROM expense_categories WHERE id=${input.categoryId} AND active=true)
      ON CONFLICT(idempotency_key) DO NOTHING RETURNING id,created_at "createdAt"`;
    if (inserted.length === 0) {
      const existing = await transaction<{
        id: string; userId: string; requestHash: string; amount: string; createdAt: Date;
      }[]>`SELECT id,user_id "userId",request_hash "requestHash",amount::text amount,created_at "createdAt"
        FROM expenses WHERE idempotency_key=${input.idempotencyKey} FOR UPDATE`;
      const prior = existing[0];
      if (!prior) throw new HttpError(404, "Expense category not found", "EXPENSE_CATEGORY_NOT_FOUND");
      if (prior.userId !== actor.id || prior.requestHash !== hash) {
        throw new HttpError(409, "Idempotency key belongs to another expense", "IDEMPOTENCY_CONFLICT");
      }
      return {expenseId: prior.id, amount: prior.amount, createdAt: prior.createdAt.toISOString(), replayed: true};
    }
    await transaction`INSERT INTO audit_log(user_id,action,entity_type,entity_id,new_data,ip,user_agent,request_id)
      VALUES(${actor.id},'EXPENSE','expense',${expenseId},${transaction.json({amount: input.amount, categoryId: input.categoryId})},
        ${meta.ip},${meta.userAgent},${meta.requestId})`;
    return {expenseId, amount: input.amount, createdAt: inserted[0]!.createdAt.toISOString(), replayed: false};
  });
}
