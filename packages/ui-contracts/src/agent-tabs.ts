import type { SessionsService } from "./index";
import type { PaneRegistry } from "./panes";

/** The pane that reads a conversation; a related agent opens as a tab in it. */
export const chatPaneId = "chat";

/**
 * Shows one agent where a related one is being read: the chat holding
 * `fromSessionId` is re-keyed to `sessionId`, which is what the tab strip does
 * when a tab is clicked. Keeping the rest of the params is what leaves the pane
 * bound to whatever card opened it. Without such a chat, a new one opens.
 */
export function showAgentSession(
  panes: PaneRegistry,
  sessions: SessionsService,
  fromSessionId: string,
  sessionId: string,
): void {
  sessions.watch(sessionId);
  const host = panes
    .instances(chatPaneId)
    .find((instance) => instance.params?.["sessionId"] === fromSessionId);
  if (!host) {
    panes.open(chatPaneId, { sessionId });
    return;
  }
  panes.reparam(host.instanceId, { ...host.params, sessionId });
}
