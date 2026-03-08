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
import { Plus, Zap, Play, Pause } from "lucide-react";
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

const STATUS_BADGE: Record<
  string,
  "default" | "success" | "warning" | "secondary"
> = {
  draft: "secondary",
  active: "success",
  paused: "warning",
  archived: "default",
};

function CampaignsPage() {
  const { activeWorkspaceId } = useWorkspaceStore();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const nameRef = useRef<HTMLInputElement>(null);
  const descRef = useRef<HTMLInputElement>(null);
  const eventNameRef = useRef<HTMLInputElement>(null);
  const [triggerType, setTriggerType] = useState<"event" | "manual">("event");

  const { data: campaigns = [] } = useQuery<Campaign[]>({
    queryKey: ["campaigns", activeWorkspaceId],
    queryFn: () => sessionFetch(activeWorkspaceId!, "/campaigns"),
    enabled: !!activeWorkspaceId,
  });

  const createMutation = useMutation({
    mutationFn: (body: object) =>
      sessionFetch(activeWorkspaceId!, "/campaigns", {
        method: "POST",
        body: JSON.stringify(body),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["campaigns", activeWorkspaceId] });
      setOpen(false);
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
        <Dialog open={open} onOpenChange={setOpen}>
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
                        "rounded-md border px-3 py-1.5 text-sm transition-colors cursor-pointer",
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
              {triggerType === "event" && (
                <div className="space-y-1.5">
                  <Label>Event Name *</Label>
                  <Input
                    ref={eventNameRef}
                    placeholder="user_signed_up"
                    required
                  />
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

      {/* List */}
      <div className="space-y-2">
        {campaigns.map((campaign) => (
          <div
            key={campaign.id}
            className="flex items-center gap-4 rounded-lg border bg-background p-4 transition-shadow hover:shadow-sm"
          >
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <span className="font-medium text-sm">{campaign.name}</span>
                <Badge variant={STATUS_BADGE[campaign.status] ?? "secondary"}>
                  {campaign.status}
                </Badge>
              </div>
              <p className="mt-0.5 text-sm text-muted-foreground">
                {campaign.triggerType === "event"
                  ? `Trigger: "${(campaign.triggerConfig as { eventName?: string }).eventName}"`
                  : `Trigger: ${campaign.triggerType}`}
              </p>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <span className="text-xs text-muted-foreground tabular-nums">
                {format(new Date(campaign.createdAt), "MMM d")}
              </span>
              {(campaign.status === "draft" || campaign.status === "paused") && (
                <Button
                  size="sm"
                  variant="outline"
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
                  onClick={() =>
                    toggleMutation.mutate({ id: campaign.id, status: "paused" })
                  }
                >
                  <Pause className="h-3.5 w-3.5" />
                  Pause
                </Button>
              )}
            </div>
          </div>
        ))}

        {campaigns.length === 0 && (
          <div className="flex flex-col items-center justify-center py-20 text-center">
            <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-xl border bg-background">
              <Zap className="h-5 w-5 text-muted-foreground" />
            </div>
            <p className="font-medium text-sm">No campaigns yet</p>
            <p className="mt-1 text-sm text-muted-foreground">
              Create an automated campaign triggered by events
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
