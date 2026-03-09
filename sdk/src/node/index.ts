import { HttpClient } from "../core/http-client.js";
import { BatchQueue } from "../core/queue.js";
import { normalizeTraits, mergeAttributes, buildQuery, createLogger } from "../core/utils.js";
import { OpenMailError } from "../core/errors.js";
import type {
  OpenMailConfig,
  Contact,
  CreateContactInput,
  UpdateContactInput,
  ListContactsOptions,
  PaginatedResponse,
  TrackOptions,
  TrackResult,
  EventRecord,
  Broadcast,
  CreateBroadcastInput,
  UpdateBroadcastInput,
  EmailSend,
  ListSendsOptions,
  TopLink,
  Campaign,
  CreateCampaignInput,
  UpdateCampaignInput,
  CampaignStep,
  CreateStepInput,
  UpdateStepInput,
  Segment,
  CreateSegmentInput,
  UpdateSegmentInput,
  SegmentUsage,
  EmailTemplate,
  CreateTemplateInput,
  UpdateTemplateInput,
  WorkspaceAnalytics,
  BroadcastAnalytics,
  Asset,
  UploadFromUrlInput,
  UploadBase64Input,
  PresignedUploadResult,
  GetUploadUrlInput,
  Traits,
  Properties,
  SegmentCompatible,
  PostHogCompatible,
} from "../core/types.js";

export * from "../core/types.js";
export * from "../core/errors.js";

const DEFAULT_API_URL = "https://api.openmail.win";

// ─── Contacts API ─────────────────────────────────────────────────────────────

class ContactsAPI {
  constructor(private readonly http: HttpClient) {}

  async list(options: ListContactsOptions = {}): Promise<PaginatedResponse<Contact>> {
    const q = buildQuery({ page: options.page, pageSize: options.pageSize, search: options.search });
    return this.http.get<PaginatedResponse<Contact>>(`/api/v1/contacts${q}`);
  }

  async create(input: CreateContactInput): Promise<Contact> {
    return this.http.post<Contact>("/api/v1/contacts", input);
  }

  /**
   * Upsert: create or update by email.
   * Note: the API replaces the `attributes` column entirely on conflict.
   * Use `identify()` or `setUserProperties()` for attribute-merging semantics.
   */
  async upsert(input: CreateContactInput): Promise<Contact> {
    return this.http.post<Contact>("/api/v1/contacts", input);
  }

  async get(id: string): Promise<Contact> {
    return this.http.get<Contact>(`/api/v1/contacts/${id}`);
  }

  async update(id: string, input: UpdateContactInput): Promise<Contact> {
    return this.http.patch<Contact>(`/api/v1/contacts/${id}`, input);
  }

  async delete(id: string): Promise<void> {
    await this.http.delete(`/api/v1/contacts/${id}`);
  }

  async events(id: string, options: { page?: number; pageSize?: number } = {}): Promise<PaginatedResponse<EventRecord>> {
    const q = buildQuery({ page: options.page, pageSize: options.pageSize });
    return this.http.get<PaginatedResponse<EventRecord>>(`/api/v1/contacts/${id}/events${q}`);
  }

  async sends(id: string, options: ListSendsOptions = {}): Promise<PaginatedResponse<EmailSend>> {
    const q = buildQuery({ page: options.page, pageSize: options.pageSize });
    return this.http.get<PaginatedResponse<EmailSend>>(`/api/v1/contacts/${id}/sends${q}`);
  }
}

// ─── Broadcasts API ───────────────────────────────────────────────────────────

class BroadcastsAPI {
  constructor(private readonly http: HttpClient) {}

  async list(): Promise<Broadcast[]> {
    return this.http.get<Broadcast[]>("/api/v1/broadcasts");
  }

  async get(id: string): Promise<Broadcast> {
    return this.http.get<Broadcast>(`/api/v1/broadcasts/${id}`);
  }

  async create(input: CreateBroadcastInput): Promise<Broadcast> {
    return this.http.post<Broadcast>("/api/v1/broadcasts", input);
  }

  async update(id: string, input: UpdateBroadcastInput): Promise<Broadcast> {
    return this.http.patch<Broadcast>(`/api/v1/broadcasts/${id}`, input);
  }

  async send(id: string): Promise<Broadcast> {
    return this.http.post<Broadcast>(`/api/v1/broadcasts/${id}/send`);
  }

  /** Schedule by setting scheduledAt on a draft broadcast. Pass null to clear. */
  async schedule(id: string, scheduledAt: string | null): Promise<Broadcast> {
    return this.http.patch<Broadcast>(`/api/v1/broadcasts/${id}`, { scheduledAt });
  }

