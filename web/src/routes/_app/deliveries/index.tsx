import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { sessionFetch } from "@/lib/api";
import { useWorkspaceStore } from "@/store/workspace";
import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  Inbox, Search, RefreshCw, Mail, Monitor, Smartphone,
  ExternalLink, MousePointerClick, Eye, TriangleAlert, Ban,
} from "lucide-react";
import { format, isToday, isYesterday } from "date-fns";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_app/deliveries/")({
  component: DeliveriesPage,
});

// ── Types ──────────────────────────────────────────────────────────────────────

interface EmailSend {
  id: string;
  contactEmail: string;
  subject: string;
  status: string;
  broadcastId: string | null;
  campaignId: string | null;
  resendMessageId: string | null;
  failureReason: string | null;
  sentAt: string | null;
  failedAt: string | null;
  createdAt: string;
}

interface EmailEvent {
  id: string;
  eventType: string;
  occurredAt: string;
  metadata: Record<string, unknown> | null;
}

interface SendDetail extends EmailSend {
  events: EmailEvent[];
  emailHtml: string | null;
  lastEvent: string | null;
}

// ── Constants ──────────────────────────────────────────────────────────────────

const STATUS_BADGE: Record<string, "success" | "warning" | "destructive" | "secondary"> = {
  sent:     "success",
  bounced:  "warning",
  failed:   "destructive",
  queued:   "secondary",
};

const EVENT_ICON: Record<string, React.ReactNode> = {
  open:        <Eye className="h-3.5 w-3.5 text-blue-500" />,
  click:       <MousePointerClick className="h-3.5 w-3.5 text-green-500" />,
  bounce:      <TriangleAlert className="h-3.5 w-3.5 text-amber-500" />,
  complaint:   <Ban className="h-3.5 w-3.5 text-red-500" />,
  unsubscribe: <Ban className="h-3.5 w-3.5 text-muted-foreground" />,
};

const PAGE_SIZE = 50;

type BroadcastDraft = {
  id: string; name: string; subject: string; status: string; createdAt: string;
};

// ── Helpers ────────────────────────────────────────────────────────────────────

function formatDate(dateStr: string): string {
  const d = new Date(dateStr);
  if (isToday(d)) return `Today at ${format(d, "h:mm a")}`;
  if (isYesterday(d)) return `Yesterday at ${format(d, "h:mm a")}`;
  return format(d, "MMM d, yyyy 'at' h:mm a");
}

function formatEventDate(dateStr: string): string {
  return format(new Date(dateStr), "MMM d 'at' h:mm a");
}

// ── Email Preview Dialog ───────────────────────────────────────────────────────

