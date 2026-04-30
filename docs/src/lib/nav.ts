export interface NavItem {
  title: string;
  href: string;
  description?: string;
}

export interface NavGroup {
  group: string;
  items: NavItem[];
}

export const navGroups: NavGroup[] = [
  {
    group: "Getting Started",
    items: [
      {
        title: "Introduction",
        href: "/getting-started/introduction",
        description: "What OpenMail is and why it exists",
      },
      {
        title: "Quick Start",
        href: "/getting-started/quickstart",
        description: "Get up and running in minutes",
      },
      {
        title: "Configuration",
        href: "/getting-started/configuration",
        description: "Environment variables and service config",
      },
      {
        title: "Email Setup",
        href: "/getting-started/email-setup",
        description: "Configure Resend for sending emails",
      },
    ],
  },
  {
    group: "REST API",
    items: [
      {
        title: "Authentication",
        href: "/api/authentication",
        description: "API keys and session auth",
      },
      {
        title: "Contacts",
        href: "/api/contacts",
        description: "Create, update, delete contacts",
      },
      {
        title: "Broadcasts",
        href: "/api/broadcasts",
        description: "One-off email campaigns",
      },
      {
        title: "Campaigns",
        href: "/api/campaigns",
        description: "Event-triggered automation flows",
      },
      {
        title: "Segments",
        href: "/api/segments",
        description: "Rule-based contact groups",
      },
      {
        title: "Templates",
        href: "/api/templates",
        description: "Reusable email templates",
      },
      {
        title: "Events",
        href: "/api/events",
        description: "Track customer activity",
      },
      {
        title: "Analytics",
        href: "/api/analytics",
        description: "Open rates, clicks, and performance",
      },
      {
        title: "Assets",
        href: "/api/assets",
        description: "Upload and manage images and files",
      },
    ],
  },
  {
    group: "MCP Server",
    items: [
      {
        title: "Overview",
        href: "/mcp/overview",
        description: "What the MCP server is and how it works",
      },
      {
        title: "Quick Connect",
        href: "/mcp/quickstart",
        description: "Connect Claude, Cursor, or any AI agent",
      },
      {
        title: "Contacts",
        href: "/mcp/contacts",
        description: "list_contacts, create_contact, track_event",
      },
      {
        title: "Broadcasts",
        href: "/mcp/broadcasts",
        description: "create_broadcast, send_broadcast, schedule_broadcast",
      },
      {
        title: "Campaigns",
        href: "/mcp/campaigns",
        description: "create_campaign, update_campaign, pause_campaign",
      },
      {
        title: "Segments",
        href: "/mcp/segments",
        description: "list_segments, create_segment",
      },
      {
        title: "Templates",
        href: "/mcp/templates",
        description: "create_template, update_template",
      },
      {
        title: "Analytics",
        href: "/mcp/analytics",
        description: "get_analytics, get_broadcast_analytics",
      },
      {
        title: "Assets",
        href: "/mcp/assets",
        description: "upload_asset_from_url, upload_asset_base64",
      },
    ],
  },
  {
    group: "SDK",
    items: [
      {
        title: "Overview",
        href: "/sdk/overview",
        description: "SDK entry points, Segment/PostHog compatibility, error handling",
      },
      {
        title: "Event Ingestion",
        href: "/sdk/event-ingestion",
        description: "Track events from any language — PostHog & Customer.io compatible",
      },
      {
        title: "Node.js / Server",
        href: "/sdk/node",
        description: "Full API coverage, batching, retry, Segment-compatible",
      },
      {
        title: "Browser",
        href: "/sdk/browser",
        description: "Auto page tracking, anonymous IDs, localStorage/cookie",
      },
      {
        title: "React",
        href: "/sdk/react",
        description: "useTrack, useIdentify, useAutoIdentify, OpenMailProvider",
      },
      {
        title: "Next.js",
        href: "/sdk/nextjs",
        description: "serverTrack, serverIdentify, App Router + Pages Router",
      },
    ],
  },
  {
    group: "Project",
    items: [
      {
        title: "Roadmap",
        href: "/roadmap",
        description: "Stable / Beta / Roadmap — what ships when",
      },
    ],
  },
  {
    group: "Self-Hosting",
    items: [
      {
        title: "Overview",
        href: "/self-hosting/overview",
        description: "Architecture and deployment options",
      },
      {
        title: "Railway",
        href: "/self-hosting/railway",
        description: "Deploy to Railway in minutes",
      },
      {
        title: "Docker Compose",
        href: "/self-hosting/docker",
        description: "Run everything locally with Docker",
      },
    ],
  },
];

export function flatNav(): NavItem[] {
  return navGroups.flatMap((g) => g.items);
}

export function findNavItem(href: string): NavItem | undefined {
  return flatNav().find((item) => item.href === href);
}

export function getPrevNext(href: string): { prev?: NavItem; next?: NavItem } {
  const flat = flatNav();
  const idx = flat.findIndex((item) => item.href === href);
  return {
    prev: idx > 0 ? flat[idx - 1] : undefined,
    next: idx < flat.length - 1 ? flat[idx + 1] : undefined,
  };
}
