// The look: StyleX themes and the `sx` helper, the base layer for the app's plain semantic HTML,
// and the routes that serve /app.css and the font.
import * as stylex from "@stylexjs/stylex"
import { Effect } from "effect"
import { HttpRouter, HttpServerResponse } from "effect/http"
import { css } from "./stylex-plugin.ts"
import { color, dark, font, light, media, motion, radius, space, text } from "./tokens.stylex.ts"
import { esc, html, raw } from "./html.ts"

/** StyleX styles as ` class="…"` (plus ` style="…"` for dynamic values), ready for an html`` template. */
export const sx = (...styles: ReadonlyArray<stylex.StyleXStyles | stylex.Theme<any> | boolean | null | undefined>) => {
  // stylex.props, not stylex.attrs: attrs kebab-cases dynamic variable names (--x-background-color) while the
  // compiled CSS reads them as written (--x-backgroundColor), so multi-word dynamic styles silently did nothing.
  const p = stylex.props(...(styles as any[]))
  const style = Object.entries(p.style ?? {}).map(([k, v]) => `${k}:${v}`).join(";")
  return raw((p.className ? ` class="${p.className}"` : "") + (style ? ` style="${esc(style)}"` : ""))
}

// ---------- themes ----------
// Without a theme the tokens follow the OS. These pin one when someone picks Light or Dark in /my/appearance.
const lightTheme = stylex.createTheme(color, {
  ground: light.ground, sheet: light.sheet, tile: light.tile, tileHover: light.tileHover, ink: light.ink, muted: light.muted,
  line: light.line, control: light.control, slab: light.slab, slabTile: light.slabTile, slabInk: light.slabInk,
  slabMuted: light.slabMuted, primary: light.primary, primaryHover: light.primaryHover, onPrimary: light.onPrimary,
  accent: light.accent, onAccent: light.onAccent, accentSoft: light.accentSoft, accentText: light.accentText, focus: light.focus,
  danger: light.danger, dangerSoft: light.dangerSoft, success: light.success,
})
const darkTheme = stylex.createTheme(color, {
  ground: dark.ground, sheet: dark.sheet, tile: dark.tile, tileHover: dark.tileHover, ink: dark.ink, muted: dark.muted,
  line: dark.line, control: dark.control, slab: dark.slab, slabTile: dark.slabTile, slabInk: dark.slabInk,
  slabMuted: dark.slabMuted, primary: dark.primary, primaryHover: dark.primaryHover, onPrimary: dark.onPrimary,
  accent: dark.accent, onAccent: dark.onAccent, accentSoft: dark.accentSoft, accentText: dark.accentText, focus: dark.focus,
  danger: dark.danger, dangerSoft: dark.dangerSoft, success: dark.success,
})
const scheme = stylex.create({
  light: { colorScheme: "light" },
  dark: { colorScheme: "dark" },
  system: { colorScheme: "light dark" },
})

/** Attributes for <html>, from the person's appearance setting. */
export const theme = (appearance?: string | null) =>
  appearance === "light" ? sx(lightTheme, scheme.light) : appearance === "dark" ? sx(darkTheme, scheme.dark) : sx(scheme.system)

// ---------- faces ----------
const faceStyles = stylex.create({
  face: {
    display: "inline-flex", alignItems: "center", justifyContent: "center", flexShrink: 0, borderRadius: radius.pill, overflow: "hidden",
    backgroundColor: color.primary, color: color.onPrimary, fontWeight: 650, letterSpacing: "-0.02em", lineHeight: 1, userSelect: "none",
    objectFit: "cover",
  },
  size: (side: string, font: string) => ({ width: side, height: side, fontSize: font }),
})
/** A person's avatar: their photo, or their initials on a dark disc. Decorative: the name is always written next to it. */
export const face = (p: { name: string; avatar_url?: string | null } | null | undefined, px = 32) => {
  const name = p?.name ?? "?"
  if (p?.avatar_url) return raw(`<img src="${esc(p.avatar_url)}" alt=""${sx(faceStyles.face, faceStyles.size(`${px}px`, `${Math.round(px * 0.4)}px`)).s}>`)
  const initials = name.split(/\s+/).map((w) => w.replace(/[^\p{L}\p{N}]/gu, "")).filter(Boolean).slice(0, 2).map((w) => w[0]!.toUpperCase()).join("")
  return raw(`<span aria-hidden="true"${sx(faceStyles.face, faceStyles.size(`${px}px`, `${Math.round(px * 0.4)}px`)).s}>${esc(initials)}</span>`)
}

