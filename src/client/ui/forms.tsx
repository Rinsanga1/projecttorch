// Forms. A <Form action="/lineup/markers"> posts its fields to /api/lineup/markers (the same handler the old page
// posted to) and follows the reply: errors above the form (what was typed stays), a flash, a redirect, or staying
// put. Inputs stay uncontrolled, like plain HTML: `defaultValue`, `defaultChecked`, `name`.
// For GET forms (filters, search) use react-router's <Form method="get">: it navigates without a reload.
import { useEffect, useRef, useState, type FormEvent, type FormHTMLAttributes, type ReactNode } from "react"
import { useNavigate } from "react-router"
import { flash, submit, type Reply } from "../store.ts"
import { isClient, type Person, type Project } from "../../shared/domain.ts"
import { plural } from "../../shared/format.ts"
import type { PersonWithCompany } from "../data.ts"

/** Follow a reply: flash, then navigate unless the server said to stay. Shared by <Form> and usePost. */
const useFollow = (opts: { replace?: boolean } = {}) => {
  const navigate = useNavigate()
  return (r: Reply) => {
    if (r.flash) flash(r.flash)
    // Somewhere outside the app (an agent's own address, after approving it): a real page load.
    if (r.redirect && /^[a-z][a-z0-9+.-]*:/i.test(r.redirect)) return void location.assign(r.redirect)
    if (r.redirect && (!r.back || r.redirect === "/signin" || r.redirect === "/lockout")) navigate(r.redirect, { replace: opts.replace })
  }
}

/**
 * Post without a form element: toggles, drag-and-drop orders, a select that saves on change.
 * `post("/projects/1/tasks/2/complete", { done: "1" }, () => { …change db… })`
 */
export const usePost = (opts: { replace?: boolean } = {}) => {
  const follow = useFollow(opts)
  return async (action: string, fields: Record<string, string | string[] | Blob> | FormData = {}, optimistic?: () => void) => {
    const fd = fields instanceof FormData ? fields : new FormData()
    if (!(fields instanceof FormData))
      for (const [k, v] of Object.entries(fields)) for (const x of Array.isArray(v) ? v : [v]) fd.append(k, x)
    const r = await submit(action, fd, optimistic)
    if (r.errors?.length) flash({ msg: r.errors.join(" ") })
    else follow(r)
    return r
  }
}

/**
 * Posts once when the page opens, then follows the reply. For links that do something (the flash's "Undo",
 * "open this notification"): the old GET routes that changed things are posts now, and their page renders this.
 */
export const PostOnOpen = ({ action, fields }: { action: string; fields?: Record<string, string> }) => {
  // Replace this page in history, so Back doesn't land here and post again.
  const post = usePost({ replace: true })
  const done = useRef(false)
  useEffect(() => {
    if (done.current) return
    done.current = true
    post(action, fields)
  }, [action])
  return null
}

type FormProps = Omit<FormHTMLAttributes<HTMLFormElement>, "action" | "method" | "onSubmit"> & {
  /** The route the old page posted to, without /api. */
  action: string
  /** Change the copy before the server answers (see store.ts submit). */
  optimistic?: (fd: FormData) => void
  /** Runs after a reply without errors, before navigating. */
  onDone?: (r: Reply) => void
  /** Clear the fields after a successful post that stays on the page (default true). */
  reset?: boolean
  children: ReactNode
}

