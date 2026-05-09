import { createApp } from "./app.js";
import { loadEnv } from "./config/env.js";

const config = loadEnv();
const app = await createApp(config);

await app.listen({ host: config.host, port: config.port });
console.log(`OpenClaw Middleware V2 listening on http://${config.host}:${config.port}`);
