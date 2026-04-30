/**
 * Stage 6 — Per-campaign timeline (cross-enrollment view).
 *
 * Operator overview: most-recent enrollment_events for the campaign across
 * ALL enrollments. Use cases:
 *   - Spot anomalies: lots of `force_exited`? lots of `audit_drift_detected`?
 *   - Investigate a recent operator action via `lifecycle_op_id` correlation
 *     (clickable chip on each event row copies the op_id to clipboard).
 *   - Filter by event type / actor / date / free-text.
 *   - Export the filtered view as CSV or JSON.
 *
 * Two render modes:
 *   - "feed" (default): flat reverse-chronological stream, with each row
 *     showing the enrollment id so it's easy to spot patterns.
 *   - "by-enrollment": events grouped under their enrollment with a click-
 *     through to the per-enrollment drill-down at
 *     `/_app/campaigns/$id/enrollments/$enrollmentId`.
 */
import { Link, createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useWorkspaceShape } from "@/hooks/use-workspace-shape";
import type { EnrollmentEventRow } from "@/hooks/use-enrollment-events";
import { EventRow } from "@/components/timeline/event-row";
import {
  TimelineFiltersBar,
  ActiveFilterChips,
  EMPTY_FILTERS,
  useFilteredEvents,
  type TimelineFilters,
} from "@/components/timeline/timeline-filters";
import { TimelineExportButton } from "@/components/timeline/timeline-export";

export const Route = createFileRoute("/_app/campaigns/$id/timeline")({
  component: CampaignTimelinePage,
});

type ViewMode = "feed" | "by-enrollment";

function CampaignTimelinePage() {
  const { id: campaignId } = Route.useParams();
  const [filters, setFilters] = useState<TimelineFilters>(EMPTY_FILTERS);
  const [mode, setMode] = useState<ViewMode>("feed");

  // Workspace-scoped shape, filtered to this campaign client-side. The shape
  // proxy doesn't accept arbitrary WHERE clauses; the server enforces the
  // workspace scope. For high-volume campaigns the paginated REST endpoint
  // (`GET /api/v1/campaigns/:id/enrollments/:eid/events`) would be preferable.
  const shape = useWorkspaceShape<EnrollmentEventRow>("enrollment_events");
  const allCampaignEvents = useMemo(() => {
    const rows = (shape.data ?? []) as EnrollmentEventRow[];
    return rows
      .filter((r) => r.campaign_id === campaignId)
      .sort(
        (a, b) =>
          new Date(b.emitted_at).getTime() - new Date(a.emitted_at).getTime(),
      );
  }, [shape.data, campaignId]);

  const filtered = useFilteredEvents(allCampaignEvents, filters);

  return (
    <div className="p-6 max-w-5xl">
      <div className="flex items-baseline gap-4 mb-1">
        <h1 className="text-2xl font-bold">Campaign Timeline</h1>
        <p className="text-xs font-mono text-muted-foreground">{campaignId}</p>
      </div>
      <p className="text-sm text-muted-foreground mb-3">
        Cross-enrollment event stream. Drill into a specific enrollment via
        the chip on any row to see its full history.
      </p>

      {/* View-mode toggle */}
      <div className="flex items-center gap-2 mb-3">
        <ModeButton current={mode} value="feed" onChange={setMode}>
          Flat feed
        </ModeButton>
        <ModeButton current={mode} value="by-enrollment" onChange={setMode}>
          Group by enrollment
        </ModeButton>
        <div className="ml-auto">
          <TimelineExportButton
            rows={filtered}
            filenamePrefix={`campaign-${campaignId}`}
          />
        </div>
      </div>

      <TimelineFiltersBar
        value={filters}
        onChange={setFilters}
        totalCount={allCampaignEvents.length}
        filteredCount={filtered.length}
      />
      <ActiveFilterChips value={filters} onChange={setFilters} />

      {shape.isLoading ? (
        <div className="text-muted-foreground">Loading…</div>
      ) : filtered.length === 0 ? (
        <div className="text-sm text-muted-foreground border border-dashed border-border rounded-md p-6 text-center">
          {allCampaignEvents.length === 0
            ? "No events yet."
            : "No events match the current filters."}
        </div>
      ) : mode === "feed" ? (
        <FeedView rows={filtered.slice(0, 200)} truncated={filtered.length > 200} />
      ) : (
        <GroupedByEnrollment rows={filtered} campaignId={campaignId} />
      )}
    </div>
  );
}

