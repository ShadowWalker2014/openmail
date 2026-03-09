# OpenMail Design System

> Design philosophy: restraint, not addition. The best details are invisible — felt, not seen.
> Inspired by Linear, Vercel, and Resend.

---

## Philosophy

- **Monochrome-first.** Color only for semantic meaning (error, success, brand accent). Not decoration.
- **Derived tokens.** Every surface, text, and border is derived from 3 foundation vars via opacity. Never hardcoded hex.
- **Information density.** Dense content, sparse chrome. The frame recedes; content advances.
- **Motion as feedback.** Every transition is meaningful. Nothing animates for its own sake.
- **Progressive disclosure.** Resting state is minimal. Complexity surfaces on interaction.

---

## Color Tokens

All tokens are CSS custom properties in HSL format. Consume via `hsl(var(--token))`.

### Dark Mode (default)

| Token | HSL Value | Hex approx | Purpose |
|---|---|---|---|
| `--background` | `240 6% 6%` | `#0e0e12` | App base canvas |
| `--foreground` | `240 5% 93%` | `#eaeaed` | Primary text |
| `--card` | `240 4% 9%` | `#161618` | Raised surface (cards, panels) |
| `--card-foreground` | `240 5% 93%` | `#eaeaed` | Text on cards |
| `--popover` | `240 5% 10%` | `#18181c` | Floating surface (dropdowns, tooltips) |
| `--popover-foreground` | `240 5% 93%` | `#eaeaed` | Text on popovers |
| `--muted` | `240 4% 14%` | `#212126` | Hover bg, subtle fills |
| `--muted-foreground` | `240 4% 54%` | `#878790` | Secondary / disabled text |
| `--primary` | `240 5% 93%` | `#eaeaed` | Primary action bg (white-ish buttons) |
| `--primary-foreground` | `240 6% 6%` | `#0e0e12` | Text on primary buttons |
| `--secondary` | `240 4% 13%` | `#1f1f24` | Secondary button bg |
| `--secondary-foreground` | `240 5% 93%` | `#eaeaed` | Text on secondary |
| `--accent` | `240 4% 14%` | `#212126` | Hover highlight bg |
| `--accent-foreground` | `240 5% 93%` | `#eaeaed` | Text on accent |
| `--destructive` | `3 74% 61%` | `#ee5258` | Error / delete actions |
| `--destructive-foreground` | `0 0% 98%` | `#fafafa` | Text on destructive |
| `--border` | `240 4% 17%` | `#272729` | Dividers, input borders |
| `--input` | `240 4% 11%` | `#1b1b1e` | Input background |
| `--ring` | `240 4% 42%` | `#696974` | Focus ring color |
| `--radius` | `0.375rem` | — | Base border radius |

### Light Mode (`.light` class on `<html>`)

| Token | HSL Value | Purpose |
|---|---|---|
| `--background` | `0 0% 98%` | Near-white base |
| `--foreground` | `240 6% 10%` | Near-black text |
| `--card` | `0 0% 100%` | Pure white card |
| `--muted` | `240 4% 93%` | Light gray fills |
| `--muted-foreground` | `240 4% 44%` | Medium gray text |
| `--border` | `240 4% 86%` | Light gray border |
| `--input` | `240 4% 92%` | Light input bg |

### Sidebar Tokens

| Token | Dark Value | Purpose |
|---|---|---|
| `--sidebar` | `240 7% 7%` | Sidebar background (slightly deeper than app bg) |
| `--sidebar-foreground` | `240 5% 93%` | Sidebar text |
| `--sidebar-border` | `240 4% 13%` | Sidebar internal dividers |
| `--sidebar-accent` | `240 4% 12%` | Sidebar hover bg |
| `--sidebar-accent-foreground` | `240 5% 93%` | Sidebar hover text |
| `--sidebar-ring` | `240 4% 42%` | Sidebar focus ring |
| `--sidebar-width` | `216px` | Expanded sidebar width |
| `--sidebar-width-icon` | `3rem` | Collapsed sidebar width |

### Brand Accent

| Token | HSL Value | Hex | Usage |
|---|---|---|---|
| `--violet` | `250 89% 70%` | `#7c6af8` | Brand accent — used sparingly |
| `--violet-foreground` | `0 0% 98%` | `#fafafa` | Text on violet backgrounds |

