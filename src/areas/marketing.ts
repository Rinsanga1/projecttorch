// The marketing page. Stands alone, outside the app chrome: the kargul.studio look at full strength
// (big Geist type, pill buttons, dark rounded slabs), showing a real project rather than describing one.
import * as stylex from "@stylexjs/stylex"
import { Effect } from "effect"
import { HttpServerResponse } from "effect/http"
import { html, raw } from "../lib/html.ts"
import { pubGet, redirect } from "../lib/web.ts"
import { headTags, hill, sx, theme } from "../lib/ui.ts"
import { color, media, motion, radius, space, text } from "../lib/tokens.stylex.ts"

const TOOLS = [
  ["Posts", "Share news and ideas. Talk them over right below."],
  ["Tasks", "Make a list. Give each task a person and a date. Check it off when it's done."],
  ["Files", "Keep docs, files and links in folders. Old versions are saved too."],
  ["Chat", "Ask a quick question. Get a quick answer."],
  ["Calendar", "See every date and deadline. Add them to the calendar you already use."],
  ["Team questions", "Ask the team the same thing each day or week. The answers come in on their own."],
  ["Boards", "Move cards from column to column as the work moves along."],
  ["Progress", "See which work is still being worked out and which is nearly done."],
]

const CUTS = [
  ["Gantt charts", "Plans change. A chart of the future is mostly a guess."],
  ["Custom fields", "A task needs a name, a person, a date and some notes. That's it."],
  ["Read receipts", "No one does good work while they feel watched."],
  ["Online dots", "It's fine to be away."],
  ["Sprints and points", "Counting points is not the same as getting work done."],
  ["Automation builders", "Most teams don't need them. The few who do can hook up their own tools."],
]

// ---------- the hill ----------
// Two cubic curves make the hill. Each dot sits partway along it and, when scrolled into view, travels there
// from the bottom-left along the curve itself (SMIL animateMotion on a path relative to where the dot rests,
// so without JS or with reduced motion the dot is simply in place).
const { UP, DOWN, head, curve } = hill
const DOTS = [
  { label: "Build", note: "working it out", path: [head(UP, 0.58)] },
  { label: "Design", note: "getting it done", path: [UP, head(DOWN, 0.5)] },
] as const

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

  body: { margin: 0, backgroundColor: color.ground },
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
  demoGrid: { display: "grid", gridTemplateColumns: { default: "1fr", "@media (min-width: 640px)": "1fr 1fr", [DESKTOP]: "repeat(3, 1fr)" }, gap: space.s3 },
  demoTile: { backgroundColor: color.tile, borderRadius: radius.xl, padding: space.s5, minHeight: { default: 0, "@media (min-width: 640px)": 190 } },
  demoTileTitle: { margin: 0, marginBottom: space.s3, fontSize: text.base, fontWeight: 650, letterSpacing: "-0.015em" },
  demoList: { margin: 0, padding: 0, listStyle: "none", fontSize: text.sm, display: "grid", gap: 9 },
  demoItem: { padding: 0, borderTopWidth: 0, display: "flex", alignItems: "center", gap: 9, color: color.ink },
  who: { fontWeight: 600 },
  muted: { color: color.muted },
  box: {
    width: 16, height: 16, flexShrink: 0, borderRadius: 5, borderWidth: 1.5, borderStyle: "solid", borderColor: color.control,
    display: "inline-flex", alignItems: "center", justifyContent: "center", color: color.onAccent,
  },
  boxDone: { backgroundColor: color.accent, borderColor: color.accent },
  ticking: { animationName: fillIn, animationDuration: "300ms", animationTimingFunction: motion.out, animationFillMode: "both" },
  tickDraw: { display: "block", animationName: wipe, animationDuration: "350ms", animationTimingFunction: motion.out, animationFillMode: "both" },
  struck: { animationName: strikeIn, animationDuration: "400ms", animationTimingFunction: motion.out, animationFillMode: "both" },
  stage: { fontSize: 10.5, fontWeight: 700, letterSpacing: "0.04em", textTransform: "uppercase", paddingBlock: 4, paddingInline: 8, borderRadius: radius.pill, backgroundColor: color.sheet },
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

  hillCard: { backgroundColor: color.sheet, borderRadius: { default: radius.xl, [DESKTOP]: 32 }, padding: { default: space.s4, [DESKTOP]: space.s7 }, marginBottom: space.s3 },
  hill: { display: "block", width: "100%", height: "auto", overflow: "visible" },
  hillLine: { fill: "none", stroke: color.ink, strokeWidth: 2 },
  hillDivide: { stroke: color.control, strokeWidth: 1, strokeDasharray: "3 5" },
  hillBase: { stroke: color.line, strokeWidth: 1 },
  hillSide: { fill: color.muted, fontSize: { default: 13, [PHONE]: 24 }, fontWeight: 500 },
  dot: { fill: color.accent, stroke: color.sheet, strokeWidth: 3 },
  dotLabel: { fill: color.ink, fontSize: { default: 14, [PHONE]: 26 }, fontWeight: 650 },
  dotNote: { fill: color.muted, fontSize: 13, display: { default: "inline", [PHONE]: "none" } },
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

