import {buildApp} from "./app.js";
import {config} from "./config.js";
import {sql} from "./db.js";

const app = await buildApp();

const shutdown = async () => {
  await app.close();
  await sql.end();
};
process.once("SIGTERM", shutdown);
process.once("SIGINT", shutdown);

// Dual-stack listener supports Railway private IPv6 networking and local IPv4.
await app.listen({port: config.API_PORT, host: "::"});
