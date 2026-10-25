// The base layer: styles for bare elements. Pages are mostly classless semantic HTML (plain forms, lists, tables),
// and StyleX styles through classes, so elements get this layer, built from the same tokens. It sits below StyleX's
// layers (index.html declares `@layer base` first), so any sx() wins. main.tsx injects it once at startup.
import { color, font, motion, radius, space, text } from "./tokens.stylex.ts"

// Promoted to the primary (dark) pill: the first button or link-button in a <p>; in a form, the button after its
// fields (with or without a Cancel link after it); and the "Yes, …" button of a confirm form ("Yes, …" then "Never mind").
// A page can also say so outright: data-primary promotes a button, data-quiet keeps one plain.
const PRIMARY = ":is([data-primary],p>button:first-child,p>a[data-button]:first-child," +
  "form:not([style],[method=get])>:not(input[type=hidden])+button:is(:last-child,:has(+a:last-child))," +
  "form:not([style],[method=get])>button:first-of-type:has(+a:last-child)):not([data-quiet])"
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
[data-prose] ul{padding-left:1.4em;list-style:disc}
[data-prose] ul>li{border:0;padding:${space.s1} 0}
[data-prose]>:last-child{margin-bottom:0}
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

/* Links that act as buttons ("Write a post", "Make a new project") carry data-button and look exactly like <button>. */
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
/* Checkbox labels laid side by side ("created  edited  completed") keep a gap between them. The gap trails each label,
   so a row that wraps starts flush left. */
label:has(>:is([type=checkbox],[type=radio])):has(+label>:is([type=checkbox],[type=radio])){margin-right:${space.s4}}
label:has(>:is([type=checkbox],[type=radio]))+label:has(>:is([type=checkbox],[type=radio])){white-space:nowrap}
/* A filter row (a GET form: "Filter by name … Sort … View …") keeps its fields apart. */
form[method=get]>:is(label,button)+:is(label,button){margin-left:${space.s2}}

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

export const injectBase = () => {
  const el = document.createElement("style")
  el.textContent = base
  document.head.append(el)
}
