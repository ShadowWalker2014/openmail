import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { sessionFetch } from "@/lib/api";
import { useWorkspaceStore } from "@/store/workspace";
import { useState, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import {
  Activity, Copy, Check, ExternalLink, Plus, Send,
  ChevronLeft, ChevronRight, Code2, BookOpen,
  Zap, Globe, Terminal,
} from "lucide-react";
import { toast } from "sonner";
import { format, isToday, isYesterday, formatDistanceToNow } from "date-fns";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_app/events/")({ component: EventsPage });

// ── Types ─────────────────────────────────────────────────────────────────────

interface EventRecord {
  id: string;
  name: string;
  contactEmail: string | null;
  contactId: string | null;
  properties: Record<string, unknown>;
  occurredAt: string;
  createdAt: string;
}

interface EventsResponse {
  data: EventRecord[];
  total: number;
  page: number;
  pageSize: number;
}

interface ApiKey {
  id: string;
  name: string;
  keyPrefix: string;
  createdAt: string;
}

const PAGE_SIZE = 50;
const API_URL = import.meta.env.VITE_API_URL ?? "";

// ── Copy button ───────────────────────────────────────────────────────────────

function CopyBtn({ text, label }: { text: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  function copy() {
    navigator.clipboard.writeText(text);
    setCopied(true);
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => setCopied(false), 2000);
  }

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          onClick={copy}
          className="flex items-center gap-1.5 px-2 py-1 rounded-md text-[12px] font-medium transition-colors
            text-muted-foreground hover:text-foreground hover:bg-accent cursor-pointer"
        >
          {copied ? <Check className="h-3 w-3 text-green-500" /> : <Copy className="h-3 w-3" />}
          {label && <span>{copied ? "Copied!" : label}</span>}
        </button>
      </TooltipTrigger>
      <TooltipContent side="top">{copied ? "Copied!" : "Copy to clipboard"}</TooltipContent>
    </Tooltip>
  );
}

// ── Code snippets ─────────────────────────────────────────────────────────────

type Lang = "sdk" | "curl" | "python" | "posthog" | "cio";

function getCodeSnippet(lang: Lang, apiUrl: string, apiKeyPlaceholder: string): string {
  const trackUrl = `${apiUrl}/api/v1/events/track`;
  const ingestUrl = `${apiUrl}/api/ingest`;

  const snippets: Record<Lang, string> = {
    sdk: `import { OpenMail } from "@openmail/sdk";

const openmail = new OpenMail({
  apiKey: "${apiKeyPlaceholder}",
});

// Identify the user (creates or updates a contact)
await openmail.identify("alice@example.com", {
  firstName: "Alice",
  plan: "pro",
});

// Track an event — triggers matching campaigns
await openmail.track("plan_upgraded", {
  from_plan: "starter",
  to_plan: "pro",
  mrr: 99,
}, { userId: "alice@example.com" });

// Flush before process exit
await openmail.flush();`,

    curl: `curl -X POST ${trackUrl} \\
  -H "Authorization: Bearer ${apiKeyPlaceholder}" \\
  -H "Content-Type: application/json" \\
  -d '{
    "email": "alice@example.com",
    "name": "plan_upgraded",
    "properties": {
      "from_plan": "starter",
      "to_plan": "pro",
      "mrr": 99
    }
  }'`,

    python: `import requests

response = requests.post(
    "${trackUrl}",
    headers={
        "Authorization": "Bearer ${apiKeyPlaceholder}",
        "Content-Type": "application/json",
    },
    json={
        "email": "alice@example.com",
        "name": "plan_upgraded",
        "properties": {
            "from_plan": "starter",
            "to_plan": "pro",
            "mrr": 99,
        },
    },
)
print(response.json())  # { "id": "evt_xxx" }`,

    posthog: `// PostHog SDK — just change the host URL
import { PostHog } from "posthog-node";

const posthog = new PostHog("${apiKeyPlaceholder}", {
  host: "${ingestUrl}",
});

// All standard PostHog calls work as-is
posthog.capture({
  distinctId: "alice@example.com",
  event: "plan_upgraded",
  properties: { from_plan: "starter", to_plan: "pro" },
});

posthog.identify({
  distinctId: "alice@example.com",
  properties: { name: "Alice Smith", plan: "pro" },
});

await posthog.shutdown();`,

    cio: `// Customer.io Node SDK — just change the host URL
const { TrackClient } = require("customerio-node");

const cio = new TrackClient(
  "your-workspace-id",   // site_id (can be any string)
  "${apiKeyPlaceholder}", // api_key = your OpenMail key
  { url: "${ingestUrl}/cio/v1" }
);

// Identify user
cio.identify("alice@example.com", {
  email: "alice@example.com",
  first_name: "Alice",
  plan: "pro",
});

// Track event
cio.track("alice@example.com", {
  name: "plan_upgraded",
  data: { from_plan: "starter", to_plan: "pro" },
});`,
  };

  return snippets[lang];
}

