# PRD: Broadcasts List — Table Format (Customer.io parity)

## Goal
Replace the card-based broadcast list with a proper table matching Customer.io's broadcasts list page.

## New Layout

### Header
- Title: "Broadcasts" + subtitle "One-off email campaigns"
- Right: "New Broadcast" button

### Search bar
- Full-width search input: "Search by name…" (debounced 300ms, client-side filter on name)

### Table (replaces cards)

**Columns:**
| Column | Content |
|--------|---------|
| NAME | broadcast name (clickable, opens detail) + subject (smaller, muted) + sent/created date |
| STATUS | badge (draft/sending/sent/failed/scheduled) |
| SENT | sentCount or "—" for draft |
| DELIVERED | sentCount (approx) or "—" |
| OPENED | openCount + open rate "15.8%" |
| CLICKED | clickCount + click rate "0.8%" |
| Actions | ··· dropdown (Send, Delete) |

**Row styling:**
- Hover: bg-accent/40
- Clickable row → opens BroadcastDetailDialog
- Name cell: font-medium + subject below in text-[11px] text-muted-foreground
- Sent date below name: "Sent Feb 21, 2026" or "Created Feb 21, 2026"

**Draft rows:**
- Status: Draft badge
- Stats columns: all show "—"
- Actions: Send button + Delete

**Empty state:** same as current

**Loading:** skeleton rows (5)

## TODO
[x] Replace card list with table
[x] Add search filtering
[x] Clickable rows open detail dialog
[x] Stats columns with open/click rates
