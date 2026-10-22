// A project's tools as windows: master and stack, with the taskbar in a strip below them (never on top).
// The big window (master) is the tool you're working on: its real pages, not a preview. The other open ones wait in
// a column beside it, in the order you drag them into. Full screen lifts the desk over the whole page.
// The taskbar lists every tool: light icons are open, dark ones closed. Design and history: docs/project_ui_explore.
import * as stylex from "@stylexjs/stylex"
import { useEffect, useState, type DragEvent, type FocusEvent, type KeyboardEvent, type PointerEvent, type ReactNode } from "react"
import { flushSync } from "react-dom"
import { sx } from "./kit.tsx"
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
  /** Back a page inside the big window, when it has gone deeper than the tool's start. */
  back?: () => void
  /** Nothing in the tool yet: in the stack it shrinks to its title bar. */
  empty?: boolean
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
  // Where a dragged window will land: a short orange rule in the gap.
  dropLine: { position: "absolute", left: 6, right: 6, height: 3, marginTop: -6.5, borderRadius: 2, backgroundColor: color.accent, pointerEvents: "none" },
  dragging: { opacity: 0.45 },

  // A hairline outline keeps a window's edge against the desk (white on light gray alone disappears). It's a border,
  // not a shadow, so the view-transition picture carries it while windows glide.
  win: {
    display: "flex", flexDirection: "column", minWidth: 0, minHeight: 0, backgroundColor: color.sheet, borderRadius: radius.md, overflow: "hidden",
    borderWidth: 1.5, borderStyle: "solid", borderColor: color.line,
  },
  // The big window carries the focus ring: it's where you are.
  master: { borderWidth: 2, borderColor: color.accent, minHeight: { default: 320, [DESKTOP]: 0 } },
  // On a phone the big window holds a whole page; it scrolls inside, the page doesn't run on forever.
  masterTall: { maxHeight: { default: "78dvh", [DESKTOP]: "none" } },
  waiting: {
    flexGrow: { default: 0, [DESKTOP]: 1 }, flexShrink: 1, flexBasis: { default: "auto", [DESKTOP]: 0 }, maxHeight: { default: 220, [DESKTOP]: "none" },
    cursor: "pointer", transitionProperty: "border-color", transitionDuration: motion.fast,
    borderColor: { default: color.line, ":hover": { default: null, [media.hover]: color.control } },
  },
  // A tool with nothing in it waits as its title bar alone, so the stack's room goes to the tools that have news.
  collapsed: { flexGrow: 0, flexBasis: "auto" },

  head: { display: "flex", alignItems: "center", gap: space.s2, minHeight: 40, paddingBlock: 4, paddingInline: "12px 6px", borderBottomWidth: 1, borderBottomStyle: "solid", borderBottomColor: color.line, flexShrink: 0 },
  headOnly: { borderBottomWidth: 0 },
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
  body: { flexGrow: 1, overflow: "auto", overscrollBehavior: "contain", paddingBlock: 12, paddingInline: 14 },
  peek: { overflow: "hidden", fontSize: text.sm, maskImage: "linear-gradient(#000 55%, transparent)", pointerEvents: "none" },

  empty: { gridColumn: "1 / -1", display: "grid", placeContent: "center", gap: 4, minHeight: 280, borderRadius: radius.lg, backgroundColor: color.sheet, textAlign: "center", color: color.muted },
  emptyTitle: { margin: 0, fontSize: text.md, fontWeight: 650, color: color.ink },

  // The taskbar, in its own strip under the card, on the page ground (in full screen, under the big window).
  // On a phone the bar stays at the bottom of the screen, in thumb reach, while the windows scroll past.
  strip: {
    display: "flex", justifyContent: "center", paddingTop: 12, zIndex: 5,
    position: { default: "sticky", [DESKTOP]: "static" }, bottom: 0, paddingBottom: { default: "max(8px, env(safe-area-inset-bottom))", [DESKTOP]: 0 },
  },
  stripFull: { paddingTop: 0, paddingInline: 10, paddingBottom: 10 },
  // When the windows don't all fit (a phone), the bar's end fades: there's more to scroll to.
  barMore: { maskImage: "linear-gradient(to right, #000 calc(100% - 32px), transparent)" },
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

type Saved = { open: string[]; full: boolean }
// Which windows are open, in order, is remembered; full screen isn't (coming back to a page that covers itself is odd).
const load = (key: string): Saved | null => {
  try { const v = JSON.parse(localStorage.getItem(key) ?? "null"); return v ? { open: v.open, full: false } : null } catch { return null }
}