const arrow = raw(`<svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true"><path d="M2 7h10M8 3l4 4-4 4" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>`)
const tick = (at: number) => html`<svg width="10" height="10" viewBox="0 0 12 12" aria-hidden="true"${sx(s.tickDraw, s.delay(at + 120))}><path d="M2.5 6.2 5 8.6l4.5-5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>`

// `at`: when (ms after load) a done to-do gets checked off, or a message arrives.
const todo = (title: string, at: number | null, meta = "") =>
  html`<li${sx(s.demoItem)}><span${sx(s.box, at != null && [s.boxDone, s.ticking, s.delay(at)])}>${at != null ? tick(at) : ""}</span><span${sx(at != null && s.muted)}>${at != null ? html`<s${sx(s.struck, s.delay(at + 250))}>${title}</s>` : title}${meta ? html` <span${sx(s.muted)}>${meta}</span>` : ""}</span></li>`
const said = (who: string, what: string, at?: number) =>
  html`<li${sx(s.demoItem, at != null && [s.pop, s.delay(at)])}><span><span${sx(s.who)}>${who}:</span> ${what}</span></li>`
const tile = (i: number, title: string, items: unknown) =>
  html`<div${sx(s.demoTile, s.enter, s.delay(450 + i * 60))}><h3${sx(s.demoTileTitle)}>${title}</h3><ul${sx(s.demoList)}>${items}</ul></div>`
const dated = (when: string, what: string) => html`<li${sx(s.demoItem)}><span${sx(s.who)}>${when}</span><span>${what}</span></li>`

const hillChart = () => {
  const dots = DOTS.map((d) => {
    const end = d.path.at(-1)![3]
    const [x, y] = end
    const right = x > 300
    return html`<g transform="translate(${x.toFixed(1)} ${y.toFixed(1)})"><g>
      <animateMotion class="climb" begin="indefinite" dur="1.4s" fill="freeze" calcMode="spline" keyTimes="0;1" keySplines=".22 1 .36 1" path="${curve(d.path, end)}"/>
      <circle r="9"${sx(s.dot)}/>
      <text x="${right ? 16 : -16}" y="-14" text-anchor="${right ? "start" : "end"}"${sx(s.dotLabel)}>${d.label}</text>
      <text x="${right ? 16 : -16}" y="4" text-anchor="${right ? "start" : "end"}"${sx(s.dotNote)}>${d.note}</text>
    </g></g>`
  })
  return html`<svg viewBox="-20 0 640 260" role="img" aria-label="Progress: Build is still being worked out, Design is getting done"${sx(s.hill)} id="hill">
    <line x1="0" y1="210" x2="600" y2="210"${sx(s.hillBase)}/>
    <line x1="300" y1="30" x2="300" y2="210"${sx(s.hillDivide)}/>
    <path d="${curve([UP, DOWN])}" pathLength="1"${sx(s.hillLine)}/>
    <text x="150" y="245" text-anchor="middle"${sx(s.hillSide)}>Working it out</text>
    <text x="450" y="245" text-anchor="middle"${sx(s.hillSide)}>Getting it done</text>
    ${dots}
  </svg>`
}

