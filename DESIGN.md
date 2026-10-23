---
name: Saintsflow
description: Calm, opinionated project software; kargul.studio's world applied to a Basecamp-style app.
colors:
  ground: "#efefef"
  sheet: "#ffffff"
  tile: "#f5f5f5"
  tile-hover: "#ebebeb"
  ink: "#171717"
  muted: "#5e5e5e"
  line: "#e4e4e4"
  control: "#949494"
  slab: "#232323"
  slab-tile: "#2e2e2e"
  slab-ink: "#f5f5f5"
  slab-muted: "#a8a8a8"
  primary: "#232323"
  primary-hover: "#000000"
  on-primary: "#ffffff"
  accent: "#f99c00"
  on-accent: "#1a1200"
  accent-soft: "#ffefd1"
  focus: "#c46f00"
  danger: "#c62a1f"
  danger-soft: "#fde9e7"
  success: "#16a34a"
  label-red: "#e5484d"
  label-orange: "#f99c00"
  label-yellow: "#f5c518"
  label-green: "#30a46c"
  label-blue: "#3e7bfa"
  label-purple: "#8e4ec6"
  label-gray: "#8b8d98"
typography:
  display:
    fontFamily: "Geist, ui-sans-serif, system-ui, -apple-system, Segoe UI, sans-serif"
    fontSize: "clamp(2.75rem, 1.2rem + 6vw, 5.25rem)"
    fontWeight: 750
    lineHeight: 0.98
    letterSpacing: "-0.04em"
  headline:
    fontFamily: "Geist, ui-sans-serif, system-ui, sans-serif"
    fontSize: "clamp(2rem, 1.2rem + 2.6vw, 3.25rem)"
    fontWeight: 750
    lineHeight: 1.05
    letterSpacing: "-0.035em"
  wordmark-giant:
    fontFamily: "Geist, ui-sans-serif, system-ui, sans-serif"
    fontSize: "clamp(3.5rem, 15.5vw, 14rem)"
    fontWeight: 800
    lineHeight: 0.8
    letterSpacing: "-0.06em"
  title-page:
    fontFamily: "Geist, ui-sans-serif, system-ui, sans-serif"
    fontSize: "2rem"
    fontWeight: 700
    lineHeight: 1.15
    letterSpacing: "-0.03em"
  title:
    fontFamily: "Geist, ui-sans-serif, system-ui, sans-serif"
    fontSize: "1.25rem"
    fontWeight: 650
    lineHeight: 1.3
    letterSpacing: "-0.02em"
  title-sm:
    fontFamily: "Geist, ui-sans-serif, system-ui, sans-serif"
    fontSize: "1.0625rem"
    fontWeight: 650
    lineHeight: 1.35
    letterSpacing: "-0.02em"
  prose:
    fontFamily: "Geist, ui-sans-serif, system-ui, sans-serif"
    fontSize: "1.0625rem"
    fontWeight: 400
    lineHeight: 1.65
  body:
    fontFamily: "Geist, ui-sans-serif, system-ui, sans-serif"
    fontSize: "0.9375rem"
    fontWeight: 400
    lineHeight: 1.55
  body-sm:
    fontFamily: "Geist, ui-sans-serif, system-ui, sans-serif"
    fontSize: "0.84375rem"
    fontWeight: 400
    lineHeight: 1.55
  label:
    fontFamily: "Geist, ui-sans-serif, system-ui, sans-serif"
    fontSize: "0.84375rem"
    fontWeight: 600
    lineHeight: 1.2
    letterSpacing: "-0.005em"
  group-label:
    fontFamily: "Geist, ui-sans-serif, system-ui, sans-serif"
    fontSize: "0.75rem"
    fontWeight: 600
    letterSpacing: "0.05em"
  tag:
    fontFamily: "Geist, ui-sans-serif, system-ui, sans-serif"
    fontSize: "11px"
    fontWeight: 700
    lineHeight: 1
    letterSpacing: "0.04em"
  wordmark:
    fontFamily: "Geist, ui-sans-serif, system-ui, sans-serif"
    fontSize: "1.0625rem"
    fontWeight: 750
    letterSpacing: "-0.035em"
  mono:
    fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, Liberation Mono, monospace"
    fontSize: "0.88em"
rounded:
  mark: "4px"
  inline: "6px"
  field: "10px"
  md: "12px"
  lg: "16px"
  xl: "24px"
  slab: "40px"
  pill: "999px"
spacing:
  s1: "4px"
  s2: "8px"
  s3: "12px"
  s4: "16px"
  s5: "24px"
  s6: "32px"
  s7: "48px"
  s8: "64px"
