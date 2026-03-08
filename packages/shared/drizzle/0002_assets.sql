CREATE TABLE IF NOT EXISTS "assets" (
  "id" text PRIMARY KEY NOT NULL,
  "workspace_id" text NOT NULL,
  "name" text NOT NULL,
  "file_name" text NOT NULL,
  "mime_type" text NOT NULL,
  "file_size" integer NOT NULL,
  "s3_key" text NOT NULL UNIQUE,
  "width" integer,
  "height" integer,
  "uploaded_by" text NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL
);
