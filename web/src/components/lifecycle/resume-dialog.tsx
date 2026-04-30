/**
 * Resume campaign dialog (Stage 3 — T11, REQ-11, REQ-13, CR-05).
 *
 * Triggered when a paused campaign is resumed AND the workspace's overdue
 * count exceeds `resume_dialog_threshold`. Shows the operator four cards
 * with informed-decision context:
 *
 *   1. Send all immediately   (DANGEROUS for >24h pauses)
 *   2. Spread over window     (RECOMMENDED — slider for 1h/4h/12h/24h/72h/7d)
 *   3. Skip stale + spread    (preset: 7d threshold + 4h spread)
 *   4. Skip ALL overdue       (advance every overdue enrollment without sending)
 *
 * Live count source: ElectricSQL-synced `campaign_enrollments` table — count
 * derived client-side. Initial count fetched from
 * `GET /campaigns/:id/overdue-count` for fast first paint.
 */

import { useEffect, useMemo, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { Zap, Clock, Trash2, ShieldCheck, AlertTriangle } from "lucide-react";

export type ResumeMode =
  | "immediate"
  | "spread"
  | "skip_stale"
  | "skip_stale_spread";

export type ResumeDialogPayload =
  | { mode: "immediate" }
  | { mode: "spread"; spread_window_seconds: number }
  | { mode: "skip_stale"; stale_threshold_seconds: number }
  | {
      mode: "skip_stale_spread";
      spread_window_seconds: number;
      stale_threshold_seconds: number;
    };

interface ResumeDialogProps {
  open: boolean;
  campaignName: string;
  /** Initial overdue count from REST endpoint (fast first paint). */
  initialOverdueCount: number;
  /** Live count override from ElectricSQL sync. Falls back to initial. */
  liveOverdueCount?: number;
  /** Workspace defaults (from /lifecycle-settings). */
  defaultSpreadWindowSeconds?: number;
  defaultStaleThresholdSeconds?: number;
  onOpenChange: (open: boolean) => void;
  onConfirm: (payload: ResumeDialogPayload) => void;
  loading?: boolean;
}

const SPREAD_WINDOW_PRESETS: Array<{ label: string; value: number }> = [
  { label: "1 hour", value: 3600 },
  { label: "4 hours", value: 14400 },
  { label: "12 hours", value: 43200 },
  { label: "24 hours", value: 86400 },
  { label: "3 days", value: 259200 },
  { label: "7 days", value: 604800 },
];

export function ResumeDialog({
  open,
  campaignName,
  initialOverdueCount,
  liveOverdueCount,
  defaultSpreadWindowSeconds = 14400,
  defaultStaleThresholdSeconds = 604800,
  onOpenChange,
  onConfirm,
  loading,
}: ResumeDialogProps) {
  const [mode, setMode] = useState<ResumeMode>("spread");
  const [spreadWindowSeconds, setSpreadWindowSeconds] = useState<number>(
    defaultSpreadWindowSeconds,
  );

  useEffect(() => {
    setSpreadWindowSeconds(defaultSpreadWindowSeconds);
  }, [defaultSpreadWindowSeconds]);

  const overdueCount = liveOverdueCount ?? initialOverdueCount;

  const sendsPerMin = useMemo(() => {
    if (mode !== "spread" && mode !== "skip_stale_spread") return null;
    if (overdueCount <= 0 || spreadWindowSeconds <= 0) return 0;
    return ((overdueCount / spreadWindowSeconds) * 60).toFixed(1);
  }, [mode, overdueCount, spreadWindowSeconds]);

  function handleConfirm() {
    if (mode === "immediate") {
      onConfirm({ mode: "immediate" });
    } else if (mode === "spread") {
      onConfirm({ mode: "spread", spread_window_seconds: spreadWindowSeconds });
    } else if (mode === "skip_stale") {
      onConfirm({
        mode: "skip_stale",
        stale_threshold_seconds: defaultStaleThresholdSeconds,
      });
    } else {
      onConfirm({
        mode: "skip_stale_spread",
        spread_window_seconds: spreadWindowSeconds,
        stale_threshold_seconds: defaultStaleThresholdSeconds,
      });
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[640px]">
        <DialogHeader>
          <DialogTitle>Resume campaign</DialogTitle>
          <DialogDescription>
            <strong className="text-foreground font-medium">
              {campaignName}
            </strong>{" "}
            has{" "}
            <strong className="text-foreground font-medium">
              {overdueCount.toLocaleString()}
            </strong>{" "}
            overdue enrollment{overdueCount === 1 ? "" : "s"} ready to send.
            Choose how to resume.
          </DialogDescription>
        </DialogHeader>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {/* Immediate (dangerous) */}
          <button
            type="button"
            onClick={() => setMode("immediate")}
            className={cn(
              "flex flex-col gap-1.5 rounded-lg border p-3.5 text-left transition-colors cursor-pointer",
              mode === "immediate"
                ? "border-destructive bg-destructive/8"
                : "border-border hover:bg-accent/50",
            )}
          >
            <div className="flex items-center gap-2">
              <Zap className="h-3.5 w-3.5 text-destructive" />
              <span className="text-[13px] font-medium text-destructive">
                Send all immediately
              </span>
            </div>
            <p className="text-[12px] text-muted-foreground">
              All {overdueCount.toLocaleString()} sends fire at once. May spike
              to thousands of emails per minute. Use only for short pauses.
            </p>
          </button>

          {/* Spread (recommended) */}
          <button
            type="button"
            onClick={() => setMode("spread")}
            className={cn(
              "flex flex-col gap-1.5 rounded-lg border p-3.5 text-left transition-colors cursor-pointer",
              mode === "spread"
                ? "border-foreground bg-accent"
                : "border-border hover:bg-accent/50",
            )}
          >
            <div className="flex items-center gap-2">
              <Clock className="h-3.5 w-3.5" />
              <span className="text-[13px] font-medium">
                Spread (recommended)
              </span>
            </div>
            <p className="text-[12px] text-muted-foreground">
              Distribute overdue sends evenly across the chosen window. Burst
              mitigation with rate-limit-aware spacing.
            </p>
          </button>

          {/* Skip stale + spread */}
          <button
            type="button"
            onClick={() => setMode("skip_stale_spread")}
            className={cn(
              "flex flex-col gap-1.5 rounded-lg border p-3.5 text-left transition-colors cursor-pointer",
              mode === "skip_stale_spread"
                ? "border-foreground bg-accent"
                : "border-border hover:bg-accent/50",
            )}
          >
            <div className="flex items-center gap-2">
              <ShieldCheck className="h-3.5 w-3.5" />
              <span className="text-[13px] font-medium">
                Skip stale + spread
              </span>
            </div>
            <p className="text-[12px] text-muted-foreground">
              Drop sends scheduled longer than{" "}
              {(defaultStaleThresholdSeconds / 86400).toFixed(0)}d ago, then
              spread the rest. Best for very long pauses.
            </p>
          </button>

          {/* Skip ALL overdue */}
          <button
            type="button"
            onClick={() => setMode("skip_stale")}
            className={cn(
              "flex flex-col gap-1.5 rounded-lg border p-3.5 text-left transition-colors cursor-pointer",
              mode === "skip_stale"
                ? "border-foreground bg-accent"
                : "border-border hover:bg-accent/50",
            )}
          >
            <div className="flex items-center gap-2">
              <Trash2 className="h-3.5 w-3.5" />
              <span className="text-[13px] font-medium">
                Skip ALL overdue
              </span>
            </div>
            <p className="text-[12px] text-muted-foreground">
              Drop every overdue send. Enrollments advance to the next step
              without firing the missed message.
            </p>
          </button>
        </div>

        {/* Window picker — only for spread modes */}
        {(mode === "spread" || mode === "skip_stale_spread") && (
          <div className="mt-1 space-y-2">
            <label className="text-[12px] font-medium">Spread window</label>
            <Select
              value={String(spreadWindowSeconds)}
              onValueChange={(v) => setSpreadWindowSeconds(Number(v))}
            >
              <SelectTrigger className="max-w-[240px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {SPREAD_WINDOW_PRESETS.map((p) => (
                  <SelectItem key={p.value} value={String(p.value)}>
                    {p.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {sendsPerMin !== null && (
              <p className="text-[11px] text-muted-foreground">
                ≈ {sendsPerMin} sends/min
              </p>
            )}
          </div>
        )}

        {mode === "immediate" && overdueCount > 100 && (
          <div className="flex items-start gap-2 rounded-lg border border-destructive/40 bg-destructive/8 px-3 py-2 text-[12px]">
            <AlertTriangle className="h-3.5 w-3.5 mt-0.5 shrink-0 text-destructive" />
            <p>
              ⚠️ {overdueCount.toLocaleString()} sends in &lt;1 minute may
              trigger Resend rate limits and recipient inbox alarms. Strongly
              consider Spread mode.
            </p>
          </div>
        )}

        <DialogFooter>
          <Button
            variant="outline"
            size="sm"
            onClick={() => onOpenChange(false)}
            disabled={loading}
          >
            Cancel
          </Button>
          <Button
            size="sm"
            variant={mode === "immediate" ? "destructive" : "default"}
            onClick={handleConfirm}
            disabled={loading}
          >
            {loading ? "Resuming…" : "Resume"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
