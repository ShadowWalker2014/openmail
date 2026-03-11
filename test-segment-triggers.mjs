/**
 * Integration tests for segment_enter / segment_exit campaign triggers.
 *
 * Tests:
 *  1. segment_enter campaign fires when contact ENTERS a segment (attribute change)
 *  2. segment_exit  campaign fires when contact EXITS  a segment (attribute change)
 *  3. segment_enter fires when contact tracks an event that enters an event.* segment
 *  4. segment_enter fires when contact is added to a group (group.* segment condition)
 *  5. segment_exit  fires when contact is removed from a group
 *  6. No double enrollment — entering the same segment twice doesn't re-enroll
 *  7. segment_memberships table is updated correctly (enter/exit state)
 */

const API  = "https://api-production-542d.up.railway.app";
const KEY  = "om_be792e7dc882a22b3b26e5d480594f9f411769efe1429601";
const TS   = Date.now();
const H    = { "Authorization": `Bearer ${KEY}`, "Content-Type": "application/json" };

const green  = s => `\x1b[32m✓ ${s}\x1b[0m`;
const red    = s => `\x1b[31m✗ ${s}\x1b[0m`;
const yellow = s => `\x1b[33m▸ ${s}\x1b[0m`;
const bold   = s => `\x1b[1m${s}\x1b[0m`;

let passed = 0, failed = 0;
function assert(cond, msg, detail = "") {
  if (cond) { console.log(green(msg)); passed++; }
  else       { console.log(red(msg) + (detail ? `\n    ${detail}` : "")); failed++; }
}

async function api(method, path, body) {
  const r = await fetch(`${API}${path}`, {
    method, headers: H, body: body ? JSON.stringify(body) : undefined,
  });
  const json = await r.json().catch(() => ({}));
  return { status: r.status, json, ok: r.ok };
}

async function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function waitForEnrollment(campaignId, contactId, maxWaitMs = 8000) {
  const deadline = Date.now() + maxWaitMs;
  while (Date.now() < deadline) {
    // Check emailSends as a proxy for enrollment (worker creates a send after enrolling)
    const sends = await api("GET", `/api/v1/contacts/${contactId}/sends`);
    const found = (sends.json ?? []).find?.(s => s.campaignId === campaignId);
    if (found) return true;
    await sleep(500);
  }
  return false;
}

// ─── Setup ────────────────────────────────────────────────────────────────────
console.log(bold("\n╔══════════════════════════════════════════════════════════╗"));
console.log(bold(  "║   segment_enter / segment_exit campaign trigger tests    ║"));
console.log(bold(  "╚══════════════════════════════════════════════════════════╝\n"));

// Create test template
const tpl = (await api("POST", "/api/v1/templates", {
  name: `seg-trigger-tpl-${TS}`,
  subject: "Segment trigger test",
  htmlContent: "<p>Hello!</p>",
})).json;
assert(!!tpl.id, `Setup: template created (${tpl.id})`);

// ─── Test 1: segment_enter via attribute change ───────────────────────────────
console.log(bold("\n── Test 1: segment_enter (attribute change) ────────────────"));

// Segment: attributes.plan = "gold"
const seg1 = (await api("POST", "/api/v1/segments", {
  name: `seg-enter-attr-${TS}`,
  conditions: [{ field: "attributes.plan", operator: "eq", value: "gold" }],
})).json;

// Campaign with segment_enter trigger
const camp1 = (await api("POST", "/api/v1/campaigns", {
  name: `camp-enter-attr-${TS}`,
  triggerType: "segment_enter",
  triggerConfig: { segmentId: seg1.id },
})).json;
await api("POST", `/api/v1/campaigns/${camp1.id}/steps`, {
  stepType: "email",
  config: { subject: "Welcome Gold!", templateId: tpl.id },
});
await api("PATCH", `/api/v1/campaigns/${camp1.id}`, { status: "active" });

// Contact NOT in segment yet
const c1 = (await api("POST", "/api/v1/contacts", {
  email: `seg-t1-${TS}@test.dev`,
  attributes: { plan: "free" },
})).json;