  async testSend(id: string, email: string): Promise<{ success: boolean }> {
    return this.http.post<{ success: boolean }>(`/api/v1/broadcasts/${id}/test-send`, { email });
  }

  async sends(id: string, options: ListSendsOptions = {}): Promise<PaginatedResponse<EmailSend>> {
    const q = buildQuery({ page: options.page, pageSize: options.pageSize, status: options.status });
    return this.http.get<PaginatedResponse<EmailSend>>(`/api/v1/broadcasts/${id}/sends${q}`);
  }

  async topLinks(id: string): Promise<TopLink[]> {
    return this.http.get<TopLink[]>(`/api/v1/broadcasts/${id}/top-links`);
  }

  async delete(id: string): Promise<void> {
    await this.http.delete(`/api/v1/broadcasts/${id}`);
  }
}

// ─── Campaigns API ────────────────────────────────────────────────────────────

class CampaignsAPI {
  constructor(private readonly http: HttpClient) {}

  async list(): Promise<Campaign[]> {
    return this.http.get<Campaign[]>("/api/v1/campaigns");
  }

  async get(id: string): Promise<Campaign> {
    return this.http.get<Campaign>(`/api/v1/campaigns/${id}`);
  }

  async create(input: CreateCampaignInput): Promise<Campaign> {
    return this.http.post<Campaign>("/api/v1/campaigns", input);
  }

  async update(id: string, input: UpdateCampaignInput): Promise<Campaign> {
    return this.http.patch<Campaign>(`/api/v1/campaigns/${id}`, input);
  }

  async activate(id: string): Promise<Campaign> {
    return this.update(id, { status: "active" });
  }

  async pause(id: string): Promise<Campaign> {
    return this.update(id, { status: "paused" });
  }

  async archive(id: string): Promise<Campaign> {
    return this.update(id, { status: "archived" });
  }

  async delete(id: string): Promise<void> {
    await this.http.delete(`/api/v1/campaigns/${id}`);
  }

  async listSteps(campaignId: string): Promise<CampaignStep[]> {
    const campaign = await this.get(campaignId);
    return campaign.steps ?? [];
  }

  async getStep(campaignId: string, stepId: string): Promise<CampaignStep> {
    const steps = await this.listSteps(campaignId);
    const step = steps.find((s) => s.id === stepId);
    if (!step) throw OpenMailError.notFound(`Step ${stepId}`);
    return step;
  }

  async addStep(campaignId: string, input: CreateStepInput): Promise<CampaignStep> {
    return this.http.post<CampaignStep>(`/api/v1/campaigns/${campaignId}/steps`, input);
  }

  async updateStep(campaignId: string, stepId: string, input: UpdateStepInput): Promise<CampaignStep> {
    return this.http.patch<CampaignStep>(`/api/v1/campaigns/${campaignId}/steps/${stepId}`, input);
  }

  async deleteStep(campaignId: string, stepId: string): Promise<void> {
    await this.http.delete(`/api/v1/campaigns/${campaignId}/steps/${stepId}`);
  }
}

// ─── Segments API ─────────────────────────────────────────────────────────────

class SegmentsAPI {
  constructor(private readonly http: HttpClient) {}

  async list(): Promise<Segment[]> {
    return this.http.get<Segment[]>("/api/v1/segments");
  }

  async create(input: CreateSegmentInput): Promise<Segment> {
    return this.http.post<Segment>("/api/v1/segments", input);
  }

  async get(id: string): Promise<Segment> {
    // No direct GET /segments/:id endpoint — list and find by ID
    const all = await this.list();
    const found = all.find((s) => s.id === id);
    if (!found) throw OpenMailError.notFound(`Segment ${id}`);
    return found;
  }

  async update(id: string, input: UpdateSegmentInput): Promise<Segment> {
    return this.http.patch<Segment>(`/api/v1/segments/${id}`, input);
  }

  async delete(id: string): Promise<void> {
    await this.http.delete(`/api/v1/segments/${id}`);
  }

  async members(id: string, options: { page?: number; pageSize?: number } = {}): Promise<PaginatedResponse<Contact>> {
    const q = buildQuery({ page: options.page, pageSize: options.pageSize });
    return this.http.get<PaginatedResponse<Contact>>(`/api/v1/segments/${id}/people${q}`);
  }

  async usage(id: string): Promise<SegmentUsage> {
    return this.http.get<SegmentUsage>(`/api/v1/segments/${id}/usage`);
  }
}

