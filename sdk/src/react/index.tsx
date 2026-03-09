/**
 * @openmail/sdk/react — React Provider + Hooks
 *
 * @example
 * ```tsx
 * // In your app root
 * import { OpenMailProvider } from "@openmail/sdk/react";
 *
 * <OpenMailProvider apiKey="om_..." autoPageView>
 *   <App />
 * </OpenMailProvider>
 *
 * // In any component
 * import { useOpenMail, useIdentify, useTrack } from "@openmail/sdk/react";
 *
 * function ProfileButton() {
 *   const track = useTrack();
 *   return <button onClick={() => track("cta_clicked", { page: "home" })}>Get Started</button>;
 * }
 * ```
 */
import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useCallback,
  type ReactNode,
} from "react";
import { OpenMailBrowser, type BrowserConfig } from "../browser.js";
import type { Properties, Traits, Contact, TrackResult } from "../core/types.js";

export type { Properties, Traits, Contact, TrackResult };
export { OpenMailError } from "../core/errors.js";

// ─── Context ──────────────────────────────────────────────────────────────────

const OpenMailContext = createContext<OpenMailBrowser | null>(null);

// ─── Provider ─────────────────────────────────────────────────────────────────

export interface OpenMailProviderProps extends BrowserConfig {
  children: ReactNode;
}

/**
 * Wrap your app with this provider to enable OpenMail tracking.
 *
 * @example
 * ```tsx
 * <OpenMailProvider apiKey={process.env.NEXT_PUBLIC_OPENMAIL_KEY} autoPageView>
 *   <App />
 * </OpenMailProvider>
 * ```
 */
export function OpenMailProvider({ children, ...config }: OpenMailProviderProps) {
  const instanceRef = useRef<OpenMailBrowser | null>(null);

  if (!instanceRef.current) {
    instanceRef.current = new OpenMailBrowser(config);
  }

  useEffect(() => {
    return () => {
      instanceRef.current?.destroy().catch(() => {/* ignore */});
    };
  }, []);

  return (
    <OpenMailContext.Provider value={instanceRef.current}>
      {children}
    </OpenMailContext.Provider>
  );
}

// ─── Core hook ────────────────────────────────────────────────────────────────

/**
 * Access the OpenMail browser SDK instance directly.
 *
 * @throws If used outside of `<OpenMailProvider>`
 */
export function useOpenMail(): OpenMailBrowser {
  const ctx = useContext(OpenMailContext);
  if (!ctx) {
    throw new Error(
      "useOpenMail() must be used inside <OpenMailProvider>. " +
      "Wrap your app root with <OpenMailProvider apiKey=\"om_...\">."
    );
  }
  return ctx;
}

// ─── Identify hook ────────────────────────────────────────────────────────────

/**
 * Returns a stable `identify` function. Call it after the user logs in.
 *
 * @example
 * ```tsx
 * function AuthHandler({ user }) {
 *   const identify = useIdentify();
 *
 *   useEffect(() => {
 *     if (user) {
 *       identify(user.email, { firstName: user.name, plan: user.plan });
 *     }
 *   }, [user, identify]);
 * }
 * ```
 */
export function useIdentify() {
  const openmail = useOpenMail();
  return useCallback(
    (userId: string, traits?: Traits): Promise<Contact> =>
      openmail.identify(userId, traits),
    [openmail]
  );
}

// ─── Track hook ───────────────────────────────────────────────────────────────

/**
 * Returns a stable `track` function.
 *
 * @example
 * ```tsx
 * function UpgradeButton() {
 *   const track = useTrack();
 *   return (
 *     <button onClick={() => track("upgrade_clicked", { plan: "pro" })}>
 *       Upgrade
 *     </button>
 *   );
 * }
 * ```
 */
export function useTrack() {
  const openmail = useOpenMail();
  return useCallback(
    (event: string, properties?: Properties): Promise<TrackResult> =>
      openmail.track(event, properties),
    [openmail]
  );
}

// ─── Page hook ────────────────────────────────────────────────────────────────

/**
 * Returns a stable `page` function for manual page view tracking.
 * (Not needed if `autoPageView: true` on the provider.)
 */
export function usePage() {
  const openmail = useOpenMail();
  return useCallback(
    (name?: string, properties?: Properties): Promise<TrackResult> =>
      openmail.page(name, properties),
    [openmail]
  );
}

// ─── Group hook ───────────────────────────────────────────────────────────────

/**
 * Returns a stable `group` function for workspace/org tracking.
 *
 * @example
 * ```tsx
 * function WorkspaceProvider({ workspace }) {
 *   const group = useGroup();
 *   useEffect(() => {
 *     if (workspace) {
 *       group(workspace.id, { name: workspace.name, plan: workspace.plan });
 *     }
 *   }, [workspace, group]);
 * }
 * ```
 */
export function useGroup() {
  const openmail = useOpenMail();
  return useCallback(
    (groupId: string, traits?: Traits): Promise<TrackResult> =>
      openmail.group(groupId, traits),
    [openmail]
  );
}

// ─── Auto-identify hook ───────────────────────────────────────────────────────

/**
 * Automatically calls `identify` when `user` changes (becomes non-null).
 * Calls `reset` when `user` becomes null/undefined.
 *
 * @example
 * ```tsx
 * function App() {
 *   const { user } = useAuth();
 *
 *   useAutoIdentify(
 *     user ? user.email : null,
 *     user ? { firstName: user.name, plan: user.plan } : undefined,
 *   );
 *
 *   return <div>...</div>;
 * }
 * ```
 */
export function useAutoIdentify(
  userId: string | null | undefined,
  traits?: Traits
) {
  const openmail = useOpenMail();

  useEffect(() => {
    if (userId) {
      openmail.identify(userId, traits ?? {}).catch((err) => {
        console.error("[OpenMail] useAutoIdentify error:", err);
      });
    } else {
      openmail.reset();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId]);
}

// ─── Re-exports ───────────────────────────────────────────────────────────────

export { OpenMailBrowser, createOpenMailBrowser } from "../browser.js";
export type { BrowserConfig } from "../browser.js";
