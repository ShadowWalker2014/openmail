/**
 * Goal evaluator (Stage 5 — T5, REQ-03..REQ-06).
 *
 * Pure functions over goal config + contact + (event optionally). Returns the
 * first matching goal if any. OR semantics across goals on a campaign — once
 * one matches, the enrollment exits via that goal_id (PRD: position is for
 * display only, not short-circuiting).
 *
 * Three condition types (CN-04 — bounded queries):
 * - `event`     — single SQL probe against `events` table for a name/property
 *                  match since `enrollment.startedAt` (CN-01 — never matches
 *                  pre-enrollment events). When the caller passes a
 *                  `triggeringEvent` (reactive path — Task 8) we short-circuit
 *                  and check it directly without touching the DB.
 * - `attribute` — read `contacts.attributes` JSONB once (caller passes the
 *                  contact row) and apply operator/value comparison. No DB
 *                  query inside this evaluator.
 * - `segment`   — delegate to existing `contactMatchesSegment(contactId, segmentId)`
 *                  which is already optimised for single-contact membership
 *                  checks (one SQL EXISTS query).
 *
 * Skip rules (CR-13):
 * - `enrollment.forceExitedAt IS NOT NULL` → skip eval entirely. Force-exit
 *   precedes goal_achieved on race; the enrollment is already terminal and
 *   evaluating goals would just emit a redundant terminal event.
 *
 * Error handling (CR-06, [DB-06]):
 * - Per-goal try/catch. A throw on one goal does NOT poison the rest — the
 *   caller still gets to evaluate remaining goals. The first thrown error is
 *   surfaced via `evaluationError` so the caller can emit a single
 *   `goal_evaluation_error` audit event without N error rows per malformed
 *   goal. Subsequent throws are logged-only.
 */
import { sql, eq, and, gte } from "drizzle-orm";
import { getDb } from "@openmail/shared/db";
import { events, contacts as contactsTable } from "@openmail/shared/schema";
import type { CampaignGoal } from "@openmail/shared";
import { contactMatchesSegment } from "./segment-evaluator.js";
import { logger } from "./logger.js";

// ── Public types ─────────────────────────────────────────────────────────────

/** Minimal enrollment shape required for goal evaluation. */
export interface EvaluatorEnrollment {
  id: string;
  campaignId: string;
  contactId: string;
  workspaceId: string;
  startedAt: Date;
  /** CR-13 — force-exit precedes goal_achieved on race. */
  forceExitedAt: Date | null;
}

/** Minimal contact shape. `attributes` is JSONB (any object or null). */
export interface EvaluatorContact {
  id: string;
  attributes: Record<string, unknown> | null;
}

/** Optional triggering event (reactive path — Task 8). */
export interface EvaluatorTriggerEvent {
  name: string;
  properties: Record<string, unknown> | null;
  occurredAt: Date;
}

export type GoalConditionConfig =
  | {
      type: "event";
      eventName: string;
      propertyFilter?: Record<string, unknown>;
      sinceEnrollment?: boolean;
    }
  | {
      type: "attribute";
      attributeKey: string;
      operator: "eq" | "neq" | "gt" | "lt" | "contains" | "exists";
      value?: unknown;
    }
  | {
      type: "segment";
      segmentId: string;
      requireMembership?: boolean;
    };

export interface EvaluateGoalsResult {
  achieved: boolean;
  goalId?: string;
  matchType?: CampaignGoal["conditionType"];
  /** What the goal matched on — embedded in `goal_achieved` audit payload. */
  matchPayload?: Record<string, unknown>;
  /**
   * If a goal threw during eval, surfaced here (CR-06). Caller should emit a
   * single `goal_evaluation_error` audit event. Other goals are still
   * evaluated.
   */
  evaluationError?: { goalId: string; message: string };
}

// ── Per-condition-type evaluators ────────────────────────────────────────────

function matchesPropertyFilter(
  actual: Record<string, unknown> | null,
  filter: Record<string, unknown> | undefined,
): boolean {
  if (!filter || Object.keys(filter).length === 0) return true;
  if (!actual) return false;
  for (const [key, expected] of Object.entries(filter)) {
    if (actual[key] !== expected) return false;
  }
  return true;
}

