/**
 * Stage 7 follow-up — Reconciliation preview dialog.
 *
 * Wraps a destructive / non-trivial campaign edit (wait-duration change,
 * step deletion, goal addition) with a server-side preview API call that
 * returns the projected impact, then renders a confirmation dialog
 * ("12,847 enrollments are at this step. If you save, 8,200 will fire
 * IMMEDIATELY, …") before the actual save fires.
 *
 * Wire-up:
 *   1. Caller opens the dialog with a `request` describing the proposed
 *      edit (matches the POST /:id/edits/preview body).
 *   2. The dialog fetches the impact, renders it.
 *   3. On "Confirm and save", the dialog invokes the caller-provided
 *      `onConfirm()` callback, which performs the actual save.
 *   4. On "Cancel", nothing happens.
 *
 * The component is decoupled from the save action so the same preview
 * UX works for the existing PATCH step API, the existing DELETE step
 * API, and any future edit endpoint (goal CRUD, etc).
 */
import { useEffect, useState } from "react";
import { Loader2, AlertTriangle, CheckCircle2 } from "lucide-react";
import { useWorkspaceStore } from "@/store/workspace";
import { sessionFetch } from "@/lib/api";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";

// ── Request types — mirror the API's discriminated union ────────────────────

export type PreviewRequest =
  | {
      edit_type: "wait_duration_changed";
      step_id: string;
      new_delay_seconds: number;
      old_delay_seconds?: number;
    }
  | { edit_type: "step_deleted"; step_id: string }
  | { edit_type: "step_inserted" }
  | {
      edit_type: "email_template_changed";
      step_id?: string;
      new_template_id?: string;
    }
  | { edit_type: "goal_added" }
  | { edit_type: "goal_updated" }
  | { edit_type: "goal_removed" };

interface WaitDurationImpact {
  editType: "wait_duration_changed";
  stepId: string;
  oldDelaySeconds: number;
  newDelaySeconds: number;
  totalAffected: number;
  immediate: number;
  staleEligible: number;
  stillWaiting: number;
  resumeDialogThreshold: number;
  staleThresholdSeconds: number;
  recommendedMode: "immediate" | "spread" | "skip_stale_spread";
  sampleEnrollmentIds: string[];
}

interface StepDeletedImpact {
  editType: "step_deleted";
  stepId: string;
  totalAffected: number;
  willAdvance: number;
  sampleEnrollmentIds: string[];
}

interface ZeroImpact {
  editType:
    | "step_inserted"
    | "email_template_changed"
    | "goal_updated"
    | "goal_removed";
  totalAffected: 0;
  reason: string;
}

interface GoalAddedImpact {
  editType: "goal_added";
  totalAffected: number;
  chunkSize: number;
  estimatedChunks: number;
  upperBoundExits: number;
}

type Impact =
  | WaitDurationImpact
  | StepDeletedImpact
  | ZeroImpact
  | GoalAddedImpact;

export interface EditPreviewDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  campaignId: string;
  request: PreviewRequest | null;
  /** Called when the operator confirms. The save itself is the caller's
   *  responsibility — this dialog only previews, never writes. */
  onConfirm: () => void;
  /** Optional human-readable label for the action button. */
  confirmLabel?: string;
  /** When true, the confirm button uses the destructive variant. */
  destructive?: boolean;
}

