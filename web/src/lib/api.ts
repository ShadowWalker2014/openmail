const API_URL = import.meta.env.VITE_API_URL ?? "";

export async function apiFetch<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...options?.headers,
    },
    credentials: "include",
  });
  if (!res.ok) {
    const text = await res.text();
    let message = text;
    try { message = JSON.parse(text).error ?? text; } catch {}
    throw new Error(message || `HTTP ${res.status}`);
  }
  return res.json() as Promise<T>;
}

export function sessionFetch<T>(workspaceId: string, path: string, options?: RequestInit): Promise<T> {
  return apiFetch<T>(`/api/session/ws/${workspaceId}${path}`, options);
}
