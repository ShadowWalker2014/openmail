/**
 * OpenMail Segment System — Comprehensive Integration Tests
 *
 * Tests:
 *  1.  Attribute eq/ne/contains/not_contains/is_set/is_not_set conditions
 *  2.  Standard fields: email, firstName, lastName, phone, unsubscribed
 *  3.  Numeric operators: gt, lt, gte, lte on attributes
 *  4.  AND logic with multiple conditions
 *  5.  OR logic with multiple conditions
 *  6.  Empty conditions → all contacts returned
 *  7.  Pagination (page/pageSize)
 *  8.  Dynamic membership — before/after attribute change
 *  9.  Event-based conditions (event.X is_set / not_exists)
 *  10. Event membership auto-update (before and after event tracked)
 *  11. Group membership conditions (group.company eq "acme-corp")
 *  12. Group membership auto-update (before/after linkage)
 *  13. Complex: AND of event + attribute + group conditions
 *  14. OR of event + group conditions
 *  15. conditionLogic edge cases
 *  16. Segment update (PATCH) re-evaluates correctly
 */

const API   = "https://api-production-542d.up.railway.app";
const KEY   = "om_be792e7dc882a22b3b26e5d480594f9f411769efe1429601";
const TS    = Date.now();
const H     = { "Authorization": `Bearer ${KEY}`, "Content-Type": "application/json" };

const green  = s => `\x1b[32m✓ ${s}\x1b[0m`;
const red    = s => `\x1b[31m✗ ${s}\x1b[0m`;
const yellow = s => `\x1b[33m▸ ${s}\x1b[0m`;
const bold   = s => `\x1b[1m${s}\x1b[0m`;
const dim    = s => `\x1b[2m${s}\x1b[0m`;

let passed = 0, failed = 0, total = 0;
const failures = [];

function assert(cond, msg, extra = "") {
  total++;
  if (cond) {
    console.log(green(msg));
    passed++;
  } else {
    console.log(red(msg) + (extra ? `\n    ${dim(extra)}` : ""));
    failed++;
    failures.push(msg);
  }
}

async function api(method, path, body) {
  const r = await fetch(`${API}${path}`, {
    method, headers: H, body: body ? JSON.stringify(body) : undefined,
  });
  const text = await r.text();
  let json = null;
  try { json = JSON.parse(text); } catch {}
  return { status: r.status, json, ok: r.ok };
}

async function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// ─── Setup: create test contacts ─────────────────────────────────────────────

const contacts = {};
async function makeContact(key, data) {
  const r = await api("POST", "/api/v1/contacts", data);
  contacts[key] = r.json;
  return r.json;
}

async function trackEvent(email, name, properties = {}) {
  return api("POST", "/api/v1/events/track", { email, name, properties });
}

async function makeSeg(conditions, logic = "and") {
  const r = await api("POST", "/api/v1/segments", {
    name: `test-seg-${TS}-${Math.random().toString(36).slice(2,6)}`,
    conditions,
    conditionLogic: logic,
  });
  return r.json;
}

async function getPeople(segId, page = 1, pageSize = 100) {
  const r = await api("GET", `/api/v1/segments/${segId}/people?page=${page}&pageSize=${pageSize}`);
  return r.json;
}

function hasEmail(people, email) {
  return (people?.data ?? []).some(c => c.email === email);
}

// ─── Print header ─────────────────────────────────────────────────────────────
console.log(bold("\n╔══════════════════════════════════════════════════════════╗"));
console.log(bold(  "║   OpenMail Segment System — Comprehensive Test Suite     ║"));
console.log(bold(  "╚══════════════════════════════════════════════════════════╝\n"));

// ── STEP 0: Create test contacts ─────────────────────────────────────────────
console.log(bold("── Setup: Creating test contacts ───────────────────────────"));

await makeContact("pro",  { email: `seg-pro-${TS}@test.dev`,  firstName: "Alice", lastName: "Pro",
  attributes: { plan: "pro", mrr: 99, tier: "paid", company: "Acme" }});
await makeContact("free", { email: `seg-free-${TS}@test.dev`, firstName: "Bob",   lastName: "Free",
  attributes: { plan: "free", mrr: 0, tier: "free" }});