// ── View modes ───────────────────────────────────────────────────────────────

function FeedView({
  rows,
  truncated,
}: {
  rows: EnrollmentEventRow[];
  truncated: boolean;
}) {
  return (
    <>
      <div className="flex flex-col gap-1.5">
        {rows.map((e) => (
          <EventRow key={e.id} event={e} showEnrollmentId />
        ))}
      </div>
      {truncated && (
        <p className="text-xs text-muted-foreground mt-3">
          Showing first 200 events. Tighten filters to narrow the view, or
          export the full filtered set.
        </p>
      )}
    </>
  );
}

function GroupedByEnrollment({
  rows,
  campaignId,
}: {
  rows: EnrollmentEventRow[];
  campaignId: string;
}) {
  // Group preserving the row-order traversal so each group's rows stay in
  // descending emitted_at order.
  const groups = useMemo(() => {
    const map = new Map<string, EnrollmentEventRow[]>();
    for (const r of rows) {
      const key = r.enrollment_id ?? "__campaign_aggregate__";
      const arr = map.get(key);
      if (arr) arr.push(r);
      else map.set(key, [r]);
    }
    // Sort groups by their most-recent event timestamp.
    return Array.from(map.entries()).sort((a, b) => {
      const aTs = new Date(a[1][0].emitted_at).getTime();
      const bTs = new Date(b[1][0].emitted_at).getTime();
      return bTs - aTs;
    });
  }, [rows]);

  return (
    <div className="flex flex-col gap-3">
      {groups.map(([eid, evs]) => {
        const isAggregate = eid === "__campaign_aggregate__";
        return (
          <div
            key={eid}
            className="border border-border rounded-md p-3 bg-card"
          >
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-baseline gap-2 flex-wrap">
                <span className="text-xs font-semibold uppercase text-muted-foreground">
                  {isAggregate ? "Campaign-aggregate" : "Enrollment"}
                </span>
                {!isAggregate && (
                  <Link
                    to="/campaigns/$id/enrollments/$enrollmentId"
                    params={{ id: campaignId, enrollmentId: eid }}
                    className="text-xs font-mono underline hover:text-foreground"
                  >
                    {eid}
                  </Link>
                )}
              </div>
              <span className="text-xs text-muted-foreground">
                {evs.length} {evs.length === 1 ? "event" : "events"}
              </span>
            </div>
            <div className="flex flex-col gap-1.5">
              {evs.slice(0, 20).map((e) => (
                <EventRow key={e.id} event={e} />
              ))}
              {evs.length > 20 && !isAggregate && (
                <Link
                  to="/campaigns/$id/enrollments/$enrollmentId"
                  params={{ id: campaignId, enrollmentId: eid }}
                  className="text-xs underline text-muted-foreground hover:text-foreground self-center mt-1"
                >
                  + {evs.length - 20} more — view full enrollment timeline →
                </Link>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function ModeButton({
  current,
  value,
  onChange,
  children,
}: {
  current: ViewMode;
  value: ViewMode;
  onChange: (v: ViewMode) => void;
  children: React.ReactNode;
}) {
  const isActive = current === value;
  return (
    <button
      type="button"
      onClick={() => onChange(value)}
      className={`text-xs px-3 py-1 rounded border ${
        isActive
          ? "bg-primary text-primary-foreground border-primary"
          : "bg-background border-border text-muted-foreground hover:text-foreground"
      }`}
    >
      {children}
    </button>
  );
}
