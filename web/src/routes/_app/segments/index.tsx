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
import {
  Plus, Filter, Trash2, X, Edit2, Users, Search, ChevronLeft, ChevronRight,
} from "lucide-react";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";
import { format } from "date-fns";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_app/segments/")({
  component: SegmentsPage,
});

// ── Types ─────────────────────────────────────────────────────────────────────

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

// Local-only — adds a stable `id` for React keys; never sent to the API.
interface Condition extends ApiCondition {
  id: string;
}

interface SegmentPerson {
  id: string;
  email: string;
  firstName: string | null;
  lastName: string | null;
  unsubscribed: boolean;
  createdAt: string;
}

interface PeopleResponse {
  data: SegmentPerson[];
  total: number;
  page: number;
  pageSize: number;
}

interface UsageCampaign {
  id: string;
  name: string;
  status: string;
  triggerType: string;
}

interface UsageBroadcast {
  id: string;
  name: string;
  status: string;
  subject: string;
}

interface UsageResponse {
  campaigns: UsageCampaign[];
  broadcasts: UsageBroadcast[];
}

// ── Constants ─────────────────────────────────────────────────────────────────

const FIELD_OPTIONS = [
  { value: "email", label: "Email" },
  { value: "firstName", label: "First Name" },
  { value: "lastName", label: "Last Name" },
  { value: "unsubscribed", label: "Subscription Status" },
  { value: "attributes.plan", label: "Plan" },
  { value: "attributes.company", label: "Company" },
];

const DEFAULT_OPERATORS = [
  { value: "eq", label: "is" },
  { value: "ne", label: "is not" },
  { value: "contains", label: "contains" },
  { value: "not_contains", label: "does not contain" },
  { value: "exists", label: "is set" },
  { value: "not_exists", label: "is not set" },
];

const BOOLEAN_OPERATORS = [
  { value: "eq", label: "is" },
];

const VALUE_OPTIONS: Record<string, { value: string; label: string }[]> = {
  unsubscribed: [
    { value: "true", label: "Unsubscribed" },
    { value: "false", label: "Subscribed" },
  ],
};

const NO_VALUE_OPERATORS = ["exists", "not_exists"];

const PEOPLE_PAGE_SIZE = 50;

const OPERATOR_ALIAS: Record<string, string> = {
  equals: "eq",
  not_equals: "ne",
  is_set: "exists",
  is_not_set: "not_exists",
};

function normalizeOperator(op: string): string {
  return OPERATOR_ALIAS[op] ?? op;
}

function makeCondition(): Condition {
  return { id: crypto.randomUUID(), field: "email", operator: "contains", value: "" };
}

function normalizeCondition(c: ApiCondition): ApiCondition {
  return { ...c, operator: normalizeOperator(c.operator) };
}

// ── SegmentSizeCell ───────────────────────────────────────────────────────────

function SegmentSizeCell({ segmentId, workspaceId }: { segmentId: string; workspaceId: string }) {
  const { data } = useQuery<{ total: number }>({
    queryKey: ["segment-size", segmentId],
    queryFn: () => sessionFetch(workspaceId, `/segments/${segmentId}/people?page=1&pageSize=1`),
    staleTime: Infinity,
    gcTime: Infinity,
  });
  if (!data) return <div className="h-3 w-12 rounded shimmer ml-auto" />;
  return (
    <span className="text-[12px] tabular-nums text-muted-foreground">
      {data.total.toLocaleString()} people
    </span>
  );
}

