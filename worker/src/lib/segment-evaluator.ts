import { getDb } from "@openmail/shared/db";
import { contacts, segments, events as eventsTable, contactGroups, groups } from "@openmail/shared/schema";
import { and, eq, inArray } from "drizzle-orm";
import type { SegmentCondition } from "@openmail/shared/types";

function getNestedValue(obj: Record<string, unknown>, path: string): unknown {
  return path.split(".").reduce((acc: unknown, key) => {
    if (acc && typeof acc === "object") return (acc as Record<string, unknown>)[key];
    return undefined;
  }, obj);
}

function evaluateCondition(
  contact: Record<string, unknown>,
  condition: SegmentCondition,
  // Pre-fetched sets for event and group lookups (contactId → Set<eventName/groupKey>)
  eventsByContact: Map<string, Set<string>>,
  groupsByContact: Map<string, Array<{ groupType: string; groupKey: string }>>,
): boolean {
  const { field, operator: op, value: condValue } = condition;

  // ── Event-based conditions ────────────────────────────────────────────────
  // field: "event.<event_name>"
  if (field.startsWith("event.")) {
    const eventName = field.slice("event.".length);
    const contactId = String(contact.id ?? "");
    const done = eventsByContact.get(contactId)?.has(eventName) ?? false;
    if (op === "exists" || op === "is_set" || op === "eq" || op === "equals") return done;
    if (op === "not_exists" || op === "is_not_set" || op === "ne" || op === "not_equals") return !done;
    return false;
  }

  // ── Group membership conditions ───────────────────────────────────────────
  // field: "group.<group_type>"  value: "<group_key>"
  if (field.startsWith("group.")) {
    const groupType = field.slice("group.".length);
    const contactId = String(contact.id ?? "");
    const contactGroupList = groupsByContact.get(contactId) ?? [];

    const inGroup = condValue !== undefined
      ? contactGroupList.some(g => g.groupType === groupType && g.groupKey === String(condValue))
      : contactGroupList.some(g => g.groupType === groupType);

    if (op === "exists" || op === "is_set" || op === "eq" || op === "equals") return inGroup;
    if (op === "not_exists" || op === "is_not_set" || op === "ne" || op === "not_equals") return !inGroup;
    return false;
  }

  // ── Standard field conditions ─────────────────────────────────────────────
  const value = getNestedValue(contact, field);

  switch (op) {
    case "exists":
    case "is_set":
      return value !== undefined && value !== null && value !== "";
    case "not_exists":
    case "is_not_set":
      return value === undefined || value === null || value === "";
    case "eq":
    case "equals":
      return String(value) === String(condValue);
    case "ne":
    case "not_equals":
      return String(value) !== String(condValue);
    case "gt":  return typeof value === "number" && value > (condValue as number);
    case "lt":  return typeof value === "number" && value < (condValue as number);
    case "gte": return typeof value === "number" && value >= (condValue as number);
    case "lte": return typeof value === "number" && value <= (condValue as number);
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

  if (allContacts.length === 0) return [];

  const contactIds = allContacts.map(c => c.id);

  // Pre-fetch events for all contacts in this workspace (for event conditions)
  const eventsByContact = new Map<string, Set<string>>();
  const allEvents = await db
    .select({ contactId: eventsTable.contactId, name: eventsTable.name })
    .from(eventsTable)
    .where(and(
      eq(eventsTable.workspaceId, workspaceId),
    ));
  for (const ev of allEvents) {
    if (!ev.contactId) continue;
    if (!eventsByContact.has(ev.contactId)) eventsByContact.set(ev.contactId, new Set());
    eventsByContact.get(ev.contactId)!.add(ev.name);
  }

  // Pre-fetch group memberships for all contacts (for group conditions)
  const groupsByContact = new Map<string, Array<{ groupType: string; groupKey: string }>>();
  const allMemberships = await db
    .select({
      contactId: contactGroups.contactId,
      groupType: groups.groupType,
      groupKey: groups.groupKey,
    })
    .from(contactGroups)
    .innerJoin(groups, eq(contactGroups.groupId, groups.id))
    .where(eq(contactGroups.workspaceId, workspaceId));
  for (const m of allMemberships) {
    if (!groupsByContact.has(m.contactId)) groupsByContact.set(m.contactId, []);
    groupsByContact.get(m.contactId)!.push({ groupType: m.groupType, groupKey: m.groupKey });
  }

  const matchingIds = new Set<string>();

  for (const contact of allContacts) {
    const contactData: Record<string, unknown> = {
      id: contact.id,
      email: contact.email,
      firstName: contact.firstName,
      lastName: contact.lastName,
      phone: contact.phone,
      unsubscribed: contact.unsubscribed,
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

      const results = conditions.map((c) => evaluateCondition(contactData, c, eventsByContact, groupsByContact));
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

  const workspaceId = contact.workspaceId;

  const contactData: Record<string, unknown> = {
    id: contact.id,
    email: contact.email,
    firstName: contact.firstName,
    lastName: contact.lastName,
    phone: contact.phone,
    unsubscribed: contact.unsubscribed,
    attributes: contact.attributes as Record<string, unknown>,
    ...(contact.attributes as Record<string, unknown>),
  };

  // Fetch events for this contact
  const eventsByContact = new Map<string, Set<string>>();
  const contactEvents = await db
    .select({ name: eventsTable.name })
    .from(eventsTable)
    .where(and(eq(eventsTable.contactId, contactId), eq(eventsTable.workspaceId, workspaceId)));
  const evSet = new Set(contactEvents.map(e => e.name));
  eventsByContact.set(contactId, evSet);

  // Fetch group memberships for this contact
  const groupsByContact = new Map<string, Array<{ groupType: string; groupKey: string }>>();
  const memberships = await db
    .select({ groupType: groups.groupType, groupKey: groups.groupKey })
    .from(contactGroups)
    .innerJoin(groups, eq(contactGroups.groupId, groups.id))
    .where(eq(contactGroups.contactId, contactId));
  groupsByContact.set(contactId, memberships);

  const conditions = (segment.conditions as SegmentCondition[]) ?? [];
  if (conditions.length === 0) return true;

  const results = conditions.map((c) => evaluateCondition(contactData, c, eventsByContact, groupsByContact));
  return segment.conditionLogic === "or" ? results.some(Boolean) : results.every(Boolean);
}
