import { createSendEmailWorker } from "./jobs/send-email.js";
import { createSendBroadcastWorker } from "./jobs/send-broadcast.js";
import { createProcessEventWorker } from "./jobs/process-event.js";
import { logger } from "./lib/logger.js";

const workers = [
  createSendEmailWorker(),
  createSendBroadcastWorker(),
  createProcessEventWorker(),
];

logger.info({ count: workers.length }, "Workers started");

for (const worker of workers) {
  worker.on("failed", (job, err) => {
    logger.error({ jobId: job?.id, queue: worker.name, err: err.message }, "Job failed");
  });
  worker.on("completed", (job) => {
    logger.info({ jobId: job.id, queue: worker.name }, "Job completed");
  });
}

process.on("SIGTERM", async () => {
  logger.info("SIGTERM received, closing workers...");
  await Promise.all(workers.map((w) => w.close()));
  process.exit(0);
});