// ── ConditionRow ──────────────────────────────────────────────────────────────

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
    onChange({ ...condition, field, operator: "eq", value: isBoolean ? "true" : "" });
  }

  return (
    <div className="flex items-center gap-2">
      <div className="grid flex-1 grid-cols-[1fr_auto_1fr] gap-2 items-center">
        <Select value={condition.field} onValueChange={handleFieldChange}>
          <SelectTrigger className="h-8">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {FIELD_OPTIONS.map((f) => (
              <SelectItem key={f.value} value={f.value}>{f.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select
          value={condition.operator}
          onValueChange={(val) =>
            onChange({
              ...condition,
              operator: val,
              value: NO_VALUE_OPERATORS.includes(val) ? undefined : condition.value ?? "",
            })
          }
        >
          <SelectTrigger className="h-8 w-[130px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {operators.map((o) => (
              <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>

        {showValue ? (
          valueOptions ? (
            <Select
              value={condition.value ?? ""}
              onValueChange={(val) => onChange({ ...condition, value: val })}
            >
              <SelectTrigger className="h-8">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {valueOptions.map((v) => (
                  <SelectItem key={v.value} value={v.value}>{v.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : (
            <Input
              value={condition.value ?? ""}
              onChange={(e) => onChange({ ...condition, value: e.target.value })}
              placeholder="Value"
              className="h-8"
            />
          )
        ) : (
          <div className="h-8" />
        )}
      </div>

      {total > 1 && (
        <button
          type="button"
          onClick={onRemove}
          className="shrink-0 rounded p-1.5 text-muted-foreground/50 transition-colors duration-100 hover:bg-destructive/10 hover:text-destructive cursor-pointer"
        >
          <X className="h-3 w-3" />
        </button>
      )}
    </div>
  );
}

// ── SegmentDetailDialog ───────────────────────────────────────────────────────

interface SegmentDetailDialogProps {
  segment: Segment;
  workspaceId: string;
  onClose: () => void;
  onEdit: (segment: Segment) => void;
  onDelete: (segment: Segment) => void;
}

function SegmentDetailDialog({ segment, workspaceId, onClose, onEdit, onDelete }: SegmentDetailDialogProps) {
  const [activeTab, setActiveTab] = useState<"overview" | "people" | "usage">("overview");
  const [peoplePage, setPeoplePage] = useState(1);

  const { data: peopleData, isLoading: peopleLoading } = useQuery<PeopleResponse>({
    queryKey: ["segment-people", segment.id, 1],
    queryFn: () => sessionFetch(workspaceId, `/segments/${segment.id}/people?page=1&pageSize=5`),
  });

  const { data: allPeopleData, isLoading: allPeopleLoading } = useQuery<PeopleResponse>({
    queryKey: ["segment-people-all", segment.id, peoplePage],
    queryFn: () => sessionFetch(workspaceId, `/segments/${segment.id}/people?page=${peoplePage}&pageSize=${PEOPLE_PAGE_SIZE}`),
    enabled: activeTab === "people",
  });

  const { data: usageData, isLoading: usageLoading } = useQuery<UsageResponse>({
    queryKey: ["segment-usage", segment.id],
    queryFn: () => sessionFetch(workspaceId, `/segments/${segment.id}/usage`),
    enabled: activeTab === "usage",
  });

  const tabs = [
    { id: "overview" as const, label: "Overview" },
    { id: "people" as const, label: "People" },
    { id: "usage" as const, label: "Usage" },
  ];

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-[96vw] w-[96vw] h-[92vh] p-0 gap-0 flex flex-col overflow-hidden">
        {/* Top bar */}
        <DialogHeader className="shrink-0 flex flex-row items-center justify-between px-5 py-3 border-b border-border gap-0">
          <div>
            <DialogTitle className="text-[14px] font-semibold">{segment.name}</DialogTitle>
            <p className="text-[11px] text-muted-foreground mt-0.5">
              {segment.description || "No description"}
            </p>
          </div>
          <div className="flex items-center gap-2 mr-8">
            <span className="text-[11px] text-muted-foreground">
              Updated {format(new Date(segment.updatedAt), "MMM d, yyyy")}
            </span>
            <Button variant="outline" size="sm" onClick={() => onEdit(segment)}>
              <Edit2 className="h-3.5 w-3.5" />
              Edit
            </Button>
            <button
              onClick={() => onDelete(segment)}
              className="rounded p-1.5 text-muted-foreground/40 hover:text-destructive hover:bg-destructive/10 cursor-pointer transition-colors"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          </div>
        </DialogHeader>

        {/* Tab bar */}
        <div className="flex items-center border-b border-border px-5 shrink-0">
          {tabs.map((t) => (
            <button
              key={t.id}
              onClick={() => {
                setActiveTab(t.id);
                if (t.id === "people") setPeoplePage(1);
              }}
              className={cn(
                "px-4 py-2.5 text-[13px] font-medium border-b-2 -mb-px transition-colors cursor-pointer",
                activeTab === t.id
                  ? "border-foreground text-foreground"
                  : "border-transparent text-muted-foreground hover:text-foreground"
              )}
            >
              {t.label}
            </button>
          ))}
        </div>

        {/* Tab content */}
        <div className="flex-1 overflow-hidden">
          {/* ── Overview ── */}
          {activeTab === "overview" && (
            <div className="flex h-full">
              {/* Left: conditions */}
              <div className="w-[360px] shrink-0 border-r border-border overflow-y-auto p-5">
                <div className="flex items-center justify-between mb-3">
                  <h3 className="text-[12px] font-semibold uppercase tracking-wide text-muted-foreground">
                    Matches condition
                  </h3>
                  <button
                    onClick={() => onEdit(segment)}
                    className="flex items-center gap-1 text-[12px] text-blue-500 hover:text-blue-600 cursor-pointer transition-colors"
                  >
                    <Edit2 className="h-3 w-3" /> Edit
                  </button>
                </div>

                <div className="space-y-2">
                  {segment.conditions.length === 0 && (
                    <p className="text-[12px] text-muted-foreground">No conditions defined</p>
                  )}
                  {segment.conditions.map((cond, i) => (
                    <div key={i}>
                      {i > 0 && (
                        <div className="flex items-center gap-2 my-2">
                          <div className="h-px flex-1 bg-border" />
                          <span className="text-[10px] font-medium uppercase text-muted-foreground">
                            {segment.conditionLogic}
                          </span>
                          <div className="h-px flex-1 bg-border" />
                        </div>
                      )}
                      <div className="rounded-lg border border-border bg-muted/30 px-3 py-2 text-[12px]">
                        <span className="font-medium">
                          {FIELD_OPTIONS.find((f) => f.value === cond.field)?.label ?? cond.field}
                        </span>{" "}
                        <span className="text-muted-foreground">
                          {DEFAULT_OPERATORS.find((o) => o.value === normalizeOperator(cond.operator))?.label ?? cond.operator}
                        </span>
                        {cond.value && (
                          <span className="font-medium text-foreground"> {String(cond.value)}</span>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Right: size + sample members */}
              <div className="flex-1 overflow-y-auto p-5 space-y-5">
                {/* Segment size card */}
                <div className="rounded-lg border border-border bg-card p-4">
                  <div className="flex items-center gap-2 mb-1">
                    <Users className="h-4 w-4 text-muted-foreground" />
                    <span className="text-[13px] font-semibold">Segment Size</span>
                  </div>
                  {peopleLoading ? (
                    <div className="h-8 w-20 rounded shimmer mt-1" />
                  ) : (
                    <p className="text-[28px] font-bold tabular-nums">
                      {(peopleData?.total ?? 0).toLocaleString()}
                    </p>
                  )}
                  <p className="text-[11px] text-muted-foreground">people match this segment</p>
                </div>

                {/* Sample members */}
                <div>
                  <h3 className="text-[13px] font-semibold mb-3">Sample Members</h3>
                  <div className="rounded-lg border border-border overflow-hidden">
                    {peopleLoading &&
                      Array.from({ length: 5 }).map((_, i) => (
                        <div
                          key={i}
                          className="flex items-center gap-3 px-4 py-2.5 border-b border-border/50 last:border-0"
                        >
                          <div className="h-7 w-7 rounded-full shimmer shrink-0" />
                          <div className="space-y-1.5 flex-1">
                            <div className="h-3 w-32 rounded shimmer" />
                            <div className="h-2.5 w-48 rounded shimmer" />
                          </div>
                        </div>
                      ))}
                    {!peopleLoading &&
                      (peopleData?.data ?? []).slice(0, 5).map((contact) => (
                        <div
                          key={contact.id}
                          className="flex items-center gap-3 px-4 py-2.5 border-b border-border/50 last:border-0 hover:bg-accent/30 transition-colors"
                        >
                          <div className="h-7 w-7 rounded-full bg-violet-500 flex items-center justify-center text-white text-[11px] font-semibold shrink-0">
                            {contact.email[0].toUpperCase()}
                          </div>
                          <div className="min-w-0">
                            <p className="text-[12px] font-medium truncate">
                              {[contact.firstName, contact.lastName].filter(Boolean).join(" ") || contact.email}
                            </p>
                            <p className="text-[11px] text-muted-foreground truncate">{contact.email}</p>
                          </div>
                        </div>
                      ))}
                    {!peopleLoading && !peopleData?.data.length && (
                      <div className="px-4 py-8 text-center text-[12px] text-muted-foreground">
                        No contacts match this segment
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* ── People ── */}
          {activeTab === "people" && (
            <div className="h-full flex flex-col">
              <div className="flex-1 overflow-y-auto">
                <table className="w-full text-[13px]">
                  <thead className="sticky top-0 z-10">
                    <tr className="border-b border-border bg-muted/50">
                      <th className="px-4 py-2.5 text-left text-[11px] font-medium text-muted-foreground/70 tracking-wide uppercase">
                        Email
                      </th>
                      <th className="px-4 py-2.5 text-left text-[11px] font-medium text-muted-foreground/70 tracking-wide uppercase">
                        Name
                      </th>
                      <th className="px-4 py-2.5 text-left text-[11px] font-medium text-muted-foreground/70 tracking-wide uppercase">
                        Status
                      </th>
                      <th className="px-4 py-2.5 text-left text-[11px] font-medium text-muted-foreground/70 tracking-wide uppercase">
                        Joined
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {allPeopleLoading &&
                      Array.from({ length: 10 }).map((_, i) => (
                        <tr key={i} className="border-b border-border/50">
                          <td className="px-4 py-3"><div className="h-3.5 w-48 rounded shimmer" /></td>
                          <td className="px-4 py-3"><div className="h-3.5 w-32 rounded shimmer" /></td>
                          <td className="px-4 py-3"><div className="h-3.5 w-16 rounded shimmer" /></td>
                          <td className="px-4 py-3"><div className="h-3.5 w-20 rounded shimmer" /></td>
                        </tr>
                      ))}
                    {!allPeopleLoading &&
                      (allPeopleData?.data ?? []).map((contact) => (
                        <tr
                          key={contact.id}
                          className="border-b border-border/50 last:border-0 hover:bg-accent/30 transition-colors"
                        >
                          <td className="px-4 py-3">
                            <div className="flex items-center gap-2">
                              <div className="h-6 w-6 rounded-full bg-violet-500 flex items-center justify-center text-white text-[10px] font-semibold shrink-0">
                                {contact.email[0].toUpperCase()}
                              </div>
                              <span className="text-[12px]">{contact.email}</span>
                            </div>
                          </td>
                          <td className="px-4 py-3 text-[12px] text-muted-foreground">
                            {[contact.firstName, contact.lastName].filter(Boolean).join(" ") || "—"}
                          </td>
                          <td className="px-4 py-3">
                            <span
                              className={cn(
                                "inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-medium",
                                contact.unsubscribed
                                  ? "bg-destructive/10 text-destructive"
                                  : "bg-emerald-500/10 text-emerald-500"
                              )}
                            >
                              {contact.unsubscribed ? "Unsubscribed" : "Subscribed"}
                            </span>
                          </td>
                          <td className="px-4 py-3 text-[12px] text-muted-foreground">
                            {format(new Date(contact.createdAt), "MMM d, yyyy")}
                          </td>
                        </tr>
                      ))}
                    {!allPeopleLoading && !allPeopleData?.data.length && (
                      <tr>
                        <td colSpan={4} className="px-4 py-12 text-center text-[12px] text-muted-foreground">
                          No contacts match this segment
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>

              {/* Pagination */}
              {allPeopleData && allPeopleData.total > PEOPLE_PAGE_SIZE && (
                <div className="shrink-0 flex items-center justify-between px-4 py-3 border-t border-border">
                  <span className="text-[12px] text-muted-foreground">
                    {(peoplePage - 1) * PEOPLE_PAGE_SIZE + 1}–{Math.min(peoplePage * PEOPLE_PAGE_SIZE, allPeopleData.total)} of{" "}
                    {allPeopleData.total.toLocaleString()} contacts
                  </span>
                  <div className="flex items-center gap-1">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setPeoplePage((p) => p - 1)}
                      disabled={peoplePage === 1}
                    >
                      <ChevronLeft className="h-3.5 w-3.5" />
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setPeoplePage((p) => p + 1)}
                      disabled={peoplePage * PEOPLE_PAGE_SIZE >= allPeopleData.total}
                    >
                      <ChevronRight className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* ── Usage ── */}
          {activeTab === "usage" && (
            <div className="p-5 overflow-y-auto h-full">
              <div className="grid grid-cols-2 gap-4 max-w-3xl">
                {/* Campaigns card */}
                <div className="rounded-lg border border-border bg-card">
                  <div className="px-4 py-3 border-b border-border">
                    <h3 className="text-[13px] font-semibold">Campaigns</h3>
                    <p className="text-[11px] text-muted-foreground mt-0.5">
                      Campaigns using this segment as a trigger
                    </p>
                  </div>
                  {usageLoading ? (
                    <div className="p-4 space-y-3">
                      {Array.from({ length: 2 }).map((_, i) => (
                        <div key={i} className="h-10 rounded shimmer" />
                      ))}
                    </div>
                  ) : (usageData?.campaigns ?? []).length === 0 ? (
                    <div className="px-4 py-8 text-center text-[12px] text-muted-foreground">
                      No campaigns use this segment
                    </div>
                  ) : (
                    <div>
                      {(usageData?.campaigns ?? []).map((campaign) => (
                        <div
                          key={campaign.id}
                          className="flex items-center justify-between px-4 py-3 border-b border-border/50 last:border-0"
                        >
                          <div>
                            <p className="text-[12px] font-medium">{campaign.name}</p>
                            <p className="text-[11px] text-muted-foreground capitalize">
                              {campaign.triggerType?.replace(/_/g, " ")}
                            </p>
                          </div>
                          <span
                            className={cn(
                              "inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-medium",
                              campaign.status === "active"
                                ? "bg-emerald-500/10 text-emerald-500"
                                : campaign.status === "paused"
                                ? "bg-amber-500/10 text-amber-500"
                                : "bg-muted text-muted-foreground"
                            )}
                          >
                            {campaign.status}
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {/* Broadcasts card */}
                <div className="rounded-lg border border-border bg-card">
                  <div className="px-4 py-3 border-b border-border">
                    <h3 className="text-[13px] font-semibold">Broadcasts</h3>
                    <p className="text-[11px] text-muted-foreground mt-0.5">
                      Broadcasts targeting this segment
                    </p>
                  </div>
                  {usageLoading ? (
                    <div className="p-4 space-y-3">
                      {Array.from({ length: 2 }).map((_, i) => (
                        <div key={i} className="h-10 rounded shimmer" />
                      ))}
                    </div>
                  ) : (usageData?.broadcasts ?? []).length === 0 ? (
                    <div className="px-4 py-8 text-center text-[12px] text-muted-foreground">
                      No broadcasts use this segment
                    </div>
                  ) : (
                    <div>
                      {(usageData?.broadcasts ?? []).map((broadcast) => (
                        <div
                          key={broadcast.id}
                          className="flex items-center justify-between px-4 py-3 border-b border-border/50 last:border-0"
                        >
                          <div>
                            <p className="text-[12px] font-medium">{broadcast.name}</p>
                            <p className="text-[11px] text-muted-foreground truncate max-w-[180px]">
                              {broadcast.subject}
                            </p>
                          </div>
                          <span
                            className={cn(
                              "inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-medium",
                              broadcast.status === "sent"
                                ? "bg-emerald-500/10 text-emerald-500"
                                : broadcast.status === "scheduled"
                                ? "bg-blue-500/10 text-blue-500"
                                : "bg-muted text-muted-foreground"
                            )}
                          >
                            {broadcast.status}
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ── SegmentsPage ──────────────────────────────────────────────────────────────

function SegmentsPage() {
  const { activeWorkspaceId } = useWorkspaceStore();
  const qc = useQueryClient();

  // List state
  const [searchQuery, setSearchQuery] = useState("");
  const [detailSegment, setDetailSegment] = useState<Segment | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Segment | null>(null);

  // Create/edit dialog state
  const [createOpen, setCreateOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<Segment | null>(null);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [conditionLogic, setConditionLogic] = useState<"and" | "or">("and");
  const [conditions, setConditions] = useState<Condition[]>(() => [makeCondition()]);

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
    setConditions(segment.conditions.map((c) => ({ ...normalizeCondition(c), id: crypto.randomUUID() })));
    setEditTarget(segment);
    setCreateOpen(true);
  }

  function handleDeleteRequest(segment: Segment) {
    // Close detail dialog before showing delete confirmation
    setDetailSegment(null);
    setDeleteTarget(segment);
  }

  const { data: segments = [], isLoading, isError } = useQuery<Segment[]>({
    queryKey: ["segments", activeWorkspaceId],
    queryFn: () => sessionFetch<{ data: Segment[] }>(activeWorkspaceId!, "/segments?pageSize=100").then((res) => res.data),
    enabled: !!activeWorkspaceId,
  });

  const filteredSegments = segments.filter(
    (s) => !searchQuery || s.name.toLowerCase().includes(searchQuery.toLowerCase())
  );

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
    const invalid = conditions.find(
      (c) => !NO_VALUE_OPERATORS.includes(c.operator) && !VALUE_OPTIONS[c.field] && !c.value?.trim()
    );
    if (invalid) {
      toast.error("All conditions must have a value");
      return;
    }
    createMutation.mutate();
  }

  const skeletonRows = Array.from({ length: 4 }).map((_, i) => (
    <tr key={i} className="border-b border-border/50">
      <td className="px-4 py-3">
        <div className="h-3.5 w-3.5 rounded shimmer" />
      </td>
      <td className="px-4 py-3">
        <div className="space-y-1.5">
          <div className="h-3.5 w-40 rounded shimmer" />
          <div className="h-3 w-64 rounded shimmer" />
        </div>
      </td>
      <td className="px-4 py-3 text-right">
        <div className="h-3 w-16 rounded shimmer ml-auto" />
      </td>
      <td className="px-4 py-3 text-right">
        <div className="h-3 w-12 rounded shimmer ml-auto" />
      </td>
      <td className="px-4 py-3" />
    </tr>
  ));

  return (
    <div className="px-8 py-7 w-full">
      {/* Header */}
      <div className="mb-5 flex items-center justify-between">
        <div>
          <h1 className="text-[15px] font-semibold tracking-tight">Segments</h1>
          <p className="mt-0.5 text-[12px] text-muted-foreground">
            Dynamic contact groups for targeting broadcasts and campaigns
          </p>
        </div>
        <Button size="sm" onClick={() => setCreateOpen(true)}>
          <Plus className="h-3.5 w-3.5" />
          New Segment
        </Button>
      </div>

      {/* Search */}
      {(segments.length > 0 || isLoading) && (
        <div className="relative mb-4 max-w-sm">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground/50" />
          <Input
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search segments…"
            className="pl-8 h-8 text-[13px]"
          />
        </div>
      )}

      {isError && (
        <div className="mb-4 flex items-center gap-2 rounded-lg border border-destructive/20 bg-destructive/8 px-3.5 py-2.5 text-[13px] text-destructive">
          Failed to load segments.
        </div>
      )}

      {/* Table */}
      <div className="overflow-hidden rounded-lg border border-border">
        <table className="w-full text-[13px]">
          <thead>
            <tr className="border-b border-border bg-muted/50">
              <th className="px-4 py-2.5 text-left text-[11px] font-medium text-muted-foreground/70 tracking-wide uppercase w-8" />
              <th className="px-4 py-2.5 text-left text-[11px] font-medium text-muted-foreground/70 tracking-wide uppercase">
                Name
              </th>
              <th className="px-4 py-2.5 text-right text-[11px] font-medium text-muted-foreground/70 tracking-wide uppercase w-32">
                Conditions
              </th>
              <th className="px-4 py-2.5 text-right text-[11px] font-medium text-muted-foreground/70 tracking-wide uppercase w-28">Size</th>
              <th className="px-4 py-2.5 text-right text-[11px] font-medium text-muted-foreground/70 tracking-wide uppercase w-24">
                Actions
              </th>
            </tr>
          </thead>
          <tbody>
            {isLoading && skeletonRows}

            {!isLoading &&
              filteredSegments.map((segment) => (
                <tr
                  key={segment.id}
                  onClick={() => setDetailSegment(segment)}
                  className="group border-b border-border/50 last:border-0 hover:bg-accent/40 cursor-pointer transition-colors"
                >
                  <td className="px-4 py-3">
                    <Filter className="h-3.5 w-3.5 text-muted-foreground/50" />
                  </td>
                  <td className="px-4 py-3">
                    <p className="font-medium text-[13px]">{segment.name}</p>
                    {segment.description && (
                      <p className="text-[11px] text-muted-foreground truncate max-w-md">
                        {segment.description}
                      </p>
                    )}
                    <p className="text-[10px] text-muted-foreground/50 mt-0.5">
                      Created {format(new Date(segment.createdAt), "MMM d, yyyy")}
                      {" · "}
                      Updated {format(new Date(segment.updatedAt), "MMM d, yyyy")}
                    </p>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <span className="text-[11px] text-muted-foreground">
                      {segment.conditions?.length ?? 0}{" "}
                      condition{(segment.conditions?.length ?? 0) !== 1 ? "s" : ""}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right">
                    {activeWorkspaceId && (
                      <SegmentSizeCell segmentId={segment.id} workspaceId={activeWorkspaceId} />
                    )}
                  </td>
                  <td className="px-4 py-3" onClick={(e) => e.stopPropagation()}>
                    <div className="flex items-center justify-end gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                      <button
                        onClick={() => openEdit(segment)}
                        className="rounded p-1.5 text-muted-foreground/40 hover:bg-accent hover:text-foreground cursor-pointer transition-colors"
                      >
                        <Edit2 className="h-3.5 w-3.5" />
                      </button>
                      <button
                        onClick={() => setDeleteTarget(segment)}
                        className="rounded p-1.5 text-muted-foreground/40 hover:bg-destructive/10 hover:text-destructive cursor-pointer transition-colors"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
          </tbody>
        </table>

        {/* Empty states */}
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
              <Plus className="h-3.5 w-3.5" />
              New Segment
            </Button>
          </div>
        )}

        {!isLoading && segments.length > 0 && filteredSegments.length === 0 && (
          <div className="flex flex-col items-center justify-center py-12 text-center">
            <p className="text-[13px] font-medium">No segments match "{searchQuery}"</p>
            <p className="mt-1 text-[12px] text-muted-foreground">Try a different search term</p>
          </div>
        )}
      </div>

      {/* Detail dialog */}
      {detailSegment && activeWorkspaceId && (
        <SegmentDetailDialog
          segment={detailSegment}
          workspaceId={activeWorkspaceId}
          onClose={() => setDetailSegment(null)}
          onEdit={(seg) => {
            setDetailSegment(null);
            openEdit(seg);
          }}
          onDelete={handleDeleteRequest}
        />
      )}

      {/* Create / Edit dialog */}
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
          <form onSubmit={handleCreateSubmit} className="space-y-4">
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
                        setConditions((cs) => cs.map((c) => (c.id === cond.id ? updated : c)))
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
              <Button type="submit" disabled={createMutation.isPending || !name.trim()}>
                {createMutation.isPending
                  ? editTarget ? "Saving…" : "Creating…"
                  : editTarget ? "Save Segment" : "Create Segment"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Delete confirmation */}
      <AlertDialog open={!!deleteTarget} onOpenChange={(o: boolean) => !o && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete segment?</AlertDialogTitle>
            <AlertDialogDescription>
              <strong className="text-foreground font-medium">{deleteTarget?.name}</strong>{" "}
              will be permanently deleted. Broadcasts that used this segment will not be affected.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={deleteMutation.isPending}
              onClick={() => deleteTarget && deleteMutation.mutate(deleteTarget.id)}
            >
              {deleteMutation.isPending ? "Deleting…" : "Delete"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
