import { pgTable, text, integer, timestamp } from "drizzle-orm/pg-core";

export const assets = pgTable("assets", {
  id:          text("id").primaryKey(),
  workspaceId: text("workspace_id").notNull(),
  name:        text("name").notNull(),           // user-friendly display name
  fileName:    text("file_name").notNull(),       // original filename
  mimeType:    text("mime_type").notNull(),
  fileSize:    integer("file_size").notNull(),    // bytes
  s3Key:       text("s3_key").notNull().unique(), // path in bucket
  width:       integer("width"),                  // px, images only
  height:      integer("height"),                 // px, images only
  uploadedBy:  text("uploaded_by").notNull(),     // user.id
  createdAt:   timestamp("created_at").notNull().defaultNow(),
});
