import type {FastifyInstance} from "fastify";
import {expenseInput, inventoryCountInput, inventoryStartInput, returnInput} from "@pos/contracts";
import {z} from "zod";
import {sql} from "../db.js";
import {assertSameOrigin, requireStaff} from "../security.js";
import {createExpense} from "../services/create-expense.js";
import {createReturn} from "../services/create-return.js";
import {completeInventory, countInventory, startInventory} from "../services/inventory.js";

const idParam = z.object({id: z.string().uuid()});
const meta = (request: {ip: string; id: string; headers: Record<string, unknown>}) => ({
  ip: request.ip,
  userAgent: typeof request.headers["user-agent"] === "string" ? request.headers["user-agent"] : null,
  requestId: request.id,
});

export async function operationRoutes(app: FastifyInstance) {
  app.post("/api/returns", async (request) => {
    assertSameOrigin(request);
    const actor = await requireStaff(request);
    return createReturn(returnInput.parse(request.body), actor, meta(request));
  });

  app.get("/api/expense-categories", async (request) => {
    await requireStaff(request, "ADMIN");
    return {items: await sql`SELECT id,name_ru "nameRu",name_uz "nameUz" FROM expense_categories WHERE active=true ORDER BY name_ru`};
  });

  app.post("/api/expenses", async (request) => {
    assertSameOrigin(request);
    const actor = await requireStaff(request, "ADMIN");
    return createExpense(expenseInput.parse(request.body), actor, meta(request));
  });

  app.post("/api/inventory", async (request) => {
    assertSameOrigin(request);
    const actor = await requireStaff(request, "ADMIN");
    return startInventory(inventoryStartInput.parse(request.body), actor, meta(request));
  });

  app.post("/api/inventory/:id/count", async (request) => {
    assertSameOrigin(request);
    await requireStaff(request, "ADMIN");
    return countInventory(idParam.parse(request.params).id, inventoryCountInput.parse(request.body));
  });

  app.post("/api/inventory/:id/complete", async (request) => {
    assertSameOrigin(request);
    const actor = await requireStaff(request, "ADMIN");
    return completeInventory(idParam.parse(request.params).id, actor, meta(request));
  });
}
