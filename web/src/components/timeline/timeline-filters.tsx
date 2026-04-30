/**
 * Stage 6 (UI follow-up) — Timeline filter toolbar.
 *
 * Operator controls for narrowing a timeline:
 *   - **Event types** (multi-select via Popover + Command palette).
 *   - **Actor kind** (single-select dropdown: any / user / agent_key /
 *     sweeper / system / migration).
 *   - **Date range** (from/to date inputs in user's local timezone — the
 *     server stores `emitted_at` as `timestamptz` so we serialize to ISO
 *     before filtering).
 *   - **Free-text search** over `payload.lifecycle_op_id` + actor id, for
 *     "find all events tied to that resume click 5 minutes ago".
 *
 * Filtering is done in-memory by the consumer (`applyTimelineFilters`).
 * Keeping the filter logic in this module (not the route) lets the campaign
 * timeline + per-enrollment timeline + future cross-enrollment views share
 * the same predicate.
 */
import { useMemo, useState } from "react";
import { Check, ChevronDown, Search, X } from "lucide-react";
// Import from the leaf submodule — the barrel re-exports DB client code
// that pulls in `postgres` (Node-only) and breaks the web bundle.
import {
  ENROLLMENT_EVENT_TYPES,
  type EnrollmentEventType,
} from "@openmail/shared/lifecycle-events";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Badge } from "@/components/ui/badge";
import { getEventVisual, colorClasses } from "./event-icons";
import type { EnrollmentEventRow } from "@/hooks/use-enrollment-events";

export type ActorKindFilter =
  | "any"
  | "user"
  | "agent_key"
  | "sweeper"
  | "system"
  | "migration";

export interface TimelineFilters {
  eventTypes: EnrollmentEventType[]; // empty array = ALL types
  actorKind: ActorKindFilter;
  fromDate: string; // YYYY-MM-DD or ""
  toDate: string;
  search: string; // free-text matched against op_id + actor + event_type
}

export const EMPTY_FILTERS: TimelineFilters = {
  eventTypes: [],
  actorKind: "any",
  fromDate: "",
  toDate: "",
  search: "",
};

export interface TimelineFiltersProps {
  value: TimelineFilters;
  onChange: (next: TimelineFilters) => void;
  /** Total event count BEFORE filters; rendered as a hint. */
  totalCount: number;
  /** Filtered count AFTER predicates; rendered as a hint. */
  filteredCount: number;
}

export function TimelineFiltersBar({
  value,
  onChange,
  totalCount,
  filteredCount,
}: TimelineFiltersProps) {
  const isFiltered =
    value.eventTypes.length > 0 ||
    value.actorKind !== "any" ||
    value.fromDate !== "" ||
    value.toDate !== "" ||
    value.search.trim() !== "";

  const reset = () => onChange(EMPTY_FILTERS);

  return (
    <div className="flex flex-wrap items-center gap-2 mb-3 p-2 rounded-md border border-border bg-card">
      <EventTypeMultiSelect
        selected={value.eventTypes}
        onChange={(types) => onChange({ ...value, eventTypes: types })}
      />
      <ActorKindSelect
        value={value.actorKind}
        onChange={(actorKind) => onChange({ ...value, actorKind })}
      />
      <Input
        type="date"
        aria-label="From date"
        title="From date (inclusive)"
        value={value.fromDate}
        onChange={(e) => onChange({ ...value, fromDate: e.target.value })}
        className="w-[150px] h-8 text-xs"
      />
      <Input
        type="date"
        aria-label="To date"
        title="To date (inclusive)"
        value={value.toDate}
        onChange={(e) => onChange({ ...value, toDate: e.target.value })}
        className="w-[150px] h-8 text-xs"
      />
      <div className="relative flex-1 min-w-[200px]">
        <Search
          aria-hidden
          className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground"
        />
        <Input
          type="search"
          placeholder="Search op_id, actor, event_type…"
          value={value.search}
          onChange={(e) => onChange({ ...value, search: e.target.value })}
          className="h-8 pl-7 text-xs"
        />
      </div>
      {isFiltered && (
        <Button
          variant="ghost"
          size="sm"
          className="h-8 px-2"
          onClick={reset}
          title="Clear all filters"
        >
          <X className="h-3.5 w-3.5 mr-1" />
          Clear
        </Button>
      )}
      <span className="text-xs text-muted-foreground ml-auto whitespace-nowrap">
        {isFiltered
          ? `${filteredCount} / ${totalCount}`
          : `${totalCount} events`}
      </span>
    </div>
  );
}

// ── Event-type multi-select via Popover + Command ───────────────────────────

