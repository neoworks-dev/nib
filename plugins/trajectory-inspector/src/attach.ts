/**
 * The inspector is a property pane of a chat: it opens beside the conversation
 * it inspects and reads that pane's session. The button in the chat's title row
 * toggles it, so pressing it with the inspector already there closes it.
 */
export type TrajectoryPlan =
  | { action: "close"; instanceId: string }
  | { action: "attach"; chatInstanceId: string }
  | { action: "open" };

export interface TrajectoryContext {
  /** The pane the button was pressed in, which clicking into it focused. */
  focused: { instanceId: string; kind: string } | null;
  /** The inspector already sitting beside that pane, if one is. */
  attached: { instanceId: string } | undefined;
}

export function planTrajectory({ focused, attached }: TrajectoryContext): TrajectoryPlan {
  if (attached) return { action: "close", instanceId: attached.instanceId };
  if (focused?.kind === "chat") return { action: "attach", chatInstanceId: focused.instanceId };
  // Nowhere to sit beside: a dock of its own, following the task in the foreground.
  return { action: "open" };
}
