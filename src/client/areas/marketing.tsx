// The marketing page. Stands alone, outside the app chrome: the kargul.studio look at full strength
// (big Geist type, pill buttons, dark rounded slabs), showing a real project rather than describing one.
import * as stylex from "@stylexjs/stylex"
import { useEffect, useLayoutEffect, useRef, useState, type PointerEvent as PE, type ReactNode } from "react"
import { Navigate } from "react-router"
import { sx } from "../ui/kit.tsx"
import { page } from "../ui/page.tsx"
import { color, media, motion, radius, space, text } from "../ui/tokens.stylex.ts"

const TOOLS = [
  ["Posts", "Share news and ideas. Talk them over right below."],
  ["Milestones", "List what has to get done. Split a big task into smaller ones. The bar fills up as things get done."],
  ["Files", "Keep docs, files and links in folders. Old versions are saved too."],
  ["Chat", "Ask a quick question. Get a quick answer."],
  ["Calendar", "See every date and deadline. Add them to the calendar you already use."],
  ["Boards", "Drag cards across as the work moves. A Golden Ticket keeps one on top. Cards nobody touches close themselves."],
]

const CUTS = [
  ["Gantt charts", "Plans change. A chart of the future is mostly a guess."],
  ["Custom fields", "A task needs a name, a person, a date and some notes. That's it."],
  ["Read receipts", "No one does good work while they feel watched."],
  ["Online dots", "It's fine to be away."],
  ["Sprints and points", "Counting points is not the same as getting work done."],
  ["Automation builders", "Most teams don't need them. The few who do can hook up their own tools."],
]

// ---------- the example project ----------
// Milestones as the app shows them: one bar for the whole list, then the tasks, the big ones split into subtasks.
// The bar counts what's checked off, subtasks included, like progressOf in news.ts. Everything here can be clicked.
const MILESTONES = [
  { name: "Homepage design", subs: [["Sketches", true], ["Pick the font", true], ["Sign off on the look", true]] },
  { name: "Build the site", subs: [["Set up hosting", true], ["Page templates", true], ["Contact form", true], ["Redirects", true], ["Footer links", false], ["Speed check", false]] },
  { name: "Launch", subs: [["Launch email", false], ["Tell Northwind", false]] },
] as const
// The demo's Milestones tile: two get checked off a moment after the page loads (unless motion is reduced).
const LAUNCH = [["Pick the font", true, ""], ["Write the homepage text", true, ""], ["Set up redirects", false, "Bob, Oct 25"], ["Sign off on the text", false, "Dan"]] as const
const COLS = ["Triage", "In progress", "Done"]
const CARDS = [
  { id: 1, title: "Launch email", col: 0, golden: true }, { id: 2, title: "Dark mode", col: 0 },
  { id: 3, title: "404 page", col: 1 }, { id: 4, title: "Favicon", col: 2 },
]
const EASE = "cubic-bezier(.23, 1, .32, 1)"
const calm = () => matchMedia("(prefers-reduced-motion: reduce)").matches

// ---------- motion ----------
// Every element rests in its final state; keyframes only say where it comes from. So under reduced motion (the base
// layer stops all animation), or in a browser without scroll timelines, everything is simply in place.
// Load-time: the hero arrives, then the example project comes alive (tasks tick, chat messages arrive).
// Scroll-linked (`SCROLL`): sections rise as they come into view, the cut features get struck through.
const rise = stylex.keyframes({ from: { opacity: 0, transform: "translateY(16px)", filter: "blur(4px)" } })
const lift = stylex.keyframes({ from: { opacity: 0, transform: "translateY(32px)" } })
const pop = stylex.keyframes({ from: { opacity: 0, transform: "translateY(8px) scale(.96)" } })
const fillIn = stylex.keyframes({ from: { backgroundColor: "transparent" } })
const wipe = stylex.keyframes({ from: { clipPath: "inset(0 100% 0 0)" } })
const strikeIn = stylex.keyframes({ from: { textDecorationColor: "transparent" } })
const strike = stylex.keyframes({ from: { transform: "scaleX(0)" } })
const surface = stylex.keyframes({ from: { transform: "translateY(45%)" } })

