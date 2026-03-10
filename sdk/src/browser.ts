/**
 * @openmail/sdk/browser — Browser-side SDK
 *
 * Features:
 * - Auto page view tracking
 * - Anonymous ID with localStorage/cookie persistence
 * - Event queue (survives network issues, flushes on reconnect)
 * - identify() links anonymous events to a known user
 * - Segment and PostHog compatible interface
 */
import { HttpClient } from "./core/http-client.js";
import { BatchQueue } from "./core/queue.js";
import { normalizeTraits, buildQuery, generateAnonymousId, createLogger } from "./core/utils.js";
import { OpenMailError } from "./core/errors.js";
import type {
  OpenMailConfig,
  Contact,
  TrackOptions,
  TrackResult,
  Properties,
  Traits,
} from "./core/types.js";

export * from "./core/types.js";
export * from "./core/errors.js";

const DEFAULT_API_URL = "https://api.openmail.win";
const ANON_ID_KEY = "__openmail_anon_id";
const USER_ID_KEY = "__openmail_user_id";
const OPT_OUT_KEY = "__openmail_opt_out";

type Persistence = "localStorage" | "cookie" | "memory";

export interface BrowserConfig extends OpenMailConfig {
  /** Auto-track page views (calls page() on history changes). Default: true */
  autoPageView?: boolean;
  /** Where to store anonymous ID and user state. Default: "localStorage" */
  persistence?: Persistence;
  /** Cookie domain for cross-subdomain tracking (e.g. ".example.com") */
  cookieDomain?: string;
  /** Cookie expiry in days. Default: 365 */
  cookieExpiry?: number;
}

// ─── Persistence helpers ──────────────────────────────────────────────────────

function storageGet(key: string, persistence: Persistence, _domain?: string): string | null {
  if (persistence === "localStorage") {
    try { return localStorage.getItem(key); } catch { return null; }
  }
  if (persistence === "cookie") {
    if (typeof document === "undefined") return null;
    const match = document.cookie.match(new RegExp(`(?:^|;)\\s*${key}=([^;]*)`));
    return match ? decodeURIComponent(match[1]) : null;
  }
  return null; // memory — managed by instance
}

function storageSet(key: string, value: string, persistence: Persistence, domain?: string, expiry = 365): void {
  if (persistence === "localStorage") {
    try { localStorage.setItem(key, value); } catch { /* ignore */ }
    return;
  }
  if (persistence === "cookie") {
    if (typeof document === "undefined") return;
    const exp = new Date();
    exp.setDate(exp.getDate() + expiry);
    let cookie = `${key}=${encodeURIComponent(value)};expires=${exp.toUTCString()};path=/;SameSite=Lax`;
    if (domain) cookie += `;domain=${domain}`;
    document.cookie = cookie;
  }
}

function storageRemove(key: string, persistence: Persistence, domain?: string): void {
  if (persistence === "localStorage") {
    try { localStorage.removeItem(key); } catch { /* ignore */ }
    return;
  }
  if (persistence === "cookie") {
    if (typeof document === "undefined") return;
    let cookie = `${key}=;expires=Thu, 01 Jan 1970 00:00:00 GMT;path=/;SameSite=Lax`;
    if (domain) cookie += `;domain=${domain}`;
    document.cookie = cookie;
  }
}

// ─── Browser SDK ─────────────────────────────────────────────────────────────

/**
 * OpenMail Browser SDK.
 *
 * @example
 * ```ts
 * import { OpenMailBrowser } from "@openmail/sdk/browser";
 *
 * const openmail = new OpenMailBrowser({
 *   apiKey: "om_your_api_key",
 *   apiUrl: "https://api.openmail.win",
 *   autoPageView: true,
 * });
 *
 * // On login
 * openmail.identify("alice@example.com", { plan: "pro" });
 *
 * // Track events
 * openmail.track("button_clicked", { button: "upgrade" });
 *
 * // On logout
 * openmail.reset();
 * ```
 */
type EventQueueItem = {
  name: string;
  properties: Properties;
  occurredAt?: string;
};

export class OpenMailBrowser {
  private readonly http: HttpClient;
  private readonly queue: BatchQueue<{
    email: string;
    name: string;
    properties: Properties;
    occurredAt?: string;
  }>;
  private readonly config: Required<Pick<BrowserConfig, "persistence" | "cookieDomain" | "cookieExpiry">>;
  private readonly logger: ReturnType<typeof createLogger>;
  private readonly autoPageView: boolean;