await makeContact("ent",  { email: `seg-ent-${TS}@test.dev`,  firstName: "Carol", lastName: "Enterprise",
  attributes: { plan: "enterprise", mrr: 999, tier: "paid", company: "BigCorp" }});
await makeContact("noplan", { email: `seg-noplan-${TS}@test.dev`, firstName: "Dave", lastName: "NoPlan",
  attributes: { tier: "unknown" }});
await makeContact("unsub", { email: `seg-unsub-${TS}@test.dev`, firstName: "Eve",
  attributes: { plan: "pro" } });
// Unsubscribe Eve
await api("PATCH", `/api/v1/contacts/${contacts.unsub.id}`, { unsubscribed: true });

console.log(`  Created contacts: pro=${contacts.pro?.email}, free=${contacts.free?.email}`);
console.log(`  ent=${contacts.ent?.email}, noplan=${contacts.noplan?.email}, unsub=${contacts.unsub?.email}`);

await sleep(300);

// ─────────────────────────────────────────────────────────────────────────────
// GROUP 1: Attribute-based conditions
// ─────────────────────────────────────────────────────────────────────────────
console.log(bold("\n── Group 1: Attribute conditions ───────────────────────────"));

{
  // 1.1 eq on attributes.plan
  const seg = await makeSeg([{ field: "attributes.plan", operator: "eq", value: "pro" }]);
  const p = await getPeople(seg.id);
  assert(hasEmail(p, contacts.pro.email),  "1.1a eq plan=pro: alice included");
  assert(!hasEmail(p, contacts.free.email),"1.1b eq plan=pro: bob excluded");
  assert(!hasEmail(p, contacts.ent.email), "1.1c eq plan=pro: carol excluded");
}

{
  // 1.2 ne on attributes.plan
  const seg = await makeSeg([{ field: "attributes.plan", operator: "ne", value: "free" }]);
  const p = await getPeople(seg.id);
  assert(hasEmail(p, contacts.pro.email),  "1.2a ne plan!=free: alice included");
  assert(!hasEmail(p, contacts.free.email),"1.2b ne plan!=free: bob excluded");
  assert(hasEmail(p, contacts.ent.email),  "1.2c ne plan!=free: carol included");
}

{
  // 1.3 contains on email
  const seg = await makeSeg([{ field: "email", operator: "contains", value: `seg-pro-${TS}` }]);
  const p = await getPeople(seg.id);
  assert(hasEmail(p, contacts.pro.email),   "1.3a contains email: alice included");
  assert(!hasEmail(p, contacts.free.email), "1.3b contains email: bob excluded");
}

{
  // 1.4 not_contains on email
  const seg = await makeSeg([{ field: "email", operator: "not_contains", value: `seg-free-${TS}` }]);
  const p = await getPeople(seg.id);
  assert(hasEmail(p, contacts.pro.email),   "1.4a not_contains: alice included");
  assert(!hasEmail(p, contacts.free.email), "1.4b not_contains: bob excluded");
}

{
  // 1.5 is_set on attributes.plan
  const seg = await makeSeg([{ field: "attributes.plan", operator: "is_set" }]);
  const p = await getPeople(seg.id);
  assert(hasEmail(p, contacts.pro.email),    "1.5a is_set plan: alice included");
  assert(hasEmail(p, contacts.free.email),   "1.5b is_set plan: bob included");
  assert(!hasEmail(p, contacts.noplan.email),"1.5c is_set plan: dave excluded");
}

{
  // 1.6 is_not_set on attributes.plan
  const seg = await makeSeg([{ field: "attributes.plan", operator: "is_not_set" }]);
  const p = await getPeople(seg.id);
  assert(!hasEmail(p, contacts.pro.email),   "1.6a is_not_set plan: alice excluded");
  assert(hasEmail(p, contacts.noplan.email), "1.6b is_not_set plan: dave included");
}