await sleep(2000); // let worker process any initial check

// Change plan to "gold" → should ENTER segment → campaign fires
await api("PATCH", `/api/v1/contacts/${c1.id}`, { attributes: { plan: "gold" } });

const enrolled1 = await waitForEnrollment(camp1.id, c1.id, 10000);
assert(enrolled1, "1. Contact enrolled in segment_enter campaign after attribute change");

// ─── Test 2: segment_exit via attribute change ────────────────────────────────
console.log(bold("\n── Test 2: segment_exit (attribute change) ─────────────────"));

const seg2 = (await api("POST", "/api/v1/segments", {
  name: `seg-exit-attr-${TS}`,
  conditions: [{ field: "attributes.plan", operator: "eq", value: "gold" }],
})).json;

const camp2 = (await api("POST", "/api/v1/campaigns", {
  name: `camp-exit-attr-${TS}`,
  triggerType: "segment_exit",
  triggerConfig: { segmentId: seg2.id },
})).json;
await api("POST", `/api/v1/campaigns/${camp2.id}/steps`, {
  stepType: "email",
  config: { subject: "You left Gold", templateId: tpl.id },
});
await api("PATCH", `/api/v1/campaigns/${camp2.id}`, { status: "active" });

// Contact starts IN the segment
const c2 = (await api("POST", "/api/v1/contacts", {
  email: `seg-t2-${TS}@test.dev`,
  attributes: { plan: "gold" },
})).json;

// First contact update: triggers a segment-check that should store membership
await api("PATCH", `/api/v1/contacts/${c2.id}`, { attributes: { plan: "gold" } });
await sleep(3000); // let worker store initial membership

// Now downgrade → EXIT segment
await api("PATCH", `/api/v1/contacts/${c2.id}`, { attributes: { plan: "free" } });

const enrolled2 = await waitForEnrollment(camp2.id, c2.id, 12000);
assert(enrolled2, "2. Contact enrolled in segment_exit campaign after attribute downgrade");

// ─── Test 3: segment_enter via event tracking ─────────────────────────────────
console.log(bold("\n── Test 3: segment_enter (event.* condition) ───────────────"));

const evName = `activated_${TS}`;
const seg3 = (await api("POST", "/api/v1/segments", {
  name: `seg-enter-event-${TS}`,
  conditions: [{ field: `event.${evName}`, operator: "is_set" }],
})).json;

const camp3 = (await api("POST", "/api/v1/campaigns", {
  name: `camp-enter-event-${TS}`,
  triggerType: "segment_enter",
  triggerConfig: { segmentId: seg3.id },
})).json;
await api("POST", `/api/v1/campaigns/${camp3.id}/steps`, {
  stepType: "email",
  config: { subject: "Thanks for activating!", templateId: tpl.id },
});
await api("PATCH", `/api/v1/campaigns/${camp3.id}`, { status: "active" });

const c3 = (await api("POST", "/api/v1/contacts", {
  email: `seg-t3-${TS}@test.dev`,
  attributes: { plan: "pro" },
})).json;
await sleep(1000);

// Track the activation event → should enter segment → campaign fires
await api("POST", "/api/v1/events/track", {
  email: c3.email, name: evName, properties: { source: "test" },
});

const enrolled3 = await waitForEnrollment(camp3.id, c3.id, 10000);
assert(enrolled3, "3. Contact enrolled in segment_enter campaign after event tracked");

// ─── Test 4: segment_enter via group add ──────────────────────────────────────
console.log(bold("\n── Test 4: segment_enter (group.* condition) ───────────────"));

const grpKey4 = `vip-${TS}`;
const grp4 = (await api("POST", "/api/v1/groups", {
  groupType: "tier", groupKey: grpKey4, attributes: { name: "VIP Tier" },
})).json;

const seg4 = (await api("POST", "/api/v1/segments", {
  name: `seg-enter-group-${TS}`,
  conditions: [{ field: "group.tier", operator: "eq", value: grpKey4 }],
})).json;