export function EditPreviewDialog({
  open,
  onOpenChange,
  campaignId,
  request,
  onConfirm,
  confirmLabel = "Confirm and save",
  destructive = false,
}: EditPreviewDialogProps) {
  const workspaceId = useWorkspaceStore((s) => s.activeWorkspaceId);
  const [impact, setImpact] = useState<Impact | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open || !request || !workspaceId) {
      setImpact(null);
      setError(null);
      return;
    }
    setLoading(true);
    setError(null);
    setImpact(null);
    sessionFetch<{ data: Impact }>(
      workspaceId,
      `/campaigns/${campaignId}/edits/preview`,
      {
        method: "POST",
        body: JSON.stringify(request),
      },
    )
      .then((res) => setImpact(res.data))
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));
  }, [open, request, workspaceId, campaignId]);

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent className="max-w-lg">
        <AlertDialogHeader>
          <AlertDialogTitle>Preview impact</AlertDialogTitle>
          <AlertDialogDescription>
            We're showing you what this edit will do <em>before</em> we
            apply it. No changes have been written yet.
          </AlertDialogDescription>
        </AlertDialogHeader>

        <div className="my-2">
          {loading && (
            <div className="flex items-center gap-2 text-sm text-muted-foreground py-4">
              <Loader2 className="h-4 w-4 animate-spin" />
              Computing impact…
            </div>
          )}
          {error && (
            <div className="rounded-md border border-destructive/40 bg-destructive/5 p-3">
              <div className="flex items-center gap-2 text-sm font-semibold text-destructive">
                <AlertTriangle className="h-4 w-4" />
                Could not compute impact
              </div>
              <p className="text-xs text-muted-foreground mt-1">{error}</p>
              <p className="text-xs text-muted-foreground mt-1">
                You can still proceed with the save, but you'll be doing
                so blind.
              </p>
            </div>
          )}
          {impact && <ImpactPanel impact={impact} />}
        </div>

        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction
            onClick={onConfirm}
            className={
              destructive
                ? "bg-destructive text-destructive-foreground hover:bg-destructive/90"
                : undefined
            }
          >
            {confirmLabel}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

// ── Per-edit-type panels ────────────────────────────────────────────────────

function ImpactPanel({ impact }: { impact: Impact }) {
  switch (impact.editType) {
    case "wait_duration_changed":
      return <WaitDurationPanel impact={impact} />;
    case "step_deleted":
      return <StepDeletedPanel impact={impact} />;
    case "goal_added":
      return <GoalAddedPanel impact={impact} />;
    case "step_inserted":
    case "email_template_changed":
    case "goal_updated":
    case "goal_removed":
      return <ZeroImpactPanel impact={impact} />;
  }
}

function WaitDurationPanel({ impact }: { impact: WaitDurationImpact }) {
  const total = impact.totalAffected;
  if (total === 0) {
    return (
      <div className="rounded-md border border-border bg-muted/40 p-3 flex items-center gap-2">
        <CheckCircle2 className="h-4 w-4 text-emerald-600" />
        <p className="text-sm">
          No in-flight enrollments at this step — safe to save.
        </p>
      </div>
    );
  }
  return (
    <div className="space-y-3">
      <div className="rounded-md border border-amber-300 dark:border-amber-800 bg-amber-50/80 dark:bg-amber-950/30 p-3">
        <p className="text-sm font-semibold text-amber-900 dark:text-amber-200">
          {total.toLocaleString()} active enrollment{total === 1 ? "" : "s"} at
          this step
        </p>
        <p className="text-xs text-muted-foreground mt-1">
          Wait duration: {fmtSeconds(impact.oldDelaySeconds)} →{" "}
          <strong>{fmtSeconds(impact.newDelaySeconds)}</strong>
        </p>
      </div>

      <dl className="space-y-1 text-sm">
        <ImpactRow
          label="Fire immediately"
          value={impact.immediate}
          tone={impact.immediate > 0 ? "rose" : "neutral"}
          hint="Already past the new run-time. These will fire on the next worker tick (subject to rate limit)."
        />
        <ImpactRow
          label="Skip-stale eligible"
          value={impact.staleEligible}
          tone={impact.staleEligible > 0 ? "amber" : "neutral"}
          hint={`Run-time is more than ${fmtSeconds(impact.staleThresholdSeconds)} in the past — operator may want to skip these instead of firing.`}
        />
        <ImpactRow
          label="Still waiting"
          value={impact.stillWaiting}
          tone="emerald"
          hint="Run-time is still in the future — wait completes naturally."
        />
      </dl>

      <RecommendationBanner mode={impact.recommendedMode} />
    </div>
  );
}

function StepDeletedPanel({ impact }: { impact: StepDeletedImpact }) {
  const total = impact.totalAffected;
  if (total === 0) {
    return (
      <div className="rounded-md border border-border bg-muted/40 p-3 flex items-center gap-2">
        <CheckCircle2 className="h-4 w-4 text-emerald-600" />
        <p className="text-sm">
          No in-flight enrollments are currently at this step. Safe to delete.
        </p>
      </div>
    );
  }
  return (
    <div className="rounded-md border border-rose-300 dark:border-rose-800 bg-rose-50/80 dark:bg-rose-950/30 p-3">
      <p className="text-sm font-semibold text-rose-900 dark:text-rose-200">
        {total.toLocaleString()} active enrollment
        {total === 1 ? " is" : "s are"} at this step.
      </p>
      <p className="text-xs text-muted-foreground mt-1">
        They will be{" "}
        <strong>force-advanced past the deleted step</strong> when you confirm.
        For email steps, that means the next email will fire (or the campaign
        completes if this is the last step). For wait steps, the wait is
        skipped immediately.
      </p>
    </div>
  );
}

