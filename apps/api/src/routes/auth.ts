import {createHash, randomBytes, randomUUID} from "node:crypto";
import {compare} from "bcryptjs";
import type {FastifyInstance} from "fastify";
import {loginInput, telegramLoginInput} from "@pos/contracts";
import {config} from "../config.js";
import {sql} from "../db.js";
import {HttpError} from "../http-error.js";
import {assertSameOrigin, requireStaff, setSessionCookie, sha256} from "../security.js";
import {verifyTelegramInitData} from "../telegram.js";

const identifierHash = (identifier: string) => createHash("sha256").update(identifier).digest("hex");
const sessionExpiry = () => new Date(Date.now() + 24 * 60 * 60 * 1000);

export async function authRoutes(app: FastifyInstance) {
  app.post("/api/auth/login", async (request, reply) => {
    assertSameOrigin(request);
    const input = loginInput.parse(request.body);
    const normalized = input.identifier.trim().toLowerCase();
    const fingerprint = identifierHash(normalized);
    const result = await sql.begin(async (transaction) => {
      await transaction`SELECT pg_advisory_xact_lock(hashtextextended(${normalized},0))`;
      const attempts = await transaction<{count: number}[]>`SELECT count(*)::int count FROM login_attempts
        WHERE identifier_hash=${fingerprint} AND success=false AND attempted_at>now()-interval '15 minutes'`;
      if ((attempts[0]?.count ?? 0) >= 5) throw new HttpError(429, "Too many login attempts", "LOGIN_RATE_LIMITED");
      const users = await transaction<{
        id: string; role: "ADMIN" | "CASHIER"; displayName: string; locale: "ru" | "uz"; passwordHash: string;
      }[]>`SELECT u.id,u.role,u.display_name "displayName",u.locale,p.password_hash "passwordHash"
        FROM users u JOIN password_credentials p ON p.user_id=u.id
        WHERE u.active=true AND (lower(u.login)=${normalized} OR lower(u.email)=${normalized} OR u.phone=${input.identifier.trim()})
        LIMIT 1`;
      const user = users[0];
      if (!user || !await compare(input.password, user.passwordHash)) {
        await transaction`INSERT INTO login_attempts(identifier_hash,ip,success) VALUES(${fingerprint},${request.ip},false)`;
        return null;
      }
      await transaction`INSERT INTO login_attempts(identifier_hash,ip,success) VALUES(${fingerprint},${request.ip},true)`;
      await transaction`DELETE FROM login_attempts WHERE identifier_hash=${fingerprint} AND success=false`;
      const token = randomBytes(32).toString("base64url");
      await transaction`INSERT INTO sessions(token_hash,user_id,expires_at,ip,user_agent)
        VALUES(${sha256(token)},${user.id},${sessionExpiry()},${request.ip},${request.headers["user-agent"] ?? null})`;
      await transaction`INSERT INTO audit_log(user_id,action,entity_type,entity_id,ip,user_agent,request_id,new_data)
        VALUES(${user.id},'LOGIN','session',${user.id},${request.ip},${request.headers["user-agent"] ?? null},${request.id},${transaction.json({method:"password"})})`;
      return {user: {id: user.id, role: user.role, displayName: user.displayName, locale: user.locale}, token};
    });
    if (!result) throw new HttpError(401, "Invalid login or password", "LOGIN_INVALID");
    setSessionCookie(reply, result.token);
    return {user: result.user};
  });

  app.post("/api/auth/telegram", async (request, reply) => {
    assertSameOrigin(request);
    const input = telegramLoginInput.parse(request.body);
    const verified = verifyTelegramInitData(input.initData);
    const result = await sql.begin(async (transaction) => {
      const nonce = await transaction`INSERT INTO telegram_auth_nonces(init_data_hash,telegram_user_id,auth_date)
        VALUES(${verified.initDataHash},${verified.user.id},${new Date(verified.authDate * 1000)})
        ON CONFLICT(init_data_hash) DO UPDATE SET used_at=now()
          WHERE telegram_auth_nonces.telegram_user_id=excluded.telegram_user_id
        RETURNING init_data_hash`;
      if (nonce.length === 0) throw new HttpError(409, "Telegram authorization conflict", "TELEGRAM_AUTH_CONFLICT");
      const users = await transaction<{
        id: string; role: "ADMIN" | "CASHIER"; displayName: string; locale: "ru" | "uz";
      }[]>`SELECT u.id,u.role,u.display_name "displayName",u.locale
        FROM telegram_accounts t JOIN users u ON u.id=t.user_id
        WHERE t.telegram_user_id=${verified.user.id} AND t.allowed=true AND u.active=true LIMIT 1`;
      const user = users[0];
      if (!user) throw new HttpError(403, "Telegram account is not allowed", "TELEGRAM_NOT_ALLOWED");
      await transaction`UPDATE telegram_accounts SET username=${verified.user.username ?? null},
        first_name=${verified.user.first_name ?? null},last_name=${verified.user.last_name ?? null},last_login_at=now()
        WHERE telegram_user_id=${verified.user.id}`;
      const token = randomBytes(32).toString("base64url");
      await transaction`INSERT INTO sessions(token_hash,user_id,expires_at,ip,user_agent)
        VALUES(${sha256(token)},${user.id},${sessionExpiry()},${request.ip},${request.headers["user-agent"] ?? null})`;
      await transaction`INSERT INTO audit_log(user_id,action,entity_type,entity_id,ip,user_agent,request_id,new_data)
        VALUES(${user.id},'LOGIN','telegram_account',${String(verified.user.id)},${request.ip},${request.headers["user-agent"] ?? null},${request.id},${transaction.json({method:"telegram"})})`;
      return {user, token};
    });
    setSessionCookie(reply, result.token);
    return {user: result.user};
  });

  app.get("/api/auth/session", async (request) => ({user: await requireStaff(request)}));

  app.post("/api/auth/logout", async (request, reply) => {
    assertSameOrigin(request);
    const user = await requireStaff(request);
    const token = request.cookies[config.SESSION_COOKIE_NAME];
    if (token) await sql`DELETE FROM sessions WHERE token_hash=${sha256(token)}`;
    await sql`INSERT INTO audit_log(user_id,action,entity_type,entity_id,ip,user_agent,request_id)
      VALUES(${user.id},'LOGOUT','session',${user.id},${request.ip},${request.headers["user-agent"] ?? null},${request.id})`;
    reply.clearCookie(config.SESSION_COOKIE_NAME, {path: "/"});
    return {ok: true};
  });

  app.post("/api/admin/telegram/link", async (request) => {
    assertSameOrigin(request);
    const actor = await requireStaff(request, "ADMIN");
    const body = request.body as {userId?: unknown; telegramUserId?: unknown; allowed?: unknown};
    if (typeof body.userId !== "string" || !/^[-0-9a-f]{36}$/i.test(body.userId)) {
      throw new HttpError(400, "Invalid user id", "INPUT_INVALID");
    }
    const userId = body.userId;
    const telegramUserId = typeof body.telegramUserId === "number" ? body.telegramUserId : Number(body.telegramUserId);
    if (!Number.isSafeInteger(telegramUserId) || telegramUserId <= 0 || typeof body.allowed !== "boolean") {
      throw new HttpError(400, "Invalid Telegram account", "INPUT_INVALID");
    }
    const allowed = body.allowed;
    await sql.begin(async (transaction) => {
      await transaction`INSERT INTO telegram_accounts(telegram_user_id,user_id,allowed)
        VALUES(${telegramUserId},${userId},${allowed})
        ON CONFLICT(telegram_user_id) DO UPDATE SET user_id=excluded.user_id,allowed=excluded.allowed`;
      await transaction`INSERT INTO audit_log(user_id,action,entity_type,entity_id,new_data,ip,user_agent,request_id)
        VALUES(${actor.id},'USER_UPDATE','telegram_account',${String(telegramUserId)},
          ${transaction.json({userId, allowed})},${request.ip},${request.headers["user-agent"] ?? null},${request.id})`;
    });
    return {ok: true, requestId: randomUUID()};
  });
}
