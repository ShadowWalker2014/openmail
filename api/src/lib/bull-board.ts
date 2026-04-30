/**
 * Bull Board — BullMQ queue dashboard for monitoring jobs and failures.
 *
 * Mounted at /admin/queues on the API service.
 * Protected by HTTP Basic Auth — set BULL_BOARD_PASSWORD env var.
 * If BULL_BOARD_PASSWORD is not set, the dashboard is disabled.
 *
 * Access: open https://openmail.win/api/admin/queues in your browser
 * Auth:   user = "admin", password = BULL_BOARD_PASSWORD value
 */

import { createBullBoard } from "@bull-board/api";
import { BullMQAdapter } from "@bull-board/api/bullMQAdapter";
import { HonoAdapter } from "@bull-board/hono";
import { serveStatic } from "@hono/node-server/serve-static";
import { Queue } from "bullmq";
import { Hono } from "hono";
import pino from "pino";

const logger = pino({ level: process.env.LOG_LEVEL ?? "info" });

function getRedisOpts() {
  const url = process.env.REDIS_URL;
  if (!url) throw new Error("REDIS_URL is required for Bull Board");
  const parsed = new URL(url);
  return {
    host: parsed.hostname,
    port: parseInt(parsed.port || "6379", 10),
    password: parsed.password || undefined,
    tls: parsed.protocol === "rediss:" ? {} as Record<string, never> : undefined,
  };
}

// Queue names must match exactly what the worker registers
const QUEUE_NAMES = ["broadcasts", "send-batch", "send-email", "campaigns", "segment-check", "step-execution"];

let _queues: Queue[] | null = null;
function getQueues(): Queue[] {
  if (!_queues) {
    const conn = getRedisOpts();
    _queues = QUEUE_NAMES.map((name) => new Queue(name, { connection: conn }));
  }
  return _queues;
}

/**
 * Mount Bull Board dashboard on the main Hono app.
 * Skipped entirely if BULL_BOARD_PASSWORD is not set.
 */
export function mountBullBoard(app: Hono): void {
  const password = process.env.BULL_BOARD_PASSWORD;
  if (!password) {
    logger.info("BULL_BOARD_PASSWORD not set — Bull Board dashboard disabled");
    return;
  }

  const serverAdapter = new HonoAdapter(serveStatic);
  serverAdapter.setBasePath("/api/admin/queues");

  createBullBoard({
    queues: getQueues().map((q) => new BullMQAdapter(q)),
    serverAdapter,
  });

  const boardApp = serverAdapter.registerPlugin();

  // HTTP Basic Auth guard — protect the admin dashboard
  app.use("/api/admin/queues/*", async (c, next) => {
    const auth = c.req.header("Authorization") ?? "";
    const [scheme, encoded] = auth.split(" ");
    if (scheme !== "Basic" || !encoded) {
      c.header("WWW-Authenticate", 'Basic realm="OpenMail Admin"');
      return c.text("Unauthorized", 401);
    }
    const decoded = Buffer.from(encoded, "base64").toString("utf-8");
    const [, pass] = decoded.split(":");
    if (pass !== password) {
      c.header("WWW-Authenticate", 'Basic realm="OpenMail Admin"');
      return c.text("Unauthorized", 401);
    }
    await next();
  });

  app.route("/api/admin/queues", boardApp);

  logger.info("Bull Board queue dashboard mounted at /api/admin/queues");
}
