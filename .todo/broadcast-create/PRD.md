# PRD: Broadcast Create Form — Missing Fields

## Problem
The create broadcast dialog is missing:
1. fromName and fromEmail fields (only visible in edit dialog, not create)
2. Template picker (can only type raw HTML; no way to pick a saved template)
3. Preview Text / preheader field

## Solution
Update the create broadcast dialog (already full-screen two-column) to add:

### Additional fields in left panel:
- From Name + From Email (side-by-side inputs, optional)
- Preview Text (optional, below subject)
- Template picker section:
  - Toggle: "Use Template" | "Write HTML"
  - "Use Template" mode: dropdown select of saved templates + readonly preview loads template HTML into iframe
  - "Write HTML" mode: existing textarea with live preview (current behavior)
  - When template is selected, iframe shows template HTML

## TODO
[x] Add fromName state + input
[x] Add fromEmail state + input  
[x] Add previewText state + input
[x] Add template picker (fetch templates, show select dropdown)
[x] Toggle between template mode and raw HTML mode
[x] Pass templateId OR htmlContent in create mutation (not both)
