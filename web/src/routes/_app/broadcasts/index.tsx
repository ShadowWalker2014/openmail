import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { sessionFetch } from "@/lib/api";
import { useWorkspaceStore } from "@/store/workspace";
import { useState, useRef, useMemo, useEffect, useCallback } from "react";

// ── Email template helpers ────────────────────────────────────────────────────

/** Extract the inner HTML of <body> from a full HTML document. */
function extractBodyContent(html: string): string {
  const match = html.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
  return match ? match[1].trim() : html;
}

/** Replace the <body> content of a template frame with edited body HTML. */
function injectIntoFrame(frameHtml: string, bodyContent: string): string {
  return frameHtml.replace(
    /(<body[^>]*>)([\s\S]*?)(<\/body>)/i,
    `$1\n${bodyContent}\n$3`,
  );
}

/** Detect if a string is a full HTML document. */
function isFullHtmlDoc(html: string): boolean {
  const t = html.trimStart();
  return t.startsWith("<!") || /^<html/i.test(t);
}

/** Substitute {{variable}} placeholders with real contact data for preview. */
function substituteVars(
  html: string,
  contact: { email: string; firstName?: string | null; lastName?: string | null; attributes?: Record<string, unknown> | null },
): string {
  const attrs = (contact.attributes ?? {}) as Record<string, string>;
  const fullName = [contact.firstName, contact.lastName].filter(Boolean).join(" ");
  return html
    .replace(/\{\{firstName\}\}/gi, contact.firstName ?? "")
    .replace(/\{\{lastName\}\}/gi, contact.lastName ?? "")
    .replace(/\{\{fullName\}\}/gi, fullName)
    .replace(/\{\{name\}\}/gi, fullName)
    .replace(/\{\{email\}\}/gi, contact.email)
    .replace(/\{\{(\w+)\}\}/gi, (_match, key: string) => {
      const v = attrs[key] ?? attrs[key.charAt(0).toLowerCase() + key.slice(1)];
      return v !== undefined ? String(v) : `{{${key}}}`;
    });
}
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
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
  Plus, Send, Mail, Zap, Trash2, Monitor, Smartphone,
  BarChart2, CheckCircle2, Search, AlertCircle, Copy, ChevronsUpDown, Check,
} from "lucide-react";
import { EmailEditor } from "@/components/ui/email-editor";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList,
} from "@/components/ui/command";
import { toast } from "sonner";
import { useWorkspaceShape } from "@/hooks/use-workspace-shape";
import { cn } from "@/lib/utils";
import { format } from "date-fns";

export const Route = createFileRoute("/_app/broadcasts/")({
  component: BroadcastsPage,
});

interface Broadcast extends Record<string, unknown> {
  id: string;
  name: string;
  subject: string;
  status: string;
  fromEmail: string | null;
  fromName: string | null;
  htmlContent: string | null;
  templateId: string | null;
  segmentIds: string[];
  scheduledAt: string | null;
  sentAt: string | null;
  recipientCount: number;
  sentCount: number;
  openCount: number;
  clickCount: number;
  createdAt: string;
  updatedAt: string;
  // snake_case aliases for Electric shape
  recipient_count?: number;
  sent_count?: number;
  open_count?: number;
  click_count?: number;
  sent_at?: string | null;
  created_at?: string;
}

function normalizeBroadcast(b: Record<string, unknown>): Broadcast {
  return {
    ...b,
    id: b.id as string,
    name: b.name as string,
    subject: b.subject as string,
    status: b.status as string,
    fromEmail: (b.fromEmail ?? b.from_email ?? null) as string | null,
    fromName: (b.fromName ?? b.from_name ?? null) as string | null,
    htmlContent: (b.htmlContent ?? b.html_content ?? null) as string | null,
    templateId: (b.templateId ?? b.template_id ?? null) as string | null,
    segmentIds: (b.segmentIds ?? b.segment_ids ?? []) as string[],
    scheduledAt: (b.scheduledAt ?? b.scheduled_at ?? null) as string | null,
    sentAt: (b.sentAt ?? b.sent_at ?? null) as string | null,
    recipientCount: ((b.recipientCount ?? b.recipient_count ?? 0) as number),
    sentCount: ((b.sentCount ?? b.sent_count ?? 0) as number),
    openCount: ((b.openCount ?? b.open_count ?? 0) as number),
    clickCount: ((b.clickCount ?? b.click_count ?? 0) as number),
    createdAt: ((b.createdAt ?? b.created_at ?? "1970-01-01T00:00:00Z") as string),
    updatedAt: ((b.updatedAt ?? b.updated_at ?? "") as string),
  };
}

const STATUS_BADGE: Record<
  string,
  "default" | "success" | "warning" | "destructive" | "secondary" | "outline"
> = {
  draft: "secondary",
  sending: "warning",
  sent: "success",
  failed: "destructive",
  scheduled: "outline",
};

const SEND_STATUS_BADGE: Record<string, "success" | "warning" | "destructive" | "secondary"> = {
  sent: "success",
  delivered: "success",
  bounced: "warning",
  failed: "destructive",
  queued: "secondary",
};

