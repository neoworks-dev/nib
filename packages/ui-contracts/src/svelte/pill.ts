import type { IconComponent } from "@neoworks-dev/ui";

/** One row in a `PillSelect` popover. */
export interface PillOption {
  value: string;
  label: string;
  /** What the pill shows once this option is picked, when `label` is too long to sit in a row of pills. */
  short?: string;
  hint?: string;
  icon?: IconComponent;
  /** Rendered but not selectable — used for harnesses that are announced, not wired up. */
  disabled?: boolean;
}