**Rule:** Violet appears only on: active/selected states, brand badges, the primary CTA on the landing page, and AI-related features. Never on chrome elements.

---

## Surface Elevation

Four levels, each a subtle opacity shift — no heavy shadows.

```
Level 0  background     hsl(var(--background))     #0e0e12  App canvas
Level 1  card/raised    hsl(var(--card))            #161618  Cards, panels, table rows
Level 2  popover        hsl(var(--popover))         #18181c  Dropdowns, tooltips, sheets
Level 3  dialog         hsl(var(--popover)) + ring  #18181c  Modals (add ring border)
```

**Rule:** In dark mode, elevation is communicated by subtle background shift + semi-transparent borders. Never `box-shadow` in dark mode — use `border border-border/50` instead.

---

## Typography

**Font stack:** `"Inter", system-ui, sans-serif`
**Mono stack:** `"JetBrains Mono", "Fira Code", monospace`

### Font Feature Settings

```css
font-feature-settings: "cv11", "ss01";  /* Inter optical sizing + stylistic alternates */
-webkit-font-smoothing: antialiased;
```

### Scale

| Role | Size | Weight | Letter-spacing | Line-height | Usage |
|---|---|---|---|---|---|
| `body` | `13px` | `400` | `-0.01em` | `1.4` | Default, all prose |
| `small` | `12px` | `400` | `0` | `1.4` | Metadata, captions |
| `xs` | `11px` | `400/500` | `0` | `1.3` | Badges, timestamps, labels |
| `mono-xs` | `11px` | `400` | `0` | `1.5` | IDs, keys, technical strings |
| `label` | `11px` | `500` | `0.12em` | `1` | Uppercase section labels |
| `h4` | `13px` | `600` | `-0.015em` | `1.25` | Card titles, row headers |
| `h3` | `15px` | `600` | `-0.02em` | `1.25` | Section subheadings |
| `h2` | `22px` | `600` | `-0.025em` | `1.2` | Section headings |
| `h1` | `48–72px` | `700` | `-0.035em` | `1.08` | Hero headline |
| `display` | `>72px` | `700` | `-0.04em` | `1.05` | Large marketing displays |

### Rules

- One dominant heading per view. No competing `font-semibold` blocks.
- `tabular-nums` on all numbers in tables and metrics.
- `font-mono-xs` for IDs, API keys, branch names, version strings.
- Never `break-all`. All strings are bounded with `truncate` or `line-clamp-{n}`.

---

## Spacing

**Base unit:** `4px` (Tailwind default scale)

| Token | Value | Usage |
|---|---|---|
| `px` | `1px` | Borders, dividers |
| `0.5` | `2px` | Micro gaps |
| `1` | `4px` | Tight padding (badges, chips) |
| `1.5` | `6px` | Dense row padding |
| `2` | `8px` | Icon + label gap, input padding |
| `2.5` | `10px` | Card internal padding (compact) |
| `3` | `12px` | Default row padding |
| `4` | `16px` | Card padding (standard) |
| `5` | `20px` | Card padding (comfortable) |
| `6` | `24px` | Section gap |
| `8` | `32px` | Section padding |
| `12` | `48px` | Between sections |
| `16` | `64px` | Major section breaks |
| `24` | `96px` | Hero padding |

**Rule:** No arbitrary values (e.g. `mt-[13px]`). All values from the 4px scale.

---

## Border Radius

| Token | Value | Usage |
|---|---|---|
| `--radius` | `0.375rem` (6px) | Base radius for inputs, buttons |
| `rounded` | `4px` | Tight: badges, small elements |
| `rounded-md` | `6px` | Standard: buttons, inputs |
| `rounded-lg` | `8px` | Cards, panels |
| `rounded-xl` | `12px` | Large cards, feature blocks, modals |
| `rounded-2xl` | `16px` | Hero sections, prominent cards |
| `rounded-full` | `9999px` | Pills, avatars, status dots |

---

## Motion

### Easing Functions

| Token | Value | Usage |
|---|---|---|
| `--spring` | `cubic-bezier(0.34, 1.56, 0.64, 1)` | Entrances (slight overshoot) |
| `--ease-out` | `cubic-bezier(0, 0, 0.2, 1)` | Micro-interactions, color changes |
| `--ease-in-out` | `cubic-bezier(0.4, 0, 0.2, 1)` | Panels, layout transitions |

