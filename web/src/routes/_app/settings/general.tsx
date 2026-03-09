import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { apiFetch } from "@/lib/api";
import { useWorkspaceStore } from "@/store/workspace";
import { useWorkspaces } from "@/hooks/use-workspaces";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Building2 } from "lucide-react";
import { toast } from "sonner";
import { SectionCard, SectionHeader } from "@/components/settings/shared";

export const Route = createFileRoute("/_app/settings/general")({
  component: GeneralSettingsPage,
});

function GeneralSettingsPage() {
  const { activeWorkspaceId } = useWorkspaceStore();
  const { activeWorkspace } = useWorkspaces();
  const qc = useQueryClient();

  const [workspaceName, setWorkspaceName] = useState("");
  const [editingName, setEditingName] = useState(false);

  const updateMutation = useMutation({
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

  return (
    <SectionCard>
      <SectionHeader icon={Building2} title="General" description="Workspace name and basic settings" />
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
              disabled={!editingName || !workspaceName.trim() || updateMutation.isPending}
              onClick={() => { if (workspaceName.trim()) updateMutation.mutate({ name: workspaceName.trim() }); }}
            >
              {updateMutation.isPending ? "Saving…" : "Save"}
            </Button>
          </div>
        </div>
      </div>
    </SectionCard>
  );
}