// ── Event color for badges ────────────────────────────────────────────────────

const EVENT_COLORS: Record<string, string> = {
  $pageview: "bg-blue-500/10 text-blue-400 border-blue-500/20",
  $identify: "bg-purple-500/10 text-purple-400 border-purple-500/20",
  $group: "bg-indigo-500/10 text-indigo-400 border-indigo-500/20",
  $alias: "bg-cyan-500/10 text-cyan-400 border-cyan-500/20",
};

function getEventColor(name: string): string {
  if (name in EVENT_COLORS) return EVENT_COLORS[name];
  if (name.includes("upgrade") || name.includes("paid")) return "bg-green-500/10 text-green-400 border-green-500/20";
  if (name.includes("cancel") || name.includes("churn")) return "bg-red-500/10 text-red-400 border-red-500/20";
  return "bg-muted text-muted-foreground border-border";
}

function formatEventTime(dateStr: string): string {
  const d = new Date(dateStr);
  if (isToday(d)) return formatDistanceToNow(d, { addSuffix: true });
  if (isYesterday(d)) return `Yesterday ${format(d, "h:mm a")}`;
  return format(d, "MMM d, h:mm a");
}

// ── Main page ─────────────────────────────────────────────────────────────────

function EventsPage() {
  const { activeWorkspaceId } = useWorkspaceStore();
  const qc = useQueryClient();

  const [page, setPage] = useState(1);
  const [nameFilter, setNameFilter] = useState("");
  const [appliedFilter, setAppliedFilter] = useState("");
  const [activeLang, setActiveLang] = useState<Lang>("sdk");
  const [testOpen, setTestOpen] = useState(false);

  // Fetch events
  const { data: eventsData, isLoading: eventsLoading } = useQuery<EventsResponse>({
    queryKey: ["events", activeWorkspaceId, page, appliedFilter],
    queryFn: () => {
      const params = new URLSearchParams({ page: String(page), pageSize: String(PAGE_SIZE) });
      if (appliedFilter) params.set("name", appliedFilter);
      return sessionFetch(activeWorkspaceId!, `/events?${params}`);
    },
    enabled: !!activeWorkspaceId,
  });

  // Fetch API keys (to show prefix)
  const { data: apiKeys = [] } = useQuery<ApiKey[]>({
    queryKey: ["api-keys", activeWorkspaceId],
    queryFn: () => sessionFetch(activeWorkspaceId!, "/api-keys"),
    enabled: !!activeWorkspaceId,
  });

  const firstKey = apiKeys[0];
  const apiKeyDisplay = firstKey ? `${firstKey.keyPrefix}••••••••••••••` : "om_your_api_key";

  const events = eventsData?.data ?? [];
  const total = eventsData?.total ?? 0;
  const totalPages = Math.ceil(total / PAGE_SIZE);
  const trackUrl = `${API_URL}/api/v1/events/track`;
  const ingestBaseUrl = `${API_URL}/api/ingest`;

  const LANG_TABS: { id: Lang; label: string; icon: React.ElementType }[] = [
    { id: "sdk", label: "Node.js SDK", icon: Code2 },
    { id: "curl", label: "cURL", icon: Terminal },
    { id: "python", label: "Python", icon: Code2 },
    { id: "posthog", label: "PostHog", icon: Zap },
    { id: "cio", label: "Customer.io", icon: Globe },
  ];

  const snippet = getCodeSnippet(activeLang, API_URL, apiKeyDisplay);

  return (
    <div className="px-8 py-7 w-full max-w-6xl mx-auto space-y-8">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-violet-500/10 border border-violet-500/20">
            <Activity className="h-[18px] w-[18px] text-violet-400" />
          </div>
          <div>
            <h1 className="text-xl font-semibold tracking-tight text-foreground">Event Tracking</h1>
            <p className="text-sm text-muted-foreground mt-0.5">
              Track user actions and trigger automated email campaigns.
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <a
            href="https://docs.openmail.win/sdk/event-ingestion"
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm text-muted-foreground
              border border-border hover:bg-accent hover:text-foreground transition-colors cursor-pointer"
          >
            <BookOpen className="h-3.5 w-3.5" />
            <span>Docs</span>
            <ExternalLink className="h-3 w-3 opacity-50" />
          </a>
          <Button size="sm" onClick={() => setTestOpen(true)} className="gap-1.5">
            <Send className="h-3.5 w-3.5" />
            Send Test Event
          </Button>
        </div>
      </div>

      {/* Endpoint + API key info cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Ingestion endpoint */}
        <div className="rounded-xl border border-border bg-card p-5">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground/60 mb-3">
            Ingestion Endpoint (Native)
          </p>
          <div className="flex items-center gap-2 mb-2">
            <span className="px-1.5 py-0.5 rounded text-[10px] font-semibold bg-blue-500/10 text-blue-400 border border-blue-500/20">
              POST
            </span>
            <code className="text-[13px] text-foreground font-mono truncate flex-1">
              /api/v1/events/track
            </code>
            <CopyBtn text={trackUrl} />
          </div>
          <p className="text-[12px] text-muted-foreground">
            Send <code className="font-mono text-[11px] bg-muted px-1 py-0.5 rounded">email</code>,{" "}
            <code className="font-mono text-[11px] bg-muted px-1 py-0.5 rounded">name</code>, and{" "}
            <code className="font-mono text-[11px] bg-muted px-1 py-0.5 rounded">properties</code>
          </p>
          <div className="mt-3 pt-3 border-t border-border">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground/60 mb-2">
              Also compatible with
            </p>
            <div className="flex flex-wrap gap-1.5">
              {[
                { label: "PostHog", path: "/api/ingest/capture" },
                { label: "Batch", path: "/api/ingest/batch" },
                { label: "Customer.io", path: "/api/ingest/cio/v1/*" },
              ].map(({ label, path }) => (
                <div key={label} className="flex items-center gap-1.5 px-2 py-1 rounded-md bg-muted/50 border border-border">
                  <span className="text-[11px] font-medium text-foreground">{label}</span>
                  <code className="text-[10px] font-mono text-muted-foreground">{path}</code>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* API key */}
        <div className="rounded-xl border border-border bg-card p-5">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground/60 mb-3">
            Authentication
          </p>
          <p className="text-[12.5px] text-muted-foreground mb-3">
            Use your workspace API key as a Bearer token:
          </p>
          <div className="rounded-lg bg-muted/40 border border-border px-3 py-2 font-mono text-[12.5px] flex items-center gap-2">
            <span className="text-muted-foreground">Authorization: Bearer</span>
            <span className="text-foreground flex-1 truncate">{apiKeyDisplay}</span>
          </div>
          {firstKey && (
            <p className="text-[11.5px] text-muted-foreground/60 mt-1.5 italic">
              Full key shown once at creation — copy from{" "}
              <Link to="/settings/api-keys" className="underline hover:text-muted-foreground transition-colors">
                Settings → API Keys
              </Link>
            </p>
          )}
          {apiKeys.length === 0 ? (
            <Link
              to="/settings/api-keys"
              className="mt-3 flex items-center gap-1.5 text-[12.5px] text-violet-400 hover:text-violet-300 transition-colors"
            >
              <Plus className="h-3.5 w-3.5" />
              Create your first API key
            </Link>
          ) : (
            <Link
              to="/settings/api-keys"
              className="mt-3 flex items-center gap-1.5 text-[12.5px] text-muted-foreground hover:text-foreground transition-colors"
            >
              <span>Manage API keys in Settings</span>
              <ExternalLink className="h-3 w-3 opacity-50" />
            </Link>
          )}
        </div>
      </div>

      {/* Code snippet panel */}
      <div className="rounded-xl border border-border bg-card overflow-hidden">
        {/* Tab bar */}
        <div className="flex items-center gap-0 border-b border-border bg-muted/30 px-4">
          {LANG_TABS.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              onClick={() => setActiveLang(id)}
              className={cn(
                "flex items-center gap-1.5 px-3 py-3 text-[12.5px] font-medium border-b-2 transition-colors cursor-pointer whitespace-nowrap",
                activeLang === id
                  ? "border-violet-500 text-foreground"
                  : "border-transparent text-muted-foreground hover:text-foreground"
              )}
            >
              <Icon className="h-3.5 w-3.5" />
              {label}
            </button>
          ))}
          <div className="flex-1" />
          <div className="flex items-center gap-2">
            <a
              href="https://docs.openmail.win/sdk/event-ingestion"
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-1 text-[12px] text-muted-foreground hover:text-foreground transition-colors px-2 py-1"
            >
              <BookOpen className="h-3.5 w-3.5" />
              <span>Full docs</span>
              <ExternalLink className="h-3 w-3 opacity-50" />
            </a>
            <CopyBtn text={snippet} label="Copy" />
          </div>
        </div>

        {/* Code */}
        <div className="relative">
          <pre className="overflow-x-auto p-5 text-[12.5px] leading-[1.75] font-mono text-muted-foreground bg-[#0f0f0f]">
            <code>{snippet}</code>
          </pre>
        </div>

        {/* Install hint for SDK */}
        {activeLang === "sdk" && (
          <div className="border-t border-border px-5 py-3 flex items-center gap-3 bg-muted/20">
            <Terminal className="h-3.5 w-3.5 text-muted-foreground/50 shrink-0" />
            <code className="text-[12px] text-muted-foreground">
              npm install @openmail/sdk
            </code>
            <CopyBtn text="npm install @openmail/sdk" />
          </div>
        )}
      </div>

      {/* Recent events table */}
      <div>
        <div className="flex items-center justify-between mb-4">
          <div>
            <h2 className="text-base font-semibold text-foreground">Recent Events</h2>
            {total > 0 && (
              <p className="text-[12.5px] text-muted-foreground mt-0.5">
                {total.toLocaleString()} total events
              </p>
            )}
          </div>
          <div className="flex items-center gap-2">
            <div className="relative">
              <Input
                placeholder="Filter by name…"
                value={nameFilter}
                onChange={(e) => setNameFilter(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") { setAppliedFilter(nameFilter); setPage(1); }
                }}
                className={cn(
                  "h-8 text-sm w-52 pr-8 transition-all",
                  nameFilter !== appliedFilter && nameFilter && "ring-1 ring-violet-500/40"
                )}
              />
              {appliedFilter && (
                <button
                  onClick={() => { setNameFilter(""); setAppliedFilter(""); setPage(1); }}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
                >
                  ×
                </button>
              )}
            </div>
            <Button
              size="sm"
              variant="outline"
              onClick={() => { setAppliedFilter(nameFilter); setPage(1); }}
              className="h-8 text-xs"
            >
              Filter
            </Button>
          </div>
        </div>

        <div className="rounded-xl border border-border overflow-hidden">
          {/* Table header */}
          <div className="grid grid-cols-[1fr_180px_200px_120px] gap-4 px-5 py-2.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground/60 bg-muted/30 border-b border-border">
            <span>Event</span>
            <span>Contact</span>
            <span>Properties</span>
            <span className="text-right">Received</span>
          </div>

          {eventsLoading ? (
            <div className="space-y-0">
              {Array.from({ length: 8 }).map((_, i) => (
                <div
                  key={i}
                  className="grid grid-cols-[1fr_180px_200px_120px] gap-4 px-5 py-3.5 border-b border-border/50 animate-pulse"
                >
                  <div className="h-5 w-36 bg-muted/60 rounded" />
                  <div className="h-4 w-32 bg-muted/40 rounded" />
                  <div className="h-4 w-40 bg-muted/40 rounded" />
                  <div className="h-4 w-20 bg-muted/40 rounded ml-auto" />
                </div>
              ))}
            </div>
          ) : events.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-20 gap-4">
              <div className="flex h-14 w-14 items-center justify-center rounded-full bg-muted/50 border border-border">
                <Activity className="h-6 w-6 text-muted-foreground/40" />
              </div>
              <div className="text-center">
                <p className="text-sm font-medium text-foreground">No events yet</p>
                <p className="text-[12.5px] text-muted-foreground mt-1">
                  {appliedFilter
                    ? `No events matching "${appliedFilter}"`
                    : "Send your first event using the code above"}
                </p>
              </div>
              {!appliedFilter && (
                <Button size="sm" variant="outline" onClick={() => setTestOpen(true)} className="gap-1.5 mt-1">
                  <Send className="h-3.5 w-3.5" />
                  Send a test event
                </Button>
              )}
            </div>
          ) : (
            <div>
              {events.map((ev, idx) => (
                <div
                  key={ev.id}
                  className={cn(
                    "grid grid-cols-[1fr_180px_200px_120px] gap-4 px-5 py-3.5 items-center",
                    "hover:bg-accent/30 transition-colors group",
                    idx < events.length - 1 && "border-b border-border/50"
                  )}
                >
                  {/* Event name */}
                  <div className="flex items-center gap-2 min-w-0">
                    <span
                      className={cn(
                        "inline-flex items-center px-2 py-0.5 rounded-md text-[11.5px] font-mono font-medium border",
                        getEventColor(ev.name)
                      )}
                    >
                      {ev.name}
                    </span>
                  </div>

                  {/* Contact */}
                  <div className="text-[12.5px] text-muted-foreground truncate">
                    {ev.contactEmail ?? <span className="italic opacity-50">anonymous</span>}
                  </div>

                  {/* Properties preview */}
                  <div className="text-[12px] text-muted-foreground font-mono truncate">
                    {Object.keys(ev.properties).length === 0 ? (
                      <span className="opacity-40">{"{}"}</span>
                    ) : (() => {
                      const s = JSON.stringify(ev.properties);
                      return (
                        <span className="text-foreground/60">
                          {s.slice(0, 60)}{s.length > 60 && "…"}
                        </span>
                      );
                    })()}
                  </div>

                  {/* Time */}
                  <div className="text-[12px] text-muted-foreground text-right">
                    {formatEventTime(ev.occurredAt)}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="flex items-center justify-between pt-4">
            <p className="text-[12.5px] text-muted-foreground">
              Page {page} of {totalPages} · {total.toLocaleString()} events
            </p>
            <div className="flex items-center gap-1.5">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={page === 1}
                className="h-7 w-7 p-0"
              >
                <ChevronLeft className="h-3.5 w-3.5" />
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                disabled={page >= totalPages}
                className="h-7 w-7 p-0"
              >
                <ChevronRight className="h-3.5 w-3.5" />
              </Button>
            </div>
          </div>
        )}
      </div>

      {/* Test event dialog */}
      <TestEventDialog
        open={testOpen}
        onClose={() => setTestOpen(false)}
        workspaceId={activeWorkspaceId}
        onSuccess={() => {
          qc.invalidateQueries({ queryKey: ["events", activeWorkspaceId] });
        }}
      />
    </div>
  );
}

// ── Test event dialog ─────────────────────────────────────────────────────────

function TestEventDialog({
  open,
  onClose,
  workspaceId,
  onSuccess,
}: {
  open: boolean;
  onClose: () => void;
  workspaceId: string | null;
  onSuccess: () => void;
}) {
  const [email, setEmail] = useState("");
  const [name, setName] = useState("test_event");
  const [props, setProps] = useState('{ "source": "dashboard" }');

  const mutation = useMutation({
    mutationFn: () => {
      let properties: Record<string, unknown> = {};
      try { properties = JSON.parse(props); } catch { /* ignore */ }
      return sessionFetch<{ id: string }>(workspaceId!, "/events/track", {
        method: "POST",
        body: JSON.stringify({ email, name, properties }),
      });
    },
    onSuccess: (data) => {
      toast.success(`Event tracked — ID: ${data.id}`);
      onClose();
      onSuccess();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Send className="h-4 w-4" />
            Send Test Event
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div className="space-y-1.5">
            <Label htmlFor="te-email">Contact email</Label>
            <Input
              id="te-email"
              type="email"
              placeholder="alice@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="te-name">Event name</Label>
            <Input
              id="te-name"
              placeholder="plan_upgraded"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="te-props">Properties (JSON)</Label>
            <textarea
              id="te-props"
              rows={3}
              value={props}
              onChange={(e) => setProps(e.target.value)}
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm font-mono
                text-foreground placeholder:text-muted-foreground
                focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring
                resize-none"
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button
            onClick={() => mutation.mutate()}
            disabled={!email || !name || mutation.isPending}
            className="gap-1.5"
          >
            {mutation.isPending ? "Sending…" : (
              <>
                <Send className="h-3.5 w-3.5" />
                Send Event
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
