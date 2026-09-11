import type { SessionView } from "@nib-ui/protocol";

/** Mirrors the design system's `StatusTone`; declared here so plugins need no direct dependency on it. */
export type StatusTone = "green" | "red" | "amber" | "blue" | "violet" | "neutral";

type SessionStatus = SessionView["status"];

const tones: Record<SessionStatus, StatusTone> = {
  idle: "neutral",
  working: "blue",
  "awaiting-permission": "amber",
  error: "red",
  closed: "green",
};

const labels: Record<SessionStatus, string | null> = {
  idle: null,
  working: "Working",
  "awaiting-permission": "Needs input",
  error: "Error",
  closed: "Completed",
};

export function statusTone(status: SessionStatus): StatusTone {
  return tones[status] ?? "neutral";
}

/** Task rows only carry a status word when it is actionable; idle tasks read as plain history. */
export function statusLabel(status: SessionStatus): string | null {
  return labels[status] ?? null;
}

export function workspaceName(path: string): string {
  const trimmed = path.replace(/\/+$/, "");
  const name = trimmed.slice(trimmed.lastIndexOf("/") + 1);
  return name.length > 0 ? name : "/";
}

/** Chat-sidebar ages: `now`, `4m`, `2h`, `3d`, `5w`. */
export function formatRelativeTime(timestamp: number, now: number): string {
  const minute = 60_000;
  const hour = 60 * minute;
  const day = 24 * hour;
  const week = 7 * day;

  const elapsed = Math.max(0, now - timestamp);
  if (elapsed < minute) return "now";
  if (elapsed < hour) return `${Math.floor(elapsed / minute)}m`;
  if (elapsed < day) return `${Math.floor(elapsed / hour)}h`;
  if (elapsed < week) return `${Math.floor(elapsed / day)}d`;
  return `${Math.floor(elapsed / week)}w`;
}
