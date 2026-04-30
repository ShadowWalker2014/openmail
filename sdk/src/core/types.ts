// ─── Primitives ──────────────────────────────────────────────────────────────

export type Properties = Record<string, unknown>;
export type Traits = Record<string, unknown>;

// ─── Configuration ────────────────────────────────────────────────────────────

export interface OpenMailConfig {
  /** Workspace API key (starts with om_) */
  apiKey: string;
  /** Base URL of your OpenMail API. Defaults to https://api.openmail.win */
  apiUrl?: string;
  /** Number of events to batch before flushing. Default: 20 */
  flushAt?: number;
  /** Max milliseconds between automatic flushes. Default: 10000 */
  flushInterval?: number;
  /** Max retries on transient errors. Default: 3 */
  maxRetries?: number;
  /** Request timeout in ms. Default: 10000 */
  timeout?: number;
  /** Disable all tracking (e.g. in test environments). Default: false */
  disabled?: boolean;
  /** Enable verbose logging. Default: false */
  debug?: boolean;
}

// ─── Contact / User ───────────────────────────────────────────────────────────

export interface Contact {
  id: string;
  workspaceId: string;
  email: string;
  firstName: string | null;
  lastName: string | null;
  phone: string | null;
  attributes: Properties;
  unsubscribed: boolean;
  unsubscribedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface IdentifyOptions {
  /** Contact email. Required if userId is not an email. */
  email?: string;
  firstName?: string;
  lastName?: string;
  phone?: string;
  /** ISO 8601 timestamp for when the identify occurred */
  timestamp?: string;
  /** Additional custom attributes to merge into the contact */
  [key: string]: unknown;
}

export interface CreateContactInput {
  email: string;
  firstName?: string;
  lastName?: string;
  phone?: string;
  attributes?: Properties;
}

export interface UpdateContactInput {
  firstName?: string;
  lastName?: string;
  phone?: string;
  attributes?: Properties;
  unsubscribed?: boolean;
}

export interface ListContactsOptions {
  page?: number;
  pageSize?: number;
  search?: string;
}

export interface PaginatedResponse<T> {
  data: T[];
  total: number;
  page: number;
  pageSize: number;
}

// ─── Events ───────────────────────────────────────────────────────────────────

export interface TrackOptions {
  /** The user's email or contact ID (resolves who performed the event) */
  userId?: string;
  /** ISO 8601 — when the event occurred. Defaults to now. */
  timestamp?: string;
  /** Context object (compatible with Segment/PostHog) */
  context?: EventContext;
}

export interface EventContext {
  ip?: string;
  page?: {
    path?: string;
    referrer?: string;
    search?: string;
    title?: string;
    url?: string;
  };
  userAgent?: string;
  locale?: string;
  library?: { name: string; version: string };
}

export interface TrackResult {
  id: string;
}

export interface EventRecord {
  id: string;
  workspaceId: string;
  contactId: string | null;
  contactEmail: string | null;
  name: string;
  properties: Properties;
  occurredAt: string;
  createdAt: string;
}

// ─── Broadcasts ───────────────────────────────────────────────────────────────

export type BroadcastStatus = "draft" | "scheduled" | "sending" | "sent" | "failed";

export interface Broadcast {
  id: string;
  workspaceId: string;
  name: string;
  subject: string;
  status: BroadcastStatus;
  segmentIds: string[];
  templateId: string | null;
  htmlContent: string | null;
  fromEmail: string | null;
  fromName: string | null;
  recipientCount: number;
  sentCount: number;
  openCount: number;
  clickCount: number;
  scheduledAt: string | null;
  sentAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CreateBroadcastInput {
  name: string;
  subject: string;
  segmentIds: string[];
  htmlContent?: string;
  templateId?: string;
  fromEmail?: string;
  fromName?: string;
  scheduledAt?: string;
}

export interface UpdateBroadcastInput {
  name?: string;
  subject?: string;
  segmentIds?: string[];
  htmlContent?: string;
  templateId?: string;
  fromEmail?: string;
  fromName?: string;
  scheduledAt?: string | null;
}

export interface EmailSend {
  id: string;
  workspaceId: string;
  contactId: string | null;
  contactEmail: string;
  broadcastId: string | null;
  campaignId: string | null;
  campaignStepId: string | null;
  subject: string;
  status: "queued" | "sent" | "failed" | "bounced";
  resendMessageId: string | null;
  sentAt: string | null;
  failedAt: string | null;
  failureReason: string | null;
  createdAt: string;
}

export interface TopLink {
  url: string;
  clicks: number;
}

export interface ListSendsOptions {
  page?: number;
  pageSize?: number;
  status?: "queued" | "sent" | "failed" | "bounced";
}

// ─── Campaigns ────────────────────────────────────────────────────────────────

/**
 * Campaign status — Stage 2 [A2.5] forward-compat brand: accepts known string
 * literals AND any unknown string at compile time, so SDK consumers don't have
 * exhaustive-switch breakages when Stages 3-6 add states (e.g. `migrating`,
 * `replaying`). Union members documented:
 *   - `draft`     never enrolled, fully editable
 *   - `active`    enrolling + processing
 *   - `paused`    no new enrollments; in-flight wait jobs cancelled
 *   - `stopping`  Stage 2: drain in progress (sweeper promotes → stopped)
 *   - `stopped`   Stage 2: terminal stop (drain or force)
 *   - `archived`  terminal — cannot be reactivated
 */
export type CampaignStatus =
  | "draft"
  | "active"
  | "paused"
  | "stopping"
  | "stopped"
  | "archived"
  // eslint-disable-next-line @typescript-eslint/ban-types
  | (string & {});

export type TriggerType = "event" | "segment_enter" | "segment_exit" | "manual";
export type StepType = "email" | "wait";

/**
 * Re-enrollment policy (Stage 2 — REQ-08, [V2.3]).
 * - `never` (default — preserves pre-Stage-2 implicit behaviour)
 * - `always`            re-enter every time trigger fires
 * - `after_cooldown`    re-enter after `re_enrollment_cooldown_seconds`
 * - `on_attribute_change` re-enter only if attributes changed since last enrollment
 */
export type ReEnrollmentPolicy =
  | "never"
  | "always"
  | "after_cooldown"
  | "on_attribute_change";

export interface CampaignStep {
  id: string;
  campaignId: string;
  stepType: StepType;
  position: number;
  config: Properties;
  createdAt: string;
  updatedAt: string;
}

/**
 * Stage 5 — goal-based early exit. A goal is a campaign-scoped condition
 * that, when satisfied by a contact's state, terminates that contact's
 * enrollment via `goal_achieved`. Multiple goals are evaluated with OR
 * semantics — first match wins (position is display-only).
 */
export type CampaignGoalCondition =
  | {
      type: "event";
      eventName: string;
      propertyFilter?: Record<string, unknown>;
      sinceEnrollment?: boolean;
    }
  | {
      type: "attribute";
      attributeKey: string;
      operator: "eq" | "neq" | "gt" | "lt" | "contains" | "exists";
      value?: unknown;
    }
  | {
      type: "segment";
      segmentId: string;
      requireMembership?: boolean;
    };

export interface CampaignGoal {
  id: string;
  campaignId: string;
  workspaceId: string;
  condition: CampaignGoalCondition;
  position: number;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface CreateCampaignGoalInput {
  condition: CampaignGoalCondition;
  position?: number;
  enabled?: boolean;
}

export interface UpdateCampaignGoalInput {
  condition?: CampaignGoalCondition;
  position?: number;
  enabled?: boolean;
}

export interface Campaign {
  id: string;
  workspaceId: string;
  name: string;
  description: string | null;
  status: CampaignStatus;
  triggerType: TriggerType;
  triggerConfig: Properties;
  /** Stage 2 — re-enrollment policy */
  reEnrollmentPolicy: ReEnrollmentPolicy;
  /** Stage 2 — required when reEnrollmentPolicy === "after_cooldown" */
  reEnrollmentCooldownSeconds: number | null;
  createdAt: string;
  updatedAt: string;
  steps?: CampaignStep[];
}

/**
 * Discriminated union for re-enrollment policy: `after_cooldown` REQUIRES
 * cooldown_seconds at compile time. The other 3 variants forbid it.
 */
export type ReEnrollmentInput =
  | { re_enrollment_policy?: "never" | "always" | "on_attribute_change"; re_enrollment_cooldown_seconds?: never }
  | { re_enrollment_policy: "after_cooldown"; re_enrollment_cooldown_seconds: number };

export type CreateCampaignInput = {
  name: string;
  triggerType: TriggerType;
  triggerConfig?: Properties;
  description?: string;
} & ReEnrollmentInput;

export type UpdateCampaignInput = {
  name?: string;
  description?: string;
  status?: CampaignStatus;
  triggerConfig?: Properties;
} & Partial<ReEnrollmentInput>;

/**
 * Stage 2 [V2.10] — common return shape for all lifecycle-aware SDK methods
 * (`.pause`, `.resume`, `.stop`, `.archive`, `.create`, `.update`).
 *
 * `eventSeq` is null for campaign-aggregate events (drain_started, drain_completed,
 * archived, etc.) and a positive integer for per-enrollment events. Callers
 * use eventId for forensic queries and eventSeq for replay ordering.
 */
export interface CampaignLifecycleResult {
  campaign: Campaign;
  eventId?: string;
  eventSeq?: number | null;
  /** Lifecycle op-id correlation (matches X-Lifecycle-Op-Id request header). */
  lifecycle_op_id?: string;
  /** stop-force only — number of enrollments cancelled (Stage 2 T13). */
  cancelled?: number;
  /** archive only — true when the campaign was already archived (idempotent path). */
  idempotent?: boolean;
}

/**
 * Stage 3 [A3.1] — resume modes (extended from Stage 2's literal-only).
 *
 * - `immediate`: send all overdue messages at once (Stage 2 default; safe for
 *   short pauses but DANGEROUS for >24h pauses).
 * - `spread`: distribute overdue sends across a time window (RECOMMENDED for
 *   long pauses).
 * - `skip_stale`: drop messages whose scheduled_at is older than the
 *   threshold; advance the enrollments to next step.
 * - `skip_stale_spread`: combined — drop stale, then spread the remainder.
 */
export type ResumeMode =
  | "immediate"
  | "spread"
  | "skip_stale"
  | "skip_stale_spread";

export type SpreadStrategy =
  | "fifo_by_original_time"
  | "fifo_by_resume_time";

/**
 * Stage 3 — discriminated union over resume body shapes. The shape varies by
 * `mode`: spread-bearing modes accept a window + strategy; stale-bearing
 * modes accept a stale threshold.
 */
export type ResumeInput =
  | { mode: "immediate" }
  | {
      mode: "spread";
      spread_window_seconds?: number;
      spread_strategy?: SpreadStrategy;
    }
  | {
      mode: "skip_stale";
      stale_threshold_seconds?: number;
    }
  | {
      mode: "skip_stale_spread";
      spread_window_seconds?: number;
      stale_threshold_seconds?: number;
      spread_strategy?: SpreadStrategy;
    };

/**
 * Stage 2 stop body — discriminated union enforces `confirm_force: true`
 * literal at compile time when `mode === "force"`.
 */
export type StopInput =
  | { mode: "drain" }
  | { mode: "force"; confirm_force: true };

/** Archive body — TS literal hard requirement (`confirm_terminal: true`). */
export interface ArchiveInput {
  confirm_terminal: true;
}

export interface CreateStepInput {
  stepType: StepType;
  config?: Properties;
  position?: number;
}

export interface UpdateStepInput {
  config?: Properties;
  position?: number;
}

// ─── Segments ─────────────────────────────────────────────────────────────────

export type ConditionOperator =
  | "eq" | "ne" | "gt" | "lt" | "gte" | "lte"
  | "contains" | "not_contains"
  | "exists" | "not_exists";

export interface SegmentCondition {
  field: string;
  operator: ConditionOperator;
  value?: string | number | boolean;
}

export interface Segment {
  id: string;
  workspaceId: string;
  name: string;
  description: string | null;
  conditions: SegmentCondition[];
  conditionLogic: "and" | "or";
  createdAt: string;
  updatedAt: string;
}

export interface CreateSegmentInput {
  name: string;
  conditions: SegmentCondition[];
  conditionLogic?: "and" | "or";
  description?: string;
}

export interface UpdateSegmentInput {
  name?: string;
  conditions?: SegmentCondition[];
  conditionLogic?: "and" | "or";
  description?: string;
}

export interface SegmentUsage {
  broadcasts: Array<{ id: string; name: string }>;
  campaigns: Array<{ id: string; name: string }>;
}

// ─── Templates ────────────────────────────────────────────────────────────────

export interface EmailTemplate {
  id: string;
  workspaceId: string;
  name: string;
  subject: string;
  previewText: string | null;
  htmlContent: string;
  createdAt: string;
  updatedAt: string;
}

export interface CreateTemplateInput {
  name: string;
  subject: string;
  htmlContent: string;
  previewText?: string;
}

export interface UpdateTemplateInput {
  name?: string;
  subject?: string;
  htmlContent?: string;
  previewText?: string;
}

// ─── Analytics ────────────────────────────────────────────────────────────────

/** Workspace analytics overview — last 30 days. Rates are percentages (0–100). */
export interface WorkspaceAnalytics {
  /** Total contacts in the workspace */
  contacts: number;
  /** Email sends in the last 30 days */
  sends: number;
  /** Open events in the last 30 days */
  opens: number;
  /** Click events in the last 30 days */
  clicks: number;
  /** Unsubscribe events in the last 30 days */
  unsubscribes: number;
  /** Open rate as a percentage, e.g. 24.3 means 24.3% */
  openRate: number;
  /** Click rate as a percentage, e.g. 5.1 means 5.1% */
  clickRate: number;
  /** Period identifier, e.g. "30d" */
  period: string;
}

/** Broadcast performance analytics. Rates are percentages (0–100). */
export interface BroadcastAnalytics {
  broadcastId: string;
  sentCount: number;
  openCount: number;
  clickCount: number;
  /** Open rate as a percentage, e.g. 24.3 means 24.3% */
  openRate: number;
  /** Click rate as a percentage, e.g. 5.1 means 5.1% */
  clickRate: number;
  /** Additional dynamic keys: one count per email event type (open, click, bounce, etc.) */
  [key: string]: number | string;
}

// ─── Groups ───────────────────────────────────────────────────────────────────

export interface Group {
  id: string;
  workspaceId: string;
  groupType: string;
  groupKey: string;
  /** Can be null when the DB DEFAULT didn't populate it (e.g. manually created rows). */
  attributes: Properties | null;
  createdAt: string;
  updatedAt: string;
}

export interface CreateGroupInput {
  groupType?: string;
  groupKey: string;
  attributes?: Properties;
}

export interface GroupMembership {
  /** Subset of Contact fields returned by the groups/:id/contacts endpoint. */
  contact: Pick<Contact, "id" | "email" | "firstName" | "lastName"> & {
    attributes: Properties | null;
  };
  role: string | null;
  joinedAt: string;
}

// ─── Assets ───────────────────────────────────────────────────────────────────

export interface Asset {
  id: string;
  workspaceId: string;
  name: string | null;
  fileName: string;
  mimeType: string;
  size: number;
  proxyUrl: string;
  createdAt: string;
}

export interface UploadFromUrlInput {
  url: string;
  name?: string;
}

export interface UploadBase64Input {
  content: string;
  fileName: string;
  mimeType: string;
  name?: string;
}

export interface PresignedUploadResult {
  assetId: string;
  uploadUrl: string;
  proxyUrl: string;
}

export interface GetUploadUrlInput {
  fileName: string;
  mimeType: string;
  fileSize: number;
  width?: number;
  height?: number;
}

// ─── Segment/PostHog Compatibility ────────────────────────────────────────────

/** Segment Analytics 2.0 compatible interface */
export interface SegmentCompatible {
  identify(userId: string, traits?: Traits, options?: TrackOptions): Promise<Contact>;
  track(event: string, properties?: Properties, options?: TrackOptions): Promise<TrackResult>;
  page(name?: string, properties?: Properties, options?: TrackOptions): Promise<TrackResult>;
  screen(name?: string, properties?: Properties, options?: TrackOptions): Promise<TrackResult>;
  group(groupId: string, traits?: Traits, options?: TrackOptions & { groupType?: string }): Promise<TrackResult>;
  alias(userId: string, previousId: string): Promise<void>;
  reset(): void;
}

/**
 * PostHog compatible interface.
 * Note: PostHog's group() takes (type, key, props) while Segment takes (id, traits).
 * OpenMail implements Segment's group() signature; use groupPostHog() for PostHog-style.
 */
export interface PostHogCompatible {
  capture(event: string, properties?: Properties): Promise<TrackResult>;
  identify(distinctId: string, properties?: Properties): Promise<Contact>;
  /** PostHog group identify — `group(type, key, properties)` */
  groupPostHog?(groupType: string, groupKey: string, groupProperties?: Properties): Promise<TrackResult>;
  reset(): void;
  opt_in_capturing(): void;
  opt_out_capturing(): void;
}

// ─── Errors ───────────────────────────────────────────────────────────────────

export type OpenMailErrorCode =
  | "UNAUTHORIZED"
  | "NOT_FOUND"
  | "VALIDATION_ERROR"
  | "RATE_LIMITED"
  | "SERVER_ERROR"
  | "NETWORK_ERROR"
  | "TIMEOUT"
  | "DISABLED";

export interface ApiErrorResponse {
  error: string;
  details?: unknown;
}
