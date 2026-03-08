import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { sessionFetch } from "@/lib/api";
import { useWorkspaceStore } from "@/store/workspace";
import { useState, useRef } from "react";
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
import { Plus, Zap, Play, Pause, Trash2 } from "lucide-react";
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
  // Drizzle returns camelCase from REST; handle both
  triggerConfig: Record<string, unknown>;
  createdAt: string;
}

const STATUS_BADGE: Record<
  string,
  "default" | "success" | "warning" | "secondary"
> = {
  draft: "secondary",
  active: "success",
  paused: "warning",
  archived: "default",
};

function getEventName(config: Record<string, unknown>): string {
  // Handle both camelCase (REST/Drizzle) and snake_case (Electric)
  const name = config.eventName ?? config.event_name;
  return name ? `"${name}"` : "(unnamed event)";
}

function CampaignCardSkeleton() {
  return (
    <div className="flex items-center gap-4 rounded-lg border bg-background p-4">
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

function CampaignsPage() {
  const { activeWorkspaceId } = useWorkspaceStore();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<Campaign | null>(null);
  const nameRef = useRef<HTMLInputElement>(null);
  const descRef = useRef<HTMLInputElement>(null);
  const eventNameRef = useRef<HTMLInputElement>(null);
  const [triggerType, setTriggerType] = useState<"event" | "manual">("event");

  const { data: campaigns = [], isLoading } = useQuery<Campaign[]>({
    queryKey: ["campaigns", activeWorkspaceId],
    queryFn: () => sessionFetch(activeWorkspaceId!, "/campaigns"),
    enabled: !!activeWorkspaceId,
  });

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
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["campaigns", activeWorkspaceId] });
      toast.success("Campaign updated");
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

  return (
    <div className="mx-auto max-w-5xl px-8 py-8">
      {/* Header */}
      <div className="mb-7 flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold tracking-tight">Campaigns</h1>
          <p className="mt-0.5 text-sm text-muted-foreground">
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
              <Plus className="h-4 w-4" />
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
              {/* Animated field appearance */}
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

      {/* List */}
      <div className="space-y-2">
        {isLoading &&
          Array.from({ length: 3 }).map((_, i) => (
            <CampaignCardSkeleton key={i} />
          ))}

        {!isLoading &&
          campaigns.map((campaign) => (
            <div
              key={campaign.id}
              className="group flex items-center gap-4 rounded-lg border bg-background p-4 transition-colors duration-150 hover:bg-accent/30"
            >
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="truncate font-medium text-sm">{campaign.name}</span>
                  <Badge variant={STATUS_BADGE[campaign.status] ?? "secondary"}>
                    {campaign.status}
                  </Badge>
                </div>
                <p className="mt-0.5 truncate text-sm text-muted-foreground">
                  {campaign.triggerType === "event"
                    ? `Trigger: ${getEventName(campaign.triggerConfig)}`
                    : `Trigger: ${campaign.triggerType}`}
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-1.5">
                <span className="text-xs text-muted-foreground tabular-nums opacity-0 transition-opacity duration-150 group-hover:opacity-100">
                  {campaign.createdAt ? format(new Date(campaign.createdAt), "MMM d") : ""}
                </span>
                {(campaign.status === "draft" || campaign.status === "paused") && (
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={toggleMutation.isPending}
                    onClick={() =>
                      toggleMutation.mutate({ id: campaign.id, status: "active" })
                    }
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
                    onClick={() =>
                      toggleMutation.mutate({ id: campaign.id, status: "paused" })
                    }
                  >
                    <Pause className="h-3.5 w-3.5" />
                    Pause
                  </Button>
                )}
                {campaign.status !== "active" && (
                  <button
                    onClick={() => setDeleteTarget(campaign)}
                    className="rounded p-1.5 text-muted-foreground/40 opacity-0 transition-all duration-150 hover:bg-destructive/10 hover:text-destructive group-hover:opacity-100 focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-ring cursor-pointer"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                )}
              </div>
            </div>
          ))}

        {!isLoading && campaigns.length === 0 && (
          <div className="flex flex-col items-center justify-center py-20 text-center">
            <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-lg border bg-background">
              <Zap className="h-5 w-5 text-muted-foreground" />
            </div>
            <p className="font-medium text-sm">No campaigns yet</p>
            <p className="mt-1 text-sm text-muted-foreground">
              Automate emails triggered by user events
            </p>
            <Button size="sm" className="mt-4" onClick={() => setOpen(true)}>
              <Plus className="h-4 w-4" />
              New Campaign
            </Button>
          </div>
        )}
      </div>

      {/* Delete confirmation */}
      <AlertDialog
        open={!!deleteTarget}
        onOpenChange={(o) => !o && setDeleteTarget(null)}
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
