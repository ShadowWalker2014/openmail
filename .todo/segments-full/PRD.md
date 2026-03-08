# PRD: Full-Featured Segment Pages (Customer.io parity)

## Segment List Page
- Table: checkbox | Type icon (Filter) | Name + description + dates | Size (X people) | Usage badge
- Search by name (debounced)
- Active/Archived tabs
- Click row → opens SegmentDetailDialog

## SegmentDetailDialog (full-screen 96vw×92vh, 3 tabs)

### Header
- Segment name (DialogTitle) + edit icon (opens inline edit)
- Description (editable inline)
- Right: updated timestamp + Delete button

### Tab 1: Overview
Two columns:
- Left (320px): Conditions display card (read-only human-readable summary per condition, with AND/OR connector) + Edit Conditions button (opens existing condition builder dialog)
- Right: Sample Members (top 5 contacts) card + Segment Size (total count)

### Tab 2: People  
- "X people" count
- Paginated contacts table (50/page): Email | Created At
- Uses GET /segments/:id/people

### Tab 3: Usage
- Campaigns card: list of campaigns using this segment (triggerType=segment_enter|segment_exit with this segmentId)
- Broadcasts card: list of broadcasts with this segmentId in their segmentIds array

## New API Routes (api/src/routes/segments.ts)

### GET /segments (update)
- Add contactCount per segment using subquery

### GET /segments/:id/people?page=1&pageSize=50
- Evaluate conditions against contacts table
- Return { data: Contact[], total, page, pageSize }
- Condition evaluation:
  - field "email" → contacts.email
  - field "firstName" → contacts.first_name  
  - field "lastName" → contacts.last_name
  - field "unsubscribed" → contacts.unsubscribed
  - field "attributes.X" → contacts.attributes->>'X' (jsonb)
  - operators: eq, ne, contains, not_contains, exists, not_exists
  - conditionLogic: and/or
- Use raw SQL for dynamic WHERE

### GET /segments/:id/usage
- Return { campaigns: Campaign[], broadcasts: Broadcast[] }
- campaigns: WHERE trigger_type IN ('segment_enter','segment_exit') AND trigger_config->>'segmentId' = :segmentId
- broadcasts: WHERE :segmentId = ANY(segment_ids::text[]) — or use jsonb contains

## TODO
[x] API: GET /segments/:id/people (evaluate conditions dynamically)
[x] API: GET /segments/:id/usage (campaigns + broadcasts using segment)
[x] UI: Segments list as table with search + count + clickable rows
[x] UI: SegmentDetailDialog with Overview/People/Usage tabs
[x] UI: Overview tab - conditions display + sample members
[x] UI: People tab - paginated contacts table
[x] UI: Usage tab - campaigns + broadcasts cards