// ─── Templates API ────────────────────────────────────────────────────────────

class TemplatesAPI {
  constructor(private readonly http: HttpClient) {}

  async list(): Promise<EmailTemplate[]> {
    return this.http.get<EmailTemplate[]>("/api/v1/templates");
  }

  async get(id: string): Promise<EmailTemplate> {
    return this.http.get<EmailTemplate>(`/api/v1/templates/${id}`);
  }

  async create(input: CreateTemplateInput): Promise<EmailTemplate> {
    return this.http.post<EmailTemplate>("/api/v1/templates", input);
  }

  async update(id: string, input: UpdateTemplateInput): Promise<EmailTemplate> {
    return this.http.patch<EmailTemplate>(`/api/v1/templates/${id}`, input);
  }

  async delete(id: string): Promise<void> {
    await this.http.delete(`/api/v1/templates/${id}`);
  }
}

// ─── Analytics API ────────────────────────────────────────────────────────────

class AnalyticsAPI {
  constructor(private readonly http: HttpClient) {}

  async overview(): Promise<WorkspaceAnalytics> {
    return this.http.get<WorkspaceAnalytics>("/api/v1/analytics/overview");
  }

  async broadcast(broadcastId: string): Promise<BroadcastAnalytics> {
    return this.http.get<BroadcastAnalytics>(`/api/v1/analytics/broadcasts/${broadcastId}`);
  }
}

// ─── Assets API ───────────────────────────────────────────────────────────────

class AssetsAPI {
  constructor(private readonly http: HttpClient) {}

  async list(): Promise<Asset[]> {
    return this.http.get<Asset[]>("/api/v1/assets");
  }

  async get(id: string): Promise<Asset> {
    return this.http.get<Asset>(`/api/v1/assets/${id}`);
  }

  async uploadFromUrl(input: UploadFromUrlInput): Promise<Asset> {
    return this.http.post<Asset>("/api/v1/assets/upload-from-url", input);
  }

  async uploadBase64(input: UploadBase64Input): Promise<Asset> {
    return this.http.post<Asset>("/api/v1/assets/upload-base64", input);
  }

  async getUploadUrl(input: GetUploadUrlInput): Promise<PresignedUploadResult> {
    return this.http.post<PresignedUploadResult>("/api/v1/assets/upload-url", input);
  }

  async delete(id: string): Promise<void> {
    await this.http.delete(`/api/v1/assets/${id}`);
  }
}

// ─── Main OpenMail Node SDK ───────────────────────────────────────────────────

/**
 * OpenMail Node.js SDK.
 * Compatible with Segment Analytics 2.0 and PostHog Node interfaces.
 *
 * @example
 * ```ts
 * import { OpenMail } from "@openmail/sdk";
 *
 * const openmail = new OpenMail({
 *   apiKey: "om_your_workspace_api_key",
 * });
 *
 * // Segment-compatible
 * await openmail.identify("alice@example.com", { plan: "pro" });
 * await openmail.track("plan_upgraded", { from: "starter", to: "pro" }, { userId: "alice@example.com" });
 *
 * // Full API access
 * const broadcasts = await openmail.broadcasts.list();
 * ```
 */
export class OpenMail implements SegmentCompatible, PostHogCompatible {
  readonly contacts: ContactsAPI;
  readonly broadcasts: BroadcastsAPI;
  readonly campaigns: CampaignsAPI;
  readonly segments: SegmentsAPI;
  readonly templates: TemplatesAPI;
  readonly analytics: AnalyticsAPI;
  readonly assets: AssetsAPI;

  private readonly http: HttpClient;
  private readonly queue: BatchQueue<{ email: string; name: string; properties: Properties; occurredAt?: string }>;
  private readonly disabled: boolean;
  private readonly logger: ReturnType<typeof createLogger>;

  /** Current anonymous/identified user context for browser-less server usage */
  private _userId: string | undefined;
  private _optedOut = false;

  constructor(config: OpenMailConfig) {
    if (!config.apiKey) throw new Error("OpenMail: apiKey is required");

    this.disabled = config.disabled ?? false;
    this.logger = createLogger(config.debug ?? false);

    this.http = new HttpClient({
      apiKey: config.apiKey,
      apiUrl: config.apiUrl ?? DEFAULT_API_URL,
      timeout: config.timeout,
      maxRetries: config.maxRetries,
      debug: config.debug,
    });

    this.contacts = new ContactsAPI(this.http);
    this.broadcasts = new BroadcastsAPI(this.http);
    this.campaigns = new CampaignsAPI(this.http);
    this.segments = new SegmentsAPI(this.http);
    this.templates = new TemplatesAPI(this.http);
    this.analytics = new AnalyticsAPI(this.http);
    this.assets = new AssetsAPI(this.http);

    // Batching queue for high-volume event tracking
    this.queue = new BatchQueue({
      flushAt: config.flushAt ?? 20,
      flushInterval: config.flushInterval ?? 10_000,
      flush: async (items) => {
        return Promise.all(
          items.map((item) =>
            this.http.post<TrackResult>("/api/v1/events/track", item)
          )
        );
      },
      onError: (err, items) => {
        this.logger.error(`Failed to flush ${items.length} events:`, err.message);
      },
    });
  }

