/**
 * Stage 6 — Per-enrollment timeline drill-down.
 *
 * Displays the full event history for one enrollment, ordered chronologically
 * (oldest first → newest last) so an operator can scroll the lifecycle as it
 * unfolded. Uses the dedicated `useEnrollmentEvents` hook which filters the
 * workspace-scoped shape on `enrollment_id`.
 */
import { createFileRoute } from "@tanstack/react-router";
import { useEnrollmentEvents } from "@/hooks/use-enrollment-events";
import { EventRow } from "@/components/timeline/event-row";

export const Route = createFileRoute(
  "/_app/campaigns/$id/enrollments/$enrollmentId",
)({
  component: EnrollmentTimelinePage,
});

function EnrollmentTimelinePage() {
  const { enrollmentId, id: campaignId } = Route.useParams();
  const { data: events, isLoading } = useEnrollmentEvents(enrollmentId);

  return (
    <div className="p-6 max-w-4xl">
      <h1 className="text-2xl font-bold mb-1">Enrollment Timeline</h1>
      <p className="text-xs font-mono text-muted-foreground mb-4">
        {campaignId} / {enrollmentId}
      </p>
      {isLoading ? (
        <div className="text-muted-foreground">Loading…</div>
      ) : events.length === 0 ? (
        <div className="text-muted-foreground">No events for this enrollment.</div>
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
