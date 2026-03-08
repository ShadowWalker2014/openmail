import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { getApiClient } from "../lib/api-client.js";

export function registerAssetTools(server: McpServer, getClient: () => ReturnType<typeof getApiClient>) {
  // ── list_assets ────────────────────────────────────────────────────────────
  server.tool(
    "list_assets",
    "List all uploaded assets (images, videos, PDFs) in the workspace. Each asset includes a `proxyUrl` that is stable and can be embedded directly in email HTML using an <img src='...'> tag.",
    {},
    async () => {
      const data = await getClient().get("/assets");
      return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
    }
  );

  // ── get_asset ──────────────────────────────────────────────────────────────
  server.tool(
    "get_asset",
    "Get details of a single asset including its stable `proxyUrl` for embedding in emails.",
    { assetId: z.string().describe("Asset ID (ast_xxx)") },
    async ({ assetId }) => {
      const data = await getClient().get(`/assets/${assetId}`);
      return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
    }
  );

  // ── upload_asset_from_url ──────────────────────────────────────────────────
  server.tool(
    "upload_asset_from_url",
    `Upload an image or file from any public URL into the workspace asset library.
The API fetches the file server-side and stores it in S3.
Returns an asset object with a stable \`proxyUrl\` — use this URL in email HTML:
  <img src="{proxyUrl}" alt="...">

Supported types: JPEG, PNG, GIF, WebP, SVG, MP4, WebM, PDF.
Max file size: 25 MB.

Workflow for sending an email with images:
1. upload_asset_from_url  → get proxyUrl
2. create_template with HTML containing <img src="{proxyUrl}">
3. create_broadcast with that templateId
4. send_broadcast`,
    {
      url:  z.string().url().describe("Public URL of the image or file to upload (e.g. https://example.com/banner.jpg)"),
      name: z.string().optional().describe("Optional display name in the asset library"),
    },
    async ({ url, name }) => {
      const data = await getClient().post("/assets/upload-from-url", { url, name });
      return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
    }
  );

  // ── upload_asset_base64 ────────────────────────────────────────────────────
  server.tool(
    "upload_asset_base64",
    `Upload a file from base64-encoded content into the workspace asset library.
Use this when you have file content in memory (e.g. a generated image).
Returns a stable \`proxyUrl\` for embedding in email HTML.

Supported MIME types: image/jpeg, image/png, image/gif, image/webp, image/svg+xml,
video/mp4, video/webm, application/pdf.`,
    {
      content:  z.string().describe("Base64-encoded file content"),
      fileName: z.string().describe("File name with extension, e.g. banner.png"),
      mimeType: z.string().describe("MIME type, e.g. image/png"),
      name:     z.string().optional().describe("Optional display name in the asset library"),
    },
    async ({ content, fileName, mimeType, name }) => {
      const data = await getClient().post("/assets/upload-base64", { content, fileName, mimeType, name });
      return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
    }
  );

  // ── delete_asset ───────────────────────────────────────────────────────────
  server.tool(
    "delete_asset",
    "Permanently delete an asset from storage and the asset library. Warning: any emails using this asset's URL will show a broken image.",
    { assetId: z.string().describe("Asset ID (ast_xxx)") },
    async ({ assetId }) => {
      const data = await getClient().delete(`/assets/${assetId}`);
      return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
    }
  );
}
