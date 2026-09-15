import {createHash, randomBytes, timingSafeEqual} from "node:crypto";
import type {FastifyReply, FastifyRequest} from "fastify";
import {config} from "./config.js";
import {sql} from "./db.js";
import {HttpError} from "./http-error.js";

export type StaffUser = {id: string; role: "ADMIN" | "CASHIER"; displayName: string; locale: "ru" | "uz"};

export const sha256 = (value: string) => createHash("sha256").update(value).digest("hex");

export function setSessionCookie(reply: FastifyReply, token: string) {
  reply.setCookie(config.SESSION_COOKIE_NAME, token, {
    path: "/",
    httpOnly: true,
    secure: config.NODE_ENV === "production",
    sameSite: "strict",
    maxAge: 24 * 60 * 60,
  });
}

export function assertSameOrigin(request: FastifyRequest) {
  const origin = request.headers.origin;
  if (origin !== config.APP_ORIGIN) throw new HttpError(403, "Invalid request origin", "INVALID_ORIGIN");
}

export async function createSession(
  db: typeof sql,
  userId: string,
  request: FastifyRequest,
  reply: FastifyReply,
) {
  const token = randomBytes(32).toString("base64url");
  const tokenHash = sha256(token);
  const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
  await db`INSERT INTO sessions(token_hash,user_id,expires_at,ip,user_agent)
    VALUES(${tokenHash},${userId},${expiresAt},${request.ip},${request.headers["user-agent"] ?? null})`;
  setSessionCookie(reply, token);
}

export async function requireStaff(request: FastifyRequest, role?: "ADMIN") : Promise<StaffUser> {
  const token = request.cookies[config.SESSION_COOKIE_NAME];
  if (!token) throw new HttpError(401, "Sign in required", "AUTH_REQUIRED");
  const tokenHash = sha256(token);
  const rows = await sql<StaffUser[]>`SELECT u.id,u.role,u.display_name "displayName",u.locale
    FROM sessions s JOIN users u ON u.id=s.user_id
    WHERE s.token_hash=${tokenHash} AND s.expires_at>now() AND u.active=true LIMIT 1`;
  const user = rows[0];
  if (!user) throw new HttpError(401, "Session expired", "SESSION_EXPIRED");
  if (role === "ADMIN" && user.role !== "ADMIN") throw new HttpError(403, "Access denied", "ACCESS_DENIED");
  await sql`UPDATE sessions SET last_seen_at=now() WHERE token_hash=${tokenHash}`;
  return user;
}

export function equalHex(expected: string, actual: string) {
  if (!/^[a-f0-9]{64}$/i.test(expected) || !/^[a-f0-9]{64}$/i.test(actual)) return false;
  return timingSafeEqual(Buffer.from(expected, "hex"), Buffer.from(actual, "hex"));
}