function SendProgress({
  sentCount,
  recipientCount,
}: {
  sentCount: number;
  recipientCount: number;
}) {
  if (!recipientCount) return null;
  const pct = Math.round((sentCount / recipientCount) * 100);
  return (
    <div className="mt-3">
      <div className="mb-1.5 flex justify-between text-xs text-muted-foreground">
        <span className="flex items-center gap-1">
          <Zap className="h-3 w-3 animate-pulse text-muted-foreground" />
          Sending live…
        </span>
        <span className="tabular-nums">
          {sentCount.toLocaleString()} / {recipientCount.toLocaleString()} ({pct}%)
        </span>
      </div>
      <div className="h-1 w-full overflow-hidden rounded-full bg-muted">
        <div
          className="h-full rounded-full bg-foreground transition-all duration-500"
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}

// ── Template Picker — Combobox using Popover + Command ───────────────────────

interface TemplatePickerProps {
  templates: { id: string; name: string; htmlContent: string }[];
  onSelect: (tpl: { id: string; name: string; htmlContent: string }) => void;
  /** Name of the currently loaded template — shown in the trigger button */
  loadedName?: string | null;
}

function TemplatePicker({ templates, onSelect, loadedName }: TemplatePickerProps) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");

  const filtered = templates.filter((t) =>
    t.name.toLowerCase().includes(search.toLowerCase()),
  );

  return (
    <Popover open={open} onOpenChange={(v) => { setOpen(v); if (!v) setSearch(""); }}>
      <PopoverTrigger asChild>
        <button
          type="button"
          role="combobox"
          aria-expanded={open}
          className={cn(
            "flex items-center justify-between w-full h-8 rounded-md border border-input bg-input px-3",
            "text-[13px] cursor-pointer hover:bg-accent transition-colors",
            loadedName ? "text-foreground" : "text-muted-foreground",
          )}
        >
          <span className="truncate">{loadedName ?? "Pick a template to load…"}</span>
          <ChevronsUpDown className="h-3.5 w-3.5 shrink-0 opacity-50 ml-2" />
        </button>
      </PopoverTrigger>
      <PopoverContent className="p-0 w-[var(--radix-popover-trigger-width)]" align="start">
        <Command>
          <CommandInput
            placeholder="Search templates…"
            value={search}
            onValueChange={setSearch}
            className="h-8 text-[13px]"
          />
          <CommandList className="max-h-48">
            <CommandEmpty className="py-4 text-center text-[12px] text-muted-foreground">
              No templates found.
            </CommandEmpty>
            <CommandGroup>
              {filtered.map((t) => (
                <CommandItem
                  key={t.id}
                  value={t.name}
                  onSelect={() => {
                    onSelect(t);
                    setOpen(false);
                    setSearch("");
                  }}
                  className="text-[13px] cursor-pointer"
                >
                  <Check
                    className={cn(
                      "h-3.5 w-3.5 mr-2 shrink-0",
                      loadedName === t.name ? "opacity-100" : "opacity-0",
                    )}
                  />
                  {t.name}
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

function BroadcastCardSkeleton() {
  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <div className="flex items-start justify-between gap-4">
        <div className="flex-1 space-y-2">
          <div className="flex items-center gap-2">
            <div className="h-4 w-32 rounded shimmer" />
            <div className="h-5 w-14 rounded-full shimmer" />
          </div>
          <div className="h-3.5 w-48 rounded shimmer" />
        </div>
        <div className="h-3.5 w-10 rounded shimmer" />
      </div>
    </div>
  );
}

// ─── Detail / Edit Dialog ────────────────────────────────────────────────────

function PreviewToggle({
  previewMobile,
  setPreviewMobile,
}: {
  previewMobile: boolean;
  setPreviewMobile: (v: boolean) => void;
}) {
  return (
    <div className="flex items-center rounded-md border border-border p-0.5 gap-0.5">
      <button
        type="button"
        onClick={() => setPreviewMobile(false)}
        className={cn(
          "rounded px-2 py-1 transition-colors cursor-pointer",
          !previewMobile ? "bg-foreground text-background" : "text-muted-foreground hover:text-foreground"
        )}
      >
        <Monitor className="h-3.5 w-3.5" />
      </button>
      <button
        type="button"
        onClick={() => setPreviewMobile(true)}
        className={cn(
          "rounded px-2 py-1 transition-colors cursor-pointer",
          previewMobile ? "bg-foreground text-background" : "text-muted-foreground hover:text-foreground"
        )}
      >
        <Smartphone className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}

function MetricCard({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-lg border border-border bg-card px-4 py-3">
      <p className="text-[10px] uppercase tracking-wide text-muted-foreground/60 mb-1">{label}</p>
      <p className="text-[22px] font-semibold tabular-nums">{value}</p>
      {sub && <p className="text-[11px] text-muted-foreground">{sub}</p>}
    </div>
  );
}

type Tab = "overview" | "content" | "sent" | "recipients";

function BroadcastDetailDialog({
  broadcast,
  onClose,
  segments,
  templates,
  onSendSuccess,
  onDeleteSuccess,
  workspaceId,
}: {
  broadcast: Broadcast;
  onClose: () => void;
  segments: { id: string; name: string }[];
  templates: { id: string; name: string; subject: string; htmlContent: string }[];
  onSendSuccess: () => void;
  onDeleteSuccess: () => void;
  workspaceId: string;
}) {
  const qc = useQueryClient();
  const isDraft = broadcast.status === "draft";

  const visibleTabs: Tab[] = isDraft
    ? ["overview", "content"]
    : ["overview", "content", "sent", "recipients"];

  const TAB_LABELS: Record<Tab, string> = {
    overview: "Overview",
    content: "Content",
    sent: "Sent",
    recipients: "Recipients",
  };

  // Tab state
  const [activeTab, setActiveTab] = useState<Tab>("overview");

  // Editable state (only meaningful for draft)
  const [name, setName] = useState(broadcast.name);
  const [subject, setSubject] = useState(broadcast.subject);
  const [fromName, setFromName] = useState(broadcast.fromName ?? "");
  const [fromEmail, setFromEmail] = useState(broadcast.fromEmail ?? "");
  // templateFrame = full HTML document (with <head>/<style>) of the loaded template.
  // htmlContent = body content only — what Tiptap and the textarea actually edit.
  // Keeping them separate prevents Tiptap from stripping the template CSS on onChange.
  const [templateFrame, setTemplateFrame] = useState<string | null>(() => {
    const raw = broadcast.htmlContent ?? "";
    return isFullHtmlDoc(raw) ? raw : null;
  });
  const [htmlContent, setHtmlContent] = useState<string>(() => {
    const raw = broadcast.htmlContent ?? "";
    return isFullHtmlDoc(raw) ? extractBodyContent(raw) : raw;
  });
  const [selectedSegmentIds, setSelectedSegmentIds] = useState<string[]>(broadcast.segmentIds ?? []);
  const [contentMode, setContentMode] = useState<"visual" | "html">("visual");

  // Contact to use for variable substitution in the preview
  const [previewContactId, setPreviewContactId] = useState<string | null>(null);

  // Track which template name is currently loaded (for the picker button label)
  const [loadedTemplateName, setLoadedTemplateName] = useState<string | null>(() => {
    if (broadcast.templateId) {
      return templates.find((t) => t.id === broadcast.templateId)?.name ?? null;
    }
    return null;
  });

  // Load template into frame + body content
  const loadTemplate = useCallback((tpl: { id: string; name: string; htmlContent: string }) => {
    if (isFullHtmlDoc(tpl.htmlContent)) {
      setTemplateFrame(tpl.htmlContent);
      setHtmlContent(extractBodyContent(tpl.htmlContent));
    } else {
      setTemplateFrame(null);
      setHtmlContent(tpl.htmlContent);
    }
    setLoadedTemplateName(tpl.name);
    setContentMode("visual");
  }, []);

  // Sync loadedTemplateName once templates list loads (the initial useState ran before templates)
  useEffect(() => {
    if (broadcast.templateId && templates.length > 0 && !loadedTemplateName) {
      const tpl = templates.find((t) => t.id === broadcast.templateId);
      if (tpl) setLoadedTemplateName(tpl.name);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [templates]);

  // If the broadcast was saved with only templateId (no htmlContent), load the template frame
  // once the templates list has arrived.
  useEffect(() => {
    if (!broadcast.htmlContent && broadcast.templateId && templates.length > 0 && !htmlContent) {
      const tpl = templates.find((t) => t.id === broadcast.templateId);
      if (tpl) loadTemplate(tpl);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [templates]);
  const [previewMobile, setPreviewMobile] = useState(false);

  // Confirmation dialogs
  const [sendConfirm, setSendConfirm] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState(false);

  // Sent tab state
  const [statusFilter, setStatusFilter] = useState("");
  const [sendsPage, setSendsPage] = useState(1);

  // Content tab test send state
  const [testSendEmail, setTestSendEmail] = useState("");

  // ── Mutations ───────────────────────────────────────────────────────────────

  const saveMutation = useMutation({
    mutationFn: () => {
      // Save the full HTML (template frame + edited body) so CSS is preserved on send
      const htmlToSave = templateFrame
        ? injectIntoFrame(templateFrame, htmlContent)
        : htmlContent;
      return sessionFetch(workspaceId, `/broadcasts/${broadcast.id}`, {
        method: "PATCH",
        body: JSON.stringify({
          name,
          subject,
          fromName: fromName || undefined,
          fromEmail: fromEmail || undefined,
          htmlContent: htmlToSave,
          segmentIds: selectedSegmentIds,
        }),
      });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["broadcasts", workspaceId] });
      toast.success("Saved");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const sendMutation = useMutation({
    mutationFn: () =>
      sessionFetch(workspaceId, `/broadcasts/${broadcast.id}/send`, { method: "POST" }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["broadcasts", workspaceId] });
      toast.success("Sending — watch the progress bar update live");
      onSendSuccess();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const deleteMutation = useMutation({
    mutationFn: () =>
      sessionFetch(workspaceId, `/broadcasts/${broadcast.id}`, { method: "DELETE" }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["broadcasts", workspaceId] });
      toast.success("Broadcast deleted");
      onDeleteSuccess();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const testSendMutation = useMutation({
    mutationFn: (email: string) =>
      sessionFetch(workspaceId, `/broadcasts/${broadcast.id}/test-send`, {
        method: "POST",
        body: JSON.stringify({ email }),
      }),
    onSuccess: () => toast.success("Test email sent"),
    onError: (e: Error) => toast.error(e.message),
  });

  const duplicateMutation = useMutation({
    mutationFn: () =>
      sessionFetch(workspaceId, "/broadcasts", {
        method: "POST",
        body: JSON.stringify({
          name: `${broadcast.name} (copy)`,
          subject: broadcast.subject,
          fromName: broadcast.fromName || undefined,
          fromEmail: broadcast.fromEmail || undefined,
          ...(broadcast.templateId
            ? { templateId: broadcast.templateId }
            : { htmlContent: broadcast.htmlContent ?? "" }),
          segmentIds: broadcast.segmentIds ?? [],
        }),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["broadcasts", workspaceId] });
      toast.success("Broadcast duplicated");
      onClose();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  // ── Queries ─────────────────────────────────────────────────────────────────

  const { data: topLinks = [], isLoading: topLinksLoading } = useQuery<{ url: string; clicks: number }[]>({
    queryKey: ["broadcast-top-links", broadcast.id],
    queryFn: () => sessionFetch(workspaceId, `/broadcasts/${broadcast.id}/top-links`),
    enabled: broadcast.status === "sent",
  });

  const { data: sendsData, isLoading: sendsLoading } = useQuery<{
    data: Array<{
      id: string;
      contactEmail: string;
      subject: string;
      status: string;
      sentAt: string | null;
      createdAt: string;
    }>;
    total: number;
    page: number;
    pageSize: number;
  }>({
    queryKey: ["broadcast-sends", broadcast.id, sendsPage, statusFilter],
    queryFn: () => {
      const params = new URLSearchParams({ page: String(sendsPage), pageSize: "50" });
      if (statusFilter) params.set("status", statusFilter);
      return sessionFetch(workspaceId, `/broadcasts/${broadcast.id}/sends?${params}`);
    },
    enabled: broadcast.status !== "draft",
  });

  // ── Computed metrics ────────────────────────────────────────────────────────

  const sentCount = broadcast.sentCount ?? 0;
  const openCount = broadcast.openCount ?? 0;
  const clickCount = broadcast.clickCount ?? 0;
  const openRate = sentCount > 0 ? ((openCount / sentCount) * 100).toFixed(1) : "0.0";
  const clickRate = sentCount > 0 ? ((clickCount / sentCount) * 100).toFixed(1) : "0.0";
  const ctoRate = openCount > 0 ? ((clickCount / openCount) * 100).toFixed(1) : "0.0";

  // Contacts for "Preview as" substitution
  const { data: previewContacts = [] } = useQuery<{ id: string; email: string; firstName: string | null; lastName: string | null; attributes: Record<string, unknown> | null }[]>({
    queryKey: ["contacts-preview", workspaceId],
    queryFn: async () => {
      const res = await sessionFetch<{ data: { id: string; email: string; firstName: string | null; lastName: string | null; attributes: Record<string, unknown> | null }[] }>(
        workspaceId, "/contacts?pageSize=30",
      );
      return res.data;
    },
    enabled: !!workspaceId,
    staleTime: 60_000,
  });
  const previewContact = previewContacts.find((c) => c.id === previewContactId) ?? null;

  // Preview HTML: reconstruct full document if a template frame is loaded, then substitute vars
  const previewHtml = useMemo(() => {
    const full = templateFrame ? injectIntoFrame(templateFrame, htmlContent) : htmlContent;
    return previewContact ? substituteVars(full, previewContact) : full;
  }, [templateFrame, htmlContent, previewContact]);

  // ── Tab content renderers ────────────────────────────────────────────────────

  const renderOverviewTab = () => {
    if (isDraft) {
      return (
        <div className="flex flex-1 min-h-0">
          {/* Left — edit form */}
          <div className="flex flex-col w-[400px] shrink-0 border-r border-border overflow-y-auto">
            <div className="flex-1 space-y-4 p-5">
              <div className="space-y-1.5">
                <Label>Name</Label>
                <Input value={name} onChange={(e) => setName(e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label>Subject</Label>
                <Input value={subject} onChange={(e) => setSubject(e.target.value)} />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label>From Name</Label>
                  <Input
                    value={fromName}
                    onChange={(e) => setFromName(e.target.value)}
                    placeholder="Team Name"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>From Email</Label>
                  <Input
                    value={fromEmail}
                    onChange={(e) => setFromEmail(e.target.value)}
                    placeholder="hello@you.com"
                  />
                </div>
              </div>
              <div className="space-y-1.5">
                <Label>Segments</Label>
                {segments.length === 0 ? (
                  <p className="text-[12px] text-muted-foreground">No segments yet.</p>
                ) : (
                  <div className="flex flex-wrap gap-1.5">
                    {segments.map((seg) => (
                      <button
                        key={seg.id}
                        type="button"
                        onClick={() =>
                          setSelectedSegmentIds((ids) =>
                            ids.includes(seg.id)
                              ? ids.filter((id) => id !== seg.id)
                              : [...ids, seg.id]
                          )
                        }
                        className={cn(
                          "rounded-full border px-3 py-1 text-xs font-medium transition-colors duration-150 cursor-pointer",
                          selectedSegmentIds.includes(seg.id)
                            ? "border-foreground bg-foreground text-background"
                            : "border-border hover:bg-accent"
                        )}
                      >
                        {seg.name}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Right — preview */}
          <div className="flex-1 flex flex-col min-w-0 bg-muted/30">
            <div className="shrink-0 flex items-center gap-2 px-4 py-2 border-b border-border">
              <span className="text-[11px] font-medium text-muted-foreground uppercase tracking-wide shrink-0">
                Preview
              </span>
              {previewContacts.length > 0 && (
                <select
                  value={previewContactId ?? ""}
                  onChange={(e) => setPreviewContactId(e.target.value || null)}
                  className="flex-1 h-6 rounded border border-input bg-transparent px-1.5 text-[11px] text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring cursor-pointer min-w-0"
                >
                  <option value="">Preview with placeholder values</option>
                  {previewContacts.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.firstName ? `${c.firstName} — ` : ""}{c.email}
                    </option>
                  ))}
                </select>
              )}
              <PreviewToggle previewMobile={previewMobile} setPreviewMobile={setPreviewMobile} />
            </div>
            <div className="flex-1 flex items-start justify-center overflow-auto p-6">
              {previewHtml ? (
                <div
                  className={cn(
                    "h-full transition-all duration-200",
                    previewMobile ? "w-[375px]" : "w-full max-w-[680px]"
                  )}
                >
                  <iframe
                    srcDoc={previewHtml}
                    sandbox="allow-same-origin"
                    className="w-full h-full min-h-[600px] rounded-lg border border-border bg-white shadow-sm"
                    title="Email preview"
                  />
                </div>
              ) : (
                <div className="flex flex-col items-center justify-center h-full text-center gap-2 opacity-40">
                  <BarChart2 className="h-8 w-8 text-muted-foreground" />
                  <p className="text-[12px] text-muted-foreground">
                    Add content in the Content tab to see a preview
                  </p>
                </div>
              )}
            </div>
          </div>
        </div>
      );
    }

    // Sent/Sending/Failed overview
    return (
      <div className="flex-1 overflow-y-auto">
        <div className="max-w-3xl mx-auto px-6 py-6">
          {/* Sending progress bar */}
          {broadcast.status === "sending" && (
            <div className="mb-6">
              <SendProgress sentCount={sentCount} recipientCount={broadcast.recipientCount} />
            </div>
          )}

          {/* Metrics cards */}
          <div className="grid grid-cols-4 gap-3 mb-6">
            <MetricCard label="Emails Sent" value={sentCount.toLocaleString()} />
            <MetricCard label="Delivered" value={sentCount.toLocaleString()} sub="approx" />
            <MetricCard
              label="Open Rate"
              value={`${openRate}%`}
              sub={`${openCount.toLocaleString()} opens`}
            />
            <MetricCard
              label="Click Rate"
              value={`${clickRate}%`}
              sub={`${clickCount.toLocaleString()} clicks`}
            />
          </div>

          {/* Engagement bar charts */}
          <div className="mb-6">
            <p className="text-[13px] font-semibold mb-3">Engagement</p>
            {[
              { label: "Opened", pct: Number(openRate), count: openCount },
              { label: "Clicked", pct: Number(clickRate), count: clickCount },
              { label: "Click-to-Open", pct: Number(ctoRate), count: clickCount },
            ].map(({ label, pct, count }) => (
              <div key={label} className="flex items-center gap-3 mb-3">
                <span className="w-28 text-[12px] text-muted-foreground shrink-0">{label}</span>
                <span className="w-12 text-[13px] font-semibold tabular-nums shrink-0">{pct}%</span>
                <div className="flex-1 h-3 bg-muted/50 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-emerald-500/70 rounded-full transition-all"
                    style={{ width: `${Math.min(pct, 100)}%` }}
                  />
                </div>
                <span className="w-16 text-[11px] text-muted-foreground text-right tabular-nums">
                  {count.toLocaleString()}
                </span>
              </div>
            ))}
          </div>

          {/* Top Clicked Links */}
          <div>
            <div className="flex items-center justify-between mb-3">
              <p className="text-[13px] font-semibold">Top Clicked Links</p>
              <span className="text-[11px] uppercase tracking-wide text-muted-foreground">
                Total Clicks
              </span>
            </div>
            {topLinksLoading ? (
              <div className="space-y-1">
                {Array.from({ length: 3 }).map((_, i) => (
                  <div key={i} className="flex items-center gap-3 py-2 border-b border-border/50">
                    <div className="h-3 flex-1 rounded shimmer" />
                    <div className="h-3 w-8 rounded shimmer shrink-0" />
                  </div>
                ))}
              </div>
            ) : topLinks.length === 0 ? (
              <p className="text-[12px] text-muted-foreground py-4 text-center">
                No link clicks yet
              </p>
            ) : (
              <div className="space-y-1">
                {topLinks.map((link, i) => (
                  <div
                    key={i}
                    className="flex items-center gap-3 py-2 border-b border-border/50 last:border-0"
                  >
                    <span className="text-[12px] flex-1 truncate text-muted-foreground">
                      {link.url}
                    </span>
                    <span className="text-[12px] tabular-nums font-medium shrink-0">
                      {link.clicks.toLocaleString()}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    );
  };

  const renderContentTab = () => {
    if (isDraft) {
      return (
        <div className="flex flex-1 min-h-0">
          {/* Left — editor */}
          <div className="flex flex-col w-[380px] shrink-0 border-r border-border overflow-y-auto">
            <div className="flex-1 space-y-4 p-5">
              <div className="flex items-center justify-between">
                <Label>Content</Label>
                <div className="flex items-center rounded-md border border-border p-0.5 gap-0.5">
                  {(["visual", "html"] as const).map((m) => (
                    <button
                      key={m}
                      type="button"
                      onClick={() => setContentMode(m)}
                      className={cn(
                        "rounded px-2.5 py-0.5 text-xs font-medium transition-colors cursor-pointer",
                        contentMode === m
                          ? "bg-foreground text-background"
                          : "text-muted-foreground hover:text-foreground"
                      )}
                    >
                      {m === "visual" ? "Visual" : "HTML"}
                    </button>
                  ))}
                </div>
              </div>

              {/* Template loader */}
              {templates.length > 0 && (
                <div className="space-y-1">
                  <Label className="text-[11px] text-muted-foreground">Start from template</Label>
                  <TemplatePicker
                    templates={templates}
                    onSelect={loadTemplate}
                    loadedName={loadedTemplateName}
                  />
                  {templateFrame && (
                    <p className="text-[10px] text-muted-foreground">
                      Frame loaded.{" "}
                      <button
                        type="button"
                        onClick={() => { setTemplateFrame(null); setLoadedTemplateName(null); }}
                        className="underline hover:text-foreground cursor-pointer"
                      >
                        Remove
                      </button>
                    </p>
                  )}
                </div>
              )}

              {contentMode === "visual" ? (
                <EmailEditor
                  value={htmlContent}
                  onChange={setHtmlContent}
                  placeholder="Start writing your broadcast…"
                  workspaceId={workspaceId}
                  minHeight="320px"
                />
              ) : (
                <textarea
                  value={htmlContent}
                  onChange={(e) => setHtmlContent(e.target.value)}
                  placeholder="<h1>Hello {{firstName}}!</h1>"
                  className="w-full min-h-[400px] resize-none rounded-md border border-input bg-input px-3 py-2 font-mono text-xs focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                />
              )}
            </div>
          </div>

          {/* Right — preview */}
          <div className="flex-1 flex flex-col min-w-0 bg-muted/30">
            <div className="shrink-0 flex items-center gap-2 px-4 py-2 border-b border-border">
              <span className="text-[11px] font-medium text-muted-foreground uppercase tracking-wide shrink-0">
                Preview
              </span>
              {previewContacts.length > 0 && (
                <select
                  value={previewContactId ?? ""}
                  onChange={(e) => setPreviewContactId(e.target.value || null)}
                  className="flex-1 h-6 rounded border border-input bg-transparent px-1.5 text-[11px] text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring cursor-pointer min-w-0"
                >
                  <option value="">Preview with placeholder values</option>
                  {previewContacts.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.firstName ? `${c.firstName} — ` : ""}{c.email}
                    </option>
                  ))}
                </select>
              )}
              <PreviewToggle previewMobile={previewMobile} setPreviewMobile={setPreviewMobile} />
            </div>
            <div className="flex-1 flex items-start justify-center overflow-auto p-6">
              {previewHtml ? (
                <div
                  className={cn(
                    "h-full transition-all duration-200",
                    previewMobile ? "w-[375px]" : "w-full max-w-[680px]"
                  )}
                >
                  <iframe
                    srcDoc={previewHtml}
                    sandbox="allow-same-origin"
                    className="w-full h-full min-h-[600px] rounded-lg border border-border bg-white shadow-sm"
                    title="Email preview"
                  />
                </div>
              ) : (
                <div className="flex flex-col items-center justify-center h-full text-center gap-2 opacity-40">
                  <Monitor className="h-8 w-8 text-muted-foreground" />
                  <p className="text-[12px] text-muted-foreground">
                    {contentMode === "visual" ? "Start writing to see a live preview" : "Start typing HTML to see a live preview"}
                  </p>
                </div>
              )}
            </div>
          </div>
        </div>
      );
    }

    // Sent/Sending content view
    return (
      <div className="flex-1 overflow-y-auto">
        <div className="max-w-2xl mx-auto px-6 py-6">
          {/* Metadata */}
          <div className="space-y-2 mb-6 rounded-lg border border-border bg-card px-4 py-3">
            <div className="flex gap-3">
              <span className="w-16 text-[11px] font-medium text-muted-foreground uppercase tracking-wide pt-0.5">
                From
              </span>
              <span className="text-[13px]">
                {broadcast.fromName || "Default"}{" "}
                {broadcast.fromEmail ? `<${broadcast.fromEmail}>` : ""}
              </span>
            </div>
            <div className="flex gap-3">
              <span className="w-16 text-[11px] font-medium text-muted-foreground uppercase tracking-wide pt-0.5">
                Subject
              </span>
              <span className="text-[13px] font-medium">{broadcast.subject}</span>
            </div>
          </div>

          {/* Test send */}
          <div className="flex items-center gap-2 mb-6">
            <span className="text-[11px] font-medium text-muted-foreground uppercase tracking-wide w-16 shrink-0">
              To
            </span>
            <Input
              value={testSendEmail}
              onChange={(e) => setTestSendEmail(e.target.value)}
              placeholder="test@example.com"
              className="max-w-xs h-8"
              type="email"
            />
            <Button
              size="sm"
              variant="outline"
              disabled={!testSendEmail || testSendMutation.isPending}
              onClick={() => testSendMutation.mutate(testSendEmail)}
            >
              {testSendMutation.isPending ? "Sending…" : "Send test email"}
            </Button>
          </div>

          {/* Iframe preview */}
          {broadcast.htmlContent ? (
            <div className="flex justify-center">
              <iframe
                srcDoc={broadcast.htmlContent}
                sandbox="allow-same-origin"
                className="w-full max-w-[680px] min-h-[600px] rounded-lg border border-border bg-white shadow-sm"
                title="Email content"
              />
            </div>
          ) : broadcast.templateId ? (
            <div className="flex justify-center">
              <iframe
                srcDoc={templates.find(t => t.id === broadcast.templateId)?.htmlContent ?? "<p style='font-family:sans-serif;color:#888;padding:40px;text-align:center'>Template preview not available</p>"}
                sandbox="allow-same-origin"
                className="w-full max-w-[680px] min-h-[600px] rounded-lg border border-border bg-white shadow-sm"
                title="Email content"
              />
            </div>
          ) : null}
        </div>
      </div>
    );
  };

  const renderSentTab = () => (
    <div className="flex flex-col flex-1 overflow-hidden">
      {/* Filter bar */}
      <div className="flex items-center gap-2 px-5 py-3 border-b border-border shrink-0">
        <select
          value={statusFilter}
          onChange={(e) => {
            setStatusFilter(e.target.value);
            setSendsPage(1);
          }}
          className="h-8 rounded-md border border-input bg-input px-2 text-[12px]"
        >
          <option value="">All statuses</option>
          <option value="sent">Sent</option>
          <option value="bounced">Bounced</option>
          <option value="failed">Failed</option>
          <option value="queued">Queued</option>
        </select>
        <Button
          variant="outline"
          size="sm"
          onClick={() => qc.invalidateQueries({ queryKey: ["broadcast-sends", broadcast.id] })}
        >
          Refresh
        </Button>
      </div>

      {/* Table */}
      <div className="flex-1 overflow-y-auto">
        {sendsLoading ? (
          <div className="flex items-center justify-center py-12 text-[12px] text-muted-foreground">
            Loading…
          </div>
        ) : (
          <table className="w-full">
            <thead>
              <tr className="border-b border-border">
                <th className="px-5 py-2.5 text-left text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                  Date Sent
                </th>
                <th className="px-5 py-2.5 text-left text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                  Recipient
                </th>
                <th className="px-5 py-2.5 text-left text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                  Status
                </th>
              </tr>
            </thead>
            <tbody>
              {(sendsData?.data ?? []).map((row) => (
                <tr key={row.id} className="border-b border-border/50 hover:bg-accent/30 transition-colors">
                  <td className="px-5 py-2.5 text-[12px] text-muted-foreground tabular-nums">
                    {format(new Date(row.sentAt ?? row.createdAt), "MMM d, h:mm a")}
                  </td>
                  <td className="px-5 py-2.5 font-mono text-[12px]">{row.contactEmail}</td>
                  <td className="px-5 py-2.5">
                    <Badge variant={SEND_STATUS_BADGE[row.status] ?? "secondary"}>
                      {row.status}
                    </Badge>
                  </td>
                </tr>
              ))}
              {(sendsData?.data ?? []).length === 0 && (
                <tr>
                  <td colSpan={3} className="px-5 py-12 text-center text-[12px] text-muted-foreground">
                    No sends yet
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        )}
      </div>

      {/* Pagination */}
      {sendsData && sendsData.total > 0 && (
        <div className="flex items-center justify-between border-t border-border px-4 py-2.5 text-[12px] text-muted-foreground shrink-0">
          <span>
            {Math.min((sendsPage - 1) * 50 + 1, sendsData.total)}–
            {Math.min(sendsPage * 50, sendsData.total)} of {sendsData.total}
          </span>
          <div className="flex gap-1">
            <Button
              variant="ghost"
              size="sm"
              disabled={sendsPage <= 1}
              onClick={() => setSendsPage((p) => p - 1)}
            >
              ←
            </Button>
            <Button
              variant="ghost"
              size="sm"
              disabled={sendsPage * 50 >= sendsData.total}
              onClick={() => setSendsPage((p) => p + 1)}
            >
              →
            </Button>
          </div>
        </div>
      )}
    </div>
  );

  const renderRecipientsTab = () => (
    <div className="flex-1 overflow-y-auto">
      <div className="max-w-2xl mx-auto px-6 py-6 space-y-6">
        {/* Recipients */}
        <div>
          <h3 className="text-[13px] font-semibold mb-3">Recipients</h3>
          <p className="text-[12px] text-muted-foreground mb-2">
            Your broadcast was sent to contacts in:
          </p>
          <div className="flex flex-wrap gap-2">
            {(broadcast.segmentIds ?? []).map((segId) => {
              const seg = segments.find((s) => s.id === segId);
              return (
                <span
                  key={segId}
                  className="rounded-full bg-muted border border-border px-3 py-1 text-[12px] font-medium"
                >
                  {seg?.name ?? segId}
                </span>
              );
            })}
            {(broadcast.segmentIds ?? []).length === 0 && (
              <p className="text-[12px] text-muted-foreground">No segments specified</p>
            )}
          </div>
        </div>

        {/* Tracking */}
        <div>
          <h3 className="text-[13px] font-semibold mb-3">Tracking</h3>
          <div className="space-y-1.5">
            <p className="flex items-center gap-2 text-[12px]">
              <CheckCircle2 className="h-4 w-4 text-emerald-500" />
              Open and click tracking are on
            </p>
          </div>
        </div>

        {/* Send Options */}
        <div>
          <h3 className="text-[13px] font-semibold mb-3">Send Options</h3>
          <div className="space-y-1.5 text-[12px] text-muted-foreground">
            {broadcast.sentAt && (
              <p>
                Sent on{" "}
                {format(new Date(broadcast.sentAt), "MMMM d, yyyy 'at' h:mm a")}
              </p>
            )}
            <p>
              From: {broadcast.fromName || "Default"}{" "}
              {broadcast.fromEmail ? `<${broadcast.fromEmail}>` : ""}
            </p>
            <p>
              Recipients targeted:{" "}
              {(broadcast.recipientCount ?? 0).toLocaleString()} contacts
            </p>
          </div>
        </div>
      </div>
    </div>
  );

  return (
    <>
      <Dialog open onOpenChange={(o) => !o && onClose()}>
        <DialogContent className="max-w-[96vw] w-[96vw] h-[92vh] p-0 gap-0 flex flex-col overflow-hidden">
          {/* Top bar */}
          <DialogHeader className="shrink-0 flex flex-row items-center justify-between px-5 py-3 border-b border-border">
            <div className="flex items-center gap-2.5 min-w-0">
              <DialogTitle className="text-[14px] font-semibold truncate max-w-[300px]">
                {broadcast.name}
              </DialogTitle>
              <Badge variant={STATUS_BADGE[broadcast.status] ?? "secondary"} className="shrink-0">
                {broadcast.status}
              </Badge>
            </div>
            <div className="flex items-center gap-2 mr-8">
              {isDraft && (
                <>
                  <Button
                    size="sm"
                    onClick={() => setSendConfirm(true)}
                  >
                    <Send className="h-3.5 w-3.5" />
                    Send Now
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={saveMutation.isPending}
                    onClick={() => {
                      if (!htmlContent.trim()) {
                        toast.error("Add some content before saving");
                        return;
                      }
                      saveMutation.mutate();
                    }}
                  >
                    {saveMutation.isPending ? "Saving…" : "Save"}
                  </Button>
                </>
              )}
              {/* Duplicate broadcast */}
              <button
                type="button"
                onClick={() => duplicateMutation.mutate()}
                className="rounded-md p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground transition-colors cursor-pointer border border-border"
                title="Duplicate broadcast"
              >
                <Copy className="h-3.5 w-3.5" />
              </button>
              {broadcast.status !== "sent" && broadcast.status !== "sending" && (
                <button
                  type="button"
                  onClick={() => setDeleteConfirm(true)}
                  className="rounded-md p-1.5 text-muted-foreground hover:bg-destructive/10 hover:text-destructive transition-colors cursor-pointer border border-border"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
          </DialogHeader>

          {/* Tab bar */}
          <div className="flex border-b border-border px-5 shrink-0">
            {visibleTabs.map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => setActiveTab(t)}
                className={cn(
                  "px-4 py-2.5 text-[13px] font-medium border-b-2 transition-colors cursor-pointer mr-1",
                  activeTab === t
                    ? "border-foreground text-foreground"
                    : "border-transparent text-muted-foreground hover:text-foreground"
                )}
              >
                {TAB_LABELS[t]}
              </button>
            ))}
          </div>

          {/* Tab content */}
          <div className="flex flex-col flex-1 min-h-0 overflow-hidden">
            {activeTab === "overview" && renderOverviewTab()}
            {activeTab === "content" && renderContentTab()}
            {activeTab === "sent" && !isDraft && renderSentTab()}
            {activeTab === "recipients" && !isDraft && renderRecipientsTab()}
          </div>
        </DialogContent>
      </Dialog>

      {/* Send confirm */}
      <AlertDialog open={sendConfirm} onOpenChange={setSendConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Send broadcast?</AlertDialogTitle>
            <AlertDialogDescription>
              <strong className="text-foreground font-medium">{broadcast.name}</strong>{" "}
              will be sent to all contacts in the selected segments. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={sendMutation.isPending}
              onClick={() => { sendMutation.mutate(); setSendConfirm(false); }}
            >
              Send now
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Delete confirm */}
      <AlertDialog open={deleteConfirm} onOpenChange={setDeleteConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete broadcast?</AlertDialogTitle>
            <AlertDialogDescription>
              <strong className="text-foreground font-medium">{broadcast.name}</strong>{" "}
              will be permanently deleted. This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={deleteMutation.isPending}
              onClick={() => { deleteMutation.mutate(); setDeleteConfirm(false); }}
            >
              {deleteMutation.isPending ? "Deleting…" : "Delete"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

// ─── Page ────────────────────────────────────────────────────────────────────

function BroadcastsPage() {
  const { activeWorkspaceId } = useWorkspaceStore();
  const qc = useQueryClient();

  // Create dialog state
  const [createOpen, setCreateOpen] = useState(false);
  const [selectedSegmentIds, setSelectedSegmentIds] = useState<string[]>([]);
  const [createHtml, setCreateHtml] = useState("");
  const [createTemplateFrame, setCreateTemplateFrame] = useState<string | null>(null);
  const [createLoadedTemplateName, setCreateLoadedTemplateName] = useState<string | null>(null);
  const [createPreviewMobile, setCreatePreviewMobile] = useState(false);
  const [createFromName, setCreateFromName] = useState("");
  const [createFromEmail, setCreateFromEmail] = useState("");
  const [createPreviewText, setCreatePreviewText] = useState("");
  const [createMode, setCreateMode] = useState<"visual" | "html">("visual");
  const [createScheduledAt, setCreateScheduledAt] = useState("");
  const nameRef = useRef<HTMLInputElement>(null);
  const subjectRef = useRef<HTMLInputElement>(null);

  // Detail view state
  const [detailBroadcastId, setDetailBroadcastId] = useState<string | null>(null);

  // Search
  const [searchQuery, setSearchQuery] = useState("");

  // REST source of truth
  const { data: restBroadcasts = [], isLoading, isError } = useQuery<Broadcast[]>({
    queryKey: ["broadcasts", activeWorkspaceId],
    queryFn: () =>
      sessionFetch<{ data: Record<string, unknown>[] }>(activeWorkspaceId!, "/broadcasts?pageSize=100").then(
        (res) => res.data.map(normalizeBroadcast)
      ),
    enabled: !!activeWorkspaceId,
  });

  // Electric live overlay (progress + status)
  const { data: rawElectricBroadcasts } =
    useWorkspaceShape<Record<string, unknown>>("broadcasts");

  const broadcasts = useMemo(() => {
    const electricById = new Map(
      (rawElectricBroadcasts ?? []).map((b) => {
        const n = normalizeBroadcast(b);
        return [n.id, n];
      })
    );
    return restBroadcasts
      .map((b) => {
        const live = electricById.get(b.id);
        return live
          ? { ...b, status: live.status, sentCount: live.sentCount, recipientCount: live.recipientCount, openCount: live.openCount, clickCount: live.clickCount }
          : b;
      })
      .slice()
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  }, [restBroadcasts, rawElectricBroadcasts]);

  const filteredBroadcasts = useMemo(
    () =>
      broadcasts.filter(
        (b) =>
          !searchQuery ||
          b.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
          b.subject.toLowerCase().includes(searchQuery.toLowerCase())
      ),
    [broadcasts, searchQuery]
  );

  const detailBroadcast = detailBroadcastId ? (broadcasts.find(b => b.id === detailBroadcastId) ?? null) : null;

  const { data: segments = [] } = useQuery<{ id: string; name: string }[]>({
    queryKey: ["segments", activeWorkspaceId],
    queryFn: () => sessionFetch<{ data: { id: string; name: string }[] }>(activeWorkspaceId!, "/segments?pageSize=100").then((res) => res.data),
    enabled: !!activeWorkspaceId,
  });

  const { data: templates = [] } = useQuery<{ id: string; name: string; subject: string; htmlContent: string }[]>({
    queryKey: ["templates", activeWorkspaceId],
    queryFn: () => sessionFetch<{ data: { id: string; name: string; subject: string; htmlContent: string }[] }>(activeWorkspaceId!, "/templates?pageSize=100").then((res) => res.data),
    enabled: !!activeWorkspaceId,
  });

  const createMutation = useMutation({
    mutationFn: (body: object) =>
      sessionFetch(activeWorkspaceId!, "/broadcasts", {
        method: "POST",
        body: JSON.stringify(body),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["broadcasts", activeWorkspaceId] });
      setCreateOpen(false);
      setSelectedSegmentIds([]);
      setCreateHtml("");
      setCreateTemplateFrame(null);
      setCreateLoadedTemplateName(null);
      setCreateFromName("");
      setCreateFromEmail("");
      setCreatePreviewText("");
      setCreateMode("visual");
      setCreateScheduledAt("");
      if (nameRef.current) nameRef.current.value = "";
      if (subjectRef.current) subjectRef.current.value = "";
      toast.success("Broadcast created");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div className="px-8 py-7 w-full">
      {/* Header */}
      <div className="mb-5 flex items-center justify-between">
        <div>
          <h1 className="text-[15px] font-semibold tracking-tight">Broadcasts</h1>
          <p className="mt-0.5 text-[12px] text-muted-foreground">
            One-off email campaigns
          </p>
        </div>

        {/* Create Dialog */}
        <Dialog
          open={createOpen}
          onOpenChange={(v) => {
            setCreateOpen(v);
            if (!v) {
              setSelectedSegmentIds([]);
              setCreateHtml("");
              setCreateTemplateFrame(null);
      setCreateLoadedTemplateName(null);
              setCreateFromName("");
              setCreateFromEmail("");
              setCreatePreviewText("");
              setCreateMode("visual");
              setCreateScheduledAt("");
            }
          }}
        >
          <DialogTrigger asChild>
            <Button size="sm">
              <Plus className="h-3.5 w-3.5" />
              New Broadcast
            </Button>
          </DialogTrigger>
          <DialogContent className="max-w-[96vw] w-[96vw] h-[92vh] p-0 gap-0 flex flex-col overflow-hidden">
            <DialogHeader className="shrink-0 flex flex-row items-center justify-between px-5 py-3 border-b border-border">
              <DialogTitle className="text-[14px] font-semibold">New Broadcast</DialogTitle>
              <div className="flex items-center gap-2 mr-8">
                <div className="flex items-center rounded-md border border-border p-0.5 gap-0.5">
                  <button
                    type="button"
                    onClick={() => setCreatePreviewMobile(false)}
                    className={cn(
                      "rounded px-2 py-1 transition-colors cursor-pointer",
                      !createPreviewMobile ? "bg-foreground text-background" : "text-muted-foreground hover:text-foreground"
                    )}
                  >
                    <Monitor className="h-3.5 w-3.5" />
                  </button>
                  <button
                    type="button"
                    onClick={() => setCreatePreviewMobile(true)}
                    className={cn(
                      "rounded px-2 py-1 transition-colors cursor-pointer",
                      createPreviewMobile ? "bg-foreground text-background" : "text-muted-foreground hover:text-foreground"
                    )}
                  >
                    <Smartphone className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>
            </DialogHeader>

            <div className="flex flex-1 min-h-0">
              {/* Left — form */}
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  if (selectedSegmentIds.length === 0) {
                    toast.error("Select at least one segment");
                    return;
                  }
                  if (!createHtml.trim()) {
                    toast.error("Add some content to your broadcast");
                    return;
                  }
                  const createHtmlToSave = createTemplateFrame
                    ? injectIntoFrame(createTemplateFrame, createHtml)
                    : createHtml;
                  createMutation.mutate({
                    name: nameRef.current!.value,
                    subject: subjectRef.current!.value,
                    previewText: createPreviewText || undefined,
                    fromName: createFromName || undefined,
                    fromEmail: createFromEmail || undefined,
                    htmlContent: createHtmlToSave,
                    segmentIds: selectedSegmentIds,
                    scheduledAt: createScheduledAt || undefined,
                  });
                }}
                className="flex flex-col w-[400px] shrink-0 border-r border-border overflow-y-auto"
              >
                <div className="flex-1 space-y-4 p-5">
                  <div className="space-y-1.5">
                    <Label>Name *</Label>
                    <Input ref={nameRef} placeholder="August Newsletter" required />
                  </div>
                  <div className="space-y-1.5">
                    <Label>Subject *</Label>
                    <Input ref={subjectRef} placeholder="Email subject line" required />
                  </div>
                  <div className="space-y-1.5">
                    <Label>Preview Text</Label>
                    <Input
                      value={createPreviewText}
                      onChange={(e) => setCreatePreviewText(e.target.value)}
                      placeholder="Short preview shown in inbox"
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1.5">
                      <Label>From Name</Label>
                      <Input value={createFromName} onChange={(e) => setCreateFromName(e.target.value)} placeholder="Team Name" />
                    </div>
                    <div className="space-y-1.5">
                      <Label>From Email</Label>
                      <Input value={createFromEmail} onChange={(e) => setCreateFromEmail(e.target.value)} placeholder="hello@you.com" type="email" />
                    </div>
                  </div>
                  <div className="space-y-1.5">
                    <Label>Segments *</Label>
                    {segments.length === 0 ? (
                      <div className="rounded-lg border border-dashed px-4 py-3 text-[12px] text-muted-foreground">
                        No segments yet.{" "}
                        <Link
                          to="/segments"
                          onClick={() => setCreateOpen(false)}
                          className="font-medium text-foreground hover:underline"
                        >
                          Create a segment
                        </Link>{" "}
                        first.
                      </div>
                    ) : (
                      <div className="flex flex-wrap gap-1.5">
                        {segments.map((seg) => (
                          <button
                            key={seg.id}
                            type="button"
                            onClick={() =>
                              setSelectedSegmentIds((ids) =>
                                ids.includes(seg.id)
                                  ? ids.filter((id) => id !== seg.id)
                                  : [...ids, seg.id]
                              )
                            }
                            className={cn(
                              "rounded-full border px-3 py-1 text-xs font-medium transition-colors duration-150 cursor-pointer",
                              selectedSegmentIds.includes(seg.id)
                                ? "border-foreground bg-foreground text-background"
                                : "border-border hover:bg-accent"
                            )}
                          >
                            {seg.name}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                  <div className="space-y-1.5">
                    <Label>Schedule (optional)</Label>
                    <Input
                      type="datetime-local"
                      value={createScheduledAt}
                      onChange={(e) => setCreateScheduledAt(e.target.value)}
                      className="text-[13px]"
                    />
                    <p className="text-[11px] text-muted-foreground">Leave blank to send immediately when you click Send</p>
                  </div>
                  <div className="space-y-1.5 flex flex-col flex-1">
                    <div className="flex items-center justify-between">
                      <Label>Content</Label>
                      <div className="flex items-center rounded-md border border-border p-0.5 gap-0.5">
                        {(["visual", "html"] as const).map((m) => (
                          <button
                            key={m}
                            type="button"
                            onClick={() => setCreateMode(m)}
                            className={cn(
                              "rounded px-2.5 py-0.5 text-xs font-medium transition-colors cursor-pointer",
                              createMode === m ? "bg-foreground text-background" : "text-muted-foreground hover:text-foreground"
                            )}
                          >
                            {m === "visual" ? "Visual" : "HTML"}
                          </button>
                        ))}
                      </div>
                    </div>

                    {/* Template loader — pick any template as a starting point, then edit freely */}
                    {templates.length > 0 && (
                      <div className="space-y-1">
                        <Label className="text-[11px] text-muted-foreground">Start from template</Label>
                        <TemplatePicker
                          templates={templates}
                          loadedName={createLoadedTemplateName}
                          onSelect={(tpl) => {
                            if (isFullHtmlDoc(tpl.htmlContent)) {
                              setCreateTemplateFrame(tpl.htmlContent);
                              setCreateHtml(extractBodyContent(tpl.htmlContent));
                            } else {
                              setCreateTemplateFrame(null);
                              setCreateLoadedTemplateName(null);
                              setCreateHtml(tpl.htmlContent);
                            }
                            setCreateLoadedTemplateName(tpl.name);
                            setCreateMode("visual");
                          }}
                        />
                        {createTemplateFrame && (
                          <p className="text-[10px] text-muted-foreground">
                            Frame loaded.{" "}
                            <button type="button" onClick={() => { setCreateTemplateFrame(null); setCreateLoadedTemplateName(null); }} className="underline hover:text-foreground cursor-pointer">Remove</button>
                          </p>
                        )}
                      </div>
                    )}

                    {createMode === "visual" ? (
                      <EmailEditor
                        value={createHtml}
                        onChange={setCreateHtml}
                        placeholder="Start writing your broadcast… or pick a template above."
                        workspaceId={activeWorkspaceId ?? undefined}
                        minHeight="200px"
                      />
                    ) : (
                      <textarea
                        value={createHtml}
                        onChange={(e) => setCreateHtml(e.target.value)}
                        placeholder="<h1>Hello {{firstName}}!</h1>"
                        className="flex-1 w-full min-h-[200px] resize-none rounded-md border border-input bg-input px-3 py-2 font-mono text-xs focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                      />
                    )}
                  </div>
                </div>
                <div className="shrink-0 px-5 py-3 border-t border-border bg-card">
                  <Button type="submit" className="w-full" disabled={createMutation.isPending}>
                    {createMutation.isPending ? "Creating…" : "Create Broadcast"}
                  </Button>
                </div>
              </form>

              {/* Right — live preview */}
              <div className="flex-1 flex flex-col min-w-0 bg-muted/30">
                {(() => {
                  const previewHtml = createTemplateFrame
                    ? injectIntoFrame(createTemplateFrame, createHtml)
                    : createHtml;
                  return (
                    <>
                      <div className="shrink-0 flex items-center justify-between px-4 py-2 border-b border-border">
                        <span className="text-[11px] font-medium text-muted-foreground uppercase tracking-wide">Preview</span>
                        {previewHtml && <span className="text-[10px] text-muted-foreground">Live</span>}
                      </div>
                      <div className="flex-1 flex items-start justify-center overflow-auto p-6">
                        {previewHtml ? (
                          <div className={cn("h-full transition-all duration-200", createPreviewMobile ? "w-[375px]" : "w-full max-w-[680px]")}>
                            <iframe
                              srcDoc={previewHtml}
                              sandbox="allow-same-origin"
                              className="w-full h-full min-h-[600px] rounded-lg border border-border bg-white shadow-sm"
                              title="Email preview"
                            />
                          </div>
                        ) : (
                          <div className="flex flex-col items-center justify-center h-full text-center gap-2 opacity-40">
                            <Monitor className="h-8 w-8 text-muted-foreground" />
                            <p className="text-[12px] text-muted-foreground">{createMode === "visual" ? "Start writing to see a live preview" : "Start typing HTML to see a live preview"}</p>
                          </div>
                        )}
                      </div>
                    </>
                  );
                })()}
              </div>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      {/* Search */}
      <div className="mb-4 relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground/50" />
        <Input
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder="Filter by name or subject…"
          className="pl-9 h-9"
        />
      </div>

      {isError && (
        <div className="mb-4 flex items-center gap-2 rounded-lg border border-destructive/20 bg-destructive/8 px-3.5 py-2.5 text-[13px] text-destructive">
          <AlertCircle className="h-3.5 w-3.5 shrink-0" />
          Failed to load broadcasts.
        </div>
      )}

      {/* Table */}
      <div className="rounded-lg border border-border overflow-hidden">
        <table className="w-full">
          <thead>
            <tr className="border-b border-border bg-muted/30">
              <th className="px-4 py-2.5 text-left text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                Name
              </th>
              <th className="px-4 py-2.5 text-left text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                Status
              </th>
              <th className="px-4 py-2.5 text-right text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                Sent
              </th>
              <th className="px-4 py-2.5 text-right text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                Opens
              </th>
              <th className="px-4 py-2.5 text-right text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                Clicks
              </th>
              <th className="px-4 py-2.5 text-right text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                Actions
              </th>
            </tr>
          </thead>
          <tbody>
            {isLoading &&
              Array.from({ length: 3 }).map((_, i) => (
                <tr key={i} className="border-b border-border/50">
                  <td className="px-4 py-3">
                    <div className="space-y-1.5">
                      <div className="h-3.5 w-32 rounded shimmer" />
                      <div className="h-3 w-48 rounded shimmer" />
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <div className="h-5 w-14 rounded-full shimmer" />
                  </td>
                  <td className="px-4 py-3 text-right">
                    <div className="h-3.5 w-10 rounded shimmer ml-auto" />
                  </td>
                  <td className="px-4 py-3 text-right">
                    <div className="h-3.5 w-10 rounded shimmer ml-auto" />
                  </td>
                  <td className="px-4 py-3 text-right">
                    <div className="h-3.5 w-10 rounded shimmer ml-auto" />
                  </td>
                  <td className="px-4 py-3 text-right">
                    <div className="h-7 w-14 rounded shimmer ml-auto" />
                  </td>
                </tr>
              ))}

            {!isLoading &&
              filteredBroadcasts.map((broadcast) => (
                <tr
                  key={broadcast.id}
                  onClick={() => setDetailBroadcastId(broadcast.id)}
                  className="group border-b border-border/50 last:border-0 hover:bg-accent/50 transition-colors cursor-pointer"
                >
                  <td className="px-4 py-3">
                    <p className="font-medium text-[13px] truncate max-w-[260px]">{broadcast.name}</p>
                    <p className="text-[11px] text-muted-foreground truncate max-w-[260px]">{broadcast.subject}</p>
                    {broadcast.sentAt && (
                      <p className="text-[10px] text-muted-foreground/60 mt-0.5 tabular-nums">
                        Sent {format(new Date(broadcast.sentAt), "MMM d, yyyy")}
                      </p>
                    )}
                    {!broadcast.sentAt && broadcast.createdAt && broadcast.createdAt !== "1970-01-01T00:00:00Z" && (
                      <p className="text-[10px] text-muted-foreground/40 mt-0.5 tabular-nums">
                        Created {format(new Date(broadcast.createdAt), "MMM d, yyyy")}
                      </p>
                    )}
                    {broadcast.status === "sending" && (
                      <SendProgress sentCount={broadcast.sentCount ?? 0} recipientCount={broadcast.recipientCount ?? 0} />
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <Badge variant={STATUS_BADGE[broadcast.status] ?? "secondary"}>
                      {broadcast.status}
                    </Badge>
                  </td>
                  <td className="px-4 py-3 text-right text-[12px] tabular-nums text-muted-foreground">
                    {broadcast.sentCount > 0
                      ? broadcast.sentCount.toLocaleString()
                      : "—"}
                  </td>
                  <td className="px-4 py-3 text-right text-[12px] tabular-nums text-muted-foreground">
                    {broadcast.openCount > 0
                      ? broadcast.openCount.toLocaleString()
                      : "—"}
                  </td>
                  <td className="px-4 py-3 text-right text-[12px] tabular-nums text-muted-foreground">
                    {broadcast.clickCount > 0
                      ? broadcast.clickCount.toLocaleString()
                      : "—"}
                  </td>
                  <td className="px-4 py-3 text-right" onClick={(e) => e.stopPropagation()}>
                    <div className="flex items-center justify-end gap-1.5">
                      <span className="text-[11px] text-muted-foreground tabular-nums opacity-0 transition-opacity duration-150 group-hover:opacity-100">
                        {broadcast.createdAt
                          ? format(new Date(broadcast.createdAt), "MMM d")
                          : ""}
                      </span>
                      {broadcast.status === "draft" && (
                        <Button
                          size="sm"
                          onClick={(e) => {
                            e.stopPropagation();
                            setDetailBroadcastId(broadcast.id);
                          }}
                        >
                          <Send className="h-3.5 w-3.5" />
                          Send
                        </Button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}

            {!isLoading && filteredBroadcasts.length === 0 && (
              <tr>
                <td colSpan={6} className="py-20 text-center">
                  {broadcasts.length === 0 ? (
                    <div className="flex flex-col items-center justify-center text-center">
                      <div className="mb-4 flex h-9 w-9 items-center justify-center rounded-lg border border-border">
                        <Mail className="h-5 w-5 text-muted-foreground" />
                      </div>
                      <p className="text-[13px] font-medium">No broadcasts yet</p>
                      <p className="mt-1 text-[12px] text-muted-foreground">
                        Send a one-off email to any audience segment
                      </p>
                      <Button size="sm" className="mt-4" onClick={() => setCreateOpen(true)}>
                        <Plus className="h-3.5 w-3.5" />
                        New Broadcast
                      </Button>
                    </div>
                  ) : (
                    <p className="text-[12px] text-muted-foreground">
                      No broadcasts match your search
                    </p>
                  )}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Detail / Edit dialog */}
      {detailBroadcast && activeWorkspaceId && (
        <BroadcastDetailDialog
          broadcast={detailBroadcast}
          onClose={() => setDetailBroadcastId(null)}
          segments={segments}
          templates={templates}
          onSendSuccess={() => setDetailBroadcastId(null)}
          onDeleteSuccess={() => setDetailBroadcastId(null)}
          workspaceId={activeWorkspaceId}
        />
      )}
    </div>
  );
}
