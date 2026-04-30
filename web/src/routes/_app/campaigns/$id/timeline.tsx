/**
 * Stage 6 — Per-campaign timeline (overview).
 *
 * Minimal MVP: lists most-recent enrollment_events for the campaign, so the
 * operator can spot patterns (lots of `force_exited`? lots of
 * `audit_drift_detected`?). Per-enrollment drill-down lives at
 * `/campaigns/$id/enrollments/$enrollmentId`.
 *
 * Uses the workspace-scoped Electric shape directly (server enforces
 * workspace membership; we filter by campaign client-side because the
 * shape proxy doesn't take per-row WHERE clauses).
 */
import { createFileRoute } from "@tanstack/react-router";
import { useMemo } from "react";
import {
  useEnrollmentEvents,
  type EnrollmentEventRow,
} from "@/hooks/use-enrollment-events";
import { EventRow } from "@/components/timeline/event-row";
import { useWorkspaceShape } from "@/hooks/use-workspace-shape";

export const Route = createFileRoute("/_app/campaigns/$id/timeline")({
  component: CampaignTimelinePage,
});

function CampaignTimelinePage() {
  const { id: campaignId } = Route.useParams();
  // Pull the full enrollment_events shape (workspace-scoped) and filter
  // client-side. For higher-volume campaigns a paginated REST call would be
  // preferable; the component is intentionally minimal MVP.
  const shape = useWorkspaceShape<EnrollmentEventRow>("enrollment_events");
  const events = useMemo(() => {
    const rows = (shape.data ?? []) as EnrollmentEventRow[];
    return rows
      .filter((r) => r.campaign_id === campaignId)
      .sort(
        (a, b) =>
          new Date(b.emitted_at).getTime() - new Date(a.emitted_at).getTime(),
      )
      .slice(0, 200);
  }, [shape.data, campaignId]);

  return (
    <div className="p-6 max-w-4xl">
      <h1 className="text-2xl font-bold mb-2">Campaign Timeline</h1>
      <p className="text-sm text-muted-foreground mb-4">
        Most-recent {Math.min(events.length, 200)} events for this campaign.
        Drill into a specific enrollment to see its full history.
      </p>
      {shape.isLoading ? (
        <div className="text-muted-foreground">Loading…</div>
      ) : events.length === 0 ? (
        <div className="text-muted-foreground">No events yet.</div>
      ) : (
        <div className="flex flex-col gap-1">
          {events.map((e) => (
            <EventRow key={e.id} event={e} />
          ))}
        </div>
      )}
    </div>
  );
}

// Suppress unused-import warning (used for type annotations).
void useEnrollmentEvents;
