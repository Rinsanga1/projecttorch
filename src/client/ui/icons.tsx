// Line icons for the project's tools and the window controls: a 20-unit grid, 1.5px stroke, round caps, currentColor.
import type { ToolType } from "../../shared/domain.ts"

const PATHS: Record<ToolType | "links" | "full" | "shrink" | "close" | "back" | "plus" | "panel", string> = {
  message_board: "M4 4.5h12v8.5H9l-4 3v-3H4z",
  todos: "M4 10.5 7.5 14 16 5.5",
  vault: "M5 2.75h6.5L15 6.25v11H5zM11.25 2.75v3.5H15",
  campfire: "M3.5 5h9v6.5h-5l-3 2.5V11.5h-1zM12.5 8h4v6h-1v2l-2.5-2h-3.5",
  schedule: "M5.5 4.5h9a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2h-9a2 2 0 0 1-2-2v-8a2 2 0 0 1 2-2ZM3.5 8.5h13M7 3v3M13 3v3",
  checkins: "M10 3a7 7 0 1 1 0 14 7 7 0 0 1 0-14ZM8 8a2 2 0 1 1 2.8 1.8c-.5.3-.8.7-.8 1.2v.5M10 14v.01",
  cardtable: "M4 4h3v12H4zM8.5 4h3v8h-3zM13 4h3v10h-3z",
  forwards: "M3.5 5.5h13v9h-13zM3.5 6 10 11l6.5-5",
  timesheet: "M10 3a7 7 0 1 1 0 14 7 7 0 0 1 0-14ZM10 6v4l3 2",
  links: "M8.5 11.5a3.5 3.5 0 0 0 5 0l2.5-2.5a3.5 3.5 0 0 0-5-5l-1 1M11.5 8.5a3.5 3.5 0 0 0-5 0L4 11a3.5 3.5 0 0 0 5 5l1-1",
  full: "M5.5 4h9A1.5 1.5 0 0 1 16 5.5v9a1.5 1.5 0 0 1-1.5 1.5h-9A1.5 1.5 0 0 1 4 14.5v-9A1.5 1.5 0 0 1 5.5 4Z",
  close: "m5.5 5.5 9 9M14.5 5.5l-9 9",
  back: "M12 4.5 6.5 10l5.5 5.5",
  shrink: "M8 4v4H4M12 4v4h4M8 16v-4H4M12 16v-4h4",
  plus: "M10 4.5v11M4.5 10h11",
  panel: "M5.5 4h9A1.5 1.5 0 0 1 16 5.5v9a1.5 1.5 0 0 1-1.5 1.5h-9A1.5 1.5 0 0 1 4 14.5v-9A1.5 1.5 0 0 1 5.5 4ZM8.5 4v12",
}

export type IconName = keyof typeof PATHS

/** A decorative icon; the control it sits in carries the name. */
export const Icon = ({ name, size = 20 }: { name: IconName; size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ flexShrink: 0 }}>
    <path d={PATHS[name]} />
  </svg>
)
