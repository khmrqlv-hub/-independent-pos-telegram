import {drizzle} from "drizzle-orm/postgres-js";
import postgres from "postgres";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL is required");

export const sqlClient = postgres(databaseUrl, {
  max: Number(process.env.DB_POOL_SIZE ?? 10),
  idle_timeout: 20,
  connect_timeout: 10,
  prepare: true,
  transform: {undefined: null},
});

export const database = drizzle(sqlClient);

