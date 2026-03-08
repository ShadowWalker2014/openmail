import { pgTable, text, timestamp, jsonb, integer } from "drizzle-orm/pg-core";
import { workspaces } from "./workspaces.js";

export const broadcasts = pgTable("broadcasts", {
  id: text("id").primaryKey(),
  workspaceId: text("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  subject: text("subject").notNull(),
  templateId: text("template_id"),
  htmlContent: text("html_content"),
  fromEmail: text("from_email"),
  fromName: text("from_name"),
  segmentIds: jsonb("segment_ids").notNull().default([]), // array of segment IDs
  status: text("status").notNull().default("draft"), // draft | scheduled | sending | sent | failed
  scheduledAt: timestamp("scheduled_at"),
  sentAt: timestamp("sent_at"),
  recipientCount: integer("recipient_count").default(0),
  sentCount: integer("sent_count").default(0),
  openCount: integer("open_count").default(0),
  clickCount: integer("click_count").default(0),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});
