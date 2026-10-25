// A project's windows. The big window is the one you're working in: its real pages, not a preview. To its left, a narrow
// rail holds every window as an icon, in project order, with its news count; its top button turns the icons into
// previews, and the big window makes room for them (nothing covers your work). The rail
// is the one way around on desktop; under 900px the dark taskbar at the bottom of the screen is, in thumb reach. Nothing
// to close: they're the project, not tabs. Dragging a rail icon reorders the windows; the big window's name renames it
// in place; + (on the rail, as the last preview, on the taskbar, on an empty desk) opens the one menu that adds, hides
// and shows windows. Which window is in front is the page's address (/projects/2/docs/5 is Files, at that doc), so the
// desk only asks to switch. Full screen lifts the desk over the whole page. Above the desk,
// one sentence says what's new ("Since Tuesday: 5 new in Chat and Posts."). Design and history: docs/project_ui_explore,
// docs/app_terms.
import * as stylex from "@stylexjs/stylex"
import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type FocusEvent, type KeyboardEvent, type MouseEvent as ReactMouseEvent, type PointerEvent, type ReactNode } from "react"
import { flushSync } from "react-dom"
import { flash } from "../store.ts"
import { fadeOverflow, sx } from "./kit.tsx"
import { Icon, type IconName } from "./icons.tsx"
import { color, light, media, motion, radius, space, text } from "./tokens.stylex.ts"

export type DeskWindow = {
  key: string
  name: string
  icon: IconName
  /** One line about what's new, for the title bar and the taskbar tip. */
  summary: string
  /** The preview the column shows. */
  body: ReactNode
  /** What the big window shows, to work in (the tool's pages); the preview when there's none. */
  work?: ReactNode
  /** The address of what the big window shows: each new one starts at its top. */
  place?: string
  /** Back a page inside the big window, when it has gone deeper than the tool's start. */
  back?: () => void
  /** Nothing in the window yet: its preview says so in one sentence (its summary). */
  empty?: boolean
  /** How many things others added since your last visit; shown until you open the window. */
  news?: number
  /** How many things in it are late (open tasks past their date). Shown, outlined, until they're dealt with. */
  late?: number
}

const DESKTOP = "@media (min-width: 900px)"
/** Where the page sheet takes its larger corners (ui/page.tsx). */
const SHEET = "@media (min-width: 768px)"
/** Strong ease-out: starts fast, so the interface answers at once. */
const EASE_OUT = "cubic-bezier(0.23, 1, 0.32, 1)"
/** The drawer curve: quick to answer, long soft landing. For the rail opening and the windows making room. */
const EASE_DRAWER = "cubic-bezier(0.32, 0.72, 0, 1)"
/** A rail icon and the 4px gap under it: how far one window moves when reordering. */
const SLOT = 44
/** The rail's width: room for an icon, a window's name and its count. (The icon list spans the wider previews, so buttons
 * take this, not 100%.) */
