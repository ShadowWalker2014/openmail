import { useQuery } from "@tanstack/react-query";
import { apiFetch } from "@/lib/api";
import { useWorkspaceStore } from "@/store/workspace";
import { useEffect } from "react";

export interface DomainRecord {
  record: string;
  name: string;
  type: string;
  ttl: string;
  status: string;
  value: string;
  priority?: number;
}

export interface Workspace {
  id: string;
  name: string;
  slug: string;
  plan: string;
  resendFromEmail: string | null;
  resendFromName: string | null;
  resendDomainName: string | null;
  resendDomainStatus: string | null;
  resendDomainRecords: DomainRecord[] | null;
}

interface UseWorkspacesOptions {
  /** Disable the query (e.g. while the auth session is still loading) */
  enabled?: boolean;
}

export function useWorkspaces({ enabled = true }: UseWorkspacesOptions = {}) {
  const { activeWorkspaceId, setActiveWorkspaceId } = useWorkspaceStore();

  const query = useQuery<Workspace[]>({
    queryKey: ["workspaces"],
    queryFn: () => apiFetch("/api/session/workspaces"),
    enabled,
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
    isError: query.isError,
    error: query.error,
    activeWorkspace: query.data?.find((w) => w.id === activeWorkspaceId),
  };
}