const DESKTOP = "@media (min-width: 900px)"
const PHONE = "@media (max-width: 640px)"
const SCROLL = "@supports (animation-timeline: view())"
const s = stylex.create({
  enter: { animationName: rise, animationDuration: "900ms", animationTimingFunction: motion.out, animationFillMode: "both" },
  pop: { animationName: pop, animationDuration: "500ms", animationTimingFunction: motion.out, animationFillMode: "both" },
  delay: (ms: number) => ({ animationDelay: `${ms}ms` }),
  reveal: {
    animationName: { default: null, [SCROLL]: lift }, animationDuration: { default: null, [SCROLL]: "auto" },
    animationTimeline: { default: null, [SCROLL]: "view()" }, animationRange: { default: null, [SCROLL]: "entry 0% cover 30%" },
    animationTimingFunction: motion.out, animationFillMode: "both",
  },

  wrap: { maxWidth: 1224, marginInline: "auto", paddingInline: { default: space.s4, [DESKTOP]: space.s6 } },
  strip: {
    display: "flex", justifyContent: "center", alignItems: "center", gap: space.s2, paddingBlock: 10, paddingInline: space.s4,
    backgroundColor: color.slab, color: color.slabInk, fontSize: text.sm, fontWeight: 600, textDecoration: "none", textAlign: "center",
    ":hover": { textDecoration: "underline" },
  },
  header: { display: "flex", alignItems: "center", justifyContent: "space-between", gap: space.s4, paddingBlock: space.s4 },
  brand: { display: "flex", alignItems: "center", gap: space.s5 },
  wordmark: { fontSize: 22, fontWeight: 750, letterSpacing: "-0.045em", color: color.ink, textDecoration: "none" },
  nav: { display: { default: "none", [DESKTOP]: "flex" }, gap: space.s5, fontSize: text.sm },
  navLink: { color: { default: color.muted, ":hover": { default: null, [media.hover]: color.ink } }, textDecoration: "none" },
  headerEnd: { display: "flex", alignItems: "center", gap: space.s2 },
  textLink: { fontSize: text.sm, fontWeight: 600, color: color.ink, textDecoration: "none", paddingInline: 12, ":hover": { textDecoration: "underline" } },
  pill: {
    display: "inline-flex", alignItems: "center", justifyContent: "center", gap: space.s2, minHeight: 44, paddingInline: 22,
    borderRadius: radius.pill, fontSize: text.base, fontWeight: 650, letterSpacing: "-0.01em", textDecoration: "none", whiteSpace: "nowrap",
    transitionProperty: "background-color, transform", transitionDuration: motion.fast, transitionTimingFunction: motion.out,
    transform: { default: null, ":active": { default: "scale(.97)", [media.reduce]: null } },
  },
  pillSmall: { minHeight: 40, paddingInline: 18, fontSize: text.sm },
  pillLarge: { minHeight: 54, paddingInline: 26, fontSize: text.md },
  dark: { backgroundColor: { default: color.primary, ":hover": { default: null, [media.hover]: color.primaryHover } }, color: color.onPrimary },
  light: { backgroundColor: { default: color.sheet, ":hover": { default: null, [media.hover]: color.tile } }, color: color.ink },

  hero: { textAlign: "center", paddingTop: { default: space.s8, [DESKTOP]: 112 }, paddingBottom: space.s8 },
  h1: {
    margin: 0, marginInline: "auto", maxWidth: "14ch", fontSize: "clamp(2.75rem, 1.2rem + 6vw, 5.25rem)", lineHeight: 0.98,
    fontWeight: 750, letterSpacing: "-0.04em", textWrap: "balance",
  },
  lede: {
    marginTop: space.s5, marginBottom: 0, marginInline: "auto", maxWidth: "38rem", fontSize: { default: text.md, [DESKTOP]: "1.1875rem" },
    lineHeight: 1.55, color: color.muted, textWrap: "pretty",
  },
  ctas: { display: "flex", flexWrap: "wrap", justifyContent: "center", gap: space.s2, marginTop: space.s6, marginBottom: 0, maxWidth: "none" },

  // The example project, drawn as the app draws it.
  demo: {
    backgroundColor: color.sheet, borderRadius: { default: radius.xl, [DESKTOP]: 32 }, padding: { default: space.s4, [DESKTOP]: space.s6 },
    boxShadow: "0 1px 2px rgba(0,0,0,.04), 0 24px 60px -24px rgba(0,0,0,.18)",
  },
  demoHead: { display: "flex", flexWrap: "wrap", alignItems: "baseline", justifyContent: "space-between", gap: space.s2, paddingInline: space.s2, marginBottom: space.s4 },
  demoTitle: { margin: 0, fontSize: { default: text.xl, [DESKTOP]: text.xxl }, letterSpacing: "-0.03em" },
  demoMeta: { margin: 0, fontSize: text.sm, color: color.muted },
  // Dense, so on two columns the wide Board tile doesn't leave a hole.
  demoGrid: { display: "grid", gridTemplateColumns: { default: "1fr", "@media (min-width: 640px)": "1fr 1fr", [DESKTOP]: "repeat(3, 1fr)" }, gridAutoFlow: "dense", gap: space.s3 },
  demoTile: { backgroundColor: color.tile, borderRadius: radius.xl, padding: space.s5, minHeight: { default: 0, "@media (min-width: 640px)": 190 } },
  wide: { gridColumn: { default: null, "@media (min-width: 640px)": "span 2" } },
  demoTileTitle: { margin: 0, marginBottom: space.s3, fontSize: text.base, fontWeight: 650, letterSpacing: "-0.015em" },
  demoList: { margin: 0, padding: 0, listStyle: "none", fontSize: text.sm, display: "grid", gap: 9 },
  below: { marginTop: space.s4 },
  plain: { padding: 0, borderTopWidth: 0 },
  demoItem: { padding: 0, borderTopWidth: 0, display: "flex", alignItems: "center", gap: 9, color: color.ink },
  mine: { justifyContent: "flex-end" },
  bubble: { paddingBlock: 6, paddingInline: 12, borderRadius: 16, backgroundColor: color.tileHover },
  who: { fontWeight: 600 },
  muted: { color: color.muted },
  // A to-do row is one button: the whole line checks it off.
  check: {
    display: "flex", alignItems: "center", justifyContent: "flex-start", gap: 9, width: "100%", minHeight: 0, padding: 0, borderRadius: 6,
    fontSize: "inherit", fontWeight: 400, textAlign: "left", color: color.ink, backgroundColor: { default: "transparent", ":hover": "transparent" },
    transform: { default: null, ":active": { default: "scale(.98)", [media.reduce]: null } },
  },
  checkBig: { fontSize: { default: text.md, [DESKTOP]: text.lg }, fontWeight: 700, letterSpacing: "-0.025em" },
  meta: { marginLeft: "auto", fontSize: text.sm, fontWeight: 400, letterSpacing: 0, fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap" },
  box: {
    width: 16, height: 16, flexShrink: 0, borderRadius: 5, borderWidth: 1.5, borderStyle: "solid", borderColor: color.control,
    display: "inline-flex", alignItems: "center", justifyContent: "center", color: color.onAccent,
  },
  boxBig: { width: 22, height: 22, borderRadius: 7 },
  boxDone: { backgroundColor: color.accent, borderColor: color.accent },
  ticking: { animationName: fillIn, animationDuration: "300ms", animationTimingFunction: motion.out, animationFillMode: "both" },
  tickDraw: { display: "block", animationName: wipe, animationDuration: "350ms", animationDelay: "80ms", animationTimingFunction: motion.out, animationFillMode: "both" },
  struck: { animationName: strikeIn, animationDuration: "400ms", animationDelay: "150ms", animationTimingFunction: motion.out, animationFillMode: "both" },
  // The bar's fill slides in from the left (transform only), so its rounded end stays round at any width.
  bar: { display: "block", height: 8, borderRadius: radius.pill, backgroundColor: color.sheet, overflow: "hidden" },
  barBig: { height: 10, backgroundColor: color.tile },
  fill: {
    display: "block", height: "100%", borderRadius: radius.pill, backgroundColor: color.accent,
    transitionProperty: "transform", transitionDuration: { default: "600ms", [media.reduce]: "0s" }, transitionTimingFunction: motion.out,
  },
  board: { display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: space.s2, userSelect: "none" },
  col: {
    display: "grid", alignContent: "start", gap: 6, minHeight: 132, padding: 6, borderRadius: radius.lg, backgroundColor: color.sheet,
    transitionProperty: "background-color", transitionDuration: motion.fast,
  },
  colOver: { backgroundColor: color.accentSoft },
  colName: { margin: 0, paddingBlock: 2, paddingInline: 4, fontSize: text.xs, fontWeight: 700, color: color.muted },
  kard: {
    position: "relative", justifyContent: "flex-start", minHeight: 0, paddingBlock: 8, paddingInline: 10, borderRadius: radius.md,
    textAlign: "left", fontSize: text.sm, backgroundColor: { default: color.tile, ":hover": { default: null, [media.hover]: color.tileHover } },
    cursor: "grab", touchAction: "manipulation",
  },
  golden: { backgroundColor: { default: color.accentSoft, ":hover": { default: null, [media.hover]: color.accentSoft } } },
  star: { color: color.accentText },
  // Picked up: above the rest, with a shadow under it, following the pointer (the transform is set as it moves).
  lifted: { zIndex: 2, cursor: "grabbing", boxShadow: "0 12px 28px -8px rgba(0,0,0,.28)", transitionProperty: "none" },
  label: { marginTop: space.s3, marginBottom: 0, textAlign: "center", fontSize: text.xs, color: color.muted },

  section: { paddingBlock: { default: space.s8, [DESKTOP]: 120 } },
  sectionHead: { maxWidth: "40rem", marginBottom: space.s7 },
  center: { marginInline: "auto", textAlign: "center" },
  centerP: { marginInline: "auto" },
  h2: { margin: 0, fontSize: "clamp(2rem, 1.2rem + 2.6vw, 3.25rem)", lineHeight: 1.05, fontWeight: 750, letterSpacing: "-0.035em", textWrap: "balance" },
  sub: { marginTop: space.s4, marginBottom: 0, fontSize: text.md, lineHeight: 1.55, color: color.muted, textWrap: "pretty" },

  slab: {
    backgroundColor: color.slab, color: color.slabInk, borderRadius: { default: 28, [DESKTOP]: radius.slab },
    paddingBlock: { default: space.s8, [DESKTOP]: 120 },
  },
  slabSub: { color: color.slabMuted },
  tools: { display: "grid", gridTemplateColumns: { default: "1fr", "@media (min-width: 640px)": "1fr 1fr", [DESKTOP]: "repeat(4, 1fr)" }, gap: space.s3, margin: 0 },
  tool: { backgroundColor: color.slabTile, borderRadius: radius.xl, padding: space.s5, display: "flex", flexDirection: "column", gap: space.s3, minHeight: { default: 0, [DESKTOP]: 200 } },
  toolName: { margin: 0, fontSize: text.md, fontWeight: 650, letterSpacing: "-0.02em", color: color.slabInk },
  toolText: { margin: 0, fontSize: text.sm, lineHeight: 1.55, color: color.slabMuted },

  split: { display: "grid", gridTemplateColumns: { default: "1fr", [DESKTOP]: "5fr 7fr" }, gap: { default: space.s6, [DESKTOP]: space.s8 }, alignItems: "start" },
  cards: { display: "grid", gap: space.s3, margin: 0 },
  card: { backgroundColor: color.sheet, borderRadius: radius.xl, paddingBlock: space.s5, paddingInline: space.s6 },
  cardTitle: { margin: 0, fontSize: text.lg, fontWeight: 700, letterSpacing: "-0.025em" },
  cardText: { marginTop: space.s2, marginBottom: 0, fontSize: text.base, color: color.muted, lineHeight: 1.55 },

  tasksCard: { backgroundColor: color.sheet, borderRadius: { default: radius.xl, [DESKTOP]: 32 }, padding: { default: space.s4, [DESKTOP]: space.s7 }, marginBottom: space.s3 },
  msOverall: { display: "flex", alignItems: "baseline", gap: space.s3, margin: 0, marginBottom: space.s5 },
  msPct: { fontSize: { default: text.xxl, [DESKTOP]: "3rem" }, fontWeight: 750, letterSpacing: "-0.04em", lineHeight: 1, fontVariantNumeric: "tabular-nums" },
  msNow: { color: color.muted, fontSize: text.base },
  msList: {
    display: "grid", gridTemplateColumns: { default: "1fr", [DESKTOP]: "repeat(3, 1fr)" }, alignItems: "start", gap: { default: space.s5, [DESKTOP]: space.s6 },
    margin: 0, marginTop: space.s6, padding: 0, listStyle: "none",
  },
  subs: { marginTop: space.s3, paddingLeft: 31 },
  trio: { display: "grid", gridTemplateColumns: { default: "1fr", [DESKTOP]: "repeat(3, 1fr)" }, gap: space.s3, margin: 0 },

  cuts: { margin: 0, borderTopWidth: 1, borderTopStyle: "solid", borderTopColor: color.slabTile },
  cut: {
    display: "grid", gridTemplateColumns: { default: "1fr", [DESKTOP]: "5fr 7fr" }, gap: { default: space.s1, [DESKTOP]: space.s6 }, alignItems: "baseline",
    paddingBlock: space.s5, borderBottomWidth: 1, borderBottomStyle: "solid", borderBottomColor: color.slabTile,
  },
  cutName: {
    position: "relative", justifySelf: "start", fontSize: "clamp(1.375rem, 1rem + 1.2vw, 2rem)", fontWeight: 700, letterSpacing: "-0.03em",
    color: color.slabMuted,
  },
  // The strike is a bar, not text-decoration, so it can draw left to right as the row scrolls in.
  strike: {
    position: "absolute", insetInline: 0, top: "54%", height: 2, backgroundColor: color.accent, transformOrigin: "left",
    animationName: { default: null, [SCROLL]: strike }, animationDuration: { default: null, [SCROLL]: "auto" },
    animationTimeline: { default: null, [SCROLL]: "view()" }, animationRange: { default: null, [SCROLL]: "entry 80% cover 45%" },
    animationTimingFunction: motion.inOut, animationFillMode: "both",
  },
  cutWhy: { margin: 0, fontSize: text.md, color: color.slabInk },

  close: { textAlign: "center", paddingBlock: { default: space.s8, [DESKTOP]: 140 } },
  footer: { overflow: "hidden", paddingTop: space.s6 },
  footerRow: {
    display: "flex", flexWrap: "wrap", justifyContent: "space-between", gap: space.s4, paddingBlock: space.s5,
    borderTopWidth: 1, borderTopStyle: "solid", borderTopColor: color.line, fontSize: text.sm, color: color.muted,
  },
  footerLinks: { display: "flex", flexWrap: "wrap", gap: space.s5, margin: 0 },
  giant: {
    display: "block", marginTop: space.s4, marginBottom: "-0.2em", fontSize: "clamp(3.5rem, 15.5vw, 14rem)", lineHeight: 0.8, fontWeight: 800,
    letterSpacing: "-0.06em", color: color.ink, textAlign: "center", userSelect: "none", whiteSpace: "nowrap",
    // Rises out of the page's bottom edge (the footer crops it) as you reach the end.
    animationName: { default: null, [SCROLL]: surface }, animationDuration: { default: null, [SCROLL]: "auto" },
    animationTimeline: { default: null, [SCROLL]: "view()" }, animationRange: { default: null, [SCROLL]: "entry 0% entry 70%" },
    animationTimingFunction: motion.out, animationFillMode: "both",
  },
})

const Arrow = () => (
  <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true"><path d="M2 7h10M8 3l4 4-4 4" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg>
)
const Tick = () => (
  <svg width="10" height="10" viewBox="0 0 12 12" aria-hidden="true" {...sx(s.tickDraw)}><path d="M2.5 6.2 5 8.6l4.5-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>
)

// A to-do you can check off: the box fills, the tick draws, the name gets struck through.
const Check = ({ title, done, toggle, meta, big }: { title: string; done: boolean; toggle: () => void; meta?: string; big?: boolean }) => (
  <button type="button" role="checkbox" aria-checked={done} onClick={toggle} {...sx(s.check, big && s.checkBig)}>
    <span aria-hidden="true" {...sx(s.box, big && s.boxBig, done && [s.boxDone, s.ticking])}>{done && <Tick />}</span>
    <span {...sx(done && s.muted)}>{done ? <s {...sx(s.struck)}>{title}</s> : title}</span>
    {meta && <span {...sx(s.muted, s.meta)}>{meta}</span>}
  </button>
)
// The one bar. `shown` is what it draws (empty until it's on screen); `pct` is what it says.
const Bar = ({ pct, shown = pct, big }: { pct: number; shown?: number; big?: boolean }) => (
  <span role="progressbar" aria-label="Done" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} {...sx(s.bar, big && s.barBig)}>
    <span style={{ transform: `translateX(${shown - 100}%)` }} {...sx(s.fill)} />
  </span>
)