const RAIL = 160
const reduced = () => matchMedia("(prefers-reduced-motion: reduce)").matches
const s = stylex.create({
  // No corners of its own: it runs to the sheet's edges and the sheet clips it.
  // The bottom half of the page's card (the project head is the top): Tile Gray, with the sheet's bottom corners.
  card: { backgroundColor: color.tile, borderBottomLeftRadius: { default: radius.lg, [SHEET]: radius.xl }, borderBottomRightRadius: { default: radius.lg, [SHEET]: radius.xl } },
  // Full screen: the desk covers the whole page, the big window alone above the taskbar.
  wrapFull: { position: "fixed", inset: 0, zIndex: 50, display: "flex", flexDirection: "column", backgroundColor: color.tile },
  desk: {
    display: "grid", gap: 10, padding: 10,
    // The rail keeps 160px on the left: each window by icon and name, with its count; every other pixel goes to the big window.
    // Opening the previews widens the rail and the big window gives way, one smooth slide (closing is quicker).
    gridTemplateColumns: { default: "minmax(0, 1fr)", [DESKTOP]: `${RAIL}px minmax(0, 1fr)` },
    gridTemplateRows: { default: "auto", [DESKTOP]: "minmax(0, 1fr)" },
    transitionProperty: "grid-template-columns", transitionDuration: { default: "200ms", [media.reduce]: "0ms" }, transitionTimingFunction: EASE_DRAWER,
    // Fills the screen under the project head.
    height: { default: "auto", [DESKTOP]: "max(460px, calc(100dvh - 262px))" },
  },
  deskOpen: { gridTemplateColumns: { default: "minmax(0, 1fr)", [DESKTOP]: "300px minmax(0, 1fr)" }, transitionDuration: { default: "280ms", [media.reduce]: "0ms" } },
  deskFull: { flexGrow: 1, minHeight: 0, height: { default: "auto", [DESKTOP]: "auto" }, borderRadius: 0 },

  // A hairline outline keeps a window's edge against the desk (white on light gray alone disappears). It's a border,
  // not a shadow, so the view-transition picture carries it while windows glide.
  win: {
    // clip, not hidden: it rounds the corners without becoming a scroll box (so a sticky composer still sticks on a phone).
    display: "flex", flexDirection: "column", minWidth: 0, minHeight: 0, backgroundColor: color.sheet, borderRadius: radius.md, overflow: "clip",
    borderWidth: 1.5, borderStyle: "solid", borderColor: color.line,
  },
  master: { borderWidth: 2, minHeight: { default: 320, [DESKTOP]: 0 } },
  // With the previews open, the big window carries the focus ring: it says which one is where you are. Alone, it needs none.
  masterFocus: { borderColor: color.accent },

  head: { display: "flex", alignItems: "center", gap: space.s2, minHeight: 40, paddingBlock: 4, paddingInline: "12px 6px", borderBottomWidth: 1, borderBottomStyle: "solid", borderBottomColor: color.line, flexShrink: 0 },
  // The back button is wider than the icon it replaces; it tucks into the padding so the name stays put.
  headBack: { paddingLeft: 6 },
  backBtn: { marginRight: -6 },
  name: { fontSize: "0.875rem", fontWeight: 650, letterSpacing: "-0.015em", whiteSpace: "nowrap" },
  summary: { minWidth: 0, fontSize: text.xs, color: color.muted, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" },
  actions: { display: "flex", alignItems: "center", gap: 2, marginLeft: "auto", flexShrink: 0 },
  iconBtn: {
    width: 28, minHeight: 28, padding: 0, borderRadius: radius.sm, background: "none", color: color.muted,
    backgroundColor: { default: "transparent", ":hover": { default: null, [media.hover]: color.tile } },
  },
  // On desktop the window scrolls inside itself; on a phone the window is the page, so the page does the scrolling.
  body: { flexGrow: 1, overflow: { default: "visible", [DESKTOP]: "auto" }, overscrollBehavior: "contain", paddingBlock: 12, paddingInline: 14 },
  // In full screen the window fills the screen at every size, so it scrolls inside.
  bodyFull: { overflow: "auto" },
  peek: { overflow: "hidden", fontSize: text.sm, maskImage: "linear-gradient(#000 55%, transparent)", pointerEvents: "none" },
  // A window with nothing in it yet: a quiet skeleton of lines in its preview, so it's the same size as the rest. Still,
  // not shimmering: nothing is loading, there's just nothing there yet.
  skeleton: { display: "grid", alignContent: "start", gap: 10, paddingTop: 4 },
  bone: { display: "block", height: 8, borderRadius: radius.pill, backgroundColor: color.tile },

  // What's new, in one sentence under the project head: the head's white, the head's padding.
  row: { paddingInline: { default: 20, [DESKTOP]: 28 }, paddingBottom: 16, margin: 0, maxWidth: "none", backgroundColor: color.sheet, fontSize: text.sm },
  rowFull: { paddingTop: 10, paddingInline: 10, paddingBottom: 6, backgroundColor: color.tile },
  lead: { fontWeight: 650 },
  calm: { color: color.muted },
  lateLine: { color: color.accentText, fontWeight: 650 },

  // The rail: every window as an icon, on the desk beside the big one. The open one is Pill Black; news is Peach Wash with
  // a count; late work is outlined in orange.
  // It clips what doesn't fit yet, so the previews are uncovered as it widens. It reaches 4px above the big window so the
  // first icon's count isn't clipped.
  rail: { display: { default: "none", [DESKTOP]: "flex" }, flexDirection: "column", minHeight: 0, overflow: "clip", marginTop: -4, paddingTop: 4 },
  // One list, two looks: the icons and the previews share a spot, so a window keeps its place either way. Opening, each
  // icon flies to its preview's title bar (and back when closing); see `fly` below.
  stack: { display: "grid", flexGrow: 1, minHeight: 0 },
  // More windows than fit scroll (no scrollbar: the cut-off icon at the edge says there's more). It spans the stack, not
  // just the 44px column, so the icons' flights to their previews aren't clipped any tighter than the rail itself clips.
  icons: {
    gridArea: "1 / 1", display: "flex", flexDirection: "column", alignItems: "flex-start", gap: 4, minHeight: 0, paddingTop: 4,
    overflowX: "hidden", overflowY: "auto", overscrollBehavior: "contain", scrollbarWidth: "none",
  },
  // While the icons fly they sit above the previews, so the cards fading in don't cover them.
  iconsFlying: { position: "relative", zIndex: 1, pointerEvents: "none" },
  iconsHidden: { opacity: 0 },
  // The icon itself: the part that flies.
  glyph: { display: "inline-flex" },
  // A preview's own icon waits, hidden, until the flying one lands on it.
  glyphWaiting: { visibility: "hidden" },
  railToggle: { width: 40, justifyContent: "center", paddingInline: 0, color: color.muted, marginBottom: 2, flexShrink: 0 },
  railToggleOn: { color: color.ink, backgroundColor: { default: color.tileHover, ":hover": { default: null, [media.hover]: color.tileHover } } },
  railBtn: {
    position: "relative", display: "flex", alignItems: "center", justifyContent: "flex-start", gap: 10, width: RAIL, minHeight: 40, paddingBlock: 0, paddingInline: "11px 8px", borderRadius: 12, color: color.ink,
    backgroundColor: { default: "transparent", ":hover": { default: null, [media.hover]: color.tileHover } },
    transitionProperty: "background-color, color, box-shadow, opacity, transform", transitionDuration: "160ms", transitionTimingFunction: EASE_OUT,
  },
  // With the previews open, a button is only its icon (in flight): its fill, outline and count fade away.
  railBare: { color: color.ink, boxShadow: "none", backgroundColor: { default: "transparent", ":hover": { default: null, [media.hover]: "transparent" } } },
  badgeGone: { opacity: 0 },
  railNews: { backgroundColor: { default: color.accentSoft, ":hover": { default: null, [media.hover]: color.accentSoft } } },
  railLate: { color: color.accentText, boxShadow: `inset 0 0 0 1.5px color-mix(in srgb, ${color.accent} 55%, transparent)` },
  railCur: { color: color.onPrimary, boxShadow: "none", backgroundColor: { default: color.primary, ":hover": { default: null, [media.hover]: color.primaryHover } } },
  railPlus: { color: color.muted, marginTop: 4 },
  // The window's name beside its icon: plain words, so nobody has to learn what a glyph means. It fades while the icons fly.
  railName: {
    minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontSize: text.sm, fontWeight: 600, letterSpacing: "-0.01em", textAlign: "left",
    transitionProperty: "opacity", transitionDuration: "120ms", transitionTimingFunction: EASE_OUT,
  },
  railPlusName: { fontWeight: 500 },
  num: {
    display: "inline-flex", alignItems: "center", justifyContent: "center", minWidth: 18, height: 18, paddingInline: 5, borderRadius: radius.pill,
    backgroundColor: color.accent, color: color.onAccent, fontSize: 11, fontWeight: 700, fontVariantNumeric: "tabular-nums",
  },
  // On the rail the count sits at the end of the row, after the name.
  badge: { marginLeft: "auto", flexShrink: 0, transitionProperty: "opacity", transitionDuration: "120ms" },
  // The previews, in the icons' place and order: each window's title bar, then the start of its body. They fade in as the
  // rail opens (a beat behind it, so the icons lead) and leave faster than they came. They never move: their width is
  // fixed, so the opening slide uncovers them rather than squeezing them, and the icons know where to land.
  pane: {
    gridArea: "1 / 1", display: "flex", flexDirection: "column", gap: 8, width: 300, minHeight: 0, overflowY: "auto", overscrollBehavior: "contain", scrollbarWidth: "thin",
    opacity: 0, transitionProperty: "opacity", transitionDuration: "120ms", transitionTimingFunction: EASE_OUT,
  },
  paneOpen: { opacity: 1, transitionDuration: "220ms", transitionDelay: "60ms" },
  colWin: {
    flexShrink: 0, height: 168, cursor: "pointer", transitionProperty: "border-color", transitionDuration: motion.fast,
    borderColor: { default: color.line, ":hover": { default: null, [media.hover]: color.control } },
  },
  // The whole title bar is the button that brings a window forward.
  colBring: {
    display: "flex", alignItems: "center", justifyContent: "flex-start", gap: space.s2, width: "100%", minHeight: 40, paddingBlock: 4, paddingInline: 12, borderRadius: 0, background: "none",
    color: "inherit", textAlign: "left", fontWeight: "inherit", borderBottomWidth: 1, borderBottomStyle: "solid", borderBottomColor: color.line,
    transform: { default: null, ":active": "none" }, backgroundColor: { default: "transparent", ":hover": { default: null, [media.hover]: "transparent" } },
  },
  // The last preview: a blank, dashed window that adds one. It fills in white on hover, the window it would become.
  miniAdd: {
    flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center", gap: space.s2, width: "100%", minHeight: 56,
    borderRadius: radius.md, borderWidth: 1.5, borderStyle: "dashed", fontSize: text.sm, fontWeight: 600,
    borderColor: { default: color.control, ":hover": { default: null, [media.hover]: color.ink } },
    color: { default: color.muted, ":hover": { default: null, [media.hover]: color.ink } },
    backgroundColor: { default: "transparent", ":hover": { default: null, [media.hover]: color.sheet } },
    transitionProperty: "border-color, color, background-color, transform", transitionDuration: "150ms", transitionTimingFunction: "ease",
  },
  // The + menu: a white card that floats over the desk (in the top layer, so nothing clips it). The + that opened it
  // places it; its open and close are in app.css.
  menu: {
    position: "fixed", inset: "auto", margin: 0, padding: 6, width: 300, overflowY: "auto", overscrollBehavior: "contain",
    borderWidth: 1, borderStyle: "solid", borderColor: color.line, borderRadius: 14, backgroundColor: color.sheet, color: color.ink,
    boxShadow: "0 16px 40px rgba(0, 0, 0, 0.14), 0 2px 8px rgba(0, 0, 0, 0.06)",
  },
  // The big window's name, which renames it: a quiet button, then a field in the same spot.
  nameBtn: {
    minHeight: 28, paddingBlock: 0, paddingInline: 6, marginInline: -6, borderRadius: radius.sm, color: color.ink, cursor: "text", transform: "none",
    backgroundColor: { default: "transparent", ":hover": { default: null, [media.hover]: color.tile } },
  },
  nameInput: { width: "auto", height: 28, minHeight: 28, paddingBlock: 0, paddingInline: 6, marginInline: -6, borderRadius: radius.sm, fontSize: "0.875rem", fontWeight: 650, letterSpacing: "-0.015em" },
  // A window with news says so in its preview's title bar, in place of its summary.
  newTag: {
    display: "inline-flex", alignItems: "center", height: 18, paddingInline: 7, borderRadius: radius.pill, flexShrink: 0,
    backgroundColor: color.accent, color: color.onAccent, fontSize: 11, fontWeight: 700, whiteSpace: "nowrap",
  },
  // On the phone taskbar, news is a dot.
  dot: { position: "absolute", top: 5, right: 5, width: 7, height: 7, borderRadius: radius.pill, backgroundColor: color.accent, boxShadow: `0 0 0 2px ${color.slab}` },

  empty: { gridColumn: "1 / -1", display: "grid", placeContent: "center", gap: 4, minHeight: 280, borderRadius: radius.lg, backgroundColor: color.sheet, textAlign: "center", color: color.muted },
  emptyTitle: { margin: 0, fontSize: text.md, fontWeight: 650, color: color.ink },

  // The taskbar, in its own strip under the card, on the page ground (in full screen, under the big window).
  // On a phone the bar stays at the bottom of the screen, in thumb reach, while the windows scroll past.
  strip: {
    // On desktop the rail does this job.
    display: { default: "flex", [DESKTOP]: "none" }, justifyContent: "center", paddingTop: 12, zIndex: 5,
    position: { default: "sticky", [DESKTOP]: "static" }, bottom: 0, paddingBottom: { default: "max(8px, env(safe-area-inset-bottom))", [DESKTOP]: 0 },
  },
  stripFull: { paddingTop: 0, paddingInline: 10, paddingBottom: 10 },
  bar: {
    display: "flex", gap: 4, padding: 5, borderRadius: 18, backgroundColor: color.slab, color: color.slabInk,
    width: { default: "100%", [DESKTOP]: "auto" }, justifyContent: { default: "space-between", [DESKTOP]: "flex-start" },
    overflowX: { default: "auto", [DESKTOP]: "visible" }, scrollbarWidth: "none",
  },
  // A tool keeps its size; only its name reveals. Hover color is instant-ish (frequent), the press scale comes from base.
  tool: {
    position: "relative", display: "inline-flex", alignItems: "center", flexShrink: 0, minHeight: 38, paddingBlock: 0, paddingInline: 10,
    borderRadius: 13, color: color.slabMuted, fontSize: text.sm, fontWeight: 600,
    transitionProperty: "background-color, color, transform", transitionDuration: "150ms", transitionTimingFunction: "ease",
    backgroundColor: { default: "transparent", ":hover": { default: null, [media.hover]: color.slabTile } },
  },
  toolOpen: { color: light.ink, backgroundColor: { default: color.slabInk, ":hover": { default: null, [media.hover]: color.slabInk } } },
  // The name, clipped to nothing until the bar opens. Its gap from the icon lives inside, so it reveals with it.
  label: {
    maxWidth: 0, opacity: 0, overflow: "hidden", whiteSpace: "nowrap",
    // Reduced motion: the name fades in place instead of sliding the bar open.
    transitionProperty: { default: "max-width, opacity", [media.reduce]: "opacity" }, transitionDuration: "200ms", transitionTimingFunction: EASE_OUT,
  },
  labelShown: { maxWidth: 160, opacity: 1 },
  labelText: { display: "inline-block", paddingInline: "8px 2px" },
  still: { transitionDuration: "0ms" },
  // The hovered tool's details, stacked in a tip above it, so the bar never shifts under the pointer.
  // It grows from its bottom edge (the tool's side); after the first one, the rest appear instantly.
  tip: {
    // Tips need a mouse; on a phone they'd only add phantom scroll room to the bar.
    position: "absolute", left: "50%", bottom: "calc(100% + 10px)", display: { default: "none", [DESKTOP]: "grid" }, gap: 1, minWidth: 140, maxWidth: 240, paddingBlock: 8, paddingInline: 11,
    borderRadius: 10, backgroundColor: color.slab, color: color.slabMuted, fontSize: text.xs, fontWeight: 500, lineHeight: 1.35, textAlign: "left",
    whiteSpace: "normal", pointerEvents: "none", transformOrigin: "bottom center",
    opacity: 0, transform: { default: "translateX(-50%) scale(0.97)", [media.reduce]: "translateX(-50%)" },
    transitionProperty: "opacity, transform", transitionDuration: "150ms", transitionTimingFunction: EASE_OUT,
  },
  tipShown: { opacity: 1, transform: "translateX(-50%) scale(1)" },
  tipFirst: { color: color.slabInk, fontWeight: 600 },
})

/** The + menu is one popover for the whole desk, whichever + opened it. */
const MENU_ID = "windows-menu"
export const closeWindowsMenu = () => document.getElementById(MENU_ID)?.hidePopover()

/** "Chat, Posts and Tasks" */
const and = (xs: ReadonlyArray<string>) => xs.length < 2 ? xs.join("") : `${xs.slice(0, -1).join(", ")} and ${xs.at(-1)}`

export const Desk = ({ windows, master, onBring, since, note, menu, onRename, onReorder, project }: {
  windows: ReadonlyArray<DeskWindow>
  /** The window in front (from the address). */
  master: string
  /** Bring a window forward: the page moves to it (back to where you last were in it). */
  onBring: (key: string, e?: MouseEvent) => void
  /** "Since Tuesday": when you last opened the project. Without it (a first visit), the row names the windows only. */
  since?: string
  /** Said in place of the news, when there's something better to say (a brand-new project). */
  note?: string
  /** What + opens: adding, hiding and showing windows. None for people who can't change them. */
  menu?: ReactNode
  /** Rename a window from its title bar. None for people who can't. */
  onRename?: (key: string, name: string) => void
  /** Put the windows in this order (every window's key). None for people who can't. */
  onReorder?: (keys: string[]) => void
  /** The project's name: full screen leads with it, since the page's head (and its title) is out of sight. */
  project?: string
}) => {
  const m = windows.find((w) => w.key === master)
  const [fullOn, setFull] = useState(false)
  const full = fullOn && !!m
  // Opening a window is reading it: its news count goes for the rest of this visit.
  const [read, setRead] = useState<ReadonlySet<string>>(() => new Set([master]))
  useEffect(() => setRead((r) => (r.has(master) ? r : new Set(r).add(master))), [master])
  const newsOf = (w: DeskWindow) => (read.has(w.key) ? 0 : w.news ?? 0)
  const withNews = windows.filter((w) => newsOf(w) > 0)
  const newsTotal = withNews.reduce((n, w) => n + newsOf(w), 0)
  const late = windows.filter((w) => (w.late ?? 0) > 0)

  // Full screen: the page under it holds still, and Escape comes back out (unless something inside used the key).
  useEffect(() => {
    if (!full) return
    const root = document.documentElement
    root.style.overflow = "hidden"
    const onKey = (e: globalThis.KeyboardEvent) => { if (e.key === "Escape" && !e.defaultPrevented) setFull(false) }
    document.addEventListener("keydown", onKey)
    return () => { root.style.overflow = ""; document.removeEventListener("keydown", onKey) }
  }, [full])

  // Full screen stays on while you switch windows. Going in and out glides (a view transition) when it's by pointer;
  // by keyboard it's instant: an action repeated by key should never wait on an animation.
  // The window you're leaving: its spot among the previews is where it glides to.
  const leaving = useRef<string | null>(null)
  const bring = (k: string, e?: MouseEvent) => { leaving.current = master; onBring(k, e) }
  const toggleFull = (e: MouseEvent) => {
    const glide = e.detail > 0 && !matchMedia("(prefers-reduced-motion: reduce)").matches && document.startViewTransition
    if (glide) document.startViewTransition(() => flushSync(() => setFull(!full)))
    else setFull(!full)
  }

  // The taskbar opens (names, and a tip for the hovered tool) while a mouse is over it or a keyboard is in it.
  // From the keyboard it opens instantly. The first tip fades in; moving along the bar, the next ones are instant.
  const [wide, setWide] = useState<false | "mouse" | "keyboard">(false)
  const [tipFor, setTipFor] = useState<string | null>(null)
  const [warm, setWarm] = useState(false)
  const showTip = (k: string) => { if (tipFor && tipFor !== k) setWarm(true); setTipFor(k) }
  const enterBar = (e: PointerEvent) => { if (e.pointerType === "mouse" || e.pointerType === "pen") setWide("mouse") }
  const leaveBar = () => { setWide(false); setTipFor(null); setWarm(false) }
  const focusIn = (e: FocusEvent<HTMLElement>, k: string) => { if (e.target.matches(":focus-visible")) { setWide("keyboard"); showTip(k) } }
  const focusOut = (e: FocusEvent<HTMLElement>) => { if (!e.currentTarget.contains(e.relatedTarget as Node | null)) leaveBar() }

  // The previews open from the rail's top button and stay how you left them (in this browser). A deliberate click, not a
  // hover: the big window makes room for them, and work shouldn't shift because the pointer passed the edge.
  const [col, setCol] = useState(() => { try { return localStorage.getItem("saintsflow:previews") === "1" } catch { return false } })
  // Opening, each icon flies from the rail to its preview's title bar, shrinking from 18px to 16px, on the same curve and
  // time as the rail; closing, it flies back. That's what tells you which preview is which. The previews' own icons wait
  // hidden until the flight lands, then take over (an opening flight holds its landing, so nothing flickers back).
  // Toggling mid-flight turns the icons around from where they are.
  const [flying, setFlying] = useState(false)
  const railGlyph = useRef(new Map<string, HTMLElement>())
  const paneGlyph = useRef(new Map<string, HTMLElement>())
  const flights = useRef<Animation[]>([])
  const fly = (opening: boolean) => {
    flights.current.forEach((a) => a.pause())
    const from = new Map([...railGlyph.current].map(([k, el]) => [k, getComputedStyle(el).transform]))
    flights.current.forEach((a) => a.cancel())
    if (matchMedia("(prefers-reduced-motion: reduce)").matches) { flights.current = []; return }
    flights.current = [...railGlyph.current].flatMap(([k, a]) => {
      const b = paneGlyph.current.get(k)
      if (!b) return []
      const ra = a.getBoundingClientRect(), rb = b.getBoundingClientRect()
      const landed = `translate(${rb.left - ra.left}px, ${rb.top - ra.top}px) scale(${rb.width / ra.width})`
      const now = from.get(k) && from.get(k) !== "none" ? from.get(k)! : opening ? "none" : landed
      return [a.animate([{ transform: now }, { transform: opening ? landed : "none" }], { duration: opening ? 280 : 200, easing: EASE_DRAWER, fill: opening ? "forwards" : "none" })]
    })
    setFlying(true)
    const these = flights.current
    Promise.all(these.map((a) => a.finished)).then(() => { if (flights.current === these) setFlying(false) }, () => {})
  }
  const toggleCol = () => {
    fly(!col)
    setCol(!col)
    try { localStorage.setItem("saintsflow:previews", col ? "0" : "1") } catch {}
  }
  // The preview under the pointer: with the one you're leaving, it's what glides when you swap.
  const [hot, setHot] = useState<string | null>(null)

  // The + menu opens beside the + you pressed, or under it when there's no room beside, and grows from that corner.
  const menuEl = useRef<HTMLDivElement>(null)
  const opener = useRef<HTMLElement | null>(null)
  const opening = (e: ReactMouseEvent<HTMLElement>) => { opener.current = e.currentTarget }
  useEffect(() => {
    const el = menuEl.current
    if (!el) return
    const place = (e: Event) => {
      const at = opener.current?.getBoundingClientRect()
      if ((e as ToggleEvent).newState !== "open" || !at) return
      const edge = 16, gap = 8, width = Math.min(300, innerWidth - 2 * edge)
      const beside = at.right + gap + width <= innerWidth - edge
      const left = beside ? at.right + gap : Math.min(Math.max(edge, at.left), innerWidth - edge - width)
      const x = beside ? "0px" : `${at.left + at.width / 2 - left}px`
      const top = beside ? at.top : at.bottom + gap
      const bottom = beside ? at.bottom : at.top - gap
      // Down from the + or up from it, whichever has more room (a + low on the rail, the phone's taskbar).
      Object.assign(el.style, innerHeight - top - edge >= bottom - edge
        ? { width: `${width}px`, left: `${left}px`, top: `${top}px`, bottom: "auto", maxHeight: `${innerHeight - top - edge}px`, transformOrigin: `${x} 0` }
        : { width: `${width}px`, left: `${left}px`, top: "auto", bottom: `${innerHeight - bottom}px`, maxHeight: `${bottom - edge}px`, transformOrigin: `${x} 100%` })
    }
    el.addEventListener("beforetoggle", place)
    return () => el.removeEventListener("beforetoggle", place)
  }, [!!menu])
  const plus = { type: "button", popoverTarget: MENU_ID, onClick: opening } as const

  // Reordering: drag a rail icon up or down (a press that doesn't move is still a click), or Alt+↑/↓ on it. The icon
  // lifts and follows the pointer; the ones it passes slide a slot out of its way; let go, it settles into its slot.
  // From the keyboard it moves at once: a repeated action shouldn't wait on an animation.
  const order = windows.map((w) => w.key)
  const [drag, setDrag] = useState<{ key: string; from: number; dy: number } | null>(null)
  const press = useRef<{ from: number; y: number; id: number } | null>(null)
  const dragged = useRef(false)
  const railBtn = useRef(new Map<string, HTMLElement>())
  const landing = useRef<{ key: string; dy: number } | null>(null)
  const over = drag ? Math.max(0, Math.min(order.length - 1, drag.from + Math.round(drag.dy / SLOT))) : -1
  const moveTo = (from: number, to: number) => {
    const next = [...order]
    next.splice(to, 0, ...next.splice(from, 1))
    onReorder?.(next)
  }
  const reorderable = (key: string, i: number) => !onReorder || col ? {} : {
    "aria-keyshortcuts": "Alt+ArrowUp Alt+ArrowDown",
    onPointerDown: (e: PointerEvent<HTMLElement>) => { dragged.current = false; if (e.button === 0) press.current = { from: i, y: e.clientY, id: e.pointerId } },
    onPointerMove: (e: PointerEvent<HTMLElement>) => {
      const p = press.current
      if (!p || p.id !== e.pointerId || (!drag && Math.abs(e.clientY - p.y) < 4)) return
      if (!drag) { dragged.current = true; e.currentTarget.setPointerCapture(e.pointerId) }
      setDrag({ key, from: p.from, dy: Math.max(-p.from * SLOT, Math.min((order.length - 1 - p.from) * SLOT, e.clientY - p.y)) })
    },
    onPointerUp: () => {
      press.current = null
      if (!drag) return
      landing.current = { key, dy: drag.dy - (over - drag.from) * SLOT }
      setDrag(null)
      if (over !== drag.from) moveTo(drag.from, over)
    },
    onPointerCancel: () => { press.current = null; setDrag(null) },
    onKeyDown: (e: KeyboardEvent<HTMLElement>) => {
      if (!e.altKey || (e.key !== "ArrowUp" && e.key !== "ArrowDown")) return
      e.preventDefault()
      const to = i + (e.key === "ArrowUp" ? -1 : 1)
      if (to >= 0 && to < order.length) moveTo(i, to)
    },
  }
  /** Where an icon sits while another is dragged: lifted under the pointer, a slot out of the way, or still. */
  const dragStyle = (key: string, i: number): CSSProperties | undefined => {
    if (!drag) return undefined
    if (key === drag.key) return { transform: `translateY(${drag.dy}px) scale(1.06)`, zIndex: 2, cursor: "grabbing", boxShadow: "0 6px 16px rgba(0, 0, 0, 0.18)" }
    const shift = drag.from < over && i > drag.from && i <= over ? -SLOT : drag.from > over && i >= over && i < drag.from ? SLOT : 0
    return { transform: `translateY(${shift}px)`, transition: reduced() ? "none" : `transform 150ms ${EASE_OUT}` }
  }
  // Escape puts a dragged icon back where it was (and the release that follows isn't a click).
  useEffect(() => {
    if (!drag) return
    const onKey = (e: globalThis.KeyboardEvent) => { if (e.key === "Escape") { e.preventDefault(); press.current = null; setDrag(null) } }
    document.addEventListener("keydown", onKey)
    return () => document.removeEventListener("keydown", onKey)
  }, [!!drag])
  // The window in front stays in sight on a rail that scrolls (without scrolling the page).
  const iconsBox = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const el = railBtn.current.get(master), box = iconsBox.current
    if (!el || !box) return
    const r = el.getBoundingClientRect(), b = box.getBoundingClientRect()
    if (r.top < b.top + 4) box.scrollTop -= b.top + 4 - r.top
    else if (r.bottom > b.bottom) box.scrollTop += r.bottom - b.bottom
  }, [master])

  // Let go: the icon glides the last bit into its slot (the list has already moved it there).
  useLayoutEffect(() => {
    const l = landing.current
    landing.current = null
    if (l && l.dy && !reduced()) railBtn.current.get(l.key)?.animate([{ transform: `translateY(${l.dy}px) scale(1.06)` }, { transform: "none" }], { duration: 150, easing: EASE_OUT })
  }, [drag])

  const vt = (k: string) => ({ viewTransitionName: `desk-${k}` })
  // On a swap, the previews from the one you picked to the one you're leaving all change places.
  const at = (k: string | null) => order.indexOf(k ?? "")
  const between = (i: number) => {
    // Before the swap that's the one in front; after it, the one you left.
    const a = at(hot), b = at(hot === master ? leaving.current : master)
    return a >= 0 && b >= 0 && i >= Math.min(a, b) && i <= Math.max(a, b)
  }
  const say = (w: DeskWindow) => [w.name, newsOf(w) > 0 && `${newsOf(w)} new`, (w.late ?? 0) > 0 && `${w.late} late`].filter(Boolean).join(", ")

  const lateLine = late.length > 0 && <span {...sx(s.lateLine)}> {late.map((w) => `${w.late} late in ${w.name}`).join(", ")}.</span>
  const news = note ? <span {...sx(s.calm)}>{note}</span>
    : since ? <>{withNews.length ? <><span {...sx(s.lead)}>{since}:</span> {newsTotal} new in {and(withNews.map((w) => w.name))}.</> : <span {...sx(s.calm)}>{late.length ? "Nothing new." : "All caught up."}</span>}{lateLine}</>
    : lateLine

  return (
    <section aria-label="Windows" {...sx(full && s.wrapFull)}>
      {full
        ? <p {...sx(s.row, s.rowFull)}><span {...sx(s.lead)}>{project}</span>{news && <span {...sx(s.calm)}> · </span>}{news}</p>
        : news && <p {...sx(s.row)}>{news}</p>}
      <div {...sx(s.desk, s.card, m && col && s.deskOpen, full && s.deskFull)}>
        {m && (
          <nav aria-label="Every window in this project" onPointerLeave={() => setHot(null)} {...sx(s.rail)}>
            <button type="button" onClick={toggleCol} aria-expanded={col} aria-label={col ? "Hide previews" : "Show previews"} title={col ? "Hide previews" : "Show previews"}
              {...sx(s.railBtn, s.railToggle, col && s.railToggleOn)}><Icon name="panel" size={18} /></button>
            <div {...sx(s.stack)}>
              <div inert={col} ref={iconsBox} {...sx(s.icons, flying && s.iconsFlying, col && !flying && s.iconsHidden)}>
                {windows.map((w, i) => {
                  const cur = w.key === master, n = newsOf(w), lateHere = (w.late ?? 0) > 0 && !cur
                  return (
                    <button key={w.key} type="button" aria-current={cur || undefined} aria-label={say(w)}
                      ref={(el) => { if (el) railBtn.current.set(w.key, el); else railBtn.current.delete(w.key) }}
                      onClick={(e) => { if (dragged.current) dragged.current = false; else bring(w.key, e.nativeEvent) }}
                      {...reorderable(w.key, i)} style={dragStyle(w.key, i)}
                      {...sx(s.railBtn, n > 0 && s.railNews, lateHere && s.railLate, cur && s.railCur, col && s.railBare, col && cur && s.badgeGone)}>
                      <span ref={(el) => { if (el) railGlyph.current.set(w.key, el); else railGlyph.current.delete(w.key) }} {...sx(s.glyph)}><Icon name={w.icon} size={18} /></span>
                      <span aria-hidden="true" {...sx(s.railName, col && s.badgeGone)}>{w.name}</span>
                      {n > 0 && !cur && <span aria-hidden="true" {...sx(s.num, s.badge, col && s.badgeGone)}>{n}</span>}
                    </button>
                  )
                })}
                {menu && <button {...plus} {...sx(s.railBtn, s.railPlus, col && s.badgeGone)}><Icon name="plus" size={16} /><span {...sx(s.railName, s.railPlusName)}>Add a window</span></button>}
              </div>
              <div inert={!col} {...sx(s.pane, col && s.paneOpen)}>
                {/* The window in front is already open beside them: it has no preview. */}
                {windows.map((w, i) => w.key !== master && (
                  <section key={w.key}
                    // The two windows trading places glide, and the previews between them slide a slot; the rest hold
                    // still (and stay clipped).
                    style={col && between(i) ? vt(w.key) : undefined}
                    onClick={(e) => bring(w.key, e.nativeEvent)} onPointerEnter={() => setHot(w.key)}
                    {...sx(s.win, s.colWin)}>
                    <button type="button" aria-label={say(w)} onClick={(e) => { e.stopPropagation(); bring(w.key, e.nativeEvent) }} {...sx(s.colBring)}>
                      <span ref={(el) => { if (el) paneGlyph.current.set(w.key, el); else paneGlyph.current.delete(w.key) }} {...sx(s.glyph, flying && s.glyphWaiting)}><Icon name={w.icon} size={16} /></span><b {...sx(s.name)}>{w.name}</b>
                      {newsOf(w) > 0 ? <span {...sx(s.newTag)}>{newsOf(w)} new</span> : <span {...sx(s.summary)}>{w.summary}</span>}
                    </button>
                    {w.empty
                      ? <div aria-hidden="true" {...sx(s.body, s.peek, s.skeleton)}>{["72%", "90%", "56%", "84%", "64%"].map((wd) => <span key={wd} style={{ width: wd }} {...sx(s.bone)} />)}</div>
                      : <div inert {...sx(s.body, s.peek)}>{w.body}</div>}
                  </section>
                ))}
                {menu && <button {...plus} data-quiet {...sx(s.miniAdd)}><Icon name="plus" size={16} />Add a window</button>}
              </div>
            </div>
          </nav>
        )}
        {m ? (
          <section key={m.key} aria-label={m.name} style={vt(m.key)} {...sx(s.win, s.master, col && s.masterFocus)}>
            <WindowHead w={m} onRename={onRename}>
              <button type="button" onClick={(e) => toggleFull(e.nativeEvent)} aria-pressed={full} aria-label={full ? "Leave full screen" : "Full screen"} title={full ? "Leave full screen (Esc)" : "Full screen"} {...sx(s.iconBtn)}><Icon name={full ? "shrink" : "full"} size={16} /></button>
            </WindowHead>
            <div key={m.place} data-window-body {...sx(s.body, full && s.bodyFull)}>{m.work ?? m.body}</div>
          </section>
        ) : (
          <div {...sx(s.empty)}><p {...sx(s.emptyTitle)}>No windows yet</p>{menu ? <p><button {...plus}>Add a window</button></p> : <p>There's nothing here yet.</p>}</div>
        )}
      </div>
      <div {...sx(s.strip, full && s.stripFull)}>
        <nav aria-label="Every window in this project" onPointerEnter={enterBar} onPointerLeave={leaveBar} onBlur={focusOut} ref={fadeOverflow} {...sx(s.bar)}>
          {windows.map((w) => {
            const isOpen = w.key === master
            return (
              <button key={w.key} type="button" aria-current={isOpen || undefined} aria-label={[w.name, newsOf(w) > 0 && `${newsOf(w)} new`, (w.late ?? 0) > 0 && `${w.late} late`].filter(Boolean).join(", ")}
                onClick={(e) => { bring(w.key, e.nativeEvent); setTipFor(null) }} onPointerEnter={() => showTip(w.key)} onFocus={(e) => focusIn(e, w.key)}
                {...sx(s.tool, isOpen && s.toolOpen)}>
                <Icon name={w.icon} size={18} />
                {(newsOf(w) > 0 || (w.late ?? 0) > 0) && w.key !== master && <span aria-hidden="true" {...sx(s.dot)} />}
                <span aria-hidden="true" {...sx(s.label, wide && s.labelShown, wide === "keyboard" && s.still)}><span {...sx(s.labelText)}>{w.name}</span></span>
                <span aria-hidden="true" {...sx(s.tip, wide && tipFor === w.key && s.tipShown, (warm || wide === "keyboard") && s.still)}>
                  {w.summary.split(" · ").map((line, i) => <span key={i} {...sx(i === 0 && s.tipFirst)}>{line}</span>)}
                </span>
              </button>
            )
          })}
          {menu && <button {...plus} aria-label="Add a window" {...sx(s.tool)}><Icon name="plus" size={18} /></button>}
        </nav>
      </div>
      {menu && <div id={MENU_ID} popover="auto" ref={menuEl} data-windows-menu role="dialog" aria-label="Windows" {...sx(s.menu)}>{menu}</div>}
    </section>
  )
}

