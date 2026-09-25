/**
 * Where a composer with no session behind it can send a request besides an
 * agent. The chat's composer knows nothing of what a target does: a plugin
 * registers one — ComfyUI offers its workflows — and the composer lists its
 * options next to "Agent", shows its form while one is picked, and hands it the
 * prompt on send.
 */

import type { Disposer } from "@nib-ui/kernel";
import type { IconComponent } from "@neoworks-dev/ui";
import type { Component } from "svelte";
import type { Point } from "./canvas";

/** What a request is being made about and where its result should go. */
export interface ComposerTargetContext {
  /** The project the request is made in. */
  cwd: string;
  /** The board directory on screen, where a result with no source to sit beside goes. */
  boardDirectory: string;
  /** Vault paths of the cards the request is about, in order; empty when asked of the board. */
  sources: string[];
  /** Where on the board, in world units, the result's top-left corner goes; null to leave it to the target. */
  at: Point | null;
}

/** One choice a target offers in the composer's picker, e.g. one workflow. */
export interface ComposerTargetOption {
  /** Unique within its target. */
  id: string;
  label: string;
  hint?: string;
  /** Shown, but cannot be picked: a workflow ComfyUI cannot run right now. */
  disabled?: boolean;
}

/** The form a picked option shows under the prompt. Values belong to the composer, so a draft keeps them. */
export interface ComposerTargetFormProps {
  optionId: string;
  context: ComposerTargetContext;
  values: Record<string, unknown>;
  onchange(values: Record<string, unknown>): void;
}

/** What a target is asked on send, and asked beforehand whether it could. */
export interface ComposerTargetRequest {
  optionId: string;
  text: string;
  values: Record<string, unknown>;
  context: ComposerTargetContext;
}

/** How a picked option shapes the composer around its form. */
export interface ComposerTargetPrompt {
  /** Whether the prompt text is used at all; false hides the text area. */
  takesText: boolean;
  placeholder: string;
}

/** A place other than an agent that a composer can send to. */
export interface ComposerTarget {
  id: string;
  icon?: IconComponent;
  /** Reactive: the choices for this context. Asked often, so it answers from what it has. */
  options(context: ComposerTargetContext): ComposerTargetOption[];
  /** How the composer's text area reads while an option is picked. */
  prompt(optionId: string, context: ComposerTargetContext): ComposerTargetPrompt;
  form: Component<ComposerTargetFormProps>;
  /** Why sending would not work yet, in a few words; null when it would. */
  blocked(request: ComposerTargetRequest): string | null;
  send(request: ComposerTargetRequest): Promise<void>;
}

/** The targets plugins have registered, provided as the `composerTargets` service. */
export interface ComposerTargetRegistry {
  /** Reactive. */
  readonly targets: readonly ComposerTarget[];
  register(target: ComposerTarget): Disposer;
}