async function evaluateEventGoal(
  enrollment: EvaluatorEnrollment,
  config: Extract<GoalConditionConfig, { type: "event" }>,
  trigger: EvaluatorTriggerEvent | undefined,
): Promise<{ matched: boolean; matchPayload?: Record<string, unknown> }> {
  // Reactive path: caller supplied the just-processed event. Avoids a DB query.
  if (trigger) {
    if (trigger.name !== config.eventName) return { matched: false };
    // CN-01: never match pre-enrollment events.
    if (trigger.occurredAt < enrollment.startedAt) return { matched: false };
    if (!matchesPropertyFilter(trigger.properties, config.propertyFilter)) {
      return { matched: false };
    }
    return {
      matched: true,
      matchPayload: {
        event_name: config.eventName,
        event_occurred_at: trigger.occurredAt.toISOString(),
        property_filter: config.propertyFilter ?? null,
      },
    };
  }

  // Proactive path (Task 7 — step-advance): query events table.
  const db = getDb();
  const sinceEnrollment = config.sinceEnrollment ?? true;
  const since = sinceEnrollment ? enrollment.startedAt : new Date(0);

  // Bounded query: contact_id + event name + occurred_at >= since. Indexes
  // on (workspace_id, name) and (contact_id) make this O(log n).
  const conditions = [
    eq(events.workspaceId, enrollment.workspaceId),
    eq(events.contactId, enrollment.contactId),
    eq(events.name, config.eventName),
    gte(events.occurredAt, since),
  ];

  const baseQuery = db
    .select({ id: events.id, properties: events.properties, occurredAt: events.occurredAt })
    .from(events)
    .where(and(...conditions))
    .limit(config.propertyFilter ? 50 : 1);

  const rows = await baseQuery;
  if (rows.length === 0) return { matched: false };

  // If no property filter, the first row's existence is enough.
  if (!config.propertyFilter) {
    const hit = rows[0];
    return {
      matched: true,
      matchPayload: {
        event_id: hit.id,
        event_name: config.eventName,
        event_occurred_at: hit.occurredAt.toISOString(),
      },
    };
  }

  for (const row of rows) {
    const props = (row.properties as Record<string, unknown> | null) ?? null;
    if (matchesPropertyFilter(props, config.propertyFilter)) {
      return {
        matched: true,
        matchPayload: {
          event_id: row.id,
          event_name: config.eventName,
          event_occurred_at: row.occurredAt.toISOString(),
          property_filter: config.propertyFilter,
        },
      };
    }
  }

  return { matched: false };
}

function evaluateAttributeGoal(
  contact: EvaluatorContact,
  config: Extract<GoalConditionConfig, { type: "attribute" }>,
): { matched: boolean; matchPayload?: Record<string, unknown> } {
  const attrs = contact.attributes ?? {};
  const has = Object.prototype.hasOwnProperty.call(attrs, config.attributeKey);
  const actual = has ? attrs[config.attributeKey] : undefined;

  let matched = false;
  switch (config.operator) {
    case "exists":
      matched = has;
      break;
    case "eq":
      matched = actual === config.value;
      break;
    case "neq":
      matched = has && actual !== config.value;
      break;
    case "gt":
      matched =
        typeof actual === "number" &&
        typeof config.value === "number" &&
        actual > config.value;
      break;
    case "lt":
      matched =
        typeof actual === "number" &&
        typeof config.value === "number" &&
        actual < config.value;
      break;
    case "contains":
      matched =
        typeof actual === "string" &&
        typeof config.value === "string" &&
        actual.includes(config.value);
      break;
    default:
      // Unknown operator — fail closed.
      matched = false;
  }

  return {
    matched,
    matchPayload: matched
      ? {
          attribute_key: config.attributeKey,
          operator: config.operator,
          // Don't echo full PII payload; we record just the operator + key.
        }
      : undefined,
  };
}

async function evaluateSegmentGoal(
  contactId: string,
  config: Extract<GoalConditionConfig, { type: "segment" }>,
): Promise<{ matched: boolean; matchPayload?: Record<string, unknown> }> {
  const requireMembership = config.requireMembership ?? true;
  const isMember = await contactMatchesSegment(contactId, config.segmentId);
  const matched = requireMembership ? isMember : !isMember;
  return {
    matched,
    matchPayload: matched
      ? {
          segment_id: config.segmentId,
          require_membership: requireMembership,
        }
      : undefined,
  };
}

