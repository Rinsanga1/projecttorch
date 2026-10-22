// Design tokens, after kargul.studio: Geist on a light-gray ground, white sheets, near-black slabs and pills,
// one orange accent. `light`/`dark` hold the values; `color` follows the OS unless a theme in ui.ts pins one.
import * as stylex from "@stylexjs/stylex"

export const light = stylex.defineConsts({
  ground: "#efefef",
  sheet: "#ffffff",
  tile: "#f5f5f5",
  tileHover: "#ebebeb",
  ink: "#171717",
  muted: "#5e5e5e",
  line: "#e4e4e4",
  control: "#949494",
  slab: "#232323",
  slabTile: "#2e2e2e",
  slabInk: "#f5f5f5",
  slabMuted: "#a8a8a8",
  primary: "#232323",
  primaryHover: "#000000",
  onPrimary: "#ffffff",
  accent: "#f99c00",
  onAccent: "#1a1200",
  accentSoft: "#ffefd1",
  accentText: "#9a5b00",
  focus: "#c46f00",
  danger: "#c62a1f",
  dangerSoft: "#fde9e7",
  success: "#16a34a",
})

export const dark = stylex.defineConsts({
  ground: "#121212",
  sheet: "#1c1c1c",
  tile: "#242424",
  tileHover: "#2c2c2c",
  ink: "#f2f2f2",
  muted: "#a3a3a3",
  line: "#2d2d2d",
  control: "#6b6b6b",
  slab: "#000000",
  slabTile: "#1a1a1a",
  slabInk: "#f5f5f5",
  slabMuted: "#a3a3a3",
  primary: "#f2f2f2",
  primaryHover: "#ffffff",
  onPrimary: "#121212",
  accent: "#f99c00",
  onAccent: "#1a1200",
  accentSoft: "#3b2a0a",
  accentText: "#ffb23d",
  focus: "#ffb23d",
  danger: "#ff7b6e",
  dangerSoft: "#3a1714",
  success: "#4ade80",
})

const DARK = "@media (prefers-color-scheme: dark)"

export const color = stylex.defineVars({
  ground: { default: light.ground, [DARK]: dark.ground },
  sheet: { default: light.sheet, [DARK]: dark.sheet },
  tile: { default: light.tile, [DARK]: dark.tile },
  tileHover: { default: light.tileHover, [DARK]: dark.tileHover },
  ink: { default: light.ink, [DARK]: dark.ink },
  muted: { default: light.muted, [DARK]: dark.muted },
  line: { default: light.line, [DARK]: dark.line },
  control: { default: light.control, [DARK]: dark.control },
  slab: { default: light.slab, [DARK]: dark.slab },
  slabTile: { default: light.slabTile, [DARK]: dark.slabTile },
  slabInk: { default: light.slabInk, [DARK]: dark.slabInk },
  slabMuted: { default: light.slabMuted, [DARK]: dark.slabMuted },
  primary: { default: light.primary, [DARK]: dark.primary },
  primaryHover: { default: light.primaryHover, [DARK]: dark.primaryHover },
  onPrimary: { default: light.onPrimary, [DARK]: dark.onPrimary },
  accent: { default: light.accent, [DARK]: dark.accent },
  onAccent: { default: light.onAccent, [DARK]: dark.onAccent },
  accentSoft: { default: light.accentSoft, [DARK]: dark.accentSoft },
  accentText: { default: light.accentText, [DARK]: dark.accentText },
  focus: { default: light.focus, [DARK]: dark.focus },
  danger: { default: light.danger, [DARK]: dark.danger },
  dangerSoft: { default: light.dangerSoft, [DARK]: dark.dangerSoft },
  success: { default: light.success, [DARK]: dark.success },
})

export const font = stylex.defineVars({
  sans: '"Geist", ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif',
  mono: 'ui-monospace, SFMono-Regular, Menlo, Consolas, "Liberation Mono", monospace',
})

// Fixed rem steps for the app (Operate); marketing adds its own display sizes.
export const text = stylex.defineVars({
  xs: "0.75rem",
  sm: "0.84375rem",
  base: "0.9375rem",
  md: "1.0625rem",
  lg: "1.25rem",
  xl: "1.5rem",
  xxl: "2rem",
})

export const space = stylex.defineVars({
  s1: "4px",
  s2: "8px",
  s3: "12px",
  s4: "16px",
  s5: "24px",
  s6: "32px",
  s7: "48px",
  s8: "64px",
  s9: "96px",
})

export const radius = stylex.defineVars({
  sm: "8px",
  md: "12px",
  lg: "16px",
  xl: "24px",
  slab: "40px",
  pill: "999px",
})

export const motion = stylex.defineVars({
  out: "cubic-bezier(.22, 1, .36, 1)",
  inOut: "cubic-bezier(.65, 0, .35, 1)",
  fast: "150ms",
  base: "220ms",
})

// Conditions shared as keys: `":hover": { default: null, [media.hover]: … }` keeps hover off touch screens.
export const media = stylex.defineConsts({
  hover: "@media (hover: hover) and (pointer: fine)",
  reduce: "@media (prefers-reduced-motion: reduce)",
})
