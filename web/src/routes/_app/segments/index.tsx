import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { sessionFetch } from "@/lib/api";
import { useWorkspaceStore } from "@/store/workspace";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogAction,
  AlertDialogCancel,
} from "@/components/ui/alert-dialog";
import { Plus, Filter, Trash2, X, Edit2 } from "lucide-react";
import { toast } from "sonner";
import { format } from "date-fns";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_app/segments/")({
  component: SegmentsPage,
});

// Conditions as returned from the API — the internal `id` field used for
// React reconciliation is stripped before saving, so it's not in the stored data.
interface ApiCondition {
  field: string;
  operator: string;
  value?: string;
}

interface Segment {
  id: string;
  name: string;
  description: string | null;
  conditions: ApiCondition[];
  conditionLogic: "and" | "or";
  createdAt: string;
  updatedAt: string;
}

// Local-only condition shape — adds a stable `id` for React keys and the
// onChange/onRemove handlers in ConditionRow. Never sent to the API.
interface Condition extends ApiCondition {
  id: string;
}

const FIELD_OPTIONS = [
  { value: "email", label: "Email" },
  { value: "firstName", label: "First Name" },
  { value: "lastName", label: "Last Name" },
  { value: "unsubscribed", label: "Subscription Status" },
  { value: "attributes.plan", label: "Plan" },
  { value: "attributes.company", label: "Company" },
];

const DEFAULT_OPERATORS = [
  { value: "equals", label: "is" },
  { value: "not_equals", label: "is not" },
  { value: "contains", label: "contains" },
  { value: "not_contains", label: "does not contain" },
  { value: "is_set", label: "is set" },
  { value: "is_not_set", label: "is not set" },
];

const BOOLEAN_OPERATORS = [
  { value: "equals", label: "is" },
];

const VALUE_OPTIONS: Record<string, { value: string; label: string }[]> = {
  unsubscribed: [
    { value: "true", label: "Unsubscribed" },
    { value: "false", label: "Subscribed" },
  ],
};

const NO_VALUE_OPERATORS = ["is_set", "is_not_set"];

function makeCondition(): Condition {
  return {
    id: crypto.randomUUID(),
    field: "email",
    operator: "contains",
    value: "",
  };
}

const INITIAL_CONDITIONS: Condition[] = [makeCondition()];

