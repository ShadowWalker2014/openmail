/**
 * Stage 6 — useEnrollmentEvents (REQ-09 Timeline UI sync).
 *
 * Reads the workspace-scoped `enrollment_events` ElectricSQL shape and
 * filters to a single enrollment in-memory (Electric doesn't accept
 * arbitrary WHERE clauses on the proxy; the API enforces workspace scope
 * server-side).
 *
 * For workspaces with very many events this is suboptimal — the API
 * fallback `GET /api/v1/campaigns/:id/enrollments/:enrollmentId/events`
 * supports proper pagination. For typical per-enrollment volume (<100
 * events) the in-memory filter is fast.
 *
 * Returned events are sorted ascending by event_seq (chronological) so the
 * timeline renders top-to-bottom oldest-first; the UI may reverse to show
 * newest-first per user preference.
 */
import { useMemo } from "react";
import { useWorkspaceShape } from "./use-workspace-shape";

export interface EnrollmentEventRow extends Record<string, unknown> {
  id: string;
  enrollment_id: string | null;
  campaign_id: string;
  contact_id: string | null;
  workspace_id: string;
  event_type: string;
  payload_version: number;
  payload: Record<string, unknown> | null;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
  actor: Record<string, unknown> | null;
  event_seq: string | number | null;
  emitted_at: string;
}

export function useEnrollmentEvents(enrollmentId: string | null | undefined) {
  const shape = useWorkspaceShape<EnrollmentEventRow>("enrollment_events");
  const filtered = useMemo(() => {
    if (!enrollmentId) return [] as EnrollmentEventRow[];
    const rows = shape.data ?? [];
    return rows
      .filter((r) => r.enrollment_id === enrollmentId)
      .sort((a, b) => {
        const aSeq = a.event_seq != null ? Number(a.event_seq) : 0;
        const bSeq = b.event_seq != null ? Number(b.event_seq) : 0;
        if (aSeq !== bSeq) return aSeq - bSeq;
        return new Date(a.emitted_at).getTime() - new Date(b.emitted_at).getTime();
      });
  }, [shape.data, enrollmentId]);

  return {
    ...shape,
    data: filtered,
  };
}
