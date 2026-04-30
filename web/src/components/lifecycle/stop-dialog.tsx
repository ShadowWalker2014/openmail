/**
 * Stop campaign dialog (Stage 2 — T18, REQ-19, [V2.12]).
 *
 * Two-card chooser: drain (recommended) vs. force (destructive). Confirm submits
 * `{ mode: "drain" }` or `{ mode: "force", confirm_force: true }` to the new
 * POST /:id/stop endpoint via the parent's `onConfirm` callback.
 *
 * [V2.12] Held-during-drain warning: Stage 2 has no held enrollments yet
 * (Stage 4 introduces step-pause), so the warning is stubbed but rendered when
 * `heldCount > 0`. Stage 4 will populate `heldCount` from ElectricSQL-synced
 * enrollment data.
 */

import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { Pause, Zap, AlertTriangle } from "lucide-react";

export type StopMode = "drain" | "force";

export type StopDialogPayload =
  | { mode: "drain" }
  | { mode: "force"; confirm_force: true };

interface StopDialogProps {
  open: boolean;
  campaignName: string;
  /**
   * Stage 4 will populate this from synced enrollment data — count of
   * enrollments held at a paused step. Stage 2 always passes 0.
   */
  heldCount?: number;
  onOpenChange: (open: boolean) => void;
  onConfirm: (payload: StopDialogPayload) => void;
  loading?: boolean;
}

export function StopDialog({
  open,
  campaignName,
  heldCount = 0,
  onOpenChange,
  onConfirm,
  loading,
}: StopDialogProps) {
  const [mode, setMode] = useState<StopMode>("drain");

  function handleConfirm() {
    if (mode === "force") {
      onConfirm({ mode: "force", confirm_force: true });
    } else {
      onConfirm({ mode: "drain" });
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[560px]">
        <DialogHeader>
          <DialogTitle>Stop campaign</DialogTitle>
          <DialogDescription>
            Choose how to stop <strong className="text-foreground font-medium">{campaignName}</strong>.
          </DialogDescription>
        </DialogHeader>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {/* Drain card */}
          <button
            type="button"
            onClick={() => setMode("drain")}
            className={cn(
              "flex flex-col gap-1.5 rounded-lg border p-3.5 text-left transition-colors cursor-pointer",
              mode === "drain"
                ? "border-foreground bg-accent"
                : "border-border hover:bg-accent/50",
            )}
          >
            <div className="flex items-center gap-2">
              <Pause className="h-3.5 w-3.5" />
              <span className="text-[13px] font-medium">Drain (recommended)</span>
            </div>
            <p className="text-[12px] text-muted-foreground">
              Stop new enrollments. Let in-flight wait jobs finish naturally.
              Background sweeper marks the campaign stopped once empty.
            </p>
          </button>

          {/* Force card */}
          <button
            type="button"
            onClick={() => setMode("force")}
            className={cn(
              "flex flex-col gap-1.5 rounded-lg border p-3.5 text-left transition-colors cursor-pointer",
              mode === "force"
                ? "border-destructive bg-destructive/8"
                : "border-border hover:bg-accent/50",
            )}
          >
            <div className="flex items-center gap-2">
              <Zap className="h-3.5 w-3.5 text-destructive" />
              <span className="text-[13px] font-medium text-destructive">Force (destructive)</span>
            </div>
            <p className="text-[12px] text-muted-foreground">
              Cancel all pending wait jobs and force-exit in-flight enrollments
              immediately. In-flight emails already sent to Resend will still go out.
            </p>
          </button>
        </div>

        {heldCount > 0 && mode === "drain" && (
          <div className="flex items-start gap-2 rounded-lg border border-warning/40 bg-warning/8 px-3 py-2 text-[12px]">
            <AlertTriangle className="h-3.5 w-3.5 mt-0.5 shrink-0 text-warning" />
            <p>
              ⚠️ {heldCount} enrollment{heldCount === 1 ? "" : "s"} held at paused steps will be
              FORCE-EXITED when other enrollments finish draining.
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
            variant={mode === "force" ? "destructive" : "default"}
            onClick={handleConfirm}
            disabled={loading}
          >
            {loading
              ? mode === "drain" ? "Draining…" : "Stopping…"
              : mode === "drain" ? "Drain stop" : "Force stop"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