// `at`: when (ms after load) a message arrives. Yours sit on the right, in a bubble, as in the app.
const Said = ({ who, what, at, mine }: { who?: string; what: string; at?: number; mine?: boolean }) => (
  <li {...sx(s.demoItem, mine && s.mine, at != null && [s.pop, s.delay(at)])}>
    {mine ? <span {...sx(s.bubble)}>{what}</span> : <span><span {...sx(s.who)}>{who}:</span> {what}</span>}
  </li>
)
const Tile = ({ i, title, wide, children }: { i: number; title: ReactNode; wide?: boolean; children: ReactNode }) => (
  <div {...sx(s.demoTile, wide && s.wide, s.enter, s.delay(450 + i * 60))}><h3 {...sx(s.demoTileTitle)}>{title}</h3>{children}</div>
)
const Dated = ({ when, what }: { when: string; what: string }) => <li {...sx(s.demoItem)}><span {...sx(s.who)}>{when}</span><span>{what}</span></li>

// The demo's Milestones tile. Shortly after load two to-dos check themselves off and the bar moves with them,
// unless you got there first.
const LaunchTile = () => {
  const [done, setDone] = useState(() => LAUNCH.map(([, d]) => d && calm()))
  const touched = useRef(false)
  useEffect(() => {
    if (calm()) return
    const ts = LAUNCH.flatMap(([, d], i) => d ? [setTimeout(() => touched.current || setDone((ds) => ds.map((x, j) => x || j === i)), 1300 + i * 400)] : [])
    return () => ts.forEach(clearTimeout)
  }, [])
  const pct = Math.round((done.filter(Boolean).length / done.length) * 100)
  return (
    <Tile i={1} title={<>Milestones <span {...sx(s.muted)}>{pct}%</span></>}>
      <Bar pct={pct} />
      <ul {...sx(s.demoList, s.below)}>
        {LAUNCH.map(([t, , meta], i) => (
          <li key={t} {...sx(s.plain)}><Check title={t} meta={meta} done={done[i]!} toggle={() => { touched.current = true; setDone((ds) => ds.map((x, j) => (j === i ? !x : x))) }} /></li>
        ))}
      </ul>
    </Tile>
  )
}

