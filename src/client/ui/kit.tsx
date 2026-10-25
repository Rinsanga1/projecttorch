// The look: StyleX themes and the `sx` helper, faces, the kit tool pages share and menus.
// Write `<div {...sx(styles.box)}>`; bare elements are styled by the base layer (base.ts).
import * as stylex from "@stylexjs/stylex"
import { Fragment, type ReactNode } from "react"
import { fmt, fmtDateTime } from "../../shared/format.ts"
import { color, dark, font, light, media, radius, space, text } from "./tokens.stylex.ts"
import { Form } from "./forms.tsx"

/** StyleX styles as props: `className` (plus `style` for dynamic values). Falsy entries are skipped. */
export const sx = (...styles: ReadonlyArray<stylex.StyleXStyles | stylex.Theme<any> | boolean | null | undefined>) =>
  stylex.props(...(styles as any[]))

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

/** Props for <html>, from the person's appearance setting. The layout applies them. */
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
export const Face = ({ p, px = 32 }: { p: { name: string; avatar_url?: string | null } | null | undefined; px?: number }) => {
  const props = sx(faceStyles.face, faceStyles.size(`${px}px`, `${Math.round(px * 0.4)}px`))
  if (p?.avatar_url) return <img src={p.avatar_url} alt="" {...props} />
  const initials = (p?.name ?? "?").split(/\s+/).map((w) => w.replace(/[^\p{L}\p{N}]/gu, "")).filter(Boolean).slice(0, 2).map((w) => w[0]!.toUpperCase()).join("")
  return <span aria-hidden="true" {...props}>{initials}</span>
}

/** A plain-text body, formatted: links, @mentions bold, line breaks kept. `fmt` escapes everything first. */
/** `ref={fadeOverflow}` on a row that scrolls sideways: its end fades (app.css `[data-more]`) only while there is more to scroll to. */
export const fadeOverflow = (el: HTMLElement | null) => {
  if (!el) return
  // Only a row that actually scrolls; a visible-overflow row's scrollWidth also counts things hanging off it (tips).
  const check = () => el.toggleAttribute("data-more", getComputedStyle(el).overflowX !== "visible" && el.scrollLeft + el.clientWidth < el.scrollWidth - 1)
  const ro = new ResizeObserver(check)
  ro.observe(el)
  el.addEventListener("scroll", check, { passive: true })
  return () => { ro.disconnect(); el.removeEventListener("scroll", check) }
}

/** How far along something is, as a thin bar: a Tile Gray track with a Kargul Orange fill (a native meter or progress
 * won't take the colors). Sized by `width`. */
const bar = stylex.create({
  track: { display: "inline-block", height: 6, borderRadius: radius.pill, backgroundColor: color.tileHover, overflow: "hidden", verticalAlign: "middle", flexShrink: 0 },
  fill: { display: "block", height: "100%", borderRadius: radius.pill, backgroundColor: color.accent },
})
export const ProgressBar = ({ pct, width = 64 }: { pct: number; width?: number }) => (
  <span role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct} {...sx(bar.track)} style={{ width }}>
    <span {...sx(bar.fill)} style={{ width: `${pct}%` }} />
  </span>
)

export const Fmt = ({ text, ...rest }: { text: string | null | undefined } & React.HTMLAttributes<HTMLDivElement>) =>
  <div data-prose {...rest} dangerouslySetInnerHTML={{ __html: fmt(text) }} />

