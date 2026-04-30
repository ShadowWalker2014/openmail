import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { sessionFetch } from "@/lib/api";
import { useWorkspaceStore } from "@/store/workspace";
import { useState, useRef, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogAction,
  AlertDialogCancel,
} from "@/components/ui/alert-dialog";
import {
  Plus,
  Zap,
  Play,
  Pause,
  Trash2,
  Mail,
  Clock,
  Settings,
  Archive,
  Search,
  Square,
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { format } from "date-fns";
import { StopDialog, type StopDialogPayload } from "@/components/lifecycle/stop-dialog";
import { ArchiveDialog } from "@/components/lifecycle/archive-dialog";
import { GoalList } from "@/components/goals/goal-list";

export const Route = createFileRoute("/_app/campaigns/")({
  component: CampaignsPage,
});

interface Campaign {
  id: string;
  name: string;
  description: string | null;
  status: string;
  triggerType: string;
  triggerConfig: Record<string, unknown>;
  createdAt: string;
}

interface CampaignStep {
  id: string;
  campaignId: string;
  stepType: "email" | "wait";
  config: Record<string, unknown>;
  position: number;
  createdAt: string;
  // Stage 4 — per-step pause status. Defaults to 'active' for any step that
  // predates the migration.
  status?: "active" | "paused";
  pausedAt?: string | null;
}

interface CampaignDetail extends Campaign {
  steps: CampaignStep[];
}

const STATUS_BADGE: Record<
  string,
  "default" | "success" | "warning" | "secondary" | "violet"
> = {
  draft: "secondary",
  active: "success",
  paused: "warning",
  // Stage 2 — new transitional / terminal states
  stopping: "warning",
  stopped: "default",
  archived: "default",
};

function getEventName(config: Record<string, unknown>): string {
  const name = config.eventName ?? config.event_name;
  return name ? `"${name}"` : "(unnamed event)";
}

function getTriggerLabel(campaign: Campaign): string {
  if (campaign.triggerType === "event") {
    return `Trigger: ${getEventName(campaign.triggerConfig)}`;
  }
  return "Manual trigger";
}

// ─── Skeleton ────────────────────────────────────────────────────────────────

function CampaignCardSkeleton() {
  return (
    <div className="flex items-center gap-4 rounded-lg border border-border bg-card p-4">
      <div className="flex-1 space-y-2">
        <div className="flex items-center gap-2">
          <div className="h-4 w-28 rounded shimmer" />
          <div className="h-5 w-14 rounded-full shimmer" />
        </div>
        <div className="h-3.5 w-40 rounded shimmer" />
      </div>
      <div className="h-3.5 w-10 rounded shimmer" />
    </div>
  );
}

// ─── Step config right panel ─────────────────────────────────────────────────

interface StepConfigPanelProps {
  step: CampaignStep | null;
  campaignId: string;
  workspaceId: string;
  onSaved: () => void;
  onDeleted: () => void;
}

function StepConfigPanel({
  step,
  campaignId,
  workspaceId,
  onSaved,
  onDeleted,
}: StepConfigPanelProps) {
  const qc = useQueryClient();

  // Email step state
  const [subject, setSubject] = useState("");
  const [fromName, setFromName] = useState("");
  const [fromEmail, setFromEmail] = useState("");
  const [htmlContent, setHtmlContent] = useState("");
  const [contentMode, setContentMode] = useState<"html" | "template">("html");
  const [selectedTemplateId, setSelectedTemplateId] = useState<string | null>(null);

  // Wait step state
  const [duration, setDuration] = useState(1);
  const [unit, setUnit] = useState<"hours" | "days" | "weeks">("days");

  // Delete confirmation
  const [confirmDelete, setConfirmDelete] = useState(false);

  const { data: templates = [] } = useQuery<{ id: string; name: string; htmlContent: string }[]>({
    queryKey: ["templates", workspaceId],
    queryFn: () => sessionFetch<{ data: { id: string; name: string; htmlContent: string }[] }>(workspaceId, "/templates?pageSize=100").then((res) => res.data),
    enabled: step?.stepType === "email",
  });

  // Sync local state when step changes
  useEffect(() => {
    if (!step) return;
    if (step.stepType === "email") {
      setSubject((step.config.subject as string) ?? "");
      setFromName((step.config.fromName as string) ?? "");
      setFromEmail((step.config.fromEmail as string) ?? "");
      setHtmlContent((step.config.htmlContent as string) ?? "");
      setSelectedTemplateId((step.config.templateId as string | null) ?? null);
      setContentMode((step.config.templateId as string | null) ? "template" : "html");
    } else if (step.stepType === "wait") {
      setDuration((step.config.duration as number) ?? 1);
      setUnit((step.config.unit as "hours" | "days" | "weeks") ?? "days");
    }
  }, [step?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const saveMutation = useMutation({
    mutationFn: (config: Record<string, unknown>) =>
      sessionFetch(workspaceId, `/campaigns/${campaignId}/steps/${step!.id}`, {
        method: "PATCH",
        body: JSON.stringify({ config }),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["campaign-detail", campaignId] });
      toast.success("Step saved");
      onSaved();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const deleteMutation = useMutation({
    mutationFn: () =>
      sessionFetch(workspaceId, `/campaigns/${campaignId}/steps/${step!.id}`, {
        method: "DELETE",
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["campaign-detail", campaignId] });
      toast.success("Step deleted");
      onDeleted();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  // Stage 4 — per-step pause/resume.
  const pauseStepMutation = useMutation({
    mutationFn: async () =>
      (await sessionFetch(
        workspaceId,
        `/campaigns/${campaignId}/steps/${step!.id}/pause`,
        { method: "POST", body: JSON.stringify({}) },
      )) as { held_count?: number; cancelled_jobs?: number },
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ["campaign-detail", campaignId] });
      toast.success(
        `Step paused (${data?.held_count ?? 0} held, ${data?.cancelled_jobs ?? 0} jobs cancelled)`,
      );
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const resumeStepMutation = useMutation({
    mutationFn: async () =>
      (await sessionFetch(
        workspaceId,
        `/campaigns/${campaignId}/steps/${step!.id}/resume`,
        { method: "POST", body: JSON.stringify({ mode: "immediate" }) },
      )) as { resumed_count?: number; held_count?: number },
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ["campaign-detail", campaignId] });
      toast.success(
        `Step resumed (${data?.resumed_count ?? data?.held_count ?? 0} enrollments)`,
      );
    },
    onError: (e: Error) => toast.error(e.message),
  });

  if (!step) {
    return (
      <div className="flex flex-col min-h-0">
        <div className="shrink-0 px-4 py-2 border-b text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
          No step selected
        </div>
        <div className="flex-1 flex flex-col items-center justify-center h-full text-center opacity-40 p-5">
          <Settings className="h-8 w-8 text-muted-foreground mb-2" />
          <p className="text-[12px] text-muted-foreground">
            Select a step to configure it, or add one
          </p>
        </div>
      </div>
    );
  }

  function handleSave() {
    if (step!.stepType === "email") {
      saveMutation.mutate({
        subject,
        fromName,
        fromEmail,
        ...(contentMode === "template" && selectedTemplateId
          ? { templateId: selectedTemplateId, htmlContent: undefined }
          : { htmlContent }),
      });
    } else {
      saveMutation.mutate({ duration, unit });
    }
  }

  function handleDelete() {
    setConfirmDelete(true);
  }

  return (
    <div className="flex flex-col h-full min-h-0">
      <div className="shrink-0 px-4 py-2 border-b text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
        Configure Step
      </div>
      <div className="flex-1 overflow-y-auto p-5 space-y-4">
        {step.stepType === "email" && (
          <>
            <div className="space-y-1.5">
              <Label className="text-[12px]">Subject</Label>
              <Input
                value={subject}
                onChange={(e) => setSubject(e.target.value)}
                placeholder="Subject line"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label className="text-[12px]">From Name</Label>
                <Input
                  value={fromName}
                  onChange={(e) => setFromName(e.target.value)}
                  placeholder="Acme Inc."
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-[12px]">From Email</Label>
                <Input
                  value={fromEmail}
                  onChange={(e) => setFromEmail(e.target.value)}
                  placeholder="hello@example.com"
                />
              </div>
            </div>
            {/* Content mode toggle */}
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <Label className="text-[12px]">Content</Label>
                <div className="flex items-center rounded-md border border-border p-0.5 gap-0.5">
                  {(["html", "template"] as const).map((m) => (
                    <button
                      key={m}
                      type="button"
                      onClick={() => { setContentMode(m); if (m === "html") setSelectedTemplateId(null); }}
                      className={cn(
                        "rounded px-2 py-0.5 text-[11px] font-medium transition-colors cursor-pointer",
                        contentMode === m ? "bg-foreground text-background" : "text-muted-foreground hover:text-foreground"
                      )}
                    >
                      {m === "html" ? "Write HTML" : "Template"}
                    </button>
                  ))}
                </div>
              </div>
              {contentMode === "html" ? (
                <textarea
                  value={htmlContent}
                  onChange={(e) => setHtmlContent(e.target.value)}
                  placeholder="<p>Hello {{contact.firstName}}</p>"
                  className="w-full min-h-[200px] rounded-md border border-border bg-input px-3 py-2 text-xs font-mono text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-1 focus:ring-ring resize-y"
                />
              ) : templates.length === 0 ? (
                <p className="text-[12px] text-muted-foreground rounded-lg border border-dashed px-3 py-2">No templates yet. Create one in the Templates page.</p>
              ) : (
                <select
                  value={selectedTemplateId ?? ""}
                  onChange={(e) => setSelectedTemplateId(e.target.value || null)}
                  className="w-full h-9 rounded-md border border-input bg-input px-3 text-[13px] focus:outline-none focus:ring-1 focus:ring-ring cursor-pointer"
                >
                  <option value="">Select a template…</option>
                  {templates.map(t => (
                    <option key={t.id} value={t.id}>{t.name}</option>
                  ))}
                </select>
              )}
            </div>

            {/* Preview */}
            {contentMode === "html" && htmlContent && (
              <div className="space-y-1.5">
                <Label className="text-[12px]">Preview</Label>
                <iframe
                  srcDoc={htmlContent}
                  sandbox="allow-same-origin"
                  className="w-full min-h-[300px] rounded-md border border-border bg-white"
                  title="Email preview"
                />
              </div>
            )}
            {contentMode === "template" && selectedTemplateId && (
              <div className="space-y-1.5">
                <Label className="text-[12px]">Preview</Label>
                <iframe
                  srcDoc={templates.find(t => t.id === selectedTemplateId)?.htmlContent ?? ""}
                  sandbox="allow-same-origin"
                  className="w-full min-h-[300px] rounded-md border border-border bg-white"
                  title="Template preview"
                />
              </div>
            )}
          </>
        )}

        {step.stepType === "wait" && (
          <>
            <div className="space-y-1.5">
              <Label className="text-[12px]">Duration</Label>
              <Input
                type="number"
                min={1}
                value={duration}
                onChange={(e) => setDuration(Number(e.target.value))}
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-[12px]">Unit</Label>
              <select
                value={unit}
                onChange={(e) =>
                  setUnit(e.target.value as "hours" | "days" | "weeks")
                }
                className="flex h-8 w-full items-center rounded-md border border-border bg-input px-3 text-[13px] text-foreground focus:outline-none focus:ring-1 focus:ring-ring cursor-pointer"
              >
                <option value="hours">Hours</option>
                <option value="days">Days</option>
                <option value="weeks">Weeks</option>
              </select>
            </div>
            <p className="text-[12px] text-muted-foreground">
              Wait {duration} {unit} before the next step
            </p>
          </>
        )}
      </div>

      <div className="shrink-0 px-5 py-3 border-t flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            className="text-destructive border-destructive/40 hover:bg-destructive/10 hover:text-destructive"
            onClick={handleDelete}
            disabled={deleteMutation.isPending}
          >
            <Trash2 className="h-3.5 w-3.5" />
            Delete step
          </Button>
          {/* Stage 4 — per-step pause/resume */}
          {step?.status === "paused" ? (
            <Button
              variant="outline"
              size="sm"
              onClick={() => resumeStepMutation.mutate()}
              disabled={resumeStepMutation.isPending}
            >
              {resumeStepMutation.isPending ? "Resuming…" : "Resume step"}
            </Button>
          ) : (
            <Button
              variant="outline"
              size="sm"
              onClick={() => pauseStepMutation.mutate()}
              disabled={pauseStepMutation.isPending}
            >
              {pauseStepMutation.isPending ? "Pausing…" : "Pause step"}
            </Button>
          )}
        </div>
        <Button
          size="sm"
          onClick={handleSave}
          disabled={saveMutation.isPending}
        >
          {saveMutation.isPending ? "Saving…" : "Save step"}
        </Button>
      </div>

      <AlertDialog open={confirmDelete} onOpenChange={(o) => !o && setConfirmDelete(false)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete step?</AlertDialogTitle>
            <AlertDialogDescription>This step will be permanently removed from the campaign.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => { deleteMutation.mutate(); setConfirmDelete(false); }}>
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

// ─── Campaign Detail Dialog ───────────────────────────────────────────────────

interface CampaignDetailDialogProps {
  campaign: Campaign;
  onClose: () => void;
  workspaceId: string;
}

function CampaignDetailDialog({
  campaign,
  onClose,
  workspaceId,
}: CampaignDetailDialogProps) {
  const qc = useQueryClient();
  const [selectedStepId, setSelectedStepId] = useState<string | null>(null);

  const { data: detail, isLoading, isError: detailError } = useQuery<CampaignDetail>({
    queryKey: ["campaign-detail", campaign.id],
    queryFn: () => sessionFetch(workspaceId, `/campaigns/${campaign.id}`),
    enabled: !!workspaceId,
  });

  const sortedSteps = [...(detail?.steps ?? [])].sort(
    (a, b) => a.position - b.position
  );

  const selectedStep = sortedSteps.find((s) => s.id === selectedStepId) ?? null;

  const addStepMutation = useMutation({
    mutationFn: (stepType: "email" | "wait") =>
      sessionFetch<CampaignStep>(workspaceId, `/campaigns/${campaign.id}/steps`, {
        method: "POST",
        body: JSON.stringify({
          stepType,
          config: {},
        }),
      }),
    onSuccess: (newStep) => {
      qc.invalidateQueries({ queryKey: ["campaign-detail", campaign.id] });
      setSelectedStepId(newStep.id);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  // ── Stage 2 lifecycle verb mutations ───────────────────────────────────────
  // Each verb POSTs to the dedicated endpoint instead of PATCH-status. Activate
  // remains on PATCH because there's no Stage-2 "activate" verb; it's the only
  // forward-progressing legacy transition kept on the alias.

  const activateMutation = useMutation({
    mutationFn: () =>
      sessionFetch(workspaceId, `/campaigns/${campaign.id}`, {
        method: "PATCH",
        body: JSON.stringify({ status: "active" }),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["campaigns", workspaceId] });
      qc.invalidateQueries({ queryKey: ["campaign-detail", campaign.id] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const pauseMutation = useMutation({
    mutationFn: () =>
      sessionFetch(workspaceId, `/campaigns/${campaign.id}/pause`, {
        method: "POST",
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["campaigns", workspaceId] });
      qc.invalidateQueries({ queryKey: ["campaign-detail", campaign.id] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const resumeMutation = useMutation({
    mutationFn: () =>
      sessionFetch(workspaceId, `/campaigns/${campaign.id}/resume`, {
        method: "POST",
        body: JSON.stringify({ mode: "immediate" }),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["campaigns", workspaceId] });
      qc.invalidateQueries({ queryKey: ["campaign-detail", campaign.id] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const stopMutation = useMutation({
    mutationFn: (payload: StopDialogPayload) =>
      sessionFetch(workspaceId, `/campaigns/${campaign.id}/stop`, {
        method: "POST",
        body: JSON.stringify(payload),
      }),
    onSuccess: () => {
      setStopDialogOpen(false);
      qc.invalidateQueries({ queryKey: ["campaigns", workspaceId] });
      qc.invalidateQueries({ queryKey: ["campaign-detail", campaign.id] });
      toast.success("Campaign stop initiated");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const archiveMutation = useMutation({
    mutationFn: () =>
      sessionFetch(workspaceId, `/campaigns/${campaign.id}/archive`, {
        method: "POST",
        body: JSON.stringify({ confirm_terminal: true }),
      }),
    onSuccess: () => {
      setArchiveDialogOpen(false);
      qc.invalidateQueries({ queryKey: ["campaigns", workspaceId] });
      qc.invalidateQueries({ queryKey: ["campaign-detail", campaign.id] });
      toast.success("Campaign archived");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const [stopDialogOpen, setStopDialogOpen] = useState(false);
  const [archiveDialogOpen, setArchiveDialogOpen] = useState(false);

  const currentStatus = detail?.status ?? campaign.status;
  const anyMutationPending =
    activateMutation.isPending ||
    pauseMutation.isPending ||
    resumeMutation.isPending ||
    stopMutation.isPending ||
    archiveMutation.isPending;

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent className="max-w-[96vw] w-[96vw] h-[92vh] p-0 gap-0 flex flex-col overflow-hidden">
        {/* Top bar */}
        <DialogHeader className="flex flex-row items-center justify-between px-5 py-3 border-b shrink-0">
          <div className="flex items-center gap-2.5 min-w-0">
            <DialogTitle className="truncate">{campaign.name}</DialogTitle>
            <Badge variant={STATUS_BADGE[currentStatus] ?? "secondary"}>
              {currentStatus}
            </Badge>
          </div>
          <span className="text-[12px] text-muted-foreground shrink-0 mr-7">
            {getTriggerLabel(campaign)}
          </span>
        </DialogHeader>

        {/* Body */}
        <div className="flex flex-1 min-h-0">
          {/* Left panel */}
          <div className="w-[300px] shrink-0 border-r border-border flex flex-col overflow-hidden">
            {/* Campaign info */}
            {campaign.description && (
              <div className="px-4 py-3 border-b">
                <p className="text-[12px] text-muted-foreground">
                  {campaign.description}
                </p>
              </div>
            )}

            {/* Step list */}
            <div className="flex-1 overflow-y-auto px-3 py-3">
              {/* Trigger node */}
              <div className="bg-muted/40 rounded-lg border border-border px-3 py-2 mb-1 flex items-center gap-2">
                <Zap className="h-3 w-3 text-muted-foreground shrink-0" />
                <span className="text-[12px] text-muted-foreground truncate">
                  {campaign.triggerType === "event"
                    ? `Event: ${getEventName(campaign.triggerConfig)}`
                    : "Manual trigger"}
                </span>
              </div>

              {/* Connector */}
              {sortedSteps.length > 0 && (
                <div className="w-px h-3 bg-border/60 mx-auto my-0.5" />
              )}

              {isLoading && (
                <div className="space-y-1 mt-1">
                  {Array.from({ length: 2 }).map((_, i) => (
                    <div key={i} className="h-10 rounded-lg shimmer" />
                  ))}
                </div>
              )}

              {detailError && (
                <p className="text-center text-[12px] text-destructive mt-4">Failed to load steps</p>
              )}

              {!isLoading && sortedSteps.length === 0 && (
                <p className="text-center text-[12px] text-muted-foreground mt-4">
                  No steps yet
                </p>
              )}

              {sortedSteps.map((step, idx) => (
                <div key={step.id}>
                  <button
                    onClick={() => setSelectedStepId(step.id)}
                    className={cn(
                      "w-full rounded-lg border px-3 py-2.5 cursor-pointer transition-colors text-left",
                      selectedStepId === step.id
                        ? "border-foreground bg-accent"
                        : "border-border hover:bg-accent/50"
                    )}
                  >
                    {step.stepType === "email" && (
                      <div className="flex items-start gap-2">
                        <Mail className="h-3.5 w-3.5 text-muted-foreground shrink-0 mt-0.5" />
                        <div className="flex-1 min-w-0">
                          <p className="text-[13px] font-medium flex items-center gap-1.5">
                            Send Email
                            {step.status === "paused" && (
                              <span className="text-[10px] uppercase font-semibold tracking-wide rounded px-1.5 py-0.5 bg-amber-500/15 text-amber-600 dark:text-amber-400">
                                paused
                              </span>
                            )}
                          </p>
                          {(step.config.subject as string | undefined) && (
                            <p className="text-[11px] text-muted-foreground truncate">
                              {step.config.subject as string}
                            </p>
                          )}
                        </div>
                      </div>
                    )}
                    {step.stepType === "wait" && (
                      <div className="flex items-center gap-2">
                        <Clock className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                        <div className="flex-1 min-w-0">
                          <p className="text-[13px] font-medium flex items-center gap-1.5">
                            Wait
                            {step.status === "paused" && (
                              <span className="text-[10px] uppercase font-semibold tracking-wide rounded px-1.5 py-0.5 bg-amber-500/15 text-amber-600 dark:text-amber-400">
                                paused
                              </span>
                            )}
                          </p>
                          <p className="text-[11px] text-muted-foreground">
                            {(step.config.duration as number) ?? "?"}{" "}
                            {(step.config.unit as string) ?? "days"}
                          </p>
                        </div>
                      </div>
                    )}
                  </button>
                  {idx < sortedSteps.length - 1 && (
                    <div className="w-px h-3 bg-border/40 mx-auto my-0.5" />
                  )}
                </div>
              ))}
            </div>

            {/* Add step buttons */}
            <div className="px-3 py-3 border-t">
              <p className="text-[11px] uppercase tracking-wide text-muted-foreground mb-2">
                Add step
              </p>
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  className="flex-1"
                  onClick={() => addStepMutation.mutate("email")}
                  disabled={addStepMutation.isPending}
                >
                  <Mail className="h-3.5 w-3.5" />
                  Email
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  className="flex-1"
                  onClick={() => addStepMutation.mutate("wait")}
                  disabled={addStepMutation.isPending}
                >
                  <Clock className="h-3.5 w-3.5" />
                  Wait
                </Button>
              </div>
            </div>

            {/* Stage 5 — Goals (early-exit conditions) */}
            <GoalList
              workspaceId={workspaceId}
              campaignId={campaign.id}
              campaignStatus={currentStatus}
            />

            {/* Status footer — state-aware actions per [REQ-19] */}
            <div className="px-4 py-3 border-t bg-card shrink-0 flex flex-col gap-1.5">
              {currentStatus === "draft" && (
                <Button
                  size="sm"
                  className="w-full"
                  onClick={() => activateMutation.mutate()}
                  disabled={anyMutationPending}
                >
                  <Play className="h-3.5 w-3.5" />
                  Activate
                </Button>
              )}
              {currentStatus === "active" && (
                <>
                  <Button
                    size="sm"
                    variant="outline"
                    className="w-full"
                    onClick={() => pauseMutation.mutate()}
                    disabled={anyMutationPending}
                  >
                    <Pause className="h-3.5 w-3.5" />
                    Pause
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    className="w-full"
                    onClick={() => setStopDialogOpen(true)}
                    disabled={anyMutationPending}
                  >
                    <Square className="h-3.5 w-3.5" />
                    Stop
                  </Button>
                </>
              )}
              {currentStatus === "paused" && (
                <>
                  <Button
                    size="sm"
                    className="w-full"
                    onClick={() => resumeMutation.mutate()}
                    disabled={anyMutationPending}
                  >
                    <Play className="h-3.5 w-3.5" />
                    Resume
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    className="w-full"
                    onClick={() => setStopDialogOpen(true)}
                    disabled={anyMutationPending}
                  >
                    <Square className="h-3.5 w-3.5" />
                    Stop
                  </Button>
                </>
              )}
              {(currentStatus === "stopping" || currentStatus === "stopped") && (
                <p className="text-[12px] text-center text-muted-foreground py-1">
                  View only —{" "}
                  {currentStatus === "stopping"
                    ? "drain in progress"
                    : "campaign stopped"}
                </p>
              )}
              {currentStatus !== "archived" && (
                <Button
                  size="sm"
                  variant="outline"
                  className="w-full text-muted-foreground"
                  onClick={() => setArchiveDialogOpen(true)}
                  disabled={anyMutationPending}
                >
                  <Archive className="h-3.5 w-3.5" />
                  Archive
                </Button>
              )}
            </div>
          </div>

          {/* Right panel */}
          <div className="flex-1 flex flex-col min-w-0 bg-muted/30 overflow-hidden">
            <StepConfigPanel
              step={selectedStep}
              campaignId={campaign.id}
              workspaceId={workspaceId}
              onSaved={() => {}}
              onDeleted={() => setSelectedStepId(null)}
            />
          </div>
        </div>

        {/* Stage 2 lifecycle dialogs */}
        <StopDialog
          open={stopDialogOpen}
          campaignName={campaign.name}
          onOpenChange={setStopDialogOpen}
          onConfirm={(payload) => stopMutation.mutate(payload)}
          loading={stopMutation.isPending}
        />
        <ArchiveDialog
          open={archiveDialogOpen}
          campaignName={campaign.name}
          onOpenChange={setArchiveDialogOpen}
          onConfirm={() => archiveMutation.mutate()}
          loading={archiveMutation.isPending}
        />
      </DialogContent>
    </Dialog>
  );
}

// ─── Campaigns Page ───────────────────────────────────────────────────────────

function CampaignsPage() {
  const { activeWorkspaceId } = useWorkspaceStore();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<Campaign | null>(null);
  const [stopTarget, setStopTarget] = useState<Campaign | null>(null);
  const [archiveTarget, setArchiveTarget] = useState<Campaign | null>(null);
  const [detailCampaignId, setDetailCampaignId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [activeTab, setActiveTab] = useState<"active" | "archived">("active");
  const nameRef = useRef<HTMLInputElement>(null);
  const descRef = useRef<HTMLInputElement>(null);
  const eventNameRef = useRef<HTMLInputElement>(null);
  const [triggerType, setTriggerType] = useState<"event" | "manual">("event");
  // Stage 2 [V2.3] — re-enrollment policy + cooldown form fields
  const [reEnrollmentPolicy, setReEnrollmentPolicy] = useState<
    "never" | "always" | "after_cooldown" | "on_attribute_change"
  >("never");
  const [cooldownHours, setCooldownHours] = useState<number>(24);

  const { data: campaigns = [], isLoading, isError } = useQuery<Campaign[]>({
    queryKey: ["campaigns", activeWorkspaceId],
    queryFn: () => sessionFetch<{ data: Campaign[] }>(activeWorkspaceId!, "/campaigns?pageSize=100").then((res) => res.data),
    enabled: !!activeWorkspaceId,
  });

  const detailCampaign = detailCampaignId ? (campaigns.find(c => c.id === detailCampaignId) ?? null) : null;

  function resetForm() {
    if (nameRef.current) nameRef.current.value = "";
    if (descRef.current) descRef.current.value = "";
    if (eventNameRef.current) eventNameRef.current.value = "";
    setTriggerType("event");
    setReEnrollmentPolicy("never");
    setCooldownHours(24);
  }

  const createMutation = useMutation({
    mutationFn: (body: object) =>
      sessionFetch(activeWorkspaceId!, "/campaigns", {
        method: "POST",
        body: JSON.stringify(body),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["campaigns", activeWorkspaceId] });
      setOpen(false);
      resetForm();
      toast.success("Campaign created");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const toggleMutation = useMutation({
    // Stage 2: list-view inline toggle for activate/pause uses POST verbs.
    // Activate stays on PATCH (no Stage-2 activate verb).
    mutationFn: ({ id, action }: { id: string; action: "activate" | "pause" }) => {
      if (action === "activate") {
        return sessionFetch(activeWorkspaceId!, `/campaigns/${id}`, {
          method: "PATCH",
          body: JSON.stringify({ status: "active" }),
        });
      }
      return sessionFetch(activeWorkspaceId!, `/campaigns/${id}/pause`, {
        method: "POST",
      });
    },
    onMutate: async ({ id, action }) => {
      await qc.cancelQueries({ queryKey: ["campaigns", activeWorkspaceId] });
      const previous = qc.getQueryData<Campaign[]>(["campaigns", activeWorkspaceId]);
      const newStatus = action === "activate" ? "active" : "paused";
      qc.setQueryData<Campaign[]>(["campaigns", activeWorkspaceId], (old) =>
        old?.map((c) => (c.id === id ? { ...c, status: newStatus } : c)) ?? []
      );
      return { previous };
    },
    onError: (e: Error, _vars, context) => {
      if (context?.previous) {
        qc.setQueryData(["campaigns", activeWorkspaceId], context.previous);
      }
      toast.error(e.message);
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ["campaigns", activeWorkspaceId] });
    },
  });

  const stopMutation = useMutation({
    mutationFn: ({ id, payload }: { id: string; payload: StopDialogPayload }) =>
      sessionFetch(activeWorkspaceId!, `/campaigns/${id}/stop`, {
        method: "POST",
        body: JSON.stringify(payload),
      }),
    onSuccess: () => {
      setStopTarget(null);
      qc.invalidateQueries({ queryKey: ["campaigns", activeWorkspaceId] });
      toast.success("Campaign stop initiated");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const archiveMutation = useMutation({
    mutationFn: (id: string) =>
      sessionFetch(activeWorkspaceId!, `/campaigns/${id}/archive`, {
        method: "POST",
        body: JSON.stringify({ confirm_terminal: true }),
      }),
    onSuccess: () => {
      setArchiveTarget(null);
      qc.invalidateQueries({ queryKey: ["campaigns", activeWorkspaceId] });
      toast.success("Campaign archived");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) =>
      sessionFetch(activeWorkspaceId!, `/campaigns/${id}`, { method: "DELETE" }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["campaigns", activeWorkspaceId] });
      setDeleteTarget(null);
      toast.success("Campaign deleted");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const filteredCampaigns = campaigns.filter(c => {
    const matchesTab = activeTab === "archived" ? c.status === "archived" : c.status !== "archived";
    const matchesSearch = !searchQuery ||
      c.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      (c.description?.toLowerCase().includes(searchQuery.toLowerCase()) ?? false);
    return matchesTab && matchesSearch;
  });

  return (
    <div className="px-8 py-7 w-full">
      {/* Header */}
      <div className="mb-5 flex items-center justify-between">
        <div>
          <h1 className="text-[15px] font-semibold tracking-tight">Campaigns</h1>
          <p className="mt-0.5 text-[12px] text-muted-foreground">
            Automated email sequences
          </p>
        </div>
        <Dialog
          open={open}
          onOpenChange={(v) => {
            setOpen(v);
            if (!v) resetForm();
          }}
        >
          <DialogTrigger asChild>
            <Button size="sm">
              <Plus className="h-3.5 w-3.5" />
              New Campaign
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>New Campaign</DialogTitle>
            </DialogHeader>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                createMutation.mutate({
                  name: nameRef.current!.value,
                  description: descRef.current!.value || undefined,
                  triggerType,
                  triggerConfig:
                    triggerType === "event"
                      ? { eventName: eventNameRef.current!.value }
                      : {},
                  re_enrollment_policy: reEnrollmentPolicy,
                  ...(reEnrollmentPolicy === "after_cooldown"
                    ? { re_enrollment_cooldown_seconds: cooldownHours * 3600 }
                    : {}),
                });
              }}
              className="space-y-4"
            >
              <div className="space-y-1.5">
                <Label>Name *</Label>
                <Input ref={nameRef} required placeholder="Welcome sequence" />
              </div>
              <div className="space-y-1.5">
                <Label>Description</Label>
                <Input ref={descRef} placeholder="Optional description" />
              </div>
              <div className="space-y-1.5">
                <Label>Trigger</Label>
                <div className="flex gap-2">
                  {(["event", "manual"] as const).map((t) => (
                    <button
                      key={t}
                      type="button"
                      onClick={() => setTriggerType(t)}
                      className={cn(
                        "rounded-md border px-3 py-1.5 text-sm transition-colors duration-150 cursor-pointer active:scale-95",
                        triggerType === t
                          ? "border-foreground bg-foreground text-background"
                          : "border-border hover:bg-accent"
                      )}
                    >
                      {t === "event" ? "On Event" : "Manual"}
                    </button>
                  ))}
                </div>
              </div>
              <div
                className={cn(
                  "overflow-hidden transition-all duration-200",
                  triggerType === "event"
                    ? "max-h-20 opacity-100"
                    : "max-h-0 opacity-0"
                )}
              >
                <div className="space-y-1.5 pt-px">
                  <Label>Event Name *</Label>
                  <Input
                    ref={eventNameRef}
                    placeholder="user_signed_up"
                    required={triggerType === "event"}
                  />
                </div>
              </div>

              {/* Stage 2 [V2.3] — re-enrollment policy */}
              <div className="space-y-1.5">
                <Label>Re-enrollment policy</Label>
                <select
                  value={reEnrollmentPolicy}
                  onChange={(e) =>
                    setReEnrollmentPolicy(
                      e.target.value as
                        | "never"
                        | "always"
                        | "after_cooldown"
                        | "on_attribute_change",
                    )
                  }
                  className="w-full h-9 rounded-md border border-input bg-input px-3 text-[13px] focus:outline-none focus:ring-1 focus:ring-ring cursor-pointer"
                >
                  <option value="never">
                    Never — contacts who completed/exited cannot re-enter
                  </option>
                  <option value="always">
                    Always — re-enter every time trigger fires (caution: repeat sends)
                  </option>
                  <option value="after_cooldown">
                    After cooldown — re-enter after waiting period
                  </option>
                  <option value="on_attribute_change">
                    On attribute change — re-enter only if attributes changed
                  </option>
                </select>
                <p className="text-[11px] text-muted-foreground">
                  Determines whether a contact who has already gone through this campaign
                  can be re-enrolled when the trigger fires again.
                </p>
              </div>
              {reEnrollmentPolicy === "after_cooldown" && (
                <div className="space-y-1.5">
                  <Label>Cooldown (hours)</Label>
                  <Input
                    type="number"
                    min={1}
                    value={cooldownHours}
                    onChange={(e) => setCooldownHours(Number(e.target.value) || 1)}
                    placeholder="24"
                    required
                  />
                  <p className="text-[11px] text-muted-foreground">
                    Minimum hours between consecutive enrollments per contact.
                  </p>
                </div>
              )}

              <DialogFooter>
                <Button type="submit" disabled={createMutation.isPending}>
                  {createMutation.isPending ? "Creating…" : "Create Campaign"}
                </Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
      </div>

      {/* Search */}
      <div className="mb-4 relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground/50" />
        <Input
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder="Filter by name or description…"
          className="pl-9 h-9"
        />
      </div>

      {isError && (
        <div className="mb-4 flex items-center gap-2 rounded-lg border border-destructive/20 bg-destructive/8 px-3.5 py-2.5 text-[13px] text-destructive">
          Failed to load campaigns.
        </div>
      )}

      {/* Tabs */}
      <div className="flex items-center gap-1 mb-4 border-b border-border">
        {(["active", "archived"] as const).map((tab) => {
          const count = tab === "active"
            ? campaigns.filter(c => c.status !== "archived").length
            : campaigns.filter(c => c.status === "archived").length;
          return (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={cn(
                "px-4 py-2.5 text-[13px] font-medium border-b-2 -mb-px transition-colors cursor-pointer capitalize",
                activeTab === tab
                  ? "border-foreground text-foreground"
                  : "border-transparent text-muted-foreground hover:text-foreground"
              )}
            >
              {tab.charAt(0).toUpperCase() + tab.slice(1)}{" "}
              <span className="ml-1 text-[11px] text-muted-foreground">{count}</span>
            </button>
          );
        })}
      </div>

      {/* List */}
      <div className="space-y-2">
        {isLoading &&
          Array.from({ length: 3 }).map((_, i) => (
            <CampaignCardSkeleton key={i} />
          ))}

        {!isLoading &&
          filteredCampaigns.map((campaign) => (
            <div
              key={campaign.id}
              onClick={() => setDetailCampaignId(campaign.id)}
              className="group flex items-center gap-4 rounded-lg border border-border bg-card p-4 transition-colors duration-150 hover:bg-accent/50 cursor-pointer"
            >
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="truncate font-medium text-sm">
                    {campaign.name}
                  </span>
                  <Badge variant={STATUS_BADGE[campaign.status] ?? "secondary"}>
                    {campaign.status}
                  </Badge>
                </div>
                <p className="mt-0.5 truncate text-[12px] text-muted-foreground">
                  {campaign.triggerType === "event"
                    ? `Trigger: ${getEventName(campaign.triggerConfig)}`
                    : `Trigger: ${campaign.triggerType}`}
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-1.5">
                <span className="text-[11px] text-muted-foreground tabular-nums opacity-0 transition-opacity duration-150 group-hover:opacity-100">
                  {campaign.createdAt
                    ? format(new Date(campaign.createdAt), "MMM d")
                    : ""}
                </span>
                {campaign.status === "draft" && (
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={toggleMutation.isPending}
                    onClick={(e) => {
                      e.stopPropagation();
                      toggleMutation.mutate({ id: campaign.id, action: "activate" });
                    }}
                  >
                    <Play className="h-3.5 w-3.5" />
                    Activate
                  </Button>
                )}
                {campaign.status === "paused" && (
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={toggleMutation.isPending}
                    onClick={(e) => {
                      e.stopPropagation();
                      // Resume — POST /:id/resume — uses Resume button label so users
                      // distinguish from cold "activate" of a draft.
                      sessionFetch(activeWorkspaceId!, `/campaigns/${campaign.id}/resume`, {
                        method: "POST",
                        body: JSON.stringify({ mode: "immediate" }),
                      })
                        .then(() =>
                          qc.invalidateQueries({ queryKey: ["campaigns", activeWorkspaceId] }),
                        )
                        .catch((err: Error) => toast.error(err.message));
                    }}
                  >
                    <Play className="h-3.5 w-3.5" />
                    Resume
                  </Button>
                )}
                {campaign.status === "active" && (
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={toggleMutation.isPending}
                    onClick={(e) => {
                      e.stopPropagation();
                      toggleMutation.mutate({ id: campaign.id, action: "pause" });
                    }}
                  >
                    <Pause className="h-3.5 w-3.5" />
                    Pause
                  </Button>
                )}
                {(campaign.status === "active" || campaign.status === "paused") && (
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={stopMutation.isPending}
                    onClick={(e) => {
                      e.stopPropagation();
                      setStopTarget(campaign);
                    }}
                  >
                    <Square className="h-3.5 w-3.5" />
                    Stop
                  </Button>
                )}
                {campaign.status !== "archived" && (
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      setArchiveTarget(campaign);
                    }}
                    className="rounded p-1.5 text-muted-foreground/40 opacity-0 transition-all duration-150 hover:bg-accent hover:text-foreground group-hover:opacity-100 cursor-pointer"
                    title="Archive"
                  >
                    <Archive className="h-3.5 w-3.5" />
                  </button>
                )}
                {campaign.status !== "active" && (
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      setDeleteTarget(campaign);
                    }}
                    className="rounded p-1.5 text-muted-foreground/40 opacity-0 transition-all duration-150 hover:bg-destructive/10 hover:text-destructive group-hover:opacity-100 focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-ring cursor-pointer"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                )}
              </div>
            </div>
          ))}

        {!isLoading && filteredCampaigns.length === 0 && campaigns.length > 0 && (
          <div className="flex flex-col items-center justify-center py-16 text-center">
            <p className="text-[13px] font-medium text-muted-foreground">No campaigns match your filter</p>
          </div>
        )}

        {!isLoading && campaigns.length === 0 && (
          <div className="flex flex-col items-center justify-center py-20 text-center">
            <div className="mb-4 flex h-9 w-9 items-center justify-center rounded-lg border border-border">
              <Zap className="h-5 w-5 text-muted-foreground" />
            </div>
            <p className="text-[13px] font-medium">No campaigns yet</p>
            <p className="mt-1 text-[12px] text-muted-foreground">
              Automate emails triggered by user events
            </p>
            <Button size="sm" className="mt-4" onClick={() => setOpen(true)}>
              <Plus className="h-3.5 w-3.5" />
              New Campaign
            </Button>
          </div>
        )}
      </div>

      {/* Campaign Detail Dialog */}
      {detailCampaign && (
        <CampaignDetailDialog
          key={detailCampaign.id}
          campaign={detailCampaign}
          onClose={() => setDetailCampaignId(null)}
          workspaceId={activeWorkspaceId!}
        />
      )}

      {/* Delete confirmation */}
      <AlertDialog
        open={!!deleteTarget}
        onOpenChange={(o: boolean) => !o && setDeleteTarget(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete campaign?</AlertDialogTitle>
            <AlertDialogDescription>
              <strong className="text-foreground font-medium">
                {deleteTarget?.name}
              </strong>{" "}
              will be permanently deleted. Any enrolled contacts will be
              unenrolled.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={deleteMutation.isPending}
              onClick={() =>
                deleteTarget && deleteMutation.mutate(deleteTarget.id)
              }
            >
              {deleteMutation.isPending ? "Deleting…" : "Delete"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Stage 2 — Stop verb dialog (page-level, list-row trigger) */}
      <StopDialog
        open={!!stopTarget}
        campaignName={stopTarget?.name ?? ""}
        onOpenChange={(o) => !o && setStopTarget(null)}
        onConfirm={(payload) =>
          stopTarget && stopMutation.mutate({ id: stopTarget.id, payload })
        }
        loading={stopMutation.isPending}
      />

      {/* Stage 2 — Archive verb dialog (page-level, list-row trigger) */}
      <ArchiveDialog
        open={!!archiveTarget}
        campaignName={archiveTarget?.name ?? ""}
        onOpenChange={(o) => !o && setArchiveTarget(null)}
        onConfirm={() =>
          archiveTarget && archiveMutation.mutate(archiveTarget.id)
        }
        loading={archiveMutation.isPending}
      />
    </div>
  );
}