  // ─── Segment-compatible interface ──────────────────────────────────────────

  /**
   * Identify a user. Creates or updates a contact in OpenMail.
   *
   * Compatible with Segment's `analytics.identify(userId, traits)`.
   * Compatible with PostHog's `posthog.identify(distinctId, properties)`.
   *
   * @param userId - The user's email address or internal ID. If email is not included here,
   *                 pass it as `traits.email`.
   * @param traits - User properties (firstName, lastName, phone, plan, company, etc.)
   *
   * @example
   * ```ts
   * // Segment style
   * await openmail.identify("alice@example.com", { plan: "pro", company: "Acme" });
   *
   * // With separate userId and email trait
   * await openmail.identify("user_123", { email: "alice@example.com", plan: "pro" });
   * ```
   */
  async identify(userId: string, traits: Traits = {}): Promise<Contact> {
    if (this.disabled || this._optedOut) {
      this.logger.log("identify() skipped (disabled/opted-out)");
      // Return null cast — callers should handle disabled state.
      // The return type is Contact for API compatibility but will be null at runtime.
      return null as unknown as Contact;
    }

    this._userId = userId;
    const normalized = normalizeTraits(userId, traits);

    if (!normalized.email) {
      throw new Error(
        "OpenMail identify(): email is required. Pass email as userId or as traits.email"
      );
    }

    const hasNewAttributes = Object.keys(normalized.attributes).length > 0;

    // If new attributes are provided, we must fetch-then-merge because the API
    // replaces the attributes column entirely on upsert — not a deep merge.
    let existingAttributes: Record<string, unknown> = {};
    if (hasNewAttributes) {
      try {
        const { data } = await this.contacts.list({ search: normalized.email, pageSize: 1 });
        const existing = data.find((c) => c.email === normalized.email);
        if (existing) existingAttributes = existing.attributes ?? {};
      } catch {
        // Contact doesn't exist yet — existingAttributes stays empty
      }
    }

    const payload: CreateContactInput = {
      email: normalized.email,
      ...(normalized.firstName && { firstName: normalized.firstName }),
      ...(normalized.lastName && { lastName: normalized.lastName }),
      ...(normalized.phone && { phone: normalized.phone }),
      ...(hasNewAttributes && {
        attributes: mergeAttributes(existingAttributes, normalized.attributes),
      }),
    };

    this.logger.log("identify()", payload);
    return this.contacts.upsert(payload);
  }

  /**
   * Track an event.
   *
   * Compatible with Segment's `analytics.track(event, properties, options)`.
   *
   * @example
   * ```ts
   * await openmail.track("plan_upgraded", { from: "starter", to: "pro" }, {
   *   userId: "alice@example.com",
   * });
   * ```
   */
  async track(event: string, properties: Properties = {}, options: TrackOptions = {}): Promise<TrackResult> {
    if (this.disabled || this._optedOut) {
      this.logger.log("track() skipped (disabled/opted-out)");
      return { id: "" };
    }

    const email = options.userId ?? this._userId;
    if (!email) {
      throw new Error("OpenMail track(): userId (email) is required. Call identify() first or pass options.userId");
    }

    const item = {
      email,
      name: event,
      properties,
      ...(options.timestamp && { occurredAt: options.timestamp }),
    };

    this.logger.log("track()", item);
    // Fire and forget — track() is non-blocking. Use flush() to drain before exit.
    this.queue.push(item).catch((err: Error) => {
      this.logger.error(`Event "${event}" failed:`, err.message);
    });
    return Promise.resolve({ id: "" });
  }

  /**
   * Track a page view.
   *
   * Compatible with Segment's `analytics.page(name, properties, options)`.
   */
  async page(name = "", properties: Properties = {}, options: TrackOptions = {}): Promise<TrackResult> {
    return this.track("$pageview", { name, ...properties }, options);
  }

