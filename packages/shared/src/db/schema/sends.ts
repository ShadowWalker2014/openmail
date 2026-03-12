import { pgTable, text, timestamp, jsonb, index } from "drizzle-orm/pg-core";
import { workspaces } from "./workspaces";
import { contacts } from "./contacts";

export const emailSends = pgTable("email_sends", {
  id: text("id").primaryKey(),
  workspaceId: text("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
  contactId: text("contact_id").references(() => contacts.id, { onDelete: "set null" }),
  contactEmail: text("contact_email").notNull(),
  broadcastId: text("broadcast_id"),
  campaignId: text("campaign_id"),
  campaignStepId: text("campaign_step_id"),
  subject: text("subject").notNull(),
  status: text("status").notNull().default("queued"), // queued | sent | failed | bounced
  resendMessageId: text("resend_message_id"),
  sentAt: timestamp("sent_at"),
  failedAt: timestamp("failed_at"),
  failureReason: text("failure_reason"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (t) => [
  index("email_sends_workspace_idx").on(t.workspaceId),
  index("email_sends_contact_idx").on(t.contactId),
  index("email_sends_broadcast_idx").on(t.broadcastId),
  index("email_sends_resend_msg_idx").on(t.resendMessageId),
  index("email_sends_campaign_idx").on(t.campaignId),
  index("email_sends_created_at_idx").on(t.createdAt),
]);

export const emailEvents = pgTable("email_events", {
  id: text("id").primaryKey(),
  workspaceId: text("workspace_id").notNull(),
  sendId: text("send_id").references(() => emailSends.id, { onDelete: "set null" }),
  contactId: text("contact_id"),
  eventType: text("event_type").notNull(), // open | click | bounce | complaint | unsubscribe
  metadata: jsonb("metadata").default({}),
  // click: { url: "https://..." }
  occurredAt: timestamp("occurred_at").notNull().defaultNow(),
}, (t) => [
  index("email_events_send_idx").on(t.sendId),
  index("email_events_workspace_type_idx").on(t.workspaceId, t.eventType),
  index("email_events_occurred_at_idx").on(t.occurredAt),
]);
