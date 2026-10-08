// The harnesses nib offers, each one of the shared harness's.
//
// The ids are the ones the per-vendor plugins registered under, so sessions
// logged before the switch, board defaults and icons still resolve.

import type { Effort, HarnessId, PermissionPolicy } from "@neoworks/harness";
import type { HarnessCapabilities, ModelInfo } from "@nib-ui/protocol";

/** The permission policies every harness takes, in the order the composer offers them. */
export const permissionPolicies: PermissionPolicy[] = ["ask", "auto-edit", "read-only", "full-access"];

export const defaultPermissionPolicy: PermissionPolicy = "ask";

/** Stands for "whatever the harness is configured to use"; never passed on. */
export const defaultModelId = "default";

export interface SharedHarnessSpec {
  /** The id nib registers the harness under. */
  id: string;
  /** The shared harness's own id for it. */
  runsOn: HarnessId;
  displayName: string;
  efforts: Effort[];
  /** A copy of a conversation can be continued. */
  fork: boolean;
  /** Offered until the harness has listed the models the signed-in account can run. */
  models: ModelInfo[];
}

const defaultModel: ModelInfo = { id: defaultModelId, displayName: "Default" };

export const sharedHarnessSpecs: SharedHarnessSpec[] = [
  {
    id: "claude-code",
    runsOn: "claude",
    displayName: "Claude Code",
    efforts: ["low", "medium", "high", "xhigh", "max"],
    fork: true,
    models: [
      defaultModel,
      { id: "opus", displayName: "Opus" },
      { id: "sonnet", displayName: "Sonnet" },
      { id: "haiku", displayName: "Haiku" },
    ],
  },
  {
    id: "codex",
    runsOn: "codex",
    displayName: "Codex",
    efforts: ["low", "medium", "high", "xhigh"],
    fork: true,
    models: [defaultModel],
  },
  {
    id: "pi",
    runsOn: "pi",
    displayName: "pi",
    efforts: ["low", "medium", "high", "xhigh", "max"],
    fork: false,
    models: [defaultModel],
  },
];

/** What a harness can do, as the composer and the session host read it. */
export function capabilitiesOf(spec: SharedHarnessSpec): HarnessCapabilities {
  return {
    interrupt: true,
    permissionModes: permissionPolicies,
    resume: true,
    fork: spec.fork,
    slashCommands: true,
    models: true,
    effortLevels: spec.efforts,
    // ACP has no way to restore the working tree to before a turn.
    checkpoints: false,
  };
}

// Modes stored by the per-vendor plugins, onto the policy closest to them.
const legacyModes: Record<string, PermissionPolicy> = {
  default: "ask",
  acceptEdits: "auto-edit",
  plan: "read-only",
  bypassPermissions: "full-access",
  "workspace-write": "auto-edit",
  "danger-full-access": "full-access",
  unrestricted: "full-access",
};

/** A permission mode as nib stored it, as the policy the shared harness takes. */
export function permissionPolicyOf(mode: string | undefined): PermissionPolicy {
  if (mode === undefined) {
    return defaultPermissionPolicy;
  }
  if ((permissionPolicies as string[]).includes(mode)) {
    return mode as PermissionPolicy;
  }
  const legacy = legacyModes[mode];
  if (legacy === undefined) {
    return defaultPermissionPolicy;
  }
  return legacy;
}

/** An effort level nib stored, or undefined for one the harness has no equivalent of. */
export function effortOf(spec: SharedHarnessSpec, level: string | undefined): Effort | undefined {
  if (level === undefined) {
    return undefined;
  }
  if ((spec.efforts as string[]).includes(level)) {
    return level as Effort;
  }
  // pi's own levels below `low`.
  if (level === "minimal") {
    return "low";
  }
  return undefined;
}

/** A model id to pass on, or undefined when the harness should use its own default. */
export function modelOf(model: string | undefined): string | undefined {
  if (model === undefined || model === defaultModelId) {
    return undefined;
  }
  return model;
}
