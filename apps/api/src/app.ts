import {randomUUID} from "node:crypto";
import cookie from "@fastify/cookie";
import cors from "@fastify/cors";
import helmet from "@fastify/helmet";
import Fastify from "fastify";
import {ZodError} from "zod";
import {config} from "./config.js";
import {HttpError} from "./http-error.js";
import {authRoutes} from "./routes/auth.js";
import {healthRoutes} from "./routes/health.js";
import {productRoutes} from "./routes/products.js";
import {saleRoutes} from "./routes/sales.js";
import {operationRoutes} from "./routes/operations.js";
import {reportRoutes} from "./routes/reports.js";

export async function buildApp() {
  const app = Fastify({
    logger: {level: config.LOG_LEVEL, redact: ["req.headers.cookie", "req.headers.authorization", "body.password", "body.initData"]},
    trustProxy: true,
    genReqId: () => randomUUID(),
    bodyLimit: 256 * 1024,
  });

  await app.register(helmet, {contentSecurityPolicy: false});
  await app.register(cookie);
  await app.register(cors, {origin: config.APP_ORIGIN, credentials: true, methods: ["GET", "POST"]});
  app.addHook("onSend", async (_request, reply) => {
    reply.header("Cache-Control", "no-store");
    reply.header("X-Content-Type-Options", "nosniff");
  });
  app.setErrorHandler((error, request, reply) => {
    const status = error instanceof HttpError ? error.statusCode : error instanceof ZodError ? 400 : 500;
    const code = error instanceof HttpError ? error.code : error instanceof ZodError ? "INPUT_INVALID" : "INTERNAL_ERROR";
    if (status >= 500) request.log.error({err: error, operation: "request_failed"});
    const message = error instanceof Error ? error.message : "Invalid request";
    reply.code(status).send({error: status >= 500 ? "Operation failed" : message, code, requestId: request.id});
  });

  await app.register(healthRoutes);
  await app.register(authRoutes);
  await app.register(productRoutes);
  await app.register(saleRoutes);
  await app.register(operationRoutes);
  await app.register(reportRoutes);
  return app;
}
