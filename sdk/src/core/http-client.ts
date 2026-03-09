import { OpenMailError } from "./errors.js";

const DEFAULT_TIMEOUT_MS = 10_000;
const DEFAULT_MAX_RETRIES = 3;

// Jitter + exponential: 200ms * 2^attempt + up to 100ms random
function retryDelay(attempt: number, retryAfterSeconds?: number): number {
  if (retryAfterSeconds) return retryAfterSeconds * 1000;
  return Math.min(200 * Math.pow(2, attempt) + Math.random() * 100, 30_000);
}

function isRetryable(status: number): boolean {
  // 408 Request Timeout is transient; 429 rate-limited; 5xx server errors
  return status === 408 || status === 429 || status === 500 || status === 502 || status === 503 || status === 504;
}

export interface HttpClientConfig {
  apiKey: string;
  apiUrl: string;
  timeout?: number;
  maxRetries?: number;
  debug?: boolean;
}

export class HttpClient {
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly timeout: number;
  private readonly maxRetries: number;
  private readonly debug: boolean;

  constructor(config: HttpClientConfig) {
    this.apiKey = config.apiKey;
    this.baseUrl = config.apiUrl.replace(/\/+$/, "");
    this.timeout = config.timeout ?? DEFAULT_TIMEOUT_MS;
    this.maxRetries = config.maxRetries ?? DEFAULT_MAX_RETRIES;
    this.debug = config.debug ?? false;
  }

  async request<T>(
    method: "GET" | "POST" | "PATCH" | "DELETE",
    path: string,
    body?: unknown,
    attempt = 0,
  ): Promise<T> {
    const url = `${this.baseUrl}${path}`;
    const hasBody = body !== undefined;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeout);

    if (this.debug) {
      console.debug(`[OpenMail] ${method} ${url}`);
    }

    let response: Response;
    try {
      const headers: Record<string, string> = {
        "Authorization": `Bearer ${this.apiKey}`,
        "User-Agent": "openmail-sdk/1.0.0",
      };
      // Only set Content-Type when there is actually a request body
      if (hasBody) {
        headers["Content-Type"] = "application/json";
      }

      response = await fetch(url, {
        method,
        headers,
        body: hasBody ? JSON.stringify(body) : undefined,
        signal: controller.signal,
      });
    } catch (err: unknown) {
      clearTimeout(timer);
      if (err instanceof Error && err.name === "AbortError") {
        throw OpenMailError.timeout(this.timeout);
      }
      throw OpenMailError.network(err instanceof Error ? err.message : "Network request failed");
    } finally {
      clearTimeout(timer);
    }

    // Respect Retry-After header on 429 rate limits
    const retryAfterHeader = response.headers.get("retry-after");
    const retryAfterSeconds = retryAfterHeader ? parseInt(retryAfterHeader, 10) : undefined;

    // Retry on transient errors
    if (isRetryable(response.status) && attempt < this.maxRetries) {
      const delay = retryDelay(attempt, retryAfterSeconds);
      if (this.debug) {
        console.debug(`[OpenMail] HTTP ${response.status} — retry ${attempt + 1}/${this.maxRetries} in ${Math.round(delay)}ms`);
      }
      await new Promise((r) => setTimeout(r, delay));
      return this.request<T>(method, path, body, attempt + 1);
    }

    // Handle empty responses (204 No Content)
    if (response.status === 204) return {} as T;

    let json: unknown;
    const text = await response.text();
    try {
      json = text ? JSON.parse(text) : {};
    } catch {
      json = { error: text };
    }

    if (!response.ok) {
      throw OpenMailError.fromResponse(response.status, json);
    }

    return json as T;
  }

  get<T>(path: string): Promise<T> {
    return this.request<T>("GET", path);
  }

  post<T>(path: string, body?: unknown): Promise<T> {
    return this.request<T>("POST", path, body);
  }

  patch<T>(path: string, body?: unknown): Promise<T> {
    return this.request<T>("PATCH", path, body);
  }

  delete<T = { success: boolean }>(path: string): Promise<T> {
    return this.request<T>("DELETE", path);
  }
}