components:
  button-primary:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.on-primary}"
    typography: "{typography.label}"
    rounded: "{rounded.pill}"
    padding: "7px 16px"
    height: "34px"
  button-primary-hover:
    backgroundColor: "{colors.primary-hover}"
  button-secondary:
    backgroundColor: "{colors.tile}"
    textColor: "{colors.ink}"
    typography: "{typography.label}"
    rounded: "{rounded.pill}"
    padding: "7px 16px"
    height: "34px"
  button-secondary-hover:
    backgroundColor: "{colors.tile-hover}"
  button-compact:
    rounded: "{rounded.pill}"
    height: "32px"
  button-marketing-large:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.on-primary}"
    rounded: "{rounded.pill}"
    padding: "0 26px"
    height: "54px"
  button-marketing-light:
    backgroundColor: "{colors.sheet}"
    textColor: "{colors.ink}"
    rounded: "{rounded.pill}"
    padding: "0 26px"
    height: "54px"
  nav-link:
    textColor: "{colors.muted}"
    typography: "{typography.label}"
    rounded: "{rounded.pill}"
    padding: "7px 12px"
  nav-link-current:
    backgroundColor: "{colors.sheet}"
    textColor: "{colors.ink}"
  count-badge:
    backgroundColor: "{colors.accent}"
    textColor: "{colors.on-accent}"
    rounded: "{rounded.pill}"
    padding: "0 5px"
    height: "18px"
  tag:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.on-primary}"
    typography: "{typography.tag}"
    rounded: "{rounded.pill}"
    padding: "4px 9px"
  tag-tile:
    backgroundColor: "{colors.tile}"
    textColor: "{colors.ink}"
    typography: "{typography.tag}"
    rounded: "{rounded.pill}"
    padding: "5px 10px"
  tag-accent:
    backgroundColor: "{colors.accent-soft}"
    textColor: "{colors.ink}"
  boost:
    backgroundColor: "{colors.tile}"
    typography: "{typography.body-sm}"
    rounded: "{rounded.pill}"
    padding: "4px 12px"
    height: "32px"
  face:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.on-primary}"
    rounded: "{rounded.pill}"
    size: "32px"
  input:
    backgroundColor: "{colors.sheet}"
    textColor: "{colors.ink}"
    typography: "{typography.body}"
    rounded: "{rounded.field}"
    padding: "6px 12px"
    height: "36px"
  page-sheet:
    backgroundColor: "{colors.sheet}"
    rounded: "{rounded.xl}"
    padding: "40px 48px"
  tile:
    backgroundColor: "{colors.tile}"
    rounded: "{rounded.xl}"
    padding: "24px"
  tile-hover:
    backgroundColor: "{colors.tile-hover}"
  composer:
    backgroundColor: "{colors.tile}"
    rounded: "{rounded.xl}"
    padding: "16px"
  empty-state:
    backgroundColor: "{colors.tile}"
    textColor: "{colors.muted}"
    rounded: "{rounded.xl}"
    padding: "48px 24px"
  board-column:
    backgroundColor: "{colors.tile}"
    rounded: "{rounded.xl}"
    padding: "12px"
    width: "256px"
  board-card:
    backgroundColor: "{colors.sheet}"
    rounded: "{rounded.lg}"
    padding: "12px"
  icon-square:
    backgroundColor: "{colors.tile}"
    textColor: "{colors.ink}"
    rounded: "{rounded.md}"
    size: "40px"
  calendar-today:
    backgroundColor: "{colors.accent}"
    textColor: "{colors.on-accent}"
    rounded: "{rounded.pill}"
    size: "24px"
  calendar-event:
    backgroundColor: "{colors.tile}"
    rounded: "{rounded.inline}"
    padding: "3px 7px"
  calendar-due:
    backgroundColor: "{colors.accent-soft}"
  progress-bar:
    backgroundColor: "{colors.sheet}"
    rounded: "{rounded.pill}"
    height: "6px"
  progress-fill:
    backgroundColor: "{colors.accent}"
  slab:
    backgroundColor: "{colors.slab}"
    textColor: "{colors.slab-ink}"
    rounded: "{rounded.slab}"
    padding: "120px 0"
  check:
    backgroundColor: "{colors.sheet}"
    size: "22px"
  check-done:
    backgroundColor: "{colors.accent}"
    textColor: "{colors.on-accent}"
---

# Design System: Saintsflow

## Overview

**Creative North Star: "The Gray Studio Table"**

Saintsflow borrows kargul.studio's world and puts a Basecamp-style app on it. Picture a light-gray table (the ground) with white sheets of paper lying on it. Softer gray tiles are grouped on each sheet, and near-black pills, discs and slabs are the only heavy objects. Everything is rounded, flat, and set in one typeface, Geist. Depth comes from the order of the layers, never from shadows.

