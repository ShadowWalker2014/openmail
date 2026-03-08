import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { sessionFetch } from "@/lib/api";
import { useWorkspaceStore } from "@/store/workspace";
import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Inbox, Search, RefreshCw, Mail } from "lucide-react";
import { format, isToday, isYesterday } from "date-fns";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_app/deliveries/")({
  component: DeliveriesPage,
});

interface EmailSend {
  id: string;
  contactEmail: string;
  subject: string;
  status: string;
  broadcastId: string | null;
  campaignId: string | null;
  sentAt: string | null;
  createdAt: string;
}

const STATUS_BADGE: Record<string, "success" | "warning" | "destructive" | "secondary" | "outline"> = {
  sent:      "success",
  delivered: "success",
  bounced:   "warning",
  failed:    "destructive",
  queued:    "secondary",
};

function formatSendDate(dateStr: string): string {
  const d = new Date(dateStr);
  if (isToday(d)) return `Today at ${format(d, "h:mm a")}`;
  if (isYesterday(d)) return `Yesterday at ${format(d, "h:mm a")}`;
  return format(d, "MMM d, yyyy 'at' h:mm a");
}

const PAGE_SIZE = 50;

type BroadcastDraft = { id: string; name: string; subject: string; status: string; createdAt: string };

function DeliveriesPage() {
  const { activeWorkspaceId } = useWorkspaceStore();
  const [activeTab, setActiveTab] = useState<"deliveries" | "drafts">("deliveries");
  const [page, setPage] = useState(1);
  const [statusFilter, setStatusFilter] = useState("");
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");

  useEffect(() => {
    const t = setTimeout(() => { setDebouncedSearch(search); setPage(1); }, 300);
    return () => clearTimeout(t);
  }, [search]);

  const { data, isLoading, isError, refetch } = useQuery<{ data: EmailSend[]; total: number; page: number; pageSize: number }>({
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
          <p className="mt-0.5 text-[12px] text-muted-foreground">All sent emails across broadcasts and campaigns</p>
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
                : "border-transparent text-muted-foreground hover:text-foreground"
            )}
          >
            {tab.charAt(0).toUpperCase() + tab.slice(1)}
          </button>
        ))}
      </div>

      {/* Deliveries tab */}
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

          {/* Error state */}
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
                  <th className="px-4 py-2.5 text-left text-[11px] font-medium text-muted-foreground/70 tracking-wide uppercase w-44">Date Created</th>
                  <th className="px-4 py-2.5 text-left text-[11px] font-medium text-muted-foreground/70 tracking-wide uppercase">Action</th>
                  <th className="px-4 py-2.5 text-left text-[11px] font-medium text-muted-foreground/70 tracking-wide uppercase">Recipient</th>
                  <th className="px-4 py-2.5 text-left text-[11px] font-medium text-muted-foreground/70 tracking-wide uppercase w-28">Status</th>
                </tr>
              </thead>
              <tbody>
                {isLoading &&
                  Array.from({ length: 8 }).map((_, i) => (
                    <tr key={i} className="border-b border-border/50 last:border-0">
                      <td className="px-4 py-3"><div className="h-3 w-28 rounded shimmer" /></td>
                      <td className="px-4 py-3"><div className="h-3 w-56 rounded shimmer" /></td>
                      <td className="px-4 py-3"><div className="h-3 w-40 rounded shimmer" /></td>
                      <td className="px-4 py-3"><div className="h-5 w-16 rounded-full shimmer" /></td>
                    </tr>
                  ))}

                {!isLoading && data?.data.map((send) => (
                  <tr key={send.id} className="border-b border-border/50 last:border-0 hover:bg-accent/30 transition-colors">
                    <td className="px-4 py-3 text-[11px] text-muted-foreground tabular-nums whitespace-nowrap">
                      {formatSendDate(send.createdAt)}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <Mail className="h-3.5 w-3.5 text-muted-foreground/50 shrink-0" />
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

                {!isLoading && (!data?.data.length) && (
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

            {/* Pagination */}
            {data && data.total > PAGE_SIZE && (
              <div className="flex items-center justify-between border-t border-border px-4 py-2.5 text-[12px] text-muted-foreground">
                <span>
                  {Math.min((page - 1) * PAGE_SIZE + 1, data.total).toLocaleString()}–{Math.min(page * PAGE_SIZE, data.total).toLocaleString()} of {data.total.toLocaleString()}
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

      {/* Drafts tab */}
      {activeTab === "drafts" && (
        <>
        {draftsError && (
          <div className="mb-4 flex items-center gap-2 rounded-lg border border-destructive/20 bg-destructive/8 px-3.5 py-2.5 text-[13px] text-destructive">
            Failed to load drafts.
          </div>
        )}
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
    </div>
  );
}
