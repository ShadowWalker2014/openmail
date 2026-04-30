/**
 * Stage 6 — Per-enrollment timeline drill-down + Time-travel debugging.
 *
 * Two view modes:
 *   - "Timeline" (default): chronological event list with filters + export.
 *   - "Time-travel" (replay scrubber): operator picks a position in the
 *     enrollment's history; the panel shows the reconstructed state AFTER
 *     applying events 0..N. Uses the EXACT same dispatcher (pure function)
 *     as the CLI replay tool, so the in-app view is bit-exact with what
 *     `bun run scripts/replay-enrollment.ts` would produce.
 *
 * The time-travel mode answers questions like:
 *   - "What was this enrollment's state right before the force_exit?"
 *   - "What did the resume click actually do — what fields changed?"
 *   - "Did the goal_evaluation_error leave state in a weird place?"
 *
 * Reconciliation preview UI ("show me what will happen before the edit")
 * is a related but separate use case — that compares current live state
 * against a hypothetical post-edit projection. Time-travel here is purely
 * historical: replays what already happened.
 */
import { Link, createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { ArrowLeft, History, ListOrdered, RotateCcw, Rewind } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useEnrollmentEvents } from "@/hooks/use-enrollment-events";
import {
  useReplayState,
  applyEvent,
  emptyState,
  toEventRow,
} from "@/hooks/use-replay-state";
import { EventRow } from "@/components/timeline/event-row";
import {
  TimelineFiltersBar,
  ActiveFilterChips,
  EMPTY_FILTERS,
  useFilteredEvents,
  type TimelineFilters,
} from "@/components/timeline/timeline-filters";
import { TimelineExportButton } from "@/components/timeline/timeline-export";
import { StateSnapshot, StateDelta } from "@/components/timeline/state-snapshot";
import type { EnrollmentEventRow } from "@/hooks/use-enrollment-events";

export const Route = createFileRoute(
  "/_app/campaigns/$id/enrollments/$enrollmentId",
)({
  component: EnrollmentTimelinePage,
});

type ViewMode = "timeline" | "time-travel";

function EnrollmentTimelinePage() {
  const { enrollmentId, id: campaignId } = Route.useParams();
  const [mode, setMode] = useState<ViewMode>("timeline");
  const [filters, setFilters] = useState<TimelineFilters>(EMPTY_FILTERS);
  const { data: events, isLoading } = useEnrollmentEvents(enrollmentId);
  const filtered = useFilteredEvents(events, filters);

  return (
    <div className="p-6 max-w-5xl">
      {/* Breadcrumb back */}
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

      {/* Title + mode toggle + export */}
      <div className="flex items-baseline justify-between gap-3 mb-1 flex-wrap">
        <h1 className="text-2xl font-bold">Enrollment</h1>
        <div className="flex items-center gap-2">
          <ModeButton current={mode} value="timeline" onChange={setMode}>
            <ListOrdered className="h-3 w-3 mr-1 inline" />
            Timeline
          </ModeButton>
          <ModeButton current={mode} value="time-travel" onChange={setMode}>
            <History className="h-3 w-3 mr-1 inline" />
            Time-travel
          </ModeButton>
          {mode === "timeline" && (
            <TimelineExportButton
              rows={filtered}
              filenamePrefix={`enrollment-${enrollmentId}`}
            />
          )}
        </div>
      </div>
      <p className="text-xs font-mono text-muted-foreground mb-4">
        {campaignId} / {enrollmentId}
      </p>

      {isLoading ? (
        <div className="text-muted-foreground">Loading…</div>
      ) : mode === "timeline" ? (
        <TimelineMode
          events={events}
          filtered={filtered}
          filters={filters}
          onFiltersChange={setFilters}
        />
      ) : (
        <TimeTravelMode events={events} />
      )}
    </div>
  );
}

// ── Timeline mode (filters + chronological list) ─────────────────────────────

