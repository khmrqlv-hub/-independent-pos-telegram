import type {FastifyInstance} from "fastify";
import {sql} from "../db.js";

export async function healthRoutes(app: FastifyInstance) {
  app.get("/health", async (_request, reply) => {
    try {
      const result = await sql<{ok: number}[]>`SELECT 1 ok`;
      return {app: "ok", database: result[0]?.ok === 1 ? "ok" : "error"};
    } catch {
      reply.code(503);
      return {app: "ok", database: "error"};
    }
  });
}

