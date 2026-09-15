import {createHmac} from "node:crypto";
import {config} from "./config.js";
import {equalHex, sha256} from "./security.js";
import {HttpError} from "./http-error.js";

export type TelegramIdentity = {
  id: number;
  username?: string;
  first_name?: string;
  last_name?: string;
};

export function verifyTelegramInitData(initData: string, nowSeconds = Math.floor(Date.now() / 1000)) {
  const botToken = config.TELEGRAM_BOT_TOKEN;
  if (!botToken) throw new HttpError(503, "Telegram login is not configured", "TELEGRAM_NOT_CONFIGURED");
  const params = new URLSearchParams(initData);
  const receivedHash = params.get("hash") ?? "";
  params.delete("hash");
  const dataCheckString = [...params.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => `${key}=${value}`)
    .join("\n");
  const secretKey = createHmac("sha256", "WebAppData").update(botToken).digest();
  const expectedHash = createHmac("sha256", secretKey).update(dataCheckString).digest("hex");
  if (!equalHex(expectedHash, receivedHash)) throw new HttpError(401, "Invalid Telegram signature", "TELEGRAM_SIGNATURE_INVALID");
  const authDate = Number(params.get("auth_date"));
  if (!Number.isSafeInteger(authDate) || authDate > nowSeconds + 30 || nowSeconds - authDate > config.TELEGRAM_INIT_DATA_MAX_AGE_SECONDS) {
    throw new HttpError(401, "Telegram authorization expired", "TELEGRAM_AUTH_EXPIRED");
  }
  let user: TelegramIdentity;
  try { user = JSON.parse(params.get("user") ?? "") as TelegramIdentity; }
  catch { throw new HttpError(400, "Telegram user data is invalid", "TELEGRAM_USER_INVALID"); }
  if (!Number.isSafeInteger(user.id) || user.id <= 0) throw new HttpError(400, "Telegram user data is invalid", "TELEGRAM_USER_INVALID");
  return {user, authDate, initDataHash: sha256(initData)};
}

