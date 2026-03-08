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

const STATUS_BADGE: Record<string, "default" | "success" | "warning" | "secondary"> = {
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
    <div className="p-8 max-w-5xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-semibold">Campaigns</h1>
          <p className="text-sm text-muted-foreground mt-0.5">Automated email sequences</p>
        </div>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button size="sm">
              <Plus className="w-4 h-4" />
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
                <Input ref={nameRef} required />
              </div>
              <div className="space-y-1.5">
                <Label>Description</Label>
                <Input ref={descRef} />
              </div>
              <div className="space-y-1.5">
                <Label>Trigger</Label>
                <div className="flex gap-2">
                  {(["event", "manual"] as const).map((t) => (
                    <button
                      key={t}
                      type="button"
                      onClick={() => setTriggerType(t)}
                      className={`px-3 py-1.5 rounded-md border text-sm cursor-pointer transition-colors ${
                        triggerType === t
                          ? "bg-black text-white border-black"
                          : "hover:bg-accent"
                      }`}
                    >
                      {t === "event" ? "On Event" : "Manual"}
                    </button>
                  ))}
                </div>
              </div>
              {triggerType === "event" && (
                <div className="space-y-1.5">
                  <Label>Event Name *</Label>
                  <Input ref={eventNameRef} placeholder="user_signed_up" required />
                </div>
              )}
              <DialogFooter>
                <Button type="submit" disabled={createMutation.isPending}>
                  {createMutation.isPending ? "Creating..." : "Create Campaign"}
                </Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
      </div>

      <div className="space-y-3">
        {campaigns.map((campaign) => (
          <div
            key={campaign.id}
            className="bg-white rounded-xl border p-4 flex items-center justify-between"
          >
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 mb-1">
                <span className="font-medium">{campaign.name}</span>
                <Badge variant={STATUS_BADGE[campaign.status] ?? "secondary"}>
                  {campaign.status}
                </Badge>
              </div>
              <p className="text-sm text-muted-foreground">
                Trigger:{" "}
                {campaign.triggerType === "event"
                  ? `Event "${(campaign.triggerConfig as { eventName?: string }).eventName}"`
                  : campaign.triggerType}
              </p>
            </div>
            <div className="flex items-center gap-2 ml-4">
              {(campaign.status === "draft" || campaign.status === "paused") && (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => toggleMutation.mutate({ id: campaign.id, status: "active" })}
                >
                  <Play className="w-3.5 h-3.5" />
                  Activate
                </Button>
              )}
              {campaign.status === "active" && (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => toggleMutation.mutate({ id: campaign.id, status: "paused" })}
                >
                  <Pause className="w-3.5 h-3.5" />
                  Pause
                </Button>
              )}
            </div>
          </div>
        ))}
        {campaigns.length === 0 && (
          <div className="text-center py-20 text-muted-foreground">
            <Zap className="w-8 h-8 mx-auto mb-3 opacity-30" />
            <p className="font-medium">No campaigns yet</p>
            <p className="text-sm mt-1">Create an automated campaign triggered by events</p>
          </div>
        )}
      </div>
    </div>
  );
}