// Deeper than the tool's start page, the icon gives way to a back button, in the same spot.
const WindowHead = ({ w, onRename, children }: { w: DeskWindow; onRename?: (key: string, name: string) => void; children: ReactNode }) => (
  <div {...sx(s.head, w.back && s.headBack)}>
    {w.back
      ? <button type="button" onClick={w.back} aria-label={`Back in ${w.name}`} title="Back" {...sx(s.iconBtn, s.backBtn)}><Icon name="back" size={16} /></button>
      : <Icon name={w.icon} size={16} />}
    <WindowName w={w} onRename={onRename} />
    <span {...sx(s.summary)}>{w.summary}</span>
    <span {...sx(s.actions)}>{children}</span>
  </div>
)

/** The big window's name. With `onRename`, clicking it turns it into a field: Enter or clicking away saves, Escape
 * cancels (and doesn't leave full screen). No animation: it's a field where the name was. */
const WindowName = ({ w, onRename }: { w: DeskWindow; onRename?: (key: string, name: string) => void }) => {
  const [draft, setDraft] = useState<string | null>(null)
  const closing = useRef(false)
  if (!onRename) return <b {...sx(s.name)}>{w.name}</b>
  if (draft === null)
    return <button type="button" onClick={() => { closing.current = false; setDraft(w.name) }} title="Rename" aria-label={`${w.name} (rename)`} {...sx(s.name, s.nameBtn)}>{w.name}</button>
  const done = (save: boolean) => {
    if (closing.current) return
    closing.current = true
    const v = draft.trim()
    setDraft(null)
    if (!save || v === w.name) return
    if (!v) flash("A window needs a name.")
    else onRename(w.key, v)
  }
  const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") { e.preventDefault(); done(true) }
    if (e.key === "Escape") { e.preventDefault(); done(false) }
  }
  return <input autoFocus value={draft} maxLength={40} size={Math.max(6, draft.length + 1)} aria-label="Window name"
    onChange={(e) => setDraft(e.currentTarget.value)} onFocus={(e) => e.currentTarget.select()} onKeyDown={onKey} onBlur={() => done(true)}
    {...sx(s.nameInput)} />
}
