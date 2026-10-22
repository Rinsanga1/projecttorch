// A project's windows: master and stack. The big window (master) is the one you're working in: its real pages, not a
// preview. Four others wait in a column beside it, sorted for you: late first, then the ones with news, then the rest in
// project order, empty ones last. Nothing to close or drag: they're the project, not tabs. Which window is in front is
// the page's address (/projects/2/docs/5 is Files, at that doc), so the desk only asks to switch. Full screen lifts the
// desk over the whole page. Above the desk, one row names every window and carries the news: "Since Tuesday:" then each
// window, with a count of what's new, the late one outlined. Under 900px that row is the dark taskbar at the bottom of
// the screen instead, in thumb reach. Design and history: docs/project_ui_explore, docs/app_terms.
import * as stylex from "@stylexjs/stylex"
import { useEffect, useState, type FocusEvent, type PointerEvent, type ReactNode } from "react"
import { flushSync } from "react-dom"
import { fadeOverflow, sx } from "./kit.tsx"
import { Icon, type IconName } from "./icons.tsx"
import { color, light, media, motion, radius, space, text } from "./tokens.stylex.ts"

export type DeskWindow = {
  key: string
  name: string
  icon: IconName
  /** One line about what's new, for the title bar and the taskbar tip. */
  summary: string
  /** The preview a stack window shows. */
  body: ReactNode
  /** What the big window shows, to work in (the tool's pages); the preview when there's none. */
  work?: ReactNode
  /** The address of what the big window shows: each new one starts at its top. */
  place?: string
  /** Back a page inside the big window, when it has gone deeper than the tool's start. */
  back?: () => void
  /** Nothing in the window yet: in the stack it says so in one sentence (its summary) and sorts last. */
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
const s = stylex.create({
  // No corners of its own: it runs to the sheet's edges and the sheet clips it.
  // The bottom half of the page's card (the project head is the top): Tile Gray, with the sheet's bottom corners.
  card: { backgroundColor: color.tile, borderBottomLeftRadius: { default: radius.lg, [SHEET]: radius.xl }, borderBottomRightRadius: { default: radius.lg, [SHEET]: radius.xl } },
  // Full screen: the desk covers the whole page, the big window alone above the taskbar.
  wrapFull: { position: "fixed", inset: 0, zIndex: 50, display: "flex", flexDirection: "column", backgroundColor: color.tile },
  desk: {
    display: "grid", gap: 10, padding: 10,
    // The stack keeps its width; every extra pixel goes to the big window.
    gridTemplateColumns: { default: "minmax(0, 1fr)", [DESKTOP]: "minmax(0, 1fr) 300px" },
    // Fills the screen under the project head, leaving room for the taskbar strip.
    height: { default: "auto", [DESKTOP]: "max(460px, calc(100dvh - 272px))" },
  },
  deskFull: { gridTemplateColumns: "minmax(0, 1fr)", flexGrow: 1, minHeight: 0, height: { default: "auto", [DESKTOP]: "auto" }, borderRadius: 0 },
  stack: { position: "relative", display: "flex", flexDirection: "column", gap: 10, minHeight: 0 },

  // A hairline outline keeps a window's edge against the desk (white on light gray alone disappears). It's a border,
  // not a shadow, so the view-transition picture carries it while windows glide.
  win: {
    // clip, not hidden: it rounds the corners without becoming a scroll box (so a sticky composer still sticks on a phone).
    display: "flex", flexDirection: "column", minWidth: 0, minHeight: 0, backgroundColor: color.sheet, borderRadius: radius.md, overflow: "clip",
    borderWidth: 1.5, borderStyle: "solid", borderColor: color.line,
  },
  // The big window carries the focus ring: it's where you are.
  master: { borderWidth: 2, borderColor: color.accent, minHeight: { default: 320, [DESKTOP]: 0 } },
  waiting: {
    flexGrow: { default: 0, [DESKTOP]: 1 }, flexShrink: 1, flexBasis: { default: "auto", [DESKTOP]: 0 }, maxHeight: { default: 220, [DESKTOP]: "none" },
    cursor: "pointer", transitionProperty: "border-color", transitionDuration: motion.fast,
    borderColor: { default: color.line, ":hover": { default: null, [media.hover]: color.control } },
  },

  head: { display: "flex", alignItems: "center", gap: space.s2, minHeight: 40, paddingBlock: 4, paddingInline: "12px 6px", borderBottomWidth: 1, borderBottomStyle: "solid", borderBottomColor: color.line, flexShrink: 0 },
  // The back button is wider than the icon it replaces; it tucks into the padding so the name stays put.
  headBack: { paddingLeft: 6 },
  backBtn: { marginRight: -6 },
  name: { fontSize: "0.875rem", fontWeight: 650, letterSpacing: "-0.015em", whiteSpace: "nowrap" },
  summary: { minWidth: 0, fontSize: text.xs, color: color.muted, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" },
  actions: { display: "flex", alignItems: "center", gap: 2, marginLeft: "auto", flexShrink: 0 },
  // A stack window's title is one button that brings it forward.
  bring: {
    position: "relative", display: "flex", alignItems: "center", justifyContent: "flex-start", gap: space.s2, minWidth: 0, flexGrow: 1, minHeight: 0, padding: 0, background: "none", borderRadius: 0,
    color: "inherit", textAlign: "left", fontWeight: "inherit", transform: { default: null, ":active": "none" },
    backgroundColor: { default: "transparent", ":hover": { default: null, [media.hover]: "transparent" } },
  },
  // Floats over the end of the title (fading the summary under it), so it takes no room from the summary.
  hint: {
    position: "absolute", insetBlock: 0, right: 0, display: "flex", alignItems: "center", paddingLeft: 28, fontSize: 11, fontWeight: 500, color: color.muted, whiteSpace: "nowrap",
    backgroundImage: `linear-gradient(to right, transparent, ${color.sheet} 24px)`, opacity: 0, transitionProperty: "opacity", transitionDuration: motion.fast,
  },
  hintShown: { opacity: 1 },
  iconBtn: {
    width: 28, minHeight: 28, padding: 0, borderRadius: radius.sm, background: "none", color: color.muted,
    backgroundColor: { default: "transparent", ":hover": { default: null, [media.hover]: color.tile } },
  },
  // On desktop the window scrolls inside itself; on a phone the window is the page, so the page does the scrolling.
  body: { flexGrow: 1, overflow: { default: "visible", [DESKTOP]: "auto" }, overscrollBehavior: "contain", paddingBlock: 12, paddingInline: 14 },
  // In full screen the window fills the screen at every size, so it scrolls inside.
  bodyFull: { overflow: "auto" },
  peek: { overflow: "hidden", fontSize: text.sm, maskImage: "linear-gradient(#000 55%, transparent)", pointerEvents: "none" },
  // A window with nothing in it yet says so in one plain sentence ("No files yet."), and sorts to the bottom of the stack.
  blank: { margin: 0, color: color.muted, fontSize: text.sm },
  // Sorted last and with nothing to show, an empty window takes only the room its sentence needs.
  quiet: { flexGrow: 0, flexBasis: "auto" },

  // The row of every window, under the project head: the head's white, the head's padding.
  // On a phone it's the news line only: the windows with news or late work, one line that scrolls sideways (the bottom
  // bar does the getting around there).
  row: {
    display: "flex", flexWrap: { default: "nowrap", [DESKTOP]: "wrap" }, alignItems: "center", gap: 4,
    overflowX: { default: "auto", [DESKTOP]: "visible" }, scrollbarWidth: "none",
    paddingInline: { default: 20, [DESKTOP]: 28 }, paddingBottom: 16, backgroundColor: color.sheet, fontSize: text.sm,
  },
  desktopOnly: { display: { default: "none", [DESKTOP]: "inline-flex" } },
  rowFull: { paddingTop: 10, paddingInline: 10, paddingBottom: 6, backgroundColor: color.tile },
  lead: { fontWeight: 650, marginRight: 4, whiteSpace: "nowrap" },
  calm: { color: color.muted, marginRight: 4, whiteSpace: "nowrap" },
  pill: {
    display: "inline-flex", alignItems: "center", gap: 6, minHeight: 30, paddingBlock: 4, paddingInline: 11, borderRadius: radius.pill,
    fontSize: text.sm, fontWeight: 600, color: color.ink, whiteSpace: "nowrap",
    backgroundColor: { default: color.tile, ":hover": { default: null, [media.hover]: color.tileHover } },
  },
  pillNews: { backgroundColor: { default: color.accentSoft, ":hover": { default: null, [media.hover]: color.accentSoft } } },
  pillLate: { color: color.accentText, backgroundColor: { default: "transparent", ":hover": { default: null, [media.hover]: color.tile } }, boxShadow: `inset 0 0 0 1.5px color-mix(in srgb, ${color.accent} 55%, transparent)` },
  pillCur: { color: color.onPrimary, boxShadow: "none", backgroundColor: { default: color.primary, ":hover": { default: null, [media.hover]: color.primaryHover } } },
  plus: { width: 30, paddingInline: 0, justifyContent: "center", color: color.muted },
  num: {
    display: "inline-flex", alignItems: "center", justifyContent: "center", minWidth: 18, height: 18, paddingInline: 5, borderRadius: radius.pill,
    backgroundColor: color.accent, color: color.onAccent, fontSize: 11, fontWeight: 700, fontVariantNumeric: "tabular-nums",
  },
  numOnCur: { backgroundColor: color.onPrimary, color: color.primary },
  // A side window with news says so in its title bar, in place of its summary.
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
    // On desktop the row above the desk does this job.
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

/** How many windows wait beside the big one. */
const STACK = 4

export const Desk = ({ windows, master, onBring, since, note, addHref }: {
  windows: ReadonlyArray<DeskWindow>
  /** The window in front (from the address). */
  master: string
  /** Bring a window forward: the page moves to it (back to where you last were in it). */
  onBring: (key: string, e?: MouseEvent) => void
  /** "Since Tuesday": when you last opened the project. Without it (a first visit), the row names the windows only. */
  since?: string
  /** Said in place of the news, when there's something better to say (a brand-new project). */
  note?: string
  /** Where "+" goes to add or remove windows; none for people who can't. */
  addHref?: string
}) => {
  const m = windows.find((w) => w.key === master)
  const [fullOn, setFull] = useState(false)
  const full = fullOn && !!m
  // Opening a window is reading it: its news count goes for the rest of this visit.
  const [read, setRead] = useState<ReadonlySet<string>>(() => new Set([master]))
  useEffect(() => setRead((r) => (r.has(master) ? r : new Set(r).add(master))), [master])
  const newsOf = (w: DeskWindow) => (read.has(w.key) ? 0 : w.news ?? 0)
  const anyNews = windows.some((w) => newsOf(w) > 0)
  // The stack sorts itself: late first, then news, then project order; empty windows last.
  const rank = (w: DeskWindow) => ((w.late ?? 0) > 0 ? 0 : newsOf(w) > 0 ? 1 : w.empty ? 3 : 2)
  const waiting = windows.filter((w) => w.key !== master).map((w, i) => ({ w, i })).sort((a, b) => rank(a.w) - rank(b.w) || a.i - b.i).slice(0, STACK).map((x) => x.w)

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
  const bring = (k: string, e?: MouseEvent) => onBring(k, e)
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

  const [hovered, setHovered] = useState<string | null>(null)

  const vt = (k: string) => ({ viewTransitionName: `desk-${k}` })

  return (
    <section aria-label="Windows" {...sx(full && s.wrapFull)}>
      <nav aria-label="Every window in this project" ref={fadeOverflow} {...sx(s.row, full && s.rowFull)}>
        {note ? <span {...sx(s.calm)}>{note}</span> : since && (anyNews ? <span {...sx(s.lead)}>{since}:</span> : <span {...sx(s.calm)}>All caught up.</span>)}
        {windows.map((w) => {
          const cur = w.key === master, n = newsOf(w), late = w.late ?? 0
          return (
            <button key={w.key} type="button" onClick={(e) => bring(w.key, e.nativeEvent)} aria-current={cur || undefined}
              aria-label={[w.name, n && `${n} new`, late && `${late} late`].filter(Boolean).join(", ")}
              {...sx(s.pill, n > 0 && s.pillNews, late > 0 && !cur && s.pillLate, cur && s.pillCur, !n && !(late > 0 && !cur) && s.desktopOnly)}>
              {w.name}
              {n > 0 ? <span aria-hidden="true" {...sx(s.num, cur && s.numOnCur)}>{n}</span> : late > 0 && <span aria-hidden="true">{late} late</span>}
            </button>
          )
        })}
        {addHref && <a href={addHref} aria-label="Add or remove windows" title="Add or remove windows" data-button {...sx(s.pill, s.plus, s.desktopOnly)}><Icon name="plus" size={16} /></a>}
      </nav>
      <div {...sx(s.desk, s.card, full && s.deskFull)}>
        {m ? (
          <section key={m.key} aria-label={m.name} style={vt(m.key)} {...sx(s.win, s.master)}>
            <WindowHead w={m}>
              <button type="button" onClick={(e) => toggleFull(e.nativeEvent)} aria-pressed={full} aria-label={full ? "Leave full screen" : "Full screen"} title={full ? "Leave full screen (Esc)" : "Full screen"} {...sx(s.iconBtn)}><Icon name={full ? "shrink" : "full"} size={16} /></button>
            </WindowHead>
            <div key={m.place} data-window-body {...sx(s.body, full && s.bodyFull)}>{m.work ?? m.body}</div>
          </section>
        ) : (
          <div {...sx(s.empty)}><p {...sx(s.emptyTitle)}>No windows yet</p><p>Add one with + above.</p></div>
        )}
        {m && !full && waiting.length > 0 && (
          <div {...sx(s.stack)}>
            {waiting.map((w) => (
              <section key={w.key} aria-label={w.name} style={vt(w.key)} onClick={(e) => bring(w.key, e.nativeEvent)}
                onPointerEnter={() => setHovered(w.key)} onPointerLeave={() => setHovered(null)} {...sx(s.win, s.waiting, w.empty && s.quiet)}>
                <div {...sx(s.head)}>
                  <button type="button" onClick={(e) => { e.stopPropagation(); bring(w.key, e.nativeEvent) }} aria-label={`Bring ${w.name} forward`} {...sx(s.bring)}>
                    <Icon name={w.icon} size={16} /><b {...sx(s.name)}>{w.name}</b>
                    {newsOf(w) > 0 ? <span {...sx(s.newTag)}>{newsOf(w)} new</span> : !w.empty && <span {...sx(s.summary)}>{w.summary}</span>}
                    <span aria-hidden="true" {...sx(s.hint, hovered === w.key && s.hintShown)}>Bring forward</span>
                  </button>
                </div>
                {w.empty
                  ? <div {...sx(s.body)}><p {...sx(s.blank)}>{w.summary}.</p></div>
                  : <div inert {...sx(s.body, s.peek)}>{w.body}</div>}
              </section>
            ))}
          </div>
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
        </nav>
      </div>
    </section>
  )
}

// Deeper than the tool's start page, the icon gives way to a back button, in the same spot.
const WindowHead = ({ w, children }: { w: DeskWindow; children: ReactNode }) => (
  <div {...sx(s.head, w.back && s.headBack)}>
    {w.back
      ? <button type="button" onClick={w.back} aria-label={`Back in ${w.name}`} title="Back" {...sx(s.iconBtn, s.backBtn)}><Icon name="back" size={16} /></button>
      : <Icon name={w.icon} size={16} />}
    <b {...sx(s.name)}>{w.name}</b>
    <span {...sx(s.summary)}>{w.summary}</span>
    <span {...sx(s.actions)}>{children}</span>
  </div>
)
