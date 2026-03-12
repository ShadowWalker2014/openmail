const API_URL = import.meta.env.VITE_API_URL ?? "";

export async function apiFetch<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, {
    ...options,
    headers: {
      // Only set Content-Type when there is a body — strict proxies reject
      // Content-Type on bodyless GET/DELETE requests.
      ...(options?.body !== undefined ? { "Content-Type": "application/json" } : {}),
      ...options?.headers,
    },
    credentials: "include",
  });
  if (!res.ok) {
    if (res.status === 401) {
      window.location.href = "/login";
      throw new Error("Session expired");
    }
    const text = await res.text();
    let message = text;
    try { message = JSON.parse(text).error ?? text; } catch {}
    throw new Error(message || `HTTP ${res.status}`);
  }
  // 204 No Content — return undefined rather than throwing on empty JSON parse
  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

export function sessionFetch<T>(workspaceId: string, path: string, options?: RequestInit): Promise<T> {
  return apiFetch<T>(`/api/session/ws/${workspaceId}${path}`, options);
}
