import {readdir, readFile} from "node:fs/promises";
import {dirname, join} from "node:path";
import {fileURLToPath} from "node:url";
import postgres from "postgres";

const databaseUrl = process.env.MIGRATION_DATABASE_URL ?? process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("MIGRATION_DATABASE_URL or DATABASE_URL is required");
const directory = join(dirname(fileURLToPath(import.meta.url)), "../migrations");
const sql = postgres(databaseUrl, {max: 1, prepare: false});

try {
  await sql.unsafe("CREATE TABLE IF NOT EXISTS schema_migrations(version text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())");
  const appliedRows = await sql<{version: string}[]>`SELECT version FROM schema_migrations`;
  const applied = new Set(appliedRows.map((row) => row.version));
  const files = (await readdir(directory)).filter((file) => /^\d{4}_.+\.sql$/.test(file)).sort();
  for (const file of files) {
    const version = file.slice(0, 4);
    if (applied.has(version)) continue;
    const migration = await readFile(join(directory, file), "utf8");
    await sql.begin(async (transaction) => {
      await transaction.unsafe(migration).simple();
      await transaction`INSERT INTO schema_migrations(version) VALUES (${version})`;
    });
    console.log(`applied ${file}`);
  }
} finally {
  await sql.end();
}

