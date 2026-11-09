// The marketing pages (/marketing, /startups, and the /blog). They stand alone, outside the app chrome: the kargul.studio look at
// full strength (big Geist type, pill buttons, dark rounded slabs, line-art that drifts), showing a real project rather
// than describing one. We're in beta: no pricing anywhere, and no proof we don't have (no logos, ratings or numbers).
import * as stylex from "@stylexjs/stylex"
import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent, type PointerEvent as PE, type ReactNode } from "react"
import { Navigate, useParams } from "react-router"
import { meOrNull } from "../data.ts"
import { sx, useTween } from "../ui/kit.tsx"
import { page } from "../ui/page.tsx"
import { color, media, motion, radius, space, text } from "../ui/tokens.stylex.ts"

const TOOLS = [
  ["Posts", "Share news and ideas. Talk them over right below."],
  ["Compass", "List the goals the project has to reach. Split a big goal into subgoals. The bar fills up as they get done."],
  ["Files", "Keep docs, files and links in folders. Old versions are saved too."],
  ["Chat", "Ask a quick question. Get a quick answer."],
  ["Calendar", "See every date and deadline. Add them to the calendar you already use."],
  ["Boards", "Drag cards across as the work moves. A Golden Ticket keeps one on top. Cards nobody touches close themselves."],
]

// Bring your own agent: what it does here, in the order you'd notice it.
const AGENT_POINTS = [
  ["Connect in a minute", "Paste one address into Claude, ChatGPT or Cursor, sign in, click Allow. It works as you: your projects, nothing more."],
  ["You can always tell", "Everything it does says so: “Maya · via Claude Code”. One click filters activity down to just the agents."],
  ["It hands work back", "Finished cards wait in Review. Ship it, send it back with a note, or kill it."],
  ["It never pings", "Agents don't send notifications. Their work waits for you, so your flow state stays yours."],
]
// Agents people connect today. Names only (no logos): they're what works, not who endorses us.
const AGENTS = ["Claude", "ChatGPT", "Cursor", "Claude Code", "Anything that speaks MCP"]

// ---------- the example project ----------
// Compass as the app shows it: one bar for the whole list, then the goals, the big ones split into subgoals.
// The bar counts what's checked off, subgoals included, like progressOf in news.ts. Everything here can be clicked.
const GOALS = [
  { name: "Homepage design", subs: [["Sketches", true], ["Pick the font", true], ["Sign off on the look", true]] },
  { name: "Build the site", subs: [["Set up hosting", true], ["Page templates", true], ["Contact form", true], ["Redirects", true], ["Footer links", false], ["Speed check", false]] },
  { name: "Launch", subs: [["Launch email", false], ["Tell Northwind", false]] },
] as const
// The demo's Compass tile: two get checked off a moment after the page loads (unless motion is reduced).
const LAUNCH = [["Pick the font", true, ""], ["Write the homepage text", true, ""], ["Set up redirects", false, "Bob, Oct 25"], ["Sign off on the text", false, "Dan"]] as const
const COLS = ["Triage", "Review", "Done"]
const CARDS: ReadonlyArray<{ id: number; title: string; col: number; golden?: boolean; via?: string }> = [
  { id: 1, title: "Launch email", col: 0, golden: true }, { id: 2, title: "Dark mode", col: 0 },
  { id: 3, title: "404 page", col: 1, via: "Claude" }, { id: 5, title: "Footer links", col: 1 }, { id: 4, title: "Favicon", col: 2 },
]
const EASE = "cubic-bezier(.23, 1, .32, 1)"
const calm = () => matchMedia("(prefers-reduced-motion: reduce)").matches

// ---------- motion ----------
// Every element rests in its final state; keyframes only say where it comes from. So under reduced motion (the base
// layer stops all animation), or in a browser without scroll timelines, everything is simply in place.
// Load-time: the hero arrives, then the example project comes alive (goals tick, chat messages arrive).
// Scroll-linked (`SCROLL`): sections rise as they come into view.
const rise = stylex.keyframes({ from: { opacity: 0, transform: "translateY(16px)", filter: "blur(4px)" } })
// The example project is a big surface with a shadow: it rises without the blur (blurring that much is expensive),
// and its tiles settle in after it, a short step each.
const riseSoft = stylex.keyframes({ from: { opacity: 0, transform: "translateY(24px)" } })
const settle = stylex.keyframes({ from: { opacity: 0, transform: "translateY(8px)" } })
const lift = stylex.keyframes({ from: { opacity: 0, transform: "translateY(32px)" } })
const pop = stylex.keyframes({ from: { opacity: 0, transform: "translateY(8px) scale(.96)" } })
const fillIn = stylex.keyframes({ from: { backgroundColor: "transparent" } })
const wipe = stylex.keyframes({ from: { clipPath: "inset(0 100% 0 0)" } })
// The strike-through draws across, left to right, like a pen.
const strikeDraw = stylex.keyframes({ from: { backgroundSize: "0% 1.5px" } })
const surface = stylex.keyframes({ from: { transform: "translateY(45%)" } })
// After kargul.studio: a live dot that rings, and parts of the drawings that drift.
// The ring is a copy of the dot behind it that grows and fades (transform and opacity only, so it never repaints).
const ring = stylex.keyframes({ "0%": { transform: "scale(1)", opacity: 0.55 }, "100%": { transform: "scale(3.25)", opacity: 0 } })
const drift = stylex.keyframes({ to: { transform: "translateY(-12px)" } })

// The hero's drawing: its lines draw themselves in once (each shape has pathLength 1, so one dash is the whole line) while
// the faces fade up; the dots on the arcs march toward the board, slowly; one card keeps hopping from Running to Review.
const draw = stylex.keyframes({ from: { strokeDashoffset: "1", fillOpacity: 0 } })
const march = stylex.keyframes({ to: { strokeDashoffset: "-24" } })
const arcFill = stylex.keyframes({ from: { strokeDasharray: "0 1" } })
// One column across the board is 2.3 units: 60px right and 35px down in the drawing; the lift is one unit, 30px.
const hopAcross = stylex.keyframes({
  "0%": { transform: "translate(0, 0)", opacity: 0 }, "8%": { transform: "translate(0, 0)", opacity: 1 },
  "22%": { transform: "translate(0, -30px)" }, "50%": { transform: "translate(60px, 5px)" }, "62%": { transform: "translate(60px, 35px)" },
  "90%": { transform: "translate(60px, 35px)", opacity: 1 }, "100%": { transform: "translate(60px, 35px)", opacity: 0 },
})

// The drawings' lines are ink mixed into the ground. A drawing on the dark slab swaps both (and its faces) for slab colors.
const artInk = (pct: number) => `color-mix(in srgb, var(--art-ink, ${color.ink}) ${pct}%, var(--art-bg, ${color.ground}))`

