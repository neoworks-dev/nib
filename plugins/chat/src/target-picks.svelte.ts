/**
 * Where a composer with no session sends: to an agent, or to one option of a
 * registered target. Kept per draft outside the composer, like the text, so a
 * floating composer dismissed and reopened on the same card is where it was.
 */

import type { ComposerTarget } from "@nib-ui/ui-contracts";

/** The picker's value for sending to an agent, the composer's own behaviour. */
export const AGENT_PICK = "agent";

/** One target's option, picked, with what its form holds. */
export interface TargetPick {
  targetId: string;
  optionId: string;
  values: Record<string, unknown>;
}

/** The picker's value for one target's option. */
export function pickValue(targetId: string, optionId: string): string {
  return `${targetId}:${optionId}`;
}

/** The target and option a picker value names, or null for the agent or a target that is gone. */
export function parsePickValue(
  value: string,
  targets: readonly ComposerTarget[],
): { target: ComposerTarget; optionId: string } | null {
  for (const target of targets) {
    const prefix = `${target.id}:`;
    if (value.startsWith(prefix)) return { target, optionId: value.slice(prefix.length) };
  }
  return null;
}

class ComposerTargetPicks {
  private picks = $state<Record<string, TargetPick>>({});

  /** The draft's pick, or null while it sends to an agent. */
  get(draftKey: string): TargetPick | null {
    return this.picks[draftKey] ?? null;
  }

  /** Picks an option, starting its form empty. */
  choose(draftKey: string, targetId: string, optionId: string): void {
    this.picks = { ...this.picks, [draftKey]: { targetId, optionId, values: {} } };
  }

  /** Goes back to sending to an agent. */
  clear(draftKey: string): void {
    const { [draftKey]: _removed, ...rest } = this.picks;
    this.picks = rest;
  }

  /** Replaces what the picked option's form holds. */
  setValues(draftKey: string, values: Record<string, unknown>): void {
    const pick = this.picks[draftKey];
    if (!pick) return;
    this.picks = { ...this.picks, [draftKey]: { ...pick, values } };
  }
}

export const composerTargetPicks = new ComposerTargetPicks();
