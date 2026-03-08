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
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { format } from "date-fns";

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

  // Wait step state
  const [duration, setDuration] = useState(1);
  const [unit, setUnit] = useState<"hours" | "days" | "weeks">("days");

  // Delete confirmation
  const [confirmDelete, setConfirmDelete] = useState(false);

  // Sync local state when step changes
  useEffect(() => {
    if (!step) return;
    if (step.stepType === "email") {
      setSubject((step.config.subject as string) ?? "");
      setFromName((step.config.fromName as string) ?? "");
      setFromEmail((step.config.fromEmail as string) ?? "");
      setHtmlContent((step.config.htmlContent as string) ?? "");
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
      saveMutation.mutate({ subject, fromName, fromEmail, htmlContent });
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
            <div className="space-y-1.5">
              <Label className="text-[12px]">HTML Content</Label>
              <textarea
                value={htmlContent}
                onChange={(e) => setHtmlContent(e.target.value)}
                placeholder="<p>Hello {{contact.firstName}}</p>"
                className="w-full min-h-[200px] rounded-md border border-border bg-input px-3 py-2 text-xs font-mono text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-1 focus:ring-ring resize-y"
              />
            </div>
            {htmlContent && (
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

  const { data: detail, isLoading } = useQuery<CampaignDetail>({
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
          position: detail?.steps.length ?? 0,
        }),
      }),
    onSuccess: (newStep) => {
      qc.invalidateQueries({ queryKey: ["campaign-detail", campaign.id] });
      setSelectedStepId(newStep.id);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const toggleStatusMutation = useMutation({
    mutationFn: (status: string) =>
      sessionFetch(workspaceId, `/campaigns/${campaign.id}`, {
        method: "PATCH",
        body: JSON.stringify({ status }),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["campaigns", workspaceId] });
      qc.invalidateQueries({ queryKey: ["campaign-detail", campaign.id] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const currentStatus = detail?.status ?? campaign.status;

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
                          <p className="text-[13px] font-medium">Send Email</p>
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
                          <p className="text-[13px] font-medium">Wait</p>
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

            {/* Status footer */}
            <div className="px-4 py-3 border-t bg-card shrink-0">
              {(currentStatus === "draft" || currentStatus === "paused") && (
                <Button
                  size="sm"
                  className="w-full"
                  onClick={() => toggleStatusMutation.mutate("active")}
                  disabled={toggleStatusMutation.isPending}
                >
                  <Play className="h-3.5 w-3.5" />
                  Activate
                </Button>
              )}
              {currentStatus === "active" && (
                <Button
                  size="sm"
                  variant="outline"
                  className="w-full"
                  onClick={() => toggleStatusMutation.mutate("paused")}
                  disabled={toggleStatusMutation.isPending}
                >
                  <Pause className="h-3.5 w-3.5" />
                  Pause
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
  const [detailCampaignId, setDetailCampaignId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [activeTab, setActiveTab] = useState<"active" | "archived">("active");
  const nameRef = useRef<HTMLInputElement>(null);
  const descRef = useRef<HTMLInputElement>(null);
  const eventNameRef = useRef<HTMLInputElement>(null);
  const [triggerType, setTriggerType] = useState<"event" | "manual">("event");

  const { data: campaigns = [], isLoading } = useQuery<Campaign[]>({
    queryKey: ["campaigns", activeWorkspaceId],
    queryFn: () => sessionFetch(activeWorkspaceId!, "/campaigns"),
    enabled: !!activeWorkspaceId,
  });

  const detailCampaign = detailCampaignId ? (campaigns.find(c => c.id === detailCampaignId) ?? null) : null;

  function resetForm() {
    if (nameRef.current) nameRef.current.value = "";
    if (descRef.current) descRef.current.value = "";
    if (eventNameRef.current) eventNameRef.current.value = "";
    setTriggerType("event");
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
    mutationFn: ({ id, status }: { id: string; status: string }) =>
      sessionFetch(activeWorkspaceId!, `/campaigns/${id}`, {
        method: "PATCH",
        body: JSON.stringify({ status }),
      }),
    onMutate: async ({ id, status }) => {
      await qc.cancelQueries({ queryKey: ["campaigns", activeWorkspaceId] });
      const previous = qc.getQueryData<Campaign[]>(["campaigns", activeWorkspaceId]);
      qc.setQueryData<Campaign[]>(["campaigns", activeWorkspaceId], (old) =>
        old?.map((c) => (c.id === id ? { ...c, status } : c)) ?? []
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
                {(campaign.status === "draft" ||
                  campaign.status === "paused") && (
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={toggleMutation.isPending}
                    onClick={(e) => {
                      e.stopPropagation();
                      toggleMutation.mutate({
                        id: campaign.id,
                        status: "active",
                      });
                    }}
                  >
                    <Play className="h-3.5 w-3.5" />
                    Activate
                  </Button>
                )}
                {campaign.status === "active" && (
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={toggleMutation.isPending}
                    onClick={(e) => {
                      e.stopPropagation();
                      toggleMutation.mutate({
                        id: campaign.id,
                        status: "paused",
                      });
                    }}
                  >
                    <Pause className="h-3.5 w-3.5" />
                    Pause
                  </Button>
                )}
                {campaign.status !== "active" && campaign.status !== "archived" && (
                  <button
                    onClick={(e) => { e.stopPropagation(); toggleMutation.mutate({ id: campaign.id, status: "archived" }); }}
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
    </div>
  );
}
