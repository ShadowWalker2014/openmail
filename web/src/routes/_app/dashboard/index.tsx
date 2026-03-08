import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { sessionFetch } from "@/lib/api";
import { useWorkspaceStore } from "@/store/workspace";
import { useWorkspaceShape } from "@/hooks/use-workspace-shape";
import {
  Mail, Users, TrendingUp, MousePointerClick, UserMinus,
  Activity, AlertCircle, ArrowRight,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useMemo, useState, useEffect } from "react";
import { Link } from "@tanstack/react-router";

export const Route = createFileRoute("/_app/dashboard/")({
  component: DashboardPage,
});

interface Analytics {
  contacts: number;
  sends: number;
  opens: number;
  clicks: number;
  unsubscribes: number;
  openRate: number;
  clickRate: number;
}

interface EmailEvent extends Record<string, unknown> {
  id: string;
  event_type: "open" | "click" | "unsubscribe" | "bounce" | "complaint";
  occurred_at: string;
  send_id: string;
  workspace_id: string;
}

const EVENT_CONFIG: Record<string, { label: string; dot: string; text: string }> = {
  open:        { label: "Email opened",  dot: "bg-blue-400/80",    text: "text-blue-400" },
  click:       { label: "Link clicked",  dot: "bg-emerald-400/80", text: "text-emerald-400" },
  unsubscribe: { label: "Unsubscribed",  dot: "bg-red-400/80",     text: "text-red-400" },
  bounce:      { label: "Bounced",       dot: "bg-amber-400/80",   text: "text-amber-400" },
  complaint:   { label: "Complaint",     dot: "bg-red-500/80",     text: "text-red-400" },
};

const EMAIL_EVENT_COLUMNS = ["id", "event_type", "occurred_at", "send_id", "workspace_id"];

interface StatCardProps {
  label: string;
  value: string | number;
  sub?: string;
  icon: React.ElementType;
  loading?: boolean;
}

function StatCard({ label, value, sub, icon: Icon, loading }: StatCardProps) {
  if (loading) {
    return (
      <div className="rounded-lg border border-border bg-card p-4">
        <div className="mb-3 flex items-center justify-between">
          <div className="h-2 w-14 rounded shimmer" />
          <div className="h-3.5 w-3.5 rounded shimmer" />
        </div>
        <div className="h-6 w-16 rounded shimmer" />
        <div className="mt-1 h-2 w-10 rounded shimmer opacity-60" />
      </div>
    );
  }

  return (
    <div className="group rounded-lg border border-border bg-card p-4 transition-colors duration-150 hover:bg-card/80 hover:border-border/60">
      <div className="mb-2.5 flex items-center justify-between">
        <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/60 leading-none">
          {label}
        </span>
        <Icon className="h-3 w-3 text-muted-foreground/30 group-hover:text-muted-foreground/50 transition-colors" />
      </div>
      <div className="tabular-nums text-[21px] font-semibold tracking-tight leading-none text-foreground">
        {value}
      </div>
      {sub && (
        <div className="mt-1 text-[10px] text-muted-foreground/50 leading-none">{sub}</div>
      )}
    </div>
  );
}

function LiveDot() {
  return (
    <span className="relative flex h-[5px] w-[5px]">
      <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-500 opacity-60" />
      <span className="relative inline-flex h-[5px] w-[5px] rounded-full bg-emerald-500" />
    </span>
  );
}