export const Desk = ({ windows, storageKey, startOpen = 5 }: { windows: ReadonlyArray<DeskWindow>; storageKey: string; startOpen?: number }) => {
  const keys = windows.map((w) => w.key)
  const [state, setState] = useState<Saved>(() => load(storageKey) ?? { open: keys.slice(0, startOpen), full: false })
  // Tools can be switched off or on elsewhere; only ever show the ones that exist.
  const open = state.open.filter((k) => keys.includes(k))
  const byKey = new Map(windows.map((w) => [w.key, w]))
  const [master, ...waiting] = open
  const m = master ? byKey.get(master)! : undefined
  const full = state.full && !!master

  useEffect(() => { try { localStorage.setItem(storageKey, JSON.stringify({ open })) } catch {} }, [storageKey, open.join()])

  // Full screen: the page under it holds still, and Escape comes back out (unless something inside used the key).
  useEffect(() => {
    if (!full) return
    const root = document.documentElement
    root.style.overflow = "hidden"
    const onKey = (e: globalThis.KeyboardEvent) => { if (e.key === "Escape" && !e.defaultPrevented) setState((s) => ({ ...s, full: false })) }
    document.addEventListener("keydown", onKey)
    return () => { root.style.overflow = ""; document.removeEventListener("keydown", onKey) }
  }, [full])

  // Pointer changes glide (view transitions): the window you pick slides into the big spot, the old one back to the
  // stack. Keyboard changes are instant: an action repeated by key should never wait on an animation.
  const change = (next: Saved, e?: UIEvent) => {
    const byPointer = !e || e.detail > 0
    const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches
    if (byPointer && !reduce && document.startViewTransition) document.startViewTransition(() => flushSync(() => setState(next)))
    else setState(next)
  }
  // Full screen stays on while you switch tools from the taskbar; it ends when nothing is left open.
  const bring = (k: string, e?: MouseEvent) => change({ open: [k, ...open.filter((x) => x !== k)], full }, e)
  const close = (k: string, e?: MouseEvent) => change({ open: open.filter((x) => x !== k), full }, e)
  const toggleFull = (e: MouseEvent) => change({ open, full: !full }, e)
  // Put a waiting window before or after another one in the stack.
  const move = (k: string, to: string, after: boolean, e?: UIEvent) => {
    if (k === to) return
    const rest = open.filter((x) => x !== k)
    rest.splice(rest.indexOf(to) + (after ? 1 : 0), 0, k)
    change({ open: rest, full }, e)
  }

  // Dragging a stack window by its title reorders the stack. The drop lands above or below the window under the
  // pointer, whichever half it's over; an orange rule shows where.
  const [drag, setDrag] = useState<string | null>(null)
  const [drop, setDrop] = useState<{ k: string; after: boolean; y: number } | null>(null)
  const dragStart = (e: DragEvent, k: string) => { e.dataTransfer.effectAllowed = "move"; e.dataTransfer.setData("text/plain", k); setDrag(k) }
  const dragOver = (e: DragEvent<HTMLElement>, k: string) => {
    if (!drag) return
    e.preventDefault()
    e.dataTransfer.dropEffect = "move"
    const el = e.currentTarget
    const after = e.clientY > el.getBoundingClientRect().top + el.offsetHeight / 2
    const y = el.offsetTop + (after ? el.offsetHeight + 10 : 0)
    if (drop?.k !== k || drop.after !== after) setDrop({ k, after, y })
  }
  const dropOn = (e: DragEvent) => {
    e.preventDefault()
    if (drag && drop) move(drag, drop.k, drop.after)
    setDrag(null); setDrop(null)
  }
  const dragEnd = () => { setDrag(null); setDrop(null) }
  // From the keyboard: Alt+Up and Alt+Down on a stack window's title move it, instantly.
  const moveKey = (e: KeyboardEvent, k: string) => {
    if (!e.altKey || (e.key !== "ArrowUp" && e.key !== "ArrowDown")) return
    e.preventDefault()
    const i = waiting.indexOf(k), j = i + (e.key === "ArrowUp" ? -1 : 1)
    if (j >= 0 && j < waiting.length) move(k, waiting[j]!, e.key === "ArrowDown", e.nativeEvent)
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

  // Does the bar have more to scroll to (a phone with more windows than fit)? Its end fades only then.
  const [more, setMore] = useState(false)
  const measureBar = (el: HTMLElement | null) => {
    if (!el) return
    const check = () => setMore(el.scrollLeft + el.clientWidth < el.scrollWidth - 1)
    check()
    el.addEventListener("scroll", check)
    addEventListener("resize", check)
    return () => { el.removeEventListener("scroll", check); removeEventListener("resize", check) }
  }
  const vt = (k: string) => ({ viewTransitionName: `desk-${k}` })

  return (
    <section aria-label="Tools" {...sx(full && s.wrapFull)}>
      <div {...sx(s.desk, s.card, full && s.deskFull)}>
        {m ? (
          <section key={m.key} aria-label={m.name} style={vt(m.key)} {...sx(s.win, s.master, !full && !!m.work && s.masterTall)}>
            <WindowHead w={m}>
              <button type="button" onClick={(e) => toggleFull(e.nativeEvent)} aria-pressed={full} aria-label={full ? "Leave full screen" : "Full screen"} title={full ? "Leave full screen (Esc)" : "Full screen"} {...sx(s.iconBtn)}><Icon name={full ? "shrink" : "full"} size={16} /></button>
              <button type="button" onClick={(e) => close(m.key, e.nativeEvent)} aria-label={`Close ${m.name}`} title="Close" {...sx(s.iconBtn)}><Icon name="close" size={16} /></button>
            </WindowHead>
            <div data-window-body {...sx(s.body)}>{m.work ?? m.body}</div>
          </section>
        ) : (
          <div {...sx(s.empty)}><p {...sx(s.emptyTitle)}>Nothing is open</p><p>Pick a tool from the bar below to open it.</p></div>
        )}
        {m && !full && waiting.length > 0 && (
          <div onDragOver={(e) => drag && e.preventDefault()} onDrop={dropOn} {...sx(s.stack)}>
            {waiting.map((k) => {
              const w = byKey.get(k)!
              return (
                <section key={k} aria-label={w.name} style={vt(k)} onClick={(e) => bring(k, e.nativeEvent)} title="Click to bring forward. Drag to reorder."
                  draggable onDragStart={(e) => dragStart(e, k)} onDragOver={(e) => dragOver(e, k)} onDragEnd={dragEnd}
                  onPointerEnter={() => setHovered(k)} onPointerLeave={() => setHovered(null)} {...sx(s.win, s.waiting, w.empty && s.collapsed, drag === k && s.dragging)}>
                  <div {...sx(s.head, w.empty && s.headOnly)}>
                    <button type="button" onClick={(e) => { e.stopPropagation(); bring(k, e.nativeEvent) }} onKeyDown={(e) => moveKey(e, k)}
                      aria-label={`Bring ${w.name} forward`} aria-keyshortcuts="Alt+ArrowUp Alt+ArrowDown" {...sx(s.bring)}>
                      <Icon name={w.icon} size={16} /><b {...sx(s.name)}>{w.name}</b><span {...sx(s.summary)}>{w.summary}</span>
                      <span aria-hidden="true" {...sx(s.hint, hovered === k && !drag && s.hintShown)}>Bring forward</span>
                    </button>
                    <button type="button" onClick={(e) => { e.stopPropagation(); close(k, e.nativeEvent) }} aria-label={`Close ${w.name}`} title="Close" {...sx(s.iconBtn)}><Icon name="close" size={16} /></button>
                  </div>
                  {!w.empty && <div inert {...sx(s.body, s.peek)}>{w.body}</div>}
                </section>
              )
            })}
            {drop && <span aria-hidden="true" style={{ top: drop.y }} {...sx(s.dropLine)} />}
          </div>
        )}
      </div>
      <div {...sx(s.strip, full && s.stripFull)}>
        <nav aria-label="Taskbar: every tool in this project" onPointerEnter={enterBar} onPointerLeave={leaveBar} onBlur={focusOut} ref={measureBar} {...sx(s.bar, more && s.barMore)}>
          {windows.map((w) => {
            const isOpen = open.includes(w.key)
            return (
              <button key={w.key} type="button" aria-pressed={isOpen} aria-label={`${w.name}${isOpen ? (w.key === master ? ", in the big window" : ", open") : ", closed"}`}
                onClick={(e) => { bring(w.key, e.nativeEvent); setTipFor(null) }} onPointerEnter={() => showTip(w.key)} onFocus={(e) => focusIn(e, w.key)}
                {...sx(s.tool, isOpen && s.toolOpen)}>
                <Icon name={w.icon} size={18} />
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
