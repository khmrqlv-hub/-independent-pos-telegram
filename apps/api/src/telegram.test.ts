import assert from "node:assert/strict";
import test from "node:test";
import {createHmac} from "node:crypto";

process.env.DATABASE_URL ??= "postgresql://test:test@localhost:5432/test";
process.env.APP_ORIGIN ??= "https://pos.example.test";
process.env.TELEGRAM_BOT_TOKEN = ["1234567890", "test-only-token-material"].join(":");

test("validates Telegram initData signature and age", async () => {
  const {verifyTelegramInitData} = await import("./telegram.js");
  const authDate = 1_700_000_000;
  const user = JSON.stringify({id: 42, first_name: "Aziz"});
  const pairs = [`auth_date=${authDate}`, "query_id=abc", `user=${user}`].sort();
  const check = pairs.join("\n");
  const secret = createHmac("sha256", "WebAppData").update(process.env.TELEGRAM_BOT_TOKEN!).digest();
  const hash = createHmac("sha256", secret).update(check).digest("hex");
  const initData = new URLSearchParams({auth_date: String(authDate), query_id: "abc", user, hash}).toString();
  assert.equal(verifyTelegramInitData(initData, authDate + 30).user.id, 42);
  assert.throws(() => verifyTelegramInitData(initData, authDate + 400));
  const tampered = new URLSearchParams(initData);
  tampered.set("user", JSON.stringify({id: 43, first_name: "Mallory"}));
  assert.throws(() => verifyTelegramInitData(tampered.toString(), authDate + 30));
  assert.throws(() => verifyTelegramInitData(initData, authDate - 60));
});
