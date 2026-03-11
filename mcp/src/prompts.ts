import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

const DOCS_URL = process.env.OPENMAIL_DOCS_URL ?? "https://openmail.win/docs";

/**
 * Register reusable prompt templates on the MCP server.
 * These appear in Claude's "Prompts" panel and scaffold common OpenMail workflows.
 *
 * IMPORTANT: prompts describe WHAT to achieve, not which specific tool names to call.
 * Tool names and API endpoints change — the AI discovers them via the tool list
 * and the live documentation at ${DOCS_URL}/llms.txt.
 */
export function registerPrompts(server: McpServer) {
  // ── 1. Create a campaign ─────────────────────────────────────────────────
  server.registerPrompt(
    "create-campaign",
    {
      title: "Create Email Campaign",
      description:
        "Design a complete event-triggered email campaign: define the trigger, write the email sequence, and activate it.",
      argsSchema: {
        goal: z.string().describe("What should this campaign achieve? e.g. 'onboard new users', 'recover churned customers'"),
        triggerEvent: z.string().optional().describe("The event that starts the campaign, e.g. 'user_signed_up'"),
        emailCount: z.number().optional().describe("How many emails in the sequence (default: 3)"),
      },
    },
    ({ goal, triggerEvent, emailCount = 3 }) => ({
      messages: [
        {
          role: "user",
          content: {
            type: "text",
            text: `You are an email marketing expert using OpenMail. Create a complete email campaign to achieve this goal:

**Goal:** ${goal}
${triggerEvent ? `**Trigger event:** \`${triggerEvent}\`` : ""}
**Email count:** ${emailCount} emails in the sequence

Use the available MCP tools to:
1. Check what templates already exist in the workspace
2. Create or reuse email templates for each step
3. Create a campaign with the appropriate trigger (event, segment_enter, or manual)
4. Add campaign steps with email sends and wait delays in the right sequence
5. Activate the campaign when ready

For full API and tool reference, read the docs: ${DOCS_URL}/llms.txt

Suggest realistic timing between emails and write compelling subject lines and preview text for each.`,
          },
        },
      ],
    })
  );

  // ── 2. Write and send a broadcast ────────────────────────────────────────
  server.registerPrompt(
    "create-broadcast",
    {
      title: "Write & Send Broadcast Email",
      description:
        "Draft a broadcast email to a segment, write compelling copy, review it, and send or schedule it.",
      argsSchema: {
        topic: z.string().describe("What is this email about? e.g. 'new feature launch', 'Black Friday sale'"),
        audience: z.string().optional().describe("Who is the target audience? e.g. 'all pro users', 'inactive users'"),
        tone: z.enum(["professional", "casual", "urgent", "celebratory"]).optional().describe("Email tone"),
        scheduledAt: z.string().optional().describe("ISO 8601 datetime to schedule, or omit to send immediately"),
      },
    },
    ({ topic, audience = "all active contacts", tone = "professional", scheduledAt }) => ({
      messages: [
        {
          role: "user",
          content: {
            type: "text",
            text: `You are an email copywriter and marketer using OpenMail. Write and send a broadcast email.

**Topic:** ${topic}
**Audience:** ${audience}
**Tone:** ${tone}
${scheduledAt ? `**Schedule for:** ${scheduledAt}` : "**Send:** immediately"}

Use the available MCP tools to:
1. Find or create the right audience segment for this email
2. Write the full HTML email with a compelling subject line, preview text, and clear CTA
3. Create the broadcast draft
4. Send immediately or schedule it for the specified time
5. Check analytics after sending to measure performance

For full API and tool reference, read the docs: ${DOCS_URL}/llms.txt

Write professional, concise copy. Include an unsubscribe link in the footer.`,
          },
        },
      ],
    })
  );

  // ── 3. Build a segment ───────────────────────────────────────────────────
  server.registerPrompt(
    "build-segment",
    {
      title: "Build Audience Segment",
      description:
        "Define a dynamic audience segment using contact attributes, event history, or group membership.",
      argsSchema: {
        description: z.string().describe("Describe the audience in plain English, e.g. 'users on pro plan who upgraded in last 30 days'"),
        purpose: z.string().optional().describe("How will this segment be used? e.g. 'upsell campaign', 'churn prevention'"),
      },
    },
    ({ description, purpose }) => ({
      messages: [
        {
          role: "user",
          content: {
            type: "text",
            text: `You are a data analyst using OpenMail. Build a precise audience segment.

**Audience:** ${description}
${purpose ? `**Purpose:** ${purpose}` : ""}

Use the available MCP tools to:
1. Check current workspace analytics to understand the data
2. Translate the description into segment conditions. Supported field types:
   - \`attributes.<key>\` — contact attributes with operators: eq, ne, gt, lt, gte, lte, contains, not_contains, is_set, is_not_set
   - \`event.<event_name>\` — whether a contact has triggered a named event: is_set, is_not_set
   - \`group.<group_type>\` — group membership: eq (specific group key), is_set, is_not_set, ne
   - Standard contact fields: email, firstName, lastName, phone, unsubscribed
3. Create the segment with conditionLogic "and" or "or" as appropriate
4. Verify the segment returns the expected contacts

For full segment condition docs, see: ${DOCS_URL}/api/segments
For full API and tool reference: ${DOCS_URL}/llms.txt

Explain your condition logic and estimated audience size.`,
          },
        },
      ],
    })
  );

  // ── 4. Analyze performance ───────────────────────────────────────────────
  server.registerPrompt(
    "analyze-performance",
    {
      title: "Analyze Email Performance",
      description: "Pull analytics data and provide actionable recommendations to improve open rates, click rates, and conversions.",
      argsSchema: {
        scope: z.enum(["workspace", "broadcast"]).optional().describe("Analyze the whole workspace or a specific broadcast"),
        broadcastId: z.string().optional().describe("Broadcast ID to analyze (required if scope=broadcast)"),
      },
    },
    ({ scope = "workspace", broadcastId }) => ({
      messages: [
        {
          role: "user",
          content: {
            type: "text",
            text: `You are an email marketing analyst using OpenMail. Analyze performance and give recommendations.

**Scope:** ${scope}${broadcastId ? ` — broadcast ${broadcastId}` : ""}

Use the available MCP tools to pull the relevant analytics data${broadcastId ? ` for broadcast ${broadcastId}` : " for the workspace"}, then provide:

- **Summary**: Key metrics (open rate %, click rate %, unsubscribes)
- **Benchmarks**: Compare to industry averages (SaaS: ~25% open, ~3% click)
- **Top issues**: What's underperforming and why
- **3 concrete actions**: Specific changes to improve results (subject lines, send times, segmentation, etc.)

For full API and tool reference, read the docs: ${DOCS_URL}/llms.txt`,
          },
        },
      ],
    })
  );

  // ── 5. Set up event tracking ─────────────────────────────────────────────
  server.registerPrompt(
    "setup-event-tracking",
    {
      title: "Set Up Event Tracking",
      description: "Generate production-ready code to track user events from your app and trigger OpenMail campaigns.",
      argsSchema: {
        stack: z.enum(["nextjs", "react", "node", "python", "curl"]).describe("Your tech stack"),
        events: z.string().describe("Comma-separated events to track, e.g. 'user_signed_up, plan_upgraded, feature_used'"),
        apiUrl: z.string().optional().describe("Your OpenMail API URL (defaults to https://api.openmail.win)"),
      },
    },
    ({ stack, events, apiUrl = "https://api.openmail.win" }) => ({
      messages: [
        {
          role: "user",
          content: {
            type: "text",
            text: `Generate complete, production-ready code to track these events from a ${stack} app to OpenMail.

**Stack:** ${stack}
**Events to track:** ${events}
**API URL:** ${apiUrl}

Requirements:
- Use the @openmail/sdk package (npm install @openmail/sdk)
- Show identify() on user login/signup to create/update the contact profile
- Show track() for each event with relevant properties
- Show group() if tracking workspace/org memberships
- Include proper error handling and flush() before process exit
- Use environment variables for the API key (OPENMAIL_API_KEY server-side, NEXT_PUBLIC_OPENMAIL_KEY client-side)

For Next.js: show both client-side (React hooks) and server-side (server actions / route handlers) patterns.
For Node: show the singleton pattern with flush on shutdown.

SDK documentation: ${DOCS_URL}/sdk/event-ingestion
Full SDK guide: ${DOCS_URL}/sdk/overview`,
          },
        },
      ],
    })
  );

  // ── 6. Group identify workflow ───────────────────────────────────────────
  server.registerPrompt(
    "group-identify",
    {
      title: "Group Identify Workflow",
      description: "Set up group/organization tracking: link contacts to companies or teams and use group membership in segments.",
      argsSchema: {
        groupType: z.string().optional().describe("Type of group: company, team, project (default: company)"),
        useCase: z.string().describe("What are you grouping? e.g. 'SaaS customers by company', 'users by team'"),
      },
    },
    ({ groupType = "company", useCase }) => ({
      messages: [
        {
          role: "user",
          content: {
            type: "text",
            text: `You are setting up group/organization tracking in OpenMail.

**Group type:** ${groupType}
**Use case:** ${useCase}

Use the available MCP tools to:
1. Understand the current workspace contacts and data model
2. Create a group entity of type "${groupType}" with relevant attributes (name, plan, etc.)
3. Link contacts to the group
4. Create a segment that filters by group membership — use field \`group.${groupType}\` with operator \`eq\` and the group key as value
5. Verify the segment returns the right contacts

From application code, use the SDK to track group membership:
\`\`\`ts
await openmail.group("acme-corp", { name: "Acme Corp", plan: "enterprise" }, {
  userId: "alice@example.com",
  groupType: "${groupType}",
});

// Then filter contacts in a segment:
// { field: "group.${groupType}", operator: "eq", value: "acme-corp" }
\`\`\`

Group tracking docs: ${DOCS_URL}/sdk/event-ingestion
Full API and tool reference: ${DOCS_URL}/llms.txt`,
          },
        },
      ],
    })
  );
}
