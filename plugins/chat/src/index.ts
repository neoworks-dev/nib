/**
 * The transcript itself, as components rather than as a plugin: the pane that
 * mounts `ChatSurface` belongs to whoever owns the conversation it is showing —
 * on the canvas, the board — so this package contributes the surface, the
 * composer and the pure text they need.
 */
export { default as ChatSurface } from './ChatSurface.svelte';
export { default as Composer } from './Composer.svelte';
export { composeAnnotatedMessage, createAnnotation, type StagedAnnotation } from './annotations';
export type { PendingComposer } from './pending';
export { composerDrafts, stageReference } from './drafts.svelte';
export {
	applyTrigger,
	detectTrigger,
	type Trigger,
	type TriggerApplication,
	type TriggerItem,
	type TriggerKind,
} from './composer-trigger';
export {
	describeHarnessSwitch,
	planHarnessSwitch,
	type HarnessSwitchConfirmation,
	type HarnessSwitchPlan,
} from './harness-switch';
export { groupCount, groupTurnBlocks, type ToolGroup, type TurnItem } from './tool-groups';
export { handoverSeed, transcriptText, DROPPED_MARKER, HANDOVER_BUDGET } from './transcript';
