/**
 * Stage 5 — Campaign Goals Section (UI).
 *
 * Basic version per autonomous-run scope reduction:
 *   - List existing goals with summary (type, summary string, enabled state)
 *   - Add goal: event-based ONLY (eventName text input)
 *   - Attribute / Segment goal types: placeholder "Coming soon"
 *   - Remove goal
 *   - Toggle enabled state
 *
 * Frozen statuses (stopping / stopped / archived) hide the add/edit UI per
 * mirror of [REQ-28]. The API still returns 409 if the user tries — we
 * surface that as a toast.
 *
 * Future scope: rich condition builder for attribute/segment types
 * (reuse the segment condition builder pattern), property-filter UI for
 * event goals, drag-and-drop reordering by position.
 */
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { sessionFetch } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Trash2, Target, Plus } from "lucide-react";
import { toast } from "sonner";

interface CampaignGoal {
  id: string;
  campaignId: string;
  workspaceId: string;
  condition: {
    type: "event" | "attribute" | "segment";
    [k: string]: unknown;
  };
  position: number;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
}

interface GoalListProps {
  workspaceId: string;
  campaignId: string;
  campaignStatus: string;
}

const FROZEN_STATUSES = new Set(["stopping", "stopped", "archived"]);

function summarizeCondition(condition: CampaignGoal["condition"]): string {
  switch (condition.type) {
    case "event":
      return `event "${condition.eventName as string}"`;
    case "attribute":
      return `attribute ${condition.attributeKey} ${condition.operator} ${JSON.stringify(condition.value ?? null)}`;
    case "segment":
      return `${condition.requireMembership === false ? "leaves" : "joins"} segment ${condition.segmentId}`;
    default:
      return JSON.stringify(condition);
  }
}

export function GoalList({
  workspaceId,
  campaignId,
  campaignStatus,
}: GoalListProps) {
  const qc = useQueryClient();
  const [adding, setAdding] = useState(false);
  const [eventName, setEventName] = useState("");

  const frozen = FROZEN_STATUSES.has(campaignStatus);

  const goalsQuery = useQuery({
    queryKey: ["campaign-goals", workspaceId, campaignId],
    queryFn: () =>
      sessionFetch<{ data: CampaignGoal[] }>(
        workspaceId,
        `/campaigns/${campaignId}/goals`,
      ).then((r) => r.data),
  });

  const addMutation = useMutation({
    mutationFn: (input: {
      condition: { type: "event"; eventName: string };
    }) =>
      sessionFetch<CampaignGoal>(workspaceId, `/campaigns/${campaignId}/goals`, {
        method: "POST",
        body: JSON.stringify(input),
      }),
    onSuccess: () => {
      toast.success("Goal added");
      setAdding(false);
      setEventName("");
      qc.invalidateQueries({
        queryKey: ["campaign-goals", workspaceId, campaignId],
      });
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const removeMutation = useMutation({
    mutationFn: (goalId: string) =>
      sessionFetch<{ success: true }>(
        workspaceId,
        `/campaigns/${campaignId}/goals/${goalId}`,
        { method: "DELETE" },
      ),
    onSuccess: () => {
      toast.success("Goal removed");
      qc.invalidateQueries({
        queryKey: ["campaign-goals", workspaceId, campaignId],
      });
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const toggleMutation = useMutation({
    mutationFn: ({ goalId, enabled }: { goalId: string; enabled: boolean }) =>
      sessionFetch<CampaignGoal>(
        workspaceId,
        `/campaigns/${campaignId}/goals/${goalId}`,
        {
          method: "PATCH",
          body: JSON.stringify({ enabled }),
        },
      ),
    onSuccess: () => {
      qc.invalidateQueries({
        queryKey: ["campaign-goals", workspaceId, campaignId],
      });
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const goals = goalsQuery.data ?? [];

  return (
    <div className="border-t px-3 py-3 space-y-2">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Target className="h-3 w-3 text-muted-foreground" />
          <span className="text-[12px] font-medium">Goals</span>
          <Badge variant="secondary" className="text-[10px] h-4 px-1.5">
            {goals.length}
          </Badge>
        </div>
        {!frozen && !adding && (
          <Button
            size="sm"
            variant="ghost"
            className="h-6 px-2 text-[11px]"
            onClick={() => setAdding(true)}
          >
            <Plus className="h-3 w-3" />
            Add
          </Button>
        )}
      </div>

      {goalsQuery.isLoading && (
        <p className="text-[11px] text-muted-foreground">Loading…</p>
      )}

      {goals.length === 0 && !goalsQuery.isLoading && !adding && (
        <p className="text-[11px] text-muted-foreground">
          No goals. When a goal matches, the enrollment exits early.
        </p>
      )}

      {goals.map((g) => (
        <div
          key={g.id}
          className="rounded-md border px-2 py-1.5 flex items-start justify-between gap-2"
        >
          <div className="flex-1 min-w-0">
            <p className="text-[11px] font-medium flex items-center gap-1.5">
              <span className="capitalize">{g.condition.type}</span>
              {!g.enabled && (
                <span className="text-[9px] uppercase tracking-wide rounded px-1 bg-muted text-muted-foreground">
                  disabled
                </span>
              )}
            </p>
            <p className="text-[10px] text-muted-foreground truncate">
              {summarizeCondition(g.condition)}
            </p>
          </div>
          {!frozen && (
            <div className="flex items-center gap-1">
              <Button
                size="sm"
                variant="ghost"
                className="h-5 px-1 text-[10px]"
                onClick={() =>
                  toggleMutation.mutate({
                    goalId: g.id,
                    enabled: !g.enabled,
                  })
                }
              >
                {g.enabled ? "Disable" : "Enable"}
              </Button>
              <Button
                size="sm"
                variant="ghost"
                className="h-5 w-5 p-0"
                onClick={() => removeMutation.mutate(g.id)}
              >
                <Trash2 className="h-3 w-3 text-destructive" />
              </Button>
            </div>
          )}
        </div>
      ))}

      {adding && (
        <div className="rounded-md border p-2 space-y-2 bg-muted/30">
          <div className="space-y-1">
            <Label className="text-[10px]">Event name</Label>
            <Input
              autoFocus
              value={eventName}
              placeholder="e.g. checkout_completed"
              onChange={(e) => setEventName(e.target.value)}
              className="h-7 text-[11px]"
            />
            <p className="text-[10px] text-muted-foreground">
              Goal fires when this event is observed for the contact. Attribute
              + segment goal types coming soon.
            </p>
          </div>
          <div className="flex justify-end gap-1">
            <Button
              size="sm"
              variant="ghost"
              className="h-6 px-2 text-[11px]"
              onClick={() => {
                setAdding(false);
                setEventName("");
              }}
            >
              Cancel
            </Button>
            <Button
              size="sm"
              className="h-6 px-2 text-[11px]"
              disabled={!eventName.trim() || addMutation.isPending}
              onClick={() =>
                addMutation.mutate({
                  condition: { type: "event", eventName: eventName.trim() },
                })
              }
            >
              Add goal
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