function DashboardPage() {
  const { activeWorkspaceId } = useWorkspaceStore();

  const {
    data: analytics,
    isLoading: analyticsLoading,
    isError: analyticsError,
  } = useQuery<Analytics>({
    queryKey: ["analytics", "overview", activeWorkspaceId],
    queryFn: () => sessionFetch(activeWorkspaceId!, "/analytics/overview"),
    enabled: !!activeWorkspaceId,
    staleTime: 5 * 60_000,
  });

  const { data: liveEvents = [], isLoading: eventsLoading } =
    useWorkspaceShape<EmailEvent>("email_events", { columns: EMAIL_EVENT_COLUMNS });

  // If Electric is unreachable, isLoading stays true forever.
  // After 3s, stop showing skeletons and fall through to the empty state.
  const [shapeTimedOut, setShapeTimedOut] = useState(false);
  useEffect(() => {
    if (!eventsLoading) { setShapeTimedOut(false); return; }
    const t = setTimeout(() => setShapeTimedOut(true), 3000);
    return () => clearTimeout(t);
  }, [eventsLoading]);

  const showEventsLoading = eventsLoading && !shapeTimedOut;

  const recentEvents = useMemo(
    () =>
      [...liveEvents]
        .sort((a, b) => new Date(b.occurred_at).getTime() - new Date(a.occurred_at).getTime())
        .slice(0, 20),
    [liveEvents]
  );

  return (
    <div className="px-8 py-7 w-full">
      {/* ── Header ── */}
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-[14px] font-semibold tracking-tight text-foreground">
            Dashboard
          </h1>
          <p className="mt-0.5 text-[11px] text-muted-foreground/70 leading-none">
            Last 30 days
          </p>
        </div>
      </div>

      {/* ── Error ── */}
      {analyticsError && (
        <div className="mb-5 flex items-center gap-2 rounded-lg border border-destructive/20 bg-destructive/8 px-3 py-2 text-[12px] text-destructive">
          <AlertCircle className="h-3.5 w-3.5 shrink-0" />
          Failed to load analytics data.
        </div>
      )}

      {/* ── Stat cards — 5-column dense grid ── */}
      <div className="mb-5 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
        <StatCard label="Contacts"     value={(analytics?.contacts ?? 0).toLocaleString()}   icon={Users}            loading={analyticsLoading} />
        <StatCard label="Emails Sent"  value={(analytics?.sends ?? 0).toLocaleString()}       sub="30 days"           icon={Mail}             loading={analyticsLoading} />
        <StatCard label="Open Rate"    value={analytics ? `${analytics.openRate}%` : "—"}    icon={TrendingUp}       loading={analyticsLoading} />
        <StatCard label="Click Rate"   value={analytics ? `${analytics.clickRate}%` : "—"}   icon={MousePointerClick} loading={analyticsLoading} />
        <StatCard label="Unsubscribes" value={(analytics?.unsubscribes ?? 0).toLocaleString()} icon={UserMinus}       loading={analyticsLoading} />
      </div>

      {/* ── Live activity ── */}
      <div className="rounded-lg border border-border bg-card overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-border px-4 py-2.5">
          <div className="flex items-center gap-2">
            <Activity className="h-3 w-3 text-muted-foreground/40" />
            <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground/60">
              Activity
            </span>
          </div>
          {recentEvents.length > 0 && <LiveDot />}
        </div>

        {/* Loading skeletons — shown only briefly before timeout */}
        {showEventsLoading && (
          <div>
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="flex items-center gap-3 px-4 py-2.5 border-b border-border/20 last:border-0">
                <div className="h-1.5 w-1.5 rounded-full shimmer shrink-0" />
                <div className="h-2.5 rounded shimmer" style={{ width: `${80 + (i * 23) % 80}px` }} />
                <div className="ml-auto h-2 w-10 rounded shimmer opacity-50" />
              </div>
            ))}
          </div>
        )}

        {/* Empty state */}
        {!showEventsLoading && recentEvents.length === 0 && (
          <div className="flex flex-col items-center justify-center px-6 py-16 text-center">
            <div className="mb-4 flex h-9 w-9 items-center justify-center rounded-full border border-border/60 bg-muted/30">
              <Activity className="h-4 w-4 text-muted-foreground/30" />
            </div>
            <p className="text-[13px] font-medium text-foreground/60">No activity yet</p>
            <p className="mt-1 max-w-[240px] text-[12px] leading-relaxed text-muted-foreground/40">
              Opens, clicks, and unsubscribes from your campaigns will appear here.
            </p>
            <Link
              to="/broadcasts"
              className="mt-4 flex items-center gap-1.5 rounded-md border border-border/50 bg-muted/20 px-3 py-1.5 text-[12px] text-muted-foreground/60 transition-colors hover:border-border hover:bg-muted/40 hover:text-foreground/70 cursor-pointer"
            >
              Send your first broadcast
              <ArrowRight className="h-3 w-3" />
            </Link>
          </div>
        )}

        {/* Event rows */}
        {recentEvents.length > 0 && (
          <div>
            {recentEvents.map((event, idx) => {
              const meta = EVENT_CONFIG[event.event_type] ?? EVENT_CONFIG.open;
              const time = new Date(event.occurred_at);
              return (
                <div
                  key={event.id}
                  className={cn(
                    "flex items-center gap-3 px-4 py-2 transition-colors duration-75 hover:bg-accent/40",
                    idx < recentEvents.length - 1 && "border-b border-border/20"
                  )}
                >
                  <div className={cn("h-1.5 w-1.5 shrink-0 rounded-full", meta.dot)} />
                  <span className="flex-1 text-[12px] text-foreground/70 leading-none">{meta.label}</span>
                  <span className="tabular-nums shrink-0 font-mono text-[10px] text-muted-foreground/40">
                    {time.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
