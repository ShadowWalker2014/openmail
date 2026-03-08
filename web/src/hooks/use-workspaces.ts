import { useQuery } from "@tanstack/react-query";
import { apiFetch } from "@/lib/api";
import { useWorkspaceStore } from "@/store/workspace";
import { useEffect } from "react";

interface Workspace {
  id: string;
  name: string;
  slug: string;
  plan: string;
  resendFromEmail: string | null;
  resendFromName: string | null;
}

export function useWorkspaces() {
  const { activeWorkspaceId, setActiveWorkspaceId } = useWorkspaceStore();

  const query = useQuery<Workspace[]>({
    queryKey: ["workspaces"],
    queryFn: () => apiFetch("/api/session/workspaces"),
  });

  useEffect(() => {
    if (!query.data || query.data.length === 0) return;

    // Auto-select if no active workspace OR if the stored ID is no longer valid
    const isValid = query.data.some((w) => w.id === activeWorkspaceId);
    if (!activeWorkspaceId || !isValid) {
      setActiveWorkspaceId(query.data[0].id);
    }
  }, [query.data, activeWorkspaceId, setActiveWorkspaceId]);

  return {
    workspaces: query.data,
    isLoading: query.isLoading,
    activeWorkspace: query.data?.find((w) => w.id === activeWorkspaceId),
  };
}
