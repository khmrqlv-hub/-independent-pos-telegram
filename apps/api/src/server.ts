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

await app.listen({port: config.API_PORT, host: "0.0.0.0"});