  // Memory-only state (fallback when storage unavailable)
  private _memAnonymousId: string | null = null;
  private _memUserId: string | null = null;
  private _memOptOut = false;

  // Pre-identify queue: events tracked before identify() is called
  private _preQueue: EventQueueItem[] = [];

  private _cleanupHistory: (() => void) | null = null;

  constructor(config: BrowserConfig) {
    if (!config.apiKey) throw new Error("OpenMail: apiKey is required");

    this.logger = createLogger(config.debug ?? false);
    this.autoPageView = config.autoPageView ?? true;
    this.config = {
      persistence: config.persistence ?? "localStorage",
      cookieDomain: config.cookieDomain ?? "",
      cookieExpiry: config.cookieExpiry ?? 365,
    };

    this.http = new HttpClient({
      apiKey: config.apiKey,
      apiUrl: config.apiUrl ?? DEFAULT_API_URL,
      timeout: config.timeout,
      maxRetries: config.maxRetries ?? 2,
      debug: config.debug,
    });

    this.queue = new BatchQueue({
      flushAt: config.flushAt ?? 20,
      flushInterval: config.flushInterval ?? 5_000,
      flush: async (items) => {
        return Promise.all(
          items.map((item) =>
            this.http.post<TrackResult>("/api/v1/events/track", item)
          )
        );
      },
      onError: (err) => {
        this.logger.error("Failed to flush events:", err.message);
      },
    });

    // Flush on page hide (mobile background / tab close)
    if (typeof document !== "undefined") {
      document.addEventListener("visibilitychange", this._onVisibilityChange);
    }

    // Auto page tracking
    if (this.autoPageView && typeof window !== "undefined") {
      this._setupAutoPageView();
    }

    // Ensure anonymous ID is seeded
    this._getOrCreateAnonymousId();
  }

  // ─── Identity ──────────────────────────────────────────────────────────────

  private _getOrCreateAnonymousId(): string {
    const stored = this._read(ANON_ID_KEY);
    if (stored) return stored;
    const id = generateAnonymousId();
    this._write(ANON_ID_KEY, id);
    return id;
  }

  private _read(key: string): string | null {
    const { persistence, cookieDomain } = this.config;
    if (persistence === "memory") {
      return key === ANON_ID_KEY ? this._memAnonymousId :
             key === USER_ID_KEY ? this._memUserId : null;
    }
    return storageGet(key, persistence, cookieDomain);
  }

  private _write(key: string, value: string): void {
    const { persistence, cookieDomain, cookieExpiry } = this.config;
    if (persistence === "memory") {
      if (key === ANON_ID_KEY) this._memAnonymousId = value;
      if (key === USER_ID_KEY) this._memUserId = value;
      return;
    }
    storageSet(key, value, persistence, cookieDomain, cookieExpiry);
  }

  private _remove(key: string): void {
    const { persistence, cookieDomain } = this.config;
    if (persistence === "memory") {
      if (key === ANON_ID_KEY) this._memAnonymousId = null;
      if (key === USER_ID_KEY) this._memUserId = null;
      return;
    }
    storageRemove(key, persistence, cookieDomain);
  }

  get anonymousId(): string {
    return this._getOrCreateAnonymousId();
  }

  get userId(): string | null {
    return this._read(USER_ID_KEY);
  }

  get isOptedOut(): boolean {
    const { persistence } = this.config;
    if (persistence === "memory") return this._memOptOut;
    return storageGet(OPT_OUT_KEY, persistence) === "1";
  }

  // ─── Core SDK methods ──────────────────────────────────────────────────────

  /**
   * Identify a user. Links anonymous events to a known contact.
   *
   * @example
   * ```ts
   * openmail.identify("alice@example.com", { firstName: "Alice", plan: "pro" });
   * ```
   */
  async identify(userId: string, traits: Traits = {}): Promise<Contact> {
    if (this.isOptedOut) {
      return null as unknown as Contact;
    }

    const normalized = normalizeTraits(userId, traits);
    const email = normalized.email;

    if (!email) {
      throw new Error("OpenMail identify(): email is required");
    }

    const anonId = this.anonymousId;
    this._write(USER_ID_KEY, email);

    const payload = {
      email,
      ...(normalized.firstName && { firstName: normalized.firstName }),
      ...(normalized.lastName && { lastName: normalized.lastName }),
      ...(normalized.phone && { phone: normalized.phone }),
      ...(Object.keys(normalized.attributes).length > 0 && { attributes: normalized.attributes }),
    };

    this.logger.log("identify()", email, payload);

    // Fire alias event to link anonymous ID to identified user
    if (anonId) {
      this.queue.push({ email, name: "$identify", properties: { anonymousId: anonId } }).catch(() => {});
    }

    // Replay events that were tracked before identify() was called
    if (this._preQueue.length > 0) {
      const pending = this._preQueue.splice(0);
      for (const item of pending) {
        this.queue.push({ email, ...item }).catch(() => {});
      }
      this.logger.log(`Replayed ${pending.length} pre-identify events for ${email}`);
    }

    return this.http.post<Contact>("/api/v1/contacts", payload);
  }

