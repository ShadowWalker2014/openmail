import { pgTable, text, timestamp, jsonb, boolean } from "drizzle-orm/pg-core";
import { workspaces } from "./workspaces";

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
