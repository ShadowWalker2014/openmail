import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { sessionFetch } from "@/lib/api";
import { useWorkspaceStore } from "@/store/workspace";

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

function StatCard({ label, value, sub }: { label: string; value: string | number; sub?: string }) {
  return (
    <div className="bg-white rounded-xl border p-5">
      <div className="text-sm text-muted-foreground">{label}</div>
      <div className="text-2xl font-semibold mt-1">{value}</div>
      {sub && <div className="text-xs text-muted-foreground mt-0.5">{sub}</div>}
    </div>
  );
}

function DashboardPage() {
  const { activeWorkspaceId } = useWorkspaceStore();

  const { data: analytics } = useQuery<Analytics>({
    queryKey: ["analytics", "overview", activeWorkspaceId],
    queryFn: () => sessionFetch(activeWorkspaceId!, "/analytics/overview"),
    enabled: !!activeWorkspaceId,
  });

  return (
    <div className="p-8 max-w-5xl mx-auto">
      <div className="mb-6">
        <h1 className="text-xl font-semibold">Dashboard</h1>
        <p className="text-sm text-muted-foreground mt-0.5">Last 30 days</p>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-4">
        <StatCard label="Contacts" value={analytics?.contacts ?? "—"} />
        <StatCard label="Emails Sent" value={analytics?.sends ?? "—"} sub="last 30 days" />
        <StatCard label="Open Rate" value={analytics ? `${analytics.openRate}%` : "—"} />
        <StatCard label="Click Rate" value={analytics ? `${analytics.clickRate}%` : "—"} />
        <StatCard label="Unsubscribes" value={analytics?.unsubscribes ?? "—"} />
      </div>
    </div>
  );
}
