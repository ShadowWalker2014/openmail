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
import { Plus, Send, Mail } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/_app/broadcasts/")({
  component: BroadcastsPage,
});

interface Broadcast {
  id: string;
  name: string;
  subject: string;
  status: string;
  recipientCount: number;
  openCount: number;
  clickCount: number;
  sentAt: string | null;
  createdAt: string;
}

const STATUS_BADGE: Record<
  string,
  "default" | "success" | "warning" | "destructive" | "secondary" | "outline"
> = {
  draft: "secondary",
  sending: "warning",
  sent: "success",
  failed: "destructive",
  scheduled: "outline",
};

function BroadcastsPage() {
  const { activeWorkspaceId } = useWorkspaceStore();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const nameRef = useRef<HTMLInputElement>(null);
  const subjectRef = useRef<HTMLInputElement>(null);
  const htmlRef = useRef<HTMLTextAreaElement>(null);
  const [selectedSegmentIds, setSelectedSegmentIds] = useState<string[]>([]);

  const { data: broadcasts = [] } = useQuery<Broadcast[]>({
    queryKey: ["broadcasts", activeWorkspaceId],
    queryFn: () => sessionFetch(activeWorkspaceId!, "/broadcasts"),
    enabled: !!activeWorkspaceId,
  });

  const { data: segments = [] } = useQuery<{ id: string; name: string }[]>({
    queryKey: ["segments", activeWorkspaceId],
    queryFn: () => sessionFetch(activeWorkspaceId!, "/segments"),
    enabled: !!activeWorkspaceId,
  });

  const createMutation = useMutation({
    mutationFn: (body: object) =>
      sessionFetch(activeWorkspaceId!, "/broadcasts", {
        method: "POST",
        body: JSON.stringify(body),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["broadcasts", activeWorkspaceId] });
      setOpen(false);
      setSelectedSegmentIds([]);
      toast.success("Broadcast created");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const sendMutation = useMutation({
    mutationFn: (id: string) =>
      sessionFetch(activeWorkspaceId!, `/broadcasts/${id}/send`, {
        method: "POST",
        body: "{}",
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["broadcasts", activeWorkspaceId] });
      toast.success("Broadcast sending...");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div className="p-8 max-w-5xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-semibold">Broadcasts</h1>
          <p className="text-sm text-muted-foreground mt-0.5">One-off email campaigns</p>
        </div>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button size="sm">
              <Plus className="w-4 h-4" />
              New Broadcast
            </Button>
          </DialogTrigger>
          <DialogContent className="max-w-2xl">
            <DialogHeader>
              <DialogTitle>New Broadcast</DialogTitle>
            </DialogHeader>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                if (selectedSegmentIds.length === 0) {
                  toast.error("Select at least one segment");
                  return;
                }
                createMutation.mutate({
                  name: nameRef.current!.value,
                  subject: subjectRef.current!.value,
                  htmlContent: htmlRef.current!.value,
                  segmentIds: selectedSegmentIds,
                });
              }}
              className="space-y-4"
            >
              <div className="space-y-1.5">
                <Label>Name *</Label>
                <Input ref={nameRef} placeholder="August Newsletter" required />
              </div>
              <div className="space-y-1.5">
                <Label>Subject *</Label>
                <Input ref={subjectRef} placeholder="Email subject line" required />
              </div>
              <div className="space-y-1.5">
                <Label>Segments *</Label>
                <div className="flex flex-wrap gap-2">
                  {segments.length === 0 && (
                    <p className="text-sm text-muted-foreground">
                      No segments yet — create one first
                    </p>
                  )}
                  {segments.map((seg) => (
                    <button
                      key={seg.id}
                      type="button"
                      onClick={() =>
                        setSelectedSegmentIds((ids) =>
                          ids.includes(seg.id)
                            ? ids.filter((id) => id !== seg.id)
                            : [...ids, seg.id]
                        )
                      }
                      className={`px-3 py-1 rounded-full border text-sm cursor-pointer transition-colors ${
                        selectedSegmentIds.includes(seg.id)
                          ? "bg-black text-white border-black"
                          : "hover:bg-accent"
                      }`}
                    >
                      {seg.name}
                    </button>
                  ))}
                </div>
              </div>
              <div className="space-y-1.5">
                <Label>HTML Content *</Label>
                <textarea
                  ref={htmlRef}
                  required
                  placeholder="<h1>Hello {{firstName}}!</h1>"
                  className="w-full min-h-[180px] font-mono text-xs rounded-md border border-input bg-transparent px-3 py-2 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring resize-y"
                />
              </div>
              <DialogFooter>
                <Button type="submit" disabled={createMutation.isPending}>
                  {createMutation.isPending ? "Creating..." : "Create Broadcast"}
                </Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
      </div>

      <div className="space-y-3">
        {broadcasts.map((broadcast) => (
          <div
            key={broadcast.id}
            className="bg-white rounded-xl border p-4 flex items-center justify-between"
          >
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 mb-1">
                <span className="font-medium truncate">{broadcast.name}</span>
                <Badge variant={STATUS_BADGE[broadcast.status] ?? "secondary"}>
                  {broadcast.status}
                </Badge>
              </div>
              <p className="text-sm text-muted-foreground truncate">{broadcast.subject}</p>
              {broadcast.status === "sent" && (
                <p className="text-xs text-muted-foreground mt-1">
                  {broadcast.recipientCount} sent · {broadcast.openCount} opens ·{" "}
                  {broadcast.clickCount} clicks
                </p>
              )}
            </div>
            <div className="flex items-center gap-2 ml-4">
              {broadcast.status === "draft" && (
                <Button
                  size="sm"
                  onClick={() => sendMutation.mutate(broadcast.id)}
                  disabled={sendMutation.isPending}
                >
                  <Send className="w-3.5 h-3.5" />
                  Send
                </Button>
              )}
            </div>
          </div>
        ))}
        {broadcasts.length === 0 && (
          <div className="text-center py-20 text-muted-foreground">
            <Mail className="w-8 h-8 mx-auto mb-3 opacity-30" />
            <p className="font-medium">No broadcasts yet</p>
            <p className="text-sm mt-1">Create your first broadcast to get started</p>
          </div>
        )}
      </div>
    </div>
  );
}