// ---------- the kit tool pages share ----------
// A page heading with its actions, tags, a byline, a readable body, record rows, a filter bar, a quiet link row.
export const kit = stylex.create({
  head: { display: "flex", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", columnGap: space.s4, rowGap: space.s3, marginBottom: space.s5 },
  headTitle: { margin: 0 },
  actions: { display: "flex", flexWrap: "wrap", alignItems: "center", gap: space.s2, margin: 0, maxWidth: "none" },
  tags: { display: "flex", flexWrap: "wrap", gap: 6, margin: 0, marginBottom: space.s3, maxWidth: "none" },
  tag: {
    display: "inline-flex", alignItems: "center", gap: 6, paddingBlock: 5, paddingInline: 10, borderRadius: radius.pill,
    backgroundColor: color.tile, color: color.ink, fontSize: 10.5, fontWeight: 700, letterSpacing: "0.04em", textTransform: "uppercase", lineHeight: 1,
    textDecoration: "none",
  },
  tagAccent: { backgroundColor: color.accentSoft, color: color.ink },
  by: { display: "flex", alignItems: "center", gap: space.s2, marginBottom: space.s5, fontSize: text.sm, color: color.muted },
  byName: { color: color.ink, fontWeight: 600, textDecoration: "none", ":hover": { textDecoration: "underline" } },
  prose: { fontSize: text.md, lineHeight: 1.65, maxWidth: "68ch" },
  rows: { margin: 0, marginBottom: space.s5 },
  row: { display: "grid", gridTemplateColumns: "32px 1fr", columnGap: space.s3, alignItems: "start", paddingBlock: space.s4 },
  rowTitle: { fontWeight: 600, fontSize: text.md, letterSpacing: "-0.01em", textDecoration: "none", ":hover": { textDecoration: "underline" } },
  rowMeta: { display: "block", marginTop: 2, fontSize: text.sm, color: color.muted },
  rowText: { marginTop: space.s1, marginBottom: 0, color: color.muted, fontSize: text.sm, maxWidth: "80ch" },
  toolbar: { display: "flex", flexWrap: "wrap", alignItems: "center", gap: space.s2, marginBottom: space.s4, fontSize: text.sm },
  toolbarControl: { minHeight: 32, paddingBlock: 3, fontSize: text.sm },
  links: { display: "flex", flexWrap: "wrap", columnGap: space.s4, rowGap: space.s1, marginTop: space.s6, marginBottom: 0, maxWidth: "none", fontSize: text.sm },
  empty: { maxWidth: "none", paddingBlock: space.s7, paddingInline: space.s5, borderRadius: radius.xl, backgroundColor: color.tile, textAlign: "center", color: color.muted },
  // A day heading: a group label, then a hairline to the edge.
  day: { display: "flex", alignItems: "center", gap: space.s3, marginTop: space.s6, marginBottom: space.s2, fontSize: text.xs, fontWeight: 600,
    letterSpacing: "0.05em", textTransform: "uppercase", color: color.muted },
  dayRule: { flexGrow: 1, height: 1, backgroundColor: color.line },
  // Read by screen readers, not shown.
  srOnly: { position: "absolute", width: 1, height: 1, padding: 0, margin: -1, overflow: "hidden", clipPath: "inset(50%)", whiteSpace: "nowrap", borderWidth: 0 },
})

/** <h1> with the page's actions on the right. */
export const pageHead = (title: unknown, ...actions: unknown[]) =>
  html`<div${sx(kit.head)}><h1${sx(kit.headTitle)}>${title}</h1>${actions.some(Boolean) ? html`<p${sx(kit.actions)}>${actions}</p>` : ""}</div>`

// ---------- menus ----------
// The project menu and an item's ••• menu: labelled groups of rows in tiles. A link that opens a page and a form
// button that does something look like the same row; links carry a chevron. Trash reads red.
const mn = stylex.create({
  wrap: { maxWidth: 560 },
  label: { fontSize: text.xs, fontWeight: 600, letterSpacing: "0.05em", textTransform: "uppercase", color: color.muted,
    marginTop: { default: space.s6, ":first-child": space.s5 }, marginBottom: space.s2, marginInline: space.s5 },
  list: { margin: 0, borderRadius: radius.xl, backgroundColor: color.tile, overflow: "hidden" },
  item: { padding: 0, paddingTop: 0 },
  form: { margin: 0 },
  row: {
    display: "flex", alignItems: "center", gap: space.s3, width: "100%", minHeight: 48, margin: 0, paddingBlock: space.s3, paddingInline: space.s5,
    borderRadius: 0, color: color.ink, fontSize: text.base, fontWeight: 500, letterSpacing: "normal", textAlign: "left", textDecoration: "none",
    justifyContent: "flex-start", transform: { default: null, ":active": "none" },
    backgroundColor: { default: "transparent", ":hover": { default: null, [media.hover]: color.tileHover }, ":active": color.tileHover },
  },
  go: { "::after": { content: '""', marginLeft: "auto", flexShrink: 0, width: 7, height: 7, borderStyle: "solid", borderColor: color.muted,
    borderWidth: 0, borderTopWidth: 1.5, borderRightWidth: 1.5, transform: "rotate(45deg)" } },
  danger: { color: color.danger,
    backgroundColor: { default: "transparent", ":hover": { default: null, [media.hover]: color.dangerSoft }, ":active": color.dangerSoft } },
  still: { cursor: "default", backgroundColor: "transparent" },
  input: { flexGrow: 1, minWidth: 0, width: "auto", margin: 0, fontFamily: font.mono, fontSize: text.sm },
})
export const menu = {
  /** The column the groups sit in. */
  wrap: (...groups: unknown[]) => html`<div${sx(mn.wrap)}>${groups}</div>`,
  /** A labelled group; empty items are dropped, and a group with none left isn't drawn. */
  group: (label: string, ...items: unknown[]) => {
    const xs = items.filter(Boolean)
    return xs.length ? html`<h2${sx(mn.label)}>${label}</h2><ul${sx(mn.list)}>${xs.map((i) => html`<li${sx(mn.item)}>${i}</li>`)}</ul>` : ""
  },
  link: (href: string, label: unknown, danger = false) => html`<a href="${href}"${sx(mn.row, mn.go, danger && mn.danger)}>${label}</a>`,
  post: (action: string, label: unknown, danger = false) =>
    html`<form method="post" action="${action}"${sx(mn.form)}><button${sx(mn.row, danger && mn.danger)}>${label}</button></form>`,
  /** A read-only value to copy (a link), on its row. */
  copy: (label: string, value: string) =>
    html`<label${sx(mn.row, mn.still)}>${label} <input readonly value="${value}" onclick="this.select()"${sx(mn.input)}></label>`,
}

// ---------- the hill ----------
// Two cubic curves make the progress hill (viewBox 600 wide, base at y=210, top at y=30). Uphill is working it out,
// downhill is getting it done. `at(v)` places a 0–100 position on the curve. Marketing and the app draw the same hill.
type Pt = readonly [number, number]
type Cubic = readonly [Pt, Pt, Pt, Pt]
const UP: Cubic = [[0, 210], [150, 210], [200, 30], [300, 30]]
const DOWN: Cubic = [[300, 30], [400, 30], [450, 210], [600, 210]]
const lerp = (a: Pt, b: Pt, t: number): Pt => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]
/** The part of a cubic from its start to parameter t (de Casteljau). */
const head = ([p0, p1, p2, p3]: Cubic, t: number): Cubic => {
  const a = lerp(p0, p1, t), b = lerp(p1, p2, t), c = lerp(p2, p3, t), d = lerp(a, b, t), e = lerp(b, c, t)
  return [p0, a, d, lerp(d, e, t)]
}
const curve = (cs: ReadonlyArray<Cubic>, [ox, oy]: Pt = [0, 0]) => {
  const f = ([x, y]: Pt) => `${(x - ox).toFixed(1)},${(y - oy).toFixed(1)}`
  return `M${f(cs[0]![0])}` + cs.map(([, a, b, c]) => ` C${f(a)} ${f(b)} ${f(c)}`).join("")
}
/** Where a 0–100 hill position sits on the curve. */
const at = (v: number): Pt => { const x = Math.min(100, Math.max(0, v)); return x <= 50 ? head(UP, x / 50)[3] : head(DOWN, (x - 50) / 50)[3] }
export const hill = { UP, DOWN, head, curve, at }

