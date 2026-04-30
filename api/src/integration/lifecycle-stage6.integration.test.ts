/**
 * Stage 6 — Integration tests (REQ-24).
 *
 * Covers a subset for the autonomous run per task spec:
 *  - Replay state model: full lifecycle reconstruction matches
 *  - Replay drift detection: status mismatch produces non-empty diff
 *  - Payload-schema lookup: every SSOT event_type has a v1 schema
 *  - Replay dispatcher: redacted payload is treated as opaque (warn, not drift)
 *  - Outbox + reconciliation routing: edit_type taxonomy is exhaustive
 *
 * Skipped for autonomous run (flagged in execution log):
 *  - End-to-end DB-dependent reconciliation (requires postgres + redis up)
 *  - Performance: timeline 1000 events <2s; replay 10k <30s; reconcile 10k <2min
 *  - Goal-add paginated: 100k enrollments + new goal
 *
 * Run with: bun test src/integration/lifecycle-stage6.integration.test.ts
 */
import { describe, expect, test } from "bun:test";
import {
  ENROLLMENT_EVENT_TYPES,
  PAYLOAD_SCHEMAS,
  getPayloadSchema,
  isRedactedPayload,
  assertSchemaCoverage,
  CAMPAIGN_EDIT_TYPES,
  type EnrollmentEventType,
} from "@openmail/shared";
import {
  emptyState,
  diffState,
  type EventRow,
} from "../../../worker/src/lib/replay-state-model.js";
import { applyEvent } from "../../../scripts/lib/replay-event-dispatch.js";

function evt(
  partial: Partial<EventRow> & {
    eventType: EnrollmentEventType;
    payload?: Record<string, unknown>;
  },
): EventRow {
  return {
    id: partial.id ?? "eev_test",
    enrollmentId: partial.enrollmentId ?? "eee_x",
    campaignId: partial.campaignId ?? "cmp_x",
    contactId: partial.contactId ?? "con_x",
    workspaceId: partial.workspaceId ?? "ws_x",
    eventType: partial.eventType,
    payloadVersion: partial.payloadVersion ?? 1,
    payload: partial.payload ?? { lifecycle_op_id: "lop_test_xxxxxxxxxxxx" },
    before: partial.before ?? null,
    after: partial.after ?? null,
    eventSeq: partial.eventSeq ?? 1n,
    emittedAt: partial.emittedAt ?? new Date("2026-05-01T00:00:00Z"),
  };
}

