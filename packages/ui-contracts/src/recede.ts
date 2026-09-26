/**
 * How the window is set back behind a raised sheet: nudged down and shrunk about
 * the middle of its top edge. The pane host and the shell's toolbar both apply
 * it, each to a box as wide as the window, so they recede as one surface.
 */
export const RECEDED_TRANSFORM = "translateY(12px) scale(0.94)";

export const RECEDE_TRANSITION =
  "transform var(--dur-slow) var(--ease-out), border-radius var(--dur-slow) var(--ease-out)";
