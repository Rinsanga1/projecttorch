---
target: each window content on the project page
total_score: 25
max_score: 40
na_heuristics: 
p0_count: 0
p1_count: 3
target_identity: "file:C:\\Users\\katto\\Documents\\software\\saintsflow\\src\\client\\areas\\project.tsx"
target_fingerprint: "sha256:0a1cc7436692a9b5428b8624a32a3134ac442ec65e297e31472f0755ae1fb57f"
target_path: "C:\\Users\\katto\\Documents\\software\\saintsflow\\src\\client\\areas\\project.tsx"
timestamp: 2026-10-22T10-19-56Z
slug: src-client-areas-project-tsx
---
# Critique: project window content (/projects/2, /projects/3)

Method: dual-agent (A: design review · B: detector + browser evidence)

## Design Health Score
| # | Heuristic | Score | Key Issue |
|---|---|---|---|
| 1 | Visibility of System Status | 2 | Task progress bars never fill; title bar summary stays the tool's at every depth |
| 2 | Match System / Real World | 3 | Bare "React" reads as a label; "Due" doubled in Calendar; folder color as text |
| 3 | User Control and Freedom | 3 | Back/close/Esc work; back is one step at a time |
| 4 | Consistency and Standards | 2 | Black primary spent on React/Move/hill toggle; move UI differs by tool |
| 5 | Error Prevention | 3 | Inert preview checkboxes look tickable; Trash beside Pause |
| 6 | Recognition Rather Than Recall | 2 | Tasks start shows no tasks; Links can't add a link |
| 7 | Flexibility and Efficiency | 2 | Select-then-Move, Apply-to-filter, chat composer scrolls away |
| 8 | Aesthetic and Minimalist Design | 2 | Comment/subscriber tail outweighs records; board cards half controls |
| 9 | Error Recovery | 3 | Undo works in windows; forms untested (read-only) |
| 10 | Help and Documentation | 3 | Good empty-state copy; "progress hill" never explained |
| **Total** | | **25/40** | **Acceptable** |

## Design Specificity Verdict
Frame (desk, windows, taskbar, summaries) is authored; window content is the old full pages dropped in, with no-JS fallback controls showing (select+Move, Sort/View/Apply, Category/Filter, native file input). Stack previews are the most authored content.
Detector: CLI exit 0, 1 advisory (1.625rem title, documented: false positive). Browser: nested-cards (windows on desk, by design: false positive), overused-font Geist (pinned brand: false positive), 10.5px tag chips (real), board edge-flush columns 1060 vs 774px (real, matches clipped Done column), 2 h1 per view.

## Priority Issues
- [P1] Task progress bars never fill: `todos.tsx:57` fillBox is an inline span, width ignored; add display:block. ($impeccable polish)
- [P1] No-JS fallback controls always visible (select+Move on tasks/cards, Apply/Filter in Files/Posts/Questions/Timesheet, native file input in Chat): auto-apply on change, hide buttons, collapse Move into a row ••• menu, board column select on focus. ($impeccable distill)
- [P1] Primary pill on the wrong actions (React, Move above card title, "Take this list off the progress hill", 6 board primaries): one primary per page = the real next step. ($impeccable layout)
- [P2] Tasks start page hides tasks (cards + big hill, no task names): list next 3–5 open tasks per list, late first; hill below or behind Progress. ($impeccable layout)
- [P2] Board: 4th column clipped with no cue, cards half controls, "Reorder your columns" with one column: fit/fade+scroll, controls on hover/focus, hide reorder when trivial. ($impeccable adapt)

## Per window
- Posts: clean rows; Category/Filter row for 2 posts; long comment/subscriber tail on the post.
- Tasks: start page wrong-weighted, broken bars, no tasks; select+Move per row on lists.
- Files: 7 controls before the first file; Move link per row; comments on folders.
- Chat: opens at newest; composer scrolls away; React per line; Send as text; notify settings always shown.
- Calendar: grid reads well but fills the window, Coming up ~1000px down; event spills across cells.
- Team questions: good answer feed; start page one half-width card; Edit/Pause/Trash level.
- Board: weakest: clipped column, control-heavy cards, 4 black Add a card.
- Timesheet: clean table; Add time last; 10.8 vs 10.75.
- Links: too bare; links don't look like links; no Add a link.

## Persona Red Flags
- Alex: select-then-Move, Apply filters, composer scrolls away, back one level, can't tick from Tasks start.
- Sam: post titles not headings; inert preview checkboxes; 10.5px tags; Links color-only; 2 extra tab stops per task row.
- Jordan: "progress hill" unexplained and boldest; React looks like a label; Done column unseen; no Add a link.

## Minor Observations
- [P2] Phone taskbar 479px in 374px, Timesheet/Links cut off, sits ~1700px down: stick to bottom with safe area, scroll with edge fade.
- Taskbar tip lingers over the master after a click.
- "2 days late" muted; it's the orange case.
- Posts empty state repeats "Write a post" under the button.
- Sample data: every chat line 1:45 AM.

## Questions to Consider
- Should window start pages be bigger previews with real controls rather than the old full pages?
- Does a record in a window need its comments/subscribers block, or a "Comments (2)" link?
- Should people with JavaScript ever see the no-JS fallback?
