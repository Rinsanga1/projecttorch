// The marketing pages (/marketing, and /startups). They stand alone, outside the app chrome: the kargul.studio look at
// full strength (big Geist type, pill buttons, dark rounded slabs, line-art that drifts), showing a real project rather
// than describing one. We're in beta: no pricing anywhere, and no proof we don't have (no logos, ratings or numbers).
import * as stylex from "@stylexjs/stylex"
import { useEffect, useLayoutEffect, useRef, useState, type PointerEvent as PE, type ReactNode } from "react"
import { Navigate } from "react-router"
import { meOrNull } from "../data.ts"
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
  ["An AI chatbot", "You already have one you like. Bring it."],
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
// Milestones as the app shows them: one bar for the whole list, then the tasks, the big ones split into subtasks.
// The bar counts what's checked off, subtasks included, like progressOf in news.ts. Everything here can be clicked.
const MILESTONES = [
  { name: "Homepage design", subs: [["Sketches", true], ["Pick the font", true], ["Sign off on the look", true]] },
  { name: "Build the site", subs: [["Set up hosting", true], ["Page templates", true], ["Contact form", true], ["Redirects", true], ["Footer links", false], ["Speed check", false]] },
  { name: "Launch", subs: [["Launch email", false], ["Tell Northwind", false]] },
] as const
// The demo's Milestones tile: two get checked off a moment after the page loads (unless motion is reduced).
const LAUNCH = [["Pick the font", true, ""], ["Write the homepage text", true, ""], ["Set up redirects", false, "Bob, Oct 25"], ["Sign off on the text", false, "Dan"]] as const
const COLS = ["Triage", "Review", "Done"]
const CARDS: ReadonlyArray<{ id: number; title: string; col: number; golden?: boolean; via?: string }> = [
  { id: 1, title: "Launch email", col: 0, golden: true }, { id: 2, title: "Dark mode", col: 0 },
  { id: 3, title: "404 page", col: 1, via: "Claude" }, { id: 4, title: "Favicon", col: 2 },
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
// After kargul.studio: a live dot that rings, a layer of the drawing that drifts, a card that keeps landing in Review.
const ring = stylex.keyframes({ "0%": { boxShadow: "0 0 0 0 rgba(249, 156, 0, .55)" }, "100%": { boxShadow: "0 0 0 9px rgba(249, 156, 0, 0)" } })
const drift = stylex.keyframes({ to: { transform: "translateY(-12px)" } })
const hop = stylex.keyframes({
  "0%": { transform: "translateY(0)", opacity: 0 }, "8%": { transform: "translateY(0)", opacity: 1 }, "30%": { transform: "translateY(0)" },
  "55%": { transform: "translateY(90px)" }, "88%": { transform: "translateY(90px)", opacity: 1 }, "100%": { transform: "translateY(90px)", opacity: 0 },
})

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

  // The hero's news pill, with a dot that rings.
  news: {
    display: "inline-flex", alignItems: "center", gap: 10, marginBottom: space.s5, paddingBlock: 7, paddingInline: 14,
    borderRadius: radius.pill, backgroundColor: color.sheet, color: color.muted, fontSize: text.sm, fontWeight: 500, textDecoration: "none",
    transitionProperty: "color", transitionDuration: motion.fast, ":hover": { color: { default: null, [media.hover]: color.ink } },
  },
  newsDot: {
    width: 8, height: 8, flexShrink: 0, borderRadius: radius.pill, backgroundColor: color.accent,
    animationName: ring, animationDuration: "1800ms", animationTimingFunction: "ease-out", animationIterationCount: "infinite",
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
  // The drawing: line art on the slab, after kargul.studio's isometric plates.
  iso: { display: "block", width: "100%", maxWidth: 440, marginInline: "auto", color: color.slabInk },
  isoGuide: { stroke: color.slabMuted, opacity: 0.45 },
  isoPlate: { fill: color.slab, stroke: color.slabInk, strokeWidth: 1.25, strokeLinejoin: "round" },
  isoLabel: { fill: color.slabMuted, fontSize: 12, fontWeight: 600, letterSpacing: "0.02em" },
  isoDrift: { animationName: drift, animationDuration: "3600ms", animationTimingFunction: motion.inOut, animationIterationCount: "infinite", animationDirection: "alternate" },
  isoCard: { fill: color.accent, animationName: hop, animationDuration: "5200ms", animationTimingFunction: motion.inOut, animationIterationCount: "infinite" },

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
              <span>{c.golden && <span title="Golden Ticket" {...sx(s.star)}>★ </span>}{c.title}{c.via && <span {...sx(s.via)}>via {c.via}</span>}</span>
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

// The agents section's drawing, after kargul.studio's line art: a board as three plates (Triage, Running, Review), the
// top one drifting, and a card that keeps going from Running to Review. Under reduced motion it rests on Running.
const plate = (y: number) => `200,${y} 340,${y + 70} 200,${y + 140} 60,${y + 70}`
const Handoff = () => (
  <svg viewBox="0 0 400 370" role="img" aria-label="A card moving from Running to Review" {...sx(s.iso)}>
    <g fill="none" strokeDasharray="2 6" {...sx(s.isoGuide)}>
      <line x1="60" y1="70" x2="60" y2="300" /><line x1="340" y1="70" x2="340" y2="300" /><line x1="200" y1="0" x2="200" y2="370" />
    </g>
    {(["Triage", "Running", "Review"] as const).map((name, i) => (
      <g key={name} {...sx(i === 0 && s.isoDrift)}>
        <polygon points={plate(20 + i * 90)} {...sx(s.isoPlate)} />
        <text x="84" y={98 + i * 90} {...sx(s.isoLabel)}>{name}</text>
      </g>
    ))}
    <polygon points="200,166 232,182 200,198 168,182" {...sx(s.isoCard)} />
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
            <a href="/marketing" {...sx(s.wordmark)}>Saintsflow</a>
            <nav aria-label="Main" {...sx(s.nav)}>
              <a href="/marketing#product" {...sx(s.navLink)}>Product</a>
              <a href="/marketing#agents" {...sx(s.navLink)}>Agents</a>
              <a href="/startups" {...sx(s.navLink)}>For startups</a>
              <a href="/marketing#less" {...sx(s.navLink)}>What we skipped</a>
            </nav>
          </div>
          <div {...sx(s.headerEnd)}>
            {me
              ? <a href="/" {...sx(s.pill, s.pillSmall, s.light)}>Go to Saintsflow</a>
              : <><a href="/signin" {...sx(s.textLink)}>Log in</a><a href="/signup" {...sx(s.pill, s.pillSmall, s.light)}>Sign up</a></>}
          </div>
        </div>
      </header>
      <main>{children}</main>
      <footer {...sx(s.wrap, s.footer)}>
        <div {...sx(s.footerRow)}>
          <span>Saintsflow · in beta</span>
          <p {...sx(s.footerLinks)}>
            <a href="/marketing#product" {...sx(s.navLink)}>Product</a>
            <a href="/marketing#agents" {...sx(s.navLink)}>Agents</a>
            <a href="/startups" {...sx(s.navLink)}>For startups</a>
            {me ? <a href="/" {...sx(s.navLink)}>Go to Saintsflow</a> : <><a href="/signin" {...sx(s.navLink)}>Log in</a><a href="/signup" {...sx(s.navLink)}>Sign up</a></>}
          </p>
        </div>
        <span aria-hidden="true" {...sx(s.giant)}>Saintsflow</span>
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
          <p {...sx(s.sub, s.slabSub)}>Saintsflow doesn't come with a chatbot. It works with the one you already use: give it one address, and it works in your projects as you.</p>
          <ul aria-label="Works with" {...sx(s.works)}>
            {AGENTS.map((a, i) => <li key={a} {...sx(s.chip, s.reveal)} style={{ animationRange: `entry ${i * 8}% cover ${30 + i * 8}%` }}>{a}</li>)}
          </ul>
          <div {...sx(s.reveal)} style={{ marginTop: 40 }}><Handoff /></div>
        </div>
        <dl {...sx(s.agentCards)}>
          {AGENT_POINTS.map(([t, d]) => <div key={t} {...sx(s.tool, s.reveal)}><dt {...sx(s.toolName)}>{t}</dt><dd {...sx(s.toolText)}>{d}</dd></div>)}
        </dl>
      </div>
    </div>
  </section>
)

const Marketing = () => (
  <Chrome>
    <title>Saintsflow: we keep your flow state</title>
    <meta name="description" content="Calm project software for small teams and the AI agents that help them. Every project in one place; agents that do the busywork and never ping you." />
    <section {...sx(s.wrap, s.hero)}>
      <a href="#agents" {...sx(s.news, s.enter)}><span aria-hidden="true" {...sx(s.newsDot)} />New: bring your own AI agent <Arrow /></a>
      <h1 {...sx(s.h1, s.enter, s.delay(60))}>We keep your flow state.</h1>
      <p {...sx(s.lede, s.enter, s.delay(140))}>Saintsflow is calm project software for small teams and the AI agents that help them. Every project's posts, board, files and chat in one place. Your agent does the busywork, and never pings you about it.</p>
      <p {...sx(s.ctas, s.enter, s.delay(220))}><Ctas second={["See how it works", "#product"]} /></p>
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

    <Agents />

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
      <h2 {...sx(s.h2)}>Get into the flow</h2>
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
  ["Connect your agent", "Paste Saintsflow's address into Claude, ChatGPT or Cursor and click Allow. Projects it starts come ready to work in."],
  ["Sweep twice a day", "Look at what's waiting in Review: ship it, send it back, or kill it. Then get back to the work only you can do."],
]
const FAQ = [
  ["Do I need an agent to use it?", "No. Saintsflow is a whole project tool on its own: posts, a board, files, chat, a calendar and milestones. Agents are there when you want them."],
  ["Which agents work?", "Anything that connects over MCP, the standard way AI apps plug into other apps: Claude, ChatGPT, Cursor, Claude Code and more. You paste one address and sign in."],
  ["Can an agent see everything?", "Only what you can see, and it can only do what you can do. Choose Read only when you connect it if you'd rather it just looked. Disconnect it any time."],
  ["Is it too early for a project tool?", "If your work lives in chat threads and someone's head, it isn't. Start with one project and see if it sticks."],
  ["What does it cost?", "Nothing while we're in beta. No card needed."],
]

const Startups = () => (
  <Chrome>
    <title>Saintsflow for startups: project management that works with your agents</title>
    <meta name="description" content="Project management for startups that work with AI agents. One calm place for every project, and a built-in place for your agent to hand work back." />
    <section {...sx(s.wrap, s.hero)}>
      <a href="#how" {...sx(s.news, s.enter)}><span aria-hidden="true" {...sx(s.newsDot)} />For startups <Arrow /></a>
      <h1 {...sx(s.h1, s.h1Wide, s.enter, s.delay(60))}>Project management for startups that work with agents</h1>
      <p {...sx(s.lede, s.enter, s.delay(140))}>Small team, lots to do, an agent or two helping. Saintsflow is one calm place to run it all, and to see exactly what your agents did.</p>
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

export const routes = [
  page("/marketing", Marketing, { pub: true, bare: true }),
  page("/marketting", () => <Navigate to="/marketing" replace />, { pub: true, bare: true }),
  page("/startups", Startups, { pub: true, bare: true }),
]
