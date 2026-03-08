# PRD: Broadcast Detail — 4-Tab Page (Customer.io parity)

## Goal
Replace the current two-column edit/preview dialog with a full-featured 4-tab detail view matching Customer.io's broadcast detail page.

## New BroadcastDetailDialog layout

### Top bar
- DialogTitle: broadcast name (truncated) + status badge
- Right side: Actions dropdown (Save for draft, Delete) + Send button (draft only)
- Close button (built-in DialogContent X)

### Tab bar (below top bar, above content)
Tabs visible based on status:
- **Draft**: Overview (edit form) | Content (HTML editor + preview)
- **Sent/Sending/Failed**: Overview | Content | Sent | Recipients

---

## Tab 1: Overview

### For DRAFT broadcast
Show editable form (current left-panel content):
- Name, Subject, Preview Text, From Name + From Email (grid 2-col)
- Segments (toggle chips)
- Schedule (future: date picker placeholder)
- Quick stats row (all zeros, greyed out): Sent 0 | Opens 0 | Clicks 0

### For SENT/SENDING/FAILED broadcast
Show read-only metrics:

**Stats row (7 cards, compact):**
| Metric | Value |
|--------|-------|
| Emails Sent | sentCount |
| Delivered | sentCount - bounced (approx) |
| Open Rate | openCount / sentCount % |
| Click Rate | clickCount / sentCount % |
| Unsubscribed | from analytics |
| Bounced | from analytics |
| Failed | from analytics |

**Horizontal bar charts section (CSS-only, no library):**
- Opened: `openCount / sentCount * 100`%
- Clicked: `clickCount / sentCount * 100`%
- Click to Open Rate: `clickCount / openCount * 100`%
Each row: label (left, 140px, text-[13px]) | % number (bold) | horizontal bar (flex-1, h-4, bg-emerald-500/80, rounded) | count (right)

**Top Clicked Links table** (from GET /broadcasts/:id/top-links):
- Columns: URL | Total Clicks
- Show top 10 links
- Empty state if no clicks

---

## Tab 2: Content

### For DRAFT broadcast
Two-column layout:
- Left (380px): HTML textarea (font-mono, min-h-[400px]) with mode toggle (Write HTML / Use Template)
- Right (flex): live iframe preview + desktop/mobile toggle

### For SENT broadcast
Single-column:
- From: `{fromName} <{fromEmail}>` 
- Subject: subject line
- **Test Send row**: "To:" email input (controlled) + "Send test email" button → POST /broadcasts/:id/test-send
- Iframe preview (full width, max-w-[680px] centered, min-h-[600px])

---

## Tab 3: Sent (visible for sent/sending/failed only)
Full-width table of individual email sends.

**Filter bar:**
- Status dropdown: All | Sent | Delivered | Bounced | Failed (native select)
- Refresh button

**Table columns:** Date Sent | Subject | Recipient Email | Status badge

**Status badge variants:**
- sent/delivered → success green
- bounced → warning amber  
- failed → destructive red
- queued → secondary grey

**Pagination:** 50 per page, prev/next

**API:** GET /broadcasts/:id/sends?page=1&pageSize=50&status=

---

## Tab 4: Recipients (visible for sent/sending/failed only)
**Recipients section:**
- "Your broadcast was sent to people in:"
- Segment chips (name badges for each segmentId, resolved via segments query)

**Tracking section:**
- ✓ Open and click tracking are on
- Sent at: format(sentAt, "MMMM d, yyyy 'at' h:mm a")
- Recipient count: X contacts targeted

**Send options:**
- From: fromName <fromEmail> (or workspace default)

---

## API routes to add (api/src/routes/broadcasts.ts)

### GET /broadcasts/:id/sends
Params: page (default 1), pageSize (default 50), status (optional filter)
Returns: { data: EmailSend[], total, page, pageSize }
Query: SELECT * FROM email_sends WHERE broadcastId = :id AND workspaceId = :wsId [AND status = :status] ORDER BY createdAt DESC LIMIT/OFFSET

### GET /broadcasts/:id/top-links
Returns: [{ url: string, clicks: number }] top 10
Query: SELECT metadata->>'url' as url, COUNT(*) as clicks FROM email_events 
  WHERE workspaceId = :wsId AND event_type = 'click' AND send_id IN 
  (SELECT id FROM email_sends WHERE broadcast_id = :broadcastId)
  GROUP BY url ORDER BY clicks DESC LIMIT 10

### POST /broadcasts/:id/test-send
Body: { email: string }
Action: Send a one-off email via Resend to the given address using the broadcast's HTML/template content
Returns: { success: true }

Note: test-send can be a stub that returns { success: true } if Resend not configured

## TODO
[x] Add GET /broadcasts/:id/sends API route
[x] Add GET /broadcasts/:id/top-links API route  
[x] Add POST /broadcasts/:id/test-send API stub
[x] Rewrite BroadcastDetailDialog with tab bar
[x] Overview tab (draft edit form + sent metrics + bar charts + top links)
[x] Content tab (draft editor + sent preview + test send)
[x] Sent tab (sends table with status filter + pagination)
[x] Recipients tab (segments + tracking + send options)
