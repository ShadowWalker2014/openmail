/**
 * Stage 6 — Timeline event-row component (minimal MVP).
 *
 * Renders a single `enrollment_events` row with:
 *   - event-type label
 *   - emitted_at (rendered in user locale, browser timezone)
 *   - actor summary (kind + id)
 *   - expandable payload + before/after diff (collapsed by default)
 *
 * Per the plan, this is the minimal subset: full filter toolbar, CSV/JSON
 * export, icon-per-event-type, and avatar treatments are deferred to a
 * follow-up (documented as a gap in the execution log).
 */
import { useState } from "react";
import type { EnrollmentEventRow } from "@/hooks/use-enrollment-events";

export interface EventRowProps {
  event: EnrollmentEventRow;
}

function formatActor(actor: Record<string, unknown> | null): string {
  if (!actor) return "unknown";
  const kind = String(actor.kind ?? "system");
  switch (kind) {
    case "user":
      return `user:${(actor.userId as string | undefined) ?? "?"}`;
    case "agent_key":
      return `agent_key:${(actor.apiKeyId as string | undefined) ?? "?"}`;
    case "sweeper":
      return `sweeper:${(actor.runId as string | undefined) ?? "?"}`;
    case "migration":
      return `migration:${(actor.name as string | undefined) ?? "?"}`;
    default:
      return kind;
  }
}

export function EventRow({ event }: EventRowProps) {
  const [expanded, setExpanded] = useState(false);
  const isRedacted =
    event.payload &&
    (event.payload as Record<string, unknown>).redacted === true;

  return (
    <div className="flex flex-col gap-1 border-l-2 border-border pl-3 py-2">
      <div className="flex items-center gap-2 text-sm">
        <span className="font-mono font-semibold">{event.event_type}</span>
        {isRedacted && (
          <span
            className="text-xs px-1.5 py-0.5 rounded bg-amber-100 text-amber-900"
            title="Payload redacted (GDPR erasure). Event metadata preserved."
          >
            redacted
          </span>
        )}
        <span className="text-muted-foreground text-xs">
          {new Date(event.emitted_at).toLocaleString()}
        </span>
        <span className="text-muted-foreground text-xs">
          · {formatActor(event.actor)}
        </span>
        {event.event_seq != null && (
          <span className="text-muted-foreground text-xs">
            · seq {event.event_seq}
          </span>
        )}
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="ml-auto text-xs underline text-muted-foreground hover:text-foreground"
        >
          {expanded ? "hide" : "show"} payload
        </button>
      </div>
      {expanded && (
        <pre className="text-xs p-2 rounded bg-muted overflow-auto max-h-64">
          {JSON.stringify(
            {
              payload: event.payload,
              before: event.before,
              after: event.after,
            },
            null,
            2,
          )}
        </pre>
      )}
    </div>
  );
}
