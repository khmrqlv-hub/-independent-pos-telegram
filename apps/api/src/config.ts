import {z} from "zod";

const schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  DATABASE_URL: z.string().url().startsWith("postgresql://"),
  APP_ORIGIN: z.string().url(),
  API_PORT: z.coerce.number().int().min(1).max(65535).default(4000),
  SESSION_COOKIE_NAME: z.string().regex(/^[a-zA-Z0-9_-]+$/).default("pos_session"),
  TELEGRAM_BOT_TOKEN: z.string().min(20).optional(),
  TELEGRAM_INIT_DATA_MAX_AGE_SECONDS: z.coerce.number().int().min(60).max(3600).default(300),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"]).default("info"),
});

export const config = schema.parse(process.env);

