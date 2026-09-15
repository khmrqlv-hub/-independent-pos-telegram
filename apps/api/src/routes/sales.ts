import type {FastifyInstance} from "fastify";
import {saleInput} from "@pos/contracts";
import {assertSameOrigin, requireStaff} from "../security.js";
import {createSale} from "../services/create-sale.js";

export async function saleRoutes(app: FastifyInstance) {
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

