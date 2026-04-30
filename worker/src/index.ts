import { createSendEmailWorker } from "./jobs/send-email.js";
import { createSendBroadcastWorker } from "./jobs/send-broadcast.js";
import { createSendBatchWorker } from "./jobs/send-batch.js";
import { createProcessEventWorker } from "./jobs/process-event.js";
import { createCheckSegmentWorker } from "./jobs/check-segment.js";
import { createProcessStepWorker } from "./jobs/process-step.js";
import {
  createStopDrainWorker,
  ensureDrainSweeperSchedule,
} from "./jobs/process-stop-drain.js";
import { createResumeSpreadWorker } from "./jobs/process-resume-spread.js";
import {
  createOutboxWorker,
  ensureOutboxPollerSchedule,
} from "./jobs/process-outbox.js";
import {
  createEditReconciliationWorker,
  startEditReconciliationSubscriber,
} from "./jobs/process-edit-reconciliation.js";
import { createGoalAddReconciliationWorker } from "./jobs/process-goal-add-reconciliation.js";
import {
  createArchivalWorker,
  ensureArchivalSchedule,
} from "./jobs/process-event-archival.js";
import {
  createDriftSweeperWorker,
  ensureDriftSweeperSchedule,
} from "./jobs/process-drift-sweep.js";
import { createPiiErasureWorker } from "./jobs/process-pii-erasure.js";
import { startGoalCacheSubscriber } from "./lib/goal-cache.js";
import { logger } from "./lib/logger.js";

const workers = [
  createSendEmailWorker(),      // campaign/transactional emails — single send
  createSendBroadcastWorker(),  // resolves contacts, chunks into 100, queues send-batch jobs
  createSendBatchWorker(),      // sends ≤100 emails per Resend batch API call
  createProcessEventWorker(),   // event-triggered campaign enrollment
  createCheckSegmentWorker(),   // segment_enter / segment_exit campaign enrollment
  createProcessStepWorker(),    // delayed wait-step execution → next-step advancement
  createStopDrainWorker(),      // Stage 2 — periodic stopping → stopped drain sweeper
  createResumeSpreadWorker(),   // Stage 3 — burst-mitigation resume spread scheduler
  // Stage 6 workers
  createOutboxWorker(),                    // forward campaign_edit_outbox → Redis
  createEditReconciliationWorker(),        // reconcile in-flight enrollments to edits
  createGoalAddReconciliationWorker(),     // paginated reconciliation on goal_added
  createArchivalWorker(),                  // archival of old enrollment_events
  createDriftSweeperWorker(),              // detect replay drift (alert only, CN-06)
  createPiiErasureWorker(),                // GDPR redaction on contact delete
];

// Stage 2 — install repeatable stop-drain schedule (idempotent across reboots).
ensureDrainSweeperSchedule().catch((err) => {
  logger.error({ err: err.message }, "drain-sweeper schedule install failed");
});

// Stage 5 — subscribe to goal-cache:invalidate so other workers' CRUD-driven
// invalidations are applied to this worker's local LRU. Best-effort delivery
// (pub/sub fire-and-forget); TTL bounds staleness if a message is missed.
startGoalCacheSubscriber().catch((err) => {
  logger.error({ err: err.message }, "goal-cache subscriber start failed");
});

// Stage 6 — repeatable schedules.
ensureOutboxPollerSchedule().catch((err) => {
  logger.error({ err: err.message }, "outbox-poller schedule install failed");
});
ensureArchivalSchedule().catch((err) => {
  logger.error({ err: err.message }, "archival schedule install failed");
});
ensureDriftSweeperSchedule().catch((err) => {
  logger.error({ err: err.message }, "drift-sweeper schedule install failed");
});

// Stage 6 — subscribe to campaign-edits Redis channel for reconciliation.
startEditReconciliationSubscriber().catch((err) => {
  logger.error({ err: err.message }, "edit-reconciliation subscriber start failed");
});

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
