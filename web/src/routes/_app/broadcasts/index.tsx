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
import { Plus, Send, Mail, Zap } from "lucide-react";
import { toast } from "sonner";
import { useWorkspaceShape } from "@/hooks/use-workspace-shape";
import { cn } from "@/lib/utils";
import { format } from "date-fns";

export const Route = createFileRoute("/_app/broadcasts/")({
  component: BroadcastsPage,
});

interface Broadcast {
  id: string;
  name: string;
  subject: string;
  status: string;
  recipient_count: number;
  sent_count: number;
  open_count: number;
  click_count: number;
  sent_at: string | null;
  created_at: string;
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

function SendProgress({
  sentCount,
  recipientCount,
}: {
  sentCount: number;
  recipientCount: number;
}) {
  if (!recipientCount) return null;
  const pct = Math.round((sentCount / recipientCount) * 100);
  return (
    <div className="mt-3">
      <div className="mb-1.5 flex justify-between text-xs text-muted-foreground">
        <span className="flex items-center gap-1">
          <Zap className="h-3 w-3 animate-pulse text-muted-foreground" />
          Sending live…
        </span>
        <span className="tabular-nums">
          {sentCount.toLocaleString()} / {recipientCount.toLocaleString()} ({pct}%)
        </span>
      </div>
      <div className="h-1 w-full overflow-hidden rounded-full bg-muted">
        <div
          className="h-full rounded-full bg-foreground transition-all duration-500"
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}

function BroadcastCardSkeleton() {
  return (
    <div className="rounded-lg border bg-background p-4">
      <div className="flex items-start justify-between gap-4">
        <div className="flex-1 space-y-2">
          <div className="flex items-center gap-2">
            <div className="h-4 w-32 rounded shimmer" />
            <div className="h-5 w-14 rounded-full shimmer" />
          </div>
          <div className="h-3.5 w-48 rounded shimmer" />
        </div>
        <div className="h-3.5 w-10 rounded shimmer" />
      </div>
    </div>
  );
}

function BroadcastsPage() {
  const { activeWorkspaceId } = useWorkspaceStore();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const nameRef = useRef<HTMLInputElement>(null);
  const subjectRef = useRef<HTMLInputElement>(null);
  const htmlRef = useRef<HTMLTextAreaElement>(null);
  const [selectedSegmentIds, setSelectedSegmentIds] = useState<string[]>([]);

  const { data: liveBroadcasts, isLoading: electricLoading } =
    useWorkspaceShape<Broadcast>("broadcasts");

  const { data: apiBroadcasts = [], isLoading: apiLoading } = useQuery<Broadcast[]>({
    queryKey: ["broadcasts", activeWorkspaceId],
    queryFn: () => sessionFetch(activeWorkspaceId!, "/broadcasts"),
    enabled: !!activeWorkspaceId && electricLoading,
  });

  const isLoading = electricLoading && apiLoading;

  const broadcasts = (liveBroadcasts?.length ? liveBroadcasts : apiBroadcasts)
    .slice()
    .sort(
      (a, b) =>
        new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
    );

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
      toast.success("Broadcast sending — watching live…");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div className="mx-auto max-w-5xl px-8 py-8">
      {/* Header */}
      <div className="mb-7 flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold tracking-tight">Broadcasts</h1>
          <p className="mt-0.5 text-sm text-muted-foreground">
            One-off email campaigns · live via ElectricSQL
          </p>
        </div>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button size="sm">
              <Plus className="h-4 w-4" />
              New Broadcast
            </Button>
          </DialogTrigger>
          <DialogContent className="max-w-xl">
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
                <div className="flex flex-wrap gap-1.5">
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
                      className={cn(
                        "rounded-full border px-3 py-1 text-xs font-medium transition-colors duration-150 cursor-pointer active:scale-95",
                        selectedSegmentIds.includes(seg.id)
                          ? "border-foreground bg-foreground text-background"
                          : "border-border hover:bg-accent"
                      )}
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
                  className="w-full min-h-[160px] resize-y rounded-md border border-input bg-transparent px-3 py-2 font-mono text-xs focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                />
              </div>
              <DialogFooter>
                <Button type="submit" disabled={createMutation.isPending}>
                  {createMutation.isPending ? "Creating…" : "Create Broadcast"}
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
            <BroadcastCardSkeleton key={i} />
          ))}

        {!isLoading &&
          broadcasts.map((broadcast) => (
            <div
              key={broadcast.id}
              className="rounded-lg border bg-background p-4 transition-colors duration-150 hover:bg-accent/30"
            >
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="truncate font-medium text-sm">
                      {broadcast.name}
                    </span>
                    <Badge variant={STATUS_BADGE[broadcast.status] ?? "secondary"}>
                      {broadcast.status}
                    </Badge>
                  </div>
                  <p className="mt-0.5 truncate text-sm text-muted-foreground">
                    {broadcast.subject}
                  </p>
                  {(broadcast.status === "sent" ||
                    broadcast.status === "sending") && (
                    <p className="mt-1 text-xs text-muted-foreground tabular-nums">
                      {(broadcast.sent_count ?? 0).toLocaleString()} sent
                      {broadcast.open_count
                        ? ` · ${broadcast.open_count.toLocaleString()} opens`
                        : ""}
                      {broadcast.click_count
                        ? ` · ${broadcast.click_count.toLocaleString()} clicks`
                        : ""}
                    </p>
                  )}
                  {broadcast.status === "sending" && (
                    <SendProgress
                      sentCount={broadcast.sent_count ?? 0}
                      recipientCount={broadcast.recipient_count ?? 0}
                    />
                  )}
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <span className="text-xs text-muted-foreground tabular-nums">
                    {format(new Date(broadcast.created_at), "MMM d")}
                  </span>
                  {broadcast.status === "draft" && (
                    <Button
                      size="sm"
                      onClick={() => sendMutation.mutate(broadcast.id)}
                      disabled={sendMutation.isPending}
                    >
                      <Send className="h-3.5 w-3.5" />
                      Send
                    </Button>
                  )}
                </div>
              </div>
            </div>
          ))}

        {!isLoading && broadcasts.length === 0 && (
          <div className="flex flex-col items-center justify-center py-20 text-center">
            <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-lg border bg-background">
              <Mail className="h-5 w-5 text-muted-foreground" />
            </div>
            <p className="font-medium text-sm">No broadcasts yet</p>
            <p className="mt-1 text-sm text-muted-foreground">
              Send a one-off email to any segment
            </p>
            <Button
              size="sm"
              className="mt-4"
              onClick={() => setOpen(true)}
            >
              <Plus className="h-4 w-4" />
              New Broadcast
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
