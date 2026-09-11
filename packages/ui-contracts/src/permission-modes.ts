/** Harness mode ids are protocol values; these are the words the UI shows for the ones we know. */
const labels: Record<string, string> = {
  default: "Ask before changes",
  acceptEdits: "Auto-accept edits",
  plan: "Plan only",
  bypassPermissions: "Bypass permissions",
  // Codex has no approval channel on a non-interactive stream, so its sandbox
  // modes occupy the permission slot instead.
  "read-only": "Read-only sandbox",
  "workspace-write": "Write in workspace",
  "danger-full-access": "Full access",
  // pi has no approval channel at all: tools are enabled for the whole run.
  unrestricted: "No approvals",
};

export function permissionModeLabel(mode: string): string {
  return labels[mode] ?? mode;
}

const effortLabels: Record<string, string> = {
  off: "Off",
  minimal: "Minimal",
  low: "Low",
  medium: "Medium",
  high: "High",
  xhigh: "Extra high",
  max: "Max",
};

export function effortLabel(level: string): string {
  return effortLabels[level] ?? level;
}
