# PRD: Campaigns List — UX Improvements (Customer.io parity)

## Goal
Add filter bar, Active/Archived tabs, and search to campaigns list matching Customer.io.

## Changes

### Search/filter bar (below header, above tabs)
- Text input: "Filter by name or description…" (debounced, client-side)
- Clear button (X) when text entered

### Tabs: Active | Archived
- Active tab: shows campaigns with status draft, active, paused
- Archived tab: shows campaigns with status archived
- Tab shows count badge: "Active 4" | "Archived 0"

### Campaign rows (keep existing card layout but improve)
- Add description text if present (text-[11px] text-muted-foreground, truncate)
- Show "Trigger: {eventName}" or "Manual trigger" more prominently
- Clicking the entire card opens CampaignDetailDialog (already implemented)
- Archive action (in addition to delete) — PATCH status: "archived"
  - Only show for non-active campaigns
  - Tooltip: "Archive"

### Campaign status improvements
- Running/Active: green "● Active" indicator
- Draft: grey "Draft" badge  
- Paused: amber "Paused" badge
- Archived: listed in Archived tab only

## TODO
[x] Add search input with debounce
[x] Add Active/Archived tab filter
[x] Filter campaigns by tab + search text
[x] Archive button on non-active campaigns
[x] Better trigger description display
