# PRD: Campaign Step Editor

## Problem
Campaigns are completely non-functional — no way to add steps (emails, delays). The `campaign_steps` table exists but has zero API routes for CRUD and zero UI.

## Solution
Clicking a campaign card opens a full-screen step editor dialog (96vw × 92vh).

## Layout
### Left panel (320px) — Step Timeline
- Campaign name + status badge at top
- Trigger node at top (non-editable, shows trigger type + event name)
- Vertical timeline of steps, each as a card:
  - Email step: envelope icon + "Send Email" + subject preview
  - Wait step: clock icon + "Wait X days/hours"
  - Selected step has highlight border
  - Click to select and configure in right panel
- "+ Add Step" button at bottom (dropdown: Email / Wait)
- Activate / Pause button at very bottom

### Right panel (flex) — Step Config
- When no step selected: empty state "Select a step or add one"
- Email Step config:
  - Subject (text input)
  - From Name + From Email (side-by-side)
  - Template picker: dropdown to select from saved templates, OR raw HTML textarea
  - If template selected: live iframe preview
  - If HTML mode: textarea + live iframe preview
  - Desktop/Mobile preview toggle
- Wait Step config:
  - Duration (number input)
  - Unit (select: hours / days / weeks)
  - Human readable summary: "Wait 3 days before next step"
- Delete step button at bottom of config panel

## API Routes to Add (in api/src/routes/campaigns.ts)
- POST /campaigns/:id/steps — create step
  - body: { stepType: "email"|"wait", config: {}, position: number }
- PATCH /campaigns/:id/steps/:stepId — update step config
  - body: { config?: {}, position?: number }
- DELETE /campaigns/:id/steps/:stepId — delete step

## Step Schema
- Email step config: { subject, fromName?, fromEmail?, templateId?, htmlContent? }
- Wait step config: { duration: number, unit: "hours"|"days"|"weeks" }

## TODO
[x] Add POST /campaigns/:id/steps API route
[x] Add PATCH /campaigns/:id/steps/:stepId API route
[x] Add DELETE /campaigns/:id/steps/:stepId API route
[x] Make campaign cards clickable
[x] Build CampaignDetailDialog component
[x] Step timeline left panel
[x] Email step config with template picker + preview
[x] Wait step config
[x] Add/delete step actions
[x] Activate/Pause from within dialog
