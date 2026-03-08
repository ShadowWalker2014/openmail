import { useShape } from "@electric-sql/react";
import { useWorkspaceStore } from "@/store/workspace";

const API_URL = import.meta.env.VITE_API_URL ?? "";

/**
 * Subscribe to a real-time ElectricSQL shape scoped to the active workspace.
 * The API proxy handles workspace_id filtering and Electric auth server-side.
 * Extra params (columns, etc.) are appended directly to the URL.
 */
export function useWorkspaceShape<T>(
  table: string,
  options?: { columns?: string[]; enabled?: boolean }
) {
  const { activeWorkspaceId } = useWorkspaceStore();
  const enabled = options?.enabled !== false && !!activeWorkspaceId;

  let shapeUrl = enabled
    ? `${API_URL}/api/session/ws/${activeWorkspaceId}/shapes/${table}`
    : "";

  if (enabled && options?.columns?.length) {
    shapeUrl += `?columns=${options.columns.join(",")}`;
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const result = useShape({ url: shapeUrl } as any);

  return {
    ...result,
    data: (result.data ?? []) as T[],
    isLoading: result.isLoading as boolean,
  };
}
