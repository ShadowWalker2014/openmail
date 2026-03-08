import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { sessionFetch } from "@/lib/api";
import { useWorkspaceStore } from "@/store/workspace";
import { useWorkspaceShape } from "@/hooks/use-workspace-shape";
import { Mail, Users, TrendingUp, MousePointerClick, UserMinus, Activity } from "lucide-react";
import { cn } from "@/lib/utils";

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

const EVENT_CONFIG: Record<string, { label: string; dotClass: string }> = {
  open:        { label: "Email opened",  dotClass: "bg-blue-400"   },
  click:       { label: "Link clicked",  dotClass: "bg-green-400"  },
  unsubscribe: { label: "Unsubscribed",  dotClass: "bg-red-400"    },
  bounce:      { label: "Bounced",       dotClass: "bg-orange-400" },
  complaint:   { label: "Complaint",     dotClass: "bg-red-500"    },
};

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
    <div className="rounded-lg border bg-background p-4 transition-colors duration-150 hover:bg-accent/30">
      <div className="mb-3 flex items-center justify-between">
        <span className="text-xs font-medium text-muted-foreground">{label}</span>
        <Icon className="h-3.5 w-3.5 text-muted-foreground/60" />
      </div>
      <div className="tabular-nums text-2xl font-semibold tracking-tight">{value}</div>
      {sub && <div className="mt-0.5 text-xs text-muted-foreground">{sub}</div>}
    </div>
  );
}

function StatCardSkeleton() {
  return (
    <div className="rounded-lg border bg-background p-4">
      <div className="mb-3 flex items-center justify-between">
        <div className="h-3 w-16 rounded shimmer" />
        <div className="h-3.5 w-3.5 rounded shimmer" />
      </div>
      <div className="h-8 w-20 rounded shimmer" />
    </div>
  );
}

function LiveDot() {
  return (
    <span className="relative flex h-2 w-2">
      <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-green-400 opacity-60" />
      <span className="relative inline-flex h-2 w-2 rounded-full bg-green-500" />
    </span>
  );
}

function DashboardPage() {
  const { activeWorkspaceId } = useWorkspaceStore();

  const { data: analytics, isLoading: analyticsLoading } = useQuery<Analytics>({
    queryKey: ["analytics", "overview", activeWorkspaceId],
    queryFn: () => sessionFetch(activeWorkspaceId!, "/analytics/overview"),
    enabled: !!activeWorkspaceId,
    staleTime: 5 * 60_000,
  });

  const { data: liveEvents = [], isLoading: eventsLoading } =
    useWorkspaceShape<EmailEvent>("email_events", {
      columns: ["id", "event_type", "occurred_at", "send_id", "workspace_id"],
    });

  const recentEvents = [...liveEvents]
    .sort(
      (a, b) =>
        new Date(b.occurred_at).getTime() - new Date(a.occurred_at).getTime()
    )
    .slice(0, 20);

  return (
    <div className="mx-auto max-w-5xl px-8 py-8">
      {/* Header */}
      <div className="mb-7">
        <h1 className="text-lg font-semibold tracking-tight">Dashboard</h1>
        <p className="mt-0.5 text-sm text-muted-foreground">Last 30 days</p>
      </div>

      {/* Stat cards */}
      <div className="mb-7 grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-5">
        {analyticsLoading ? (
          Array.from({ length: 5 }).map((_, i) => <StatCardSkeleton key={i} />)
        ) : (
          <>
            <StatCard
              label="Contacts"
              value={analytics?.contacts ?? "—"}
              icon={Users}
            />
            <StatCard
              label="Emails Sent"
              value={analytics?.sends ?? "—"}
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
              value={analytics?.unsubscribes ?? "—"}
              icon={UserMinus}
            />
          </>
        )}
      </div>

      {/* Live activity */}
      <div className="rounded-lg border bg-background">
        <div className="flex items-center justify-between border-b px-4 py-3">
          <div className="flex items-center gap-2">
            <Activity className="h-4 w-4 text-muted-foreground" />
            <span className="text-sm font-medium">Live Activity</span>
          </div>
          <div className="flex items-center gap-1.5 text-xs font-medium text-emerald-600">
            <LiveDot />
            Real-time
          </div>
        </div>

        {eventsLoading && (
          <div className="space-y-px p-2">
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="flex items-center gap-3 rounded px-2 py-2.5">
                <div className="h-3 w-3 rounded-full shimmer" />
                <div className="h-3 w-28 rounded shimmer" />
                <div className="ml-auto h-3 w-14 rounded shimmer" />
              </div>
            ))}
          </div>
        )}

        {!eventsLoading && recentEvents.length === 0 && (
          <div className="flex flex-col items-center justify-center py-16 text-center">
            <Activity className="mb-3 h-8 w-8 text-muted-foreground/30" />
            <p className="text-sm font-medium text-muted-foreground">No activity yet</p>
            <p className="mt-1 text-xs text-muted-foreground/70">
              Send a broadcast to see live events here
            </p>
          </div>
        )}

        <div className="divide-y">
          {recentEvents.map((event) => {
            const meta = EVENT_CONFIG[event.event_type] ?? EVENT_CONFIG.open;
            const time = new Date(event.occurred_at);
            return (
              <div
                key={event.id}
                className="flex items-center gap-3 px-4 py-2.5 transition-colors hover:bg-accent/50"
              >
                <div
                  className={cn(
                    "h-2 w-2 shrink-0 rounded-full",
                    meta.dotClass
                  )}
                />
                <span className="flex-1 text-sm">{meta.label}</span>
                <span className="tabular-nums shrink-0 text-xs text-muted-foreground">
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
      </div>
    </div>
  );
}
