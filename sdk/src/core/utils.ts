/** Normalize traits/properties: extract known contact fields, rest → attributes */
export interface NormalizedTraits {
  email?: string;
  firstName?: string;
  lastName?: string;
  phone?: string;
  attributes: Record<string, unknown>;
}

// Deduplicated set of known contact scalar fields (not attributes)
const KNOWN_CONTACT_FIELDS = new Set([
  "email",
  "firstName",
  "first_name",
  "lastName",
  "last_name",
  "phone",
  "name",
]);

export function normalizeTraits(userId: string, traits: Record<string, unknown> = {}): NormalizedTraits {
  const isEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(userId);
  const email =
    typeof traits.email === "string" ? traits.email :
    isEmail ? userId : undefined;

  // Support both camelCase and snake_case (Segment convention)
  const rawFirstName =
    typeof traits.firstName === "string" ? traits.firstName :
    typeof traits.first_name === "string" ? String(traits.first_name) : undefined;

  const rawLastName =
    typeof traits.lastName === "string" ? traits.lastName :
    typeof traits.last_name === "string" ? String(traits.last_name) : undefined;

  // Split "name" only when explicit first/last are not provided
  const firstName = rawFirstName ??
    (typeof traits.name === "string" && !rawLastName
      ? String(traits.name).trim().split(/\s+/)[0]
      : undefined);

  const lastName = rawLastName ??
    (typeof traits.name === "string" && !rawFirstName
      ? String(traits.name).trim().split(/\s+/).slice(1).join(" ") || undefined
      : undefined);

  const phone =
    typeof traits.phone === "string" ? traits.phone : undefined;

  // Everything except known contact fields → attributes
  const attributes: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(traits)) {
    if (!KNOWN_CONTACT_FIELDS.has(key)) {
      attributes[key] = value;
    }
  }

  return { email, firstName, lastName, phone, attributes };
}

/** Merge two attribute objects together (shallow merge) */
export function mergeAttributes(
  existing: Record<string, unknown>,
  incoming: Record<string, unknown>
): Record<string, unknown> {
  return { ...existing, ...incoming };
}

/** Generate a random anonymous ID (UUID v4 format) */
export function generateAnonymousId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  // Fallback for older environments / SSR
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === "x" ? r : (r & 0x3) | 0x8).toString(16);
  });
}

/** Build query string from an object, omitting undefined/null values */
export function buildQuery(params: Record<string, unknown>): string {
  const parts: string[] = [];
  for (const [key, val] of Object.entries(params)) {
    if (val !== undefined && val !== null) {
      parts.push(`${encodeURIComponent(key)}=${encodeURIComponent(String(val))}`);
    }
  }
  return parts.length ? `?${parts.join("&")}` : "";
}

/** Simple logger. error() is always emitted; log/warn only when debug=true */
export function createLogger(debug: boolean) {
  return {
    log: (...args: unknown[]) => { if (debug) console.log("[OpenMail]", ...args); },
    warn: (...args: unknown[]) => { if (debug) console.warn("[OpenMail]", ...args); },
    // error() is always shown — these are genuine failures callers need to know about
    error: (...args: unknown[]) => console.error("[OpenMail]", ...args),
  };
}
