/**
 * How what is behind a raised sheet is set back: nudged down and shrunk about
 * the middle of its top edge. The shell applies it to the window behind a
 * document sheet and the board applies it to itself behind a folder, each to a
 * box as wide as the area, so both read as the same gesture.
 */
export const RECEDED_TRANSFORM = "translateY(12px) scale(0.94)";

export const RECEDE_TRANSITION =
  "transform var(--dur-slow) var(--ease-out), border-radius var(--dur-slow) var(--ease-out)";
