/**
 * Archive campaign dialog (Stage 2 — T18, [CR-10], [CR-13]).
 *
 * Strong terminal-action confirmation: a checkbox the operator must explicitly
 * tick before the confirm button enables. Submits `{ confirm_terminal: true }`
 * to POST /:id/archive via the parent's `onConfirm` callback.
 *
 * Idempotent on already-archived campaigns (the API returns 200 with
 * `idempotent: true`); the dialog still renders so operators can verify state.
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
import { Archive, AlertTriangle } from "lucide-react";

interface ArchiveDialogProps {
  open: boolean;
  campaignName: string;
  onOpenChange: (open: boolean) => void;
  onConfirm: (payload: { confirm_terminal: true }) => void;
  loading?: boolean;
}

export function ArchiveDialog({
  open,
  campaignName,
  onOpenChange,
  onConfirm,
  loading,
}: ArchiveDialogProps) {
  const [understood, setUnderstood] = useState(false);

  function handleConfirm() {
    if (!understood) return;
    onConfirm({ confirm_terminal: true });
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        // Reset checkbox when dialog closes so the next open requires re-confirmation.
        if (!o) setUnderstood(false);
        onOpenChange(o);
      }}
    >
      <DialogContent className="max-w-[480px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Archive className="h-4 w-4" />
            Archive campaign
          </DialogTitle>
          <DialogDescription>
            Archive <strong className="text-foreground font-medium">{campaignName}</strong>?
          </DialogDescription>
        </DialogHeader>

        <div className="rounded-lg border border-warning/40 bg-warning/8 px-3 py-2.5 text-[12px] flex items-start gap-2">
          <AlertTriangle className="h-3.5 w-3.5 mt-0.5 shrink-0 text-warning" />
          <div>
            <p className="font-medium text-foreground">This action is terminal.</p>
            <p className="mt-1 text-muted-foreground">
              Archived campaigns cannot be reactivated. Historical analytics and the audit
              trail are preserved, but the campaign no longer enrolls or processes contacts.
            </p>
          </div>
        </div>

        <label className="flex items-center gap-2 text-[13px] cursor-pointer select-none">
          <input
            type="checkbox"
            checked={understood}
            onChange={(e) => setUnderstood(e.target.checked)}
            className="rounded border-input"
          />
          I understand this is permanent and cannot be undone.
        </label>

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
            variant="destructive"
            onClick={handleConfirm}
            disabled={loading || !understood}
          >
            {loading ? "Archiving…" : "Archive campaign"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