function ConditionRow({
  condition,
  total,
  onChange,
  onRemove,
}: {
  condition: Condition;
  total: number;
  onChange: (c: Condition) => void;
  onRemove: () => void;
}) {
  const isBooleanField = condition.field === "unsubscribed";
  const operators = isBooleanField ? BOOLEAN_OPERATORS : DEFAULT_OPERATORS;
  const valueOptions = VALUE_OPTIONS[condition.field];
  const showValue = !NO_VALUE_OPERATORS.includes(condition.operator);

  function handleFieldChange(field: string) {
    const isBoolean = field === "unsubscribed";
    onChange({
      ...condition,
      field,
      operator: "equals",
      value: isBoolean ? "true" : "",
    });
  }

  return (
    <div className="flex items-start gap-2">
      <div className="grid flex-1 grid-cols-[1fr_auto_1fr] gap-2 items-center">
        <select
          value={condition.field}
          onChange={(e) => handleFieldChange(e.target.value)}
          className="h-8 rounded-md border border-border bg-input px-3 text-[13px] text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring cursor-pointer"
        >
          {FIELD_OPTIONS.map((f) => (
            <option key={f.value} value={f.value}>
              {f.label}
            </option>
          ))}
        </select>

        <select
          value={condition.operator}
          onChange={(e) =>
            onChange({
              ...condition,
              operator: e.target.value,
              value: NO_VALUE_OPERATORS.includes(e.target.value)
                ? undefined
                : condition.value ?? "",
            })
          }
          className="h-8 rounded-md border border-border bg-input px-3 text-[13px] text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring cursor-pointer"
        >
          {operators.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>

        {showValue ? (
          valueOptions ? (
            <select
              value={condition.value ?? ""}
              onChange={(e) => onChange({ ...condition, value: e.target.value })}
              className="h-8 rounded-md border border-border bg-input px-3 text-[13px] text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring cursor-pointer"
            >
              {valueOptions.map((v) => (
                <option key={v.value} value={v.value}>
                  {v.label}
                </option>
              ))}
            </select>
          ) : (
            <Input
              value={condition.value ?? ""}
              onChange={(e) => onChange({ ...condition, value: e.target.value })}
              placeholder="Value"
            />
          )
        ) : (
          <div className="h-9" />
        )}
      </div>

      {total > 1 && (
        <button
          type="button"
          onClick={onRemove}
          className="mt-0.5 rounded p-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground cursor-pointer"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      )}
    </div>
  );
}

function conditionSummary(conditions: ApiCondition[], logic: "and" | "or"): string {
  if (!conditions?.length) return "No conditions";
  const parts = conditions.map((c) => {
    const field = FIELD_OPTIONS.find((f) => f.value === c.field)?.label ?? c.field;
    const op = DEFAULT_OPERATORS.find((o) => o.value === c.operator)?.label ?? c.operator;
    return NO_VALUE_OPERATORS.includes(c.operator)
      ? `${field} ${op}`
      : `${field} ${op} "${c.value}"`;
  });
  return parts.join(` ${logic.toUpperCase()} `);
}

function SegmentsPage() {
  const { activeWorkspaceId } = useWorkspaceStore();
  const qc = useQueryClient();
  const [createOpen, setCreateOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<Segment | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Segment | null>(null);

  // Create/edit dialog state
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [conditionLogic, setConditionLogic] = useState<"and" | "or">("and");
  const [conditions, setConditions] = useState<Condition[]>(INITIAL_CONDITIONS);

  function resetCreateForm() {
    setName("");
    setDescription("");
    setConditionLogic("and");
    setConditions([makeCondition()]);
  }

  function openEdit(segment: Segment) {
    setName(segment.name);
    setDescription(segment.description ?? "");
    setConditionLogic(segment.conditionLogic);
    // Hydrate conditions with local IDs for React reconciliation
    setConditions(segment.conditions.map((c) => ({ ...c, id: crypto.randomUUID() })));
    setEditTarget(segment);
    setCreateOpen(true);
  }

  const { data: segments = [], isLoading } = useQuery<Segment[]>({
    queryKey: ["segments", activeWorkspaceId],
    queryFn: () => sessionFetch(activeWorkspaceId!, "/segments"),
    enabled: !!activeWorkspaceId,
  });

  const createMutation = useMutation({
    mutationFn: () => {
      const apiConditions = conditions.map(({ id: _id, ...rest }) => rest);
      const payload = { name, description: description || undefined, conditions: apiConditions, conditionLogic };
      if (editTarget) {
        return sessionFetch(activeWorkspaceId!, `/segments/${editTarget.id}`, {
          method: "PATCH",
          body: JSON.stringify(payload),
        });
      }
      return sessionFetch(activeWorkspaceId!, "/segments", {
        method: "POST",
        body: JSON.stringify(payload),
      });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["segments", activeWorkspaceId] });
      // Capture before clearing — the state update is async so editTarget
      // still holds its current value at this point in the closure.
      const wasEditing = !!editTarget;
      setCreateOpen(false);
      setEditTarget(null);
      resetCreateForm();
      toast.success(wasEditing ? "Segment updated" : "Segment created");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) =>
      sessionFetch(activeWorkspaceId!, `/segments/${id}`, { method: "DELETE" }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["segments", activeWorkspaceId] });
      setDeleteTarget(null);
      toast.success("Segment deleted");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  function handleCreateSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    // Validate: all conditions with a value-requiring operator must have a non-empty value
    const invalid = conditions.find(
      (c) => !NO_VALUE_OPERATORS.includes(c.operator) && !VALUE_OPTIONS[c.field] && !c.value?.trim()
    );
    if (invalid) {
      toast.error("All conditions must have a value");
      return;
    }
    createMutation.mutate();
  }

  return (
    <div className="mx-auto max-w-5xl px-8 py-7">
      {/* Header */}
      <div className="mb-7 flex items-center justify-between">
        <div>
          <h1 className="text-[15px] font-semibold tracking-tight">Segments</h1>
          <p className="mt-0.5 text-[12px] text-muted-foreground">
            Dynamic contact groups for targeting broadcasts and campaigns
          </p>
        </div>
        <Button size="sm" onClick={() => setCreateOpen(true)}>
          <Plus className="h-4 w-4" />
          New Segment
        </Button>
      </div>

      {/* List */}
      <div className="space-y-2">
        {isLoading &&
          Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="rounded-lg border border-border bg-card p-4">
              <div className="flex items-center justify-between">
                <div className="space-y-2 flex-1">
                  <div className="h-4 w-36 rounded shimmer" />
                  <div className="h-3.5 w-64 rounded shimmer" />
                </div>
                <div className="h-3.5 w-16 rounded shimmer" />
              </div>
            </div>
          ))}

        {!isLoading &&
          segments.map((segment) => (
            <div
              key={segment.id}
              className="group flex items-center gap-4 rounded-lg border border-border bg-card p-4 transition-colors duration-150 hover:bg-accent/50"
            >
              <div className="min-w-0 flex-1">
                <p className="text-[13px] font-medium">{segment.name}</p>
                <p className="mt-0.5 truncate text-[11px] text-muted-foreground">
                  {conditionSummary(segment.conditions, segment.conditionLogic)}
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-1">
                <span className="text-[11px] text-muted-foreground tabular-nums opacity-0 transition-opacity duration-150 group-hover:opacity-100 mr-1">
                  {segment.createdAt ? format(new Date(segment.createdAt), "MMM d") : ""}
                </span>
                <button
                  onClick={() => openEdit(segment)}
                  className="rounded p-1.5 text-muted-foreground/40 opacity-0 transition-all duration-150 hover:bg-accent hover:text-foreground group-hover:opacity-100 focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-ring cursor-pointer"
                >
                  <Edit2 className="h-3.5 w-3.5" />
                </button>
                <button
                  onClick={() => setDeleteTarget(segment)}
                  className="rounded p-1.5 text-muted-foreground/40 opacity-0 transition-all duration-150 hover:bg-destructive/10 hover:text-destructive group-hover:opacity-100 focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-ring cursor-pointer"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>
          ))}

        {!isLoading && segments.length === 0 && (
          <div className="flex flex-col items-center justify-center py-20 text-center">
            <div className="mb-4 flex h-9 w-9 items-center justify-center rounded-lg border border-border">
              <Filter className="h-5 w-5 text-muted-foreground" />
            </div>
            <p className="text-[13px] font-medium">No segments yet</p>
            <p className="mt-1 text-[12px] text-muted-foreground">
              Create segments to target specific groups in broadcasts
            </p>
            <Button size="sm" className="mt-4" onClick={() => setCreateOpen(true)}>
              <Plus className="h-4 w-4" />
              New Segment
            </Button>
          </div>
        )}
      </div>

      {/* Create dialog */}
      <Dialog
        open={createOpen}
        onOpenChange={(v) => {
          setCreateOpen(v);
          if (!v) {
            setEditTarget(null);
            resetCreateForm();
          }
        }}
      >
        <DialogContent className="max-w-xl">
          <DialogHeader>
            <DialogTitle>{editTarget ? "Edit Segment" : "New Segment"}</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleCreateSubmit} className="space-y-5">
          <div>
            <div className="space-y-1.5">
              <Label>Name *</Label>
              <Input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Active paying customers"
                required
              />
            </div>
            <div className="space-y-1.5">
              <Label>Description</Label>
              <Input
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Optional description"
              />
            </div>

            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <Label>Conditions *</Label>
                {conditions.length > 1 && (
                  <div className="flex items-center gap-1 rounded-md border p-0.5">
                    {(["and", "or"] as const).map((l) => (
                      <button
                        key={l}
                        type="button"
                        onClick={() => setConditionLogic(l)}
                        className={cn(
                          "rounded px-2.5 py-0.5 text-xs font-medium transition-colors cursor-pointer",
                          conditionLogic === l
                            ? "bg-foreground text-background"
                            : "text-muted-foreground hover:text-foreground"
                        )}
                      >
                        {l.toUpperCase()}
                      </button>
                    ))}
                  </div>
                )}
              </div>

              <div className="space-y-2">
                {conditions.map((cond, i) => (
                  <div key={cond.id}>
                    {i > 0 && (
                      <div className="flex items-center gap-2 py-1">
                        <div className="h-px flex-1 bg-border" />
                        <span className="text-xs font-medium text-muted-foreground uppercase">
                          {conditionLogic}
                        </span>
                        <div className="h-px flex-1 bg-border" />
                      </div>
                    )}
                    <ConditionRow
                      condition={cond}
                      total={conditions.length}
                      onChange={(updated) =>
                        setConditions((cs) =>
                          cs.map((c) => (c.id === cond.id ? updated : c))
                        )
                      }
                      onRemove={() =>
                        setConditions((cs) => cs.filter((c) => c.id !== cond.id))
                      }
                    />
                  </div>
                ))}
              </div>

              <button
                type="button"
                onClick={() => setConditions((cs) => [...cs, makeCondition()])}
                className="flex items-center gap-1.5 text-xs text-muted-foreground transition-colors hover:text-foreground cursor-pointer"
              >
                <Plus className="h-3.5 w-3.5" />
                Add condition
              </button>
            </div>

          </div>
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  setCreateOpen(false);
                  setEditTarget(null);
                  resetCreateForm();
                }}
              >
                Cancel
              </Button>
              <Button
                type="submit"
                disabled={createMutation.isPending || !name.trim()}
              >
                {createMutation.isPending
                  ? (editTarget ? "Saving…" : "Creating…")
                  : (editTarget ? "Save Segment" : "Create Segment")}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Delete confirmation */}
      <AlertDialog
        open={!!deleteTarget}
        onOpenChange={(o) => !o && setDeleteTarget(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete segment?</AlertDialogTitle>
            <AlertDialogDescription>
              <strong className="text-foreground font-medium">
                {deleteTarget?.name}
              </strong>{" "}
              will be permanently deleted. Broadcasts that used this segment
              will not be affected.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={deleteMutation.isPending}
              onClick={() =>
                deleteTarget && deleteMutation.mutate(deleteTarget.id)
              }
            >
              {deleteMutation.isPending ? "Deleting…" : "Delete"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
