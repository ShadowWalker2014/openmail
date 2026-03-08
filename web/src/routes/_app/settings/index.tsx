import { createFileRoute, useRouter } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { sessionFetch, apiFetch } from "@/lib/api";
import { useWorkspaceStore } from "@/store/workspace";
import { useWorkspaces } from "@/hooks/use-workspaces";
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
  ShieldCheck,
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
      {copied ? (
        <Check className="h-3.5 w-3.5" />
      ) : (
        <Copy className="h-3.5 w-3.5" />
      )}
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
    <span
      className={`inline-flex items-center rounded px-1.5 py-0.5 text-[11px] font-medium ${styles[role]}`}
    >
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

function SettingsPage() {
  const router = useRouter();
  const { activeWorkspaceId, setActiveWorkspaceId } = useWorkspaceStore();
  const { activeWorkspace } = useWorkspaces();
  const { data: session } = useSession();
  const qc = useQueryClient();

  // --- Workspace name ---
  const [workspaceName, setWorkspaceName] = useState("");
  const [editingName, setEditingName] = useState(false);

  // --- API keys ---
  const [newKeyName, setNewKeyName] = useState("");
  const [createdKey, setCreatedKey] = useState<string | null>(null);
  const [deleteKey, setDeleteKey] = useState<ApiKey | null>(null);

  // --- Email sending ---
  const resendKeyRef = useRef<HTMLInputElement>(null);
  const fromEmailRef = useRef<HTMLInputElement>(null);
  const fromNameRef = useRef<HTMLInputElement>(null);

  // --- Invites ---
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<"admin" | "member">("member");

  // --- Remove member confirm ---
  const [removeMember, setRemoveMember] = useState<Member | null>(null);

  // --- Leave workspace confirm ---
  const [showLeave, setShowLeave] = useState(false);

  // --- Account ---
  const [accountName, setAccountName] = useState(session?.user?.name ?? "");
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");

  // Queries
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

  // Mutations
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
    <div className="mx-auto max-w-3xl px-8 py-7">
      {/* Header */}
      <div className="mb-6">
        <h1 className="text-[15px] font-semibold tracking-tight text-foreground">
          Settings
        </h1>
        <p className="mt-0.5 text-[12px] text-muted-foreground">
          Workspace configuration
        </p>
      </div>

      <div className="space-y-3.5">
        {/* ── Workspace ── */}
        <div className="rounded-lg border border-border bg-card overflow-hidden">
          <SectionHeader
            icon={Building2}
            title="Workspace"
            description="Manage your workspace settings"
          />
          <div className="px-5 py-4">
            <div className="space-y-1.5">
              <Label>Workspace Name</Label>
              <div className="flex gap-2">
                <Input
                  value={editingName ? workspaceName : (activeWorkspace?.name ?? "")}
                  onChange={(e) => {
                    setEditingName(true);
                    setWorkspaceName(e.target.value);
                  }}
                  onFocus={() => {
                    if (!editingName) {
                      setWorkspaceName(activeWorkspace?.name ?? "");
                      setEditingName(true);
                    }
                  }}
                  placeholder="My Workspace"
                  className="flex-1"
                />
                <Button
                  size="sm"
                  disabled={!editingName || !workspaceName.trim() || updateWorkspaceMutation.isPending}
                  onClick={() => {
                    if (workspaceName.trim()) {
                      updateWorkspaceMutation.mutate({ name: workspaceName.trim() });
                    }
                  }}
                >
                  {updateWorkspaceMutation.isPending ? "Saving…" : "Save"}
                </Button>
              </div>
            </div>
          </div>
        </div>

        {/* ── Team Members ── */}
        <div className="rounded-lg border border-border bg-card overflow-hidden">
          <SectionHeader
            icon={Users}
            title="Team Members"
            description="Manage who has access to this workspace"
          />
          <div className="px-5 py-4 space-y-5">
            {/* Members list */}
            <div>
              {membersLoading && (
                <div className="space-y-px">
                  {Array.from({ length: 3 }).map((_, i) => (
                    <div
                      key={i}
                      className="flex items-center gap-3 py-2.5 border-b border-border/40 last:border-0"
                    >
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
              {!membersLoading &&
                members.map((member, i) => {
                  const canRemove =
                    canManageMembers &&
                    member.role !== "owner" &&
                    member.userId !== session?.user?.id;
                  return (
                    <div
                      key={member.id}
                      className={`group flex items-center gap-3 py-2.5 ${
                        i < members.length - 1 ? "border-b border-border/40" : ""
                      }`}
                    >
                      <AvatarInitial name={member.userName} />
                      <div className="min-w-0 flex-1">
                        <p className="text-[13px] font-medium text-foreground/90 truncate">
                          {member.userName}
                          {member.userId === session?.user?.id && (
                            <span className="ml-1.5 text-[11px] text-muted-foreground font-normal">(you)</span>
                          )}
                        </p>
                        <p className="text-[11px] text-muted-foreground truncate">
                          {member.userEmail}
                        </p>
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

            {/* Pending Invites */}
            <div>
              <p className="mb-2 text-[12px] font-medium text-foreground/70">
                Pending Invites
              </p>
              {invitesLoading && (
                <div className="space-y-px">
                  {Array.from({ length: 2 }).map((_, i) => (
                    <div
                      key={i}
                      className="flex items-center gap-3 py-2 border-b border-border/40 last:border-0"
                    >
                      <div className="h-2.5 w-40 rounded shimmer" />
                      <div className="h-5 w-12 rounded shimmer ml-auto" />
                    </div>
                  ))}
                </div>
              )}
              {!invitesLoading && invites.length === 0 && (
                <p className="text-[12px] text-muted-foreground">
                  No pending invites
                </p>
              )}
              {!invitesLoading &&
                invites.map((invite, i) => (
                  <div
                    key={invite.id}
                    className={`group flex items-center gap-3 py-2 ${
                      i < invites.length - 1 ? "border-b border-border/40" : ""
                    }`}
                  >
                    <div className="min-w-0 flex-1">
                      <p className="text-[13px] text-foreground/80 truncate">
                        {invite.email}
                      </p>
                      <p className="text-[11px] text-muted-foreground">
                        Expires {format(new Date(invite.expiresAt), "MMM d, yyyy")}
                      </p>
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

            {/* Invite form */}
            {canManageMembers && (
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  if (inviteEmail) {
                    sendInviteMutation.mutate({ email: inviteEmail, role: inviteRole });
                  }
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
                <Select
                  value={inviteRole}
                  onValueChange={(v) => setInviteRole(v as "admin" | "member")}
                >
                  <SelectTrigger className="w-28">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="member">Member</SelectItem>
                    <SelectItem value="admin">Admin</SelectItem>
                  </SelectContent>
                </Select>
                <Button
                  type="submit"
                  size="sm"
                  disabled={!inviteEmail || sendInviteMutation.isPending}
                >
                  <Plus className="h-3.5 w-3.5" />
                  {sendInviteMutation.isPending ? "Sending…" : "Send Invite"}
                </Button>
              </form>
            )}
          </div>
        </div>

        {/* ── Email Sending ── */}
        <div className="rounded-lg border border-border bg-card overflow-hidden">
          <SectionHeader
            icon={Mail}
            title="Email Sending"
            description="Configure your Resend account for sending emails"
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
                    <span className="text-[11px] text-emerald-400 font-medium">
                      ✓ Configured
                    </span>
                  )}
                </div>
                <Input
                  ref={resendKeyRef}
                  type="password"
                  placeholder="re_••••••••••••••••"
                />
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
              <Button
                type="submit"
                size="sm"
                disabled={updateWorkspaceMutation.isPending}
              >
                {updateWorkspaceMutation.isPending ? "Saving…" : "Save Settings"}
              </Button>
            </form>
          </div>
        </div>

        {/* ── Account ── */}
        <div className="rounded-lg border border-border bg-card overflow-hidden">
          <SectionHeader
            icon={User}
            title="Account"
            description="Manage your personal account settings"
          />
          <div className="px-5 py-4 space-y-5">
            {/* Update name */}
            <div className="space-y-3">
              <p className="text-[12px] font-medium text-foreground/70">Profile</p>
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  if (accountName.trim()) updateAccountNameMutation.mutate(accountName.trim());
                }}
                className="flex gap-2"
              >
                <div className="flex-1 space-y-1.5">
                  <Label>Display Name</Label>
                  <Input
                    value={accountName}
                    onChange={(e) => setAccountName(e.target.value)}
                    placeholder="Your name"
                  />
                </div>
              </form>
              <Button
                size="sm"
                disabled={!accountName.trim() || updateAccountNameMutation.isPending}
                onClick={() => {
                  if (accountName.trim()) updateAccountNameMutation.mutate(accountName.trim());
                }}
              >
                {updateAccountNameMutation.isPending ? "Saving…" : "Save Name"}
              </Button>
            </div>

            {/* Change password */}
            <div className="space-y-3 border-t border-border/60 pt-4">
              <p className="text-[12px] font-medium text-foreground/70">Change Password</p>
              <div className="grid grid-cols-2 gap-2.5">
                <div className="space-y-1.5">
                  <Label>Current Password</Label>
                  <Input
                    type="password"
                    placeholder="••••••••"
                    value={currentPassword}
                    onChange={(e) => setCurrentPassword(e.target.value)}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>New Password</Label>
                  <Input
                    type="password"
                    placeholder="••••••••"
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    minLength={8}
                  />
                </div>
              </div>
              <Button
                size="sm"
                disabled={!currentPassword || !newPassword || changePasswordMutation.isPending}
                onClick={() => {
                  if (currentPassword && newPassword) {
                    changePasswordMutation.mutate({ currentPassword, newPassword });
                  }
                }}
              >
                {changePasswordMutation.isPending ? "Updating…" : "Change Password"}
              </Button>
            </div>

            {/* Leave workspace */}
            {currentUserRole && currentUserRole !== "owner" && (
              <div className="border-t border-border/60 pt-4">
                <p className="text-[12px] font-medium text-foreground/70 mb-1">Danger Zone</p>
                <p className="text-[11px] text-muted-foreground mb-3">
                  Permanently leave this workspace. You'll lose access to all workspace data.
                </p>
                <Button
                  size="sm"
                  variant="destructive"
                  onClick={() => setShowLeave(true)}
                >
                  <LogOut className="h-3.5 w-3.5" />
                  Leave Workspace
                </Button>
              </div>
            )}
          </div>
        </div>

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
                      <p className="text-[13px] font-medium text-foreground/90">
                        {key.name}
                      </p>
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

      {/* Remove member confirm */}
      <AlertDialog
        open={!!removeMember}
        onOpenChange={(o) => !o && setRemoveMember(null)}
      >
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
            <AlertDialogAction
              disabled={removeMemberMutation.isPending}
              onClick={() => removeMember && removeMemberMutation.mutate(removeMember.id)}
            >
              {removeMemberMutation.isPending ? "Removing…" : "Remove member"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Delete API key confirm */}
      <AlertDialog
        open={!!deleteKey}
        onOpenChange={(o) => !o && setDeleteKey(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Revoke API key?</AlertDialogTitle>
            <AlertDialogDescription>
              <strong className="text-foreground font-medium">{deleteKey?.name}</strong>{" "}
              ({deleteKey?.keyPrefix}••••) will be permanently revoked. Any services
              using this key will stop working immediately.
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

      {/* Leave workspace confirm */}
      <AlertDialog open={showLeave} onOpenChange={setShowLeave}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Leave workspace?</AlertDialogTitle>
            <AlertDialogDescription>
              You will permanently lose access to{" "}
              <strong className="text-foreground font-medium">
                {activeWorkspace?.name}
              </strong>
              . You can only rejoin if an owner invites you again.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={leaveWorkspaceMutation.isPending}
              onClick={() => leaveWorkspaceMutation.mutate()}
            >
              {leaveWorkspaceMutation.isPending ? "Leaving…" : "Leave workspace"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