// ── Helpers: parse + dispatch ────────────────────────────────────────────────

function parseConfig(goal: CampaignGoal): GoalConditionConfig {
  // The DB stores condition_type and condition_config separately; we lift them
  // into a single discriminated union here so downstream code can pattern-match.
  const cfg = (goal.conditionConfig ?? {}) as Record<string, unknown>;
  switch (goal.conditionType) {
    case "event":
      return {
        type: "event",
        eventName: String(cfg.eventName ?? ""),
        propertyFilter: cfg.propertyFilter as Record<string, unknown> | undefined,
        sinceEnrollment: cfg.sinceEnrollment as boolean | undefined,
      };
    case "attribute":
      return {
        type: "attribute",
        attributeKey: String(cfg.attributeKey ?? ""),
        operator: (cfg.operator ?? "eq") as Extract<
          GoalConditionConfig,
          { type: "attribute" }
        >["operator"],
        value: cfg.value,
      };
    case "segment":
      return {
        type: "segment",
        segmentId: String(cfg.segmentId ?? ""),
        requireMembership: cfg.requireMembership as boolean | undefined,
      };
    default:
      throw new Error(`Unknown goal condition_type: ${goal.conditionType}`);
  }
}

// ── Public API ───────────────────────────────────────────────────────────────

/**
 * Evaluate a list of goals against an enrollment + contact. OR semantics —
 * returns first match. Skips disabled goals.
 *
 * @param enrollment       The enrollment to evaluate (CR-13: skip if force-exited).
 * @param contact          Pre-loaded contact (caller batch-loads to avoid N+1).
 * @param goals            All campaign goals (caller filters by campaignId).
 * @param triggeringEvent  Optional — reactive path (Task 8). When present,
 *                         event-type goals consult this event directly rather
 *                         than querying the events table.
 */
export async function evaluateGoals(
  enrollment: EvaluatorEnrollment,
  contact: EvaluatorContact,
  goals: CampaignGoal[],
  triggeringEvent?: EvaluatorTriggerEvent,
): Promise<EvaluateGoalsResult> {
  // CR-13: skip eval entirely if enrollment is force-exited.
  if (enrollment.forceExitedAt !== null) {
    return { achieved: false };
  }

  let evaluationError: EvaluateGoalsResult["evaluationError"];

  for (const goal of goals) {
    if (!goal.enabled) continue;

    try {
      const config = parseConfig(goal);
      let outcome: { matched: boolean; matchPayload?: Record<string, unknown> };

      switch (config.type) {
        case "event":
          outcome = await evaluateEventGoal(enrollment, config, triggeringEvent);
          break;
        case "attribute":
          outcome = evaluateAttributeGoal(contact, config);
          break;
        case "segment":
          outcome = await evaluateSegmentGoal(contact.id, config);
          break;
      }

      if (outcome.matched) {
        return {
          achieved: true,
          goalId: goal.id,
          matchType: goal.conditionType,
          matchPayload: outcome.matchPayload,
          evaluationError,
        };
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.warn(
        { goalId: goal.id, campaignId: goal.campaignId, err: message },
        "goal-evaluator: throw on goal — continuing other goals (CR-06)",
      );
      // First error wins — caller emits one audit event regardless of how
      // many goals threw.
      if (!evaluationError) {
        evaluationError = { goalId: goal.id, message };
      }
    }
  }

  return { achieved: false, evaluationError };
}

/**
 * Helper: load a contact's evaluator-shape row in one query. Used by Task 7
 * + Task 8 to avoid passing full Drizzle row types through the evaluator.
 */
export async function loadEvaluatorContact(
  contactId: string,
): Promise<EvaluatorContact | null> {
  const db = getDb();
  const [row] = await db
    .select({
      id: contactsTable.id,
      attributes: contactsTable.attributes,
    })
    .from(contactsTable)
    .where(eq(contactsTable.id, contactId))
    .limit(1);
  if (!row) return null;
  return {
    id: row.id,
    attributes: (row.attributes as Record<string, unknown> | null) ?? null,
  };
}

// Internal export for tests — keeps `parseConfig` reachable without polluting
// the public surface.
export const __test__ = { parseConfig };
// Silence "imported but unused" until call-site adopters land.
void sql;
