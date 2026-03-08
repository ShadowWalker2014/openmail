import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { sessionFetch, apiFetch } from "@/lib/api";
import { useWorkspaceStore } from "@/store/workspace";
import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Copy, Plus, Trash2, Key } from "lucide-react";
import { toast } from "sonner";

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
      toast.success("API key created");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const deleteKeyMutation = useMutation({
    mutationFn: (id: string) =>
      sessionFetch(activeWorkspaceId!, `/api-keys/${id}`, { method: "DELETE" }),
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
    <div className="p-8 max-w-3xl mx-auto space-y-8">
      <div>
        <h1 className="text-xl font-semibold">Settings</h1>
        <p className="text-sm text-muted-foreground mt-0.5">Workspace configuration</p>
      </div>

      {/* Email Settings */}
      <div className="bg-white rounded-xl border p-6">
        <h2 className="font-medium mb-4">Email Sending</h2>
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
            <Input ref={resendKeyRef} type="password" placeholder="re_..." />
            <p className="text-xs text-muted-foreground">
              Your workspace Resend API key. Leave blank to use platform default.
            </p>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label>From Email</Label>
              <Input ref={fromEmailRef} type="email" placeholder="hello@yourapp.com" />
            </div>
            <div className="space-y-1.5">
              <Label>From Name</Label>
              <Input ref={fromNameRef} placeholder="Your App" />
            </div>
          </div>
          <Button type="submit" size="sm" disabled={updateWorkspaceMutation.isPending}>
            {updateWorkspaceMutation.isPending ? "Saving..." : "Save Settings"}
          </Button>
        </form>
      </div>

      {/* API Keys */}
      <div className="bg-white rounded-xl border p-6">
        <h2 className="font-medium mb-4">API Keys</h2>
        <p className="text-sm text-muted-foreground mb-4">
          Use these keys to authenticate API and MCP server requests.
        </p>

        {createdKey && (
          <div className="mb-4 p-3 bg-green-50 border border-green-200 rounded-lg">
            <p className="text-sm font-medium text-green-800 mb-1">
              New key created — copy it now, it won&apos;t be shown again:
            </p>
            <div className="flex items-center gap-2">
              <code className="text-sm bg-white border rounded px-2 py-1 flex-1 truncate">
                {createdKey}
              </code>
              <button
                onClick={() => {
                  navigator.clipboard.writeText(createdKey);
                  toast.success("Copied!");
                }}
                className="p-1.5 hover:bg-green-100 rounded cursor-pointer"
              >
                <Copy className="w-4 h-4 text-green-700" />
              </button>
            </div>
          </div>
        )}

        <div className="space-y-2 mb-4">
          {apiKeys.map((key) => (
            <div
              key={key.id}
              className="flex items-center justify-between py-2 border-b last:border-0"
            >
              <div className="flex items-center gap-3">
                <Key className="w-4 h-4 text-muted-foreground" />
                <div>
                  <p className="text-sm font-medium">{key.name}</p>
                  <p className="text-xs text-muted-foreground">
                    {key.keyPrefix}... · Created {new Date(key.createdAt).toLocaleDateString()}
                  </p>
                </div>
              </div>
              <button
                onClick={() => deleteKeyMutation.mutate(key.id)}
                className="p-1.5 hover:bg-accent rounded text-muted-foreground hover:text-destructive cursor-pointer"
              >
                <Trash2 className="w-4 h-4" />
              </button>
            </div>
          ))}
          {apiKeys.length === 0 && (
            <p className="text-sm text-muted-foreground py-2">No API keys yet</p>
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
            <Plus className="w-4 h-4" />
            Create Key
          </Button>
        </form>
      </div>
    </div>
  );
}
