import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { sessionFetch, apiFetch } from "@/lib/api";
import { useWorkspaceStore } from "@/store/workspace";
import { useWorkspaces } from "@/hooks/use-workspaces";
import type { DomainRecord } from "@/hooks/use-workspaces";
import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
  Copy,
  Check,
  Plus,
  Trash2,
  Key,
  Mail,
  Code2,
  X,
  Globe,
  RefreshCw,
  CheckCircle2,
  XCircle,
  Clock,
  AlertTriangle,
  ExternalLink,
} from "lucide-react";
import { toast } from "sonner";
import { format } from "date-fns";

export const Route = createFileRoute("/_app/settings/")({
  component: SettingsPage,
});

interface ApiKey {
  id: string;
  name: string;
  keyPrefix: string;
  lastUsedAt: string | null;
  createdAt: string;
}

interface DomainResponse {
  id: string;
  name: string;
  status: string;
  records: DomainRecord[];
}

// ── helpers ───────────────────────────────────────────────────────────────────

function SectionHeader({
  icon: Icon,
  title,
  description,
}: {
  icon: React.ElementType;
  title: string;
  description?: string;
}) {
  return (
    <div className="flex items-center gap-3 border-b border-border px-5 py-3.5">
      <div className="flex h-7 w-7 items-center justify-center rounded-md border border-border bg-muted/50">
        <Icon className="h-3.5 w-3.5 text-muted-foreground" />
      </div>
      <div>
        <h2 className="text-[13px] font-medium text-foreground">{title}</h2>
        {description && (
          <p className="text-[11px] text-muted-foreground mt-px">{description}</p>
        )}
      </div>
    </div>
  );
}

