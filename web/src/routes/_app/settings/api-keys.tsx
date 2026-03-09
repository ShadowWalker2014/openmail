import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { sessionFetch } from "@/lib/api";
import { useWorkspaceStore } from "@/store/workspace";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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
import { Code2, Key, Plus, Trash2, X } from "lucide-react";
import { toast } from "sonner";
import { format } from "date-fns";
import { SectionCard, SectionHeader, CopyButton, type ApiKey } from "@/components/settings/shared";

export const Route = createFileRoute("/_app/settings/api-keys")({
  component: ApiKeysSettingsPage,
});

function ApiKeysSettingsPage() {
  const { activeWorkspaceId } = useWorkspaceStore();
  const qc = useQueryClient();

  const [newKeyName, setNewKeyName] = useState("");
  const [createdKey, setCreatedKey] = useState<string | null>(null);
  const [deleteKey, setDeleteKey] = useState<ApiKey | null>(null);

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

  return (
    <>
      <SectionCard>
        <SectionHeader
          icon={Code2}
          title="API Keys"
          description="Authenticate API and MCP server requests with a workspace key"
        />
        <div className="px-5 py-4">
          {createdKey && (
            <div className="mb-4 rounded-lg border border-emerald-500/20 bg-emerald-500/8 p-3.5 animate-in fade-in slide-in-from-top-1 duration-150">
              <div className="mb-2 flex items-center justify-between">
                <p className="text-[12px] font-medium text-emerald-400">Copy this key now — it won&apos;t be shown again</p>
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
              <p className="py-1.5 text-[13px] text-muted-foreground">
                No API keys yet — create one to use the API or MCP server
              </p>
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
            <Input
              value={newKeyName}
              onChange={(e) => setNewKeyName(e.target.value)}
              placeholder="Key name (e.g. Production)"
              className="flex-1"
            />
            <Button type="submit" size="sm" disabled={!newKeyName || createKeyMutation.isPending}>
              <Plus className="h-3.5 w-3.5" />
              {createKeyMutation.isPending ? "Creating…" : "Create"}
            </Button>
          </form>
        </div>
      </SectionCard>

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
            <AlertDialogAction
              disabled={deleteKeyMutation.isPending}
              onClick={() => deleteKey && deleteKeyMutation.mutate(deleteKey.id)}
            >
              {deleteKeyMutation.isPending ? "Revoking…" : "Revoke key"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
