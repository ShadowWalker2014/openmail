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

  switch (condition.operator) {
    case "exists": return value !== undefined && value !== null;
    case "not_exists": return value === undefined || value === null;
    case "eq": return value === condition.value;
    case "ne": return value !== condition.value;
    case "gt": return typeof value === "number" && value > (condition.value as number);
    case "lt": return typeof value === "number" && value < (condition.value as number);
    case "gte": return typeof value === "number" && value >= (condition.value as number);
    case "lte": return typeof value === "number" && value <= (condition.value as number);
    case "contains": return typeof value === "string" && value.includes(condition.value as string);
    case "not_contains": return typeof value === "string" && !value.includes(condition.value as string);
    default: return false;
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
    const contactData = {
      email: contact.email,
      firstName: contact.firstName,
      lastName: contact.lastName,
      phone: contact.phone,
      attributes: contact.attributes as Record<string, unknown>,
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

  const contactData = {
    email: contact.email,
    firstName: contact.firstName,
    lastName: contact.lastName,
    attributes: contact.attributes as Record<string, unknown>,
    ...(contact.attributes as Record<string, unknown>),
  };

  const conditions = (segment.conditions as SegmentCondition[]) ?? [];
  if (conditions.length === 0) return true;

  const results = conditions.map((c) => evaluateCondition(contactData, c));
  return segment.conditionLogic === "or" ? results.some(Boolean) : results.every(Boolean);
}