const DESKTOP = "@media (min-width: 900px)"
const PHONE = "@media (max-width: 640px)"
const SCROLL = "@supports (animation-timeline: view())"
const s = stylex.create({
  enter: { animationName: rise, animationDuration: "900ms", animationTimingFunction: motion.out, animationFillMode: "both" },
  enterSoft: { animationName: riseSoft, animationDuration: "800ms", animationTimingFunction: motion.out, animationFillMode: "both" },
  settle: { animationName: settle, animationDuration: "500ms", animationTimingFunction: motion.out, animationFillMode: "both" },
  pop: { animationName: pop, animationDuration: "500ms", animationTimingFunction: motion.out, animationFillMode: "both" },
  // A chat line grows from its own side: yours from the right, everyone else's from the left.
  fromLeft: { transformOrigin: "left center" },
  fromRight: { transformOrigin: "right center" },
  delay: (ms: number) => ({ animationDelay: `${ms}ms` }),
  // Held at its first frame (delay included) until the example project is on screen.
  waiting: { animationPlayState: "paused" },
  reveal: {
    animationName: { default: null, [SCROLL]: lift }, animationDuration: { default: null, [SCROLL]: "auto" },
    animationTimeline: { default: null, [SCROLL]: "view()" }, animationRange: { default: null, [SCROLL]: "entry 0% cover 30%" },
    animationTimingFunction: motion.out, animationFillMode: "both",
  },

  wrap: { maxWidth: 1224, marginInline: "auto", paddingInline: { default: space.s4, [DESKTOP]: space.s6 } },
  strip: {
    display: "flex", justifyContent: "center", alignItems: "center", gap: space.s2, paddingBlock: 10, paddingInline: space.s4,
    backgroundColor: color.slab, color: color.slabInk, fontSize: text.sm, fontWeight: 600, textAlign: "center",
    textDecorationLine: { default: "none", ":hover": { default: null, [media.hover]: "underline" } },
  },
  header: { display: "flex", alignItems: "center", justifyContent: "space-between", gap: space.s4, paddingBlock: space.s4 },
  brand: { display: "flex", alignItems: "center", gap: space.s5 },
  wordmark: { fontSize: 22, fontWeight: 750, letterSpacing: "-0.045em", color: color.ink, textDecoration: "none" },
  nav: { display: { default: "none", [DESKTOP]: "flex" }, gap: space.s5, fontSize: text.sm },
  navLink: { color: { default: color.muted, ":hover": { default: null, [media.hover]: color.ink } }, textDecoration: "none" },
  headerEnd: { display: "flex", alignItems: "center", gap: space.s2 },
  textLink: { fontSize: text.sm, fontWeight: 600, color: color.ink, paddingInline: 12, textDecorationLine: { default: "none", ":hover": { default: null, [media.hover]: "underline" } } },
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

  // The hero's drawing. On a phone it stays at a readable size and its edges are cropped (they fade out anyway).
  art: { marginTop: { default: space.s6, [DESKTOP]: space.s7 }, overflowX: "clip" },
  artSvg: { display: "block", width: "max(100%, 760px)", height: "auto", marginInline: "calc(50% - max(50%, 380px))" },
  artGrid: { fill: "none", stroke: artInk(9), strokeWidth: 1 },
  artHatch: { stroke: artInk(22), strokeWidth: 0.75 },
  artGuide: { fill: "none", stroke: artInk(30), strokeWidth: 1, strokeDasharray: "3 4" },
  artFlow: {
    fill: "none", stroke: artInk(45), strokeWidth: 2, strokeLinecap: "round", strokeDasharray: "0 6",
    animationName: march, animationDuration: "2400ms", animationTimingFunction: "linear", animationIterationCount: "infinite",
  },
  artNode: { fill: artInk(45) },
  artFace: { stroke: artInk(26), strokeWidth: 1, strokeLinejoin: "round" },
  artTop: { fill: `var(--art-top, ${color.sheet})` },
  artSide: { fill: `var(--art-side, ${color.tile})` },
  artFront: { fill: `var(--art-front, ${color.ground})` },
  artAccent: { fill: color.accent, stroke: color.accentText },
  artDraw: { strokeDasharray: "1", animationName: draw, animationDuration: "1600ms", animationTimingFunction: motion.inOut, animationFillMode: "both" },
  // The windows' drawings, on the dark slab: the same drawing, recolored, drawn in as the tile scrolls into view.
  toolArt: {
    "--art-ink": color.slabInk, "--art-bg": color.slabTile, "--art-top": `color-mix(in srgb, ${color.slabInk} 8%, ${color.slabTile})`,
    "--art-side": color.slabTile, "--art-front": `color-mix(in srgb, ${color.slab} 50%, ${color.slabTile})`,
    display: "block", marginBlock: `calc(-1 * ${space.s2})`, marginInline: "auto", maxWidth: 340,
    maskImage: "radial-gradient(closest-side, #000 60%, transparent)",
    // Shapes inside an SVG have no box of their own to track, so they follow the drawing's.
    viewTimelineName: "--tool-art",
  },
  artDrawScroll: {
    strokeDasharray: "1",
    animationName: { default: null, [SCROLL]: draw }, animationDuration: { default: null, [SCROLL]: "auto" },
    animationTimeline: { default: null, [SCROLL]: "--tool-art" }, animationRange: { default: null, [SCROLL]: "entry 20% cover 45%" },
    animationTimingFunction: motion.inOut, animationFillMode: "both",
  },
  artArcScroll: {
    fill: "none", stroke: color.accent, strokeWidth: 2.5, strokeLinecap: "round", strokeDasharray: "0.68 1",
    animationName: { default: null, [SCROLL]: arcFill }, animationDuration: { default: null, [SCROLL]: "auto" },
    animationTimeline: { default: null, [SCROLL]: "--tool-art" }, animationRange: { default: null, [SCROLL]: "cover 30% cover 55%" },
    animationTimingFunction: motion.out, animationFillMode: "both",
  },
  artHopLoop: { animationName: hopAcross, animationDuration: "5200ms", animationTimingFunction: motion.inOut, animationIterationCount: "infinite" },
  artArc: {
    fill: "none", stroke: color.accent, strokeWidth: 2.5, strokeLinecap: "round", strokeDasharray: "0.68 1",
    animationName: arcFill, animationDuration: "1400ms", animationDelay: "1600ms", animationTimingFunction: motion.out, animationFillMode: "both",
  },
  artHop: { animationName: hopAcross, animationDuration: "5200ms", animationDelay: "2400ms", animationTimingFunction: motion.inOut, animationIterationCount: "infinite", animationFillMode: "backwards" },

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
  // A goal's row is one button: the whole line checks it off.
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
  struck: {
    textDecorationLine: "none", backgroundImage: "linear-gradient(currentColor, currentColor)", backgroundRepeat: "no-repeat",
    backgroundPosition: "0 55%", backgroundSize: "100% 1.5px",
    animationName: strikeDraw, animationDuration: "300ms", animationDelay: "120ms", animationTimingFunction: motion.out, animationFillMode: "both",
  },
  // The bar's fill slides in from the left (transform only), so its rounded end stays round at any width.
  bar: { display: "block", height: 8, borderRadius: radius.pill, backgroundColor: color.sheet, overflow: "hidden" },
  barBig: { height: 10, backgroundColor: color.tile },
  fill: {
    display: "block", height: "100%", borderRadius: radius.pill, backgroundColor: color.accent,
    transitionProperty: "transform", transitionDuration: { default: "600ms", [media.reduce]: "0s" }, transitionTimingFunction: motion.out,
  },
  board: { display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: space.s2, userSelect: "none" },
  col: {
    // Room for a third card, so a column can open a gap for one more while you drag.
    display: "grid", alignContent: "start", gap: 6, minHeight: 168, padding: 6, borderRadius: radius.lg, backgroundColor: color.sheet,
    transitionProperty: "background-color", transitionDuration: motion.fast,
  },
  colOver: { backgroundColor: color.accentSoft },
  colName: { margin: 0, paddingBlock: 2, paddingInline: 4, fontSize: text.xs, fontWeight: 700, color: color.muted },
  kard: {
    position: "relative", justifyContent: "flex-start", minHeight: 0, paddingBlock: 8, paddingInline: 10, borderRadius: radius.md,
    textAlign: "left", fontSize: text.sm, backgroundColor: { default: color.tile, ":hover": { default: null, [media.hover]: color.tileHover } },
    cursor: "grab", touchAction: "manipulation",
    // `translate` (set as the pointer moves) isn't listed, so the card tracks the pointer exactly; the tilt, the
    // growth and the shadow ease in when it's picked up and out when it's let go.
    transitionProperty: "background-color, transform, rotate, scale, box-shadow", transitionDuration: "160ms", transitionTimingFunction: motion.out,
  },
  golden: { backgroundColor: { default: color.accentSoft, ":hover": { default: null, [media.hover]: color.accentSoft } } },
  star: { color: color.accentText },
  // Picked up: above the rest, tilted, with a shadow under it. No press shrink while it's held.
  lifted: { zIndex: 2, cursor: "grabbing", boxShadow: "0 12px 28px -8px rgba(0,0,0,.28)", rotate: "-2deg", scale: "1.03", transform: "none" },
  // The other cards while one is dragged: they slide aside to open a gap where it would land. When it lands the gap
  // closes at once (translate drops out of the list again) and the glide to the new order takes over.
  shifting: { transitionProperty: "background-color, transform, rotate, scale, box-shadow, translate", transitionDuration: "200ms" },
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
  tools3: { gridTemplateColumns: { default: "1fr", "@media (min-width: 640px)": "1fr 1fr", [DESKTOP]: "repeat(3, 1fr)" } },
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


  // The hero's news pill, with a dot that rings.
  news: {
    display: "inline-flex", alignItems: "center", gap: 10, marginBottom: space.s5, paddingBlock: 7, paddingInline: 14,
    borderRadius: radius.pill, backgroundColor: color.sheet, color: color.muted, fontSize: text.sm, fontWeight: 500, textDecoration: "none",
    transitionProperty: "color", transitionDuration: motion.fast, ":hover": { color: { default: null, [media.hover]: color.ink } },
  },
  newsDot: {
    position: "relative", width: 8, height: 8, flexShrink: 0, borderRadius: radius.pill, backgroundColor: color.accent,
    "::after": {
      content: '""', position: "absolute", inset: 0, borderRadius: radius.pill, backgroundColor: color.accent,
      animationName: ring, animationDuration: "1800ms", animationTimingFunction: motion.out, animationIterationCount: "infinite",
    },
  },
  h1Wide: { maxWidth: "18ch" },
  via: { display: "block", marginTop: 2, fontSize: text.xs, fontWeight: 400, color: color.muted },

  // Bring your own agent: a slab with the drawing on one side and four points on the other.
  agentsGrid: { display: "grid", gridTemplateColumns: { default: "1fr", [DESKTOP]: "5fr 7fr" }, gap: { default: space.s7, [DESKTOP]: space.s8 }, alignItems: "center" },
  agentCards: { display: "grid", gridTemplateColumns: { default: "1fr", "@media (min-width: 640px)": "1fr 1fr" }, gap: space.s3, margin: 0 },
  works: { display: "flex", flexWrap: "wrap", gap: space.s2, marginTop: space.s6, marginBottom: 0, padding: 0, listStyle: "none" },
  chip: {
    paddingBlock: 6, paddingInline: 12, borderRadius: radius.pill, backgroundColor: color.slabTile, color: color.slabInk,
    fontSize: text.sm, fontWeight: 600, borderTopWidth: 0,
  },
  isoDrift: { animationName: drift, animationDuration: "3600ms", animationTimingFunction: motion.inOut, animationIterationCount: "infinite", animationDirection: "alternate" },

  // Startups: three steps, and the questions people ask.
  steps: { display: "grid", gridTemplateColumns: { default: "1fr", [DESKTOP]: "repeat(3, 1fr)" }, gap: space.s3, margin: 0, padding: 0, listStyle: "none" },
  step: { backgroundColor: color.sheet, borderRadius: radius.xl, paddingBlock: space.s6, paddingInline: space.s6, borderTopWidth: 0 },
  stepNo: { display: "block", marginBottom: space.s4, fontSize: "clamp(2.5rem, 2rem + 2vw, 3.5rem)", fontWeight: 750, lineHeight: 1, letterSpacing: "-0.04em", color: color.accent, fontVariantNumeric: "tabular-nums" },
  faq: { display: "grid", gap: space.s2, maxWidth: "48rem", marginInline: "auto" },
  q: { backgroundColor: color.sheet, borderRadius: radius.xl, paddingBlock: space.s5, paddingInline: space.s6 },
  // A whole-row question, not the app's pill-shaped summary.
  qTitle: {
    display: "flex", justifyContent: "space-between", gap: space.s4, width: "100%", padding: 0, borderRadius: 0,
    backgroundColor: { default: "transparent", ":hover": "transparent" }, transform: { default: null, ":active": "none" },
    fontSize: text.lg, fontWeight: 700, letterSpacing: "-0.02em",
  },
  qText: { marginTop: space.s3, marginBottom: 0, fontSize: text.base, lineHeight: 1.6, color: color.muted },

  close: { textAlign: "center", paddingBlock: { default: space.s8, [DESKTOP]: 140 } },
  closeTitle: { maxWidth: "16ch", marginInline: "auto" },

  // The blog: a list of posts, and a post at reading width.
  postList: { display: "grid", gap: space.s3, maxWidth: "48rem", marginInline: "auto", paddingBottom: { default: space.s8, [DESKTOP]: 120 } },
  postCard: {
    display: "grid", gap: space.s2, padding: { default: space.s5, [DESKTOP]: space.s7 }, borderRadius: { default: radius.xl, [DESKTOP]: 32 },
    backgroundColor: { default: color.sheet, ":hover": { default: null, [media.hover]: color.tile } }, color: color.ink, textDecoration: "none",
    transitionProperty: "background-color", transitionDuration: motion.fast,
  },
  postCardTitle: { fontSize: "clamp(1.5rem, 1.1rem + 1.4vw, 2.25rem)", fontWeight: 750, lineHeight: 1.1, letterSpacing: "-0.035em", textWrap: "balance" },
  postCardDek: { fontSize: text.md, lineHeight: 1.55, color: color.muted, textWrap: "pretty" },
  postRead: { display: "inline-flex", alignItems: "center", gap: space.s2, marginTop: space.s2, fontSize: text.sm, fontWeight: 650 },
  postDate: { fontSize: text.sm, color: color.muted },
  post: { maxWidth: "42rem", marginInline: "auto", paddingInline: space.s4, paddingTop: { default: space.s7, [DESKTOP]: 96 }, paddingBottom: { default: space.s8, [DESKTOP]: 120 } },
  postHead: { marginBottom: { default: space.s7, [DESKTOP]: space.s8 } },
  postMeta: { margin: 0, marginBottom: space.s4, fontSize: text.sm, color: color.muted },
  postTitle: { margin: 0, fontSize: "clamp(2.5rem, 1.4rem + 4vw, 4.25rem)", lineHeight: 1, fontWeight: 750, letterSpacing: "-0.04em", textWrap: "balance" },
  postDek: { marginTop: space.s5, marginBottom: 0, fontSize: { default: text.md, [DESKTOP]: "1.25rem" }, lineHeight: 1.5, color: color.muted, textWrap: "pretty" },
  postP: { marginTop: 0, marginBottom: space.s5, maxWidth: "none", fontSize: { default: "1.0625rem", [DESKTOP]: "1.1875rem" }, lineHeight: 1.7, textWrap: "pretty" },
  postH2: { marginTop: { default: space.s7, [DESKTOP]: space.s8 }, marginBottom: space.s4, fontSize: "clamp(1.5rem, 1.15rem + 1.2vw, 2rem)", lineHeight: 1.15, fontWeight: 750, letterSpacing: "-0.03em" },
  pull: {
    marginBlock: { default: space.s6, [DESKTOP]: space.s7 }, marginInline: 0, padding: { default: space.s5, [DESKTOP]: space.s6 }, borderRadius: radius.xl,
    backgroundColor: color.slab, color: color.slabInk, fontSize: "clamp(1.375rem, 1.1rem + 1vw, 1.875rem)", fontWeight: 700, lineHeight: 1.25, letterSpacing: "-0.025em",
  },
  postNext: { marginTop: space.s7 },
  postEnd: { marginTop: space.s8, paddingTop: space.s6, borderTopWidth: 1, borderTopStyle: "solid", borderTopColor: color.line },
  footer: { overflow: "hidden", paddingTop: space.s6 },
  footerRow: {
    display: "flex", flexWrap: "wrap", justifyContent: "space-between", gap: space.s4, paddingBlock: space.s5,
    borderTopWidth: 1, borderTopStyle: "solid", borderTopColor: color.line, fontSize: text.sm, color: color.muted,
  },
  footerLinks: { display: "flex", flexWrap: "wrap", gap: space.s5, margin: 0 },
  giant: {
    // A ghost, edge to edge: a hair off the ground, drawn by a faint outline, running off the right side.
    display: "block", marginTop: space.s6, marginBottom: "-0.2em", fontSize: "20vw", lineHeight: 0.8, fontWeight: 800,
    // Looser than the headlines: outlined letters that touch draw lines through each other.
    marginLeft: "-0.03em", letterSpacing: "-0.015em", userSelect: "none", whiteSpace: "nowrap",
    color: `color-mix(in srgb, ${color.ink} 2.5%, ${color.ground})`, WebkitTextStroke: `1px color-mix(in srgb, ${color.ink} 9%, ${color.ground})`,
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

// A goal you can check off: the box fills, the tick draws, the name gets struck through.
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

/** True once the element is (mostly) on screen; at once under reduced motion or without IntersectionObserver. */
const useSeen = <T extends HTMLElement>(threshold: number) => {
  const ref = useRef<T>(null)
  const [seen, setSeen] = useState(false)
  useEffect(() => {
    const el = ref.current
    if (!el || !("IntersectionObserver" in window) || calm()) return setSeen(true)
    const io = new IntersectionObserver((es) => { if (es[0]!.isIntersecting) { setSeen(true); io.disconnect() } }, { threshold })
    io.observe(el)
    return () => io.disconnect()
  }, [threshold])
  return [ref, seen] as const
}

// `at`: when (ms after the example project comes on screen) a message arrives. Yours sit on the right, in a bubble, as in the app.
const Said = ({ who, what, at, mine, live = true }: { who?: string; what: string; at?: number; mine?: boolean; live?: boolean }) => (
  <li {...sx(s.demoItem, mine && s.mine, at != null && [s.pop, mine ? s.fromRight : s.fromLeft, s.delay(at), !live && s.waiting])}>
    {mine ? <span {...sx(s.bubble)}>{what}</span> : <span><span {...sx(s.who)}>{who}:</span> {what}</span>}
  </li>
)
const Tile = ({ i, title, wide, children }: { i: number; title: ReactNode; wide?: boolean; children: ReactNode }) => (
  <div {...sx(s.demoTile, wide && s.wide, s.settle, s.delay(520 + i * 50))}><h3 {...sx(s.demoTileTitle)}>{title}</h3>{children}</div>
)
const Dated = ({ when, what }: { when: string; what: string }) => <li {...sx(s.demoItem)}><span {...sx(s.who)}>{when}</span><span>{what}</span></li>

// The demo's Compass tile. Once the example project is on screen two goals check themselves off and the bar moves
// with them, unless you got there first.
const LaunchTile = ({ live }: { live: boolean }) => {
  const [done, setDone] = useState(() => LAUNCH.map(([, d]) => d && calm()))
  const touched = useRef(false)
  useEffect(() => {
    if (!live || calm()) return
    const ts = LAUNCH.flatMap(([, d], i) => d ? [setTimeout(() => touched.current || setDone((ds) => ds.map((x, j) => x || j === i)), 1100 + i * 450)] : [])
    return () => ts.forEach(clearTimeout)
  }, [live])
  const pct = Math.round((done.filter(Boolean).length / done.length) * 100)
  const shown = useTween(pct)
  return (
    <Tile i={1} title={<>Compass <span {...sx(s.muted)}>{shown}%</span></>}>
      <Bar pct={pct} />
      <ul {...sx(s.demoList, s.below)}>
        {LAUNCH.map(([t, , meta], i) => (
          <li key={t} {...sx(s.plain)}><Check title={t} meta={meta} done={done[i]!} toggle={() => { touched.current = true; setDone((ds) => ds.map((x, j) => (j === i ? !x : x))) }} /></li>
        ))}
      </ul>
    </Tile>
  )
}

// A small board after the app's. Drag a card up or down its column or into another: the other cards slide aside to
// make room, and when you let go everything glides to its new place. A click sends a card one column on; the arrow
// keys move it too (from the keyboard nothing glides). Touch scrolls the page, so there a tap moves the card.
type Card = (typeof CARDS)[number]
/** A column's cards in board order: a Golden Ticket on top, the rest as they were placed. */
const inCol = (cs: ReadonlyArray<Card>, col: number, without?: number) =>
  cs.filter((c) => c.col === col && c.id !== without).sort((a, b) => Number(!!b.golden) - Number(!!a.golden))
/** Where a card can go in a column's list: nothing goes above a Golden Ticket, and a Golden Ticket stays on top. */
const fit = (list: ReadonlyArray<Card>, card: Card, i: number) => {
  const g = list.filter((c) => c.golden).length
  return Math.min(list.length, card.golden ? Math.min(i, g) : Math.max(i, g))
}
const centre = (r: DOMRect) => [r.left + r.width / 2, r.top + r.height / 2] as const

const Board = () => {
  const [cards, setCards] = useState(CARDS)
  const [lifted, setLifted] = useState<number | null>(null)
  const [slot, setSlot] = useState<{ col: number; index: number } | null>(null)
  const root = useRef<HTMLDivElement>(null)
  const drag = useRef<{ id: number; x: number; y: number; h: number; moved: boolean } | null>(null)
  const dragged = useRef(false)
  // Where each card was on screen just before a move, so each glides from there to its new place.
  const before = useRef<{ rects: Map<number, DOMRect>; focus?: number } | null>(null)
  const cardEls = () => [...(root.current?.querySelectorAll<HTMLElement>("[data-id]") ?? [])]

  /** Put a card at `index` in `col`. `glide`: by pointer, so everything glides; by keyboard it moves at once, keeping focus. */
  const place = (id: number, col: number, index: number, glide: boolean) => {
    before.current = {
      rects: new Map(glide && !calm() ? cardEls().map((e) => [Number(e.dataset.id), e.getBoundingClientRect()] as const) : []),
      focus: glide ? undefined : id,
    }
    setCards((cs) => {
      const card = { ...cs.find((c) => c.id === id)!, col }, list = inCol(cs, col, id)
      list.splice(fit(list, card, index), 0, card)
      return [...cs.filter((c) => c.col !== col && c.id !== id), ...list]
    })
  }
  useLayoutEffect(() => {
    const b = before.current
    before.current = null
    if (!b) return
    for (const el of cardEls()) {
      const from = b.rects.get(Number(el.dataset.id))
      if (!from) continue
      const [fx, fy] = centre(from), [tx, ty] = centre(el.getBoundingClientRect())
      if (Math.abs(fx - tx) + Math.abs(fy - ty) > 1) el.animate([{ transform: `translate(${fx - tx}px, ${fy - ty}px)` }, { transform: "none" }], { duration: 320, easing: EASE })
    }
    if (b.focus != null) root.current?.querySelector<HTMLElement>(`[data-id="${b.focus}"]`)?.focus()
  }, [cards])

  /** The column and place under the pointer. Measured from where the cards sit in the layout (offsetTop ignores
   *  the gap-opening slide), so cards making room never move the target out from under the pointer. */
  const slotAt = (x: number, y: number, id: number) => {
    const sec = document.elementsFromPoint(x, y).find((e): e is HTMLElement => e instanceof HTMLElement && !!e.dataset.col)
    if (!sec) return null
    const col = Number(sec.dataset.col), top = sec.getBoundingClientRect().top - sec.offsetTop
    const index = [...sec.querySelectorAll<HTMLElement>("[data-id]")]
      .filter((e) => Number(e.dataset.id) !== id && top + e.offsetTop + e.offsetHeight / 2 < y).length
    return { col, index: fit(inCol(cards, col, id), cards.find((c) => c.id === id)!, index) }
  }
  const down = (e: PE<HTMLButtonElement>, id: number) => {
    dragged.current = false
    if (e.pointerType === "touch" || e.button !== 0) return
    drag.current = { id, x: e.clientX, y: e.clientY, h: e.currentTarget.offsetHeight, moved: false }
    e.currentTarget.setPointerCapture(e.pointerId)
  }
  const follow = (e: PE<HTMLButtonElement>) => {
    const d = drag.current
    if (!d) return
    const dx = e.clientX - d.x, dy = e.clientY - d.y
    if (!d.moved && Math.hypot(dx, dy) < 4) return
    if (!d.moved) { d.moved = true; setLifted(d.id) }
    e.currentTarget.style.translate = `${dx}px ${dy}px`
    const t = slotAt(e.clientX, e.clientY, d.id)
    setSlot((s) => (s?.col === t?.col && s?.index === t?.index ? s : t))
  }
  const drop = (e: PE<HTMLButtonElement>) => {
    const d = drag.current
    drag.current = null
    if (!d?.moved) return
    dragged.current = true
    const card = cards.find((c) => c.id === d.id)!
    // Let go over a column: it lands where the gap was. Anywhere else: it goes back where it came from.
    const t = slotAt(e.clientX, e.clientY, d.id) ?? { col: card.col, index: inCol(cards, card.col).indexOf(card) }
    place(d.id, t.col, t.index, true) // measures first, with the card still where you let go
    e.currentTarget.style.translate = ""
    setSlot(null); setLifted(null)
  }
  const cancel = (e: PE<HTMLButtonElement>) => { drag.current = null; e.currentTarget.style.translate = ""; setSlot(null); setLifted(null) }

  // While a card is dragged, how far another card slides to open the gap where it would land (and close the one it left).
  const held = lifted == null ? undefined : cards.find((c) => c.id === lifted)
  const shiftOf = (c: Card) => {
    if (!slot || !held || c.id === held.id) return 0
    const gap = (drag.current?.h ?? 0) + 6, i = inCol(cards, c.col, held.id).indexOf(c)
    if (c.col !== held.col) return c.col === slot.col && i >= slot.index ? gap : 0
    const from = inCol(cards, held.col).indexOf(held)
    if (slot.col !== held.col) return i >= from ? -gap : 0
    return i >= from && i < slot.index ? -gap : i >= slot.index && i < from ? gap : 0
  }
  const key = (e: KeyboardEvent<HTMLButtonElement>, c: Card) => {
    const i = inCol(cards, c.col).indexOf(c)
    const to = ({ ArrowUp: [c.col, i - 1], ArrowDown: [c.col, i + 1], ArrowLeft: [c.col - 1, 0], ArrowRight: [c.col + 1, 0] } as Record<string, [number, number]>)[e.key]
    if (!to) return
    e.preventDefault()
    if (to[0] >= 0 && to[0] < COLS.length && to[1] >= 0) place(c.id, to[0], to[1], false)
  }
  return (
    <div ref={root} {...sx(s.board)}>
      {COLS.map((name, col) => (
        // Only a column it would move to lights up.
        <section key={name} data-col={col} aria-label={name} {...sx(s.col, slot?.col === col && held?.col !== col && s.colOver)}>
          <h4 {...sx(s.colName)}>{name}</h4>
          {inCol(cards, col).map((c) => {
            const shift = shiftOf(c)
            return (
              <button key={c.id} type="button" data-id={c.id} aria-label={`${c.title}. Move to ${COLS[(col + 1) % COLS.length]}, or use the arrow keys`}
                onPointerDown={(e) => down(e, c.id)} onPointerMove={follow} onPointerUp={drop} onPointerCancel={cancel} onKeyDown={(e) => key(e, c)}
                // A click sends it one column on, to the top (Done goes back to Triage).
                onClick={(e) => (dragged.current && e.detail ? (dragged.current = false) : place(c.id, (col + 1) % COLS.length, 0, e.detail > 0))}
                style={shift ? { translate: `0 ${shift}px` } : undefined}
                {...sx(s.kard, c.golden && s.golden, lifted === c.id && s.lifted, slot && lifted !== c.id && s.shifting)}>
                <span>{c.golden && <span title="Golden Ticket" {...sx(s.star)}>★ </span>}{c.title}{c.via && <span {...sx(s.via)}>via {c.via}</span>}</span>
              </button>
            )
          })}
        </section>
      ))}
    </div>
  )
}

// The Compass window at full size. Check off anything; the bar and the count follow.
const Goals = () => {
  const [subs, setSubs] = useState(() => GOALS.map((m) => m.subs.map(([, d]) => d as boolean)))
  // The bar waits empty until it's on screen, then fills from the left, and the count climbs with it.
  const [ref, seen] = useSeen<HTMLDivElement>(0.4)
  const all = subs.flat(), done = all.filter(Boolean).length, pct = Math.round((done / all.length) * 100)
  const shown = useTween(seen ? pct : 0)
  // As in the app: checking a goal checks its subgoals, and a goal is done when all of its subgoals are.
  const set = (i: number, j: number | null, v: boolean) => setSubs((ss) => ss.map((row, a) => (a !== i ? row : row.map((x, b) => (j === null || b === j ? v : x)))))
  return (
    <div ref={ref}>
      <p {...sx(s.msOverall)}><span {...sx(s.msPct)}>{shown}%</span><span {...sx(s.msNow)}>done · {done} of {all.length}</span></p>
      <Bar pct={pct} shown={seen ? pct : 0} big />
      <ul {...sx(s.msList)}>
        {GOALS.map((m, i) => {
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

// The hero's drawing, after kargul.studio's: a whole project as isometric line art on a grid floor that fades into
// the page. The board in the middle; files, chat and the calendar around it, each sending work along a dotted arc;
// Compass's dial filling up in front. `iso` turns a point on the floor (x, y) at height z into a point in the drawing.
type V3 = [x: number, y: number, z: number]
const U = 30
const iso = (x: number, y: number, z = 0): [number, number] => [600 + (x - y) * U * 0.866, 330 + (x + y) * U * 0.5 - z * U]
const pts = (...ps: V3[]) => ps.map((p) => iso(...p).map((n) => n.toFixed(1)).join(",")).join(" ")
// A dotted arc from one point to another, bowed up by `lift` px.
const arc = (a: V3, b: V3, lift: number) => {
  const [x1, y1] = iso(...a), [x2, y2] = iso(...b)
  return `M${x1.toFixed(1)} ${y1.toFixed(1)} Q${((x1 + x2) / 2).toFixed(1)} ${(Math.min(y1, y2) - lift).toFixed(1)} ${x2.toFixed(1)} ${y2.toFixed(1)}`
}
const FLOOR = Array.from({ length: 29 }, (_, i) => i - 14)
  .map((i) => `M${pts([-14, i, 0])}L${pts([14, i, 0])}M${pts([i, -14, 0])}L${pts([i, 14, 0])}`).join("")

/** A box sitting at `at`, `size` units wide (x), deep (y) and tall (z): the three faces you can see. `paper`: all three light. */
const Box = ({ at: [x, y, z], size: [w, d, h], hatch, accent, paper }: { at: V3; size: V3; hatch?: boolean; accent?: boolean; paper?: boolean }) => (
  <g>
    <polygon pathLength={1} points={pts([x + w, y, z], [x + w, y + d, z], [x + w, y + d, z + h], [x + w, y, z + h])} {...sx(s.artFace, s.artSide, paper && s.artTop, accent && s.artAccent)} />
    <polygon pathLength={1} points={pts([x, y + d, z], [x + w, y + d, z], [x + w, y + d, z + h], [x, y + d, z + h])} {...sx(s.artFace, s.artFront, paper && s.artTop, accent && s.artAccent)}
      style={hatch ? { fill: "url(#art-hatch)" } : undefined} />
    <polygon pathLength={1} points={pts([x, y, z + h], [x + w, y, z + h], [x + w, y + d, z + h], [x, y + d, z + h])} {...sx(s.artFace, s.artTop, accent && s.artAccent)} />
  </g>
)
/** A drum standing at (x, y): chat, `r` units round and `h` tall. */
const Drum = ({ x, y, r, h }: { x: number; y: number; r: number; h: number }) => {
  const [bx, by] = iso(x, y), [, ty] = iso(x, y, h), rx = r * U * 1.2247, ry = r * U * 0.7071
  return (
    <g>
      <path pathLength={1} d={`M${bx - rx} ${ty}L${bx - rx} ${by}A${rx} ${ry} 0 0 0 ${bx + rx} ${by}L${bx + rx} ${ty}`} {...sx(s.artFace, s.artSide)} />
      <ellipse pathLength={1} cx={bx} cy={ty} rx={rx} ry={ry} {...sx(s.artFace, s.artTop)} />
    </g>
  )
}
const Dot = ({ at }: { at: V3 }) => { const [x, y] = iso(...at); return <rect x={x - 3} y={y - 3} width={6} height={6} transform={`rotate(45 ${x} ${y})`} {...sx(s.artNode)} /> }

const PLATES = [-2.7, -0.4, 1.9] // Triage, Running, Review
const Scene = () => {
  const [dx, dy] = iso(5.5, 3.5), dial = { rx: 1.7 * U * 1.2247, ry: 1.7 * U * 0.7071 }
  return (
    <div aria-hidden="true" {...sx(s.art)}>
      <svg viewBox="0 50 1200 540" {...sx(s.artSvg)}>
        <defs>
          <pattern id="art-hatch" width="4" height="4" patternUnits="userSpaceOnUse"><line x1="0" y1="0" x2="0" y2="4" {...sx(s.artHatch)} /></pattern>
          <radialGradient id="art-fade"><stop offset="0.35" stopColor="#fff" /><stop offset="1" stopColor="#000" /></radialGradient>
          <mask id="art-floor"><rect x="0" y="50" width="1200" height="540" fill="url(#art-fade)" /></mask>
        </defs>
        <g mask="url(#art-floor)" {...sx(s.settle, s.delay(200))}>
          <path d={FLOOR} {...sx(s.artGrid)} />
          <line x1="0" y1="330" x2="1200" y2="330" {...sx(s.artGuide)} />
        </g>
        <path d={arc([-8, 8, 0], [8, -8, 0], 300)} {...sx(s.artGuide, s.settle, s.delay(1300))} />

        {/* Behind the board: chat and the calendar. */}
        <g {...sx(s.artDraw, s.delay(500))}><Drum x={-5} y={-7} r={1.1} h={1.5} /></g>
        <g {...sx(s.artDraw, s.delay(600))}>
          <Box at={[4.4, -7.4, 0]} size={[2.6, 2.6, 1.4]} hatch />
          {[0.65, 1.3, 1.95].map((t) => <polyline key={t} pathLength={1} points={pts([4.4 + t, -7.4, 1.4], [4.4 + t, -4.8, 1.4])} {...sx(s.artFace)} fill="none" />)}
        </g>

        {/* The board: a slab with three columns on it, and their cards. */}
        <g {...sx(s.artDraw, s.delay(350))}>
          <Box at={[-3, -2.5, 0]} size={[7, 5, 0.35]} hatch />
          {PLATES.map((x) => <Box key={x} at={[x, -2, 0.35]} size={[2, 4, 0.12]} />)}
          <Box at={[-2.45, -1.7, 0.47]} size={[1.5, 0.9, 0.12]} /><Box at={[-2.45, -0.5, 0.47]} size={[1.5, 0.9, 0.12]} />
          <Box at={[-0.15, -0.5, 0.47]} size={[1.5, 0.9, 0.12]} /><Box at={[2.15, -0.5, 0.47]} size={[1.5, 0.9, 0.12]} />
        </g>
        <path d={arc([0.6, -1.25, 0.6], [2.9, -1.25, 0.6], 42)} {...sx(s.artGuide, s.settle, s.delay(1600))} />
        <g {...sx(s.artHop)}><g {...sx(s.artDraw, s.delay(900))}><Box at={[-0.15, -1.7, 0.47]} size={[1.5, 0.9, 0.12]} accent /></g></g>

        {/* Files, stacked to the left; the top sheet floats. */}
        <g {...sx(s.artDraw, s.delay(700))}>
          <Box at={[-9.4, -0.6, 0]} size={[2.4, 1.8, 0.25]} /><Box at={[-9.3, -0.7, 0.35]} size={[2.4, 1.8, 0.25]} />
        </g>
        <g {...sx(s.isoDrift)}><g {...sx(s.artDraw, s.delay(800))}><Box at={[-9.2, -0.8, 1]} size={[2.4, 1.8, 0.25]} /></g></g>

        {/* Compass, in front: a dial that fills to where the project is, inside a dashed square. */}
        <polygon points={pts([3.3, 1.3, 0], [7.7, 1.3, 0], [7.7, 5.7, 0], [3.3, 5.7, 0])} {...sx(s.artGuide, s.settle, s.delay(900))} fill="none" />
        <g {...sx(s.artDraw, s.delay(1000))}>
          <ellipse pathLength={1} cx={dx} cy={dy} rx={dial.rx} ry={dial.ry} {...sx(s.artFace, s.artTop)} />
          <ellipse pathLength={1} cx={dx} cy={dy} rx={dial.rx * 0.55} ry={dial.ry * 0.55} {...sx(s.artFace, s.artFront)} />
        </g>
        <ellipse pathLength={1} cx={dx} cy={dy} rx={dial.rx * 0.78} ry={dial.ry * 0.78} {...sx(s.artArc)} />

        {/* Small blocks hanging in the air, drifting out of step with each other. */}
        {([[-0.8, 10.8, 2, -900], [10, -7.2, 2.4, -2200], [1, -8.5, 3.4, -400]] as const).map(([x, y, z, phase]) => (
          <g key={x} {...sx(s.isoDrift)} style={{ animationDelay: `${phase}ms` }}>
            <g {...sx(s.artDraw, s.delay(1100))}><Box at={[x, y, z]} size={[0.6, 0.6, 0.6]} /></g>
          </g>
        ))}

        {/* Work flowing to the board: from files, chat and the calendar. */}
        <g {...sx(s.settle, s.delay(1500))}>
          {([[[-7.9, 0.2, 1.1], [-2, 0.3, 0.6], 88], [[-5, -7, 1.5], [-1.6, -1.6, 0.6], 75], [[5.7, -6.1, 1.4], [3.6, -1.6, 0.6], 62]] as const).map(([a, b, lift]) => (
            <g key={a[0]}><path d={arc([...a], [...b], lift)} {...sx(s.artFlow)} /><Dot at={[...a]} /><Dot at={[...b]} /></g>
          ))}
        </g>
      </svg>
    </div>
  )
}

// The project windows and the agent points, one small drawing each, after kargul.studio's service tiles. Orange marks the one thing that
// matters in each: the answer in Chat, the due day, how far along Compass is, the card heading to Review.
const line = (a: V3, b: V3) => <polyline pathLength={1} points={pts(a, b)} fill="none" {...sx(s.artFace)} />
const shadow = (x: number, y: number, w: number, d: number) => <polygon points={pts([x, y, 0], [x + w, y, 0], [x + w, y + d, 0], [x, y + d, 0])} {...sx(s.artGuide)} />
const TOOL_ART: Record<string, () => ReactNode> = {
  Posts: () => (
    <>
      <g {...sx(s.artDrawScroll)}><Box at={[-1.7, -1.1, 0]} size={[3.2, 2.4, 0.1]} /><Box at={[-1.6, -1.2, 0.35]} size={[3.2, 2.4, 0.1]} /></g>
      <g {...sx(s.isoDrift)}>
        <g {...sx(s.artDrawScroll)}>
          <Box at={[-1.5, -1.3, 0.75]} size={[3.2, 2.4, 0.1]} />
          {[0, 1, 2].map((i) => <g key={i}>{line([-1.1, -0.8 + i * 0.55, 0.85], [1.2 - i * 0.7, -0.8 + i * 0.55, 0.85])}</g>)}
        </g>
      </g>
    </>
  ),
  Compass: () => {
    const [cx, cy] = iso(0, 0, 0.25), rx = 2.1 * U * 1.2247, ry = 2.1 * U * 0.7071
    return (
      <>
        {shadow(-2.7, -2.7, 5.4, 5.4)}
        <g {...sx(s.artDrawScroll)}>
          <Drum x={0} y={0} r={2.1} h={0.25} />
          <ellipse pathLength={1} cx={cx} cy={cy} rx={rx * 0.5} ry={ry * 0.5} {...sx(s.artFace, s.artFront)} />
        </g>
        <ellipse pathLength={1} cx={cx} cy={cy} rx={rx * 0.75} ry={ry * 0.75} {...sx(s.artArcScroll)} />
        {([[-2.7, -2.7], [2.7, -2.7], [2.7, 2.7], [-2.7, 2.7]] as const).map(([x, y]) => <Dot key={`${x}${y}`} at={[x, y, 0]} />)}
      </>
    )
  },
  // A folder with its old versions standing in it, the newest one lifting out.
  Files: () => (
    <>
      <g {...sx(s.artDrawScroll)}>
        <Box at={[-1.8, -1.2, 0]} size={[3.6, 2.4, 0.9]} /><Box at={[-1.8, -1.2, 0.9]} size={[1.2, 0.4, 0.15]} />
        <Box at={[-1.3, -0.9, 0.6]} size={[2.4, 0.06, 1.1]} paper /><Box at={[-1.3, -0.4, 0.6]} size={[2.4, 0.06, 1.1]} paper />
      </g>
      <g {...sx(s.isoDrift)}><g {...sx(s.artDrawScroll)}><Box at={[-1.3, 0.1, 0.9]} size={[2.4, 0.06, 1.1]} paper /></g></g>
    </>
  ),
  // A question, and the answer floating up out of it.
  Chat: () => (
    <>
      {shadow(-2.4, -0.3, 2.2, 1.3)}{shadow(0.1, -1.6, 2.2, 1.3)}
      <g {...sx(s.artDrawScroll)}><Box at={[-2.4, -0.3, 0.6]} size={[2.2, 1.3, 0.12]} /></g>
      <g {...sx(s.isoDrift)}><g {...sx(s.artDrawScroll)}><Box at={[0.1, -1.6, 1.6]} size={[2.2, 1.3, 0.12]} accent /></g></g>
      <path d={arc([-1.3, 0.35, 0.72], [1.2, -0.95, 1.72], 30)} {...sx(s.artFlow)} /><Dot at={[-1.3, 0.35, 0.72]} />
    </>
  ),
  Calendar: () => (
    <>
      <g {...sx(s.artDrawScroll)}>
        <Box at={[-2, -2, 0]} size={[4, 4, 0.35]} />
        {[-1, 0, 1].map((t) => <g key={t}>{line([t, -2, 0.35], [t, 2, 0.35])}{line([-2, t, 0.35], [2, t, 0.35])}</g>)}
      </g>
      <g {...sx(s.isoDrift)}><g {...sx(s.artDrawScroll)}><Box at={[1.08, 0.08, 0.45]} size={[0.84, 0.84, 0.12]} accent /></g></g>
    </>
  ),
  Boards: () => (
    <>
      <g {...sx(s.artDrawScroll)}>
        {[-3.4, -1.1, 1.2].map((x) => <Box key={x} at={[x, -1.6, 0]} size={[2, 3.2, 0.12]} />)}
        <Box at={[-3.15, -1.3, 0.12]} size={[1.5, 0.8, 0.1]} /><Box at={[-3.15, -0.2, 0.12]} size={[1.5, 0.8, 0.1]} /><Box at={[1.45, -0.2, 0.12]} size={[1.5, 0.8, 0.1]} />
      </g>
      <g {...sx(s.artHopLoop)}><g {...sx(s.artDrawScroll)}><Box at={[-0.85, -1.3, 0.12]} size={[1.5, 0.8, 0.1]} accent /></g></g>
    </>
  ),

  // Bring your own agent. Your agent (the drum) plugged into your projects: dots run along the cable to an orange socket.
  "Connect in a minute": () => (
    <>
      <g {...sx(s.artDrawScroll)}>
        <Drum x={-2.2} y={0.6} r={0.9} h={1.2} />
        <Box at={[0.4, -1.8, 0]} size={[2.4, 2.4, 0.3]} /><Box at={[1.2, -1, 0.3]} size={[0.8, 0.8, 0.1]} accent />
      </g>
      <path d={arc([-2.2, 0.6, 1.2], [1.6, -0.6, 0.4], 40)} {...sx(s.artFlow)} /><Dot at={[-2.2, 0.6, 1.2]} />
    </>
  ),
  // Filtered down to the agent's work: the rest are dashed outlines; the one left wears its orange "via" label.
  "You can always tell": () => (
    <>
      {[-3.2, -1.6, 1.6].map((x) => <g key={x}>{shadow(x, -0.4, 1.4, 0.9)}</g>)}
      <g {...sx(s.artDrawScroll)}><Box at={[0, -0.4, 0]} size={[1.4, 0.9, 0.1]} /></g>
      <path d={`M${pts([0.7, 0.05, 0.1])}L${pts([0.7, -0.375, 0.8])}`} {...sx(s.artGuide)} />
      <g {...sx(s.isoDrift)}><g {...sx(s.artDrawScroll)}><Box at={[0.2, -0.4, 0.8]} size={[1, 0.05, 0.45]} accent /></g></g>
    </>
  ),
  // Running and Review, and the finished card crossing over.
  "It hands work back": () => (
    <>
      <g {...sx(s.artDrawScroll)}>
        <Box at={[-2.4, -1.6, 0]} size={[2, 3.2, 0.12]} /><Box at={[-0.1, -1.6, 0]} size={[2, 3.2, 0.12]} />
        <Box at={[-2.15, -0.2, 0.12]} size={[1.5, 0.8, 0.1]} /><Box at={[0.15, -0.2, 0.12]} size={[1.5, 0.8, 0.1]} />
      </g>
      <g {...sx(s.artHopLoop)}><g {...sx(s.artDrawScroll)}><Box at={[-2.15, -1.3, 0.12]} size={[1.5, 0.8, 0.1]} accent /></g></g>
    </>
  ),
  // Your phone lies dark (the ring over it stays dashed: no ping), while the agents' work piles up in a tray for later.
  "It never pings": () => {
    const [rx, ry] = iso(-1.95, -0.1, 1.1)
    return (
      <>
        <g {...sx(s.artDrawScroll)}>
          <Box at={[-2.6, -1.4, 0]} size={[1.3, 2.6, 0.15]} />
          <polygon pathLength={1} points={pts([-2.5, -1.2, 0.15], [-1.4, -1.2, 0.15], [-1.4, 1, 0.15], [-2.5, 1, 0.15])} {...sx(s.artFace, s.artFront)} />
          <Box at={[0.2, -1.2, 0]} size={[2.4, 2, 0.45]} />
          <Box at={[0.4, -1, 0.45]} size={[2, 1.6, 0.06]} paper /><Box at={[0.45, -1.05, 0.55]} size={[2, 1.6, 0.06]} paper />
        </g>
        <ellipse cx={rx} cy={ry} rx={U * 0.9} ry={U * 0.52} {...sx(s.artGuide)} />
        <g {...sx(s.isoDrift)}><g {...sx(s.artDrawScroll)}><Box at={[0.5, -1.1, 0.75]} size={[2, 1.6, 0.06]} accent /></g></g>
      </>
    )
  },
}
const ToolArt = ({ name }: { name: string }) => (
  <svg viewBox="430 230 340 190" aria-hidden="true" {...sx(s.toolArt)}>
    <path d={FLOOR} {...sx(s.artGrid)} />
    {TOOL_ART[name]?.()}
  </svg>
)

/** The strip, header and footer both pages share. Signed in, they offer the way back in, not Log in / Sign up. */
const Chrome = ({ children }: { children: ReactNode }) => {
  const me = meOrNull()
  return (
    <>
      <a href={me ? "/" : "/signup"} {...sx(s.strip)}>{me ? "You're signed in. Go to your projects" : "We're in beta: it's free, no card needed. Try it"} <Arrow /></a>
      <header {...sx(s.wrap)}>
        <div {...sx(s.header)}>
          <div {...sx(s.brand)}>
            <a href="/marketing" {...sx(s.wordmark)}>ProjectTorch</a>
            <nav aria-label="Main" {...sx(s.nav)}>
              <a href="/marketing#product" {...sx(s.navLink)}>Product</a>
              <a href="/marketing#agents" {...sx(s.navLink)}>Agents</a>
              <a href="/startups" {...sx(s.navLink)}>For startups</a>
              <a href="/blog" {...sx(s.navLink)}>Blog</a>
            </nav>
          </div>
          <div {...sx(s.headerEnd)}>
            {me
              ? <a href="/" {...sx(s.pill, s.pillSmall, s.light)}>Go to ProjectTorch</a>
              : <><a href="/signin" {...sx(s.textLink)}>Log in</a><a href="/signup" {...sx(s.pill, s.pillSmall, s.light)}>Sign up</a></>}
          </div>
        </div>
      </header>
      <main>{children}</main>
      <footer {...sx(s.footer)}>
        <div {...sx(s.wrap)}>
          <div {...sx(s.footerRow)}>
            <span>ProjectTorch · in beta</span>
            <p {...sx(s.footerLinks)}>
              <a href="/marketing#product" {...sx(s.navLink)}>Product</a>
              <a href="/marketing#agents" {...sx(s.navLink)}>Agents</a>
              <a href="/startups" {...sx(s.navLink)}>For startups</a>
              <a href="/blog" {...sx(s.navLink)}>Blog</a>
              {me ? <a href="/" {...sx(s.navLink)}>Go to ProjectTorch</a> : <><a href="/signin" {...sx(s.navLink)}>Log in</a><a href="/signup" {...sx(s.navLink)}>Sign up</a></>}
            </p>
          </div>
        </div>
        <span aria-hidden="true" {...sx(s.giant)}>ProjectTorch</span>
      </footer>
    </>
  )
}

/** The pair of buttons under a headline: try it (or, signed in, go back to it), and a second, quieter way on. */
const Ctas = ({ second }: { second: [label: string, href: string] }) => {
  const me = meOrNull()
  return (
    <>
      {me ? <a href="/" {...sx(s.pill, s.pillLarge, s.dark)}>Go to your projects</a> : <a href="/signup" {...sx(s.pill, s.pillLarge, s.dark)}>Try it free</a>}
      <a href={second[1]} {...sx(s.pill, s.pillLarge, s.light)}>{second[0]}</a>
    </>
  )
}

/** Bring your own agent: the drawing, what works, and the four things you'd notice. */
const Agents = () => (
  <section>
    <div id="agents" {...sx(s.slab)}>
      <div {...sx(s.wrap, s.agentsGrid)}>
        <div {...sx(s.reveal)}>
          <h2 {...sx(s.h2)}>Bring your own agent</h2>
          <p {...sx(s.sub, s.slabSub)}>ProjectTorch doesn't come with a chatbot. It works with the one you already use: give it one address, and it works in your projects as you.</p>
          <ul aria-label="Works with" {...sx(s.works)}>
            {AGENTS.map((a, i) => <li key={a} {...sx(s.chip, s.reveal)} style={stagger(i, 8)}>{a}</li>)}
          </ul>
        </div>
        <dl {...sx(s.agentCards)}>
          {AGENT_POINTS.map(([t, d], i) => <div key={t} {...sx(s.tool, s.reveal)} style={stagger(i % 2)}><dt {...sx(s.toolName)}>{t}</dt><dd {...sx(s.toolText)}><ToolArt name={t!} />{d}</dd></div>)}
        </dl>
      </div>
    </div>
  </section>
)

// The example project. It comes alive (chat arrives, two goals tick) once most of it is on screen, not on a timer
// from page load: on a laptop it starts below the fold, and a show nobody sees is wasted.
const Demo = () => {
  const [ref, live] = useSeen<HTMLDivElement>(0.35)
  return (
    <section aria-label="An example project" {...sx(s.wrap)}>
      <div ref={ref} {...sx(s.demo, s.enterSoft, s.delay(300))}>
        <div {...sx(s.demoHead)}>
          <h2 {...sx(s.demoTitle)}>Website Redesign</h2>
          <p {...sx(s.demoMeta)}>New website for Northwind · Oct 1 → Nov 15 · Maya, Ann, Bob and Dan</p>
        </div>
        <div {...sx(s.demoGrid)}>
          <Tile i={0} title="Posts">
            <ul {...sx(s.demoList)}><Said who="Maya" what="Kickoff: what we're building and why" /><Said who="Bob" what="Idea: skip the CMS" /><Said who="Ann" what="First homepage sketches" /></ul>
          </Tile>
          <LaunchTile live={live} />
          <Tile i={2} title="Chat">
            <ul {...sx(s.demoList)}><Said who="Ann" what="The test site is up 🎉" at={1000} live={live} /><Said who="Dan" what="Looks great on my phone" at={1600} live={live} /><Said mine what="Nice. I'll check the footer" at={2200} live={live} /></ul>
          </Tile>
          <Tile i={3} wide title="Board"><Board /></Tile>
          <Tile i={4} title="Calendar">
            <ul {...sx(s.demoList)}><Dated when="Oct 28" what="Design review with Northwind" /><Dated when="Nov 3" what="Weekly call" /><Dated when="Nov 15" what="Launch day" /></ul>
          </Tile>
        </div>
      </div>
      <p {...sx(s.label)}>A made-up project. Go ahead: check things off, drag the cards.</p>
    </section>
  )
}

// Cards side by side rise one after another as you scroll: each starts a little later in the scroll than the one before.
const stagger = (i: number, step = 6) => ({ animationRange: `entry ${i * step}% cover ${30 + i * step}%` })

const Marketing = () => (
  <Chrome>
    <title>ProjectTorch: a tool for getting things done</title>
    <meta name="description" content="A tool for getting things done, with your team and your AI agents. Hand off the work, ship what comes back. Every project in one place." />
    <section {...sx(s.wrap, s.hero)}>
      <a href="#agents" {...sx(s.news, s.enter)}><span aria-hidden="true" {...sx(s.newsDot)} />Works with Claude, ChatGPT and Cursor <Arrow /></a>
      <h1 {...sx(s.h1, s.enter, s.delay(60))}>A tool for getting things done.</h1>
      <p {...sx(s.lede, s.enter, s.delay(140))}>ProjectTorch is where you, your team and your agents get the work done. Connect the agent you already use and hand it a card. It does the work in your projects, as you, and puts each finished card in Review for you to ship, send back or kill. Posts, files, chat and the calendar sit right beside it.</p>
      <p {...sx(s.ctas, s.enter, s.delay(220))}><Ctas second={["See how it works", "#agents"]} /></p>
      <Scene />
    </section>

    <Demo />

    <Agents />

    <section {...sx(s.section)}>
      <div id="product" {...sx(s.slab)}>
        <div {...sx(s.wrap)}>
          <div {...sx(s.sectionHead, s.reveal)}>
            <h2 {...sx(s.h2)}>Each project gets its own space</h2>
            <p {...sx(s.sub, s.slabSub)}>No more chat in one app, tasks in another, and choices lost in email. Give a project only the windows it needs, name them, and put them in order. Two chats? Add two.</p>
          </div>
          <dl {...sx(s.tools, s.tools3)}>
            {TOOLS.map(([t, d], i) => <div key={t} {...sx(s.tool, s.reveal)} style={stagger(i % 3)}><dt {...sx(s.toolName)}>{t}</dt><dd {...sx(s.toolText)}><ToolArt name={t!} />{d}</dd></div>)}
          </dl>
        </div>
      </div>
    </section>

    <section id="calm" {...sx(s.wrap, s.section)}>
      <div {...sx(s.split)}>
        <div {...sx(s.reveal)}>
          <h2 {...sx(s.h2)}>Switch off at the end of the day</h2>
          <p {...sx(s.sub)}>Fewer alerts, so you can focus during the day and rest at night. Your agents keep working; they just don't tap you on the shoulder.</p>
        </div>
        <dl {...sx(s.cards)}>
          <div {...sx(s.card, s.reveal)}><dt {...sx(s.cardTitle)}>Quiet hours</dt><dd {...sx(s.cardText)}>Pick the hours you work. Outside them, alerts wait for you until you're back.</dd></div>
          <div {...sx(s.card, s.reveal)}><dt {...sx(s.cardTitle)}>Waiting for you</dt><dd {...sx(s.cardText)}>What your agents finish lands on Home, oldest first. Look at it when it suits you.</dd></div>
          <div {...sx(s.card, s.reveal)}><dt {...sx(s.cardTitle)}>Remind me later</dt><dd {...sx(s.cardText)}>Send anything back to yourself tomorrow or next week. Then stop thinking about it.</dd></div>
        </dl>
      </div>
    </section>

    <section id="progress" {...sx(s.wrap, s.section)}>
      <div {...sx(s.sectionHead, s.center, s.reveal)}>
        <h2 {...sx(s.h2)}>See how far along it is, no meeting needed</h2>
        <p {...sx(s.sub)}>One bar per project. Split a big goal into subgoals, check them off, and the bar moves. Try it.</p>
      </div>
      <div {...sx(s.tasksCard, s.reveal)}><Goals /></div>
      <dl {...sx(s.trio)}>
        <div {...sx(s.card, s.reveal)}><dt {...sx(s.cardTitle)}>Progress</dt><dd {...sx(s.cardText)}>Nobody sets it by hand. It counts what's checked off, subgoals included, so it's always true.</dd></div>
        <div {...sx(s.card, s.reveal)} style={stagger(1)}><dt {...sx(s.cardTitle)}>Late work</dt><dd {...sx(s.cardText)}>Anything past its due date shows up first, in orange, so nothing slips by quietly.</dd></div>
        <div {...sx(s.card, s.reveal)} style={stagger(2)}><dt {...sx(s.cardTitle)}>Timeline</dt><dd {...sx(s.cardText)}>See what's happening now, what's next and what's late, across all your projects.</dd></div>
      </dl>
    </section>

    <section {...sx(s.wrap, s.close, s.reveal)}>
      <h2 {...sx(s.h2)}>Put your agents to work</h2>
      <p {...sx(s.sub, s.centerP)}>Free while we're in beta. No card needed.</p>
      <p {...sx(s.ctas)}><Ctas second={["For startups", "/startups"]} /></p>
    </section>
  </Chrome>
)

// ---------- /startups ----------
// After Pipedrive's industry pages (hero, what it is, features, setup, questions), minus the proof we don't have.

const FOR_STARTUPS = [
  ["Bring your own agent", "Connect Claude, ChatGPT or Cursor in a minute. It works in your projects as you, and can do what you can do."],
  ["A handoff built in", "Every board has Review. Your agent's finished work waits there for you: ship it, send it back, or kill it."],
  ["One home per project", "Posts, a board, files, chat and a calendar, together. No more hunting across five apps for one decision."],
  ["Quiet by default", "Agents never ping. Quiet hours hold your alerts until you're back. Focus is the whole point."],
  ["Progress that counts itself", "Check things off and the bar moves. Nobody spends Friday updating a status report."],
  ["Clients see only what you share", "Invite a client to a project and choose what they see. The rest stays between you."],
]
const STEPS = [
  ["Make a project", "Give it a name and the people on it. Add the windows it needs: a board, posts, files, chat."],
  ["Connect your agent", "Paste ProjectTorch's address into Claude, ChatGPT or Cursor and click Allow. Projects it starts come ready to work in."],
  ["Sweep twice a day", "Look at what's waiting in Review: ship it, send it back, or kill it. Then get back to the work only you can do."],
]
const FAQ = [
  ["Do I need an agent to use it?", "No. ProjectTorch is a whole project tool on its own: posts, a board, files, chat, a calendar and Compass for the project's goals. Agents are there when you want them."],
  ["Which agents work?", "Anything that connects over MCP, the standard way AI apps plug into other apps: Claude, ChatGPT, Cursor, Claude Code and more. You paste one address and sign in."],
  ["Can an agent see everything?", "Only what you can see, and it can only do what you can do. Choose Read only when you connect it if you'd rather it just looked. Disconnect it any time."],
  ["Is it too early for a project tool?", "If your work lives in chat threads and someone's head, it isn't. Start with one project and see if it sticks."],
  ["What does it cost?", "Nothing while we're in beta. No card needed."],
]

const Startups = () => (
  <Chrome>
    <title>ProjectTorch for startups: project management that works with your agents</title>
    <meta name="description" content="Project management for startups that work with AI agents. One calm place for every project, and a built-in place for your agent to hand work back." />
    <section {...sx(s.wrap, s.hero)}>
      <a href="#how" {...sx(s.news, s.enter)}><span aria-hidden="true" {...sx(s.newsDot)} />For startups <Arrow /></a>
      <h1 {...sx(s.h1, s.h1Wide, s.enter, s.delay(60))}>Project management for startups that work with agents</h1>
      <p {...sx(s.lede, s.enter, s.delay(140))}>Small team, lots to do, an agent or two helping. ProjectTorch is one calm place to run it all, and to see exactly what your agents did.</p>
      <p {...sx(s.ctas, s.enter, s.delay(220))}><Ctas second={["How it works", "#how"]} /></p>
    </section>

    <section {...sx(s.wrap, s.section)}>
      <div {...sx(s.sectionHead, s.center, s.reveal)}>
        <h2 {...sx(s.h2)}>What it is</h2>
        <p {...sx(s.sub)}>Project software for a small team and the AI agents that help it. Every project gets one home. Your agent works in it as you, marks everything it does, and hands finished work back for you to check. Nothing pings you unless a person needs you.</p>
      </div>
    </section>

    <section>
      <div {...sx(s.slab)}>
        <div {...sx(s.wrap)}>
          <div {...sx(s.sectionHead, s.reveal)}>
            <h2 {...sx(s.h2)}>Built for a small team and its agents</h2>
            <p {...sx(s.sub, s.slabSub)}>Everything a startup needs to keep projects moving, and nothing it has to babysit.</p>
          </div>
          <dl {...sx(s.tools, s.tools3)}>
            {FOR_STARTUPS.map(([t, d]) => <div key={t} {...sx(s.tool, s.reveal)}><dt {...sx(s.toolName)}>{t}</dt><dd {...sx(s.toolText)}>{d}</dd></div>)}
          </dl>
        </div>
      </div>
    </section>

    <section id="how" {...sx(s.wrap, s.section)}>
      <div {...sx(s.sectionHead, s.center, s.reveal)}>
        <h2 {...sx(s.h2)}>Set up in three steps</h2>
        <p {...sx(s.sub)}>About ten minutes, most of it naming your first project.</p>
      </div>
      <ol {...sx(s.steps)}>
        {STEPS.map(([t, d], i) => (
          <li key={t} {...sx(s.step, s.reveal)}><span aria-hidden="true" {...sx(s.stepNo)}>{i + 1}</span><b {...sx(s.cardTitle)}>{t}</b><p {...sx(s.cardText)}>{d}</p></li>
        ))}
      </ol>
    </section>

    <Agents />

    <section {...sx(s.wrap, s.section)}>
      <div {...sx(s.sectionHead, s.center, s.reveal)}><h2 {...sx(s.h2)}>Questions startups ask</h2></div>
      <div {...sx(s.faq)}>
        {FAQ.map(([q, a]) => (
          <details key={q} {...sx(s.q, s.reveal)}><summary {...sx(s.qTitle)}>{q}</summary><p {...sx(s.qText)}>{a}</p></details>
        ))}
      </div>
    </section>

    <section {...sx(s.wrap, s.close, s.reveal)}>
      <h2 {...sx(s.h2, s.closeTitle)}>Spend your time on the work only you can do</h2>
      <p {...sx(s.sub, s.centerP)}>Free while we're in beta. No card needed.</p>
      <p {...sx(s.ctas)}><Ctas second={["See the whole product", "/marketing"]} /></p>
    </section>
  </Chrome>
)

// ---------- /blog ----------
// Posts are written here, as pages. Opinions, not announcements: no names, no numbers we can't stand behind.

/** `eyebrow`: the small pill over the title. `blurb`: what the blog's list says about it. */
type Post = { slug: string; eyebrow?: string; title: string; dek: string; blurb: string; date: string; body: () => ReactNode }

const P = ({ children }: { children: ReactNode }) => <p {...sx(s.postP)}>{children}</p>
const H = ({ children }: { children: ReactNode }) => <h2 {...sx(s.postH2)}>{children}</h2>
const Pull = ({ children }: { children: ReactNode }) => <blockquote {...sx(s.pull)}>{children}</blockquote>

const POSTS: ReadonlyArray<Post> = [
  {
    slug: "your-agent-doesnt-need-a-seat",
    title: "Your agent doesn't need a seat",
    dek: "Project software was built to count people. The work changed. Here's what we built instead.",
    blurb: "Project software was built to count people. The work changed. Here's what we built instead.",
    date: "October 23, 2026",
    body: () => (
      <>
        <P>Something changed on your projects this year, and you probably noticed it before your project tool did. A lot of the work isn't done by people anymore. The first draft of the release notes. The research for the pitch. The triage of last week's bug reports. Your agent did those, somewhere between your morning coffee and your first meeting.</P>
        <P>And then the work went… where, exactly? Into a chat window. Into a file on someone's laptop. Into a thread nobody will find in a month. The agent was fast. The handoff was a mess.</P>

        <H>Built to count people</H>
        <P>Most project software was designed around one idea: count the people. Price by the person. Build a dashboard so a manager can watch the people. Send a notification every time a person moves something, so the other people know.</P>
        <P>That made a kind of sense when every piece of work had a person behind it. It makes a lot less sense when half the work is done by something that never gets tired, never takes a vacation, and doesn't need to be watched to get things done.</P>

        <H>The new coworker you can rent</H>
        <P>The industry has noticed, and the answer has mostly been the same: sell you a new coworker. It lives inside their app. It has a name and a little avatar. It bills by the credit, or by a higher tier, and it only works there. Bring your own? Well, there's an add-on for that.</P>
        <P>Meanwhile there's a chatbot in every corner of the screen, summarizing things that were already short, and suggesting things you didn't ask for.</P>
        <Pull>We didn't build an AI. You already have one you like.</Pull>
        <P>You picked yours. Maybe it's Claude, maybe ChatGPT, maybe whatever lives in your editor. It knows how you write. It's where you already think out loud. The last thing you need is a second one that only works in one app.</P>

        <H>Bring the one you have</H>
        <P>So ProjectTorch works the other way around. Paste one address into your agent, sign in, click Allow. From then on it works in your projects as you: the same projects you can see, and only what you're allowed to do. It doesn't get its own login, its own seat, or its own little avatar. It works for you, so it works as you.</P>
        <P>But "as you" can't mean "invisibly". So everything it touches says so: <b>Maya · via Claude Code</b>. On the post, on the card, on the comment, in the activity. One click shows you just the agent's work. Nobody has to wonder who wrote that.</P>

        <H>Making things got cheap. Deciding didn't.</H>
        <P>Here's what we think most tools are missing. An agent can make ten drafts before lunch. Making things is the cheap part now. The expensive part, the part that's still yours, is deciding: is this good? Is this done? Is this what we meant?</P>
        <P>So every board in ProjectTorch has a column called Review. When your agent finishes something, it ticks its steps, leaves one note about what it did, and puts the card there. It shows up on your Home under <b>Waiting for you</b>, oldest first. You give it one of three answers: <b>Ship it</b>, <b>Send it back</b> with what should change, or <b>Kill it</b>.</P>
        <P>That's the whole ritual. Look twice a day, decide, and get back to the work only you can do. The tool's job is to make that moment calm and quick, not to give you another dashboard to stare at.</P>

        <H>The quiet part</H>
        <P>Agents don't sleep. That's their whole appeal. It's also a problem, if every card they move turns into a notification on your phone at 11pm.</P>
        <P>So agents in ProjectTorch don't ping anyone. Ever. Their work goes into the project and waits. The only thing that gets through is a person who actually needs you: an @mention, a direct message. Everything else can wait for you to look.</P>
        <Pull>We keep your flow state. Yes, that's the pun. We're keeping it.</Pull>
        <P>A project tool should make it easier to stop thinking about work, not harder. That was true before agents. It's twice as true now, when the work never stops on its own.</P>

        <H>A first project that's ready</H>
        <P>When your agent starts a project, it comes ready to work in: a board with Triage, Running, Mine and Review, and a short set of house rules pinned to the top. The agent reads the rules before it does anything. You can change them. You probably will. But nobody has to spend an afternoon setting up a workflow before the first piece of work can land.</P>

        <H>What we're not doing</H>
        <P>We're not counting your agents as people. We're not renting you a coworker. We're not putting a chatbot in the corner of every screen. And we're not going to buzz your phone because something finished at 3am.</P>
        <P>We're building a calm place for a small team and the agents that help it. One home per project. A name on everything. A place for the work to come back to you. That's it, and we think that's plenty.</P>
        <P>ProjectTorch is in beta, and it's free while it is. Bring your agent. We'll keep the rest quiet.</P>
      </>
    ),
  },
]

const BlogIndex = () => (
  <Chrome>
    <title>Blog · ProjectTorch</title>
    <meta name="description" content="Notes on calm project software, working with agents, and keeping your flow state." />
    <section {...sx(s.wrap, s.hero)}>
      <h1 {...sx(s.h1, s.enter)}>Blog</h1>
      <p {...sx(s.lede, s.enter, s.delay(80))}>Notes on calm project software, working with agents, and keeping your flow state.</p>
    </section>
    <section {...sx(s.wrap, s.postList)}>
      {POSTS.map((p, i) => (
        <a key={p.slug} href={`/blog/${p.slug}`} {...sx(s.postCard, s.enter, s.delay(160 + i * 60))}>
          <small {...sx(s.postDate)}>{p.date}</small>
          <span {...sx(s.postCardTitle)}>{p.title}</span>
          <span {...sx(s.postCardDek)}>{p.blurb}</span>
          <span {...sx(s.postRead)}>Read it <Arrow /></span>
        </a>
      ))}
    </section>
  </Chrome>
)

const BlogPost = () => {
  const slug = useParams().slug
  const post = POSTS.find((p) => p.slug === slug)
  if (!post) return <Navigate to="/blog" replace />
  return (
    <Chrome>
      <title>{`${post.title} · ProjectTorch`}</title>
      <meta name="description" content={post.dek} />
      <article {...sx(s.post)}>
        <header {...sx(s.postHead)}>
          {post.eyebrow && <p {...sx(s.enter)}><span {...sx(s.news)}><span aria-hidden="true" {...sx(s.newsDot)} />{post.eyebrow}</span></p>}
          <p {...sx(s.postMeta, s.enter)}><a href="/blog" {...sx(s.navLink)}>Blog</a> · {post.date}</p>
          <h1 {...sx(s.postTitle, s.enter, s.delay(60))}>{post.title}</h1>
          <p {...sx(s.postDek, s.enter, s.delay(120))}>{post.dek}</p>
        </header>
        <div {...sx(s.enter, s.delay(200))}>{post.body()}</div>
        <footer {...sx(s.postEnd)}>
          <p {...sx(s.ctas)}><Ctas second={["See how it works", "/marketing#agents"]} /></p>
          {[POSTS[(POSTS.indexOf(post) + 1) % POSTS.length]!].filter((p) => p !== post).map((p) => (
            <a key={p.slug} href={`/blog/${p.slug}`} {...sx(s.postCard, s.postNext)}>
              <small {...sx(s.postDate)}>Read next</small>
              <span {...sx(s.postCardTitle)}>{p.title}</span>
              <span {...sx(s.postCardDek)}>{p.blurb}</span>
            </a>
          ))}
        </footer>
      </article>
    </Chrome>
  )
}

export const routes = [
  page("/marketing", Marketing, { pub: true, bare: true }),
  page("/startups", Startups, { pub: true, bare: true }),
  page("/blog", BlogIndex, { pub: true, bare: true }),
  page("/blog/:slug", BlogPost, { pub: true, bare: true }),
]