### Duration Scale

| Duration | Usage |
|---|---|
| `75ms` | Instant micro (checkbox, radio) |
| `100ms` | Exit animations |
| `150ms` | Color/opacity transitions (the floor) |
| `200ms` | Layout transitions (sidebar, drawer) |
| `300ms` | Page transitions, modal entrances |

### Keyframes

| Name | Effect | Use case |
|---|---|---|
| `enter` | opacity + translate + scale in | All animate-in elements |
| `exit` | opacity + translate + scale out | All animate-out elements |
| `shimmer` | gradient sweep | Skeleton loaders |
| `spring-in` | scale 0.94→1 + translateY -4px→0 | Dialog entrances |
| `slide-up-in` | translateY 8px→0 + fade | Toasts, bottom sheets |
| `stagger-in` | translateY 4px→0 + fade | List item entrances |
| `live-pulse` | opacity 1→0.4→1 | Live status dots |
| `paletteIn` | Command palette entrance | Cmd+K overlay |

### Rules

- `transition-colors duration-150` is the floor for all interactive elements.
- Never add artificial delays. Motion is instant-but-smooth.
- Exit animations: `duration-100` (shorter exit than entrance).
- Spring easing only for elements entering from above (dialogs, dropdowns).

---

## Shadows

Dark mode uses borders for elevation, not shadows.

```css
/* Use instead of box-shadow in dark mode: */
border border-border/50

/* Floating: */
shadow-xl shadow-black/40

/* Glow (brand accent): */
shadow-[0_0_20px_rgba(139,92,246,0.3)]

/* Glow (white/primary): */
shadow-[0_0_20px_rgba(255,255,255,0.15)]
```

---

## Borders

```css
/* Standard divider */
border-border

/* Subtle: inside surfaces */
border-border/60

/* Very subtle: between list items */
border-border/40  or  border-white/[0.06]

/* Semi-transparent (landing/marketing pages) */
border-white/[0.08]
```

---

## Component Patterns

### Buttons

| Variant | Background | Text | When to use |
|---|---|---|---|
| `default` (primary) | `hsl(--primary)` = white | `hsl(--primary-fg)` = black | ONE per page/modal/card |
| `secondary` | `hsl(--secondary)` | `hsl(--secondary-fg)` | Supporting actions |
| `outline` | transparent | `hsl(--foreground)` | Tertiary actions |
| `ghost` | transparent | `hsl(--muted-fg)` | Icon buttons, nav items |
| `destructive` | `hsl(--destructive)` | white | Delete with confirmation dialog |

**Rules:**
- One primary button per view.
- All clickable: `cursor-pointer`.
- All transitions: `transition-colors duration-150`.
- Icon-only: must have `<Tooltip>`.

### Inputs

```
Normal:   border-border       bg-input          focus: ring-ring/30
Error:    border-destructive  bg-destructive/5  text-destructive below
Disabled: opacity-50          cursor-not-allowed
```

### Cards

```css
/* Standard card */
rounded-lg border border-border bg-card p-5

/* Interactive card */
rounded-lg border border-border bg-card p-5
transition-colors duration-150
hover:border-border/80 hover:bg-card/80

/* Feature card (landing) */
rounded-xl border border-white/[0.07] bg-card
transition-all duration-200
hover:border-white/[0.13]
```

### Status Badges

```css
/* Success */
bg-emerald-500/15 text-emerald-400

/* Error */
bg-destructive/15 text-destructive

/* Warning */
bg-amber-500/15 text-amber-400

/* Neutral */
bg-muted text-muted-foreground

/* Brand */
bg-violet-500/15 text-violet-400
```

### Tables

- `font-variant-numeric: tabular-nums` on all number cells
- Full row hover: `hover:bg-muted/40 transition-colors duration-100`
- Row actions: `opacity-0 group-hover:opacity-100 transition-opacity duration-150`
- Column headers: `text-[11px] uppercase tracking-wider text-muted-foreground`
- Numbers: right-aligned; text: left-aligned

### Skeletons

