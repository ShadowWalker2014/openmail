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
  CampaignLifecycleResult,
  ResumeMode,
  ResumeInput,
  StopInput,
  ArchiveInput,
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
  Group,
  CreateGroupInput,
  GroupMembership,
  CampaignGoal,
  CreateCampaignGoalInput,
  UpdateCampaignGoalInput,
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

  /**
   * Create a campaign. Stage 2 [V2.3]: optional `re_enrollment_policy` field
   * (default `'never'`). When set to `'after_cooldown'`, the SDK enforces
   * `re_enrollment_cooldown_seconds` at compile time via discriminated union.
   */
  async create(input: CreateCampaignInput): Promise<Campaign> {
    return this.http.post<Campaign>("/api/v1/campaigns", input);
  }

  /**
   * Update a campaign. Stage 2 [V2.3]: re_enrollment_policy is now updatable
   * on `draft|active|paused`; rejected with HTTP 409 on `stopping|stopped|archived`
   * per [CR-13]. Setting `status` is DEPRECATED — prefer `.pause()`, `.resume()`,
   * `.stop()`, `.archive()` for richer audit trail.
   */
  async update(id: string, input: UpdateCampaignInput): Promise<Campaign> {
    return this.http.patch<Campaign>(`/api/v1/campaigns/${id}`, input);
  }

  /**
   * Activate (draft → active). Calls the legacy PATCH-status alias because
   * activate has no dedicated verb endpoint in Stage 2; activation is the
   * only forward-progressing transition where re-using PATCH is safe.
   */
  async activate(id: string): Promise<Campaign> {
    return this.update(id, { status: "active" });
  }

  /**
   * Pause an active campaign (Stage 2 [V2.10] return shape).
   * `active → paused` only; throws on illegal transitions (HTTP 409).
   */
  async pause(id: string): Promise<CampaignLifecycleResult> {
    return this.http.post<CampaignLifecycleResult>(
      `/api/v1/campaigns/${id}/pause`,
    );
  }

  /**
   * Resume a paused campaign. Stage 3 supports four modes:
   *  - `immediate`: send all overdue at once (default).
   *  - `spread`: distribute overdue sends across a time window.
   *  - `skip_stale`: drop messages older than threshold, advance enrollments.
   *  - `skip_stale_spread`: combine — drop stale + spread the remainder.
   *
   * Recommended: use `spread` or `skip_stale_spread` for pauses longer than 24h.
   *
   * Discriminated-union typed input: TS infers the shape from `mode`.
   */
  async resume(
    id: string,
    opts?: { mode?: ResumeMode } | ResumeInput,
  ): Promise<CampaignLifecycleResult> {
    // Backwards-compat shape: { mode } with no other params is allowed.
    const body: ResumeInput =
      !opts || typeof (opts as { mode?: ResumeMode }).mode === "undefined"
        ? { mode: "immediate" }
        : (opts as ResumeInput);
    return this.http.post<CampaignLifecycleResult>(
      `/api/v1/campaigns/${id}/resume`,
      body,
    );
  }

  /**
   * Stop a campaign — drain (graceful) or force (immediate cancel).
   *
   * - `mode: "drain"` — flips to `stopping`; the BullMQ sweeper promotes to
   *   `stopped` once in-flight enrollments finish naturally.
   * - `mode: "force", confirm_force: true` — cancels all pending wait jobs
   *   immediately and force-exits in-flight enrollments. The
   *   `confirm_force: true` literal is REQUIRED at compile time.
   */
  async stop(id: string, input: StopInput): Promise<CampaignLifecycleResult> {
    return this.http.post<CampaignLifecycleResult>(
      `/api/v1/campaigns/${id}/stop`,
      input,
    );
  }

  /**
   * Archive a campaign — TERMINAL operation, cannot be reactivated.
   * `confirm_terminal: true` literal REQUIRED at compile time. Idempotent on
   * already-archived campaigns (returns `idempotent: true`).
   */
  async archive(
    id: string,
    input: ArchiveInput,
  ): Promise<CampaignLifecycleResult> {
    return this.http.post<CampaignLifecycleResult>(
      `/api/v1/campaigns/${id}/archive`,
      input,
    );
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

  /**
   * Stage 4 — Step lifecycle namespace.
   *
   *   client.campaigns.steps(campaignId).pause(stepId)
   *   client.campaigns.steps(campaignId).resume(stepId, { mode: "spread", ... })
   *
   * Per-step pause halts new arrivals at the named step but does NOT affect
   * enrollments at other steps. The granularity is unique among email
   * marketing platforms (Customer.io / Mailchimp pause whole campaigns).
   */
  steps(campaignId: string) {
    const http = this.http;
    return {
      async pause(stepId: string): Promise<{
        step: CampaignStep;
        lifecycle_op_id: string;
        held_count: number;
        cancelled_jobs: number;
        idempotent?: boolean;
      }> {
        return http.post(
          `/api/v1/campaigns/${campaignId}/steps/${stepId}/pause`,
          {},
        );
      },
      async resume(
        stepId: string,
        input: ResumeInput = { mode: "immediate" },
      ): Promise<{
        step: CampaignStep;
        lifecycle_op_id: string;
        mode: ResumeMode;
        held_count: number;
        resumed_count: number;
        idempotent?: boolean;
      }> {
        return http.post(
          `/api/v1/campaigns/${campaignId}/steps/${stepId}/resume`,
          input,
        );
      },
    };
  }

  /**
   * Stage 5 — Campaign goals namespace.
   *
   *   client.campaigns.goals(campaignId).list()
   *   client.campaigns.goals(campaignId).add({ condition: {...} })
   *   client.campaigns.goals(campaignId).update(goalId, { enabled: false })
   *   client.campaigns.goals(campaignId).remove(goalId)
   *
   * Goals are campaign-scoped early-exit conditions evaluated with OR
   * semantics. Editing is allowed on draft / active / paused campaigns;
   * frozen statuses (stopping / stopped / archived) return HTTP 409.
   */
  goals(campaignId: string) {
    const http = this.http;
    return {
      async list(): Promise<CampaignGoal[]> {
        const res = await http.get<{ data: CampaignGoal[] }>(
          `/api/v1/campaigns/${campaignId}/goals`,
        );
        return res.data;
      },
      async add(input: CreateCampaignGoalInput): Promise<CampaignGoal> {
        return http.post<CampaignGoal>(
          `/api/v1/campaigns/${campaignId}/goals`,
          input,
        );
      },
      async update(
        goalId: string,
        input: UpdateCampaignGoalInput,
      ): Promise<CampaignGoal> {
        return http.patch<CampaignGoal>(
          `/api/v1/campaigns/${campaignId}/goals/${goalId}`,
          input,
        );
      },
      async remove(goalId: string): Promise<void> {
        await http.delete(`/api/v1/campaigns/${campaignId}/goals/${goalId}`);
      },
    };
  }

  /**
   * Stage 6 — Enrollment timeline namespace.
   *
   *   client.campaigns.enrollments(campaignId).timeline(enrollmentId, { limit, before, ... })
   *
   * Returns paginated event history for a single enrollment, ordered most
   * recent first. Pass `includeArchive: true` to walk the archive table
   * for events older than the audit retention window (default 180 days).
   */
  enrollments(campaignId: string) {
    const http = this.http;
    return {
      async timeline(
        enrollmentId: string,
        opts?: {
          limit?: number;
          before?: string;
          eventTypes?: string[];
          includeArchive?: boolean;
        },
      ): Promise<{
        data: Array<Record<string, unknown>>;
        pagination: { limit: number; hasMore: boolean; nextBefore: string | null };
      }> {
        const params: Record<string, string | number | undefined> = {};
        if (opts?.limit !== undefined) params.limit = opts.limit;
        if (opts?.before) params.before = opts.before;
        if (opts?.eventTypes && opts.eventTypes.length > 0)
          params.event_types = opts.eventTypes.join(",");
        if (opts?.includeArchive) params.include_archive = "true";
        const q = buildQuery(params);
        return http.get(
          `/api/v1/campaigns/${campaignId}/enrollments/${enrollmentId}/events${q}`,
        );
      },
    };
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

// ─── Groups API ───────────────────────────────────────────────────────────────

class GroupsAPI {
  constructor(private readonly http: HttpClient) {}

  async list(options: { page?: number; pageSize?: number; groupType?: string } = {}): Promise<PaginatedResponse<Group>> {
    const q = buildQuery({ page: options.page, pageSize: options.pageSize, groupType: options.groupType });
    return this.http.get<PaginatedResponse<Group>>(`/api/v1/groups${q}`);
  }

  /**
   * Upsert a group by (groupType, groupKey). Idempotent — safe to call repeatedly.
   * NOTE: On conflict, attributes are fully replaced (not merged).
   */
  async upsert(input: CreateGroupInput): Promise<Group> {
    return this.http.post<Group>("/api/v1/groups", { groupType: "company", ...input });
  }

  /** @deprecated Use {@link upsert} instead. The POST endpoint is always an upsert. */
  async create(input: CreateGroupInput): Promise<Group> {
    return this.upsert(input);
  }

  async get(id: string): Promise<Group> {
    return this.http.get<Group>(`/api/v1/groups/${id}`);
  }

  /**
   * Replace all attributes on the group.
   * @remarks This is a FULL REPLACEMENT — existing attributes not passed here are deleted.
   * Fetch the group first and merge manually if you need partial-update semantics.
   */
  async update(id: string, attributes: Record<string, unknown>): Promise<Group> {
    return this.http.patch<Group>(`/api/v1/groups/${id}`, { attributes });
  }

  async delete(id: string): Promise<void> {
    await this.http.delete(`/api/v1/groups/${id}`);
  }

  async contacts(id: string, options: { page?: number; pageSize?: number } = {}): Promise<PaginatedResponse<GroupMembership>> {
    const q = buildQuery({ page: options.page, pageSize: options.pageSize });
    return this.http.get<PaginatedResponse<GroupMembership>>(`/api/v1/groups/${id}/contacts${q}`);
  }

  async addContact(groupId: string, contactId: string, role?: string): Promise<void> {
    await this.http.post(`/api/v1/groups/${groupId}/contacts`, { contactId, role });
  }

  async removeContact(groupId: string, contactId: string): Promise<void> {
    await this.http.delete(`/api/v1/groups/${groupId}/contacts/${contactId}`);
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
  readonly groups: GroupsAPI;

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
    this.groups = new GroupsAPI(this.http);

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

    // FIX (HIGH): Store the RESOLVED email (not the raw userId argument).
    // When userId is "user_123" and email comes from traits.email, _userId
    // must be the email so that subsequent group() / track() calls send the
    // correct contactEmail. Storing the raw userId caused zombie associations.
    this._userId = normalized.email;

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
   * Upsert a group (organisation, company, team) and optionally link the current user.
   *
   * Compatible with:
   *   - Segment  : `analytics.group(groupId, traits)` — treats groupId as groupKey, groupType="company"
   *   - PostHog  : `posthog.groupIdentify(type, key, properties)` — use `groupPostHog()`
   *
   * @example
   * ```ts
   * // Segment style — groupId is the key, type defaults to "company"
   * await openmail.group("acme-corp", { name: "Acme Corp", plan: "enterprise" }, { userId: "alice@example.com" });
   *
   * // Explicit type
   * await openmail.group("acme-corp", { name: "Acme Corp" }, { userId: "alice@example.com", groupType: "company" });
   * ```
   */
  async group(
    groupId: string,
    traits: Traits = {},
    options: TrackOptions & { groupType?: string } = {},
  ): Promise<TrackResult> {
    if (this.disabled || this._optedOut) return { id: "" };

    const groupType = options.groupType ?? "company";
    const email = options.userId ?? this._userId;

    // Fire-and-forget group upsert to the native /api/ingest/group endpoint
    this.http.post("/api/ingest/group", {
      groupType,
      groupKey: groupId,
      attributes: traits,
      ...(email ? { contactEmail: email } : {}),
    }).catch((err: Error) => {
      this.logger.error("group() upsert failed:", err.message);
    });

    this.logger.log("group()", { groupType, groupId, traits });
    return Promise.resolve({ id: "" });
  }

  /**
   * PostHog-compatible group identify: `groupIdentify(type, key, properties)`.
   *
   * Fires a `$groupidentify` event to the PostHog-compatible ingest endpoint
   * AND upserts the group entity directly.
   *
   * @example
   * ```ts
   * await openmail.groupPostHog("company", "acme-corp", { name: "Acme Corp", plan: "enterprise" });
   * ```
   */
  async groupPostHog(
    groupType: string,
    groupKey: string,
    groupProperties: Properties = {},
  ): Promise<TrackResult> {
    if (this.disabled || this._optedOut) return { id: "" };

    // Upsert the group entity
    this.http.post("/api/ingest/group", {
      groupType,
      groupKey,
      attributes: groupProperties,
      ...(this._userId ? { contactEmail: this._userId } : {}),
    }).catch((err: Error) => {
      this.logger.error("groupPostHog() upsert failed:", err.message);
    });

    // FIX (BUG-1 SDK): Removed the queue push that was sending groupKey as the
    // email field when _userId was undefined. This was storing "acme-corp" as
    // contactEmail in the events table.
    // FIX (BUG-3 SDK): The queue flushes to POST /api/v1/events/track which
    // does NOT handle $groupidentify specially — the group is already upserted
    // above, so a redundant event record serves no purpose.

    this.logger.log("groupPostHog()", { groupType, groupKey });
    return Promise.resolve({ id: "" });
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
