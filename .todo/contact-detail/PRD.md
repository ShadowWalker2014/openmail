# PRD: Contact Detail & Edit Panel

## Problem
Clicking a contact row does nothing. Cannot edit contact name/phone/attributes. Cannot see event history or subscription status.

## Solution
Full-screen dialog (96vw × 92vh, same pattern as broadcast/template editor) that opens when a row is clicked.

## Layout: Two columns
### Left (400px) — Contact Form
- Email (read-only, displayed large at top)
- First Name + Last Name (side by side, editable)
- Phone (editable)
- Subscription Status toggle (Subscribed / Unsubscribed)
- Attributes section — key/value table:
  - Each row: key input + value input + delete button
  - "Add attribute" button
  - Shows existing attributes pre-populated
- Save button (PATCH /contacts/:id)
- Delete button (bottom, with confirm dialog)

### Right (flex) — Activity Feed
- Tab bar: "Events" | "Email History"
- Events tab: list of contact's events (GET /contacts/:id/events — see below)
  - Each: event name + properties summary + date
  - Empty state if none
- Email History tab: list of email_sends for this contact
  - Each: broadcast name + subject + status + sent date
  - Empty state if none

## API needed
- GET /contacts/:id — already exists ✅
- PATCH /contacts/:id — already exists ✅  
- DELETE /contacts/:id — already exists ✅
- GET /contacts/:id/events — NEW: return events WHERE contactId = :id, limit 50, ordered by occurredAt desc
- GET /contacts/:id/sends — NEW: return email_sends WHERE contactId = :id, limit 50, ordered by createdAt desc

## TODO
[x] Add GET /contacts/:id/events API route
[x] Add GET /contacts/:id/sends API route
[x] Build ContactDetailDialog component
[x] Make contact table rows clickable
[x] Editable form with PATCH mutation
[x] Attributes key/value editor
[x] Events tab
[x] Email sends tab
