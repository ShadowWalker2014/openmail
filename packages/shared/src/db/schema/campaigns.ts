import { pgTable, text, timestamp, jsonb, integer, uniqueIndex } from "drizzle-orm/pg-core";
import { workspaces } from "./workspaces";

export const campaigns = pgTable("campaigns", {
  id: text("id").primaryKey(),
  workspaceId: text("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  description: text("description"),
  status: text("status").notNull().default("draft"),
  triggerType: text("trigger_type").notNull(),
  triggerConfig: jsonb("trigger_config").notNull().default({}),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const campaignSteps = pgTable("campaign_steps", {
  id: text("id").primaryKey(),
  campaignId: text("campaign_id").notNull().references(() => campaigns.id, { onDelete: "cascade" }),
  workspaceId: text("workspace_id").notNull(),
  stepType: text("step_type").notNull(),
  config: jsonb("config").notNull().default({}),
  position: integer("position").notNull().default(0),
  nextStepId: text("next_step_id"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const campaignEnrollments = pgTable("campaign_enrollments", {
  id: text("id").primaryKey(),
  campaignId: text("campaign_id").notNull().references(() => campaigns.id, { onDelete: "cascade" }),
  workspaceId: text("workspace_id").notNull(),
  contactId: text("contact_id").notNull(),
  currentStepId: text("current_step_id"),
  status: text("status").notNull().default("active"),
  startedAt: timestamp("started_at").notNull().defaultNow(),
  completedAt: timestamp("completed_at"),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (t) => [
  uniqueIndex("campaign_enrollments_campaign_contact_idx").on(t.campaignId, t.contactId),
]);
