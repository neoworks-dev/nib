export type TriggerKind = "slash" | "file";

export interface Trigger {
  kind: TriggerKind;
  /** Text typed after the trigger character, up to the caret. */
  query: string;
  /** Index of the trigger character itself. */
  start: number;
  end: number;
}

export interface TriggerApplication {
  text: string;
  caret: number;
}

/**
 * Slash commands only count as the first token of the draft — mid-sentence
 * slashes are paths. `@` references may appear anywhere a word can start.
 */
export function detectTrigger(text: string, caret: number): Trigger | null {
  const before = text.slice(0, caret);
  let start = before.length;
  while (start > 0 && !/\s/.test(before[start - 1]!)) start -= 1;

  const character = before[start];
  if (character === "@") return { kind: "file", query: before.slice(start + 1), start, end: caret };
  if (character === "/" && start === 0)
    return { kind: "slash", query: before.slice(1), start, end: caret };
  return null;
}

export function applyTrigger(text: string, trigger: Trigger, value: string): TriggerApplication {
  const prefix = trigger.kind === "slash" ? "/" : "@";
  const inserted = `${prefix}${value} `;
  return {
    text: text.slice(0, trigger.start) + inserted + text.slice(trigger.end),
    caret: trigger.start + inserted.length,
  };
}

/** One row in the trigger popup: a slash command or a workspace file. */
export interface TriggerItem {
  value: string;
  label: string;
  hint?: string;
}