function CopyButton({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);
  function handleCopy() {
    navigator.clipboard.writeText(value);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }
  return (
    <button
      onClick={handleCopy}
      className="shrink-0 rounded p-1.5 text-muted-foreground/50 transition-colors hover:bg-muted hover:text-foreground cursor-pointer"
      title={copied ? "Copied!" : "Copy"}
    >
      {copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
    </button>
  );
}

function DomainStatusBadge({ status }: { status: string }) {
  const configs: Record<string, { label: string; icon: React.ElementType; cls: string }> = {
    verified: {
      label: "Verified",
      icon: CheckCircle2,
      cls: "bg-emerald-500/10 text-emerald-400 border-emerald-500/20",
    },
    pending: {
      label: "Verifying…",
      icon: Clock,
      cls: "bg-amber-500/10 text-amber-400 border-amber-500/20",
    },
    not_started: {
      label: "Not verified",
      icon: AlertTriangle,
      cls: "bg-muted/60 text-muted-foreground border-border",
    },
    failed: {
      label: "Failed",
      icon: XCircle,
      cls: "bg-destructive/10 text-destructive border-destructive/20",
    },
    temporary_failure: {
      label: "Temp failure",
      icon: XCircle,
      cls: "bg-destructive/10 text-destructive border-destructive/20",
    },
  };
  const cfg = configs[status] ?? configs.not_started;
  const Icon = cfg.icon;
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-medium ${cfg.cls}`}
    >
      <Icon className="h-2.5 w-2.5" />
      {cfg.label}
    </span>
  );
}

function RecordStatusDot({ status }: { status: string }) {
  if (status === "verified") return <span className="text-emerald-400" title="Verified">●</span>;
  if (status === "failed") return <span className="text-destructive" title="Failed">●</span>;
  return <span className="text-muted-foreground/40" title="Not verified">●</span>;
}

// ── Sending Domain Panel ───────────────────────────────────────────────────────

function SendingDomainPanel({
  workspaceId,
  activeWorkspace,
}: {
  workspaceId: string;
  activeWorkspace: ReturnType<typeof useWorkspaces>["activeWorkspace"];
}) {
  const qc = useQueryClient();
  const [domainInput, setDomainInput] = useState("");
  const [showRecords, setShowRecords] = useState(false);
  const [confirmDisconnect, setConfirmDisconnect] = useState(false);

  const hasDomain = !!activeWorkspace?.resendDomainName;
  const status = activeWorkspace?.resendDomainStatus ?? "not_started";
  const records = (activeWorkspace?.resendDomainRecords ?? []) as DomainRecord[];

  const connectMutation = useMutation({
    mutationFn: (domainName: string) =>
      sessionFetch<DomainResponse>(workspaceId, "/domains/connect", {
        method: "POST",
        body: JSON.stringify({ domainName }),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["workspaces"] });
      setDomainInput("");
      setShowRecords(true);
      toast.success("Domain connected — add the DNS records below to your DNS provider.");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const verifyMutation = useMutation({
    mutationFn: () =>
      sessionFetch<{ status: string }>(workspaceId, "/domains/verify", { method: "POST" }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["workspaces"] });
      toast.success("Verification started — this may take a few minutes.");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const refreshMutation = useMutation({
    mutationFn: () =>
      sessionFetch<DomainResponse>(workspaceId, "/domains/refresh", { method: "POST" }),
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ["workspaces"] });
      if (data.status === "verified") {
        toast.success("Domain verified! You can now send from this domain.");
      } else {
        toast.info(`Status: ${data.status}. DNS records may still be propagating.`);
      }
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const disconnectMutation = useMutation({
    mutationFn: () =>
      sessionFetch(workspaceId, "/domains", { method: "DELETE" }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["workspaces"] });
      setConfirmDisconnect(false);
      setShowRecords(false);
      toast.success("Domain disconnected.");
    },
    onError: (e: Error) => {
      setConfirmDisconnect(false);
      toast.error(e.message);
    },
  });

  return (
    <>
      <div className="px-5 py-4 space-y-4">
        {!hasDomain ? (
          /* ── Connect form ── */
          <div className="space-y-3">
            <p className="text-[12px] text-muted-foreground">
              Connect a custom sending domain (e.g.{" "}
              <code className="rounded bg-muted px-1 py-px font-mono text-[11px]">
                mail.yourapp.com
              </code>
              ) to send emails from your own domain via Resend.
            </p>
            {!activeWorkspace?.resendFromEmail && (
              <div className="flex items-start gap-2 rounded-md border border-amber-500/20 bg-amber-500/8 px-3 py-2.5">
                <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-amber-400 mt-px" />
                <p className="text-[11px] text-amber-300">
                  Configure your Resend API key in the Email Sending section first.
                </p>
              </div>
            )}
            <form
              onSubmit={(e) => {
                e.preventDefault();
                if (domainInput) connectMutation.mutate(domainInput);
              }}
              className="flex gap-2"
            >
              <Input
                value={domainInput}
                onChange={(e) => setDomainInput(e.target.value)}
                placeholder="mail.yourapp.com"
                className="flex-1"
                pattern="^[a-zA-Z0-9]([a-zA-Z0-9\-]*[a-zA-Z0-9])?(\.[a-zA-Z0-9]([a-zA-Z0-9\-]*[a-zA-Z0-9])?)+$"
              />
              <Button
                type="submit"
                size="sm"
                disabled={!domainInput || connectMutation.isPending}
              >
                {connectMutation.isPending ? "Connecting…" : "Connect Domain"}
              </Button>
            </form>
          </div>
        ) : (
          /* ── Domain connected ── */
          <div className="space-y-4">
            {/* Header row */}
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-2.5 min-w-0">
                <Globe className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                <span className="text-[13px] font-medium text-foreground truncate">
                  {activeWorkspace.resendDomainName}
                </span>
                <DomainStatusBadge status={status} />
              </div>
              <div className="flex items-center gap-1.5 shrink-0">
                {(status === "not_started" || status === "failed" || status === "temporary_failure") && (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => verifyMutation.mutate()}
                    disabled={verifyMutation.isPending}
                    className="h-7 text-[11px]"
                  >
                    {verifyMutation.isPending ? "Requesting…" : "Verify Now"}
                  </Button>
                )}
                {status === "pending" && (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => refreshMutation.mutate()}
                    disabled={refreshMutation.isPending}
                    className="h-7 text-[11px] gap-1.5"
                  >
                    <RefreshCw className={`h-3 w-3 ${refreshMutation.isPending ? "animate-spin" : ""}`} />
                    Check Status
                  </Button>
                )}
                {status === "verified" && (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => refreshMutation.mutate()}
                    disabled={refreshMutation.isPending}
                    className="h-7 text-[11px] gap-1.5"
                  >
                    <RefreshCw className={`h-3 w-3 ${refreshMutation.isPending ? "animate-spin" : ""}`} />
                    Refresh
                  </Button>
                )}
                <button
                  onClick={() => setConfirmDisconnect(true)}
                  className="rounded p-1.5 text-muted-foreground/40 transition-colors hover:bg-destructive/10 hover:text-destructive cursor-pointer"
                  title="Disconnect domain"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>

            {/* Verified success banner */}
            {status === "verified" && (
              <div className="flex items-center gap-2 rounded-md border border-emerald-500/20 bg-emerald-500/8 px-3 py-2.5">
                <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-emerald-400" />
                <p className="text-[11px] text-emerald-300">
                  Your sending domain is active. Set your From Email to{" "}
                  <code className="font-mono">you@{activeWorkspace.resendDomainName}</code> to start
                  sending.
                </p>
              </div>
            )}

            {/* Pending info */}
            {status === "pending" && (
              <div className="flex items-center gap-2 rounded-md border border-amber-500/20 bg-amber-500/8 px-3 py-2.5">
                <Clock className="h-3.5 w-3.5 shrink-0 text-amber-400" />
                <p className="text-[11px] text-amber-300">
                  Verification in progress. DNS propagation can take up to 72 hours. Click &quot;Check
                  Status&quot; to refresh.
                </p>
              </div>
            )}

            {/* Failed banner */}
            {(status === "failed" || status === "temporary_failure") && (
              <div className="flex items-center gap-2 rounded-md border border-destructive/20 bg-destructive/8 px-3 py-2.5">
                <XCircle className="h-3.5 w-3.5 shrink-0 text-destructive" />
                <p className="text-[11px] text-destructive">
                  Verification failed. Check your DNS records below are correct, then click &quot;Verify
                  Now&quot; to retry.
                </p>
              </div>
            )}

            {/* DNS Records */}
            {records.length > 0 && (
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <button
                    type="button"
                    onClick={() => setShowRecords((v) => !v)}
                    className="text-[11px] text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
                  >
                    {showRecords ? "Hide" : "Show"} DNS records ({records.length})
                  </button>
                  {!showRecords && status !== "verified" && (
                    <span className="text-[11px] text-muted-foreground/60">
                      Add these to your DNS provider
                    </span>
                  )}
                </div>

                {showRecords || status === "not_started" || status === "failed" || status === "temporary_failure" ? (
                  <div className="rounded-md border border-border overflow-hidden">
                    {/* Table header */}
                    <div className="grid grid-cols-[56px_1fr_2fr_auto] gap-3 border-b border-border bg-muted/40 px-3 py-2">
                      <span className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                        Type
                      </span>
                      <span className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                        Name
                      </span>
                      <span className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                        Value
                      </span>
                      <span className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                        St.
                      </span>
                    </div>

                    {records.map((rec, i) => (
                      <div
                        key={i}
                        className={`grid grid-cols-[56px_1fr_2fr_auto] gap-3 px-3 py-2.5 items-start ${
                          i < records.length - 1 ? "border-b border-border/50" : ""
                        }`}
                      >
                        {/* Type */}
                        <span className="font-mono text-[11px] text-muted-foreground font-medium">
                          {rec.type}
                        </span>

                        {/* Name */}
                        <div className="flex items-start gap-1 min-w-0">
                          <span className="font-mono text-[11px] text-foreground/80 truncate">
                            {rec.name}
                          </span>
                          <CopyButton value={rec.name} />
                        </div>

                        {/* Value */}
                        <div className="flex items-start gap-1 min-w-0">
                          <span className="font-mono text-[11px] text-foreground/70 break-all">
                            {rec.priority !== undefined ? `${rec.priority} ${rec.value}` : rec.value}
                          </span>
                          <CopyButton
                            value={rec.priority !== undefined ? `${rec.priority} ${rec.value}` : rec.value}
                          />
                        </div>

                        {/* Status dot */}
                        <div className="flex items-center pt-px">
                          <RecordStatusDot status={rec.status} />
                        </div>
                      </div>
                    ))}

                    {/* Note */}
                    <div className="border-t border-border bg-muted/20 px-3 py-2">
                      <p className="text-[10px] text-muted-foreground">
                        Add all records to your DNS provider, then click &quot;Verify Now&quot;. DNS
                        propagation may take up to 48–72 hours.{" "}
                        <a
                          href="https://resend.com/docs/dashboard/domains/introduction"
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-0.5 text-foreground/60 hover:text-foreground transition-colors"
                        >
                          Resend domain guide
                          <ExternalLink className="h-2.5 w-2.5" />
                        </a>
                      </p>
                    </div>
                  </div>
                ) : null}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Disconnect confirmation */}
      <AlertDialog open={confirmDisconnect} onOpenChange={setConfirmDisconnect}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Disconnect sending domain?</AlertDialogTitle>
            <AlertDialogDescription>
              <strong className="text-foreground font-medium">
                {activeWorkspace?.resendDomainName}
              </strong>{" "}
              will be removed from your Resend account and you will no longer be able to send emails
              from this domain until it is reconnected.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={disconnectMutation.isPending}
              onClick={() => disconnectMutation.mutate()}
            >
              {disconnectMutation.isPending ? "Disconnecting…" : "Disconnect"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

// ── Main Settings Page ────────────────────────────────────────────────────────

function SettingsPage() {
  const { activeWorkspaceId } = useWorkspaceStore();
  const { activeWorkspace } = useWorkspaces();
  const qc = useQueryClient();
  const [newKeyName, setNewKeyName] = useState("");
  const [createdKey, setCreatedKey] = useState<string | null>(null);
  const [deleteKey, setDeleteKey] = useState<ApiKey | null>(null);
  const resendKeyRef = useRef<HTMLInputElement>(null);
  const fromEmailRef = useRef<HTMLInputElement>(null);
  const fromNameRef = useRef<HTMLInputElement>(null);

  const { data: apiKeys = [], isLoading: keysLoading } = useQuery<ApiKey[]>({
    queryKey: ["api-keys", activeWorkspaceId],
    queryFn: () => sessionFetch(activeWorkspaceId!, "/api-keys"),
    enabled: !!activeWorkspaceId,
  });

  const createKeyMutation = useMutation({
    mutationFn: (name: string) =>
      sessionFetch<{ key: string } & ApiKey>(activeWorkspaceId!, "/api-keys", {
        method: "POST",
        body: JSON.stringify({ name }),
      }),
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ["api-keys", activeWorkspaceId] });
      setCreatedKey(data.key);
      setNewKeyName("");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const deleteKeyMutation = useMutation({
    mutationFn: (id: string) =>
      sessionFetch(activeWorkspaceId!, `/api-keys/${id}`, { method: "DELETE" }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["api-keys", activeWorkspaceId] });
      setDeleteKey(null);
      toast.success("API key deleted");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const updateWorkspaceMutation = useMutation({
    mutationFn: (body: object) =>
      apiFetch(`/api/session/workspaces/${activeWorkspaceId}`, {
        method: "PATCH",
        body: JSON.stringify(body),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["workspaces"] });
      toast.success("Settings saved");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div className="mx-auto max-w-3xl px-8 py-7">
      {/* Header */}
      <div className="mb-6">
        <h1 className="text-[15px] font-semibold tracking-tight text-foreground">Settings</h1>
        <p className="mt-0.5 text-[12px] text-muted-foreground">Workspace configuration</p>
      </div>

      <div className="space-y-3.5">
        {/* ── Email Sending ── */}
        <div className="rounded-lg border border-border bg-card overflow-hidden">
          <SectionHeader
            icon={Mail}
            title="Email Sending"
            description="Resend API key and sender identity"
          />
          <div className="px-5 py-4">
            <form
              key={activeWorkspaceId ?? "none"}
              onSubmit={(e) => {
                e.preventDefault();
                if (!activeWorkspaceId) return;
                updateWorkspaceMutation.mutate({
                  resendApiKey: resendKeyRef.current!.value || undefined,
                  resendFromEmail: fromEmailRef.current!.value || null,
                  resendFromName: fromNameRef.current!.value || null,
                });
              }}
              className="space-y-3.5"
            >
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <Label>Resend API Key</Label>
                  {activeWorkspace?.resendFromEmail && (
                    <span className="text-[11px] text-emerald-400 font-medium">✓ Configured</span>
                  )}
                </div>
                <Input ref={resendKeyRef} type="password" placeholder="re_••••••••••••••••" />
                <p className="text-[11px] text-muted-foreground">
                  Enter a new key to update. Leave blank to use the platform default.
                </p>
              </div>
              <div className="grid grid-cols-2 gap-2.5">
                <div className="space-y-1.5">
                  <Label>From Email</Label>
                  <Input
                    ref={fromEmailRef}
                    type="email"
                    placeholder="hello@yourapp.com"
                    defaultValue={activeWorkspace?.resendFromEmail ?? ""}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>From Name</Label>
                  <Input
                    ref={fromNameRef}
                    placeholder="Your App"
                    defaultValue={activeWorkspace?.resendFromName ?? ""}
                  />
                </div>
              </div>
              <Button type="submit" size="sm" disabled={updateWorkspaceMutation.isPending}>
                {updateWorkspaceMutation.isPending ? "Saving…" : "Save Settings"}
              </Button>
            </form>
          </div>
        </div>

        {/* ── Sending Domain ── */}
        {activeWorkspaceId && (
          <div className="rounded-lg border border-border bg-card overflow-hidden">
            <SectionHeader
              icon={Globe}
              title="Sending Domain"
              description="Connect and verify a custom domain for sending emails"
            />
            <SendingDomainPanel
              workspaceId={activeWorkspaceId}
              activeWorkspace={activeWorkspace}
            />
          </div>
        )}

        {/* ── API Keys ── */}
        <div className="rounded-lg border border-border bg-card overflow-hidden">
          <SectionHeader
            icon={Code2}
            title="API Keys"
            description="Authenticate API and MCP server requests with a workspace key"
          />
          <div className="px-5 py-4">
            {/* New key reveal banner */}
            {createdKey && (
              <div className="mb-4 rounded-lg border border-emerald-500/20 bg-emerald-500/8 p-3.5 animate-in fade-in slide-in-from-top-1 duration-150">
                <div className="mb-2 flex items-center justify-between">
                  <p className="text-[12px] font-medium text-emerald-400">
                    Copy this key now — it won&apos;t be shown again
                  </p>
                  <button
                    onClick={() => setCreatedKey(null)}
                    className="rounded p-0.5 text-emerald-500/60 transition-colors hover:bg-emerald-500/10 hover:text-emerald-400 cursor-pointer"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                </div>
                <div className="flex items-center gap-2">
                  <code className="flex-1 truncate rounded border border-emerald-500/20 bg-background px-2.5 py-1.5 font-mono text-[12px] text-emerald-300">
                    {createdKey}
                  </code>
                  <CopyButton value={createdKey} />
                </div>
              </div>
            )}

            {/* Key list */}
            <div className="mb-4">
              {keysLoading && (
                <div className="space-y-px">
                  {Array.from({ length: 2 }).map((_, i) => (
                    <div
                      key={i}
                      className="flex items-center gap-3 py-2.5 border-b border-border/40 last:border-0"
                    >
                      <div className="h-4 w-4 rounded shimmer" />
                      <div className="flex-1 space-y-1.5">
                        <div className="h-3 w-24 rounded shimmer" />
                        <div className="h-2.5 w-48 rounded shimmer" />
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {!keysLoading && apiKeys.length === 0 && (
                <p className="py-1.5 text-[13px] text-muted-foreground">
                  No API keys yet — create one to use the API or MCP server
                </p>
              )}

              {!keysLoading &&
                apiKeys.map((key, i) => (
                  <div
                    key={key.id}
                    className={`group flex items-center gap-3 py-2.5 transition-colors duration-100 ${
                      i < apiKeys.length - 1 ? "border-b border-border/40" : ""
                    }`}
                  >
                    <Key className="h-3.5 w-3.5 shrink-0 text-muted-foreground/40" />
                    <div className="min-w-0 flex-1">
                      <p className="text-[13px] font-medium text-foreground/90">{key.name}</p>
                      <p className="font-mono text-[11px] text-muted-foreground">
                        {key.keyPrefix}••••••••••••{" "}
                        <span className="font-sans text-muted-foreground/50">·</span>{" "}
                        {format(new Date(key.createdAt), "MMM d, yyyy")}
                      </p>
                    </div>
                    <button
                      onClick={() => setDeleteKey(key)}
                      className="shrink-0 rounded p-1.5 text-muted-foreground/30 opacity-0 transition-all duration-100 hover:bg-destructive/10 hover:text-destructive group-hover:opacity-100 cursor-pointer"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                ))}
            </div>

            {/* Create key form */}
            <form
              onSubmit={(e) => {
                e.preventDefault();
                if (newKeyName) createKeyMutation.mutate(newKeyName);
              }}
              className="flex gap-2"
            >
              <Input
                value={newKeyName}
                onChange={(e) => setNewKeyName(e.target.value)}
                placeholder="Key name (e.g. Production)"
                className="flex-1"
              />
              <Button
                type="submit"
                size="sm"
                disabled={!newKeyName || createKeyMutation.isPending}
              >
                <Plus className="h-3.5 w-3.5" />
                {createKeyMutation.isPending ? "Creating…" : "Create"}
              </Button>
            </form>
          </div>
        </div>
      </div>

      {/* Delete API key confirm */}
      <AlertDialog open={!!deleteKey} onOpenChange={(o) => !o && setDeleteKey(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Revoke API key?</AlertDialogTitle>
            <AlertDialogDescription>
              <strong className="text-foreground font-medium">{deleteKey?.name}</strong> (
              {deleteKey?.keyPrefix}••••) will be permanently revoked. Any services using this key
              will stop working immediately.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={deleteKeyMutation.isPending}
              onClick={() => deleteKey && deleteKeyMutation.mutate(deleteKey.id)}
            >
              {deleteKeyMutation.isPending ? "Revoking…" : "Revoke key"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
