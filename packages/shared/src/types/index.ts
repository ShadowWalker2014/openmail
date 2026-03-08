export type WorkspaceRole = "owner" | "admin" | "member";
export type CampaignStatus = "draft" | "active" | "paused" | "archived";
export type BroadcastStatus = "draft" | "scheduled" | "sending" | "sent" | "failed";
export type EmailSendStatus = "queued" | "sent" | "failed" | "bounced";
export type EmailEventType = "open" | "click" | "bounce" | "complaint" | "unsubscribe";
export type CampaignTriggerType = "event" | "segment_enter" | "segment_exit" | "manual";
export type CampaignStepType = "send_email" | "wait" | "condition" | "add_tag" | "remove_tag";

export interface SegmentCondition {
  field: string;
  operator: "eq" | "ne" | "gt" | "lt" | "gte" | "lte" | "contains" | "not_contains" | "exists" | "not_exists";
  value?: string | number | boolean;
}

export interface PaginatedResponse<T> {
  data: T[];
  total: number;
  page: number;
  pageSize: number;
}