function TimelineMode({
  events,
  filtered,
  filters,
  onFiltersChange,
}: {
  events: EnrollmentEventRow[];
  filtered: EnrollmentEventRow[];
  filters: TimelineFilters;
  onFiltersChange: (next: TimelineFilters) => void;
}) {
  return (
    <>
      <TimelineFiltersBar
        value={filters}
        onChange={onFiltersChange}
        totalCount={events.length}
        filteredCount={filtered.length}
      />
      <ActiveFilterChips value={filters} onChange={onFiltersChange} />
      {filtered.length === 0 ? (
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
    </>
  );
}

// ── Time-travel mode (scrubber + reconstructed state panel) ──────────────────

function TimeTravelMode({ events }: { events: EnrollmentEventRow[] }) {
  // Events come from `useEnrollmentEvents` already sorted ascending by event_seq
  // (chronological). The scrubber position is a 0-based index into this list:
  //   -1 = empty state (before any event)
  //    0 = state after applying event 0
  //    N = state after applying events 0..N
  const [position, setPosition] = useState<number>(events.length - 1);

  // Clamp on event-list change (e.g., a new event arrives via Electric).
  const clampedPosition = useMemo(() => {
    if (events.length === 0) return -1;
    return Math.min(Math.max(-1, position), events.length - 1);
  }, [position, events.length]);

  // Replay up to current position.
  const replay = useReplayState(events, clampedPosition);

  // Compute "before" state for the delta view: state after applying
  // events 0..(position-1). This shows what the focused event mutated.
  const beforeState = useMemo(() => {
    if (clampedPosition < 0 || events.length === 0) {
      return emptyState({ enrollmentId: "" });
    }
    const first = events[0];
    let s = emptyState({
      enrollmentId: first.enrollment_id ?? "",
      campaignId: first.campaign_id,
      workspaceId: first.workspace_id,
    });
    for (let i = 0; i < clampedPosition; i++) {
      s = applyEvent(s, toEventRow(events[i]));
    }
    return s;
  }, [events, clampedPosition]);

  if (events.length === 0) {
    return (
      <div className="text-sm text-muted-foreground border border-dashed border-border rounded-md p-6 text-center">
        No events to replay.
      </div>
    );
  }

  const focusEvent = replay.current;

  return (
    <div className="flex flex-col gap-3">
      {/* Scrubber controls */}
      <div className="border border-border rounded-md bg-card p-3">
        <div className="flex items-center gap-3 mb-2">
          <Button
            variant="outline"
            size="sm"
            className="h-8"
            onClick={() => setPosition(-1)}
            disabled={clampedPosition < 0}
            title="Reset to empty state"
          >
            <Rewind className="h-3 w-3 mr-1" />
            Start
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="h-8"
            onClick={() => setPosition((p) => Math.max(-1, p - 1))}
            disabled={clampedPosition < 0}
            title="Step back"
          >
            ◀ Back
          </Button>
          <div className="flex-1 flex items-center gap-2 min-w-0">
            <input
              type="range"
              min={-1}
              max={events.length - 1}
              value={clampedPosition}
              onChange={(e) => setPosition(Number(e.target.value))}
              className="flex-1"
              aria-label="Replay position"
            />
            <span className="text-xs font-mono text-muted-foreground whitespace-nowrap">
              {clampedPosition + 1} / {events.length}
            </span>
          </div>
          <Button
            variant="outline"
            size="sm"
            className="h-8"
            onClick={() =>
              setPosition((p) => Math.min(events.length - 1, p + 1))
            }
            disabled={clampedPosition >= events.length - 1}
            title="Step forward"
          >
            Forward ▶
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="h-8"
            onClick={() => setPosition(events.length - 1)}
            disabled={clampedPosition >= events.length - 1}
            title="Jump to most recent"
          >
            <RotateCcw className="h-3 w-3 mr-1" />
            Latest
          </Button>
        </div>

        {/* Currently-focused event summary */}
        {focusEvent ? (
          <div className="text-xs text-muted-foreground">
            Focused event:{" "}
            <span className="font-mono font-semibold text-foreground">
              {focusEvent.event_type}
            </span>{" "}
            at{" "}
            <span className="font-mono">
              {new Date(focusEvent.emitted_at).toLocaleString()}
            </span>
            {focusEvent.event_seq != null && (
              <>
                {" · seq "}
                <span className="font-mono">{String(focusEvent.event_seq)}</span>
              </>
            )}
          </div>
        ) : (
          <div className="text-xs text-muted-foreground italic">
            Empty state — before any event was applied.
          </div>
        )}
      </div>

      {/* Two-pane layout: state snapshot + delta view + focused event row */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        <StateSnapshot
          state={replay.state}
          caption={`State after ${clampedPosition + 1} of ${events.length} events`}
        />
        <StateDelta
          before={beforeState}
          after={replay.state}
          caption={
            focusEvent
              ? `What changed at "${focusEvent.event_type}"`
              : "No event focused"
          }
        />
      </div>

      {/* Focused event row (full payload viewer below) */}
      {focusEvent && (
        <div>
          <div className="text-xs font-semibold text-muted-foreground mb-1">
            Event at scrub position
          </div>
          <EventRow event={focusEvent} />
        </div>
      )}

      {/* Mini-strip of events around the cursor for context */}
      <div>
        <div className="text-xs font-semibold text-muted-foreground mb-1">
          Surrounding events
        </div>
        <div className="flex flex-col gap-1">
          {events
            .slice(
              Math.max(0, clampedPosition - 2),
              Math.min(events.length, clampedPosition + 4),
            )
            .map((e, i) => {
              const idx = Math.max(0, clampedPosition - 2) + i;
              const isFocused = idx === clampedPosition;
              return (
                <button
                  key={e.id}
                  type="button"
                  onClick={() => setPosition(idx)}
                  className={`text-left rounded ${
                    isFocused ? "ring-2 ring-primary" : ""
                  }`}
                >
                  <EventRow event={e} />
                </button>
              );
            })}
        </div>
      </div>
    </div>
  );
}

// ── ModeButton (shared with campaign timeline) ───────────────────────────────

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
      className={`text-xs px-3 py-1.5 rounded border ${
        isActive
          ? "bg-primary text-primary-foreground border-primary"
          : "bg-background border-border text-muted-foreground hover:text-foreground"
      }`}
    >
      {children}
    </button>
  );
}
