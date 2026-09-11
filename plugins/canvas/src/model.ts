import type { ChangedFile } from "@nib-ui/plugin-renderer-diff/changed-files";
import type { StepDescriptor } from "@nib-ui/ui-contracts";

/** A step with the transcript location it came from, so a card row can jump to it. */
export interface TracedStep extends StepDescriptor {
  messageId: string;
  blockId: string;
}

/** One prompt and everything the agent did to answer it. */
export interface Exchange {
  id: string;
  sessionId: string;
  /** Id of the user message that opened the exchange. */
  messageId: string;
  prompt: string;
  reply: string;
  /** Calls that are not edits. */
  steps: TracedStep[];
  /** Edits, accumulated per path. */
  changes: ChangedFile[];
  /** The turn is still running, so the workstream reads as in-flight. */
  working: boolean;
  /** Every message folded into this exchange, so an annotation can find its owner. */
  messageIds: string[];
}
