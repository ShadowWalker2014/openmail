import { createFileRoute, useRouter } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { sessionFetch, apiFetch } from "@/lib/api";
import { useWorkspaceStore } from "@/store/workspace";
import { useWorkspaces } from "@/hooks/use-workspaces";
import type { DomainRecord } from "@/hooks/use-workspaces";
import { authClient, useSession } from "@/lib/auth-client";
import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
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
  Building2,
  Users,
  User,
  LogOut,
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

interface Member {
  id: string;
  userId: string;
  userName: string;
  userEmail: string;
  role: "owner" | "admin" | "member";
  createdAt: string;
}

interface Invite {
  id: string;
  email: string;
  role: "admin" | "member";
  expiresAt: string;
  createdAt: string;
}

interface DomainResponse {
  id: string;
  name: string;
  status: string;
  records: DomainRecord[];
}

// ── Shared helpers ─────────────────────────────────────────────────────────────

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
      className="shrink-0 rounded p-1.5 text-emerald-500/70 transition-colors hover:bg-emerald-500/10 hover:text-emerald-400 cursor-pointer"
      title={copied ? "Copied!" : "Copy"}
    >
      {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
    </button>
  );
}

function RoleBadge({ role }: { role: "owner" | "admin" | "member" }) {
  const styles = {
    owner: "bg-amber-500/15 text-amber-400",
    admin: "bg-violet-500/15 text-violet-400",
    member: "bg-muted text-muted-foreground",
  };
  return (
    <span className={`inline-flex items-center rounded px-1.5 py-0.5 text-[11px] font-medium ${styles[role]}`}>
      {role}
    </span>
  );
}

function AvatarInitial({ name }: { name: string }) {
  const initial = name?.charAt(0)?.toUpperCase() ?? "?";
  return (
    <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-muted border border-border text-[11px] font-semibold text-foreground/80">
      {initial}
    </div>
  );
}

// ── Domain components (from sending domain feature) ────────────────────────────