The same world has two volumes. In the app (Operate) it is calm and dense: fixed rem type steps topping out at 2rem, small pill controls, and plain semantic HTML styled by a classless base layer. Every tool page uses the same kit: a heading with its actions on the right, hairline-ruled record rows led by a face, tiles for anything grouped, and a tile for an empty state. On marketing (Persuade) it plays at full strength: clamp-scaled 750-weight headlines, 54px pill CTAs, 40px-round dark slabs running nearly the width of the page, a framed example project, and a giant cropped wordmark at the foot of the page. After kargul.studio, it also has a news pill above the headline with a Kargul Orange dot that rings, and line art on a slab (the Agents section's isometric board plates, one drifting, a card landing in Review); every motion rests in its final state, so reduced motion shows the still drawing.

One orange does all the signaling. It marks what needs your attention or what has finished: unread counts, today, done checks, progress, focus. That is how the product's first principle (calm over urgent) shows up visually. The dark theme mirrors the light one layer for layer. The primary pill and the face discs flip to near-white, so they stay the heaviest objects on the page.

**Key Characteristics:**
- Gray ground, white sheet, gray tile: three tonal layers, no shadows in the app.
- One typeface (Geist variable, self-hosted), tight negative tracking on headings.
- Pills for every control; 24px corners on every container; 40px on slabs.
- Near-black pill = primary action; tile-gray pill = secondary.
- People appear as initials on a dark disc, in a 32px column at the start of every record row.
- Single orange accent, reserved for attention and completion.
- Hover exists only for fine pointers; reduced motion removes movement but keeps fades.
- Light and dark themes mirror each other; the OS decides unless a person pins one.

## Colors

The world is a neutral grayscale with one warm orange signal. Apart from that orange, hue appears only in status colors and the small label dots people pick for board columns.

### Primary
- **Pill Black** (`primary`): the primary action. It fills dark pill buttons, the HQ / All-access tags, the hero CTA and face discs. Hover deepens to **True Black** (`primary-hover`), and text on it is **Sheet White** (`on-primary`). In the dark theme it flips to near-white (#f2f2f2) with dark text (#121212), so the primary stays the highest-contrast object.

### Secondary
- **Kargul Orange** (`accent`): the only accent. It is used for:
  - unread count badges in the nav;
  - the Today line and label on the Lineup, and today's date disc on the Schedule;
  - done checkboxes and progress fills (a task list's bar, the project's progress);
  - the marketing news dot, and the card in the Agents drawing;
  - the text caret, and selection and focus rings (via `color-mix` at 28-38%).

  Text on it is **Burnt Ink** (`on-accent`), a near-black brown.
- **Peach Wash** (`accent-soft`): the soft-attention tint. It fills `<mark>`, the Pinned tag, due-date pills on the calendar, and check hover.
- **Amber Focus** (`focus`): the darker orange for focus outlines and focused-input borders, where the base orange lacks contrast.

The orange is identical in both themes.

### Neutral
- **Studio Gray** (`ground`): the page ground the chrome sits on (nav, breadcrumbs, flash). Dark: #121212.
- **Sheet White** (`sheet`): the page sheet, inputs, the current nav pill, cards inside board columns, fields inside composers, marketing cards, the 2px ring around stacked faces, and progress-bar tracks. Dark: #1c1c1c.
- **Tile Gray** (`tile`): tiles, cards, board columns, composers, empty states, icon squares, secondary buttons, boost and tag pills, calendar headers, and code/pre/blockquote/note fills. Its hover state is **Tile Pressed** (`tile-hover`). Dark: #242424 / #2c2c2c.
- **Ink** (`ink`): body text and headings. Dark: #f2f2f2.
- **Muted Graphite** (`muted`): secondary text, dates, group labels, bylines, quiet links, inactive nav links, placeholders. Dark: #a3a3a3.
- **Hairline** (`line`): 1px rules between rows, table and calendar cells, day dividers, fieldsets and `<hr>`. Dark: #2d2d2d.
- **Control Gray** (`control`): input borders, unchecked check strokes, breadcrumb separators, a finished list's bar, and the scrollbar thumb. Dark: #6b6b6b.
- **Slab Charcoal** (`slab`) with **Slab Tile** (`slab-tile`), **Slab Ink** (`slab-ink`) and **Slab Muted** (`slab-muted`): the dark slab family, for marketing slabs and their rules, the offline strip, the marketing promo strip, and the app footer. Dark: slab goes to pure #000000 and slab-tile to #1a1a1a.

### Status
- **Alert Red** (`danger`) on **Alert Blush** (`danger-soft`): `[role=alert]` validation boxes only. Dark: #ff7b6e on #3a1714.
- **Live Green** (`success`): the 7px dot in flash messages. Dark: #4ade80.

### Label Dots
- **Red, Orange, Yellow, Green, Blue, Purple, Gray** (`label-*`): the fixed set a person can pick for a card-table column. They render only as a 9px dot before the column name, the same in both themes. Orange is the accent value itself.

### Named Rules
**The Single Orange Rule.** Orange means "this needs you" or "this is done": unread, today, done, progress, focused. It never fills a button, a heading, a card or a background region. Peach Wash is the only orange that may fill an area, and only a small one (a tag, a calendar pill, a highlight).

**The Dot-Only Label Rule.** People-picked label colors appear as 9px dots and nothing larger. They never tint a card, a column or text.

**The Mirror Rule.** Every color token has a light and a dark value defined together; a new color is not done until both exist. Themes swap values, never structure.

## Typography

**Display Font:** Geist variable (100-900), self-hosted at `/fonts/Geist-Variable.woff2`, falling back to ui-sans-serif / system-ui.
**Body Font:** Geist, same file.
**Label/Mono Font:** the ui-monospace stack, used only for `code`, `kbd` and `pre`.

**Character:** A single neo-grotesk does everything, distinguished by weight (400 to 800) and tracking (-0.06em on the giant wordmark up to +0.05em on uppercase labels). Headings are heavy and tight; body text is plain and open at 1.55 line height.

### Hierarchy
- **Display** (750, clamp up to 5.25rem, 0.98): the marketing hero headline only, capped at 14ch and centered.
- **Headline** (750, clamp up to 3.25rem, 1.05): marketing section headings.
- **Wordmark, giant** (800, clamp 3.5 to 14rem, 0.8, -0.06em): the marketing footer wordmark, cropped by the page bottom. One per page, marketing only.
- **Title, page** (700, 2rem, 1.15): the app `<h1>`, set through `pageHead()` with actions beside it, and the ceiling inside the app. The project page sets it smaller (1.625rem) so its windows get the screen.
- **Title** (650, 1.25rem, 1.3): the app `<h2>`. Calendar captions use 700 at this size.
- **Title, small** (650, 1.0625rem): `<h3>`, card and tile titles, record-row titles (600), and the app wordmark.
- **Prose** (400, 1.0625rem, 1.65, max 68ch): the readable body of messages, docs and other long-form records.
- **Body** (400, 0.9375rem, 1.55): everything else. Paragraphs cap at 72ch and comments at 70ch.
- **Body, small** (400, 0.84375rem): card descriptions, row meta, bylines, tables, breadcrumbs, toolbars and `<small>`.
- **Label** (600, 0.84375rem): buttons, nav links and summary pills.
- **Group label** (600, 0.75rem, +0.05em, uppercase, muted): table headers, nested fieldset legends, group headings above card grids, day dividers in chat.
- **Tag** (700, 11px, +0.04em, uppercase, line-height 1; 11px is the floor for functional text): text inside small pills (HQ, All-access, Pinned, a category, Today).

### Named Rules
**The Two Volumes Rule.** The app uses only the fixed rem steps (0.75 to 2rem, plus 2.5rem for a project title). The fluid `clamp()` steps (display, headline, giant wordmark) belong to marketing and signup.

**The Tight Heading Rule.** Every heading tracks negative (-0.01em at h3 up to -0.06em on the giant wordmark) and wraps with `text-wrap: balance`. Only uppercase labels and tags track positive.

## Layout

The app frame is a single centered column, max 1200px wide. Side padding is 16px (8px for the frame on phones), growing to 32px at 768px. The chrome (wordmark, pill nav, Find/Jump) sits on the gray ground above the sheet. Breadcrumbs and the flash pill also sit on the ground, between the nav and the sheet. The `<main>` sheet pads 24px/20px on phones and 40px/48px on desktop.

Each tool page follows one order: heading with actions (wraps under the title on narrow screens), optional tags and byline, then the content, then a quiet row of small muted links at the foot (32px above). Content comes in four shapes:
- **Tile grids:** project cards auto-fill at 260px, list cards and question cards at 300px, and file cards at 200px. Gaps are 12-16px.
- **Windows:** the project page shows its tools as windows: the one you're in, and a rail of the rest (see Project Windows below).
- **Record rows:** a `32px 1fr` grid with the face in the first column. Comments, chat lines and message rows all use it; vault rows use a 40px icon column instead.
- **The board:** Fizzy's columns (Not now, To do, yours, Done), at least 240px wide, in one row that scrolls sideways with snap points.
- **Ruled tables:** the month calendar.

Filter toolbars sit above lists with 32px controls. Spacing follows a 4px base (4, 8, 12, 16, 24, 32, 48, 64). Section breaks inside a page are 32px, and a discussion section opens 48px down with a hairline above it.

Marketing uses a 1224px column with the same gutters. It switches to its multi-column grids at 900px: the tool grid goes 1/2/4 columns, split sections 5fr/7fr, and the example project 1/2/3 columns (its Board tile spans two, packed dense so there's no hole), and the Milestones section's three tasks sit side by side. Sections are spaced 64px on phones up to 120-140px on desktop, and slabs run nearly full width with 40px corners.

Tables become horizontally scrollable blocks under 640px. Pages work without JavaScript.

## Elevation & Depth

The system is flat. Depth is tonal: the Studio Gray ground, then the Sheet White page, then Tile Gray tiles, each a few points lighter or darker than the last. Where something sits inside a tile (a board card, a composer's field, a thumbnail, a progress track), it steps back up to Sheet White. Hover deepens a tile to Tile Pressed instead of lifting it. The dark Slab family is the inverse layer, used for emphasis blocks and the footer. The one exception is the framed example project on marketing, which floats on a soft ambient shadow so it reads as a screenshot of the app set on the page.

### Shadow Vocabulary
- **Demo Float** (`box-shadow: 0 1px 2px rgba(0,0,0,.04), 0 24px 60px -24px rgba(0,0,0,.18)`): the marketing example-project frame only.
- **Focus Halo** (`box-shadow: 0 0 0 3px color-mix(in srgb, accent 28%, transparent)`): focused text inputs, selects and textareas. It is a state ring, not elevation.

### Named Rules
**The Tonal Stack Rule.** Ground, sheet, tile, sheet: when something needs to stand apart, move it one layer instead of shadowing it. App surfaces carry no shadows.

## Shapes

Two silhouettes cover nearly everything.

Controls are full pills (999px): buttons, link-buttons, nav links, count badges, tags, boosts, summary toggles, the flash message, Lineup bars, the Today label, progress bars, and inline boost fields. Faces and today's date on the calendar are full discs.

Containers are generously rounded rectangles:
- 24px for the sheet on desktop and every tile, card, panel, composer, empty state and board column (the sheet drops to 16px on phones);
- 16px for anything nested one level inside a tile (board cards, file thumbnails), for the month calendar, and for fieldsets;
- 32px for the marketing demo and Milestones frames on desktop;
- 40px for slabs and the top corners of the app footer.

Smaller radii are functional, a fixed inline step set:
- 12px for icon squares, images, notes, alerts, chat file chips, `pre` and blockquotes;
- 10px for text fields;
- 7px (9px large) for checks;
- 6px for inline code, kbd, calendar event pills and the focus outline;
- 4px for `<mark>` highlights, the smallest step, sized so a highlight inside running text hugs the glyphs instead of reading as a pill.

Tiles and cards have no borders. Borders appear only as 1px hairlines between rows, as the 1.5px Hairline outline on project windows, on fieldsets, around and inside the ruled month calendar, as the 1px Control Gray stroke on inputs, the 1.5px stroke on checks, and the 2px Sheet White ring that separates stacked faces.

**The Pill-Or-Card Rule.** If you can click it and it is not a container, it is a pill. If it holds content, it is a rounded card with no border: 24px at the top level, 16px when nested.

**The Nested Corner Rule.** A shape inside a rounded container drops one radius step (24 → 16 → 12) so the inner and outer corners stay concentric.

## Components

### Buttons
Soft, small and confident; pills that press in slightly.
- **Shape:** full pill (999px), 34px minimum height, 7px 16px padding, label type.
- **Primary:** Pill Black with white text. The base layer promotes it automatically in two cases. The first button or `a[data-button]` link-button in a `<p>` becomes primary. So does the button after the fields in a non-GET form, with or without a Cancel link after it, and the "Yes, …" button of a confirm form ("Yes, …" then "Never mind"). Everything else stays secondary. A page can also say so outright: `data-primary` promotes the one button that is the real next step ("Mark as done" on a card, "Send" in chat), and `data-quiet` keeps a button plain where the rule would wrongly promote it (React, "Add a card"). One primary per page, and it is the step that matters most. A plain link right after a button gets 8px of extra room.
- **Secondary:** Tile Gray with Ink text, hovering to Tile Pressed. This is the default for a bare `<button>`, a `a[data-button]` link and file-selector buttons.
- **Link-buttons:** an `<a data-button>` looks and behaves exactly like `<button>`, for navigation that reads as an action ("New list", "Make a new project").
- **Text buttons** (`kit.linkButton`): a `<button>` that reads as an underlined text link, for a secondary action that still has to post ("Stop watching", "Pin it").
- **Plain on a tile:** a secondary button that sits on Tile Gray (a board column, the chat composer) takes Sheet White instead, so it doesn't vanish into the tile.
- **Compact sizes:** 32px in filter toolbars, boost forms and composers; 28px on board cards; 24px for the round remove-boost control.
- **Hover / Focus / Active:** the background shifts in 150ms, and hover applies only under `(hover: hover) and (pointer: fine)`. Active scales to 0.97 on the ease-out curve `cubic-bezier(.22, 1, .36, 1)`. Focus is a 2px Amber Focus outline at 2px offset. Disabled is 45% opacity. Tap highlight is off.
- **Marketing pills:** 44px by default, 40px small, 54px large (26px padding, 1.0625rem, weight 650). The dark pill (Pill Black) and the light pill (Sheet White, hovering to Tile Gray) always appear as a pair in the hero and closing CTAs.

### Chips and Tags
- **Status tag:** Pill Black pill, 4px 9px, tag type. It marks a project's standing (HQ, All-access).
- **Record tag:** Tile Gray pill, 5px 10px, tag type, in a row above a record's title (category, "Answer to"). The **accent variant** fills it with Peach Wash for Pinned.
- **Count badge:** an 18px Kargul Orange pill with 11px Burnt Ink tabular numerals, inside a nav link, for unread Pings and Hey!. Board columns show their card count as a Sheet White version of the same pill.
- **Boost:** a 32px Tile Gray pill holding a short reaction and the booster's name in muted xs. Your own boost carries a 24px Sheet White round remove button.
- **Quiet chip:** Sheet White pill with a 7px dot and xs muted text ("Notifications paused").

### Faces
A person is their photo, or else up to two initials on a Pill Black disc (650 weight, -0.02em tracking, text at 40% of the disc size). The default size is 32px. Faces are always decorative, because the name is written next to them. In a subscriber list, faces stack with an -8px overlap and a 2px Sheet White ring around each.

### Cards / Containers
- **Corner Style:** 24px (`xl`); 16px when nested inside a tile.
- **Background:** Tile Gray on a sheet; Sheet White inside a tile or on the ground (marketing cards); Slab Tile on a slab.
- **Shadow Strategy:** none (see Elevation & Depth).
- **Border:** none; the base layer's list hairline is explicitly removed on cards.
- **Internal Padding:** 24px for content cards, 16px for composers and answer cards, 12px for board columns, board cards and file cards.
- **Whole-card links:** list and file cards make their title link cover the whole card (a stretched `::after`), so the card hovers to Tile Pressed as one target.
- **Empty state:** a Tile Gray card with 48px/24px padding, centered muted text and usually one action.

### Inputs / Fields
- **Style:** Sheet White fill, 1px Control Gray stroke, 10px radius, 36px minimum height, 6px 12px padding. Text fields cap at 32rem and textareas at 48rem. Selects draw their own chevron from two gradients. Checkboxes, radios, meters and progress use the orange through `accent-color`.
- **In a tile:** comment boxes and the chat composer are Tile Gray cards whose full-width textarea stays Sheet White. The comment box keeps a 32px face column beside its field. The chat composer is one row (a round attach button, the field, Send), 18px corners; the field grows as you write, up to six lines. Its placeholder names the room ("Message Chat", "Message Ann, Bob") and there are no hints under it: Enter sends with a keyboard, and is a new line on a phone.
- **Focus:** the border turns Amber Focus, plus the 3px orange Focus Halo; there is no outline.
- **Error:** errors are listed above the form in an Alert Red on Alert Blush box (12px radius). Fields themselves do not turn red.
- **Filters apply as you pick:** a filter or sort form (`ref={submitOnChange}`) submits the moment a field changes. There is no Filter or Apply button; "Clear" shows only while a filter is on. A filter row earns its place: Posts shows its category filter only past 5 posts.
- **Row actions:** an action on every row of a list ("Move to…" on tasks, cards and files) is a quiet dropdown (`kit.quietSelect`: no box until hovered) that acts the moment you pick, with no separate Move button. On fine pointers it shows only while its row is hovered or focused (`data-row-action`, app.css); on touch it is always there.
- **File inputs** are dressed as a secondary button ("Attach a file") with the native box hidden; the chosen file's name shows beside it.
- **Settings you change once** live out of the way and save as soon as you pick. Chat's ("Notify me about" as a small select, and "Set up bots") sit in the conversation's start line, above its oldest message: "**This is the start of Chat.** Quick questions, quick answers."

### Navigation
- **App nav:** half a bar, on purpose: `Acme · Private chats · Updates · Find · (your face)`. The account name is a 750-weight wordmark on the ground and it is Home; Private chats and Updates are pill links (muted, 500 weight, 7px 12px) with their unread counts inside. On fine pointers, hover tints the pill toward white (sheet at 60%); the current page is a solid Sheet White pill with Ink 600 text. At the right end, Find (its title names Ctrl/⌘ + K for Go to), then your face (30px) linking to Me, ringed in Ink on your own pages. Timeline and Activity are reached from Home. The nav wraps on narrow screens rather than collapsing.
- **Breadcrumbs:** small muted links on the ground, separated by Control Gray slashes.
- **Quiet link row:** a wrapping row of small links at the foot of a tool page.
- **Marketing nav:** the text links are hidden under 900px; the Log in text link and a small light Sign up pill stay visible.

### Menus
The project menu and an item's ••• menu use `menu` from `ui.ts`: a 560px column of labelled groups (group-label type), each a Tile Gray card with 24px corners holding 48px rows split by hairlines. A link that opens a page and a form button that acts look like the same row; links end in a muted chevron. Rows hover to Tile Pressed and don't scale on press. "Put … in the trash" is the one Alert Red row, hovering to Alert Blush. Groups with nothing in them for the current person aren't drawn.

### Record Rows and Threads
Each row is a 32px face, then a name and muted meta on one baseline, then the body. Chat lines tighten this to 4px vertical padding with no rules between lines, and a person's lines within five minutes run together under one face and name (a follow-up shows its time, "1:59", in the face column on hover). Your own lines sit on the right in a Tile Pressed bubble (16px corners, at most 72% wide, 85% on a phone) with no face or name, only the time above the first of a run. A line's React, Edit and Delete float in a small white card on hover: at the top-right corner of someone else's line, beside your bubble (above it on a phone); on touch, a tap on the line shows them. Reactions are pills under the line, one per emoji with its count. Chat breaks by day with a centered group label between two hairlines, while check-ins use a left label followed by a hairline. File attachments in chat are 12px-round Tile Gray chips. A record's byline is a face, the name in Ink 600, and muted small text.

### The bottom of a record
Every record page (a post, doc, file, task, card, event, list) ends the same short way, so the record stays the biggest thing on it:
- **Reactions:** the boost pills, then one quiet "React" toggle that opens a field and "Add".
- **Comments:** the "Comments" heading only once there are some. Each comment's "React" (and your own Edit and Delete) shows on hover, like chat. The comment box is one line until you're writing in it (focused, or with text in it); only then do the @-mention hint, "This notifies N people · Who's that?" and "Add this comment" appear. No "reply to the email" footnote.
- **Who gets notified:** one muted line: 24px faces, "4 people get notified of new comments", Change, and a text-button Unsubscribe me (or "You're not notified of new comments" and Subscribe me).
- Then "••• More options for this post".

### Drawn Check
The to-do check is a 22px rounded square: 7px radius, 1.5px Control Gray stroke, Sheet White fill. On fine pointers, hover fills it with Peach Wash and turns the stroke Amber Focus. When done, it fills Kargul Orange with a drawn Burnt Ink tick (SVG, 1.8px stroke, round caps). A 28px / 9px-radius variant is used on a to-do's own page, and the marketing demo uses a 16px / 5px-radius version (22px for a task heading) that draws its tick and strikes its title when checked.

### List Progress
The Milestones window (tasks under one bar) is one bar and one list, like Basecamp's to-dos. On top, the share of the work done (1.5rem 700, tabular), "done · 2 of 8" and any late count (Accent Text 600) in muted text, then a 6px pill bar. Then the open tasks in order, hairline-split: a check button, the title, a muted "1/3" when it has subtasks, and a muted line of who, when (late in Accent Text 600), comments and 📝 for notes. A task's subtasks sit indented under it (34px) with smaller 18px checks. A task with subtasks is done when they all are: ticking it ticks them, ticking the last one ticks it, reopening one reopens it. Progress counts the work: a task, or in its place its subtasks, so splitting a task never skews the bar. Adding is one line, "Add a task…" and a quiet Add: Enter adds it at once and the field is ready for the next. "+ Subtask" is a quiet row action (on hover) that opens the same one line under the task; Escape closes it. Dates and people are set on the task's page. Tasks reorder by dragging (an orange 2px line shows where it lands) or Alt+↑/↓. Done tasks fold under "Show N done tasks". The project head, Home's cards and the Overview show the same share with the shared `ProgressBar` (Tile Pressed track, Kargul Orange fill).

### Lineup Bars
Each dated project is a 34px Tile Gray pill positioned on one shared track, with left and width set as percentages of the date range. The name is 600 weight and the dates muted 400. A 2px Kargul Orange vertical line marks today, topped by an orange "Today" pill in tag type.

### Home
Home is the dashboard, and it answers "where do I need to be today?" There is no visible title (the wordmark says where you are).
- **Projects first:** "Projects" (lg) with "Make a new project" beside it, then one grid of cards (260px min, 12px gaps): HQ first, then pinned, then recently visited, up to 8, then "All projects (N)" and Templates.
- **A project card** (Tile Gray, 24px corners, the whole card is the link): the name, HQ's tag, one line of description, the dates, then the card's news, like the project's news but window by window: up to three windows by name with an 18px orange count ("Files 6 · Chat 5 · Posts 3"), "N late" outlined in orange, or "All caught up." in muted text. A row of 24px faces sits under it, and "Pin" shows only while the card is hovered or focused (always on touch).
- **Two lists under the projects:** "Due for you" (your tasks and cards, soonest due first, so late leads, its date in Accent Text 650: "was due Oct 20") and "Coming up" (your events in the next two weeks, never the tasks that are already due for you). Five each, with "See all N".
- **Then the Timeline** (the Lineup), and a quiet row: "See all activity", "Invite people".
- **States:** no projects yet: "Welcome. Make your first project, then invite the people working on it." Nothing due: "Nothing's due for you. Enjoy it." Nothing coming up: "Nothing on your calendar in the next two weeks."
- There is no separate "What's new" list: the cards are what's new, and Updates has the rest.

### Project Windows
The project page shows its tools as windows, not a grid of tiles. The decision and the exploration behind it are in `docs/project_ui_explore/`.
- **Head:** the project page drops the breadcrumb and keeps its head short: the title at 1.625rem, the description (what someone wrote for the project, always kept), then one line of facts: the dates, the status once someone has set it ("Set the status" lives in the ••• menu, not on the most-seen screen), and client access. It is padded 24px/28px on desktop. The page draws its own card (`<Page flush>` drops the sheet): this white head is its top half, with the sheet's top corners, and the desk is its bottom half.
- **Desk:** a Tile Gray band, edge to edge under the head and carrying the sheet's bottom corners, that holds the windows with 10px gaps and padding. On desktop it fills the screen below the head (`max(460px, 100dvh - 272px)`). The **master** (the big window) takes every pixel right of the **rail**, a 44px column of icons on the left (300px with its previews open). On phones the master is alone, with the taskbar under it.
- **Window:** a Sheet White card with 12px corners and a 1.5px Hairline outline, the one bordered card in the app: white on Tile Gray alone loses its edge. The outline is a border, not a shadow, so view transitions carry it.
  - Its title bar is 40px with a hairline under it: a 16px tool icon, the name (650, 0.875rem), a one-line muted summary (xs), then the actions. The body pads 12px/14px.
  - The master's one action is a 28px full-screen button (a square; four inward corners while on). There is no close: picking another window from the rail swaps it. Its outline is 2px Kargul Orange, the focus state of the page.
- **The address is the window:** every page that belongs to a window (`/projects/2/posts`, `/projects/2/docs/5`) is a child route of the project page, shown in its main window; `windowOfPath` (shared/domain.ts) says which window a path belongs to. So Back, refresh, copy-a-link, bookmarks and links from Home, Updates or Find all land in the project, in the right window. A bare `/projects/2` goes to the window you had in front last; picking a window goes back to where you were in it. Deeper than the window's start, a back chevron takes the icon's place and goes back to that start. The project's own pages (menu, people, settings, activity, trash) stay pages of their own, and Links has a page of its own so every window has an address.
  - Pages inside drop their own frame: no breadcrumb, sheet or tab title, headings at 1.5rem, and at the tool's start the page heading is kept for screen readers only (the title bar names the tool). Chat opens at its newest lines.
  - A flash raised while working in a window floats just above the taskbar (it rises 8px in, 220ms ease-out) instead of pushing the page down, and its Undo runs in that window.
- **Full screen** lifts the desk over the whole page: the master alone above the taskbar, the page under it held still. Switching windows from the rail (or the taskbar) keeps it on; Escape or the button comes back out. It isn't remembered across visits.
- **The rail** (desktop, 900px and up) is the one way around: every window as a 40px icon (12px corners), in project order, so a hand learns where Chat is. Nothing sorts, nothing is left out. The open one is Pill Black; one with news is Peach Wash with an 18px Kargul Orange count on its corner (ringed in Tile Gray); one with late work is outlined in orange at 55%. A quiet "+" at the end (for everyone but clients) goes to add or remove windows.
  - **One list, two looks.** The rail's top button (a panel icon, muted; Tile Hover fill while open) turns the icons into previews, in the same order, each in its icon's place: the window's title bar (the whole bar is the button), then the start of its body, fading out, inert, all 168px tall in a 300px column that scrolls when they don't fit. The window in front has no preview: it's already open beside them (its rail icon fades as the others fly). A window with nothing in it yet says so in its title bar ("No files yet") and shows a still skeleton of five Tile Gray 8px lines, the same 168px as the rest: still, not shimmering, since nothing is loading. A quiet "Add or remove windows" ends the list. Never two lists side by side: they'd never line up.
  - **Never over your work.** The rail widens and the master gives way in one slide (280ms open, 200ms close, the drawer curve cubic-bezier(0.32, 0.72, 0, 1)); each icon flies from the rail to its own preview’s title bar on the same curve and time, shrinking from 18px to 16px, while its fill, outline and count fade; the previews fade in 60ms behind and their own icons take over when the flight lands. Closing, the icons fly back. That flight is what ties an icon to its preview. Toggling mid-flight turns the icons around from where they are. The previews never move: their width is fixed, so the slide uncovers them and the icons know where to land. Reduced motion: no slide, no flight, the fades stay.
  - It's a click, not a hover: the master changes width, and work shouldn't reflow because the pointer brushed the edge. Open or closed is remembered in this browser (`saintsflow:previews`).
  - **Clicking an icon or a preview swaps them in place:** the picked window glides into the master, and the one you left glides into its spot in the list (the picked one leaves the list). Those two glide, and the previews between them slide a slot; the rest hold still.
  - A preview's title bar shows "N new" (an orange xs pill) or its summary.
  - A window with nothing in it yet says so in one muted sentence, its summary ("No files yet."). No placeholder bars: gray bars say "loading", and nothing is.
  - The Tasks preview leads with what's late, in Accent Text 650: "1 late: Pick the type pairing", then who and "was due Oct 20". Previews draw no checkboxes; they'd look tickable and aren't.
- **What's new, inside a window:** the project's "since" moment reaches the window's pages (`useSince`).
  - Chat draws HEY's line, "New since Tuesday" (the day rule and label in orange), before the first new line, and opens there.
  - Lists (Posts, Files) mark each new item with a solid Kargul Orange "New" tag beside its title (`NewTag`), never Peach Wash, which is Pinned. It works whichever way a list runs.
  - New means someone else added it after your last visit; what you wrote yourself is never new to you.
- **A brand-new project** (every window empty) says one line in place of the news: "A fresh start. Invite the people on it, then post what this project is about."
- **Nothing under the desk** but the taskbar: "Add a link" and "See all activity" live in the ••• project menu.
- **What's new:** one sentence, the last line of the project head, on its white, padded like it. It isn't a way around (the rail is); it says where to look.
  - "**Since Tuesday:** 18 new in Tasks, Files and Chat." (the "since" in words and 650 weight: "Since yesterday:", "Since Oct 12:"), or "All caught up." in muted text when nothing is new. Then any late work, in Accent Text 650: "1 late in Tasks." A first visit shows only the late work, if any.
$1 what other people added since you last opened that window (comments count in the window of what they comment on; board columns, task groups and card steps aren't news). Opening a window is reading it, and only that window: glancing at the project leaves the others' news waiting. A window never opened yet counts from your previous visit to the project. The times live in `prefs.window_seen` ("2:campfire"), merged in the database on each visit; the page reads them once as it opens, so counts don't vanish while you're looking. Home's cards count the same way (`src/client/news.ts`).
  - In full screen the sentence sits at the top of the overlay, on Tile Gray, led by the project's name in 650 ("**Website Redesign** · All caught up."), since the head is out of sight; the rail stays beside the master.
- **On a phone** the main window is part of the page, not a box that scrolls inside it, and Chat's pinned composer sits just above the bottom bar.
- **Taskbar** (phones and tablets, under 900px): the Slab Charcoal pill (18px corners) of 38px icon buttons, Slab Ink fill for open windows. It sticks to the bottom of the screen (safe-area padding), in thumb reach, scrolls sideways, and fades at its end only while there is more to scroll to. A window with news or late work carries a 7px orange dot.
- **Motion:** swapping windows by mouse glides with a view transition (240ms, cubic-bezier(0.32, 0.72, 0, 1)); the windows' pictures are clipped, never stretched. Keyboard swaps are instant. Reduced motion keeps the fades and drops the movement.

### Shaped for daily use
- **A task's page:** its check and title, then its subtasks (a small bar with "1 of 3 done · this task is done when they all are", each subtask with its check, and the one-line "Add a subtask…"), then its details (assigned, notify, due, notes, added by) and Edit. A subtask's page says "A subtask of …". `kit.quietSummary` is the look of a quiet toggle: a disclosure with no pill and no chevron.
- **Files:** "Upload files" is the primary, "New doc" beside it, and a quiet ••• holds New folder and "Link a Google Doc, Sheet or other file". Sort and View appear past 10 items. A folder's color is a 9px dot before its name, never the color's name.

### Board
The board follows Fizzy: Not now · To do · your columns · Done, in that order, in a single row of Tile Gray columns at least 240px wide that share the width when they fit and otherwise scroll sideways (snap to column start, overscroll contained, the row's end fading while more wait, `fadeOverflow`). Each column head carries a 9px label dot, the name, a Sheet White count pill and a quiet ••• for its options; watchers, if any, sit in a muted line under it. Cards are Sheet White with 16px corners and 12px padding, sized to what's on them; they drag up and down their column or into another (the dragged card fades to 45%, a 3px Kargul Orange line shows where it will land, and another column under it turns Tile Pressed with a 2px Kargul Orange inset ring), and land exactly there. There's no "Move to…" on the board; on a phone, where nothing drags, a card's page moves it with its column dropdown. New cards land in To do from a quiet "+ Add a card" that opens a one-line field (Enter adds, the next is ready, Escape closes). A Golden Ticket keeps a card at the top of its column, above any reordering, in Peach Wash with an Accent Text ★ before its title. A card nobody touches for 30 days (it, its steps or its comments) moves to Not now on its own, and the activity says so; Golden Tickets stay put. Empty columns say what they're for: "New cards start here.", "Cards nobody touches for 30 days end up here.", "Done cards land here." A card's own page leads with its title, then one muted line of facts: its column as a quiet dropdown that moves it, ★ Golden Ticket, who has it, when it's due. "Mark as done" is the primary, with Edit and "Give it a Golden Ticket" as text actions. Steps use the drawn check, with who and when in xs under the name, and Remove as a row action; "Add a step" is a toggle that opens a small form. Columns are added like Fizzy's: a dashed "+ Add a column" tile after Done opens a one-line name field (Enter adds it before Done, the next is ready, Escape closes). Your own columns reorder by dragging their head (it fades; a 3px Kargul Orange edge shows where it lands); Not now, To do and Done stay put. Pressing the board's background (not a card, a column head, a button or a field) and dragging sideways pans it, Trello-style, with a grab hand while it can scroll (a mouse only; touch scrolls by itself). The board has no scrollbar (the faded end says more columns wait) and fills its window, so all of the space under the columns pans too. Nothing on the board selects as text, so a drag never highlights anything; an empty column keeps its sentence while a card is over it, with the drop line above it.

### In a project window
Pages shaped for a project window, which is about 800px wide and 560px tall. Calendar and Chat change only inside a window (`InWindow`); the others look this way on their own page too.
- **Calendar:** "Coming up" (the next 8) comes first and the month grid follows. On its own page the month leads. A due date reads "Due: …" in the month grid only; the list already says "Due" in its time column.
- **Chat:** the conversation fills the window, so the composer sits at its bottom even when the talk is short, and stays pinned there while you read back, with the window's white painted into the gap under it. It opens at its newest lines. A new line scrolls the window (never the page): yours always, someone else's only when you're already at the bottom.

### Month Calendar
The month calendar is a fixed-layout table inside a 1px Hairline frame with 16px corners. It has Tile Gray header and blank cells, hairline cell borders and 104px cells. Day numbers sit in 24px discs, and today's disc is Kargul Orange. Events are 6px-radius Tile Gray pills, while due dates use Peach Wash pills.

### File Icons
Vault rows lead with a 40px Tile Gray square (12px radius) holding a 20-unit line icon drawn in currentColor at a 1.5px stroke with round caps and joins. Grid view shows 200px file cards with a 4:3 Sheet White thumbnail at 16px corners.

### Slabs
Slabs are Slab Charcoal blocks with 40px corners (28px on phones) and 64-120px vertical padding. They hold Slab Tile cards, Slab Tile rules, and Slab Ink / Slab Muted text. They are used for the marketing "each project gets its own space", "bring your own agent" and startups sections. The app footer is the same material with only its top corners rounded. Full-width one-line slab strips (no radius) carry the offline notice and the marketing promo.

### Tasks on marketing
The marketing "progress" section shows a project's tasks the way the app does: the percentage in 3rem 750, "done · 7 of 11", one 10px bar, then each task with its check and its subtasks' count. Once scrolled into view the bar fills from the left (transform: scaleX, 1.1s strong ease-out); under reduced motion or without JavaScript it's simply full.

### Giant Wordmark
The marketing footer ends with "Saintsflow" in the giant wordmark step, cropped by the page bottom and hidden from assistive tech. Marketing only.

## Do's and Don'ts

### Do:
- **Do** put the page on a Sheet White sheet (24px radius on desktop) over the Studio Gray ground, with chrome on the ground.
- **Do** open a tool page with `pageHead()`: the title on the left, its actions on the right.
- **Do** group content on a sheet as Tile Gray cards with 24px corners and no border, and step nested pieces back to Sheet White with 16px corners.
- **Do** make the one primary action a Pill Black pill and everything else a Tile Gray pill; use `a[data-button]` when an action navigates.
- **Do** lead every row about a person with their 32px face.
- **Do** write plain semantic HTML and let the base layer style it; reach for `sx()` only for layout and the signature components.
- **Do** define every new color in both `light` and `dark` in `tokens.stylex.ts`.
- **Do** keep app type on the fixed rem steps and reserve `clamp()` steps for marketing.
- **Do** gate every hover style behind `media.hover`, and let reduced motion remove movement while keeping color and fade transitions.
- **Do** keep app motion to 150ms color shifts, the 0.97 press and the ease-out curve. Marketing may go further: a staggered blur-and-rise hero entrance, an example project that comes alive and can be played with (two to-dos tick themselves off and the Milestones bar slides with them, chat messages arrive with yours on the right, to-dos check off with a click, board cards drag between columns with a 3% lift, a -2° tilt and a shadow, then glide 320ms to their new place, or click one column on; a card let go outside the board glides home; touch scrolls the page, so there a tap moves the card; a keyboard move doesn't glide), the Milestones section's bar filling once it's on screen and following every check, scroll-linked reveals via `animation-timeline: view()` behind `@supports`, and the giant wordmark rising out of the page edge. Every element rests in its final state, so reduced motion and unsupported browsers see it all in place (reduced motion: the to-dos start ticked, the bar jumps, the cards don't glide).

### Don't:
- **Don't** use Kargul Orange for buttons, headings, backgrounds or decoration; it is for unread, today, done, progress and focus.
- **Don't** let a label color grow past its 9px dot.
- **Don't** add shadows to app surfaces; the only shadow is the marketing demo frame.
- **Don't** put borders around tiles, cards, sheets or slabs; borders are for hairline rules, ruled tables and form fields.
- **Don't** use square or slightly rounded buttons; controls are full pills.
- **Don't** introduce a second accent hue or a second typeface.
- **Don't** hardcode hex values in component styles; use the `color` tokens so themes swap.
