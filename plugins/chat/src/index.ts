/**
 * The transcript itself, as components rather than as a plugin: the pane that
 * mounts `ChatSurface` belongs to whoever owns the conversation it is showing —
 * on the canvas, the board — so this package contributes the surface, the
 * composer and the pure text they need.
 */

export { agentFamily } from "./agent-family";
export { default as AgentTabs } from "./AgentTabs.svelte";
export { composeAnnotatedMessage, createAnnotation, type StagedAnnotation } from "./annotations";
export { default as ChatSurface } from "./ChatSurface.svelte";
export { default as Composer } from "./Composer.svelte";
export {
  applyTrigger,
  detectTrigger,
  type Trigger,
  type TriggerApplication,
  type TriggerItem,
  type TriggerKind,
} from "./composer-trigger";
export { composerDrafts, stageReference } from "./drafts.svelte";
export {
  describeHarnessSwitch,
  type HarnessSwitchConfirmation,
  type HarnessSwitchPlan,
  planHarnessSwitch,
} from "./harness-switch";
export type { PendingComposer } from "./pending";
export { groupCount, groupTurnBlocks, type ToolGroup, type TurnItem } from "./tool-groups";
export { DROPPED_MARKER, HANDOVER_BUDGET, handoverSeed, transcriptText } from "./transcript";
