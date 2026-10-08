import { createSessionView, type SessionView } from "@nib-ui/protocol";
import {
  sessionOf,
  textItem,
  thoughtItem,
  toolItem,
  userItem,
} from "../../../packages/protocol/tests/builders";

export { sessionOf, textItem, thoughtItem, toolItem, userItem };

/** A chain of `prompt → reply` turns, which is what most graph cases need. */
export function chat(
  sessionId: string,
  prompts: string[],
  overrides: Partial<SessionView> = {},
): SessionView {
  const items = prompts.flatMap((prompt, index) => [
    userItem(`u${index}`, prompt),
    textItem(`a${index}`, `answer to ${prompt}`),
  ]);
  return { ...createSessionView(sessionId), items, ...overrides };
}
