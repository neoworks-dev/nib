/** Harness mode ids are protocol values; these are the words the UI shows for the ones we know. */
const labels: Record<string, string> = {
  // The policies every harness takes through the shared harness.
  ask: "Ask before changes",
  "auto-edit": "Auto-accept edits",
  "read-only": "Read-only",
  "full-access": "Full access",
  // Modes the per-vendor harnesses stored in sessions logged before the shared harness.
  default: "Ask before changes",
  acceptEdits: "Auto-accept edits",
  plan: "Plan only",
  bypassPermissions: "Bypass permissions",
  // Codex's sandbox modes, which occupied the permission slot.
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