function GoalAddedPanel({ impact }: { impact: GoalAddedImpact }) {
  return (
    <div className="rounded-md border border-violet-300 dark:border-violet-800 bg-violet-50/80 dark:bg-violet-950/30 p-3 space-y-2">
      <p className="text-sm font-semibold text-violet-900 dark:text-violet-200">
        {impact.totalAffected.toLocaleString()} active enrollment
        {impact.totalAffected === 1 ? "" : "s"} will be re-evaluated
      </p>
      <p className="text-xs text-muted-foreground">
        Up to {impact.upperBoundExits.toLocaleString()} may exit early if they
        match the new goal. Reconciliation runs in {impact.estimatedChunks}{" "}
        background chunk{impact.estimatedChunks === 1 ? "" : "s"} of{" "}
        {impact.chunkSize.toLocaleString()} enrollments each.
      </p>
    </div>
  );
}

function ZeroImpactPanel({ impact }: { impact: ZeroImpact }) {
  return (
    <div className="rounded-md border border-border bg-muted/40 p-3 flex items-start gap-2">
      <CheckCircle2 className="h-4 w-4 text-emerald-600 mt-0.5 shrink-0" />
      <div>
        <p className="text-sm font-semibold">No in-flight reconciliation needed</p>
        <p className="text-xs text-muted-foreground mt-1">{impact.reason}</p>
      </div>
    </div>
  );
}

// ── Sub-components ──────────────────────────────────────────────────────────

function ImpactRow({
  label,
  value,
  tone,
  hint,
}: {
  label: string;
  value: number;
  tone: "rose" | "amber" | "emerald" | "neutral";
  hint?: string;
}) {
  const toneClasses: Record<typeof tone, string> = {
    rose: "text-rose-700 dark:text-rose-300",
    amber: "text-amber-700 dark:text-amber-300",
    emerald: "text-emerald-700 dark:text-emerald-300",
    neutral: "text-muted-foreground",
  };
  return (
    <div className="flex items-baseline justify-between gap-2 py-1">
      <div className="min-w-0">
        <dt className="text-sm">{label}</dt>
        {hint && (
          <p className="text-[11px] text-muted-foreground leading-tight">
            {hint}
          </p>
        )}
      </div>
      <dd className={`text-base font-mono font-semibold ${toneClasses[tone]}`}>
        {value.toLocaleString()}
      </dd>
    </div>
  );
}

function RecommendationBanner({
  mode,
}: {
  mode: WaitDurationImpact["recommendedMode"];
}) {
  const text: Record<typeof mode, string> = {
    immediate:
      "All affected enrollments will fire on the next tick. Default mode is fine.",
    spread:
      "Many enrollments would fire at once. Consider using spread mode at resume time to protect sender reputation.",
    skip_stale_spread:
      "Some enrollments are stale (their new run-time is far in the past). Consider skip-stale + spread to avoid sending old emails AND protect sender reputation.",
  };
  const tone =
    mode === "immediate"
      ? "border-emerald-300 dark:border-emerald-800 bg-emerald-50/80 dark:bg-emerald-950/30"
      : "border-amber-300 dark:border-amber-800 bg-amber-50/80 dark:bg-amber-950/30";
  return (
    <div className={`rounded-md border p-3 text-xs ${tone}`}>
      <Badge variant="outline" className="mb-1">
        Recommendation: {mode}
      </Badge>
      <p className="text-muted-foreground">{text[mode]}</p>
    </div>
  );
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function fmtSeconds(s: number): string {
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.round(s / 60)}m`;
  if (s < 86400) {
    const h = s / 3600;
    return Number.isInteger(h) ? `${h}h` : `${h.toFixed(1)}h`;
  }
  if (s < 7 * 86400) {
    const d = s / 86400;
    return Number.isInteger(d) ? `${d}d` : `${d.toFixed(1)}d`;
  }
  const w = s / (7 * 86400);
  return Number.isInteger(w) ? `${w}w` : `${w.toFixed(1)}w`;
}