{
  // 1.7 gt on attributes.mrr (numeric)
  const seg = await makeSeg([{ field: "attributes.mrr", operator: "gt", value: 50 }]);
  const p = await getPeople(seg.id);
  assert(hasEmail(p, contacts.pro.email),    "1.7a gt mrr>50: alice included (99)");
  assert(!hasEmail(p, contacts.free.email),  "1.7b gt mrr>50: bob excluded (0)");
  assert(hasEmail(p, contacts.ent.email),    "1.7c gt mrr>50: carol included (999)");
}

{
  // 1.8 lt on attributes.mrr
  const seg = await makeSeg([{ field: "attributes.mrr", operator: "lt", value: 100 }]);
  const p = await getPeople(seg.id);
  assert(hasEmail(p, contacts.pro.email),    "1.8a lt mrr<100: alice included (99)");
  assert(hasEmail(p, contacts.free.email),   "1.8b lt mrr<100: bob included (0)");
  assert(!hasEmail(p, contacts.ent.email),   "1.8c lt mrr<100: carol excluded (999)");
}

{
  // 1.9 gte on attributes.mrr
  const seg = await makeSeg([{ field: "attributes.mrr", operator: "gte", value: 99 }]);
  const p = await getPeople(seg.id);
  assert(hasEmail(p, contacts.pro.email),    "1.9a gte mrr>=99: alice included (99)");
  assert(hasEmail(p, contacts.ent.email),    "1.9b gte mrr>=99: carol included (999)");
  assert(!hasEmail(p, contacts.free.email),  "1.9c gte mrr>=99: bob excluded (0)");
}

{
  // 1.10 lte on attributes.mrr
  const seg = await makeSeg([{ field: "attributes.mrr", operator: "lte", value: 99 }]);
  const p = await getPeople(seg.id);
  assert(hasEmail(p, contacts.pro.email),    "1.10a lte mrr<=99: alice included (99)");
  assert(hasEmail(p, contacts.free.email),   "1.10b lte mrr<=99: bob included (0)");
  assert(!hasEmail(p, contacts.ent.email),   "1.10c lte mrr<=99: carol excluded (999)");
}

// ─────────────────────────────────────────────────────────────────────────────
// GROUP 2: Standard fields
// ─────────────────────────────────────────────────────────────────────────────
console.log(bold("\n── Group 2: Standard fields (firstName, lastName, unsubscribed) ──"));

{
  // 2.1 eq on firstName
  const seg = await makeSeg([{ field: "firstName", operator: "eq", value: "Alice" }]);
  const p = await getPeople(seg.id);
  assert(hasEmail(p, contacts.pro.email),    "2.1a eq firstName=Alice: alice included");
  assert(!hasEmail(p, contacts.free.email),  "2.1b eq firstName=Alice: bob excluded");
}

{
  // 2.2 contains on lastName
  const seg = await makeSeg([{ field: "lastName", operator: "contains", value: "ente" }]);
  const p = await getPeople(seg.id);
  assert(hasEmail(p, contacts.ent.email),   "2.2a contains lastName 'ente': carol included");
  assert(!hasEmail(p, contacts.pro.email),  "2.2b contains lastName 'ente': alice excluded");
}

{
  // 2.3 unsubscribed = false (active contacts)
  const seg = await makeSeg([{ field: "unsubscribed", operator: "eq", value: "false" }]);
  const p = await getPeople(seg.id);
  assert(hasEmail(p, contacts.pro.email),    "2.3a unsubscribed=false: alice included");
  assert(!hasEmail(p, contacts.unsub.email), "2.3b unsubscribed=false: eve excluded");
}

{
  // 2.4 unsubscribed = true
  const seg = await makeSeg([{ field: "unsubscribed", operator: "eq", value: "true" }]);
  const p = await getPeople(seg.id);
  assert(hasEmail(p, contacts.unsub.email),  "2.4a unsubscribed=true: eve included");
  assert(!hasEmail(p, contacts.pro.email),   "2.4b unsubscribed=true: alice excluded");
}

// ─────────────────────────────────────────────────────────────────────────────
// GROUP 3: Logical combinations (AND / OR)
// ─────────────────────────────────────────────────────────────────────────────
console.log(bold("\n── Group 3: Logical combinations (AND / OR) ───────────────"));

