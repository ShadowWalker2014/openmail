/**
 * Stage 6 (UI follow-up) — CSV / JSON export of currently-filtered events.
 *
 * Triggered from the timeline toolbar; download is client-side (Blob URL).
 * Filename includes the campaign id (or enrollment id) and an ISO timestamp
 * so multiple downloads don't overwrite each other in the operator's
 * Downloads folder.
 *
 * No server round-trip — exports the in-memory filtered set already shown
 * to the operator. For workspaces that need the full archive (across the
 * 180d retention window), a separate paginated REST endpoint will be needed
 * (follow-up; out of scope for this UI iteration).
 */
import { Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import type { EnrollmentEventRow } from "@/hooks/use-enrollment-events";

export interface TimelineExportProps {
  rows: EnrollmentEventRow[];
  /** Filename prefix, e.g. campaign id or enrollment id. */
  filenamePrefix: string;
  disabled?: boolean;
}

export function TimelineExportButton({
  rows,
  filenamePrefix,
  disabled,
}: TimelineExportProps) {
  const ts = new Date().toISOString().replace(/[:.]/g, "-").replace(/Z$/, "Z");
  const baseName = `${sanitize(filenamePrefix)}-timeline-${ts}`;

  const downloadCsv = () => {
    const blob = new Blob([toCsv(rows)], { type: "text/csv;charset=utf-8" });
    triggerDownload(blob, `${baseName}.csv`);
  };
  const downloadJson = () => {
    const blob = new Blob([JSON.stringify(rows, null, 2)], {
      type: "application/json;charset=utf-8",
    });
    triggerDownload(blob, `${baseName}.json`);
  };

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          className="h-8 text-xs"
          disabled={disabled || rows.length === 0}
          title={
            rows.length === 0
              ? "No events to export"
              : `Export ${rows.length} events`
          }
        >
          <Download className="h-3.5 w-3.5 mr-1" />
          Export
          <span className="ml-1 text-[10px] text-muted-foreground">
            {rows.length}
          </span>
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[140px] p-1" align="end">
        <button
          type="button"
          onClick={downloadCsv}
          className="w-full text-left text-sm px-2 py-1 rounded hover:bg-muted"
        >
          CSV
        </button>
        <button
          type="button"
          onClick={downloadJson}
          className="w-full text-left text-sm px-2 py-1 rounded hover:bg-muted"
        >
          JSON
        </button>
      </PopoverContent>
    </Popover>
  );
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function sanitize(s: string): string {
  return s.replace(/[^a-zA-Z0-9_.-]+/g, "-").slice(0, 60);
}

function triggerDownload(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  // Revoke after the click handler returns; some browsers keep the URL alive
  // briefly during the download dialog.
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/**
 * CSV columns are stable & schema-aligned. Multi-line / nested JSON fields
 * are stringified + escaped per RFC 4180 (double quotes doubled, fields
 * with commas/quotes/newlines wrapped in quotes).
 *
 * Column order:
 *   id, emitted_at, event_seq, event_type, payload_version,
 *   workspace_id, campaign_id, enrollment_id, contact_id,
 *   actor_kind, actor_id, lifecycle_op_id,
 *   payload, before, after
 */
export function toCsv(rows: EnrollmentEventRow[]): string {
  const headers = [
    "id",
    "emitted_at",
    "event_seq",
    "event_type",
    "payload_version",
    "workspace_id",
    "campaign_id",
    "enrollment_id",
    "contact_id",
    "actor_kind",
    "actor_id",
    "lifecycle_op_id",
    "payload",
    "before",
    "after",
  ];
  const escape = (v: unknown): string => {
    if (v == null) return "";
    const s = typeof v === "string" ? v : JSON.stringify(v);
    if (s.includes(",") || s.includes('"') || s.includes("\n")) {
      return `"${s.replace(/"/g, '""')}"`;
    }
    return s;
  };
  const lines = [headers.join(",")];
  for (const r of rows) {
    const actor = (r.actor ?? {}) as Record<string, unknown>;
    const payload = (r.payload ?? {}) as Record<string, unknown>;
    const actorKind = String(actor.kind ?? "");
    const actorId =
      (actor.userId as string | undefined) ??
      (actor.apiKeyId as string | undefined) ??
      (actor.runId as string | undefined) ??
      (actor.name as string | undefined) ??
      "";
    const opId = String(payload.lifecycle_op_id ?? "");
    lines.push(
      [
        escape(r.id),
        escape(r.emitted_at),
        escape(r.event_seq),
        escape(r.event_type),
        escape(r.payload_version),
        escape(r.workspace_id),
        escape(r.campaign_id),
        escape(r.enrollment_id),
        escape(r.contact_id),
        escape(actorKind),
        escape(actorId),
        escape(opId),
        escape(r.payload),
        escape(r.before),
        escape(r.after),
      ].join(","),
    );
  }
  return lines.join("\n");
}
