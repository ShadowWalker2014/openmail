/**
 * Proxy calls from MCP tools → internal API service.
 *
 * Stage 2 [V2.5]: `extraHeaders` parameter forwards `X-Lifecycle-Op-Id` from
 * MCP tool wrappers to the API verb endpoint, so a single op-id correlates
 * audit events end-to-end across MCP → API → DB.
 */
export function getApiClient(apiKey: string) {
  const baseUrl = process.env.API_URL!;

  async function request<T>(
    method: string,
    path: string,
    body?: unknown,
    extraHeaders?: Record<string, string>,
  ): Promise<T> {
    const res = await fetch(`${baseUrl}/api/v1${path}`, {
      method,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
        ...(extraHeaders ?? {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (!res.ok) {
      const err = await res.text();
      throw new Error(`API error ${res.status}: ${err}`);
    }
    return res.json() as Promise<T>;
  }

  return {
    get: <T>(path: string, extraHeaders?: Record<string, string>) =>
      request<T>("GET", path, undefined, extraHeaders),
    post: <T>(path: string, body?: unknown, extraHeaders?: Record<string, string>) =>
      request<T>("POST", path, body, extraHeaders),
    patch: <T>(path: string, body: unknown, extraHeaders?: Record<string, string>) =>
      request<T>("PATCH", path, body, extraHeaders),
    delete: <T>(path: string) => request<T>("DELETE", path),
  };
}
