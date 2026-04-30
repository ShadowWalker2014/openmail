/**
 * Stage 6 — Per-enrollment timeline drill-down.
 *
 * Full event history for one enrollment, ordered chronologically (oldest
 * first → newest last). Operator may filter by event_type, actor, date,
 * and free-text; export the filtered view as CSV or JSON.
 *
 * Returning to the campaign-wide overview is a one-click trip via the
 * breadcrumb link.
 */
import { Link, createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { ArrowLeft } from "lucide-react";
import { useEnrollmentEvents } from "@/hooks/use-enrollment-events";
import { EventRow } from "@/components/timeline/event-row";
import {
  TimelineFiltersBar,
  ActiveFilterChips,
  EMPTY_FILTERS,
  useFilteredEvents,
  type TimelineFilters,
} from "@/components/timeline/timeline-filters";
import { TimelineExportButton } from "@/components/timeline/timeline-export";

export const Route = createFileRoute(
  "/_app/campaigns/$id/enrollments/$enrollmentId",
)({
  component: EnrollmentTimelinePage,
});

function EnrollmentTimelinePage() {
  const { enrollmentId, id: campaignId } = Route.useParams();
  const [filters, setFilters] = useState<TimelineFilters>(EMPTY_FILTERS);
  const { data: events, isLoading } = useEnrollmentEvents(enrollmentId);
  const filtered = useFilteredEvents(events, filters);

  return (
    <div className="p-6 max-w-4xl">
      <div className="flex items-center gap-2 mb-1">
        <Link
          to="/campaigns/$id/timeline"
          params={{ id: campaignId }}
          className="text-xs text-muted-foreground hover:text-foreground inline-flex items-center gap-1"
        >
          <ArrowLeft className="h-3 w-3" />
          Campaign timeline
        </Link>
      </div>
      <div className="flex items-baseline justify-between gap-3 mb-1 flex-wrap">
        <h1 className="text-2xl font-bold">Enrollment Timeline</h1>
        <TimelineExportButton
          rows={filtered}
          filenamePrefix={`enrollment-${enrollmentId}`}
        />
      </div>
      <p className="text-xs font-mono text-muted-foreground mb-4">
        {campaignId} / {enrollmentId}
      </p>

      <TimelineFiltersBar
        value={filters}
        onChange={setFilters}
        totalCount={events.length}
        filteredCount={filtered.length}
      />
      <ActiveFilterChips value={filters} onChange={setFilters} />

      {isLoading ? (
        <div className="text-muted-foreground">Loading…</div>
      ) : filtered.length === 0 ? (
        <div className="text-sm text-muted-foreground border border-dashed border-border rounded-md p-6 text-center">
          {events.length === 0
            ? "No events for this enrollment."
            : "No events match the current filters."}
        </div>
      ) : (
        <div className="flex flex-col gap-1.5">
          {filtered.map((e) => (
            <EventRow key={e.id} event={e} />
          ))}
        </div>
      )}
    </div>
  );
}