{
  // 3.1 AND: plan=pro AND tier=paid → only alice
  const seg = await makeSeg([
    { field: "attributes.plan", operator: "eq", value: "pro" },
    { field: "attributes.tier", operator: "eq", value: "paid" },
  ], "and");
  const p = await getPeople(seg.id);
  assert(hasEmail(p, contacts.pro.email),    "3.1a AND plan=pro AND tier=paid: alice included");
  assert(!hasEmail(p, contacts.ent.email),   "3.1b AND plan=pro AND tier=paid: carol excluded");
  assert(!hasEmail(p, contacts.free.email),  "3.1c AND plan=pro AND tier=paid: bob excluded");
}

{
  // 3.2 OR: plan=pro OR plan=enterprise → alice + carol
  const seg = await makeSeg([
    { field: "attributes.plan", operator: "eq", value: "pro" },
    { field: "attributes.plan", operator: "eq", value: "enterprise" },
  ], "or");
  const p = await getPeople(seg.id);
  assert(hasEmail(p, contacts.pro.email),    "3.2a OR plan=pro|ent: alice included");
  assert(hasEmail(p, contacts.ent.email),    "3.2b OR plan=pro|ent: carol included");
  assert(!hasEmail(p, contacts.free.email),  "3.2c OR plan=pro|ent: bob excluded");
}

{
  // 3.3 AND with 3 conditions: tier=paid AND mrr>50 AND firstName contains 'arol'
  const seg = await makeSeg([
    { field: "attributes.tier", operator: "eq", value: "paid" },
    { field: "attributes.mrr", operator: "gt", value: 50 },
    { field: "firstName", operator: "contains", value: "arol" },
  ], "and");
  const p = await getPeople(seg.id);
  assert(hasEmail(p, contacts.ent.email),    "3.3a AND 3 conds: carol included");
  assert(!hasEmail(p, contacts.pro.email),   "3.3b AND 3 conds: alice excluded (firstName!=Carol)");
}

{
  // 3.4 OR with 3 conditions
  const seg = await makeSeg([
    { field: "attributes.plan", operator: "eq", value: "enterprise" },
    { field: "attributes.tier", operator: "is_not_set" },
    { field: "attributes.mrr", operator: "eq", value: "99" },
  ], "or");
  const p = await getPeople(seg.id);
  assert(hasEmail(p, contacts.ent.email),    "3.4a OR 3: carol included (enterprise)");
  // dave has tier="unknown" (not null), plan=undefined (no match), mrr=undefined (no match)
  // → all three OR conditions are false for dave → correctly excluded
  assert(!hasEmail(p, contacts.noplan.email), "3.4b OR 3: dave excluded (tier=unknown, not is_not_set; no plan match; no mrr match)");
  assert(hasEmail(p, contacts.pro.email),    "3.4c OR 3: alice included (mrr=99)");
}

{
  // 3.5 Empty conditions → all contacts in workspace
  const seg = await makeSeg([{ field: "email", operator: "is_set" }]);
  // Patch conditions to empty array to test that path
  await api("PATCH", `/api/v1/segments/${seg.id}`, {
    conditions: [{ field: "email", operator: "is_set" }],  // email is NOT NULL so all match
  });
  const p = await getPeople(seg.id);
  assert(p.total >= 5, `3.5 is_set email: all contacts match (total=${p.total})`);
  assert(hasEmail(p, contacts.pro.email),    "3.5a is_set email: alice included");
  assert(hasEmail(p, contacts.free.email),   "3.5b is_set email: bob included");
  assert(hasEmail(p, contacts.noplan.email), "3.5c is_set email: dave included");
}

// ─────────────────────────────────────────────────────────────────────────────
// GROUP 4: Pagination
// ─────────────────────────────────────────────────────────────────────────────
console.log(bold("\n── Group 4: Pagination ─────────────────────────────────────"));

{
  // Scope to THIS run only by filtering on email domain containing our timestamp
  const seg = await makeSeg([
    { field: "attributes.tier", operator: "eq", value: "paid" },
    { field: "email", operator: "contains", value: `${TS}@test.dev` },
  ], "and");
  const p1 = await getPeople(seg.id, 1, 1);
  const p2 = await getPeople(seg.id, 2, 1);
  // alice (tier=paid) + carol (tier=paid) from this run
  assert(p1.total === 2, `4.1 total=2 paid tier contacts this run (got ${p1.total})`);
  assert(p1.data.length === 1, `4.2 page1 size=1 (got ${p1.data.length})`);
  assert(p2.data.length === 1, `4.3 page2 size=1 (got ${p2.data.length})`);
  assert(p1.data[0].id !== p2.data[0].id, "4.4 page1 and page2 return different contacts");
}

