import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { sessionFetch } from "@/lib/api";
import { useWorkspaceStore } from "@/store/workspace";
import { useWorkspaceShape } from "@/hooks/use-workspace-shape";
import {
  Mail, Users, TrendingUp, MousePointerClick, UserMinus,
  Activity, AlertCircle,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useMemo } from "react";

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

const EVENT_CONFIG: Record<string, { label: string; color: string }> = {
  open:        { label: "Email opened",  color: "bg-blue-400"   },
  click:       { label: "Link clicked",  color: "bg-emerald-400" },
  unsubscribe: { label: "Unsubscribed",  color: "bg-red-400"    },
  bounce:      { label: "Bounced",       color: "bg-amber-400"  },
  complaint:   { label: "Complaint",     color: "bg-red-500"    },
};

const EMAIL_EVENT_COLUMNS = ["id", "event_type", "occurred_at", "send_id", "workspace_id"];

function StatCard({
  label,
  value,
  sub,
  icon: Icon,
}: {
  label: string;
  value: string | number;
  sub?: string;
  icon: React.ElementType;
}) {
  return (
    <div className="rounded-lg border border-border bg-card p-4 transition-colors duration-150 hover:border-border/80 hover:bg-card/80 group">
      <div className="mb-3 flex items-center justify-between">
        <span className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground/70">
          {label}
        </span>
        <Icon className="h-3.5 w-3.5 text-muted-foreground/40 group-hover:text-muted-foreground/60 transition-colors" />
      </div>
      <div className="tabular-nums text-[22px] font-semibold tracking-tight text-foreground">
        {value}
      </div>
      {sub && (
        <div className="mt-0.5 text-[11px] text-muted-foreground/60">{sub}</div>
      )}
    </div>
  );
}

function StatCardSkeleton() {
  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <div className="mb-3 flex items-center justify-between">
        <div className="h-2.5 w-16 rounded shimmer" />
        <div className="h-3.5 w-3.5 rounded shimmer" />
      </div>
      <div className="h-7 w-20 rounded shimmer" />
      <div className="mt-1.5 h-2.5 w-12 rounded shimmer" />
    </div>
  );
}

function LiveDot() {
  return (
    <span className="relative flex h-1.5 w-1.5">
      <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-500 opacity-75" />
      <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-emerald-500" />
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
    useWorkspaceShape<EmailEvent>("email_events", {
      columns: EMAIL_EVENT_COLUMNS,
    });

  const recentEvents = useMemo(
    () =>
      [...liveEvents]
        .sort(
          (a, b) =>
            new Date(b.occurred_at).getTime() - new Date(a.occurred_at).getTime()
        )
        .slice(0, 20),
    [liveEvents]
  );

  return (
    <div className="mx-auto max-w-5xl px-8 py-7">
      {/* ── Header ── */}
      <div className="mb-6">
        <h1 className="text-[15px] font-semibold tracking-tight text-foreground">
          Dashboard
        </h1>
        <p className="mt-0.5 text-[12px] text-muted-foreground">
          Last 30 days
        </p>
      </div>

      {/* ── Error state ── */}
      {analyticsError && (
        <div className="mb-6 flex items-center gap-2 rounded-lg border border-destructive/20 bg-destructive/8 px-3.5 py-2.5 text-[13px] text-destructive">
          <AlertCircle className="h-3.5 w-3.5 shrink-0" />
          Failed to load analytics.
        </div>
      )}

      {/* ── Stat cards ── */}
      <div className="mb-6 grid grid-cols-2 gap-2.5 md:grid-cols-3 lg:grid-cols-5">
        {analyticsLoading ? (
          Array.from({ length: 5 }).map((_, i) => (
            <StatCardSkeleton key={i} />
          ))
        ) : (
          <>
            <StatCard
              label="Contacts"
              value={(analytics?.contacts ?? 0).toLocaleString()}
              icon={Users}
            />
            <StatCard
              label="Emails Sent"
              value={(analytics?.sends ?? 0).toLocaleString()}
              sub="last 30 days"
              icon={Mail}
            />
            <StatCard
              label="Open Rate"
              value={analytics ? `${analytics.openRate}%` : "—"}
              icon={TrendingUp}
            />
            <StatCard
              label="Click Rate"
              value={analytics ? `${analytics.clickRate}%` : "—"}
              icon={MousePointerClick}
            />
            <StatCard
              label="Unsubscribes"
              value={(analytics?.unsubscribes ?? 0).toLocaleString()}
              icon={UserMinus}
            />
          </>
        )}
      </div>

      {/* ── Live activity ── */}
      <div className="rounded-lg border border-border bg-card overflow-hidden">
        {/* Panel header */}
        <div className="flex items-center justify-between px-4 py-2.5 border-b border-border">
          <div className="flex items-center gap-1.5">
            <Activity className="h-3.5 w-3.5 text-muted-foreground/50" />
            <span className="text-[12px] font-medium text-foreground/80">
              Live Activity
            </span>
          </div>
          <div className="flex items-center gap-1.5 text-[11px] font-medium text-emerald-500">
            <LiveDot />
            Real-time
          </div>
        </div>

        {/* Loading skeletons */}
        {eventsLoading && (
          <div className="divide-y divide-border/50">
            {Array.from({ length: 5 }).map((_, i) => (
              <div
                key={i}
                className="flex items-center gap-3 px-4 py-2.5"
              >
                <div className="h-2 w-2 rounded-full shimmer" />
                <div className="h-2.5 w-28 rounded shimmer" />
                <div className="ml-auto h-2.5 w-14 rounded shimmer" />
              </div>
            ))}
          </div>
        )}

        {/* Empty state */}
        {!eventsLoading && recentEvents.length === 0 && (
          <div className="flex flex-col items-center justify-center py-16 text-center">
            <div className="mb-3 flex h-9 w-9 items-center justify-center rounded-lg border border-border">
              <Activity className="h-4 w-4 text-muted-foreground/40" />
            </div>
            <p className="text-[13px] font-medium text-foreground/60">
              No activity yet
            </p>
            <p className="mt-0.5 text-[11px] text-muted-foreground/50">
              Send a broadcast to see live events here
            </p>
          </div>
        )}

        {/* Event rows */}
        {recentEvents.length > 0 && (
          <div className="divide-y divide-border/40">
            {recentEvents.map((event) => {
              const meta =
                EVENT_CONFIG[event.event_type] ?? EVENT_CONFIG.open;
              const time = new Date(event.occurred_at);
              return (
                <div
                  key={event.id}
                  className="flex items-center gap-3 px-4 py-2 hover:bg-accent/30 transition-colors duration-100"
                >
                  <div
                    className={cn(
                      "h-1.5 w-1.5 shrink-0 rounded-full",
                      meta.color
                    )}
                  />
                  <span className="flex-1 text-[13px] text-foreground/80">
                    {meta.label}
                  </span>
                  <span className="tabular-nums shrink-0 text-[11px] text-muted-foreground/60">
                    {time.toLocaleTimeString([], {
                      hour: "2-digit",
                      minute: "2-digit",
                      second: "2-digit",
                    })}
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