```css
/* Use .shimmer class — animated gradient sweep */
<div className="h-4 w-24 rounded shimmer" />

/* Match the exact shape of real content — never generic rectangles */
```

---

## Icons

- **Library:** Lucide React only.
- **Sizes:** `h-3 w-3` (dense), `h-3.5 w-3.5` (compact), `h-4 w-4` (standard), `h-5 w-5` (prominent).
- **Color:** Default `currentColor`. Use `text-muted-foreground` for decorative/inactive icons.
- **No emojis** in UI. No sparkle/wand/AI-cliché icons.
- Icon-only buttons **must** have a `<Tooltip>` — no exceptions.

---

## Z-Index Scale

| Value | Layer | Usage |
|---|---|---|
| `0` | base | Normal content |
| `10` | raised | Sticky headers, floating labels |
| `20` | dropdown | Popovers, dropdowns, tooltips |
| `30` | overlay | Drawer backdrops |
| `40` | modal | Dialogs, modals |
| `50` | command | Command palette, top-level toasts |

No `z-[9999]`. Always use the defined scale.

---

## Landing Page Tokens

The marketing landing page is always dark. It uses the same CSS vars but adds:

```css
/* Landing-specific background (slightly deeper than app bg for drama) */
--landing-bg: #0a0a0f         /* body */
--landing-surface: --card     /* hsl(var(--card)) */

/* Landing ambient glow */
Violet top:  bg-violet-600/8 blur-[100px]
Cyan right:  bg-cyan-600/5   blur-[80px]

/* Dot grid texture */
radial-gradient(circle, rgba(255,255,255,0.9) 1px, transparent 1px)
background-size: 28px 28px
opacity: 0.025
```

---

## Accessibility

- Focus ring: `1.5px solid hsl(var(--ring))` at `2px` offset — always visible.
- Color is never the sole carrier of meaning (always paired with icon or text).
- Disabled state: `opacity-50 cursor-not-allowed` — element stays in DOM.
- All interactive elements have ARIA labels where visual context is absent.
- Selection highlight: `hsl(var(--violet) / 0.22)`.

---

## Tailwind Mapping

All Tailwind color classes map to CSS variables via `tailwind.config.ts`:

```
bg-background     → hsl(var(--background))
bg-card           → hsl(var(--card))
bg-popover        → hsl(var(--popover))
bg-muted          → hsl(var(--muted))
bg-primary        → hsl(var(--primary))
bg-secondary      → hsl(var(--secondary))
bg-accent         → hsl(var(--accent))
bg-destructive    → hsl(var(--destructive))
text-foreground   → hsl(var(--foreground))
text-muted-foreground → hsl(var(--muted-foreground))
border-border     → hsl(var(--border))
ring-ring         → hsl(var(--ring))
bg-sidebar        → hsl(var(--sidebar))
```

Use Tailwind classes everywhere. Raw `hsl(var(--token))` only in CSS files or when Tailwind can't express the value.

---

## File Structure

```
web/src/
├── globals.css          ← All CSS custom properties + keyframes + base utilities
├── tailwind.config.ts   ← Token-to-Tailwind mapping
├── components/
│   ├── ui/              ← shadcn/ui components (never re-implement these)
│   └── app-sidebar.tsx  ← Sidebar with LogoMark, nav, workspace switcher, user row
└── routes/
    ├── index.tsx        ← Landing page (always dark, marketing)
    ├── login.tsx        ← Auth pages
    └── _app/            ← App shell + all dashboard routes
```

---

## Do / Don't

| ✅ Do | ❌ Don't |
|---|---|
| Use CSS vars via Tailwind classes | Hardcode `#111115` or `rgba(...)` |
| One primary button per view | Multiple `variant="default"` buttons |
| `transition-colors duration-150` on hover | No transition on interactive elements |
| `cursor-pointer` on clickable elements | Bare `div onClick` without hover state |
| `<Tooltip>` on icon-only buttons | Naked icon buttons |
| `shimmer` class for loading skeletons | Spinner inside content area |
| `truncate` + `min-w-0` parent | Text that can overflow its container |
| `tabular-nums` on number columns | Numbers that jump width on change |
| Hard delete with confirmation dialog | Soft delete / undo pattern |
| `font-mono-xs` for IDs and keys | Regular font for technical strings |