function EmailPreviewDialog({
  sendId,
  workspaceId,
  onClose,
}: {
  sendId: string;
  workspaceId: string;
  onClose: () => void;
}) {
  const [previewMobile, setPreviewMobile] = useState(false);

  const { data, isLoading, isError } = useQuery<SendDetail>({
    queryKey: ["send-detail", workspaceId, sendId],
    queryFn: () => sessionFetch<SendDetail>(workspaceId, `/sends/${sendId}`),
    staleTime: 60_000,
  });

  return (
    <Dialog open onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent className="max-w-[92vw] w-[1100px] h-[88vh] p-0 flex flex-col gap-0 overflow-hidden">
        {/* Header */}
        <DialogHeader className="shrink-0 px-5 py-4 border-b border-border">
          <div className="flex items-center gap-3 min-w-0">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-muted shrink-0">
              <Mail className="h-4 w-4 text-muted-foreground" />
            </div>
            <div className="min-w-0">
              <DialogTitle className="text-[14px] font-semibold truncate">
                {isLoading ? "Loading…" : data?.subject ?? "Email preview"}
              </DialogTitle>
              {data && (
                <p className="text-[11px] text-muted-foreground mt-0.5 font-mono">{data.contactEmail}</p>
              )}
            </div>
            {data && (
              <Badge
                variant={STATUS_BADGE[data.status] ?? "secondary"}
                className="ml-auto shrink-0 text-[10px]"
              >
                {data.lastEvent ?? data.status}
              </Badge>
            )}
          </div>
        </DialogHeader>

        {/* Body */}
        <div className="flex flex-1 min-h-0 overflow-hidden">
          {/* ── Left panel: metadata + events ──────────────────────────── */}
          <div className="w-[260px] shrink-0 border-r border-border flex flex-col overflow-y-auto">
            {isLoading && (
              <div className="p-5 space-y-3">
                {Array.from({ length: 6 }).map((_, i) => (
                  <div key={i} className="h-3 rounded shimmer" style={{ width: `${60 + (i % 3) * 15}%` }} />
                ))}
              </div>
            )}

            {isError && (
              <div className="p-5 text-[12px] text-destructive">Failed to load email details.</div>
            )}

            {data && (
              <>
                {/* Metadata */}
                <div className="p-5 space-y-3 border-b border-border">
                  <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide">Details</p>

                  <Detail label="To" value={<span className="font-mono text-[11px]">{data.contactEmail}</span>} />
                  <Detail label="Sent" value={data.sentAt ? formatDate(data.sentAt) : data.createdAt ? formatDate(data.createdAt) : "—"} />
                  {data.broadcastId && (
                    <Detail label="Broadcast" value={
                      <Link to="/broadcasts" className="text-primary hover:underline">
                        View broadcast
                      </Link>
                    } />
                  )}
                  {data.campaignId && (
                    <Detail label="Campaign" value={
                      <Link to="/campaigns" className="text-primary hover:underline">
                        View campaign
                      </Link>
                    } />
                  )}
                  {data.resendMessageId && (
                    <Detail label="Message ID" value={
                      <span className="font-mono text-[10px] text-muted-foreground break-all">
                        {data.resendMessageId}
                      </span>
                    } />
                  )}
                  {data.failureReason && (
                    <Detail label="Failure" value={
                      <span className="text-destructive">{data.failureReason}</span>
                    } />
                  )}
                </div>

                {/* Email events */}
                <div className="p-5 flex-1">
                  <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide mb-3">
                    Events
                    {data.events.length > 0 && (
                      <span className="ml-1.5 font-normal">({data.events.length})</span>
                    )}
                  </p>

                  {data.events.length === 0 ? (
                    <p className="text-[12px] text-muted-foreground">No tracked events yet.</p>
                  ) : (
                    <div className="space-y-2">
                      {data.events.map((ev) => (
                        <div key={ev.id} className="flex items-start gap-2">
                          <span className="mt-0.5 shrink-0">
                            {EVENT_ICON[ev.eventType] ?? <Mail className="h-3.5 w-3.5 text-muted-foreground" />}
                          </span>
                          <div className="min-w-0">
                            <p className="text-[12px] font-medium capitalize">{ev.eventType}</p>
                            <p className="text-[10px] text-muted-foreground">{formatEventDate(ev.occurredAt)}</p>
                            {ev.eventType === "click" && typeof ev.metadata?.url === "string" && (
                              <a
                                href={ev.metadata.url}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="flex items-center gap-1 text-[10px] text-primary hover:underline mt-0.5 truncate"
                              >
                                <ExternalLink className="h-2.5 w-2.5 shrink-0" />
                                <span className="truncate">{ev.metadata.url}</span>
                              </a>
                            )}
                            {ev.eventType === "bounce" && typeof ev.metadata?.message === "string" && (
                              <p className="text-[10px] text-muted-foreground mt-0.5 break-words">
                                {ev.metadata.message}
                              </p>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </>
            )}
          </div>

          {/* ── Right panel: email iframe ───────────────────────────────── */}
          <div className="flex-1 flex flex-col min-w-0 bg-muted/30">
            {/* Preview viewport toggle */}
            <div className="shrink-0 flex items-center justify-between px-4 py-2 border-b border-border">
              <span className="text-[11px] font-medium text-muted-foreground uppercase tracking-wide">
                Email Content
              </span>
              <div className="flex items-center rounded-md border border-border p-0.5 gap-0.5">
                <button
                  type="button"
                  onClick={() => setPreviewMobile(false)}
                  className={cn(
                    "flex items-center justify-center w-6 h-6 rounded transition-colors cursor-pointer",
                    !previewMobile ? "bg-foreground text-background" : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  <Monitor className="h-3 w-3" />
                </button>
                <button
                  type="button"
                  onClick={() => setPreviewMobile(true)}
                  className={cn(
                    "flex items-center justify-center w-6 h-6 rounded transition-colors cursor-pointer",
                    previewMobile ? "bg-foreground text-background" : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  <Smartphone className="h-3 w-3" />
                </button>
              </div>
            </div>

            <div className="flex-1 flex items-start justify-center overflow-auto p-6">
              {isLoading && (
                <div className="w-full max-w-[680px] space-y-4 pt-8">
                  <div className="h-6 rounded shimmer w-1/2 mx-auto" />
                  <div className="h-3 rounded shimmer w-3/4" />
                  <div className="h-3 rounded shimmer w-2/3" />
                  <div className="h-3 rounded shimmer w-4/5" />
                </div>
              )}

              {!isLoading && !data?.emailHtml && (
                <div className="flex flex-col items-center justify-center h-full text-center gap-2 opacity-40">
                  <Mail className="h-8 w-8 text-muted-foreground" />
                  <p className="text-[12px] text-muted-foreground">
                    {data?.status === "queued"
                      ? "This email hasn't been sent yet."
                      : "Email content is not available for this delivery."}
                  </p>
                </div>
              )}

              {!isLoading && data?.emailHtml && (
                <div
                  className={cn(
                    "h-full transition-all duration-200",
                    previewMobile ? "w-[375px]" : "w-full max-w-[680px]",
                  )}
                >
                  <iframe
                    srcDoc={data.emailHtml}
                    sandbox="allow-same-origin allow-popups"
                    className="w-full h-full min-h-[600px] rounded-lg border border-border bg-white shadow-sm"
                    title="Email preview"
                  />
                </div>
              )}
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function Detail({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <p className="text-[10px] text-muted-foreground">{label}</p>
      <div className="text-[12px] mt-0.5">{value}</div>
    </div>
  );
}

// ── Main page ──────────────────────────────────────────────────────────────────

function DeliveriesPage() {
  const { activeWorkspaceId } = useWorkspaceStore();
  const [activeTab, setActiveTab] = useState<"deliveries" | "drafts">("deliveries");
  const [page, setPage] = useState(1);
  const [statusFilter, setStatusFilter] = useState("");
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [selectedSendId, setSelectedSendId] = useState<string | null>(null);

  useEffect(() => {
    const t = setTimeout(() => { setDebouncedSearch(search); setPage(1); }, 300);
    return () => clearTimeout(t);
  }, [search]);

  const { data, isLoading, isError, refetch } = useQuery<{
    data: EmailSend[]; total: number; page: number; pageSize: number;
  }>({
    queryKey: ["sends", activeWorkspaceId, page, statusFilter, debouncedSearch],
    queryFn: () => {
      const params = new URLSearchParams({ page: String(page), pageSize: String(PAGE_SIZE) });
      if (statusFilter) params.set("status", statusFilter);
      if (debouncedSearch) params.set("search", debouncedSearch);
      return sessionFetch(activeWorkspaceId!, `/sends?${params}`);
    },
    enabled: !!activeWorkspaceId && activeTab === "deliveries",
    staleTime: 30_000,
  });

  const { data: drafts = [], isLoading: draftsLoading, isError: draftsError } = useQuery<BroadcastDraft[]>({
    queryKey: ["broadcasts-drafts", activeWorkspaceId],
    queryFn: () => sessionFetch(activeWorkspaceId!, "/broadcasts"),
    select: (all: BroadcastDraft[]) => all.filter((b) => b.status === "draft"),
    enabled: !!activeWorkspaceId && activeTab === "drafts",
  });

  const totalPages = data ? Math.ceil(data.total / PAGE_SIZE) : 1;

  return (
    <div className="px-8 py-7 w-full">
      {/* Header */}
      <div className="mb-5 flex items-center justify-between">
        <div>
          <h1 className="text-[15px] font-semibold tracking-tight">Deliveries & Drafts</h1>
          <p className="mt-0.5 text-[12px] text-muted-foreground">
            All sent emails across broadcasts and campaigns. Click any row to view the email.
          </p>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex items-center gap-1 mb-4 border-b border-border">
        {(["deliveries", "drafts"] as const).map((tab) => (
          <button
            key={tab}
            onClick={() => { setActiveTab(tab); setPage(1); }}
            className={cn(
              "px-4 py-2.5 text-[13px] font-medium border-b-2 -mb-px transition-colors cursor-pointer capitalize",
              activeTab === tab
                ? "border-foreground text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground",
            )}
          >
            {tab === "deliveries" ? "Deliveries" : "Drafts"}
            {tab === "deliveries" && data && (
              <span className="ml-1.5 text-[10px] text-muted-foreground tabular-nums">
                {data.total.toLocaleString()}
              </span>
            )}
            {tab === "drafts" && drafts.length > 0 && (
              <span className="ml-1.5 text-[10px] text-muted-foreground tabular-nums">
                {drafts.length}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* ── Deliveries tab ───────────────────────────────────────────────── */}
      {activeTab === "deliveries" && (
        <>
          {/* Filter bar */}
          <div className="flex items-center gap-2 mb-4 flex-wrap">
            <div className="relative flex-1 min-w-[200px] max-w-xs">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground/50" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search by email…"
                className="pl-9 h-8 text-[13px]"
              />
            </div>
            <select
              value={statusFilter}
              onChange={(e) => { setStatusFilter(e.target.value); setPage(1); }}
              className="h-8 rounded-md border border-input bg-input px-2.5 text-[12px] cursor-pointer focus:outline-none focus:ring-1 focus:ring-ring"
            >
              <option value="">All statuses</option>
              <option value="sent">Sent</option>
              <option value="queued">Queued</option>
              <option value="bounced">Bounced</option>
              <option value="failed">Failed</option>
            </select>
            <button
              onClick={() => refetch()}
              className="h-8 w-8 flex items-center justify-center rounded-md border border-input bg-input text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
              title="Refresh"
            >
              <RefreshCw className="h-3.5 w-3.5" />
            </button>
            {data && (
              <span className="ml-auto text-[11px] text-muted-foreground tabular-nums">
                {data.total.toLocaleString()} total
              </span>
            )}
          </div>

          {isError && (
            <div className="mb-4 flex items-center gap-2 rounded-lg border border-destructive/20 bg-destructive/8 px-3.5 py-2.5 text-[13px] text-destructive">
              Failed to load deliveries.
            </div>
          )}

          {/* Table */}
          <div className="rounded-lg border border-border overflow-hidden">
            <table className="w-full text-[13px]">
              <thead>
                <tr className="border-b border-border bg-muted/50">
                  <th className="px-4 py-2.5 text-left text-[11px] font-medium text-muted-foreground/70 tracking-wide uppercase w-44">Date</th>
                  <th className="px-4 py-2.5 text-left text-[11px] font-medium text-muted-foreground/70 tracking-wide uppercase">Subject</th>
                  <th className="px-4 py-2.5 text-left text-[11px] font-medium text-muted-foreground/70 tracking-wide uppercase">Recipient</th>
                  <th className="px-4 py-2.5 text-left text-[11px] font-medium text-muted-foreground/70 tracking-wide uppercase w-28">Status</th>
                </tr>
              </thead>
              <tbody>
                {isLoading && Array.from({ length: 8 }).map((_, i) => (
                  <tr key={i} className="border-b border-border/50 last:border-0">
                    <td className="px-4 py-3"><div className="h-3 w-28 rounded shimmer" /></td>
                    <td className="px-4 py-3"><div className="h-3 w-56 rounded shimmer" /></td>
                    <td className="px-4 py-3"><div className="h-3 w-40 rounded shimmer" /></td>
                    <td className="px-4 py-3"><div className="h-5 w-16 rounded-full shimmer" /></td>
                  </tr>
                ))}

                {!isLoading && data?.data.map((send) => (
                  <tr
                    key={send.id}
                    onClick={() => setSelectedSendId(send.id)}
                    className="border-b border-border/50 last:border-0 hover:bg-accent/40 transition-colors cursor-pointer group"
                  >
                    <td className="px-4 py-3 text-[11px] text-muted-foreground tabular-nums whitespace-nowrap">
                      {formatDate(send.createdAt)}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <Mail className="h-3.5 w-3.5 text-muted-foreground/40 shrink-0 group-hover:text-muted-foreground transition-colors" />
                        <span className="truncate max-w-[340px] font-medium">{send.subject}</span>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-[12px] font-mono text-muted-foreground truncate max-w-[220px]">
                      {send.contactEmail}
                    </td>
                    <td className="px-4 py-3">
                      <Badge variant={STATUS_BADGE[send.status] ?? "secondary"} className="text-[10px]">
                        {send.status.charAt(0).toUpperCase() + send.status.slice(1)}
                      </Badge>
                    </td>
                  </tr>
                ))}

                {!isLoading && !data?.data.length && (
                  <tr>
                    <td colSpan={4}>
                      <div className="flex flex-col items-center justify-center py-16 text-center">
                        <div className="mb-4 flex h-9 w-9 items-center justify-center rounded-lg border border-border">
                          <Inbox className="h-5 w-5 text-muted-foreground" />
                        </div>
                        <p className="text-[13px] font-medium">No deliveries yet</p>
                        <p className="mt-1 text-[12px] text-muted-foreground">Send a broadcast to see email deliveries here</p>
                      </div>
                    </td>
                  </tr>
                )}
              </tbody>
            </table>

            {data && data.total > PAGE_SIZE && (
              <div className="flex items-center justify-between border-t border-border px-4 py-2.5 text-[12px] text-muted-foreground">
                <span>
                  {Math.min((page - 1) * PAGE_SIZE + 1, data.total).toLocaleString()}–
                  {Math.min(page * PAGE_SIZE, data.total).toLocaleString()} of {data.total.toLocaleString()}
                </span>
                <div className="flex items-center gap-1">
                  <Button variant="ghost" size="sm" className="h-7 px-2" disabled={page <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))}>←</Button>
                  <span className="px-2">{page} / {totalPages}</span>
                  <Button variant="ghost" size="sm" className="h-7 px-2" disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)}>→</Button>
                </div>
              </div>
            )}
          </div>
        </>
      )}

      {/* ── Drafts tab ───────────────────────────────────────────────────── */}
      {activeTab === "drafts" && (
        <>
          {draftsError && (
            <div className="mb-4 flex items-center gap-2 rounded-lg border border-destructive/20 bg-destructive/8 px-3.5 py-2.5 text-[13px] text-destructive">
              Failed to load drafts.
            </div>
          )}
          <p className="mb-3 text-[12px] text-muted-foreground">
            Draft broadcasts.{" "}
            <Link to="/broadcasts" className="font-medium text-foreground hover:underline">
              Go to Broadcasts
            </Link>{" "}
            to edit or send them.
          </p>
          <div className="rounded-lg border border-border overflow-hidden">
            <table className="w-full text-[13px]">
              <thead>
                <tr className="border-b border-border bg-muted/50">
                  <th className="px-4 py-2.5 text-left text-[11px] font-medium text-muted-foreground/70 tracking-wide uppercase">Name</th>
                  <th className="px-4 py-2.5 text-left text-[11px] font-medium text-muted-foreground/70 tracking-wide uppercase">Subject</th>
                  <th className="px-4 py-2.5 text-left text-[11px] font-medium text-muted-foreground/70 tracking-wide uppercase w-32">Created</th>
                </tr>
              </thead>
              <tbody>
                {draftsLoading && Array.from({ length: 4 }).map((_, i) => (
                  <tr key={i} className="border-b border-border/50 last:border-0">
                    <td className="px-4 py-3"><div className="h-3 w-40 rounded shimmer" /></td>
                    <td className="px-4 py-3"><div className="h-3 w-56 rounded shimmer" /></td>
                    <td className="px-4 py-3"><div className="h-3 w-20 rounded shimmer" /></td>
                  </tr>
                ))}
                {!draftsLoading && drafts.map((draft) => (
                  <tr key={draft.id} className="border-b border-border/50 last:border-0 hover:bg-accent/30 transition-colors">
                    <td className="px-4 py-3 font-medium">{draft.name}</td>
                    <td className="px-4 py-3 text-muted-foreground truncate max-w-[300px]">{draft.subject}</td>
                    <td className="px-4 py-3 text-[11px] text-muted-foreground tabular-nums">
                      {draft.createdAt ? format(new Date(draft.createdAt), "MMM d, yyyy") : "—"}
                    </td>
                  </tr>
                ))}
                {!draftsLoading && drafts.length === 0 && (
                  <tr>
                    <td colSpan={3}>
                      <div className="flex flex-col items-center justify-center py-16 text-center">
                        <p className="text-[13px] font-medium">No drafts</p>
                        <p className="mt-1 text-[12px] text-muted-foreground">Create a broadcast and save it as a draft</p>
                      </div>
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </>
      )}

      {/* Email preview dialog */}
      {selectedSendId && activeWorkspaceId && (
        <EmailPreviewDialog
          sendId={selectedSendId}
          workspaceId={activeWorkspaceId}
          onClose={() => setSelectedSendId(null)}
        />
      )}
    </div>
  );
}