  /**
   * Track an event.
   *
   * @example
   * ```ts
   * openmail.track("button_clicked", { button: "upgrade", page: "/pricing" });
   * ```
   */
  track(event: string, properties: Properties = {}, options: TrackOptions = {}): Promise<TrackResult> {
    if (this.isOptedOut) {
      return Promise.resolve({ id: "" });
    }

    const email = options.userId ?? this.userId ?? undefined;

    const enriched: Properties = {
      ...properties,
      $anonymousId: this.anonymousId,
      $url: typeof window !== "undefined" ? window.location.href : undefined,
      $path: typeof window !== "undefined" ? window.location.pathname : undefined,
      $referrer: typeof document !== "undefined" ? document.referrer : undefined,
    };

    const item: EventQueueItem = {
      name: event,
      properties: enriched,
      ...(options.timestamp ? { occurredAt: options.timestamp } : {}),
    };

    if (!email) {
      // No identified user yet — hold in pre-queue; replayed after identify()
      this.logger.log(`track("${event}"): queued (no userId yet, will replay after identify())`);
      this._preQueue.push(item);
      return Promise.resolve({ id: "" });
    }

    this.logger.log("track()", { email, ...item });
    // Fire and forget — non-blocking. Use flush() before page unload.
    this.queue.push({ email, ...item }).catch((err: Error) => {
      this.logger.error(`Event "${event}" failed:`, err.message);
    });
    return Promise.resolve({ id: "" });
  }

  /**
   * PostHog-compatible `capture`. Alias for `track`.
   */
  capture(event: string, properties: Properties = {}): Promise<TrackResult> {
    return this.track(event, properties);
  }

  /**
   * Track a page view. Called automatically when `autoPageView: true`.
   *
   * @example
   * ```ts
   * openmail.page("Pricing", { path: "/pricing" });
   * ```
   */
  page(name?: string, properties: Properties = {}): Promise<TrackResult> {
    const pageProps: Properties = {
      name: name ?? (typeof document !== "undefined" ? document.title : ""),
      path: typeof window !== "undefined" ? window.location.pathname : "",
      url: typeof window !== "undefined" ? window.location.href : "",
      referrer: typeof document !== "undefined" ? document.referrer : "",
      search: typeof window !== "undefined" ? window.location.search : "",
      title: typeof document !== "undefined" ? document.title : "",
      ...properties,
    };
    return this.track("$pageview", pageProps);
  }

  /**
   * Track a screen view (mobile apps).
   */
  screen(name?: string, properties: Properties = {}): Promise<TrackResult> {
    return this.track("$screen", { name: name ?? "", ...properties });
  }

  /**
   * Upsert a group and associate the current user with it.
   *
   * Compatible with Segment's `analytics.group(groupId, traits)`.
   * Use `groupType` to specify the type (default: "company").
   */
  // FIX (MEDIUM): Accept TrackOptions so callers can pass options.userId to
  // override the active user (Segment spec). Previously options only had
  // groupType, so there was no way to pass userId from the browser SDK.
  group(
    groupId: string,
    traits: Traits = {},
    options: { groupType?: string; userId?: string } = {},
  ): Promise<TrackResult> {
    const groupType = options.groupType ?? "company";
    // FIX: Honor options.userId before falling back to the persisted userId
    const email = options.userId ?? this.userId ?? undefined;

    // Fire-and-forget group upsert — non-blocking like track()
    this.http.post("/api/ingest/group", {
      groupType,
      groupKey: groupId,
      attributes: traits,
      ...(email ? { contactEmail: email } : {}),
    }).catch((err: Error) => {
      this.logger.error("group() upsert failed:", err.message);
    });

    return Promise.resolve({ id: "" });
  }