// A small board after the app's: drag a card to another column (or click it to send it one column on). It glides
// to its new place from where you let go. Touch scrolls the page, so there a tap moves the card.
const Board = () => {
  const [cards, setCards] = useState(CARDS)
  const [over, setOver] = useState<number | null>(null)
  const [lifted, setLifted] = useState<number | null>(null)
  const root = useRef<HTMLDivElement>(null)
  const drag = useRef<{ x: number; y: number; moved: boolean } | null>(null)
  const dragged = useRef(false)
  const flip = useRef<{ id: number; from?: DOMRect; focus: boolean } | null>(null)
  const glide = (el: HTMLElement, from: DOMRect) => {
    const to = el.getBoundingClientRect()
    if (!calm()) el.animate([{ transform: `translate(${from.left - to.left}px, ${from.top - to.top}px)` }, { transform: "none" }], { duration: 320, easing: EASE })
  }
  // A moved card goes on top of its new column, under a Golden Ticket, as in the app.
  const move = (id: number, col: number, from?: DOMRect) => {
    flip.current = { id, from, focus: !from }
    setCards((cs) => [{ ...cs.find((c) => c.id === id)!, col }, ...cs.filter((c) => c.id !== id)])
  }
  useLayoutEffect(() => {
    const f = flip.current, el = f && root.current?.querySelector<HTMLElement>(`[data-id="${f.id}"]`)
    flip.current = null
    if (!f || !el) return
    if (f.from) glide(el, f.from)
    if (f.focus) el.focus()
  }, [cards])
  const colAt = (x: number, y: number) => {
    const c = document.elementsFromPoint(x, y).find((e) => e instanceof HTMLElement && e.dataset.col)
    return c ? Number((c as HTMLElement).dataset.col) : null
  }
  const down = (e: PE<HTMLButtonElement>) => {
    dragged.current = false
    if (e.pointerType === "touch" || e.button !== 0) return
    drag.current = { x: e.clientX, y: e.clientY, moved: false }
    e.currentTarget.setPointerCapture(e.pointerId)
  }
  const follow = (e: PE<HTMLButtonElement>, id: number, from: number) => {
    const d = drag.current
    if (!d) return
    const dx = e.clientX - d.x, dy = e.clientY - d.y
    if (!d.moved && Math.hypot(dx, dy) < 4) return
    if (!d.moved) { d.moved = true; setLifted(id) }
    e.currentTarget.style.transform = `translate(${dx}px, ${dy}px) rotate(-2deg) scale(1.03)`
    const c = colAt(e.clientX, e.clientY)
    setOver(c === from ? null : c) // only a column it would move to lights up
  }
  const drop = (e: PE<HTMLButtonElement>, id: number, col: number) => {
    const d = drag.current
    drag.current = null
    if (!d?.moved) return
    dragged.current = true
    const el = e.currentTarget, from = el.getBoundingClientRect(), to = colAt(e.clientX, e.clientY)
    el.style.transform = ""
    setOver(null); setLifted(null)
    // Let go over another column: it moves there. Anywhere else: it goes back.
    if (to != null && to !== col) move(id, to, from)
    else glide(el, from)
  }
  const sorted = [...cards].sort((a, b) => Number(!!b.golden) - Number(!!a.golden))
  return (
    <div ref={root} {...sx(s.board)}>
      {COLS.map((name, col) => (
        <section key={name} data-col={col} aria-label={name} {...sx(s.col, over === col && s.colOver)}>
          <h4 {...sx(s.colName)}>{name}</h4>
          {sorted.filter((c) => c.col === col).map((c) => (
            <button key={c.id} type="button" data-id={c.id} aria-label={`${c.title}. Move to ${COLS[(col + 1) % COLS.length]}`}
              onPointerDown={down} onPointerMove={(e) => follow(e, c.id, col)} onPointerUp={(e) => drop(e, c.id, col)}
              onPointerCancel={(e) => { drag.current = null; e.currentTarget.style.transform = ""; setOver(null); setLifted(null) }}
              // A click sends it one column on (Done goes back to Triage). From the keyboard it doesn't glide.
              onClick={(e) => (dragged.current && e.detail ? (dragged.current = false) : move(c.id, (col + 1) % COLS.length, e.detail ? e.currentTarget.getBoundingClientRect() : undefined))}
              {...sx(s.kard, c.golden && s.golden, lifted === c.id && s.lifted)}>
              {c.golden && <span title="Golden Ticket" {...sx(s.star)}>★ </span>}{c.title}
            </button>
          ))}
        </section>
      ))}
    </div>
  )
}

