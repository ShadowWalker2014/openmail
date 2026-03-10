import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

/**
 * Register reusable prompt templates on the MCP server.
 * These appear in Claude's "Prompts" panel and help users
 * quickly scaffold common OpenMail workflows.
 */
export function registerPrompts(server: McpServer) {
  // ── 1. Create a campaign ─────────────────────────────────────────────────────
  server.registerPrompt(
    "create-campaign",
    {
      title: "Create Email Campaign",
      description:
        "Design a complete event-triggered email campaign: define the trigger event, write the email sequence, set up segments, and activate it.",
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

Use the OpenMail MCP tools to:
1. First, call \`list_templates\` to see available templates
2. Create or reuse email templates for each step
3. Create a campaign with the appropriate trigger (event, segment_enter, or manual)
4. Add campaign steps (email + wait nodes) in the right sequence
5. Activate the campaign

Suggest realistic timing between emails and write compelling subject lines and preview text for each.`,
          },
        },
      ],
    })
  );

  // ── 2. Write and send a broadcast ───────────────────────────────────────────
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

Use the OpenMail MCP tools to:
1. \`list_segments\` — find the right segment for this audience (create one with \`create_segment\` if needed)
2. Write the full HTML email with a compelling subject line, preview text, and clear CTA
3. \`create_broadcast\` — create the draft with the HTML content
4. \`send_broadcast\` (or schedule with \`scheduledAt\`) when ready
5. After sending, call \`get_broadcast_analytics\` to check performance

Write professional, concise copy that respects the subscriber's time. Include an unsubscribe link in the footer.`,
          },
        },
      ],
    })
  );

  // ── 3. Build a segment ───────────────────────────────────────────────────────
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

Use the OpenMail MCP tools to:
1. \`get_analytics\` — understand the current workspace data
2. Translate the description into segment conditions using these field types:
   - \`attributes.<key>\` — contact attributes (eq, ne, contains, gt, lt, gte, lte, is_set, is_not_set)
   - \`event.<event_name>\` — whether a contact has triggered an event (is_set / is_not_set)
   - \`group.<group_type>\` — group membership (eq with group_key value)
   - Standard fields: \`email\`, \`firstName\`, \`lastName\`, \`unsubscribed\`
3. \`create_segment\` — create the segment with conditionLogic "and" or "or"
4. \`list_segments\` with the new segment id to verify it returns the expected contacts

Explain your condition logic and estimated audience size.`,
          },
        },
      ],
    })
  );

  // ── 4. Analyze performance ───────────────────────────────────────────────────
  server.registerPrompt(
    "analyze-performance",
    {
      title: "Analyze Email Performance",
      description: "Pull analytics data and provide actionable recommendations to improve open rates, click rates, and conversions.",
      argsSchema: {
        scope: z.enum(["workspace", "broadcast"]).optional().describe("Analyze the whole workspace or a specific broadcast"),
        broadcastId: z.string().optional().describe("Broadcast ID if scope=broadcast"),
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

Use the OpenMail MCP tools to:
${
  scope === "broadcast" && broadcastId
    ? `1. \`get_broadcast_analytics\` for broadcast ${broadcastId}
2. \`get_analytics\` for workspace baseline comparison`
    : `1. \`get_analytics\` for 30-day workspace overview
2. \`list_broadcasts\` — review recent broadcasts`
}

Then provide:
- **Summary**: Key metrics (open rate %, click rate %, unsubscribes)
- **Benchmarks**: Compare to industry averages (SaaS: ~25% open, ~3% click)
- **Top issues**: What's underperforming and why
- **3 concrete actions**: Specific changes to improve results (subject lines, send times, segmentation, etc.)`,
          },
        },
      ],
    })
  );

  // ── 5. Track events setup ────────────────────────────────────────────────────
  server.registerPrompt(
    "setup-event-tracking",
    {
      title: "Set Up Event Tracking",
      description: "Generate the exact code to track user events from your app to trigger OpenMail campaigns.",
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
- Show identify() call on user login/signup
- Show track() calls for each event with relevant properties
- Show group() call if tracking workspace/org memberships
- Include proper error handling and flush() before process exit
- Add comments explaining WHAT triggers each event

For Next.js: show both client-side (useTrack hook) and server-side (serverTrack) patterns.
For Node: show the singleton pattern with flush on shutdown.

The API key should come from environment variables (OPENMAIL_API_KEY server-side, NEXT_PUBLIC_OPENMAIL_KEY client-side).`,
          },
        },
      ],
    })
  );

  // ── 6. Group identify workflow ───────────────────────────────────────────────
  server.registerPrompt(
    "group-identify",
    {
      title: "Group Identify Workflow",
      description: "Set up group/organization tracking: link contacts to companies or teams, and use group membership in segments.",
      argsSchema: {
        groupType: z.string().optional().describe("Type of group: company, team, project (default: company)"),
        useCase: z.string().describe("What are you grouping? e.g. 'SaaS customers by company', 'users by team within a company'"),
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

Use the OpenMail MCP tools to:
1. Check existing groups: \`list_contacts\` to understand your data model
2. Create a sample group to test the workflow — use the \`create_group\` tool if available or the /api/v1/groups REST endpoint
3. Link contacts to the group
4. Create a segment that filters by group membership:
   - Field: \`group.${groupType}\`
   - Operator: \`eq\` with the group key as value
5. Verify the segment returns the right contacts

Also explain how to track group identify from code:
\`\`\`ts
// Server-side
await openmail.group("acme-corp", { name: "Acme Corp", plan: "enterprise" }, {
  userId: "alice@example.com",
  groupType: "${groupType}",
});

// Then use in segments:
// { field: "group.${groupType}", operator: "eq", value: "acme-corp" }
\`\`\``,
          },
        },
      ],
    })
  );
}
