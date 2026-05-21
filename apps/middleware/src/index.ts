import { createApp, type AppContext } from "./app.js";
import { loadEnv } from "./config/env.js";
import { createLogger, errorMeta } from "./lib/logger.js";

const config = loadEnv();
const log = createLogger("server");
const app = await createApp(config);

function startGatewayAutoConnect() {
  const context = (app as typeof app & { v2Context?: AppContext }).v2Context;
  if (!context) return;
  let attempt = 0;
  const connect = () => {
    attempt += 1;
    const delayMs = Math.min(60_000, attempt <= 1 ? 0 : 1_000 * 2 ** Math.min(attempt - 2, 5));
    setTimeout(() => {
      log.info("gateway.autoconnect.start", { attempt });
      void context.gateway.connect()
        .then(() => log.info("gateway.autoconnect.ready", { attempt, connected: context.gateway.status().connected }))
        .catch((error) => {
          log.warn("gateway.autoconnect.fail", { attempt, nextRetryMs: Math.min(60_000, 1_000 * 2 ** Math.min(attempt - 1, 5)), ...errorMeta(error) });
          connect();
        });
    }, delayMs).unref?.();
  };
  connect();
}

log.info("listen.start", { host: config.host, port: config.port });
await app.listen({ host: config.host, port: config.port });
log.info("listen.end", { host: config.host, port: config.port });
startGatewayAutoConnect();