export const Form = ({ action, optimistic, onDone, reset = true, children, ...rest }: FormProps) => {
  const [errors, setErrors] = useState<string[]>([])
  const busy = useRef(false)
  const follow = useFollow()
  const onSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    if (busy.current) return
    busy.current = true
    const form = e.currentTarget
    const submitter = (e.nativeEvent as SubmitEvent).submitter as HTMLElement | null
    const fd = new FormData(form, submitter)
    try {
      const r = await submit(action, fd, optimistic && (() => optimistic(fd)))
      setErrors(r.errors ?? [])
      if (r.errors?.length) return
      onDone?.(r)
      // Staying on this page (back, no redirect, or a redirect to this same path): clear what was typed.
      if (reset && (r.back || !r.redirect || r.redirect.split(/[?#]/)[0] === location.pathname)) form.reset()
      follow(r)
    } finally {
      busy.current = false
    }
  }
  return (
    <>
      <Errors list={errors} />
      <form method="post" action={action} onSubmit={onSubmit} {...rest}>{children}</form>
    </>
  )
}

/** Validation errors at the top of a form. */
export const Errors = ({ list }: { list: ReadonlyArray<string> }) =>
  list.length ? <div role="alert"><p><b>Please fix:</b></p><ul>{list.map((e) => <li key={e}>{e}</li>)}</ul></div> : null

/** Submit the form this control is in (a select that saves on change). */
export const submitOwnForm = (e: { currentTarget: { form: HTMLFormElement | null } }) => e.currentTarget.form?.requestSubmit()

/** `ref={submitOnChange}` on a filter form: it applies as soon as a field changes, with no Filter button. */
export const submitOnChange = (form: HTMLFormElement | null) => {
  if (!form) return
  const go = () => form.requestSubmit()
  form.addEventListener("change", go)
  return () => form.removeEventListener("change", go)
}

// ---------- shared form pieces ----------

/** Checkbox list of people, grouped by company. Used by every "who" field. */
export const PeopleCheckboxes = ({ name, people, checked = [] }: { name: string; people: ReadonlyArray<PersonWithCompany>; checked?: ReadonlyArray<number> }) => {
  const groups = new Map<string, PersonWithCompany[]>()
  for (const p of people) groups.set(p.company_name ?? "", [...(groups.get(p.company_name ?? "") ?? []), p])
  return (
    <fieldset>
      <legend>People</legend>
      {[...groups].map(([company, ps]) => (
        <div key={company}>
          {company && <p><i>{company}</i></p>}
          {ps.map((p) => (
            <span key={p.id}>
              <label><input type="checkbox" name={name} value={p.id} defaultChecked={checked.includes(p.id)} /> {p.name}{p.role === "client" ? " (client)" : ""}</label><br />
            </span>
          ))}
        </div>
      ))}
    </fieldset>
  )
}

/** "When I post this, notify…": Everyone / Only the people I select / Nobody. The server reads it with notifyIdsFrom. */
export const NotifyPicker = ({ people, me }: { people: ReadonlyArray<PersonWithCompany>; me: Person }) => {
  const others = people.filter((p) => p.id !== me.id)
  return (
    <fieldset>
      <legend>When I post this, notify…</legend>
      <label><input type="radio" name="notify" value="everyone" defaultChecked /> All {plural(others.length, "person", "people")} on this project</label><br />
      <label><input type="radio" name="notify" value="selected" /> Only the people I select…</label><br />
      <PeopleCheckboxes name="notify_ids" people={others} />
      <label><input type="radio" name="notify" value="nobody" /> Nobody</label>
    </fieldset>
  )
}

/** "Clients see this" switch on new things, only when the project has clients. */
export const ClientSwitch = ({ project, people, current }: { project: Pick<Project, "clients_see_new">; people: ReadonlyArray<Person>; current?: boolean }) =>
  people.some(isClient)
    ? <p><label><input type="checkbox" name="visible_to_clients" defaultChecked={current ?? project.clients_see_new} /> Clients see this</label></p>
    : null

export const TextField = ({ label, name, value = "", required, placeholder, type = "text" }: { label: ReactNode; name: string; value?: string; required?: boolean; placeholder?: string; type?: string }) =>
  <p><label>{label}<br /><input type={type} name={name} defaultValue={value} required={required} placeholder={placeholder} /></label></p>

export const TextArea = ({ label, name, value = "", placeholder = "" }: { label: ReactNode; name: string; value?: string; placeholder?: string }) =>
  <p><label>{label}<br /><textarea name={name} rows={8} cols={70} placeholder={placeholder} defaultValue={value} /></label></p>
