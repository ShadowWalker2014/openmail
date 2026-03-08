import { useShape } from "@electric-sql/react";
import { useWorkspaceStore } from "@/store/workspace";

interface ShapeOptions {
  columns?: string[];
}

// Electric requires T to extend Record<string, unknown>
export function useWorkspaceShape<T extends Record<string, unknown>>(
  table: string,
  options?: ShapeOptions
) {
  const { activeWorkspaceId } = useWorkspaceStore();
  const apiUrl = import.meta.env.VITE_API_URL ?? "http://localhost:3001"; // pragma: allowlist secret

  // When no workspace is active, use a URL that will cleanly fail
  // rather than fetching the current page (url: "")
  const url = activeWorkspaceId
    ? `${apiUrl}/api/session/ws/${activeWorkspaceId}/shapes/${table}`
    : `${apiUrl}/api/session/ws/_disabled_/shapes/${table}`;

  const params: Record<string, string> = {};
  if (options?.columns?.length) {
    params.columns = options.columns.join(",");
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const result = useShape<T>({ url, params } as any);

  return {
    ...result,
    // Only report loading when workspace is active; otherwise treat as idle
    isLoading: result.isLoading && !!activeWorkspaceId,
    data: activeWorkspaceId ? result.data : ([] as T[]),
  };
}