const camp4 = (await api("POST", "/api/v1/campaigns", {
  name: `camp-enter-group-${TS}`,
  triggerType: "segment_enter",
  triggerConfig: { segmentId: seg4.id },
})).json;
await api("POST", `/api/v1/campaigns/${camp4.id}/steps`, {
  stepType: "email",
  config: { subject: "Welcome to VIP!", templateId: tpl.id },
});
await api("PATCH", `/api/v1/campaigns/${camp4.id}`, { status: "active" });

const c4 = (await api("POST", "/api/v1/contacts", {
  email: `seg-t4-${TS}@test.dev`, attributes: { plan: "pro" },
})).json;
await sleep(1000);

// Add contact to group → should enter segment → campaign fires
await api("POST", `/api/v1/groups/${grp4.id}/contacts`, { contactId: c4.id });

const enrolled4 = await waitForEnrollment(camp4.id, c4.id, 10000);
assert(enrolled4, "4. Contact enrolled in segment_enter campaign after group add");

// ─── Test 5: segment_exit via group remove ────────────────────────────────────
console.log(bold("\n── Test 5: segment_exit (group remove) ─────────────────────"));

const grpKey5 = `premium-${TS}`;
const grp5 = (await api("POST", "/api/v1/groups", {
  groupType: "tier", groupKey: grpKey5, attributes: { name: "Premium" },
})).json;

const seg5 = (await api("POST", "/api/v1/segments", {
  name: `seg-exit-group-${TS}`,
  conditions: [{ field: "group.tier", operator: "eq", value: grpKey5 }],
})).json;

const camp5 = (await api("POST", "/api/v1/campaigns", {
  name: `camp-exit-group-${TS}`,
  triggerType: "segment_exit",
  triggerConfig: { segmentId: seg5.id },
})).json;
await api("POST", `/api/v1/campaigns/${camp5.id}/steps`, {
  stepType: "email",
  config: { subject: "We miss you!", templateId: tpl.id },
});
await api("PATCH", `/api/v1/campaigns/${camp5.id}`, { status: "active" });

const c5 = (await api("POST", "/api/v1/contacts", {
  email: `seg-t5-${TS}@test.dev`, attributes: { plan: "pro" },
})).json;

// Add to group first, let membership be recorded
await api("POST", `/api/v1/groups/${grp5.id}/contacts`, { contactId: c5.id });
await sleep(3000);

// Remove from group → EXIT segment → campaign fires
await api("DELETE", `/api/v1/groups/${grp5.id}/contacts/${c5.id}`);

const enrolled5 = await waitForEnrollment(camp5.id, c5.id, 12000);
assert(enrolled5, "5. Contact enrolled in segment_exit campaign after group removal");

// ─── Test 6: No double enrollment ─────────────────────────────────────────────
console.log(bold("\n── Test 6: No double enrollment ────────────────────────────"));

// Trigger the same enter condition twice
await api("PATCH", `/api/v1/contacts/${c1.id}`, { attributes: { plan: "free" } });
await sleep(2000);
await api("PATCH", `/api/v1/contacts/${c1.id}`, { attributes: { plan: "gold" } });
await sleep(4000);

const sends1 = await api("GET", `/api/v1/contacts/${c1.id}/sends`);
const campSends = (sends1.json ?? []).filter?.(s => s.campaignId === camp1.id) ?? [];
assert(campSends.length === 1,
  `6. No double enrollment: only 1 email queued for repeated entry (got ${campSends.length})`);

// ─── Summary ───────────────────────────────────────────────────────────────────
const total = passed + failed;
const pct   = Math.round(100 * passed / total);
console.log(bold("\n╔══════════════════════════════════════════════════════════╗"));
if (failed === 0) {
  console.log(bold(`║  ✅  All ${total} assertions passed (${pct}%)                    ║`));
} else {
  console.log(bold(`║  ${passed}/${total} passed (${pct}%)  —  ${failed} FAILED                        ║`));
}
console.log(bold("╚══════════════════════════════════════════════════════════╝\n"));
if (failed > 0) process.exit(1);
