import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { sessionFetch, apiFetch } from "@/lib/api";
import { useWorkspaceStore } from "@/store/workspace";
import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Copy, Plus, Trash2, Key, Mail, Code2 } from "lucide-react";
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

function Section({
  icon: Icon,
  title,
  description,
  children,
}: {
  icon: React.ElementType;
  title: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-lg border bg-background">
      <div className="flex items-center gap-3 border-b px-5 py-4">
        <div className="flex h-8 w-8 items-center justify-center rounded-md bg-muted/60">
          <Icon className="h-4 w-4 text-muted-foreground" />
        </div>
        <div>
          <h2 className="text-sm font-medium">{title}</h2>
          {description && (
            <p className="text-xs text-muted-foreground">{description}</p>
          )}
        </div>
      </div>
      <div className="px-5 py-5">{children}</div>
    </div>
  );
}

function SettingsPage() {
  const { activeWorkspaceId } = useWorkspaceStore();
  const qc = useQueryClient();
  const [newKeyName, setNewKeyName] = useState("");
  const [createdKey, setCreatedKey] = useState<string | null>(null);
  const resendKeyRef = useRef<HTMLInputElement>(null);
  const fromEmailRef = useRef<HTMLInputElement>(null);
  const fromNameRef = useRef<HTMLInputElement>(null);

  const { data: apiKeys = [] } = useQuery<ApiKey[]>({
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
      toast.success("API key created — copy it now!");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const deleteKeyMutation = useMutation({
    mutationFn: (id: string) =>
      sessionFetch(activeWorkspaceId!, `/api-keys/${id}`, {
        method: "DELETE",
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["api-keys", activeWorkspaceId] });
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
    <div className="mx-auto max-w-3xl px-8 py-8">
      {/* Header */}
      <div className="mb-7">
        <h1 className="text-lg font-semibold tracking-tight">Settings</h1>
        <p className="mt-0.5 text-sm text-muted-foreground">
          Workspace configuration
        </p>
      </div>

      <div className="space-y-4">
        {/* Email Settings */}
        <Section
          icon={Mail}
          title="Email Sending"
          description="Configure your Resend account for sending emails"
        >
          <form
            onSubmit={(e) => {
              e.preventDefault();
              updateWorkspaceMutation.mutate({
                resendApiKey: resendKeyRef.current!.value || undefined,
                resendFromEmail: fromEmailRef.current!.value || undefined,
                resendFromName: fromNameRef.current!.value || undefined,
              });
            }}
            className="space-y-4"
          >
            <div className="space-y-1.5">
              <Label>Resend API Key</Label>
              <Input
                ref={resendKeyRef}
                type="password"
                placeholder="re_..."
              />
              <p className="text-xs text-muted-foreground">
                Your workspace Resend API key. Leave blank to use platform
                default.
              </p>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>From Email</Label>
                <Input
                  ref={fromEmailRef}
                  type="email"
                  placeholder="hello@yourapp.com"
                />
              </div>
              <div className="space-y-1.5">
                <Label>From Name</Label>
                <Input ref={fromNameRef} placeholder="Your App" />
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
        </Section>

        {/* API Keys */}
        <Section
          icon={Code2}
          title="API Keys"
          description="Authenticate API and MCP server requests"
        >
          {createdKey && (
            <div className="mb-5 rounded-lg border border-emerald-200 bg-emerald-50 p-3.5">
              <p className="mb-2 text-xs font-medium text-emerald-800">
                New key created — copy it now, it won&apos;t be shown again:
              </p>
              <div className="flex items-center gap-2">
                <code className="flex-1 truncate rounded border bg-white px-2.5 py-1.5 font-mono text-xs">
                  {createdKey}
                </code>
                <button
                  onClick={() => {
                    navigator.clipboard.writeText(createdKey);
                    toast.success("Copied!");
                  }}
                  className="shrink-0 rounded p-1.5 text-emerald-700 transition-colors hover:bg-emerald-100 cursor-pointer"
                >
                  <Copy className="h-4 w-4" />
                </button>
              </div>
            </div>
          )}

          <div className="mb-4 space-y-0">
            {apiKeys.map((key, i) => (
              <div
                key={key.id}
                className={`group flex items-center gap-3 py-3 transition-colors duration-150 ${i < apiKeys.length - 1 ? "border-b" : ""}`}
              >
                <Key className="h-4 w-4 shrink-0 text-muted-foreground/60" />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium">{key.name}</p>
                  <p className="font-mono text-xs text-muted-foreground">
                    {key.keyPrefix}•••••••••••• ·{" "}
                    {format(new Date(key.createdAt), "MMM d, yyyy")}
                  </p>
                </div>
                <button
                  onClick={() => deleteKeyMutation.mutate(key.id)}
                  className="shrink-0 rounded p-1.5 text-muted-foreground/40 opacity-0 transition-all duration-150 hover:bg-destructive/10 hover:text-destructive group-hover:opacity-100 focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-ring cursor-pointer"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            ))}
            {apiKeys.length === 0 && (
              <p className="py-2 text-sm text-muted-foreground">
                No API keys yet
              </p>
            )}
          </div>

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
              <Plus className="h-4 w-4" />
              Create
            </Button>
          </form>
        </Section>
      </div>
    </div>
  );
}
