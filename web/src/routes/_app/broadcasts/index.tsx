import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { sessionFetch } from "@/lib/api";
import { useWorkspaceStore } from "@/store/workspace";
import { useState, useRef, useMemo } from "react";
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
  Plus, Send, Mail, Zap, Trash2, Monitor, Smartphone,
  BarChart2, MousePointerClick, Eye,
} from "lucide-react";
import { toast } from "sonner";
import { useWorkspaceShape } from "@/hooks/use-workspace-shape";
import { cn } from "@/lib/utils";
import { format } from "date-fns";

export const Route = createFileRoute("/_app/broadcasts/")({
  component: BroadcastsPage,
});

interface Broadcast extends Record<string, unknown> {
  id: string;
  name: string;
  subject: string;
  status: string;
  fromEmail: string | null;
  fromName: string | null;
  htmlContent: string | null;
  templateId: string | null;
  segmentIds: string[];
  scheduledAt: string | null;
  sentAt: string | null;
  recipientCount: number;
  sentCount: number;
  openCount: number;
  clickCount: number;
  createdAt: string;
  updatedAt: string;
  // snake_case aliases for Electric shape
  recipient_count?: number;
  sent_count?: number;
  open_count?: number;
  click_count?: number;
  sent_at?: string | null;
  created_at?: string;
}

