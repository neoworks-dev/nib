import type {
  ComfyLibraryEntry,
  ComposerTarget,
  ComposerTargetRequest,
} from "@nib-ui/ui-contracts";
import FlowArrowIcon from "phosphor-svelte/lib/FlowArrowIcon";
import {
  blockedReason,
  findEntry,
  promptParameter,
  runInput,
  workflowOptions,
} from "./composer-target";
import ComposerWorkflowForm from "./ComposerWorkflowForm.svelte";
import { errorMessage } from "./form";
import type { ComfyStore } from "./store.svelte";

/** The composer target's id, and the prefix of its picker values. */
export const COMPOSER_TARGET_ID = "comfyui";

/**
 * The library's workflows as a composer target: picking one turns the composer
 * into its form, and sending runs it with the text as its prompt and the card's
 * picture as its image.
 */
export function workflowComposerTarget(store: ComfyStore): ComposerTarget {
  /** The entry a request names, from the library as the composer last saw it. */
  const entryFor = (request: ComposerTargetRequest): ComfyLibraryEntry | null =>
    findEntry(store.cachedLibrary(request.context.cwd), request.optionId);

  return {
    id: COMPOSER_TARGET_ID,
    icon: FlowArrowIcon,
    options: (context) => workflowOptions(store.cachedLibrary(context.cwd), context),
    prompt: (optionId, context) => {
      const entry = findEntry(store.cachedLibrary(context.cwd), optionId);
      const prompt = entry ? promptParameter(entry.manifest) : null;
      if (!entry || !prompt) return { takesText: false, placeholder: "" };
      return { takesText: true, placeholder: `${prompt.label} for ${entry.manifest.name}` };
    },
    form: ComposerWorkflowForm,
    blocked: (request) => {
      const entry = entryFor(request);
      if (!entry) return "Workflow not found";
      return blockedReason(entry, request);
    },
    send: async (request) => {
      const entry = entryFor(request);
      if (!entry) throw new Error("Workflow not found");
      try {
        await store.runWorkflow(runInput(entry, request));
      } catch (cause) {
        throw new Error(errorMessage(cause), { cause });
      }
    },
  };
}
