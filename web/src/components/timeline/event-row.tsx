/**
 * Stage 6 — Timeline event-row component.
 *
 * Renders a single `enrollment_events` row with:
 *   - colored icon-per-event-type (32 types mapped in event-icons.ts)
 *   - human label + raw event_type (mono)
 *   - emitted_at in user locale
 *   - actor summary (kind + id) — also acts as an avatar slot via initials
 *   - lifecycle_op_id correlation chip (when present in payload) — clicking
 *     copies it to clipboard for cross-service log-grep
 *   - expandable payload + before/after diff (collapsed by default)
 *   - GDPR "redacted" badge when payload was erased
 */
import { useState } from "react";
import { Copy, Check } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { getEventVisual, colorClasses } from "./event-icons";
import type { EnrollmentEventRow } from "@/hooks/use-enrollment-events";

export interface EventRowProps {
  event: EnrollmentEventRow;
  /** When true, also show the enrollment id (used in campaign-wide view). */
  showEnrollmentId?: boolean;
}

interface ActorSummary {
  kind: string;
  id: string;
  initials: string;
}

function summarizeActor(actor: Record<string, unknown> | null): ActorSummary {
  if (!actor) return { kind: "system", id: "", initials: "SY" };
  const kind = String(actor.kind ?? "system");
  const id =
    (actor.userId as string | undefined) ??
    (actor.apiKeyId as string | undefined) ??
    (actor.runId as string | undefined) ??
    (actor.name as string | undefined) ??
    "";
  const baseForInitials =
    kind === "user" ? "USR" :
    kind === "agent_key" ? "AGT" :
    kind === "sweeper" ? "SWP" :
    kind === "migration" ? "MIG" :
    "SY";
  return { kind, id, initials: baseForInitials };
}

export function EventRow({ event, showEnrollmentId = false }: EventRowProps) {
  const [expanded, setExpanded] = useState(false);
  const [copied, setCopied] = useState(false);
  const visual = getEventVisual(event.event_type);
  const cc = colorClasses(visual.color);
  const Icon = visual.icon;

  const isRedacted =
    event.payload &&
    (event.payload as Record<string, unknown>).redacted === true;
  const opId = String(
    (event.payload as Record<string, unknown> | null)?.lifecycle_op_id ?? "",
  );

  const actor = summarizeActor(event.actor);

  const handleCopyOpId = async (e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      await navigator.clipboard.writeText(opId);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard permission denied; ignore — operator can still expand
      // the payload to read the value.
    }
  };

  return (
    <div
      className={`flex items-start gap-3 border ${cc.border} ${cc.bg} rounded-md p-2`}
    >
      {/* Icon block */}
      <div
        className={`flex-shrink-0 flex items-center justify-center h-8 w-8 rounded ${cc.iconBg} ${cc.text}`}
        aria-hidden
      >
        <Icon className="h-4 w-4" />
      </div>

      {/* Body */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className={`font-semibold text-sm ${cc.text}`}>
            {visual.label}
          </span>
          <span className="font-mono text-[10px] text-muted-foreground">
            {event.event_type}
          </span>
          {isRedacted && (
            <Badge
              variant="outline"
              className="text-[10px] border-amber-400 text-amber-700 dark:text-amber-300"
              title="Payload redacted (GDPR Art. 17 erasure). Event metadata preserved."
            >
              redacted
            </Badge>
          )}
          {event.event_seq != null && (
            <span className="text-[10px] text-muted-foreground font-mono">
              seq {String(event.event_seq)}
            </span>
          )}
          <span className="text-[10px] text-muted-foreground ml-auto whitespace-nowrap">
            {new Date(event.emitted_at).toLocaleString()}
          </span>
        </div>

        <div className="flex items-center gap-2 mt-1 flex-wrap">
          {/* Actor avatar pill */}
          <TooltipProvider delayDuration={150}>
            <Tooltip>
              <TooltipTrigger asChild>
                <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                  <span className="inline-flex items-center justify-center h-4 min-w-4 px-1 rounded bg-muted text-[9px] font-semibold">
                    {actor.initials}
                  </span>
                  <span className="font-mono truncate max-w-[180px]">
                    {actor.id || actor.kind}
                  </span>
                </div>
              </TooltipTrigger>
              <TooltipContent side="bottom">
                <pre className="text-xs whitespace-pre-wrap max-w-xs">
                  {JSON.stringify(event.actor ?? { kind: "system" }, null, 2)}
                </pre>
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>

          {/* lifecycle_op_id correlation chip */}
          {opId && (
            <button
              type="button"
              onClick={handleCopyOpId}
              className="inline-flex items-center gap-1 text-[10px] font-mono text-muted-foreground hover:text-foreground rounded px-1.5 py-0.5 hover:bg-muted"
              title="Click to copy correlation id"
            >
              {copied ? (
                <Check className="h-3 w-3 text-emerald-600" />
              ) : (
                <Copy className="h-3 w-3" />
              )}
              <span className="truncate max-w-[140px]">{opId}</span>
            </button>
          )}

          {/* Cross-enrollment hint when in campaign-wide view */}
          {showEnrollmentId && event.enrollment_id && (
            <span
              className="text-[10px] font-mono text-muted-foreground truncate max-w-[180px]"
              title={`Enrollment ${event.enrollment_id}`}
            >
              · {event.enrollment_id}
            </span>
          )}

          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            className="ml-auto text-[11px] underline text-muted-foreground hover:text-foreground"
          >
            {expanded ? "hide" : "show"} payload
          </button>
        </div>

        {expanded && (
          <pre className="text-[11px] mt-2 p-2 rounded bg-muted/60 overflow-auto max-h-64 font-mono">
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
    </div>
  );
}