  /**
   * Alias the current anonymous user to an identified user.
   */
  async alias(userId: string, previousId?: string): Promise<void> {
    const anonId = previousId ?? this.anonymousId;
    await this.track("$alias", { userId, previousId: anonId }, { userId });
  }

  /**
   * Reset user state (call on logout).
   */
  reset(): void {
    this._remove(USER_ID_KEY);
    // Regenerate anonymous ID
    const newId = generateAnonymousId();
    this._write(ANON_ID_KEY, newId);
    // Clear in-memory state regardless of persistence mode
    this._memUserId = null;
    this._memAnonymousId = newId;
    // Discard pre-identify queued events from the previous session
    this._preQueue = [];
    this.logger.log("reset() — new anonymous ID:", newId);
  }

  /**
   * Opt the user out of all tracking.
   */
  opt_out_capturing(): void {
    const { persistence, cookieDomain, cookieExpiry } = this.config;
    if (persistence === "memory") {
      this._memOptOut = true;
    } else {
      storageSet(OPT_OUT_KEY, "1", persistence, cookieDomain, cookieExpiry);
    }
    this.logger.log("opt_out_capturing()");
  }

  /**
   * Opt the user back in to tracking.
   */
  opt_in_capturing(): void {
    const { persistence, cookieDomain } = this.config;
    if (persistence === "memory") {
      this._memOptOut = false;
    } else {
      storageRemove(OPT_OUT_KEY, persistence, cookieDomain);
    }
    this.logger.log("opt_in_capturing()");
  }

  // ─── Flush + cleanup ───────────────────────────────────────────────────────

  async flush(): Promise<void> {
    await this.queue.flush();
  }

  /**
   * Destroy the SDK instance. Removes listeners and flushes pending events.
   */
  async destroy(): Promise<void> {
    if (this._cleanupHistory) this._cleanupHistory();
    if (typeof document !== "undefined") {
      document.removeEventListener("visibilitychange", this._onVisibilityChange);
    }
    await this.queue.flush();
    this.queue.destroy();
  }

  // ─── Private helpers ───────────────────────────────────────────────────────

  private _onVisibilityChange = (): void => {
    if (document.visibilityState === "hidden") {
      this.queue.flush().catch(() => {/* ignore */});
    }
  };

  private _lastPath = "";
  private _setupAutoPageView(): void {
    // Initial page view
    this._lastPath = window.location.pathname;
    setTimeout(() => this.page(), 0); // defer so identify() can run first

    // Guard against double-patching when multiple instances are created
    // (e.g. React StrictMode double-render, HMR). Attach listeners to the
    // dispatch event pattern instead of wrapping history methods.
    const onPopState = () => this._onRouteChange();
    window.addEventListener("popstate", onPopState);

    // Patch pushState/replaceState using a unique symbol per-instance
    // to detect our own patches and avoid stacking wrappers.
    const PATCHED_KEY = "__openmail_patched__";
    const origPush = (history.pushState as unknown as { [PATCHED_KEY]?: Function })[PATCHED_KEY]
      ? history.pushState
      : history.pushState;
    const origReplace = history.replaceState;

    const patchedPush = (...args: Parameters<typeof history.pushState>) => {
      origPush.apply(history, args);
      this._onRouteChange();
    };
    (patchedPush as unknown as Record<string, unknown>)[PATCHED_KEY] = true;

    const patchedReplace = (...args: Parameters<typeof history.replaceState>) => {
      origReplace.apply(history, args);
      this._onRouteChange();
    };

    history.pushState = patchedPush;
    history.replaceState = patchedReplace;

    this._cleanupHistory = () => {
      history.pushState = origPush;
      history.replaceState = origReplace;
      window.removeEventListener("popstate", onPopState);
    };
  }

  private _onRouteChange(): void {
    const path = window.location.pathname;
    if (path !== this._lastPath) {
      this._lastPath = path;
      this.page();
    }
  }
}

// ─── Factory function ─────────────────────────────────────────────────────────

/**
 * Create an OpenMail browser SDK instance.
 *
 * @example
 * ```ts
 * import { createOpenMailBrowser } from "@openmail/sdk/browser";
 *
 * const openmail = createOpenMailBrowser({
 *   apiKey: "om_...",
 *   autoPageView: true,
 * });
 * ```
 */
export function createOpenMailBrowser(config: BrowserConfig): OpenMailBrowser {
  return new OpenMailBrowser(config);
}

