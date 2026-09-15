import {randomUUID} from "node:crypto";
import bcrypt from "bcryptjs";
import postgres from "postgres";

const databaseUrl = process.env.DATABASE_URL;
const login = process.env.ADMIN_BOOTSTRAP_LOGIN?.trim();
const displayName = process.env.ADMIN_BOOTSTRAP_NAME?.trim();
const password = process.env.ADMIN_BOOTSTRAP_PASSWORD;

if (!databaseUrl) throw new Error("DATABASE_URL is required");
if (!login || !displayName || !password) {
  throw new Error("ADMIN_BOOTSTRAP_LOGIN, ADMIN_BOOTSTRAP_NAME and ADMIN_BOOTSTRAP_PASSWORD are required");
}
if (password.length < 12) throw new Error("Bootstrap password must contain at least 12 characters");

const sql = postgres(databaseUrl, {max: 1, prepare: false});
try {
  const passwordHash = await bcrypt.hash(password, 12);
  const userId = randomUUID();
  await sql.begin(async (tx) => {
    await tx`SELECT pg_advisory_xact_lock(714_902_001)`;
    const userCounts = await tx<{count: number}[]>`SELECT count(*)::int AS count FROM users`;
    if (userCounts[0]?.count !== 0) throw new Error("Bootstrap refused: users already exist");
    await tx`
      INSERT INTO users (id, login, display_name, role)
      VALUES (${userId}, ${login}, ${displayName}, 'ADMIN')
    `;
    await tx`INSERT INTO password_credentials (user_id, password_hash) VALUES (${userId}, ${passwordHash})`;
    await tx`
      INSERT INTO audit_log (user_id, action, entity_type, entity_id, new_data)
      VALUES (${userId}, 'USER_CREATE', 'user', ${userId}, ${JSON.stringify({role: "ADMIN", bootstrap: true})}::jsonb)
    `;
  });
  console.log(`Created initial ADMIN ${login} (${userId}). Change the bootstrap password after first login.`);
} finally {
  await sql.end();
}