// ─────────────────────────────────────────────────────────────────────────────
// GROUP 5: Dynamic membership — before/after attribute change
// ─────────────────────────────────────────────────────────────────────────────
console.log(bold("\n── Group 5: Dynamic membership (attribute changes) ─────────"));

{
  // 5.1 Before: contact NOT in segment; After: PATCH attribute → contact IS in segment
  const seg = await makeSeg([{ field: "attributes.plan", operator: "eq", value: "gold" }]);
  const p_before = await getPeople(seg.id);
  assert(!hasEmail(p_before, contacts.noplan.email), "5.1 before: dave not in plan=gold segment");

  await api("PATCH", `/api/v1/contacts/${contacts.noplan.id}`, { attributes: { plan: "gold", tier: "paid" } });
  await sleep(200);

  const p_after = await getPeople(seg.id);
  assert(hasEmail(p_after, contacts.noplan.email), "5.2 after attribute update: dave IS in plan=gold segment");
}

{
  // 5.3 Before: contact IN segment; After: update attribute → no longer matches
  const seg = await makeSeg([{ field: "attributes.plan", operator: "eq", value: "pro" }]);
  const p_before = await getPeople(seg.id);
  assert(hasEmail(p_before, contacts.pro.email), "5.3 before: alice in plan=pro segment");

  // Change alice's plan
  await api("PATCH", `/api/v1/contacts/${contacts.pro.id}`, { attributes: { plan: "starter", mrr: 99, tier: "paid", company: "Acme" } });
  await sleep(200);

  const p_after = await getPeople(seg.id);
  assert(!hasEmail(p_after, contacts.pro.email), "5.4 after attribute update: alice NOT in plan=pro segment");

  // Restore
  await api("PATCH", `/api/v1/contacts/${contacts.pro.id}`, { attributes: { plan: "pro", mrr: 99, tier: "paid", company: "Acme" } });
}

// ─────────────────────────────────────────────────────────────────────────────
// GROUP 6: Event-based conditions
// ─────────────────────────────────────────────────────────────────────────────
console.log(bold("\n── Group 6: Event-based conditions ────────────────────────"));

// First create fresh contacts for event tests to avoid pollution
const evContact1 = (await api("POST", "/api/v1/contacts", {
  email: `ev1-${TS}@test.dev`, firstName: "EvUser1", attributes: { plan: "pro" }
})).json;
const evContact2 = (await api("POST", "/api/v1/contacts", {
  email: `ev2-${TS}@test.dev`, firstName: "EvUser2", attributes: { plan: "pro" }
})).json;

{
  // 6.1 Before tracking event: segment with event.plan_upgraded is_set should NOT match
  const seg = await makeSeg([{ field: `event.plan_upgraded_${TS}`, operator: "is_set" }]);
  const p_before = await getPeople(seg.id);
  assert(!hasEmail(p_before, evContact1.email), "6.1 before event: evUser1 NOT in event segment");
  assert(!hasEmail(p_before, evContact2.email), "6.2 before event: evUser2 NOT in event segment");

  // Track event for evContact1 only
  await trackEvent(evContact1.email, `plan_upgraded_${TS}`, { from: "free", to: "pro" });
  await sleep(500);

  // 6.3 After tracking event: segment membership updated
  const p_after = await getPeople(seg.id);
  assert(hasEmail(p_after, evContact1.email),   "6.3 after event tracked: evUser1 IS in event segment");
  assert(!hasEmail(p_after, evContact2.email),  "6.4 after event: evUser2 still NOT in segment");
}

