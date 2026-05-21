import { createApp, type AppContext } from "./app.js";
import { loadEnv } from "./config/env.js";
import { createLogger, errorMeta } from "./lib/logger.js";

const config = loadEnv();
const log = createLogger("server");
const app = await createApp(config);

function startGatewayAutoConnect(context: AppContext) {
  let stopped = false;
  let attempt = 0;
  let timer: ReturnType<typeof setTimeout> | null = null;
  const retryDelayMs = () => Math.min(60_000, 1_000 * 2 ** Math.min(Math.max(0, attempt - 1), 6));
  const schedule = (delayMs: number) => {
    if (stopped) return;
    timer = setTimeout(() => {
      timer = null;
      if (stopped) return;
      attempt += 1;
      log.info("gateway.autoconnect.start", { attempt });
      void context.gateway.connect()
        .then(() => {
          if (!stopped) log.info("gateway.autoconnect.ready", { attempt, connected: context.gateway.status().connected });
        })
        .catch((error) => {
          if (stopped) return;
          const nextRetryMs = retryDelayMs();
          log.warn("gateway.autoconnect.fail", { attempt, nextRetryMs, ...errorMeta(error) });
          schedule(nextRetryMs);
        });
    }, delayMs);
    timer.unref?.();
  };
  schedule(0);
  return () => {
    stopped = true;
    if (timer) clearTimeout(timer);
    timer = null;
  };
}

log.info("listen.start", { host: config.host, port: config.port });
await app.listen({ host: config.host, port: config.port });
log.info("listen.end", { host: config.host, port: config.port });
const context = (app as typeof app & { v2Context?: AppContext }).v2Context;
const stopGatewayAutoConnect = context ? startGatewayAutoConnect(context) : null;
if (stopGatewayAutoConnect) app.addHook("onClose", async () => stopGatewayAutoConnect());
