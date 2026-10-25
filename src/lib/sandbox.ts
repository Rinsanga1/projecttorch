// Code Mode's sandbox: an agent's script runs in QuickJS (compiled to WASM) with no file system, no network, no
// timers, and limits on memory, time and calls. Its only way out is `__host(name, json)`, which the caller answers.
// TypeScript is stripped by Bun's transpiler first. Each run gets its own WASM module (about 10ms), so nothing a
// script does, or how it ends, can reach the next one.
import { newQuickJSWASMModule, RELEASE_SYNC, shouldInterruptAfterDeadline } from "quickjs-emscripten"

export type RunResult = { ok: true; result: unknown; logs: string[] } | { ok: false; error: string; logs: string[] }
export type Limits = { ms: number; memoryMb: number; calls: number }

const transpiler = new Bun.Transpiler({ loader: "ts" })

/**
 * Run `code` as the body of an async function, after `prelude` (plain JS that sets up globals). `host` answers the
 * script's `__host(name, args)` calls; whatever it throws becomes an Error inside the script.
 */
export const run = async (code: string, prelude: string, host: (name: string, args: unknown) => Promise<unknown>, limits: Limits): Promise<RunResult> => {
  const logs: string[] = []
  let js: string
  try {
    js = transpiler.transformSync(`globalThis.__main = async () => {\n${code}\n}`)
  } catch (e) {
    return { ok: false, error: `That code doesn't parse: ${(e as Error).message}`, logs }
  }

  const runtime = (await newQuickJSWASMModule(RELEASE_SYNC)).newRuntime()
  runtime.setMemoryLimit(limits.memoryMb * 1024 * 1024)
  runtime.setMaxStackSize(1024 * 1024)
  const deadline = Date.now() + limits.ms
  runtime.setInterruptHandler(shouldInterruptAfterDeadline(deadline))
  const vm = runtime.newContext()
  let calls = 0, inFlight = 0
  // Once the run is over (done, failed or out of time) no answer goes back in and no new call goes out.
  let over = false
  let timer: ReturnType<typeof setTimeout> | undefined
  const fail = (e: any) => ({ ok: false as const, error: e?.message === "interrupted" ? "The script ran out of time." : e?.message ? `${e.name ?? "Error"}: ${e.message}` : String(e), logs })
  try {
    const log = vm.newFunction("__log", (s) => { if (logs.length < 200) logs.push(vm.getString(s).slice(0, 2000)) })
    vm.setProp(vm.global, "__log", log)
    log.dispose()
    const hostFn = vm.newFunction("__host", (nameH, argsH) => {
      const name = vm.getString(nameH), args = vm.getString(argsH)
      const deferred = vm.newPromise()
      if (over) return deferred.handle
      inFlight++
      const answer = (++calls > limits.calls
        ? Promise.reject(new Error(`That's more than ${limits.calls} calls in one run. Split the work into smaller runs.`))
        : host(name, JSON.parse(args))).finally(() => inFlight--)
      answer.then(
        (v) => { if (!over) vm.newString(JSON.stringify(v ?? null)).consume((h) => deferred.resolve(h)) },
        (e) => { if (!over) vm.newError(String((e as Error)?.message ?? e)).consume((h) => deferred.reject(h)) },
      )
      deferred.settled.then(() => { if (!over) runtime.executePendingJobs() })
      return deferred.handle
    })
    vm.setProp(vm.global, "__host", hostFn)
    hostFn.dispose()

    const setup = vm.evalCode(`${prelude}\n${js}`)
    if (setup.error) return fail(setup.error.consume((h) => vm.dump(h)))
    setup.value.dispose()

    const started = vm.evalCode("__main().then((v) => JSON.stringify(v === undefined ? null : v))")
    if (started.error) return fail(started.error.consume((h) => vm.dump(h)))
    const settled = vm.resolvePromise(started.value)
    started.value.dispose()
    runtime.executePendingJobs()
    const timeout = new Promise<"timeout">((r) => (timer = setTimeout(() => r("timeout"), Math.max(0, deadline - Date.now()))))
    const res = await Promise.race([settled, timeout])
    if (res === "timeout") return { ok: false, error: `The script ran out of time (${limits.ms / 1000}s).`, logs }
    if (res.error) return fail(res.error.consume((h) => vm.dump(h)))
    return { ok: true, result: JSON.parse(res.value.consume((h) => vm.getString(h))), logs }
  } catch (e) {
    return fail(e)
  } finally {
    over = true
    clearTimeout(timer)
    // A run cut off mid-call still holds that call's promise, and freeing QuickJS then trips its leak assertion. Left
    // alone, its module is just garbage; otherwise free it now.
    if (!inFlight) try { vm.dispose(); runtime.dispose() } catch {}
  }
}
