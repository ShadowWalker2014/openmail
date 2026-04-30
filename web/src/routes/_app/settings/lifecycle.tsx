/**
 * Workspace lifecycle settings page (Stage 3 — T9, REQ-19, CR-07).
 *
 * Operator-configurable defaults for resume-from-pause behaviour:
 *  - resume_dialog_threshold (when to surface confirmation dialog)
 *  - default_spread_window_seconds (4h default)
 *  - default_stale_threshold_seconds (7d default)
 *  - default_resume_mode (immediate/spread/skip_stale/skip_stale_spread)
 */
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { apiFetch } from "@/lib/api";
import { useWorkspaceStore } from "@/store/workspace";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Activity } from "lucide-react";
import { toast } from "sonner";
import { SectionCard, SectionHeader } from "@/components/settings/shared";

export const Route = createFileRoute("/_app/settings/lifecycle")({
  component: LifecycleSettingsPage,
});

interface LifecycleSettings {
  workspaceId: string;
  resumeDialogThreshold: number;
  defaultSpreadWindowSeconds: number;
  defaultStaleThresholdSeconds: number;
  defaultResumeMode:
    | "immediate"
    | "spread"
    | "skip_stale"
    | "skip_stale_spread";
  isDefault: boolean;
}

function LifecycleSettingsPage() {
  const { activeWorkspaceId } = useWorkspaceStore();
  const qc = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: ["lifecycle-settings", activeWorkspaceId],
    queryFn: () =>
      apiFetch<LifecycleSettings>(
        `/api/session/ws/${activeWorkspaceId}/lifecycle-settings`,
      ),
    enabled: !!activeWorkspaceId,
  });

  // Local form state — initialised from server data, edited locally, saved on
  // submit.
  const [threshold, setThreshold] = useState(100);
  const [windowSec, setWindowSec] = useState(14400);
  const [staleSec, setStaleSec] = useState(604800);
  const [mode, setMode] = useState<LifecycleSettings["defaultResumeMode"]>(
    "immediate",
  );

  useEffect(() => {
    if (!data) return;
    setThreshold(data.resumeDialogThreshold);
    setWindowSec(data.defaultSpreadWindowSeconds);
    setStaleSec(data.defaultStaleThresholdSeconds);
    setMode(data.defaultResumeMode);
  }, [data]);

  const saveMutation = useMutation({
    mutationFn: (body: Partial<LifecycleSettings>) =>
      apiFetch<LifecycleSettings>(
        `/api/session/ws/${activeWorkspaceId}/lifecycle-settings`,
        {
          method: "PATCH",
          body: JSON.stringify(body),
        },
      ),
    onSuccess: () => {
      qc.invalidateQueries({
        queryKey: ["lifecycle-settings", activeWorkspaceId],
      });
      toast.success("Lifecycle settings saved");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  if (!activeWorkspaceId) return null;

  function handleSave() {
    saveMutation.mutate({
      resumeDialogThreshold: threshold,
      defaultSpreadWindowSeconds: windowSec,
      defaultStaleThresholdSeconds: staleSec,
      defaultResumeMode: mode,
    });
  }

  return (
    <SectionCard>
      <SectionHeader
        icon={Activity}
        title="Lifecycle"
        description="Defaults for resuming paused campaigns and burst-send mitigation."
      />
      <div className="divide-y divide-border/60">
        {/* Resume dialog threshold */}
        <div className="px-5 py-4 space-y-1.5">
          <Label>Resume dialog threshold</Label>
          <p className="text-[12px] text-muted-foreground">
            Show the confirmation dialog when overdue enrollments exceed this
            count. Set to 0 to always show.
          </p>
          <Input
            type="number"
            min={0}
            max={1_000_000}
            value={threshold}
            onChange={(e) => setThreshold(Number(e.target.value))}
            disabled={isLoading || saveMutation.isPending}
            className="max-w-[200px]"
          />
        </div>

        {/* Default spread window */}
        <div className="px-5 py-4 space-y-1.5">
          <Label>Default spread window (seconds)</Label>
          <p className="text-[12px] text-muted-foreground">
            How long to spread overdue sends after resume (default: 14400 = 4 hours).
            Min 60s, max 30 days.
          </p>
          <Input
            type="number"
            min={60}
            max={30 * 86400}
            value={windowSec}
            onChange={(e) => setWindowSec(Number(e.target.value))}
            disabled={isLoading || saveMutation.isPending}
            className="max-w-[200px]"
          />
          <p className="text-[11px] text-muted-foreground">
            ≈ {(windowSec / 3600).toFixed(2)} hours
          </p>
        </div>

        {/* Default stale threshold */}
        <div className="px-5 py-4 space-y-1.5">
          <Label>Default stale threshold (seconds)</Label>
          <p className="text-[12px] text-muted-foreground">
            Skip sends scheduled longer ago than this when using "skip stale"
            mode (default: 604800 = 7 days). Min 1h, max 365d.
          </p>
          <Input
            type="number"
            min={3600}
            max={365 * 86400}
            value={staleSec}
            onChange={(e) => setStaleSec(Number(e.target.value))}
            disabled={isLoading || saveMutation.isPending}
            className="max-w-[200px]"
          />
          <p className="text-[11px] text-muted-foreground">
            ≈ {(staleSec / 86400).toFixed(2)} days
          </p>
        </div>

        {/* Default resume mode */}
        <div className="px-5 py-4 space-y-1.5">
          <Label>Default resume mode</Label>
          <p className="text-[12px] text-muted-foreground">
            What to do by default when an operator clicks Resume.
          </p>
          <Select
            value={mode}
            onValueChange={(v) =>
              setMode(v as LifecycleSettings["defaultResumeMode"])
            }
            disabled={isLoading || saveMutation.isPending}
          >
            <SelectTrigger className="max-w-[280px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="immediate">Immediate (send all now)</SelectItem>
              <SelectItem value="spread">
                Spread (across window)
              </SelectItem>
              <SelectItem value="skip_stale">
                Skip stale (drop overdue)
              </SelectItem>
              <SelectItem value="skip_stale_spread">
                Skip stale + spread
              </SelectItem>
            </SelectContent>
          </Select>
        </div>

        {/* Save */}
        <div className="px-5 py-4 flex justify-end">
          <Button
            size="sm"
            onClick={handleSave}
            disabled={saveMutation.isPending || isLoading}
          >
            {saveMutation.isPending ? "Saving…" : "Save"}
          </Button>
        </div>
      </div>
    </SectionCard>
  );
}
