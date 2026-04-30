/**
 * Stage 6 (UI follow-up) — State snapshot panel for time-travel debugging.
 *
 * Renders a `ReplayState` (reconstructed by folding events through the pure
 * dispatcher) as a compact two-column field list. Field colors highlight
 * "interesting" terminal/transient states so an operator scrubbing through
 * history can spot transitions visually:
 *
 *   - status: colored badge per known enrollment status
 *   - timestamps: rendered in user locale
 *   - completedViaGoalId / spreadToken / forceExitedAt: amber/rose hints
 *   - warnings: rendered as a small warning chip when the dispatcher
 *     skipped events (redacted payloads, unknown payload version)
 *
 * The field set is exactly what `diffState()` compares — so what the operator
 * sees here is what the CLI replay tool's drift report would compare against
 * the live row.
 */
import { Badge } from "@/components/ui/badge";
import { CircleDot, AlertTriangle } from "lucide-react";
import type { ReplayState } from "../../../../worker/src/lib/replay-state-model";

export interface StateSnapshotProps {
  state: ReplayState;
  /** When provided, a small caption above the snapshot. */
  caption?: string;
}

const STATUS_COLOR: Record<string, string> = {
  active:
    "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300",
  paused:
    "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300",
  stopping:
    "bg-rose-100 text-rose-800 dark:bg-rose-900/40 dark:text-rose-300",
  stopped:
    "bg-rose-100 text-rose-800 dark:bg-rose-900/40 dark:text-rose-300",
  archived:
    "bg-slate-100 text-slate-800 dark:bg-slate-900/40 dark:text-slate-300",
  completed:
    "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300",
  failed:
    "bg-rose-100 text-rose-800 dark:bg-rose-900/40 dark:text-rose-300",
  unknown:
    "bg-slate-100 text-slate-700 dark:bg-slate-900/40 dark:text-slate-400",
};

function ts(d: Date | null): string {
  return d ? new Date(d).toLocaleString() : "—";
}

function val(v: unknown): string {
  if (v == null) return "—";
  if (typeof v === "string") return v;
  return String(v);
}

export function StateSnapshot({ state, caption }: StateSnapshotProps) {
  const statusClass = STATUS_COLOR[state.status] ?? STATUS_COLOR.unknown;

  // Field rows. Order mirrors `diffState()` field traversal so the operator
  // sees fields in the same order drift reports use.
  const fields: Array<{ label: string; value: React.ReactNode; tone?: "amber" | "rose" }> = [
    {
      label: "status",
      value: (
        <span
          className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-mono ${statusClass}`}
        >
          <CircleDot className="h-3 w-3" />
          {state.status}
        </span>
      ),
    },
    { label: "currentStepId", value: <code className="text-xs">{val(state.currentStepId)}</code> },
    { label: "stepEnteredAt", value: <span className="text-xs">{ts(state.stepEnteredAt)}</span> },
    { label: "nextRunAt", value: <span className="text-xs">{ts(state.nextRunAt)}</span> },
    {
      label: "pausedAt",
      value: <span className="text-xs">{ts(state.pausedAt)}</span>,
      tone: state.pausedAt ? "amber" : undefined,
    },
    {
      label: "stepHeldAt",
      value: <span className="text-xs">{ts(state.stepHeldAt)}</span>,
      tone: state.stepHeldAt ? "amber" : undefined,
    },
    {
      label: "spreadToken",
      value: <code className="text-xs">{val(state.spreadToken)}</code>,
      tone: state.spreadToken ? "amber" : undefined,
    },
    {
      label: "staleSkippedAt",
      value: <span className="text-xs">{ts(state.staleSkippedAt)}</span>,
      tone: state.staleSkippedAt ? "amber" : undefined,
    },
    {
      label: "forceExitedAt",
      value: <span className="text-xs">{ts(state.forceExitedAt)}</span>,
      tone: state.forceExitedAt ? "rose" : undefined,
    },
    { label: "completedAt", value: <span className="text-xs">{ts(state.completedAt)}</span> },
    {
      label: "completedViaGoalId",
      value: <code className="text-xs">{val(state.completedViaGoalId)}</code>,
    },
    { label: "eventsApplied", value: <span className="text-xs font-mono">{state.eventsApplied}</span> },
  ];

  return (
    <div className="border border-border rounded-md bg-card">
      {caption && (
        <div className="px-3 py-2 border-b border-border text-xs font-semibold text-muted-foreground">
          {caption}
        </div>
      )}
      <dl className="divide-y divide-border">
        {fields.map((f) => (
          <div
            key={f.label}
            className={`flex items-center gap-2 px-3 py-1.5 text-xs ${
              f.tone === "rose"
                ? "bg-rose-50/50 dark:bg-rose-950/20"
                : f.tone === "amber"
                ? "bg-amber-50/50 dark:bg-amber-950/20"
                : ""
            }`}
          >
            <dt className="font-mono text-muted-foreground w-[140px] flex-shrink-0">
              {f.label}
            </dt>
            <dd className="flex-1 min-w-0 truncate">{f.value}</dd>
          </div>
        ))}
      </dl>
      {state.warnings.length > 0 && (
        <div className="px-3 py-2 border-t border-border bg-amber-50/60 dark:bg-amber-950/30">
          <div className="flex items-center gap-1 text-xs font-semibold text-amber-700 dark:text-amber-300 mb-1">
            <AlertTriangle className="h-3 w-3" />
            {state.warnings.length} replay warning
            {state.warnings.length === 1 ? "" : "s"}
          </div>
          <ul className="space-y-0.5">
            {state.warnings.slice(0, 5).map((w, i) => (
              <li key={i} className="text-[11px] text-muted-foreground font-mono">
                · {w}
              </li>
            ))}
            {state.warnings.length > 5 && (
              <li className="text-[11px] text-muted-foreground">
                + {state.warnings.length - 5} more
              </li>
            )}
          </ul>
        </div>
      )}
    </div>
  );
}

/**
 * Compact two-column "delta" view: shows two snapshots side by side,
 * highlighting fields that differ. Used by the time-travel mode to show
 * before/after for the currently-focused event.
 */
export function StateDelta({
  before,
  after,
  caption,
}: {
  before: ReplayState;
  after: ReplayState;
  caption?: string;
}) {
  const showField = (k: keyof ReplayState): boolean => {
    if (k === "warnings" || k === "eventsApplied") return false;
    if (k === "enrollmentId" || k === "campaignId" || k === "workspaceId") return false;
    return before[k] !== after[k];
  };
  const fields = (Object.keys(after) as Array<keyof ReplayState>).filter(showField);

  return (
    <div className="border border-border rounded-md bg-card">
      {caption && (
        <div className="px-3 py-2 border-b border-border text-xs font-semibold text-muted-foreground">
          {caption}
        </div>
      )}
      {fields.length === 0 ? (
        <div className="p-3 text-xs text-muted-foreground italic">
          No state changes.
        </div>
      ) : (
        <table className="w-full text-xs">
          <thead className="text-muted-foreground bg-muted/40">
            <tr>
              <th className="text-left px-3 py-1 font-mono">field</th>
              <th className="text-left px-2 py-1">before</th>
              <th className="text-left px-2 py-1">after</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {fields.map((k) => (
              <tr key={String(k)}>
                <td className="font-mono px-3 py-1 text-muted-foreground">
                  {String(k)}
                </td>
                <td className="px-2 py-1 truncate max-w-[160px]">
                  <code className="text-[11px]">{val(before[k])}</code>
                </td>
                <td className="px-2 py-1 truncate max-w-[160px]">
                  <code className="text-[11px] font-semibold">{val(after[k])}</code>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