// Built on first request: the stylesheet URL needs every module's StyleX rules collected first.
let cached: string | null = null
const page = () => (cached ??= html`<!doctype html>
<html lang="en"${theme()}>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Saintsflow: all your work in one place</title>
<meta name="description" content="Keep each project's posts, tasks, files, chat and dates in one place, so your team always knows what's next.">
${headTags()}
</head>
<body${sx(s.body)}>
<a href="/signup"${sx(s.strip)}>Try it free. No card needed. ${arrow}</a>
<header${sx(s.wrap)}>
  <div${sx(s.header)}>
    <div${sx(s.brand)}>
      <a href="/marketing"${sx(s.wordmark)}>Saintsflow</a>
      <nav aria-label="Main"${sx(s.nav)}>
        <a href="#product"${sx(s.navLink)}>Product</a>
        <a href="#calm"${sx(s.navLink)}>Quiet hours</a>
        <a href="#progress"${sx(s.navLink)}>Progress</a>
        <a href="#less"${sx(s.navLink)}>What we skipped</a>
      </nav>
    </div>
    <div${sx(s.headerEnd)}>
      <a href="/signin"${sx(s.textLink)}>Log in</a>
      <a href="/signup"${sx(s.pill, s.pillSmall, s.light)}>Sign up</a>
    </div>
  </div>
</header>

<main>
<section${sx(s.wrap, s.hero)}>
  <h1${sx(s.h1, s.enter)}>All your work in one place</h1>
  <p${sx(s.lede, s.enter, s.delay(90))}>Saintsflow keeps each project's posts, tasks, files, chat and dates together. Everyone can see what's done and what's next.</p>
  <p${sx(s.ctas, s.enter, s.delay(180))}>
    <a href="/signup"${sx(s.pill, s.pillLarge, s.dark)}>Try it free</a>
    <a href="#product"${sx(s.pill, s.pillLarge, s.light)}>See how it works</a>
  </p>
</section>

<section aria-label="An example project"${sx(s.wrap)}>
  <div${sx(s.demo, s.enter, s.delay(300))}>
    <div${sx(s.demoHead)}>
      <h2${sx(s.demoTitle)}>Website Redesign</h2>
      <p${sx(s.demoMeta)}>New website for Northwind · Oct 1 → Nov 15 · Maya, Ann, Bob and Dan</p>
    </div>
    <div${sx(s.demoGrid)}>
      ${tile(0, "Posts", html`
        ${said("Maya", "Kickoff: what we're building and why")}${said("Bob", "Idea: skip the CMS")}${said("Ann", "First homepage sketches")}`)}
      ${tile(1, "Tasks: Launch list", html`
        ${todo("Pick the font", 1300)}${todo("Write the homepage text", 1700)}${todo("Set up redirects", null, "Bob, Oct 25")}${todo("Sign off on the text", null, "Dan")}`)}
      ${tile(2, "Progress", html`
        <li${sx(s.demoItem)}>Build <span${sx(s.stage)}>working it out</span></li><li${sx(s.demoItem)}>Design <span${sx(s.stage)}>getting it done</span></li>`)}
      ${tile(3, "Chat", html`
        ${said("Ann", "The test site is up 🎉", 1200)}${said("Dan", "Looks great on my phone", 1900)}${said("Bob", "@Ann can you check the footer?", 2600)}`)}
      ${tile(4, "Calendar", html`
        ${dated("Oct 28", "Design review with Northwind")}${dated("Nov 3", "Weekly call")}${dated("Nov 15", "Launch day")}`)}
      ${tile(5, "Team questions", html`
        <li${sx(s.demoItem, s.muted)}>What did you get done today?</li>${said("Ann", "Laid out the pricing page")}${said("Bob", "Redirects for the old blog")}`)}
    </div>
  </div>
  <p${sx(s.label)}>A made-up project, to show how it looks.</p>
</section>

<section${sx(s.section)}>
<div id="product"${sx(s.slab)}>
  <div${sx(s.wrap)}>
    <div${sx(s.sectionHead, s.reveal)}>
      <h2${sx(s.h2)}>Each project gets its own space</h2>
      <p${sx(s.sub, s.slabSub)}>No more chat in one app, tasks in another, and choices lost in email. Each project keeps it all together, so everyone sees the same thing.</p>
    </div>
    <dl${sx(s.tools)}>
      ${TOOLS.map(([t, d]) => html`<div${sx(s.tool, s.reveal)}><dt${sx(s.toolName)}>${t}</dt><dd${sx(s.toolText)}>${d}</dd></div>`)}
    </dl>
  </div>
</div>
</section>

<section id="calm"${sx(s.wrap, s.section)}>
  <div${sx(s.split)}>
    <div${sx(s.reveal)}>
      <h2${sx(s.h2)}>Switch off at the end of the day</h2>
      <p${sx(s.sub)}>Fewer alerts, so you can focus during the day and rest at night.</p>
    </div>
    <dl${sx(s.cards)}>
      <div${sx(s.card, s.reveal)}><dt${sx(s.cardTitle)}>Quiet hours</dt><dd${sx(s.cardText)}>Pick the hours you work. Outside them, alerts wait for you until you're back.</dd></div>
      <div${sx(s.card, s.reveal)}><dt${sx(s.cardTitle)}>Updates</dt><dd${sx(s.cardText)}>Comments, mentions and new tasks for you, all in one list.</dd></div>
      <div${sx(s.card, s.reveal)}><dt${sx(s.cardTitle)}>Remind me later</dt><dd${sx(s.cardText)}>Send anything back to yourself tomorrow or next week. Then stop thinking about it.</dd></div>
    </dl>
  </div>
</section>

<section id="progress"${sx(s.wrap, s.section)}>
  <div${sx(s.sectionHead, s.center, s.reveal)}>
    <h2${sx(s.h2)}>See how work is going, no meeting needed</h2>
    <p${sx(s.sub)}>Updates come to you, from the people doing the work.</p>
  </div>
  <div${sx(s.hillCard, s.reveal)}>${hillChart()}</div>
  <dl${sx(s.trio)}>
    <div${sx(s.card, s.reveal)}><dt${sx(s.cardTitle)}>Progress</dt><dd${sx(s.cardText)}>Each task list sits on the hill. Going up means still working it out. Going down means getting it done.</dd></div>
    <div${sx(s.card, s.reveal)}><dt${sx(s.cardTitle)}>Team questions</dt><dd${sx(s.cardText)}>Ask the same question every day or week. People can answer by email, too.</dd></div>
    <div${sx(s.card, s.reveal)}><dt${sx(s.cardTitle)}>Timeline</dt><dd${sx(s.cardText)}>See what's happening now, what's next and what's late, across all your projects.</dd></div>
  </dl>
</section>

<section>
<div id="less"${sx(s.slab)}>
  <div${sx(s.wrap)}>
    <div${sx(s.sectionHead, s.reveal)}>
      <h2${sx(s.h2)}>What we didn't build</h2>
      <p${sx(s.sub, s.slabSub)}>More settings means more to manage. So we said no to a few things.</p>
    </div>
    <dl${sx(s.cuts)}>
      ${CUTS.map(([t, d]) => html`<div${sx(s.cut, s.reveal)}><dt${sx(s.cutName)}>${t}<span aria-hidden="true"${sx(s.strike)}></span></dt><dd${sx(s.cutWhy)}>${d}</dd></div>`)}
    </dl>
  </div>
</div>
</section>

<section${sx(s.wrap, s.close, s.reveal)}>
  <h2${sx(s.h2)}>Start your next project here</h2>
  <p${sx(s.sub, s.centerP)}>Try it free. No card needed.</p>
  <p${sx(s.ctas)}>
    <a href="/signup"${sx(s.pill, s.pillLarge, s.dark)}>Try it free</a>
    <a href="/signin"${sx(s.pill, s.pillLarge, s.light)}>Log in</a>
  </p>
</section>
</main>

<footer${sx(s.wrap, s.footer)}>
  <div${sx(s.footerRow)}>
    <span>Saintsflow</span>
    <p${sx(s.footerLinks)}>
      <a href="#product"${sx(s.navLink)}>Product</a>
      <a href="#less"${sx(s.navLink)}>What we skipped</a>
      <a href="/signin"${sx(s.navLink)}>Log in</a>
      <a href="/signup"${sx(s.navLink)}>Sign up</a>
    </p>
  </div>
  <span aria-hidden="true"${sx(s.giant)}>Saintsflow</span>
</footer>
<script>
// Once the hill is on screen its line draws itself and the dots climb into place along it.
// Reduced motion (or no JS): the line is drawn and the dots are already there.
const hill = document.getElementById("hill")
if (hill && "IntersectionObserver" in window && !matchMedia("(prefers-reduced-motion: reduce)").matches) {
  const climbs = hill.querySelectorAll(".climb")
  climbs.forEach((a) => a.beginElement())
  hill.pauseAnimations(); hill.setCurrentTime(0)
  const draw = hill.querySelector("path").animate([{ strokeDasharray: "1", strokeDashoffset: "1" }, { strokeDasharray: "1", strokeDashoffset: "0" }],
    { duration: 1000, easing: "cubic-bezier(.65, 0, .35, 1)", fill: "backwards" })
  draw.pause()
  new IntersectionObserver((es, io) => {
    if (!es[0].isIntersecting) return
    draw.play(); setTimeout(() => hill.unpauseAnimations(), 550); io.disconnect()
  }, { threshold: 0.5 }).observe(hill)
}
</script>
</body>
</html>`.s)

export const routes = [
  pubGet("/marketing", () => Effect.sync(() =>
    HttpServerResponse.text(page(), { contentType: "text/html; charset=utf-8" }))),
  pubGet("/marketting", () => Effect.succeed(redirect("/marketing"))),
]
