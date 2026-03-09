import type { OpenMailErrorCode } from "./types.js";

export class OpenMailError extends Error {
  readonly code: OpenMailErrorCode;
  readonly status?: number;
  readonly response?: unknown;

  constructor(message: string, code: OpenMailErrorCode, status?: number, response?: unknown) {
    super(message);
    this.name = "OpenMailError";
    this.code = code;
    this.status = status;
    this.response = response;
    // Fix prototype chain for instanceof checks
    Object.setPrototypeOf(this, OpenMailError.prototype);
  }

  static unauthorized(message = "Invalid or missing API key") {
    return new OpenMailError(message, "UNAUTHORIZED", 401);
  }

  static notFound(resource: string) {
    return new OpenMailError(`${resource} not found`, "NOT_FOUND", 404);
  }

  static validation(message: string, details?: unknown) {
    return new OpenMailError(message, "VALIDATION_ERROR", 400, details);
  }

  static rateLimited(retryAfter?: number) {
    const msg = retryAfter
      ? `Rate limited. Retry after ${retryAfter}s`
      : "Rate limited";
    return new OpenMailError(msg, "RATE_LIMITED", 429);
  }

  static server(message: string, status = 500) {
    return new OpenMailError(message, "SERVER_ERROR", status);
  }

  static network(message: string) {
    return new OpenMailError(message, "NETWORK_ERROR");
  }

  static timeout(ms: number) {
    return new OpenMailError(`Request timed out after ${ms}ms`, "TIMEOUT");
  }

  static disabled() {
    return new OpenMailError("OpenMail tracking is disabled", "DISABLED");
  }

  static fromResponse(status: number, body: unknown): OpenMailError {
    const message =
      typeof body === "object" && body !== null && "error" in body
        ? String((body as { error: unknown }).error)
        : `HTTP ${status}`;

    if (status === 401) return OpenMailError.unauthorized(message);
    if (status === 404) return OpenMailError.notFound(message);
    if (status === 400 || status === 422) return OpenMailError.validation(message, body);
    if (status === 429) return OpenMailError.rateLimited();
    return OpenMailError.server(message, status);
  }
}