function normalizeBroadcast(b: Record<string, unknown>): Broadcast {
  return {
    ...b,
    id: b.id as string,
    name: b.name as string,
    subject: b.subject as string,
    status: b.status as string,
    fromEmail: (b.fromEmail ?? b.from_email ?? null) as string | null,
    fromName: (b.fromName ?? b.from_name ?? null) as string | null,
    htmlContent: (b.htmlContent ?? b.html_content ?? null) as string | null,
    templateId: (b.templateId ?? b.template_id ?? null) as string | null,
    segmentIds: (b.segmentIds ?? b.segment_ids ?? []) as string[],
    scheduledAt: (b.scheduledAt ?? b.scheduled_at ?? null) as string | null,
    sentAt: (b.sentAt ?? b.sent_at ?? null) as string | null,
    recipientCount: ((b.recipientCount ?? b.recipient_count ?? 0) as number),
    sentCount: ((b.sentCount ?? b.sent_count ?? 0) as number),
    openCount: ((b.openCount ?? b.open_count ?? 0) as number),
    clickCount: ((b.clickCount ?? b.click_count ?? 0) as number),
    createdAt: ((b.createdAt ?? b.created_at ?? "") as string),
    updatedAt: ((b.updatedAt ?? b.updated_at ?? "") as string),
  };
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
    <div className="rounded-lg border border-border bg-card p-4">
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

// ─── Detail / Edit Dialog ────────────────────────────────────────────────────

function BroadcastDetailDialog({
  broadcast,
  onClose,
  segments,
  onSendSuccess,
  onDeleteSuccess,
  workspaceId,
}: {
  broadcast: Broadcast;
  onClose: () => void;
  segments: { id: string; name: string }[];
  onSendSuccess: () => void;
  onDeleteSuccess: () => void;
  workspaceId: string;
}) {
  const qc = useQueryClient();
  const isDraft = broadcast.status === "draft";

  // Editable state (only meaningful for draft)
  const [name, setName] = useState(broadcast.name);
  const [subject, setSubject] = useState(broadcast.subject);
  const [fromName, setFromName] = useState(broadcast.fromName ?? "");
  const [fromEmail, setFromEmail] = useState(broadcast.fromEmail ?? "");
  const [htmlContent, setHtmlContent] = useState(broadcast.htmlContent ?? "");
  const [selectedSegmentIds, setSelectedSegmentIds] = useState<string[]>(broadcast.segmentIds ?? []);
  const [previewMobile, setPreviewMobile] = useState(false);
  const [sendConfirm, setSendConfirm] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState(false);

  const saveMutation = useMutation({
    mutationFn: () =>
      sessionFetch(workspaceId, `/broadcasts/${broadcast.id}`, {
        method: "PATCH",
        body: JSON.stringify({
          name,
          subject,
          fromName: fromName || undefined,
          fromEmail: fromEmail || undefined,
          htmlContent,
          segmentIds: selectedSegmentIds,
        }),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["broadcasts", workspaceId] });
      toast.success("Broadcast saved");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const sendMutation = useMutation({
    mutationFn: () =>
      sessionFetch(workspaceId, `/broadcasts/${broadcast.id}/send`, { method: "POST" }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["broadcasts", workspaceId] });
      toast.success("Sending — watch the progress bar update live");
      onSendSuccess();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const deleteMutation = useMutation({
    mutationFn: () =>
      sessionFetch(workspaceId, `/broadcasts/${broadcast.id}`, { method: "DELETE" }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["broadcasts", workspaceId] });
      toast.success("Broadcast deleted");
      onDeleteSuccess();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const previewHtml = htmlContent;

  return (
    <>
      <Dialog open onOpenChange={(o) => !o && onClose()}>
        <DialogContent className="max-w-[96vw] w-[96vw] h-[92vh] p-0 gap-0 flex flex-col overflow-hidden">
          {/* Top bar */}
          <DialogHeader className="shrink-0 flex flex-row items-center justify-between px-5 py-3 border-b border-border">
            <div className="flex items-center gap-2.5 min-w-0">
              <DialogTitle className="text-[14px] font-semibold truncate max-w-[300px]">
                {broadcast.name}
              </DialogTitle>
              <Badge variant={STATUS_BADGE[broadcast.status] ?? "secondary"} className="shrink-0">
                {broadcast.status}
              </Badge>
            </div>
            <div className="flex items-center gap-2 mr-8">
              <div className="flex items-center rounded-md border border-border p-0.5 gap-0.5">
                <button
                  type="button"
                  onClick={() => setPreviewMobile(false)}
                  className={cn(
                    "rounded px-2 py-1 transition-colors cursor-pointer",
                    !previewMobile ? "bg-foreground text-background" : "text-muted-foreground hover:text-foreground"
                  )}
                >
                  <Monitor className="h-3.5 w-3.5" />
                </button>
                <button
                  type="button"
                  onClick={() => setPreviewMobile(true)}
                  className={cn(
                    "rounded px-2 py-1 transition-colors cursor-pointer",
                    previewMobile ? "bg-foreground text-background" : "text-muted-foreground hover:text-foreground"
                  )}
                >
                  <Smartphone className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>
          </DialogHeader>

          {/* Body */}
          <div className="flex flex-1 min-h-0">
            {/* Left panel — fields */}
            <div className="flex flex-col w-[400px] shrink-0 border-r border-border overflow-y-auto">
              <div className="flex-1 space-y-4 p-5">

                {/* Stats row (sent/sending) */}
                {(broadcast.status === "sent" || broadcast.status === "sending") && (
                  <div className="grid grid-cols-3 gap-2">
                    {[
                      { icon: Send, label: "Sent", value: broadcast.sentCount },
                      { icon: Eye, label: "Opens", value: broadcast.openCount },
                      { icon: MousePointerClick, label: "Clicks", value: broadcast.clickCount },
                    ].map(({ icon: Icon, label, value }) => (
                      <div key={label} className="rounded-lg border border-border bg-muted/30 px-3 py-2.5 text-center">
                        <Icon className="h-3.5 w-3.5 mx-auto mb-1 text-muted-foreground" />
                        <p className="text-[15px] font-semibold tabular-nums">{(value ?? 0).toLocaleString()}</p>
                        <p className="text-[10px] text-muted-foreground">{label}</p>
                      </div>
                    ))}
                  </div>
                )}

                {broadcast.status === "sending" && (
                  <SendProgress sentCount={broadcast.sentCount} recipientCount={broadcast.recipientCount} />
                )}

                <div className="space-y-1.5">
                  <Label>Name</Label>
                  {isDraft ? (
                    <Input value={name} onChange={(e) => setName(e.target.value)} />
                  ) : (
                    <p className="text-[13px] text-muted-foreground">{broadcast.name}</p>
                  )}
                </div>

                <div className="space-y-1.5">
                  <Label>Subject</Label>
                  {isDraft ? (
                    <Input value={subject} onChange={(e) => setSubject(e.target.value)} />
                  ) : (
                    <p className="text-[13px] text-muted-foreground">{broadcast.subject}</p>
                  )}
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <Label>From Name</Label>
                    {isDraft ? (
                      <Input value={fromName} onChange={(e) => setFromName(e.target.value)} placeholder="Team Name" />
                    ) : (
                      <p className="text-[13px] text-muted-foreground">{broadcast.fromName || "—"}</p>
                    )}
                  </div>
                  <div className="space-y-1.5">
                    <Label>From Email</Label>
                    {isDraft ? (
                      <Input value={fromEmail} onChange={(e) => setFromEmail(e.target.value)} placeholder="hello@you.com" />
                    ) : (
                      <p className="text-[13px] text-muted-foreground">{broadcast.fromEmail || "—"}</p>
                    )}
                  </div>
                </div>

                <div className="space-y-1.5">
                  <Label>Segments</Label>
                  {isDraft ? (
                    segments.length === 0 ? (
                      <p className="text-[12px] text-muted-foreground">No segments yet.</p>
                    ) : (
                      <div className="flex flex-wrap gap-1.5">
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
                              "rounded-full border px-3 py-1 text-xs font-medium transition-colors duration-150 cursor-pointer",
                              selectedSegmentIds.includes(seg.id)
                                ? "border-foreground bg-foreground text-background"
                                : "border-border hover:bg-accent"
                            )}
                          >
                            {seg.name}
                          </button>
                        ))}
                      </div>
                    )
                  ) : (
                    <div className="flex flex-wrap gap-1.5">
                      {(broadcast.segmentIds ?? []).map((id) => {
                        const seg = segments.find((s) => s.id === id);
                        return (
                          <span
                            key={id}
                            className="rounded-full border border-border px-3 py-1 text-xs font-medium bg-muted/50"
                          >
                            {seg?.name ?? id}
                          </span>
                        );
                      })}
                      {(!broadcast.segmentIds || broadcast.segmentIds.length === 0) && (
                        <p className="text-[12px] text-muted-foreground">None</p>
                      )}
                    </div>
                  )}
                </div>

                <div className="space-y-1.5 flex flex-col flex-1">
                  <Label>HTML Content</Label>
                  {isDraft ? (
                    <textarea
                      value={htmlContent}
                      onChange={(e) => setHtmlContent(e.target.value)}
                      placeholder="<h1>Hello {{firstName}}!</h1>"
                      className="flex-1 w-full min-h-[240px] resize-none rounded-md border border-input bg-input px-3 py-2 font-mono text-xs focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                    />
                  ) : (
                    <p className="text-[12px] text-muted-foreground font-mono truncate">
                      {broadcast.htmlContent ? `${broadcast.htmlContent.slice(0, 80)}…` : "—"}
                    </p>
                  )}
                </div>

                {broadcast.sentAt && (
                  <p className="text-[11px] text-muted-foreground">
                    Sent {format(new Date(broadcast.sentAt), "MMM d, yyyy 'at' h:mm a")}
                  </p>
                )}
              </div>

              {/* Footer actions */}
              <div className="shrink-0 px-5 py-3 border-t border-border bg-card space-y-2">
                {isDraft && (
                  <>
                    <Button
                      className="w-full"
                      disabled={saveMutation.isPending}
                      onClick={() => saveMutation.mutate()}
                    >
                      {saveMutation.isPending ? "Saving…" : "Save Changes"}
                    </Button>
                    <div className="flex gap-2">
                      <Button
                        variant="default"
                        className="flex-1"
                        onClick={() => setSendConfirm(true)}
                      >
                        <Send className="h-3.5 w-3.5" />
                        Send Now
                      </Button>
                      <button
                        type="button"
                        onClick={() => setDeleteConfirm(true)}
                        className="rounded-md px-3 py-2 text-muted-foreground hover:bg-destructive/10 hover:text-destructive transition-colors cursor-pointer border border-border"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </>
                )}
                {broadcast.status === "sent" && (
                  <button
                    type="button"
                    onClick={() => setDeleteConfirm(true)}
                    className="w-full flex items-center justify-center gap-2 rounded-md px-3 py-2 text-[13px] text-muted-foreground hover:bg-destructive/10 hover:text-destructive transition-colors cursor-pointer border border-border"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                    Delete Broadcast
                  </button>
                )}
                {broadcast.status === "failed" && (
                  <button
                    type="button"
                    onClick={() => setDeleteConfirm(true)}
                    className="w-full flex items-center justify-center gap-2 rounded-md px-3 py-2 text-[13px] text-muted-foreground hover:bg-destructive/10 hover:text-destructive transition-colors cursor-pointer border border-border"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                    Delete Broadcast
                  </button>
                )}
              </div>
            </div>

            {/* Right panel — live preview */}
            <div className="flex-1 flex flex-col min-w-0 bg-muted/30">
              <div className="shrink-0 flex items-center justify-between px-4 py-2 border-b border-border">
                <span className="text-[11px] font-medium text-muted-foreground uppercase tracking-wide">Preview</span>
                {previewHtml && isDraft && (
                  <span className="text-[10px] text-muted-foreground">Live</span>
                )}
              </div>
              <div className="flex-1 flex items-start justify-center overflow-auto p-6">
                {previewHtml ? (
                  <div
                    className={cn(
                      "h-full transition-all duration-200",
                      previewMobile ? "w-[375px]" : "w-full max-w-[680px]"
                    )}
                  >
                    <iframe
                      srcDoc={previewHtml}
                      sandbox="allow-same-origin"
                      className="w-full h-full min-h-[600px] rounded-lg border border-border bg-white shadow-sm"
                      title="Email preview"
                    />
                  </div>
                ) : (
                  <div className="flex flex-col items-center justify-center h-full text-center gap-2 opacity-40">
                    <BarChart2 className="h-8 w-8 text-muted-foreground" />
                    <p className="text-[12px] text-muted-foreground">
                      {isDraft ? "Start typing HTML to see a live preview" : "No HTML content"}
                    </p>
                  </div>
                )}
              </div>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Send confirm */}
      <AlertDialog open={sendConfirm} onOpenChange={setSendConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Send broadcast?</AlertDialogTitle>
            <AlertDialogDescription>
              <strong className="text-foreground font-medium">{broadcast.name}</strong>{" "}
              will be sent to all contacts in the selected segments. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={sendMutation.isPending}
              onClick={() => { sendMutation.mutate(); setSendConfirm(false); }}
            >
              Send now
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Delete confirm */}
      <AlertDialog open={deleteConfirm} onOpenChange={setDeleteConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete broadcast?</AlertDialogTitle>
            <AlertDialogDescription>
              <strong className="text-foreground font-medium">{broadcast.name}</strong>{" "}
              will be permanently deleted. This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={deleteMutation.isPending}
              onClick={() => { deleteMutation.mutate(); setDeleteConfirm(false); }}
            >
              {deleteMutation.isPending ? "Deleting…" : "Delete"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

// ─── Page ────────────────────────────────────────────────────────────────────

function BroadcastsPage() {
  const { activeWorkspaceId } = useWorkspaceStore();
  const qc = useQueryClient();

  // Create dialog state
  const [createOpen, setCreateOpen] = useState(false);
  const [selectedSegmentIds, setSelectedSegmentIds] = useState<string[]>([]);
  const [createHtml, setCreateHtml] = useState("");
  const [createPreviewMobile, setCreatePreviewMobile] = useState(false);
  const nameRef = useRef<HTMLInputElement>(null);
  const subjectRef = useRef<HTMLInputElement>(null);

  // Detail view state
  const [detailBroadcast, setDetailBroadcast] = useState<Broadcast | null>(null);

  // REST source of truth
  const { data: restBroadcasts = [], isLoading } = useQuery<Broadcast[]>({
    queryKey: ["broadcasts", activeWorkspaceId],
    queryFn: () =>
      sessionFetch<Record<string, unknown>[]>(activeWorkspaceId!, "/broadcasts").then(
        (data) => data.map(normalizeBroadcast)
      ),
    enabled: !!activeWorkspaceId,
  });

  // Electric live overlay (progress + status)
  const { data: rawElectricBroadcasts } =
    useWorkspaceShape<Record<string, unknown>>("broadcasts");

  const broadcasts = useMemo(() => {
    const electricById = new Map(
      (rawElectricBroadcasts ?? []).map((b) => {
        const n = normalizeBroadcast(b);
        return [n.id, n];
      })
    );
    return restBroadcasts
      .map((b) => {
        const live = electricById.get(b.id);
        return live
          ? { ...b, status: live.status, sentCount: live.sentCount, recipientCount: live.recipientCount, openCount: live.openCount, clickCount: live.clickCount }
          : b;
      })
      .slice()
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  }, [restBroadcasts, rawElectricBroadcasts]);

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
      setCreateOpen(false);
      setSelectedSegmentIds([]);
      setCreateHtml("");
      if (nameRef.current) nameRef.current.value = "";
      if (subjectRef.current) subjectRef.current.value = "";
      toast.success("Broadcast created");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div className="px-8 py-7 w-full">
      {/* Header */}
      <div className="mb-5 flex items-center justify-between">
        <div>
          <h1 className="text-[15px] font-semibold tracking-tight">Broadcasts</h1>
          <p className="mt-0.5 text-[12px] text-muted-foreground">
            One-off email campaigns
          </p>
        </div>

        {/* Create Dialog */}
        <Dialog
          open={createOpen}
          onOpenChange={(v) => {
            setCreateOpen(v);
            if (!v) { setSelectedSegmentIds([]); setCreateHtml(""); }
          }}
        >
          <DialogTrigger asChild>
            <Button size="sm">
              <Plus className="h-3.5 w-3.5" />
              New Broadcast
            </Button>
          </DialogTrigger>
          <DialogContent className="max-w-[96vw] w-[96vw] h-[92vh] p-0 gap-0 flex flex-col overflow-hidden">
            <DialogHeader className="shrink-0 flex flex-row items-center justify-between px-5 py-3 border-b border-border">
              <DialogTitle className="text-[14px] font-semibold">New Broadcast</DialogTitle>
              <div className="flex items-center gap-2 mr-8">
                <div className="flex items-center rounded-md border border-border p-0.5 gap-0.5">
                  <button
                    type="button"
                    onClick={() => setCreatePreviewMobile(false)}
                    className={cn(
                      "rounded px-2 py-1 transition-colors cursor-pointer",
                      !createPreviewMobile ? "bg-foreground text-background" : "text-muted-foreground hover:text-foreground"
                    )}
                  >
                    <Monitor className="h-3.5 w-3.5" />
                  </button>
                  <button
                    type="button"
                    onClick={() => setCreatePreviewMobile(true)}
                    className={cn(
                      "rounded px-2 py-1 transition-colors cursor-pointer",
                      createPreviewMobile ? "bg-foreground text-background" : "text-muted-foreground hover:text-foreground"
                    )}
                  >
                    <Smartphone className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>
            </DialogHeader>

            <div className="flex flex-1 min-h-0">
              {/* Left — form */}
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
                    htmlContent: createHtml,
                    segmentIds: selectedSegmentIds,
                  });
                }}
                className="flex flex-col w-[400px] shrink-0 border-r border-border overflow-y-auto"
              >
                <div className="flex-1 space-y-4 p-5">
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
                    {segments.length === 0 ? (
                      <div className="rounded-lg border border-dashed px-4 py-3 text-[12px] text-muted-foreground">
                        No segments yet.{" "}
                        <Link
                          to="/segments"
                          onClick={() => setCreateOpen(false)}
                          className="font-medium text-foreground hover:underline"
                        >
                          Create a segment
                        </Link>{" "}
                        first.
                      </div>
                    ) : (
                      <div className="flex flex-wrap gap-1.5">
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
                              "rounded-full border px-3 py-1 text-xs font-medium transition-colors duration-150 cursor-pointer",
                              selectedSegmentIds.includes(seg.id)
                                ? "border-foreground bg-foreground text-background"
                                : "border-border hover:bg-accent"
                            )}
                          >
                            {seg.name}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                  <div className="space-y-1.5 flex flex-col flex-1">
                    <Label>HTML Content *</Label>
                    <textarea
                      required
                      value={createHtml}
                      onChange={(e) => setCreateHtml(e.target.value)}
                      placeholder="<h1>Hello {{firstName}}!</h1>"
                      className="flex-1 w-full min-h-[300px] resize-none rounded-md border border-input bg-input px-3 py-2 font-mono text-xs focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                    />
                  </div>
                </div>
                <div className="shrink-0 px-5 py-3 border-t border-border bg-card">
                  <Button type="submit" className="w-full" disabled={createMutation.isPending}>
                    {createMutation.isPending ? "Creating…" : "Create Broadcast"}
                  </Button>
                </div>
              </form>

              {/* Right — live preview */}
              <div className="flex-1 flex flex-col min-w-0 bg-muted/30">
                <div className="shrink-0 flex items-center justify-between px-4 py-2 border-b border-border">
                  <span className="text-[11px] font-medium text-muted-foreground uppercase tracking-wide">Preview</span>
                  {createHtml && <span className="text-[10px] text-muted-foreground">Live</span>}
                </div>
                <div className="flex-1 flex items-start justify-center overflow-auto p-6">
                  {createHtml ? (
                    <div className={cn("h-full transition-all duration-200", createPreviewMobile ? "w-[375px]" : "w-full max-w-[680px]")}>
                      <iframe
                        srcDoc={createHtml}
                        sandbox="allow-same-origin"
                        className="w-full h-full min-h-[600px] rounded-lg border border-border bg-white shadow-sm"
                        title="Email preview"
                      />
                    </div>
                  ) : (
                    <div className="flex flex-col items-center justify-center h-full text-center gap-2 opacity-40">
                      <Monitor className="h-8 w-8 text-muted-foreground" />
                      <p className="text-[12px] text-muted-foreground">Start typing HTML to see a live preview</p>
                    </div>
                  )}
                </div>
              </div>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      {/* List */}
      <div className="space-y-2">
        {isLoading &&
          Array.from({ length: 3 }).map((_, i) => <BroadcastCardSkeleton key={i} />)}

        {!isLoading &&
          broadcasts.map((broadcast) => (
            <div
              key={broadcast.id}
              onClick={() => setDetailBroadcast(broadcast)}
              className="group rounded-lg border border-border bg-card p-4 transition-colors duration-150 hover:bg-accent/50 cursor-pointer"
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
                  <p className="mt-0.5 truncate text-[12px] text-muted-foreground">
                    {broadcast.subject}
                  </p>
                  {(broadcast.status === "sent" || broadcast.status === "sending") && (
                    <p className="mt-1 text-xs text-muted-foreground tabular-nums">
                      {(broadcast.sentCount ?? 0).toLocaleString()} sent
                      {broadcast.openCount
                        ? ` · ${broadcast.openCount.toLocaleString()} opens`
                        : ""}
                      {broadcast.clickCount
                        ? ` · ${broadcast.clickCount.toLocaleString()} clicks`
                        : ""}
                    </p>
                  )}
                  {broadcast.status === "sending" && (
                    <SendProgress
                      sentCount={broadcast.sentCount ?? 0}
                      recipientCount={broadcast.recipientCount ?? 0}
                    />
                  )}
                </div>
                <div
                  className="flex shrink-0 items-center gap-1.5"
                  onClick={(e) => e.stopPropagation()}
                >
                  <span className="text-[11px] text-muted-foreground tabular-nums opacity-0 transition-opacity duration-150 group-hover:opacity-100">
                    {broadcast.createdAt ? format(new Date(broadcast.createdAt), "MMM d") : ""}
                  </span>
                  {broadcast.status === "draft" && (
                    <Button
                      size="sm"
                      onClick={(e) => {
                        e.stopPropagation();
                        setDetailBroadcast(broadcast);
                      }}
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
            <div className="mb-4 flex h-9 w-9 items-center justify-center rounded-lg border border-border">
              <Mail className="h-5 w-5 text-muted-foreground" />
            </div>
            <p className="text-[13px] font-medium">No broadcasts yet</p>
            <p className="mt-1 text-[12px] text-muted-foreground">
              Send a one-off email to any audience segment
            </p>
            <Button size="sm" className="mt-4" onClick={() => setCreateOpen(true)}>
              <Plus className="h-3.5 w-3.5" />
              New Broadcast
            </Button>
          </div>
        )}
      </div>

      {/* Detail / Edit dialog */}
      {detailBroadcast && activeWorkspaceId && (
        <BroadcastDetailDialog
          broadcast={detailBroadcast}
          onClose={() => setDetailBroadcast(null)}
          segments={segments}
          onSendSuccess={() => setDetailBroadcast(null)}
          onDeleteSuccess={() => setDetailBroadcast(null)}
          workspaceId={activeWorkspaceId}
        />
      )}
    </div>
  );
}