// The Milestones window at full size. Check off anything; the bar and the count follow.
const Milestones = () => {
  const [subs, setSubs] = useState(() => MILESTONES.map((m) => m.subs.map(([, d]) => d as boolean)))
  const [seen, setSeen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  // The bar waits empty until it's on screen, then fills from the left.
  useEffect(() => {
    const el = ref.current
    if (!el || !("IntersectionObserver" in window) || calm()) return setSeen(true)
    const io = new IntersectionObserver((es) => { if (es[0]!.isIntersecting) { setSeen(true); io.disconnect() } }, { threshold: 0.4 })
    io.observe(el)
    return () => io.disconnect()
  }, [])
  const all = subs.flat(), done = all.filter(Boolean).length, pct = Math.round((done / all.length) * 100)
  // As in the app: checking a task checks its subtasks, and a task is done when all of its subtasks are.
  const set = (i: number, j: number | null, v: boolean) => setSubs((ss) => ss.map((row, a) => (a !== i ? row : row.map((x, b) => (j === null || b === j ? v : x)))))
  return (
    <div ref={ref}>
      <p {...sx(s.msOverall)}><span {...sx(s.msPct)}>{pct}%</span><span {...sx(s.msNow)}>done · {done} of {all.length}</span></p>
      <Bar pct={pct} shown={seen ? pct : 0} big />
      <ul {...sx(s.msList)}>
        {MILESTONES.map((m, i) => {
          const row = subs[i]!, n = row.filter(Boolean).length, whole = n === row.length
          return (
            <li key={m.name} {...sx(s.plain)}>
              <Check big title={m.name} done={whole} meta={`${n}/${row.length}`} toggle={() => set(i, null, !whole)} />
              <ul {...sx(s.demoList, s.subs)}>
                {m.subs.map(([t], j) => <li key={t} {...sx(s.plain)}><Check title={t} done={row[j]!} toggle={() => set(i, j, !row[j])} /></li>)}
              </ul>
            </li>
          )
        })}
      </ul>
    </div>
  )
}

const Marketing = () => (
  <>
    <title>Saintsflow: all your work in one place</title>
    <meta name="description" content="Keep each project's posts, milestones, boards, files, chat and dates in one place, so your team always knows what's next." />
    <a href="/signup" {...sx(s.strip)}>Try it free. No card needed. <Arrow /></a>
    <header {...sx(s.wrap)}>
      <div {...sx(s.header)}>
        <div {...sx(s.brand)}>
          <a href="/marketing" {...sx(s.wordmark)}>Saintsflow</a>
          <nav aria-label="Main" {...sx(s.nav)}>
            <a href="#product" {...sx(s.navLink)}>Product</a>
            <a href="#calm" {...sx(s.navLink)}>Quiet hours</a>
            <a href="#progress" {...sx(s.navLink)}>Milestones</a>
            <a href="#less" {...sx(s.navLink)}>What we skipped</a>
          </nav>
        </div>
        <div {...sx(s.headerEnd)}>
          <a href="/signin" {...sx(s.textLink)}>Log in</a>
          <a href="/signup" {...sx(s.pill, s.pillSmall, s.light)}>Sign up</a>
        </div>
      </div>
    </header>

    <main>
      <section {...sx(s.wrap, s.hero)}>
        <h1 {...sx(s.h1, s.enter)}>All your work in one place</h1>
        <p {...sx(s.lede, s.enter, s.delay(90))}>Saintsflow keeps each project's posts, milestones, boards, files and chat together. Everyone can see what's done and what's next.</p>
        <p {...sx(s.ctas, s.enter, s.delay(180))}>
          <a href="/signup" {...sx(s.pill, s.pillLarge, s.dark)}>Try it free</a>
          <a href="#product" {...sx(s.pill, s.pillLarge, s.light)}>See how it works</a>
        </p>
      </section>

      <section aria-label="An example project" {...sx(s.wrap)}>
        <div {...sx(s.demo, s.enter, s.delay(300))}>
          <div {...sx(s.demoHead)}>
            <h2 {...sx(s.demoTitle)}>Website Redesign</h2>
            <p {...sx(s.demoMeta)}>New website for Northwind · Oct 1 → Nov 15 · Maya, Ann, Bob and Dan</p>
          </div>
          <div {...sx(s.demoGrid)}>
            <Tile i={0} title="Posts">
              <ul {...sx(s.demoList)}><Said who="Maya" what="Kickoff: what we're building and why" /><Said who="Bob" what="Idea: skip the CMS" /><Said who="Ann" what="First homepage sketches" /></ul>
            </Tile>
            <LaunchTile />
            <Tile i={2} title="Chat">
              <ul {...sx(s.demoList)}><Said who="Ann" what="The test site is up 🎉" at={1200} /><Said who="Dan" what="Looks great on my phone" at={1900} /><Said mine what="Nice. I'll check the footer" at={2600} /></ul>
            </Tile>
            <Tile i={3} wide title="Board"><Board /></Tile>
            <Tile i={4} title="Calendar">
              <ul {...sx(s.demoList)}><Dated when="Oct 28" what="Design review with Northwind" /><Dated when="Nov 3" what="Weekly call" /><Dated when="Nov 15" what="Launch day" /></ul>
            </Tile>
          </div>
        </div>
        <p {...sx(s.label)}>A made-up project. Go ahead: check things off, drag the cards.</p>
      </section>

      <section {...sx(s.section)}>
        <div id="product" {...sx(s.slab)}>
          <div {...sx(s.wrap)}>
            <div {...sx(s.sectionHead, s.reveal)}>
              <h2 {...sx(s.h2)}>Each project gets its own space</h2>
              <p {...sx(s.sub, s.slabSub)}>No more chat in one app, tasks in another, and choices lost in email. Give a project only the windows it needs, name them, and put them in order. Two chats? Add two.</p>
            </div>
            <dl {...sx(s.tools)}>
              {TOOLS.map(([t, d]) => <div key={t} {...sx(s.tool, s.reveal)}><dt {...sx(s.toolName)}>{t}</dt><dd {...sx(s.toolText)}>{d}</dd></div>)}
            </dl>
          </div>
        </div>
      </section>

      <section id="calm" {...sx(s.wrap, s.section)}>
        <div {...sx(s.split)}>
          <div {...sx(s.reveal)}>
            <h2 {...sx(s.h2)}>Switch off at the end of the day</h2>
            <p {...sx(s.sub)}>Fewer alerts, so you can focus during the day and rest at night.</p>
          </div>
          <dl {...sx(s.cards)}>
            <div {...sx(s.card, s.reveal)}><dt {...sx(s.cardTitle)}>Quiet hours</dt><dd {...sx(s.cardText)}>Pick the hours you work. Outside them, alerts wait for you until you're back.</dd></div>
            <div {...sx(s.card, s.reveal)}><dt {...sx(s.cardTitle)}>Updates</dt><dd {...sx(s.cardText)}>Comments, mentions and new tasks for you, all in one list.</dd></div>
            <div {...sx(s.card, s.reveal)}><dt {...sx(s.cardTitle)}>Remind me later</dt><dd {...sx(s.cardText)}>Send anything back to yourself tomorrow or next week. Then stop thinking about it.</dd></div>
          </dl>
        </div>
      </section>

      <section id="progress" {...sx(s.wrap, s.section)}>
        <div {...sx(s.sectionHead, s.center, s.reveal)}>
          <h2 {...sx(s.h2)}>See how far along it is, no meeting needed</h2>
          <p {...sx(s.sub)}>One bar per project. Split a big task into smaller ones, check them off, and the bar moves. Try it.</p>
        </div>
        <div {...sx(s.tasksCard, s.reveal)}><Milestones /></div>
        <dl {...sx(s.trio)}>
          <div {...sx(s.card, s.reveal)}><dt {...sx(s.cardTitle)}>Progress</dt><dd {...sx(s.cardText)}>Nobody sets it by hand. It counts what's checked off, subtasks included, so it's always true.</dd></div>
          <div {...sx(s.card, s.reveal)}><dt {...sx(s.cardTitle)}>Late work</dt><dd {...sx(s.cardText)}>Anything past its due date shows up first, in orange, so nothing slips by quietly.</dd></div>
          <div {...sx(s.card, s.reveal)}><dt {...sx(s.cardTitle)}>Timeline</dt><dd {...sx(s.cardText)}>See what's happening now, what's next and what's late, across all your projects.</dd></div>
        </dl>
      </section>

      <section>
        <div id="less" {...sx(s.slab)}>
          <div {...sx(s.wrap)}>
            <div {...sx(s.sectionHead, s.reveal)}>
              <h2 {...sx(s.h2)}>What we didn't build</h2>
              <p {...sx(s.sub, s.slabSub)}>More settings means more to manage. So we said no to a few things.</p>
            </div>
            <dl {...sx(s.cuts)}>
              {CUTS.map(([t, d]) => <div key={t} {...sx(s.cut, s.reveal)}><dt {...sx(s.cutName)}>{t}<span aria-hidden="true" {...sx(s.strike)} /></dt><dd {...sx(s.cutWhy)}>{d}</dd></div>)}
            </dl>
          </div>
        </div>
      </section>

      <section {...sx(s.wrap, s.close, s.reveal)}>
        <h2 {...sx(s.h2)}>Start your next project here</h2>
        <p {...sx(s.sub, s.centerP)}>Try it free. No card needed.</p>
        <p {...sx(s.ctas)}>
          <a href="/signup" {...sx(s.pill, s.pillLarge, s.dark)}>Try it free</a>
          <a href="/signin" {...sx(s.pill, s.pillLarge, s.light)}>Log in</a>
        </p>
      </section>
    </main>

    <footer {...sx(s.wrap, s.footer)}>
      <div {...sx(s.footerRow)}>
        <span>Saintsflow</span>
        <p {...sx(s.footerLinks)}>
          <a href="#product" {...sx(s.navLink)}>Product</a>
          <a href="#less" {...sx(s.navLink)}>What we skipped</a>
          <a href="/signin" {...sx(s.navLink)}>Log in</a>
          <a href="/signup" {...sx(s.navLink)}>Sign up</a>
        </p>
      </div>
      <span aria-hidden="true" {...sx(s.giant)}>Saintsflow</span>
    </footer>
  </>
)

export const routes = [
  page("/marketing", Marketing, { pub: true, bare: true }),
  page("/marketting", () => <Navigate to="/marketing" replace />, { pub: true, bare: true }),
]