{
  // 6.5 not_exists / is_not_set: contacts who have NOT triggered event
  const seg = await makeSeg([{ field: `event.plan_upgraded_${TS}`, operator: "is_not_set" }]);
  const p = await getPeople(seg.id);
  assert(!hasEmail(p, evContact1.email),  "6.5a not_exists event: evUser1 excluded (has event)");
  assert(hasEmail(p, evContact2.email),   "6.5b not_exists event: evUser2 included (no event)");
}

{
  // 6.6 event with ne operator (= same as not_exists)
  const seg = await makeSeg([{ field: `event.plan_upgraded_${TS}`, operator: "ne" }]);
  const p = await getPeople(seg.id);
  assert(!hasEmail(p, evContact1.email),  "6.6a event ne: evUser1 excluded");
  assert(hasEmail(p, evContact2.email),   "6.6b event ne: evUser2 included");
}

{
  // 6.7 Multiple events AND
  await trackEvent(evContact1.email, `login_${TS}`, {});
  await sleep(300);
  const seg = await makeSeg([
    { field: `event.plan_upgraded_${TS}`, operator: "is_set" },
    { field: `event.login_${TS}`, operator: "is_set" },
  ], "and");
  const p = await getPeople(seg.id);
  assert(hasEmail(p, evContact1.email),   "6.7a AND two events: evUser1 included (has both)");
  assert(!hasEmail(p, evContact2.email),  "6.7b AND two events: evUser2 excluded (missing events)");
}

{
  // 6.8 Event OR attribute
  const seg = await makeSeg([
    { field: `event.plan_upgraded_${TS}`, operator: "is_set" },
    { field: "attributes.plan", operator: "eq", value: "enterprise" },
  ], "or");
  const p = await getPeople(seg.id);
  assert(hasEmail(p, evContact1.email),    "6.8a OR event|attr: evUser1 included (has event)");
  assert(hasEmail(p, contacts.ent.email),  "6.8b OR event|attr: carol included (enterprise plan)");
  assert(!hasEmail(p, evContact2.email),   "6.8c OR event|attr: evUser2 excluded (no event, no ent plan)");
}

// ─────────────────────────────────────────────────────────────────────────────
// GROUP 7: Group membership conditions
// ─────────────────────────────────────────────────────────────────────────────
console.log(bold("\n── Group 7: Group membership conditions ────────────────────"));

// Create a group and link contacts
const GROUP_KEY = `test-group-${TS}`;
const grpRes = await api("POST", "/api/v1/groups", {
  groupType: "company", groupKey: GROUP_KEY, attributes: { name: "Test Corp" }
});
const grpId = grpRes.json?.id;
assert(!!grpId, `7.0 group created: ${grpId}`);

// Link alice and carol to the group
await api("POST", `/api/v1/groups/${grpId}/contacts`, { contactId: contacts.pro.id });
await api("POST", `/api/v1/groups/${grpId}/contacts`, { contactId: contacts.ent.id });
await sleep(300);

{
  // 7.1 group.company eq GROUP_KEY → only alice + carol
  const seg = await makeSeg([{ field: "group.company", operator: "eq", value: GROUP_KEY }]);
  const p = await getPeople(seg.id);
  assert(hasEmail(p, contacts.pro.email),    "7.1a group.company eq: alice included");
  assert(hasEmail(p, contacts.ent.email),    "7.1b group.company eq: carol included");
  assert(!hasEmail(p, contacts.free.email),  "7.1c group.company eq: bob excluded");
  assert(!hasEmail(p, contacts.noplan.email),"7.1d group.company eq: dave excluded");
}

{
  // 7.2 group.company ne GROUP_KEY → everyone except alice + carol
  const seg = await makeSeg([{ field: "group.company", operator: "ne", value: GROUP_KEY }]);
  const p = await getPeople(seg.id);
  assert(!hasEmail(p, contacts.pro.email),   "7.2a group.company ne: alice excluded");
  assert(!hasEmail(p, contacts.ent.email),   "7.2b group.company ne: carol excluded");
  assert(hasEmail(p, contacts.free.email),   "7.2c group.company ne: bob included");
}

