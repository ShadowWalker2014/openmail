/**
 * @openmail/sdk/nextjs — Next.js helpers
 *
 * Provides:
 * - Server-side tracking (App Router server components / route handlers)
 * - OpenMailProvider re-export for client layout
 * - Utility to read user from Next.js auth cookies
 *
 * @example
 * // app/layout.tsx (client component wrapper)
 * import { OpenMailProvider } from "@openmail/sdk/nextjs";
 *
 * export default function RootLayout({ children }) {
 *   return (
 *     <html>
 *       <body>
 *         <OpenMailProvider apiKey={process.env.NEXT_PUBLIC_OPENMAIL_KEY!}>
 *           {children}
 *         </OpenMailProvider>
 *       </body>
 *     </html>
 *   );
 * }
 *
 * // In a route handler or server action:
 * import { serverTrack, serverIdentify } from "@openmail/sdk/nextjs";
 *
 * await serverTrack("invoice_paid", { amount: 99 }, { userId: "alice@example.com" });
 */

import { OpenMail } from "../node/index.js";
import type {
  OpenMailConfig,
  Contact,
  TrackResult,
  Properties,
  Traits,
  TrackOptions,
} from "../core/types.js";

export * from "../core/types.js";
export * from "../core/errors.js";

// Re-export React provider + hooks for client components
export {
  OpenMailProvider,
  useOpenMail,
  useIdentify,
  useTrack,
  usePage,
  useGroup,
  useAutoIdentify,
} from "../react/index.js";
export { OpenMailBrowser, createOpenMailBrowser } from "../browser.js";
export type { BrowserConfig } from "../browser.js";

// ─── Singleton server-side instance ──────────────────────────────────────────

let _serverInstance: OpenMail | null = null;

function getServerInstance(): OpenMail {
  if (!_serverInstance) {
    const apiKey = process.env.OPENMAIL_API_KEY ?? process.env.OPENMAIL_SECRET_KEY;
    if (!apiKey) {
      throw new Error(
        "OpenMail server SDK: OPENMAIL_API_KEY environment variable is not set. " +
        "Add it to your .env.local file."
      );
    }
    _serverInstance = new OpenMail({
      apiKey,
      apiUrl: process.env.OPENMAIL_API_URL,
    });
  }
  return _serverInstance;
}

// ─── Server-side helpers ──────────────────────────────────────────────────────

/**
 * Track an event from a server component, route handler, or server action.
 *
 * Uses `OPENMAIL_API_KEY` from environment variables.
 *
 * @example
 * ```ts
 * // In a route handler or server action
 * import { serverTrack } from "@openmail/sdk/nextjs";
 *
 * await serverTrack("invoice_paid", { amount: 99, currency: "usd" }, {
 *   userId: "alice@example.com",
 * });
 * ```
 */
export async function serverTrack(
  event: string,
  properties?: Properties,
  options?: TrackOptions
): Promise<TrackResult> {
  return getServerInstance().track(event, properties ?? {}, options ?? {});
}

/**
 * Identify a user from a server component, route handler, or server action.
 *
 * @example
 * ```ts
 * import { serverIdentify } from "@openmail/sdk/nextjs";
 *
 * await serverIdentify("alice@example.com", { firstName: "Alice", plan: "pro" });
 * ```
 */
export async function serverIdentify(
  userId: string,
  traits?: Traits
): Promise<Contact> {
  return getServerInstance().identify(userId, traits ?? {});
}

/**
 * Flush all pending server-side events.
 * Call this in a cleanup handler if you have long-running queued events.
 */
export async function serverFlush(): Promise<void> {
  if (_serverInstance) await _serverInstance.flush();
}

/**
 * Create a scoped server SDK instance (e.g. per-request).
 * Useful for edge runtimes where singletons aren't reliable.
 *
 * @example
 * ```ts
 * // In a route handler
 * export async function POST(req: Request) {
 *   const openmail = createServerClient();
 *   await openmail.track("order_placed", { amount: 99 }, { userId: "alice@example.com" });
 *   await openmail.flush();
 * }
 * ```
 */
export function createServerClient(config?: Partial<OpenMailConfig>): OpenMail {
  const apiKey = config?.apiKey ?? process.env.OPENMAIL_API_KEY ?? process.env.OPENMAIL_SECRET_KEY;
  if (!apiKey) {
    throw new Error(
      "OpenMail: apiKey is required. Set OPENMAIL_API_KEY in your environment."
    );
  }
  return new OpenMail({
    apiKey,
    apiUrl: process.env.OPENMAIL_API_URL,
    ...config,
  });
}

// ─── Server-side identify + track combined ────────────────────────────────────

/**
 * Combined identify + track for server-side use cases like auth callbacks.
 * Identifies the user then immediately tracks an event.
 *
 * @example
 * ```ts
 * // In a sign-in callback
 * await identifyAndTrack("alice@example.com", { plan: "pro" }, "signed_in", {
 *   provider: "google",
 * });
 * ```
 */
export async function identifyAndTrack(
  userId: string,
  traits: Traits,
  event: string,
  properties?: Properties
): Promise<{ contact: Contact; event: TrackResult }> {
  const sdk = getServerInstance();
  const [contact, ev] = await Promise.all([
    sdk.identify(userId, traits),
    sdk.track(event, properties ?? {}, { userId }),
  ]);
  return { contact, event: ev };
}

// ─── Re-export full Node SDK ──────────────────────────────────────────────────

export { OpenMail, createOpenMail } from "../node/index.js";
export { OpenMailError } from "../core/errors.js";
