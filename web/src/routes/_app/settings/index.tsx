import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { sessionFetch, apiFetch } from "@/lib/api";
import { useWorkspaceStore } from "@/store/workspace";
import { useWorkspaces } from "@/hooks/use-workspaces";
import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  AlertDialog, AlertDialogContent, AlertDialogHeader, AlertDialogTitle,
  AlertDialogDescription, AlertDialogFooter, AlertDialogAction, AlertDialogCancel,
} from "@/components/ui/alert-dialog";
import { Copy, Check, Plus, Trash2, Key, Mail, Code2, X } from "lucide-react";
import { toast } from "sonner";
import { format } from "date-fns";

export const Route = createFileRoute("/_app/settings/")({ component: SettingsPage });

interface ApiKey {
  id: string;
  name: string;
  keyPrefix: string;
  lastUsedAt: string | null;
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
        <h1 className="text-[15px] font-semibold tracking-tight text-foreground">
          Settings
        </h1>
        <p className="mt-0.5 text-[12px] text-muted-foreground">
          Workspace configuration
        </p>
      </div>

      <div className="space-y-3.5">
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

      {/* Delete confirm */}
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
    </div>
  );
}
