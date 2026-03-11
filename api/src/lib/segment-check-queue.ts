/**
 * Shared helper to enqueue segment-check jobs from API routes.
 *
 * Fires whenever a contact's state could have changed in a way that
 * affects segment membership:
 *   - contact attribute updated
 *   - new event tracked (affects event.* segment conditions)
 *   - group membership added / removed (affects group.* conditions)
 *   - contact upserted via ingest
 *
 * The worker bails early if there are no active segment_enter/exit
 * campaigns in the workspace, so the overhead when the feature is
 * unused is a single fast DB query per queue call.
 */
import { Queue } from "bullmq";
import { getQueueRedisConnection } from "./redis.js";

export type SegmentCheckReason =
  | "contact_updated"
  | "event_tracked"
  | "group_changed"
  | "ingest_identify";

let _queue: Queue | null = null;
function getQueue() {
  if (!_queue) _queue = new Queue("segment-check", { connection: getQueueRedisConnection() });
  return _queue;
}

export async function enqueueSegmentCheck(
  contactId: string,
  workspaceId: string,
  reason: SegmentCheckReason,
): Promise<void> {
  await getQueue().add(
    "segment-check",
    { contactId, workspaceId, reason },
    { removeOnComplete: 100 },
  );
}