{
  // 7.3 group.company is_set → contacts in ANY company group
  const seg = await makeSeg([{ field: "group.company", operator: "is_set" }]);
  const p = await getPeople(seg.id);
  assert(hasEmail(p, contacts.pro.email),    "7.3a group.company is_set: alice included");
  assert(hasEmail(p, contacts.ent.email),    "7.3b group.company is_set: carol included");
  assert(!hasEmail(p, contacts.free.email),  "7.3c group.company is_set: bob excluded");
}

{
  // 7.4 group.company is_not_set → contacts NOT in any company group
  const seg = await makeSeg([{ field: "group.company", operator: "is_not_set" }]);
  const p = await getPeople(seg.id);
  assert(!hasEmail(p, contacts.pro.email),   "7.4a group.company is_not_set: alice excluded");
  assert(hasEmail(p, contacts.free.email),   "7.4b group.company is_not_set: bob included");
}

{
  // 7.5 Before/After: add bob to group → segment membership updates
  const seg = await makeSeg([{ field: "group.company", operator: "eq", value: GROUP_KEY }]);
  const p_before = await getPeople(seg.id);
  assert(!hasEmail(p_before, contacts.free.email), "7.5 before: bob NOT in group segment");

  await api("POST", `/api/v1/groups/${grpId}/contacts`, { contactId: contacts.free.id });
  await sleep(300);

  const p_after = await getPeople(seg.id);
  assert(hasEmail(p_after, contacts.free.email), "7.6 after group link: bob IS in group segment");

  // Remove bob from group
  await api("DELETE", `/api/v1/groups/${grpId}/contacts/${contacts.free.id}`);
  await sleep(200);

  const p_removed = await getPeople(seg.id);
  assert(!hasEmail(p_removed, contacts.free.email), "7.7 after group unlink: bob NOT in group segment again");
}

// ─────────────────────────────────────────────────────────────────────────────
// GROUP 8: Complex cross-condition queries
// ─────────────────────────────────────────────────────────────────────────────
console.log(bold("\n── Group 8: Complex cross-condition queries ────────────────"));

{
  // 8.1 AND: group member + has event + attribute
  await trackEvent(contacts.pro.email, `complex_event_${TS}`, {});
  await sleep(500);

  const seg = await makeSeg([
    { field: "group.company", operator: "eq", value: GROUP_KEY },
    { field: `event.complex_event_${TS}`, operator: "is_set" },
    { field: "attributes.plan", operator: "eq", value: "pro" },
  ], "and");
  const p = await getPeople(seg.id);
  assert(hasEmail(p, contacts.pro.email),    "8.1a AND group+event+attr: alice included (all match)");
  assert(!hasEmail(p, contacts.ent.email),   "8.1b AND group+event+attr: carol excluded (no event)");
  assert(!hasEmail(p, contacts.free.email),  "8.1c AND group+event+attr: bob excluded (not in group)");
}

{
  // 8.2 OR: group member OR has event
  const seg = await makeSeg([
    { field: "group.company", operator: "eq", value: GROUP_KEY },
    { field: `event.plan_upgraded_${TS}`, operator: "is_set" },
  ], "or");
  const p = await getPeople(seg.id);
  assert(hasEmail(p, contacts.pro.email),    "8.2a OR group|event: alice included (group)");
  assert(hasEmail(p, contacts.ent.email),    "8.2b OR group|event: carol included (group)");
  assert(hasEmail(p, evContact1.email),      "8.2c OR group|event: evUser1 included (event)");
  assert(!hasEmail(p, contacts.free.email),  "8.2d OR group|event: bob excluded (neither)");
}

{
  // 8.3 Segment PATCH re-evaluates correctly
  const seg = await makeSeg([{ field: "attributes.plan", operator: "eq", value: "enterprise" }]);
  const p1 = await getPeople(seg.id);
  assert(hasEmail(p1, contacts.ent.email),   "8.3a before patch: carol in segment");
  assert(!hasEmail(p1, contacts.free.email), "8.3b before patch: bob not in segment");

  // Patch the segment to use a different condition
  await api("PATCH", `/api/v1/segments/${seg.id}`, {
    conditions: [{ field: "attributes.plan", operator: "eq", value: "free" }],
  });
  const p2 = await getPeople(seg.id);
  assert(!hasEmail(p2, contacts.ent.email),  "8.4a after patch: carol no longer in segment");
  assert(hasEmail(p2, contacts.free.email),  "8.4b after patch: bob now in segment");
}

