// HTML as tagged templates. Everything interpolated is escaped unless it's already Raw.

export class Raw {
  constructor(readonly s: string) {}
  toString() { return this.s }
}
export const raw = (s: string) => new Raw(s)

const ESC: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }
export const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ESC[c]!)

const render = (v: unknown): string =>
  v == null || v === false ? "" : v instanceof Raw ? v.s : Array.isArray(v) ? v.map(render).join("") : esc(String(v))

export const html = (strings: TemplateStringsArray, ...vals: unknown[]) =>
  new Raw(strings.reduce((out, s, i) => out + s + (i < vals.length ? render(vals[i]) : ""), ""))

// Bodies are stored as plain text. Render: escape, link URLs, keep line breaks, bold @mentions.
// ponytail: plain-text bodies, swap in Trix/Action Text-style rich text when formatting matters
export const fmt = (text: string | null | undefined) =>
  raw(
    esc(text ?? "")
      .replace(/https?:\/\/[^\s<]+/g, (u) => `<a href="${u}">${u}</a>`)
      .replace(/(^|\s)@(\w+)/g, "$1<b>@$2</b>")
      .replace(/\n/g, "<br>\n"),
  )

export const excerpt = (text: string | null | undefined, n = 140) => {
  const t = (text ?? "").replace(/\s+/g, " ").trim()
  return t.length > n ? t.slice(0, n - 1) + "…" : t
}

export const checked = (b: unknown) => (b ? raw(" checked") : "")
export const selected = (b: unknown) => (b ? raw(" selected") : "")

/** "Oct 4", "Oct 4, 2025" when not this year. */
export const fmtDate = (d: Date | string | null | undefined, tz = "UTC") => {
  if (!d) return ""
  const date = typeof d === "string" ? new Date(d.length === 10 ? d + "T12:00:00Z" : d) : d
  const sameYear = date.getUTCFullYear() === new Date().getUTCFullYear()
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric", ...(sameYear ? {} : { year: "numeric" }), timeZone: tz })
}

export const fmtTime = (d: Date | string | null | undefined, tz = "UTC") => {
  if (!d) return ""
  return new Date(d).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone: tz })
}

export const fmtDateTime = (d: Date | string | null | undefined, tz = "UTC") => (d ? `${fmtDate(d, tz)} at ${fmtTime(d, tz)}` : "")

/** YYYY-MM-DD for <input type=date> and SQL dates. */
export const isoDate = (d: Date | string | null | undefined) => {
  if (!d) return ""
  if (typeof d === "string") return d.slice(0, 10)
  return d.toISOString().slice(0, 10)
}

export const today = () => new Date().toISOString().slice(0, 10)

/** Whole days from today to `d` (negative = in the past). */
export const daysFromToday = (d: Date | string) => {
  const day = isoDate(d)
  return Math.round((Date.parse(day + "T00:00:00Z") - Date.parse(today() + "T00:00:00Z")) / 86_400_000)
}

export const plural = (n: number, one: string, many = one + "s") => `${n} ${n === 1 ? one : many}`
