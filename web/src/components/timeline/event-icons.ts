/**
 * Stage 6 (UI follow-up) — Icon + color map for the 32 lifecycle event types.
 *
 * Map is the single source of truth for visual treatment. Adding a new event
 * type to `packages/shared/src/lifecycle-events.ts` requires adding an entry
 * here too (TS exhaustiveness via `EnrollmentEventType` keyof check below).
 *
 * Color semantics:
 *   - emerald: positive lifecycle progression (enroll, send, complete)
 *   - sky:     informational / neutral state ticks (wait scheduled/fired, audit reconciled)
 *   - amber:   operator-initiated change (pause/resume/edit reconciliation)
 *   - rose:    terminal / destructive (force_exited, stop_drain_started, archived)
 *   - violet:  goal-related (achievement, goal CRUD)
 *   - slate:   system / housekeeping (drift, archival, PII erasure, migration)
 */
import {
  Activity,
  Archive,
  ArrowRight,
  Ban,
  CheckCircle2,
  CircleDashed,
  Clock,
  Database,
  Eraser,
  Flag,
  History,
  Inbox,
  ListChecks,
  Mail,
  MailX,
  Pause,
  Play,
  Repeat,
  Settings2,
  ShieldAlert,
  Skull,
  Square,
  StopCircle,
  Target,
  Timer,
  TimerOff,
  TriangleAlert,
  UserMinus,
  UserPlus,
  Wrench,
  type LucideIcon,
} from "lucide-react";
// Type-only import; using the leaf submodule keeps the bundler from pulling
// in the @openmail/shared barrel (which re-exports DB client code).
import type { EnrollmentEventType } from "@openmail/shared/lifecycle-events";

export type EventColor =
  | "emerald"
  | "sky"
  | "amber"
  | "rose"
  | "violet"
  | "slate";

export interface EventVisual {
  icon: LucideIcon;
  color: EventColor;
  label: string;
}

const VISUAL: Record<EnrollmentEventType, EventVisual> = {
  // ── Lifecycle progression ──────────────────────────────────────────────────
  enrolled: { icon: UserPlus, color: "emerald", label: "Enrolled" },
  step_advanced: { icon: ArrowRight, color: "sky", label: "Step advanced" },
  wait_scheduled: { icon: Clock, color: "sky", label: "Wait scheduled" },
  wait_fired: { icon: Timer, color: "sky", label: "Wait fired" },
  message_sent: { icon: Mail, color: "emerald", label: "Message sent" },
  message_failed: { icon: MailX, color: "rose", label: "Message failed" },

  // ── Operator-initiated state changes ───────────────────────────────────────
  paused: { icon: Pause, color: "amber", label: "Paused" },
  resumed: { icon: Play, color: "amber", label: "Resumed" },
  force_exited: { icon: Skull, color: "rose", label: "Force-exited" },
  stale_skipped: { icon: TimerOff, color: "amber", label: "Stale skipped" },
  spread_scheduled: { icon: Activity, color: "amber", label: "Spread scheduled" },
  re_enrolled: { icon: Repeat, color: "amber", label: "Re-enrolled" },
  re_enrollment_blocked: {
    icon: Ban,
    color: "rose",
    label: "Re-enrollment blocked",
  },

  // ── Terminal / destructive ─────────────────────────────────────────────────
  stop_drain_started: { icon: StopCircle, color: "rose", label: "Stop drain started" },
  drain_completed: { icon: Square, color: "rose", label: "Drain completed" },
  archived: { icon: Archive, color: "slate", label: "Archived" },

  // ── Audit / migration ──────────────────────────────────────────────────────
  migration_status_change: {
    icon: Wrench,
    color: "slate",
    label: "Migration status change",
  },
  manual_status_override: {
    icon: TriangleAlert,
    color: "slate",
    label: "Manual status override",
  },

  // ── Per-step pause (Stage 4) ───────────────────────────────────────────────
  step_paused: { icon: Pause, color: "amber", label: "Step paused" },
  step_resumed: { icon: Play, color: "amber", label: "Step resumed" },
  step_held: { icon: CircleDashed, color: "amber", label: "Step held" },
  reconciled: { icon: Settings2, color: "sky", label: "Reconciled" },

  // ── Goals (Stage 5) ────────────────────────────────────────────────────────
  goal_achieved: { icon: Target, color: "violet", label: "Goal achieved" },
  enrollment_completed: {
    icon: CheckCircle2,
    color: "emerald",
    label: "Enrollment completed",
  },
  goal_added: { icon: Flag, color: "violet", label: "Goal added" },
  goal_updated: { icon: ListChecks, color: "violet", label: "Goal updated" },
  goal_removed: { icon: UserMinus, color: "violet", label: "Goal removed" },
  goal_evaluation_error: {
    icon: ShieldAlert,
    color: "rose",
    label: "Goal evaluation error",
  },

  // ── System / housekeeping (Stage 6) ────────────────────────────────────────
  audit_drift_detected: {
    icon: TriangleAlert,
    color: "rose",
    label: "Audit drift detected",
  },
  events_archived: { icon: Database, color: "slate", label: "Events archived" },
  pii_erased: { icon: Eraser, color: "slate", label: "PII erased (GDPR)" },
  reconciliation_chunk_progress: {
    icon: History,
    color: "sky",
    label: "Reconciliation progress",
  },
};

