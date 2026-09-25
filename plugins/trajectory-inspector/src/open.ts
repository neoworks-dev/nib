import type { AttachmentsService, PaneRegistry } from "@nib-ui/ui-contracts";
import { planTrajectory } from "./attach";

export const trajectoryPaneId = "trajectory";

/** The pane the user is working in, with the kind its definition gives it. */
function focusedPane(panes: PaneRegistry): { instanceId: string; kind: string } | null {
  const focusedId = panes.focusedInstanceId;
  if (focusedId === null) return null;
  const instance = panes.instances().find((entry) => entry.instanceId === focusedId);
  if (!instance) return null;
  const definition = panes.list().find((entry) => entry.id === instance.paneId);
  if (!definition) return null;
  return { instanceId: focusedId, kind: definition.kind };
}

/** Opens the inspector beside the focused chat, or closes the one already there. */
export function toggleTrajectory(panes: PaneRegistry, attachments: AttachmentsService): void {
  const focused = focusedPane(panes);
  const attached = focused ? attachments.find(focused.instanceId, "inspector") : undefined;

  const plan = planTrajectory({ focused, attached });
  switch (plan.action) {
    case "close":
      panes.closeInstance(plan.instanceId);
      return;
    case "attach":
      attachments.attach(panes.openInstance(trajectoryPaneId), plan.chatInstanceId, "right");
      return;
    case "open":
      panes.open(trajectoryPaneId);
  }
}
