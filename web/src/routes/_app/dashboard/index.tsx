import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { sessionFetch } from "@/lib/api";
import { useWorkspaceStore } from "@/store/workspace";
import { useWorkspaceShape } from "@/hooks/use-workspace-shape";
import { MousePointerClick, Mail, Users, TrendingUp, UserMinus, Activity } from "lucide-react";

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

interface EmailEvent {
  id: string;
  event_type: "open" | "click" | "unsubscribe" | "bounce" | "complaint";
  occurred_at: string;
  send_id: string;
  workspace_id: string;
}

const EVENT_ICONS: Record<string, { icon: React.ElementType; label: string; color: string }> = {
  open:        { icon: Mail,              label: "Email opened",      color: "text-blue-500" },
  click:       { icon: MousePointerClick, label: "Link clicked",      color: "text-green-500" },
  unsubscribe: { icon: UserMinus,         label: "Unsubscribed",      color: "text-red-500" },
  bounce:      { icon: Mail,              label: "Bounced",           color: "text-orange-500" },
  complaint:   { icon: Mail,              label: "Complaint",         color: "text-red-600" },
};

function StatCard({ label, value, sub, icon: Icon }: { label: string; value: string | number; sub?: string; icon: React.ElementType }) {
  return (
    <div className="bg-white rounded-xl border p-5">
      <div className="flex items-center justify-between mb-3">
        <span className="text-sm text-muted-foreground">{label}</span>
        <Icon className="w-4 h-4 text-muted-foreground" />
      </div>
      <div className="text-2xl font-semibold">{value}</div>
      {sub && <div className="text-xs text-muted-foreground mt-0.5">{sub}</div>}
    </div>
  );
}

function LiveDot() {
  return (
    <span className="relative flex h-2 w-2">
      <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75" />
      <span className="relative inline-flex rounded-full h-2 w-2 bg-green-500" />
    </span>
  );
}

function DashboardPage() {
  const { activeWorkspaceId } = useWorkspaceStore();

  const { data: analytics } = useQuery<Analytics>({
    queryKey: ["analytics", "overview", activeWorkspaceId],
    queryFn: () => sessionFetch(activeWorkspaceId!, "/analytics/overview"),
    enabled: !!activeWorkspaceId,
    refetchInterval: 30_000,
  });

  // Live email events stream via ElectricSQL
  const { data: liveEvents = [], isLoading: eventsLoading } = useWorkspaceShape<EmailEvent>(
    "email_events",
    { columns: ["id", "event_type", "occurred_at", "send_id", "workspace_id"] }
  );

  // Show last 20 events sorted newest first
  const recentEvents = [...liveEvents]
    .sort((a, b) => new Date(b.occurred_at).getTime() - new Date(a.occurred_at).getTime())
    .slice(0, 20);

  return (
    <div className="p-8 max-w-5xl mx-auto">
      <div className="mb-6">
        <h1 className="text-xl font-semibold">Dashboard</h1>
        <p className="text-sm text-muted-foreground mt-0.5">Last 30 days</p>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-4 mb-8">
        <StatCard label="Contacts" value={analytics?.contacts ?? "—"} icon={Users} />
        <StatCard label="Emails Sent" value={analytics?.sends ?? "—"} sub="last 30 days" icon={Mail} />
        <StatCard label="Open Rate" value={analytics ? `${analytics.openRate}%` : "—"} icon={TrendingUp} />
        <StatCard label="Click Rate" value={analytics ? `${analytics.clickRate}%` : "—"} icon={MousePointerClick} />
        <StatCard label="Unsubscribes" value={analytics?.unsubscribes ?? "—"} icon={UserMinus} />
      </div>

      {/* Live activity feed */}
      <div className="bg-white rounded-xl border">
        <div className="flex items-center justify-between px-5 py-4 border-b">
          <div className="flex items-center gap-2">
            <Activity className="w-4 h-4 text-muted-foreground" />
            <span className="font-medium text-sm">Live Activity</span>
          </div>
          <div className="flex items-center gap-1.5 text-xs text-green-600 font-medium">
            <LiveDot />
            Real-time
          </div>
        </div>

        {eventsLoading && (
          <div className="px-5 py-8 text-center text-sm text-muted-foreground">
            Connecting to live feed…
          </div>
        )}

        {!eventsLoading && recentEvents.length === 0 && (
          <div className="px-5 py-8 text-center text-sm text-muted-foreground">
            No activity yet — send a broadcast to see live events here
          </div>
        )}

        <div className="divide-y">
          {recentEvents.map((event) => {
            const meta = EVENT_ICONS[event.event_type] ?? EVENT_ICONS.open;
            const Icon = meta.icon;
            const time = new Date(event.occurred_at);
            return (
              <div key={event.id} className="flex items-center gap-3 px-5 py-3">
                <Icon className={`w-4 h-4 shrink-0 ${meta.color}`} />
                <span className="text-sm flex-1">{meta.label}</span>
                <span className="text-xs text-muted-foreground shrink-0">
                  {time.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
                </span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