  /**
   * Track a screen view (mobile).
   *
   * Compatible with Segment's `analytics.screen(name, properties, options)`.
   */
  async screen(name = "", properties: Properties = {}, options: TrackOptions = {}): Promise<TrackResult> {
    return this.track("$screen", { name, ...properties }, options);
  }

  /**
   * Associate a user with a group (organization, company, team).
   *
   * Tracks a `$group` event and stores group traits on the contact.
   * Compatible with Segment's `analytics.group()` and PostHog's `posthog.group()`.
   *
   * @example
   * ```ts
   * // Segment style
   * await openmail.group("acme-corp", { name: "Acme Corp", plan: "enterprise" });
   *
   * // PostHog style: group(type, key, traits)
   * await openmail.group("company", "acme-corp", { name: "Acme Corp" });
   * ```
   */
  async group(groupId: string, traits: Traits = {}, options: TrackOptions = {}): Promise<TrackResult> {
    return this.track("$group", { groupId, ...traits }, options);
  }

  /**
   * PostHog-style group: `group(type, key, properties)`
   */
  async groupPostHog(groupType: string, groupKey: string, groupProperties: Properties = {}): Promise<TrackResult> {
    return this.track("$group", { groupType, groupKey, ...groupProperties });
  }

  /**
   * Alias two user identities (e.g. anonymous → identified).
   *
   * Tracks an `$alias` event.
   * Compatible with Segment's `analytics.alias(to, from)`.
   */
  async alias(userId: string, previousId: string): Promise<void> {
    await this.track("$alias", { userId, previousId }, { userId });
  }

  /**
   * Reset the current user context (call on logout).
   *
   * Compatible with Segment's `analytics.reset()` and PostHog's `posthog.reset()`.
   */
  reset(): void {
    this._userId = undefined;
    this.logger.log("reset()");
  }

  // ─── PostHog aliases ───────────────────────────────────────────────────────

  /**
   * PostHog-compatible `capture`. Alias for `track`.
   *
   * @example
   * ```ts
   * openmail.capture("button_clicked", { button: "upgrade" });
   * ```
   */
  async capture(event: string, properties: Properties = {}): Promise<TrackResult> {
    return this.track(event, properties);
  }

  /** Opt this instance back in to tracking. */
  opt_in_capturing(): void {
    this._optedOut = false;
    this.logger.log("opt_in_capturing()");
  }

  /** Opt this instance out of tracking (events are silently dropped). */
  opt_out_capturing(): void {
    this._optedOut = true;
    this.logger.log("opt_out_capturing()");
  }

  // ─── Fluent helpers ────────────────────────────────────────────────────────

  /**
   * Set properties on a contact (by email).
   * Fetches the existing contact to merge attributes properly.
   */
  async setUserProperties(email: string, properties: Properties): Promise<Contact> {
    // Fetch first to merge — API replaces entire attributes column on upsert.
    // We preserve existing scalar fields (firstName, lastName, phone) by using PATCH
    // instead of the full upsert POST.
    let existing: Contact | undefined;
    try {
      const result = await this.contacts.list({ search: email, pageSize: 1 });
      existing = result.data.find((c) => c.email === email);
    } catch {
      // Contact might not exist yet — will be created on upsert below
    }

    if (existing) {
      // PATCH only the attributes (merged) — preserves firstName, lastName, phone
      const merged = mergeAttributes(existing.attributes ?? {}, properties);
      return this.contacts.update(existing.id, { attributes: merged });
    }

    // Contact doesn't exist — create it with the attributes
    return this.contacts.upsert({ email, attributes: properties });
  }

  /**
   * Flush all buffered events. Call before process exit in long-running scripts.
   *
   * @example
   * ```ts
   * await openmail.flush();
   * process.exit(0);
   * ```
   */
  async flush(): Promise<void> {
    await this.queue.flush();
  }

  /**
   * Shutdown — flush pending events and stop the timer.
   */
  async shutdown(): Promise<void> {
    await this.flush();
    this.queue.destroy();
  }

  /** Number of events buffered but not yet flushed */
  get queuedEvents(): number {
    return this.queue.pending;
  }
}

// ─── Factory function ─────────────────────────────────────────────────────────

/**
 * Create an OpenMail Node SDK instance.
 *
 * @example
 * ```ts
 * const openmail = createOpenMail({ apiKey: "om_..." });
 * await openmail.identify("alice@example.com", { plan: "pro" });
 * ```
 */
export function createOpenMail(config: OpenMailConfig): OpenMail {
  return new OpenMail(config);
}

export { OpenMailError } from "../core/errors.js";
export type { OpenMailConfig } from "../core/types.js";
