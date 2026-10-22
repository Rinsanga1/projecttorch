// Open every page reachable from Home as each person, in a headless browser, and report pages that crash
// ("Something went wrong", uncaught errors) or links that lead nowhere ("Page not found").
// `bun run smoke` with `bun run dev` running. BASE=http://localhost:3000, LIMIT=400 pages per person,
// BROWSER=<path to a Chromium-based browser> (defaults to Edge on Windows, else Playwright's Chromium).
import { chromium } from "playwright-core"

const BASE = process.env.BASE ?? "http://localhost:3000"
const LIMIT = Number(process.env.LIMIT ?? 400)
const EDGE = "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe"
const executablePath = process.env.BROWSER ?? (process.platform === "win32" ? EDGE : undefined)
// Links that change something when opened, or leave the app.
const SKIP = /\/(undo-trash|open|download|raw)(\/|$|\?)|^\/api\/|^\/(signout|marketting)/

const people = ((await (await fetch(`${BASE}/api/dev/people`)).json()) as { data: { id: number; name: string }[] }).data
const browser = await chromium.launch({ executablePath, headless: true })
let failures = 0

for (const person of people) {
  const ctx = await browser.newContext()
  await ctx.addCookies([{ name: "pid", value: String(person.id), url: BASE }])
  const page = await ctx.newPage()
  let crash: string | null = null
  page.on("pageerror", (e) => (crash ??= e.message))
  const seen = new Set<string>()
  const queue = ["/"]
  while (queue.length && seen.size < LIMIT) {
    const path = queue.shift()!
    if (seen.has(path)) continue
    seen.add(path)
    crash = null
    // Client-side navigation keeps the copy in memory, like a person clicking around.
    if (seen.size === 1) await page.goto(BASE + path)
    else await page.evaluate((p) => { history.pushState(null, "", p); dispatchEvent(new PopStateEvent("popstate")) }, path)
    await page.waitForSelector("main h1, main", { timeout: 10_000 }).catch(() => (crash ??= "nothing rendered"))
    await page.waitForTimeout(50)
    const h1 = (await page.locator("main h1").first().textContent({ timeout: 1000 }).catch(() => "")) ?? ""
    const problem = crash ?? (h1 === "Something went wrong" ? (await page.locator("main pre").first().textContent().catch(() => "")) || "error page" : h1 === "Page not found" ? "page not found" : null)
    if (problem) {
      failures++
      console.log(`[${person.name}] ${path}  ${problem.slice(0, 200)}`)
      continue
    }
    for (const href of await page.$$eval("a[href^='/']", (as) => as.map((a) => a.getAttribute("href")!)))
      if (!SKIP.test(href)) {
        const p = href.split("#")[0]!
        if (p && !seen.has(p)) queue.push(p)
      }
  }
  console.log(`${person.name}: opened ${seen.size} pages`)
  await ctx.close()
}
await browser.close()
console.log(failures ? `${failures} failing pages` : "No failing pages.")
process.exit(failures ? 1 : 0)
