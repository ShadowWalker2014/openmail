import { pgTable, text, timestamp, jsonb, boolean } from "drizzle-orm/pg-core";
import { workspaces } from "./workspaces";

export const emailTemplates = pgTable("email_templates", {
  id: text("id").primaryKey(),
  workspaceId: text("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  subject: text("subject").notNull(),
  previewText: text("preview_text"),
  htmlContent: text("html_content").notNull(),
  jsonContent: jsonb("json_content"), // visual builder JSON
  isVisual: boolean("is_visual").notNull().default(false),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});
