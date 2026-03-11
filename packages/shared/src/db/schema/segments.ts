import { pgTable, text, timestamp, jsonb, boolean, primaryKey, index } from "drizzle-orm/pg-core";
import { workspaces } from "./workspaces";
import { contacts } from "./contacts";

export const segments = pgTable("segments", {
  id: text("id").primaryKey(),
  workspaceId: text("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  description: text("description"),
  conditions: jsonb("conditions").notNull().default([]),
  // conditions: [{ field: "attributes.plan", operator: "eq", value: "pro" }]
  conditionLogic: text("condition_logic").notNull().default("and"), // and | or
  isDynamic: boolean("is_dynamic").notNull().default(true),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

/**
 * Tracks the CURRENT segment membership for each contact.
 *
 * A row (segmentId, contactId) means the contact IS currently in that segment.
 * Absence means they are NOT. This snapshot is compared on every
 * contact change to detect `segment_enter` / `segment_exit` transitions
 * and fire the corresponding campaign triggers.
 *
 * Only segments referenced by active segment_enter/segment_exit campaigns
 * have rows here — we never write membership for segments that no
 * campaign cares about.
 */
export const segmentMemberships = pgTable("segment_memberships", {
  workspaceId: text("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
  segmentId:   text("segment_id").notNull().references(() => segments.id,   { onDelete: "cascade" }),
  contactId:   text("contact_id").notNull().references(() => contacts.id,   { onDelete: "cascade" }),
  createdAt:   timestamp("created_at").notNull().defaultNow(),
}, (t) => [
  primaryKey({ columns: [t.segmentId, t.contactId] }),
  index("seg_mem_workspace_idx").on(t.workspaceId),
  index("seg_mem_contact_idx").on(t.contactId),
]);