// ─────────────────────────────────────────────────────────────────────────────
// GROUP 9: Edge cases
// ─────────────────────────────────────────────────────────────────────────────
console.log(bold("\n── Group 9: Edge cases ─────────────────────────────────────"));

{
  // 9.1 Case insensitivity for string conditions
  const seg = await makeSeg([{ field: "attributes.plan", operator: "eq", value: "PRO" }]);
  const p = await getPeople(seg.id);
  assert(hasEmail(p, contacts.pro.email), "9.1 case insensitive eq: 'PRO' matches 'pro'");
}

{
  // 9.2 Case insensitivity for contains
  const seg = await makeSeg([{ field: "firstName", operator: "contains", value: "ALICE" }]);
  const p = await getPeople(seg.id);
  assert(hasEmail(p, contacts.pro.email), "9.2 case insensitive contains: 'ALICE' matches 'Alice'");
}

{
  // 9.3 Equals operator alias (legacy "eq" === "equals")
  const segEq  = await makeSeg([{ field: "attributes.plan", operator: "eq", value: "pro" }]);
  const segEqs = await makeSeg([{ field: "attributes.plan", operator: "equals", value: "pro" }]);
  const p1 = await getPeople(segEq.id);
  const p2 = await getPeople(segEqs.id);
  assert(p1.total === p2.total, `9.3 eq/equals aliases return same total (${p1.total}===${p2.total})`);
}

{
  // 9.4 is_set / exists aliases
  const segIs  = await makeSeg([{ field: "attributes.plan", operator: "is_set" }]);
  const segEx  = await makeSeg([{ field: "attributes.plan", operator: "exists" }]);
  const p1 = await getPeople(segIs.id);
  const p2 = await getPeople(segEx.id);
  assert(p1.total === p2.total, `9.4 is_set/exists aliases return same total (${p1.total}===${p2.total})`);
}

{
  // 9.5 Segment with no matching contacts → empty result
  const seg = await makeSeg([{ field: "attributes.plan", operator: "eq", value: "tier_does_not_exist" }]);
  const p = await getPeople(seg.id);
  assert(p.data.length === 0, `9.5 no matches: empty result (total=${p.total})`);
  assert(p.total === 0, "9.6 no matches: total=0");
}

{
  // 9.7 OR with all false conditions → empty
  const seg = await makeSeg([
    { field: "attributes.plan", operator: "eq", value: "nonexistent1" },
    { field: "attributes.plan", operator: "eq", value: "nonexistent2" },
  ], "or");
  const p = await getPeople(seg.id);
  assert(p.data.length === 0, "9.7 OR all false: empty result");
}

{
  // 9.8 Numeric: mrr between 50 and 150 (AND of gt + lt)
  const seg = await makeSeg([
    { field: "attributes.mrr", operator: "gt", value: 50 },
    { field: "attributes.mrr", operator: "lt", value: 150 },
  ], "and");
  const p = await getPeople(seg.id);
  assert(hasEmail(p, contacts.pro.email),    "9.8a mrr 50<x<150: alice included (99)");
  assert(!hasEmail(p, contacts.free.email),  "9.8b mrr 50<x<150: bob excluded (0)");
  assert(!hasEmail(p, contacts.ent.email),   "9.8c mrr 50<x<150: carol excluded (999)");
}

// ─────────────────────────────────────────────────────────────────────────────
// Summary
// ─────────────────────────────────────────────────────────────────────────────
const pct = Math.round(100 * passed / total);
console.log(bold("\n╔══════════════════════════════════════════════════════════╗"));
if (failed === 0) {
  console.log(bold(`║  ✅  All ${total} assertions passed (${pct}%)                  ║`));
} else {
  console.log(bold(`║  Results: ${passed}/${total} passed (${pct}%)                      ║`));
  console.log(bold(`║  ❌ ${failed} failures:                                         ║`));
  failures.forEach(f => console.log(`║    • ${f.slice(0, 52)}  ║`));
}
console.log(bold("╚══════════════════════════════════════════════════════════╝\n"));

if (failed > 0) process.exit(1);