describe("Stage 6 — Replay state model", () => {
  test("emptyState initial values", () => {
    const s = emptyState({ enrollmentId: "eee_x" });
    expect(s.enrollmentId).toBe("eee_x");
    expect(s.status).toBe("unknown");
    expect(s.eventsApplied).toBe(0);
    expect(s.warnings).toEqual([]);
  });

  test("happy-path lifecycle reconstruction", () => {
    let s = emptyState({ enrollmentId: "eee_a" });
    s = applyEvent(
      s,
      evt({
        eventType: "enrolled",
        eventSeq: 1n,
        emittedAt: new Date("2026-05-01T00:00:00Z"),
      }),
    );
    expect(s.status).toBe("active");
    expect(s.stepEnteredAt?.toISOString()).toBe("2026-05-01T00:00:00.000Z");

    s = applyEvent(
      s,
      evt({
        eventType: "wait_scheduled",
        eventSeq: 2n,
        payload: {
          lifecycle_op_id: "lop_test_xxxxxxxxxxxx",
          step_id: "stp_1",
          delay_seconds: 86400,
          next_run_at: "2026-05-02T00:00:00Z",
        },
      }),
    );
    expect(s.currentStepId).toBe("stp_1");
    expect(s.nextRunAt?.toISOString()).toBe("2026-05-02T00:00:00.000Z");

    s = applyEvent(
      s,
      evt({
        eventType: "wait_fired",
        eventSeq: 3n,
        payload: {
          lifecycle_op_id: "lop_test_xxxxxxxxxxxx",
          step_id: "stp_1",
        },
      }),
    );
    expect(s.nextRunAt).toBeNull();

    s = applyEvent(
      s,
      evt({
        eventType: "enrollment_completed",
        eventSeq: 4n,
        emittedAt: new Date("2026-05-03T00:00:00Z"),
      }),
    );
    expect(s.status).toBe("completed");
    expect(s.completedAt?.toISOString()).toBe("2026-05-03T00:00:00.000Z");
  });

  test("diffState detects drift on status mismatch", () => {
    const s = emptyState({ enrollmentId: "eee_a" });
    s.status = "active";
    s.completedAt = null;
    const diff = diffState(s, { status: "completed", completedAt: new Date() });
    expect(diff).not.toBeNull();
    expect(diff!.status).toBeDefined();
    expect(diff!.completedAt).toBeDefined();
  });

  test("diffState returns null when state matches", () => {
    const s = emptyState({ enrollmentId: "eee_a" });
    s.status = "active";
    const diff = diffState(s, { status: "active" });
    expect(diff).toBeNull();
  });

  test("redacted payload is treated as opaque (warning, not drift)", () => {
    let s = emptyState({ enrollmentId: "eee_a" });
    s = applyEvent(
      s,
      evt({
        eventType: "enrolled",
        eventSeq: 1n,
      }),
    );
    expect(s.status).toBe("active");
    const beforeWarn = s.warnings.length;

    // Now an event with redacted payload — must not advance state, must warn.
    s = applyEvent(
      s,
      evt({
        eventType: "message_sent",
        eventSeq: 2n,
        payload: {
          redacted: true,
          reason: "gdpr_erasure",
          redacted_at: "2026-05-01T00:00:00Z",
          original_event_type: "message_sent",
        },
      }),
    );
    expect(s.warnings.length).toBeGreaterThan(beforeWarn);
    expect(s.warnings.some((w) => w.includes("redacted"))).toBe(true);
    expect(s.eventsApplied).toBe(1); // only the `enrolled` event counted
  });

  test("invalid payload (schema rejects) → warning + skip", () => {
    let s = emptyState({ enrollmentId: "eee_a" });
    s = applyEvent(
      s,
      evt({
        eventType: "wait_scheduled",
        eventSeq: 1n,
        // Missing required step_id field — wait_scheduled v1 requires it.
        payload: { lifecycle_op_id: "lop_test_xxxxxxxxxxxx" },
      }),
    );
    expect(s.warnings.length).toBeGreaterThan(0);
    expect(s.warnings[0]).toContain("payload validation failed");
    expect(s.eventsApplied).toBe(0);
  });
});

describe("Stage 6 — Payload schemas SSOT", () => {
  test("every event_type in SSOT has a v1 schema", () => {
    const { missing } = assertSchemaCoverage();
    expect(missing).toEqual([]);
  });

  test("getPayloadSchema returns schema for known (type, version)", () => {
    const s = getPayloadSchema("enrolled", 1);
    expect(s).not.toBeNull();
  });

  test("getPayloadSchema returns null for unknown version", () => {
    const s = getPayloadSchema("enrolled", 99);
    expect(s).toBeNull();
  });

  test("isRedactedPayload detects sentinel", () => {
    expect(
      isRedactedPayload({
        redacted: true,
        reason: "gdpr_erasure",
        redacted_at: "x",
        original_event_type: "y",
      }),
    ).toBe(true);
    expect(isRedactedPayload({ lifecycle_op_id: "x" })).toBe(false);
    expect(isRedactedPayload(null)).toBe(false);
  });
});

describe("Stage 6 — Edit-type taxonomy", () => {
  test("CAMPAIGN_EDIT_TYPES covers 7 expected types", () => {
    const expected = [
      "wait_duration_changed",
      "step_inserted",
      "step_deleted",
      "email_template_changed",
      "goal_added",
      "goal_updated",
      "goal_removed",
    ] as const;
    const actual = [...CAMPAIGN_EDIT_TYPES].sort();
    expect(actual).toEqual([...expected].sort());
  });

  test("Stage 6 SSOT events present", () => {
    const required: EnrollmentEventType[] = [
      "audit_drift_detected",
      "events_archived",
      "pii_erased",
      "reconciliation_chunk_progress",
      "reconciled", // already added in Stage 4 but Stage 6 reuses
    ];
    for (const t of required) {
      expect(ENROLLMENT_EVENT_TYPES).toContain(t);
      expect(PAYLOAD_SCHEMAS[`${t}:1`]).toBeDefined();
    }
  });
});