// ---------- the kit tool pages share ----------
// A page heading with its actions, tags, a byline, a readable body, record rows, a filter bar, a quiet link row.
export const kit = stylex.create({
  head: { display: "flex", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", columnGap: space.s4, rowGap: space.s3, marginBottom: space.s5 },
  headTitle: { margin: 0 },
  actions: { display: "flex", flexWrap: "wrap", alignItems: "center", gap: space.s2, margin: 0, maxWidth: "none" },
  tags: { display: "flex", flexWrap: "wrap", gap: 6, margin: 0, marginBottom: space.s3, maxWidth: "none" },
  tag: {
    display: "inline-flex", alignItems: "center", gap: 6, paddingBlock: 5, paddingInline: 10, borderRadius: radius.pill,
    backgroundColor: color.tile, color: color.ink, fontSize: 11, fontWeight: 700, letterSpacing: "0.04em", textTransform: "uppercase", lineHeight: 1,
    textDecoration: "none",
  },
  tagAccent: { backgroundColor: color.accentSoft, color: color.ink },
  // "New since your last visit": solid orange, so it never reads as Pinned (Peach Wash).
  tagNew: { backgroundColor: color.accent, color: color.onAccent, marginLeft: space.s2, verticalAlign: 2 },
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
  // A dropdown that is an action ("Move to…"): no box until hovered, so a row of them stays quiet.
  quietSelect: {
    width: "auto", minHeight: 28, margin: 0, paddingBlock: 2, paddingLeft: 10, fontSize: text.sm, color: color.muted,
    borderColor: "transparent", backgroundColor: { default: "transparent", ":hover": { default: null, [media.hover]: color.tile } },
  },
  links: { display: "flex", flexWrap: "wrap", columnGap: space.s4, rowGap: space.s1, marginTop: space.s6, marginBottom: 0, maxWidth: "none", fontSize: text.sm },
  // Grid, so a paragraph narrower than the box (prose keeps its measure) centers with the button under it.
  empty: { display: "grid", justifyItems: "center", maxWidth: "none", paddingBlock: space.s7, paddingInline: space.s5, borderRadius: radius.xl, backgroundColor: color.tile, textAlign: "center", color: color.muted },
  // A day heading: a group label, then a hairline to the edge.
  day: { display: "flex", alignItems: "center", gap: space.s3, marginTop: space.s6, marginBottom: space.s2, fontSize: text.xs, fontWeight: 600,
    letterSpacing: "0.05em", textTransform: "uppercase", color: color.muted },
  dayRule: { flexGrow: 1, height: 1, backgroundColor: color.line },
  // Read by screen readers, not shown.
  // A disclosure that reads as a quiet line ("+ Add a task", "•••"): no pill, no chevron, until it's opened.
  quietSummary: {
    minHeight: 0, paddingBlock: 4, paddingInline: 0, fontSize: text.sm, fontWeight: 500, color: color.muted,
    backgroundColor: { default: "transparent", ":hover": { default: null, [media.hover]: "transparent" } }, "::after": { content: "none" },
  },
  // A button that reads as a text link: for secondary actions that still have to post ("Stop watching", "Pin it").
  linkButton: {
    minHeight: 0, padding: 0, borderRadius: 0, fontSize: "inherit", fontWeight: "inherit", color: "inherit", textDecoration: "underline",
    textUnderlineOffset: "0.22em", textDecorationThickness: 1, textDecorationColor: { default: "color-mix(in srgb, currentColor 30%, transparent)", ":hover": "currentColor" },
    backgroundColor: { default: "transparent", ":hover": { default: null, [media.hover]: "transparent" } }, transform: { default: null, ":active": "none" },
  },
  srOnly: { position: "absolute", width: 1, height: 1, padding: 0, margin: -1, overflow: "hidden", clipPath: "inset(50%)", whiteSpace: "nowrap", borderWidth: 0 },
})

/** <h1> with the page's actions on the right. Falsy actions are dropped. */
export const PageHead = ({ title, actions = [] }: { title: ReactNode; actions?: ReactNode[] }) => {
  const xs = actions.filter(Boolean)
  return (
    <div {...sx(kit.head)}>
      <h1 {...sx(kit.headTitle)}>{title}</h1>
      {xs.length > 0 && <p {...sx(kit.actions)}>{xs.map((x, i) => <Fragment key={i}>{x}</Fragment>)}</p>}
    </div>
  )
}

/** "Name · via Claude Code · Oct 4 at 3:12pm" under a title, with the author's face. `via`: the agent that wrote it. */
export const ByLine = ({ who, when, tz = "UTC", via }: { who: { id: number; name: string; avatar_url?: string | null } | null | undefined; when: string; tz?: string; via?: string | null }) => (
  <p {...sx(kit.by)}>
    <Face p={who} px={24} />
    <span>{who ? <a href={`/people/${who.id}`} {...sx(kit.byName)}>{who.name}</a> : "(someone)"}{via ? ` · via ${via}` : ""} · {fmtDateTime(when, tz)}</span>
  </p>
)

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
  Wrap: ({ children }: { children: ReactNode }) => <div {...sx(mn.wrap)}>{children}</div>,
  /** A labelled group; falsy items are dropped, and a group with none left isn't drawn. */
  Group: ({ label, items }: { label: string; items: ReactNode[] }) => {
    const xs = items.filter(Boolean)
    return xs.length ? <><h2 {...sx(mn.label)}>{label}</h2><ul {...sx(mn.list)}>{xs.map((i, n) => <li key={n} {...sx(mn.item)}>{i}</li>)}</ul></> : null
  },
  Link: ({ href, children, danger = false }: { href: string; children: ReactNode; danger?: boolean }) =>
    <a href={href} {...sx(mn.row, mn.go, danger && mn.danger)}>{children}</a>,
  /** A row that posts to `action` (an /api route, written without /api). */
  Post: ({ action, children, danger = false, optimistic }: { action: string; children: ReactNode; danger?: boolean; optimistic?: () => void }) =>
    <Form action={action} optimistic={optimistic} {...sx(mn.form)}><button {...sx(mn.row, danger && mn.danger)}>{children}</button></Form>,
  /** A read-only value to copy (a link), on its row. */
  Copy: ({ label, value }: { label: string; value: string }) =>
    <label {...sx(mn.row, mn.still)}>{label} <input readOnly value={value} onClick={(e) => e.currentTarget.select()} {...sx(mn.input)} /></label>,
}