// ---------- base layer ----------
// StyleX styles elements through classes; the app is mostly classless semantic HTML (plain forms, lists, tables).
// So bare elements get this layer, built from the same tokens. It sits below StyleX's layers, so any sx() wins.
// Promoted to the primary (dark) pill: the first button or link-button in a <p>; in a form, the button after its
// fields (with or without a Cancel link after it); and the "Yes, …" button of a confirm form ("Yes, …" then "Never mind").
const PRIMARY = ":is(p>button:first-child,p>a[data-button]:first-child," +
  "form:not([style],[method=get])>:not(input[type=hidden])+button:is(:last-child,:has(+a:last-child))," +
  "form:not([style],[method=get])>button:first-child:has(+a:last-child))"
const base = `
@font-face{font-family:"Geist";src:url(/fonts/Geist-Variable.woff2) format("woff2");font-weight:100 900;font-display:swap}
@layer base{
*,::before,::after{box-sizing:border-box}
html{-webkit-text-size-adjust:100%;scrollbar-color:${color.control} transparent}
body{margin:0;font-family:${font.sans};font-size:${text.base};line-height:1.55;color:${color.ink};background:${color.ground};
  -webkit-font-smoothing:antialiased;-moz-osx-font-smoothing:grayscale;caret-color:${color.accent};font-synthesis:none}
::selection{background:color-mix(in srgb,${color.accent} 38%,transparent);color:${color.ink}}
:focus-visible{outline:2px solid ${color.focus};outline-offset:2px;border-radius:6px}
[hidden]{display:none!important}

h1,h2,h3,h4{margin:0;font-weight:700;text-wrap:balance}
h1{font-size:${text.xxl};line-height:1.15;letter-spacing:-0.03em;margin:0 0 ${space.s3}}
h2{font-size:${text.lg};line-height:1.3;font-weight:650;letter-spacing:-0.02em;margin:${space.s6} 0 ${space.s2}}
h3{font-size:${text.md};line-height:1.35;font-weight:600;letter-spacing:-0.01em;margin:${space.s5} 0 ${space.s2}}
:is(h1,h2,h3) a{color:inherit;text-decoration:none}
:is(h1,h2,h3) a:hover{text-decoration:underline;text-decoration-thickness:2px;text-underline-offset:.18em}
p{margin:0 0 ${space.s3};max-width:72ch;text-wrap:pretty}
small{font-size:${text.sm};color:${color.muted}}
b,strong{font-weight:600}
s{color:${color.muted}}
i{font-style:normal;color:${color.muted};font-size:${text.sm}}
a{color:inherit;text-decoration-line:underline;text-decoration-thickness:1px;text-underline-offset:.22em;
  text-decoration-color:color-mix(in srgb,currentColor 30%,transparent);transition:text-decoration-color ${motion.fast}}
a:hover{text-decoration-color:currentColor}
hr{border:0;border-top:1px solid ${color.line};margin:${space.s5} 0}
img,video{max-width:100%;height:auto;border-radius:${radius.md}}
mark{background:${color.accentSoft};color:inherit;border-radius:4px;padding:0 2px}
code,kbd,pre{font-family:${font.mono}}
code{font-size:.88em;background:${color.tile};padding:1px 5px;border-radius:6px}
kbd{font-size:${text.xs};padding:2px 6px;border-radius:6px;background:${color.tile};border:1px solid ${color.line};border-bottom-width:2px}
pre{font-size:${text.sm};background:${color.tile};padding:${space.s4};border-radius:${radius.md};overflow:auto;white-space:pre-wrap}
blockquote{margin:0 0 ${space.s4};padding:${space.s3} ${space.s4};background:${color.tile};border-radius:${radius.md}}

ul{margin:0 0 ${space.s5};padding:0;list-style:none}
ul>li{padding:${space.s3} 0;border-top:1px solid ${color.line}}
ul>li:first-child{border-top:0;padding-top:${space.s1}}
li ul{margin:${space.s2} 0 0}
ol{margin:0 0 ${space.s5};padding-left:1.4em}
ol>li{padding:${space.s1} 0}
dl{margin:0 0 ${space.s5}}
dt{font-weight:600}
dd{margin:2px 0 ${space.s3};color:${color.muted}}

table{width:100%;border-collapse:collapse;font-size:${text.sm};font-variant-numeric:tabular-nums;margin:0 0 ${space.s5}}
caption{text-align:left;font-weight:600;font-size:${text.base};padding-bottom:${space.s2}}
th{text-align:left;font-weight:600;font-size:${text.xs};text-transform:uppercase;letter-spacing:.05em;color:${color.muted};
  padding:${space.s2} ${space.s3};border-bottom:1px solid ${color.line};white-space:nowrap}
td{padding:10px ${space.s3};border-bottom:1px solid ${color.line};vertical-align:top}
:is(th,td):first-child{padding-left:0}
tfoot td{font-weight:600;border-bottom:0}
@media (max-width:640px){table{display:block;overflow-x:auto}}

details{margin:0 0 ${space.s4}}
summary{display:inline-flex;align-items:center;gap:${space.s2};cursor:pointer;list-style:none;font-size:${text.sm};font-weight:600;
  padding:9px ${space.s4};border-radius:${radius.pill};background:${color.tile};
  transition:background-color ${motion.fast},transform ${motion.fast} ${motion.out}}
summary::-webkit-details-marker{display:none}
summary::after{content:"";width:6px;height:6px;border:solid currentColor;border-width:0 1.5px 1.5px 0;transform:translateY(-2px) rotate(45deg);
  transition:transform ${motion.base} ${motion.out}}
details[open]>summary::after{transform:translateY(1px) rotate(-135deg)}
details[open]>summary{margin-bottom:${space.s4}}
summary:active{transform:scale(.97)}
a,button,summary,label{-webkit-tap-highlight-color:transparent}

/* Links that act as buttons ("New list", "Make a new project") carry data-button and look exactly like <button>. */
button,::file-selector-button,a[data-button]{font:inherit;font-size:${text.sm};font-weight:600;letter-spacing:-0.005em;line-height:1.2;
  display:inline-flex;align-items:center;justify-content:center;gap:6px;min-height:34px;padding:7px ${space.s4};
  border:0;border-radius:${radius.pill};background:${color.tile};color:${color.ink};cursor:pointer;vertical-align:middle;text-decoration:none;
  transition:background-color ${motion.fast},transform ${motion.fast} ${motion.out}}
:is(button,a[data-button]):active,input[type=file]:active::file-selector-button{transform:scale(.97)}
button:disabled{opacity:.45;cursor:not-allowed;transform:none}
${PRIMARY}{background:${color.primary};color:${color.onPrimary}}
/* "Cancel" / "Never mind" after a button gets room to breathe. */
:is(button,a[data-button])+a:not([data-button]){margin-left:${space.s2}}
/* Hover only where there's a pointer to hover with; on touch a tap would leave it stuck on. */
@media (hover:hover) and (pointer:fine){
  summary:hover,button:hover,a[data-button]:hover,::file-selector-button:hover{background:${color.tileHover}}
  ${PRIMARY}:hover{background:${color.primaryHover}}
}
/* The flash message eases in once on arrival. */
[data-flash]{transition:opacity ${motion.base} ${motion.out},transform ${motion.base} ${motion.out}}
@starting-style{[data-flash]{opacity:0;transform:translateY(-6px)}}
form[style*="inline"]{margin:0 2px}

label{cursor:pointer}
input,select,textarea{font:inherit;font-size:${text.base};color:${color.ink}}
input:not([type=checkbox],[type=radio],[type=file],[type=hidden],[type=range],[type=color]),select,textarea{
  min-height:36px;max-width:100%;padding:6px ${space.s3};margin:2px 0;background:${color.sheet};border:1px solid ${color.control};
  border-radius:10px;transition:border-color ${motion.fast},box-shadow ${motion.fast};vertical-align:middle}
input:is([type=text],[type=email],[type=url],[type=search],[type=password],[type=tel],:not([type])){width:min(100%,32rem)}
textarea{display:block;width:min(100%,48rem);min-height:8.5em;line-height:1.5;padding:10px ${space.s3};resize:vertical}
:is(input,select,textarea):focus{outline:0;border-color:${color.focus};box-shadow:0 0 0 3px color-mix(in srgb,${color.accent} 28%,transparent)}
::placeholder{color:${color.muted};opacity:1}
select{appearance:none;padding-right:34px;cursor:pointer;
  background-image:linear-gradient(45deg,transparent 50%,${color.muted} 50%),linear-gradient(135deg,${color.muted} 50%,transparent 50%);
  background-position:calc(100% - 18px) 52%,calc(100% - 13px) 52%;background-size:5px 5px;background-repeat:no-repeat}
select[multiple]{background-image:none;padding-right:${space.s3}}
input:is([type=checkbox],[type=radio]){width:16px;height:16px;margin:0 ${space.s2} 0 0;vertical-align:-3px;accent-color:${color.accent}}
input[type=file]{font-size:${text.sm};max-width:100%}
::file-selector-button{margin-right:${space.s3}}
fieldset{border:1px solid ${color.line};border-radius:${radius.lg};padding:${space.s3} ${space.s5} ${space.s4};margin:0 0 ${space.s5};min-width:0}
legend{font-weight:600;font-size:${text.sm};padding:0 ${space.s2};margin-left:-8px}
fieldset fieldset{border:0;padding:0;margin:0}
fieldset fieldset>legend{font-size:${text.xs};font-weight:600;text-transform:uppercase;letter-spacing:.05em;color:${color.muted};padding:0;margin:${space.s2} 0 ${space.s1}}
fieldset p:has(>i:only-child){margin:${space.s3} 0 ${space.s1}}
meter,progress,input[type=range]{accent-color:${color.accent}}
/* Checkbox labels laid side by side ("created  edited  completed") keep a gap between them. */
label:has(>:is([type=checkbox],[type=radio]))+label:has(>:is([type=checkbox],[type=radio])){margin-left:${space.s4};white-space:nowrap}

[role=note]{background:${color.tile};border-radius:${radius.md};padding:${space.s3} ${space.s4};margin:0 0 ${space.s5}}
[role=note] p:last-child{margin-bottom:0}
[role=alert]{background:${color.dangerSoft};color:${color.danger};border-radius:${radius.md};padding:${space.s3} ${space.s4};margin:0 0 ${space.s5}}
[role=alert] p{margin:0 0 ${space.s1}}
[role=alert] ul{margin:0;padding-left:1.2em;list-style:disc}
[role=alert] li{border:0;padding:2px 0}

/* Reduced motion: no movement (presses, slides, the chevron turn), but color and fade transitions stay. */
@media (prefers-reduced-motion:reduce){
  :is(button,a[data-button],summary):active,input[type=file]:active::file-selector-button{transform:none}
  summary::after{transition:none}
  *,::before,::after{animation:none!important}
  @starting-style{[data-flash]{transform:none}}
}
}
`

// ---------- assets ----------
const fontFile = Bun.file(new URL("../../public/fonts/Geist-Variable.woff2", import.meta.url))
let sheet: { body: string; href: string } | null = null
const stylesheet = () => {
  if (sheet) return sheet
  const body = base + css()
  return (sheet = { body, href: `/app.css?v=${Bun.hash(body).toString(36)}` })
}
/** Versioned URL of the stylesheet, for <link>. */
export const cssHref = () => stylesheet().href

const FOREVER = { "cache-control": "public, max-age=31536000, immutable" }
export const assetRoutes = [
  HttpRouter.route("GET", "/app.css", Effect.sync(() => HttpServerResponse.text(stylesheet().body, { contentType: "text/css; charset=utf-8", headers: FOREVER }))),
  HttpRouter.route("GET", "/fonts/Geist-Variable.woff2", Effect.promise(async () =>
    HttpServerResponse.uint8Array(await fontFile.bytes(), { contentType: "font/woff2", headers: FOREVER }))),
]

/** <head> tags every page shares. */
export const headTags = () =>
  raw(`<link rel="preload" href="/fonts/Geist-Variable.woff2" as="font" type="font/woff2" crossorigin>
<link rel="stylesheet" href="${cssHref()}">`)