export function getEventVisual(eventType: string): EventVisual {
  // Defensive default for forward-compat: unknown event types render with a
  // neutral inbox icon. Replay dispatcher does the same for unknown payload
  // versions (warning, not error).
  return (
    VISUAL[eventType as EnrollmentEventType] ?? {
      icon: Inbox,
      color: "slate",
      label: eventType,
    }
  );
}

/**
 * Tailwind class fragments for badge backgrounds + icon foreground.
 * Kept as a function-of-color so consumers don't construct Tailwind strings
 * by concatenation (which Tailwind's JIT cannot detect).
 */
export function colorClasses(color: EventColor): {
  bg: string;
  text: string;
  border: string;
  iconBg: string;
} {
  switch (color) {
    case "emerald":
      return {
        bg: "bg-emerald-50 dark:bg-emerald-950/40",
        text: "text-emerald-700 dark:text-emerald-300",
        border: "border-emerald-300 dark:border-emerald-800",
        iconBg: "bg-emerald-100 dark:bg-emerald-900/60",
      };
    case "sky":
      return {
        bg: "bg-sky-50 dark:bg-sky-950/40",
        text: "text-sky-700 dark:text-sky-300",
        border: "border-sky-300 dark:border-sky-800",
        iconBg: "bg-sky-100 dark:bg-sky-900/60",
      };
    case "amber":
      return {
        bg: "bg-amber-50 dark:bg-amber-950/40",
        text: "text-amber-700 dark:text-amber-300",
        border: "border-amber-300 dark:border-amber-800",
        iconBg: "bg-amber-100 dark:bg-amber-900/60",
      };
    case "rose":
      return {
        bg: "bg-rose-50 dark:bg-rose-950/40",
        text: "text-rose-700 dark:text-rose-300",
        border: "border-rose-300 dark:border-rose-800",
        iconBg: "bg-rose-100 dark:bg-rose-900/60",
      };
    case "violet":
      return {
        bg: "bg-violet-50 dark:bg-violet-950/40",
        text: "text-violet-700 dark:text-violet-300",
        border: "border-violet-300 dark:border-violet-800",
        iconBg: "bg-violet-100 dark:bg-violet-900/60",
      };
    case "slate":
    default:
      return {
        bg: "bg-slate-50 dark:bg-slate-950/40",
        text: "text-slate-700 dark:text-slate-300",
        border: "border-slate-300 dark:border-slate-800",
        iconBg: "bg-slate-100 dark:bg-slate-900/60",
      };
  }
}
