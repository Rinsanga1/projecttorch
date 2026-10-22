// Crawl every link reachable from Home as each person and report anything that isn't 2xx/3xx.
// `bun run smoke` with the server running. BASE=http://localhost:3000 by default.
const BASE = process.env.BASE ?? "http://localhost:3000"
const LIMIT = Number(process.env.LIMIT ?? 3000)

const people = [...(await (await fetch(`${BASE}/dev/people`)).text()).matchAll(/data-person="(\d+)"/g)].map((m) => m[1]!)
let failures = 0
for (const pid of people) {
  const seen = new Set<string>()
  const queue = ["/"]
  while (queue.length && seen.size < LIMIT) {
    const path = queue.shift()!
    if (seen.has(path)) continue
    seen.add(path)
    const res = await fetch(BASE + path, { headers: { cookie: `pid=${pid}` }, redirect: "manual" })
    if (res.status >= 400 && res.status !== 403 && res.status !== 410) {
      failures++
      const body = await res.text()
      console.log(`[person ${pid}] ${res.status} ${path}  ${(body.match(/<pre>([\s\S]*?)<\/pre>/)?.[1] ?? "").slice(0, 200)}`)
      continue
    }
    if (res.status >= 300 && res.status < 400) {
      const loc = res.headers.get("location")
      if (loc?.startsWith("/")) queue.push(loc.split("#")[0]!)
      continue
    }
    if (!res.headers.get("content-type")?.includes("text/html")) continue
    const body = await res.text()
    for (const m of body.matchAll(/href="(\/[^"#]*)/g)) {
      const href = m[1]!.replace(/&amp;/g, "&")
      if (!seen.has(href) && !/\/(download|calendar\.ics|undo-trash)|^\/inbox\/\d+\/open/.test(href)) queue.push(href)
    }
  }
  console.log(`person ${pid}: crawled ${seen.size} pages`)
}
console.log(failures ? `${failures} failing pages` : "No failing pages.")
process.exit(failures ? 1 : 0)