function EventTypeMultiSelect({
  selected,
  onChange,
}: {
  selected: EnrollmentEventType[];
  onChange: (types: EnrollmentEventType[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const toggle = (t: EnrollmentEventType) => {
    onChange(
      selected.includes(t) ? selected.filter((x) => x !== t) : [...selected, t],
    );
  };
  const summary =
    selected.length === 0
      ? "All event types"
      : selected.length === 1
      ? getEventVisual(selected[0]).label
      : `${selected.length} types`;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          className="h-8 text-xs justify-between min-w-[160px]"
        >
          {summary}
          <ChevronDown className="h-3.5 w-3.5 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[280px] p-0" align="start">
        <Command>
          <CommandInput placeholder="Filter event types…" className="h-8" />
          <CommandList className="max-h-[320px]">
            <CommandEmpty>No event types match.</CommandEmpty>
            <CommandGroup>
              {ENROLLMENT_EVENT_TYPES.map((t) => {
                const v = getEventVisual(t);
                const Icon = v.icon;
                const cc = colorClasses(v.color);
                const isSelected = selected.includes(t);
                return (
                  <CommandItem
                    key={t}
                    value={t}
                    onSelect={() => toggle(t)}
                    className="flex items-center gap-2 cursor-pointer"
                  >
                    <span
                      className={`flex items-center justify-center h-5 w-5 rounded ${cc.iconBg} ${cc.text}`}
                    >
                      <Icon className="h-3 w-3" />
                    </span>
                    <span className="text-xs flex-1">{v.label}</span>
                    <span className="text-xs text-muted-foreground font-mono">
                      {t}
                    </span>
                    <Check
                      className={`h-3.5 w-3.5 ${
                        isSelected ? "opacity-100" : "opacity-0"
                      }`}
                    />
                  </CommandItem>
                );
              })}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

// ── Actor-kind dropdown (single-select) ──────────────────────────────────────

const ACTOR_KINDS: { value: ActorKindFilter; label: string }[] = [
  { value: "any", label: "Any actor" },
  { value: "user", label: "User" },
  { value: "agent_key", label: "Agent (API key)" },
  { value: "sweeper", label: "Sweeper" },
  { value: "system", label: "System" },
  { value: "migration", label: "Migration" },
];

function ActorKindSelect({
  value,
  onChange,
}: {
  value: ActorKindFilter;
  onChange: (v: ActorKindFilter) => void;
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value as ActorKindFilter)}
      aria-label="Filter by actor kind"
      className="h-8 px-2 text-xs rounded-md border border-input bg-background"
    >
      {ACTOR_KINDS.map((a) => (
        <option key={a.value} value={a.value}>
          {a.label}
        </option>
      ))}
    </select>
  );
}

// ── Active-filter chips (visual hint of what's applied) ─────────────────────

export function ActiveFilterChips({
  value,
  onChange,
}: {
  value: TimelineFilters;
  onChange: (next: TimelineFilters) => void;
}) {
  const chips: Array<{ key: string; label: string; remove: () => void }> = [];
  for (const t of value.eventTypes) {
    chips.push({
      key: `et-${t}`,
      label: getEventVisual(t).label,
      remove: () =>
        onChange({
          ...value,
          eventTypes: value.eventTypes.filter((x) => x !== t),
        }),
    });
  }
  if (value.actorKind !== "any") {
    chips.push({
      key: "actor",
      label: `Actor: ${value.actorKind}`,
      remove: () => onChange({ ...value, actorKind: "any" }),
    });
  }
  if (value.fromDate) {
    chips.push({
      key: "from",
      label: `From: ${value.fromDate}`,
      remove: () => onChange({ ...value, fromDate: "" }),
    });
  }
  if (value.toDate) {
    chips.push({
      key: "to",
      label: `To: ${value.toDate}`,
      remove: () => onChange({ ...value, toDate: "" }),
    });
  }
  if (value.search.trim()) {
    chips.push({
      key: "search",
      label: `"${value.search.trim()}"`,
      remove: () => onChange({ ...value, search: "" }),
    });
  }
  if (chips.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-1 mb-2">
      {chips.map((c) => (
        <Badge
          key={c.key}
          variant="secondary"
          className="text-xs pr-1 gap-1"
        >
          {c.label}
          <button
            type="button"
            onClick={c.remove}
            aria-label={`Remove filter ${c.label}`}
            className="hover:bg-muted rounded p-0.5"
          >
            <X className="h-3 w-3" />
          </button>
        </Badge>
      ))}
    </div>
  );
}

// ── Pure predicate (testable) ────────────────────────────────────────────────

export function applyTimelineFilters(
  rows: EnrollmentEventRow[],
  filters: TimelineFilters,
): EnrollmentEventRow[] {
  const search = filters.search.trim().toLowerCase();
  const fromMs = filters.fromDate ? Date.parse(`${filters.fromDate}T00:00:00`) : null;
  const toMs = filters.toDate ? Date.parse(`${filters.toDate}T23:59:59.999`) : null;
  return rows.filter((r) => {
    // Event type filter (empty = pass).
    if (
      filters.eventTypes.length > 0 &&
      !filters.eventTypes.includes(r.event_type as EnrollmentEventType)
    ) {
      return false;
    }
    // Actor kind.
    if (filters.actorKind !== "any") {
      const kind = String((r.actor as Record<string, unknown> | null)?.kind ?? "system");
      if (kind !== filters.actorKind) return false;
    }
    // Date range.
    const ts = Date.parse(r.emitted_at);
    if (Number.isFinite(ts)) {
      if (fromMs != null && ts < fromMs) return false;
      if (toMs != null && ts > toMs) return false;
    }
    // Free-text search across stable fields.
    if (search) {
      const opId = String(
        (r.payload as Record<string, unknown> | null)?.lifecycle_op_id ?? "",
      ).toLowerCase();
      const actor = JSON.stringify(r.actor ?? {}).toLowerCase();
      const et = r.event_type.toLowerCase();
      if (
        !opId.includes(search) &&
        !actor.includes(search) &&
        !et.includes(search)
      ) {
        return false;
      }
    }
    return true;
  });
}

/**
 * Memoized hook wrapping `applyTimelineFilters`.
 * Used by both campaign-wide and per-enrollment timeline routes.
 */
export function useFilteredEvents(
  rows: EnrollmentEventRow[],
  filters: TimelineFilters,
): EnrollmentEventRow[] {
  return useMemo(() => applyTimelineFilters(rows, filters), [rows, filters]);
}
