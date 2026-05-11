import { createApp } from "./app.js";
import { loadEnv } from "./config/env.js";
import { createLogger } from "./lib/logger.js";

const config = loadEnv();
const log = createLogger("server");
const app = await createApp(config);

log.info("listen.start", { host: config.host, port: config.port });
await app.listen({ host: config.host, port: config.port });
log.info("listen.end", { host: config.host, port: config.port });