function DomainStatusBadge({ status }: { status: string }) {
  const configs: Record<string, { label: string; icon: React.ElementType; cls: string }> = {
    verified: { label: "Verified", icon: CheckCircle2, cls: "bg-emerald-500/10 text-emerald-400 border-emerald-500/20" },
    pending: { label: "Verifying…", icon: Clock, cls: "bg-amber-500/10 text-amber-400 border-amber-500/20" },
    not_started: { label: "Not verified", icon: AlertTriangle, cls: "bg-muted/60 text-muted-foreground border-border" },
    failed: { label: "Failed", icon: XCircle, cls: "bg-destructive/10 text-destructive border-destructive/20" },
    temporary_failure: { label: "Temp failure", icon: XCircle, cls: "bg-destructive/10 text-destructive border-destructive/20" },
  };
  const cfg = configs[status] ?? configs.not_started;
  const Icon = cfg.icon;
  return (
    <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-medium ${cfg.cls}`}>
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
    mutationFn: () => sessionFetch(workspaceId, "/domains", { method: "DELETE" }),
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
          <div className="space-y-3">
            <p className="text-[12px] text-muted-foreground">
              Connect a custom sending domain (e.g.{" "}
              <code className="rounded bg-muted px-1 py-px font-mono text-[11px]">mail.yourapp.com</code>
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
              <Button type="submit" size="sm" disabled={!domainInput || connectMutation.isPending}>
                {connectMutation.isPending ? "Connecting…" : "Connect Domain"}
              </Button>
            </form>
          </div>
        ) : (
          <div className="space-y-4">
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
                  <Button size="sm" variant="outline" onClick={() => verifyMutation.mutate()} disabled={verifyMutation.isPending} className="h-7 text-[11px]">
                    {verifyMutation.isPending ? "Requesting…" : "Verify Now"}
                  </Button>
                )}
                {status === "pending" && (
                  <Button size="sm" variant="outline" onClick={() => refreshMutation.mutate()} disabled={refreshMutation.isPending} className="h-7 text-[11px] gap-1.5">
                    <RefreshCw className={`h-3 w-3 ${refreshMutation.isPending ? "animate-spin" : ""}`} />
                    Check Status
                  </Button>
                )}
                {status === "verified" && (
                  <Button size="sm" variant="outline" onClick={() => refreshMutation.mutate()} disabled={refreshMutation.isPending} className="h-7 text-[11px] gap-1.5">
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

            {status === "verified" && (
              <div className="flex items-center gap-2 rounded-md border border-emerald-500/20 bg-emerald-500/8 px-3 py-2.5">
                <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-emerald-400" />
                <p className="text-[11px] text-emerald-300">
                  Your sending domain is active. Set your From Email to{" "}
                  <code className="font-mono">you@{activeWorkspace.resendDomainName}</code> to start sending.
                </p>
              </div>
            )}
            {status === "pending" && (
              <div className="flex items-center gap-2 rounded-md border border-amber-500/20 bg-amber-500/8 px-3 py-2.5">
                <Clock className="h-3.5 w-3.5 shrink-0 text-amber-400" />
                <p className="text-[11px] text-amber-300">
                  Verification in progress. DNS propagation can take up to 72 hours. Click &quot;Check Status&quot; to refresh.
                </p>
              </div>
            )}
            {(status === "failed" || status === "temporary_failure") && (
              <div className="flex items-center gap-2 rounded-md border border-destructive/20 bg-destructive/8 px-3 py-2.5">
                <XCircle className="h-3.5 w-3.5 shrink-0 text-destructive" />
                <p className="text-[11px] text-destructive">
                  Verification failed. Check your DNS records below are correct, then click &quot;Verify Now&quot; to retry.
                </p>
              </div>
            )}

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
                    <span className="text-[11px] text-muted-foreground/60">Add these to your DNS provider</span>
                  )}
                </div>

                {(showRecords || status === "not_started" || status === "failed" || status === "temporary_failure") && (
                  <div className="rounded-md border border-border overflow-hidden">
                    <div className="grid grid-cols-[56px_1fr_2fr_auto] gap-3 border-b border-border bg-muted/40 px-3 py-2">
                      <span className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">Type</span>
                      <span className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">Name</span>
                      <span className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">Value</span>
                      <span className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">St.</span>
                    </div>
                    {records.map((rec, i) => (
                      <div
                        key={i}
                        className={`grid grid-cols-[56px_1fr_2fr_auto] gap-3 px-3 py-2.5 items-start ${i < records.length - 1 ? "border-b border-border/50" : ""}`}
                      >
                        <span className="font-mono text-[11px] text-muted-foreground font-medium">{rec.type}</span>
                        <div className="flex items-start gap-1 min-w-0">
                          <span className="font-mono text-[11px] text-foreground/80 truncate">{rec.name}</span>
                          <CopyButton value={rec.name} />
                        </div>
                        <div className="flex items-start gap-1 min-w-0">
                          <span className="font-mono text-[11px] text-foreground/70 break-all">
                            {rec.priority !== undefined ? `${rec.priority} ${rec.value}` : rec.value}
                          </span>
                          <CopyButton value={rec.priority !== undefined ? `${rec.priority} ${rec.value}` : rec.value} />
                        </div>
                        <div className="flex items-center pt-px">
                          <RecordStatusDot status={rec.status} />
                        </div>
                      </div>
                    ))}
                    <div className="border-t border-border bg-muted/20 px-3 py-2">
                      <p className="text-[10px] text-muted-foreground">
                        Add all records to your DNS provider, then click &quot;Verify Now&quot;. DNS propagation may take up to 48–72 hours.{" "}
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
                )}
              </div>
            )}
          </div>
        )}
      </div>

      <AlertDialog open={confirmDisconnect} onOpenChange={setConfirmDisconnect}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Disconnect sending domain?</AlertDialogTitle>
            <AlertDialogDescription>
              <strong className="text-foreground font-medium">{activeWorkspace?.resendDomainName}</strong>{" "}
              will be removed from your Resend account and you will no longer be able to send emails from this domain until it is reconnected.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction disabled={disconnectMutation.isPending} onClick={() => disconnectMutation.mutate()}>
              {disconnectMutation.isPending ? "Disconnecting…" : "Disconnect"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

// ── Main Settings Page ─────────────────────────────────────────────────────────

function SettingsPage() {
  const router = useRouter();
  const { activeWorkspaceId, setActiveWorkspaceId } = useWorkspaceStore();
  const { activeWorkspace } = useWorkspaces();
  const { data: session } = useSession();
  const qc = useQueryClient();

  const [workspaceName, setWorkspaceName] = useState("");
  const [editingName, setEditingName] = useState(false);
  const [newKeyName, setNewKeyName] = useState("");
  const [createdKey, setCreatedKey] = useState<string | null>(null);
  const [deleteKey, setDeleteKey] = useState<ApiKey | null>(null);
  const resendKeyRef = useRef<HTMLInputElement>(null);
  const fromEmailRef = useRef<HTMLInputElement>(null);
  const fromNameRef = useRef<HTMLInputElement>(null);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<"admin" | "member">("member");
  const [removeMember, setRemoveMember] = useState<Member | null>(null);
  const [showLeave, setShowLeave] = useState(false);
  const [accountName, setAccountName] = useState(session?.user?.name ?? "");
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");

  const { data: apiKeys = [], isLoading: keysLoading } = useQuery<ApiKey[]>({
    queryKey: ["api-keys", activeWorkspaceId],
    queryFn: () => sessionFetch(activeWorkspaceId!, "/api-keys"),
    enabled: !!activeWorkspaceId,
  });

  const { data: members = [], isLoading: membersLoading } = useQuery<Member[]>({
    queryKey: ["members", activeWorkspaceId],
    queryFn: () => sessionFetch(activeWorkspaceId!, "/members"),
    enabled: !!activeWorkspaceId,
  });

  const { data: invites = [], isLoading: invitesLoading } = useQuery<Invite[]>({
    queryKey: ["invites", activeWorkspaceId],
    queryFn: () => sessionFetch(activeWorkspaceId!, "/invites"),
    enabled: !!activeWorkspaceId,
  });

  const currentMember = members.find((m) => m.userId === session?.user?.id);
  const currentUserRole = currentMember?.role;
  const canManageMembers = currentUserRole === "owner" || currentUserRole === "admin";

  const updateWorkspaceMutation = useMutation({
    mutationFn: (body: object) =>
      apiFetch(`/api/session/workspaces/${activeWorkspaceId}`, {
        method: "PATCH",
        body: JSON.stringify(body),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["workspaces"] });
      toast.success("Settings saved");
      setEditingName(false);
    },
    onError: (e: Error) => toast.error(e.message),
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

  const removeMemberMutation = useMutation({
    mutationFn: (memberId: string) =>
      sessionFetch(activeWorkspaceId!, `/members/${memberId}`, { method: "DELETE" }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["members", activeWorkspaceId] });
      setRemoveMember(null);
      toast.success("Member removed");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const sendInviteMutation = useMutation({
    mutationFn: ({ email, role }: { email: string; role: string }) =>
      sessionFetch(activeWorkspaceId!, "/invites", {
        method: "POST",
        body: JSON.stringify({ email, role }),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["invites", activeWorkspaceId] });
      setInviteEmail("");
      setInviteRole("member");
      toast.success("Invite sent");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const cancelInviteMutation = useMutation({
    mutationFn: (inviteId: string) =>
      sessionFetch(activeWorkspaceId!, `/invites/${inviteId}`, { method: "DELETE" }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["invites", activeWorkspaceId] });
      toast.success("Invite cancelled");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const updateAccountNameMutation = useMutation({
    mutationFn: (name: string) => authClient.updateUser({ name }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["session"] });
      toast.success("Name updated");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const changePasswordMutation = useMutation({
    mutationFn: ({ currentPassword: cp, newPassword: np }: { currentPassword: string; newPassword: string }) =>
      authClient.changePassword({ currentPassword: cp, newPassword: np, revokeOtherSessions: false }),
    onSuccess: () => {
      setCurrentPassword("");
      setNewPassword("");
      toast.success("Password changed");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const leaveWorkspaceMutation = useMutation({
    mutationFn: () =>
      sessionFetch(activeWorkspaceId!, `/members/${currentMember!.id}`, { method: "DELETE" }),
    onSuccess: () => {
      setActiveWorkspaceId(null);
      qc.invalidateQueries({ queryKey: ["workspaces"] });
      router.navigate({ to: "/dashboard" });
      toast.success("Left workspace");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div className="mx-auto max-w-2xl px-8 py-7">
      <div className="mb-6">
        <h1 className="text-[15px] font-semibold tracking-tight text-foreground">Settings</h1>
        <p className="mt-0.5 text-[12px] text-muted-foreground">Workspace configuration</p>
      </div>

      <div className="space-y-3.5">
        {/* ── Workspace ── */}
        <div className="rounded-lg border border-border bg-card overflow-hidden">
          <SectionHeader icon={Building2} title="Workspace" description="Manage your workspace settings" />
          <div className="px-5 py-4">
            <div className="space-y-1.5">
              <Label>Workspace Name</Label>
              <div className="flex gap-2">
                <Input
                  value={editingName ? workspaceName : (activeWorkspace?.name ?? "")}
                  onChange={(e) => { setEditingName(true); setWorkspaceName(e.target.value); }}
                  onFocus={() => { if (!editingName) { setWorkspaceName(activeWorkspace?.name ?? ""); setEditingName(true); } }}
                  placeholder="My Workspace"
                  className="flex-1"
                />
                <Button
                  size="sm"
                  disabled={!editingName || !workspaceName.trim() || updateWorkspaceMutation.isPending}
                  onClick={() => { if (workspaceName.trim()) updateWorkspaceMutation.mutate({ name: workspaceName.trim() }); }}
                >
                  {updateWorkspaceMutation.isPending ? "Saving…" : "Save"}
                </Button>
              </div>
            </div>
          </div>
        </div>

        {/* ── Team Members ── */}
        <div className="rounded-lg border border-border bg-card overflow-hidden">
          <SectionHeader icon={Users} title="Team Members" description="Manage who has access to this workspace" />
          <div className="px-5 py-4 space-y-5">
            <div>
              {membersLoading && (
                <div className="space-y-px">
                  {Array.from({ length: 3 }).map((_, i) => (
                    <div key={i} className="flex items-center gap-3 py-2.5 border-b border-border/40 last:border-0">
                      <div className="h-7 w-7 rounded-full shimmer" />
                      <div className="flex-1 space-y-1.5">
                        <div className="h-3 w-28 rounded shimmer" />
                        <div className="h-2.5 w-40 rounded shimmer" />
                      </div>
                      <div className="h-5 w-14 rounded shimmer" />
                    </div>
                  ))}
                </div>
              )}
              {!membersLoading && members.map((member, i) => {
                const canRemove = canManageMembers && member.role !== "owner" && member.userId !== session?.user?.id;
                return (
                  <div
                    key={member.id}
                    className={`group flex items-center gap-3 py-2.5 ${i < members.length - 1 ? "border-b border-border/40" : ""}`}
                  >
                    <AvatarInitial name={member.userName} />
                    <div className="min-w-0 flex-1">
                      <p className="text-[13px] font-medium text-foreground/90 truncate">
                        {member.userName}
                        {member.userId === session?.user?.id && (
                          <span className="ml-1.5 text-[11px] text-muted-foreground font-normal">(you)</span>
                        )}
                      </p>
                      <p className="text-[11px] text-muted-foreground truncate">{member.userEmail}</p>
                    </div>
                    <RoleBadge role={member.role} />
                    {canRemove && (
                      <button
                        onClick={() => setRemoveMember(member)}
                        className="shrink-0 rounded p-1.5 text-muted-foreground/30 opacity-0 transition-all duration-100 hover:bg-destructive/10 hover:text-destructive group-hover:opacity-100 cursor-pointer"
                      >
                        <X className="h-3.5 w-3.5" />
                      </button>
                    )}
                  </div>
                );
              })}
            </div>

            <div>
              <p className="mb-2 text-[12px] font-medium text-foreground/70">Pending Invites</p>
              {invitesLoading && (
                <div className="space-y-px">
                  {Array.from({ length: 2 }).map((_, i) => (
                    <div key={i} className="flex items-center gap-3 py-2 border-b border-border/40 last:border-0">
                      <div className="h-2.5 w-40 rounded shimmer" />
                      <div className="h-5 w-12 rounded shimmer ml-auto" />
                    </div>
                  ))}
                </div>
              )}
              {!invitesLoading && invites.length === 0 && (
                <p className="text-[12px] text-muted-foreground">No pending invites</p>
              )}
              {!invitesLoading && invites.map((invite, i) => (
                <div
                  key={invite.id}
                  className={`group flex items-center gap-3 py-2 ${i < invites.length - 1 ? "border-b border-border/40" : ""}`}
                >
                  <div className="min-w-0 flex-1">
                    <p className="text-[13px] text-foreground/80 truncate">{invite.email}</p>
                    <p className="text-[11px] text-muted-foreground">Expires {format(new Date(invite.expiresAt), "MMM d, yyyy")}</p>
                  </div>
                  <RoleBadge role={invite.role} />
                  {canManageMembers && (
                    <button
                      onClick={() => cancelInviteMutation.mutate(invite.id)}
                      disabled={cancelInviteMutation.isPending}
                      className="shrink-0 rounded p-1.5 text-muted-foreground/30 opacity-0 transition-all duration-100 hover:bg-destructive/10 hover:text-destructive group-hover:opacity-100 cursor-pointer disabled:cursor-not-allowed"
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  )}
                </div>
              ))}
            </div>

            {canManageMembers && (
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  if (inviteEmail) sendInviteMutation.mutate({ email: inviteEmail, role: inviteRole });
                }}
                className="flex gap-2"
              >
                <Input
                  type="email"
                  value={inviteEmail}
                  onChange={(e) => setInviteEmail(e.target.value)}
                  placeholder="colleague@company.com"
                  className="flex-1"
                />
                <Select value={inviteRole} onValueChange={(v) => setInviteRole(v as "admin" | "member")}>
                  <SelectTrigger className="w-28">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="member">Member</SelectItem>
                    <SelectItem value="admin">Admin</SelectItem>
                  </SelectContent>
                </Select>
                <Button type="submit" size="sm" disabled={!inviteEmail || sendInviteMutation.isPending}>
                  <Plus className="h-3.5 w-3.5" />
                  {sendInviteMutation.isPending ? "Sending…" : "Send Invite"}
                </Button>
              </form>
            )}
          </div>
        </div>

        {/* ── Email Sending ── */}
        <div className="rounded-lg border border-border bg-card overflow-hidden">
          <SectionHeader icon={Mail} title="Email Sending" description="Resend API key and sender identity" />
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
                  <Input ref={fromEmailRef} type="email" placeholder="hello@yourapp.com" defaultValue={activeWorkspace?.resendFromEmail ?? ""} />
                </div>
                <div className="space-y-1.5">
                  <Label>From Name</Label>
                  <Input ref={fromNameRef} placeholder="Your App" defaultValue={activeWorkspace?.resendFromName ?? ""} />
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
            <SectionHeader icon={Globe} title="Sending Domain" description="Connect and verify a custom domain for sending emails" />
            <SendingDomainPanel workspaceId={activeWorkspaceId} activeWorkspace={activeWorkspace} />
          </div>
        )}

        {/* ── Account ── */}
        <div className="rounded-lg border border-border bg-card overflow-hidden">
          <SectionHeader icon={User} title="Account" description="Manage your personal account settings" />
          <div className="px-5 py-4 space-y-5">
            <div className="space-y-3">
              <p className="text-[12px] font-medium text-foreground/70">Profile</p>
              <div className="space-y-1.5">
                <Label>Display Name</Label>
                <Input value={accountName} onChange={(e) => setAccountName(e.target.value)} placeholder="Your name" />
              </div>
              <Button
                size="sm"
                disabled={!accountName.trim() || updateAccountNameMutation.isPending}
                onClick={() => { if (accountName.trim()) updateAccountNameMutation.mutate(accountName.trim()); }}
              >
                {updateAccountNameMutation.isPending ? "Saving…" : "Save Name"}
              </Button>
            </div>

            <div className="space-y-3 border-t border-border/60 pt-4">
              <p className="text-[12px] font-medium text-foreground/70">Change Password</p>
              <div className="grid grid-cols-2 gap-2.5">
                <div className="space-y-1.5">
                  <Label>Current Password</Label>
                  <Input type="password" placeholder="••••••••" value={currentPassword} onChange={(e) => setCurrentPassword(e.target.value)} />
                </div>
                <div className="space-y-1.5">
                  <Label>New Password</Label>
                  <Input type="password" placeholder="••••••••" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} minLength={8} />
                </div>
              </div>
              <Button
                size="sm"
                disabled={!currentPassword || !newPassword || changePasswordMutation.isPending}
                onClick={() => { if (currentPassword && newPassword) changePasswordMutation.mutate({ currentPassword, newPassword }); }}
              >
                {changePasswordMutation.isPending ? "Updating…" : "Change Password"}
              </Button>
            </div>

            {currentUserRole && currentUserRole !== "owner" && (
              <div className="border-t border-border/60 pt-4">
                <p className="text-[12px] font-medium text-foreground/70 mb-1">Danger Zone</p>
                <p className="text-[11px] text-muted-foreground mb-3">
                  Permanently leave this workspace. You'll lose access to all workspace data.
                </p>
                <Button size="sm" variant="destructive" onClick={() => setShowLeave(true)}>
                  <LogOut className="h-3.5 w-3.5" />
                  Leave Workspace
                </Button>
              </div>
            )}
          </div>
        </div>

        {/* ── API Keys ── */}
        <div className="rounded-lg border border-border bg-card overflow-hidden">
          <SectionHeader icon={Code2} title="API Keys" description="Authenticate API and MCP server requests with a workspace key" />
          <div className="px-5 py-4">
            {createdKey && (
              <div className="mb-4 rounded-lg border border-emerald-500/20 bg-emerald-500/8 p-3.5 animate-in fade-in slide-in-from-top-1 duration-150">
                <div className="mb-2 flex items-center justify-between">
                  <p className="text-[12px] font-medium text-emerald-400">Copy this key now — it won&apos;t be shown again</p>
                  <button onClick={() => setCreatedKey(null)} className="rounded p-0.5 text-emerald-500/60 transition-colors hover:bg-emerald-500/10 hover:text-emerald-400 cursor-pointer">
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

            <div className="mb-4">
              {keysLoading && (
                <div className="space-y-px">
                  {Array.from({ length: 2 }).map((_, i) => (
                    <div key={i} className="flex items-center gap-3 py-2.5 border-b border-border/40 last:border-0">
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
                <p className="py-1.5 text-[13px] text-muted-foreground">No API keys yet — create one to use the API or MCP server</p>
              )}
              {!keysLoading && apiKeys.map((key, i) => (
                <div
                  key={key.id}
                  className={`group flex items-center gap-3 py-2.5 transition-colors duration-100 ${i < apiKeys.length - 1 ? "border-b border-border/40" : ""}`}
                >
                  <Key className="h-3.5 w-3.5 shrink-0 text-muted-foreground/40" />
                  <div className="min-w-0 flex-1">
                    <p className="text-[13px] font-medium text-foreground/90">{key.name}</p>
                    <p className="font-mono text-[11px] text-muted-foreground">
                      {key.keyPrefix}•••••••••••• <span className="font-sans text-muted-foreground/50">·</span>{" "}
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

            <form
              onSubmit={(e) => {
                e.preventDefault();
                if (newKeyName) createKeyMutation.mutate(newKeyName);
              }}
              className="flex gap-2"
            >
              <Input value={newKeyName} onChange={(e) => setNewKeyName(e.target.value)} placeholder="Key name (e.g. Production)" className="flex-1" />
              <Button type="submit" size="sm" disabled={!newKeyName || createKeyMutation.isPending}>
                <Plus className="h-3.5 w-3.5" />
                {createKeyMutation.isPending ? "Creating…" : "Create"}
              </Button>
            </form>
          </div>
        </div>
      </div>

      {/* Remove member confirm */}
      <AlertDialog open={!!removeMember} onOpenChange={(o) => !o && setRemoveMember(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove member?</AlertDialogTitle>
            <AlertDialogDescription>
              <strong className="text-foreground font-medium">{removeMember?.userName}</strong>{" "}
              ({removeMember?.userEmail}) will lose access to this workspace immediately.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction disabled={removeMemberMutation.isPending} onClick={() => removeMember && removeMemberMutation.mutate(removeMember.id)}>
              {removeMemberMutation.isPending ? "Removing…" : "Remove member"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Delete API key confirm */}
      <AlertDialog open={!!deleteKey} onOpenChange={(o) => !o && setDeleteKey(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Revoke API key?</AlertDialogTitle>
            <AlertDialogDescription>
              <strong className="text-foreground font-medium">{deleteKey?.name}</strong>{" "}
              ({deleteKey?.keyPrefix}••••) will be permanently revoked. Any services using this key will stop working immediately.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction disabled={deleteKeyMutation.isPending} onClick={() => deleteKey && deleteKeyMutation.mutate(deleteKey.id)}>
              {deleteKeyMutation.isPending ? "Revoking…" : "Revoke key"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Leave workspace confirm */}
      <AlertDialog open={showLeave} onOpenChange={setShowLeave}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Leave workspace?</AlertDialogTitle>
            <AlertDialogDescription>
              You will permanently lose access to{" "}
              <strong className="text-foreground font-medium">{activeWorkspace?.name}</strong>.
              You can only rejoin if an owner invites you again.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction disabled={leaveWorkspaceMutation.isPending} onClick={() => leaveWorkspaceMutation.mutate()}>
              {leaveWorkspaceMutation.isPending ? "Leaving…" : "Leave workspace"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
