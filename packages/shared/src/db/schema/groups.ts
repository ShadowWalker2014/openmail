import { pgTable, text, timestamp, jsonb, uniqueIndex, index, primaryKey } from "drizzle-orm/pg-core";
import { workspaces } from "./workspaces";
import { contacts } from "./contacts";

/**
 * Groups (organisations, teams, companies, etc.).
 *
 * Compatible with:
 *   - PostHog  : $groupidentify event (group_type + group_key + $group_set)
 *   - Segment  : analytics.group(groupId, traits)
 *   - Customer.io Objects API: PUT /objects/:objectTypeId/:objectId
 *
 * group_type  — category of the group:  "company" | "team" | "project" | any string
 * group_key   — unique identifier within the type:  "acme-corp", "team_42", etc.
 * attributes  — arbitrary key-value properties (name, plan, mrr, …)
 */
export const groups = pgTable("groups", {
  id:          text("id").primaryKey(),
  workspaceId: text("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
  groupType:   text("group_type").notNull().default("company"),
  groupKey:    text("group_key").notNull(),
  attributes:  jsonb("attributes").default({}),
  createdAt:   timestamp("created_at").notNull().defaultNow(),
  updatedAt:   timestamp("updated_at").notNull().defaultNow(),
}, (t) => [
  // Each (workspace, type, key) triple is unique
  uniqueIndex("groups_workspace_type_key_idx").on(t.workspaceId, t.groupType, t.groupKey),
  index("groups_workspace_idx").on(t.workspaceId),
]);

/**
 * Many-to-many: contacts ↔ groups
 * Stores which contacts belong to which groups, optionally with a role.
 */
export const contactGroups = pgTable("contact_groups", {
  workspaceId: text("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
  contactId:   text("contact_id").notNull().references(() => contacts.id, { onDelete: "cascade" }),
  groupId:     text("group_id").notNull().references(() => groups.id, { onDelete: "cascade" }),
  role:        text("role"),  // optional — e.g. "owner", "member", "admin"
  createdAt:   timestamp("created_at").notNull().defaultNow(),
}, (t) => [
  primaryKey({ columns: [t.contactId, t.groupId] }),
  index("contact_groups_group_idx").on(t.groupId),
  index("contact_groups_workspace_idx").on(t.workspaceId),
]);
