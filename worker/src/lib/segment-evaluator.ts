import { getDb } from "@openmail/shared/db";
import { contacts, segments } from "@openmail/shared/schema";
import { and, eq } from "drizzle-orm";
import type { SegmentCondition } from "@openmail/shared/types";

function getNestedValue(obj: Record<string, unknown>, path: string): unknown {
  return path.split(".").reduce((acc: unknown, key) => {
    if (acc && typeof acc === "object") return (acc as Record<string, unknown>)[key];
    return undefined;
  }, obj);
}

function evaluateCondition(contact: Record<string, unknown>, condition: SegmentCondition): boolean {
  const value = getNestedValue(contact, condition.field);
  const condValue = condition.value;

  switch (condition.operator) {
    // Legacy short-form operators (stored before the UI change)
    case "exists":
    case "is_set":
      return value !== undefined && value !== null && value !== "";
    case "not_exists":
    case "is_not_set":
      return value === undefined || value === null || value === "";

    // Equality — both legacy "eq"/"ne" and UI-friendly "equals"/"not_equals"
    case "eq":
    case "equals":
      // String comparison — coerce both to string for type flexibility
      return String(value) === String(condValue);
    case "ne":
    case "not_equals":
      return String(value) !== String(condValue);

    // Numeric comparisons (legacy only — UI doesn't expose these yet)
    case "gt": return typeof value === "number" && value > (condValue as number);
    case "lt": return typeof value === "number" && value < (condValue as number);
    case "gte": return typeof value === "number" && value >= (condValue as number);
    case "lte": return typeof value === "number" && value <= (condValue as number);

    // String contains
    case "contains":
      return typeof value === "string" && value.toLowerCase().includes(String(condValue).toLowerCase());
    case "not_contains":
      return typeof value === "string" && !value.toLowerCase().includes(String(condValue).toLowerCase());

    default:
      return false;
  }
}

export async function getSegmentContactIds(workspaceId: string, segmentIds: string[]): Promise<string[]> {
  if (segmentIds.length === 0) return [];
  const db = getDb();

  const allSegments = await db
    .select()
    .from(segments)
    .where(eq(segments.workspaceId, workspaceId));

  const targetSegments = allSegments.filter((s) => segmentIds.includes(s.id));
  if (targetSegments.length === 0) return [];

  const allContacts = await db
    .select()
    .from(contacts)
    .where(and(eq(contacts.workspaceId, workspaceId), eq(contacts.unsubscribed, false)));

  const matchingIds = new Set<string>();

  for (const contact of allContacts) {
    const contactData: Record<string, unknown> = {
      email: contact.email,
      firstName: contact.firstName,
      lastName: contact.lastName,
      phone: contact.phone,
      // unsubscribed is always false here (filtered above) but include for completeness
      unsubscribed: contact.unsubscribed,
      // Nest attributes object so "attributes.plan" paths work
      attributes: contact.attributes as Record<string, unknown>,
      // Also spread attributes flat so bare field names like "plan" also resolve
      ...(contact.attributes as Record<string, unknown>),
    };

    for (const segment of targetSegments) {
      const conditions = (segment.conditions as SegmentCondition[]) ?? [];
      if (conditions.length === 0) {
        matchingIds.add(contact.id);
        continue;
      }

      const results = conditions.map((c) => evaluateCondition(contactData, c));
      const matches = segment.conditionLogic === "or"
        ? results.some(Boolean)
        : results.every(Boolean);

      if (matches) {
        matchingIds.add(contact.id);
        break;
      }
    }
  }

  return Array.from(matchingIds);
}

export async function contactMatchesSegment(contactId: string, segmentId: string): Promise<boolean> {
  const db = getDb();
  const [contact] = await db.select().from(contacts).where(eq(contacts.id, contactId)).limit(1);
  if (!contact) return false;

  const [segment] = await db.select().from(segments).where(eq(segments.id, segmentId)).limit(1);
  if (!segment) return false;

  const contactData: Record<string, unknown> = {
    email: contact.email,
    firstName: contact.firstName,
    lastName: contact.lastName,
    phone: contact.phone,
    unsubscribed: contact.unsubscribed,
    attributes: contact.attributes as Record<string, unknown>,
    ...(contact.attributes as Record<string, unknown>),
  };

  const conditions = (segment.conditions as SegmentCondition[]) ?? [];
  if (conditions.length === 0) return true;

  const results = conditions.map((c) => evaluateCondition(contactData, c));
  return segment.conditionLogic === "or" ? results.some(Boolean) : results.every(Boolean);
}
