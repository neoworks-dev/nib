/**
 * The library's workflows as a composer target, kept out of the components: which
 * workflows a composer offers, which parameters its text and its card fill, and
 * what a run is sent.
 */

import type {
  ComfyLibraryEntry,
  ComfyParameter,
  ComfyRunWorkflowInput,
  ComfyWorkflowManifest,
  ComposerTargetContext,
  ComposerTargetOption,
  ComposerTargetRequest,
} from "@nib-ui/ui-contracts";
import {
  describeAvailability,
  entryKey,
  filterEntries,
  type FormValues,
  imageParameter,
  initialValues,
  missingRequired,
  valuesToSend,
} from "./form";

const IMAGE_FILE = /\.(png|jpe?g|webp|gif|bmp)$/i;

/** The first picture among the cards a request is about, which fills the image parameter. */
export function sourceImage(context: ComposerTargetContext): string | null {
  return context.sources.find((path) => IMAGE_FILE.test(path)) ?? null;
}

/** The library entry an option names, or null once it is gone. */
export function findEntry(
  entries: readonly ComfyLibraryEntry[],
  optionId: string,
): ComfyLibraryEntry | null {
  return entries.find((entry) => entryKey(entry) === optionId) ?? null;
}

/** The parameter the composer's text fills: the first multi-line text, else the first text. */
export function promptParameter(manifest: ComfyWorkflowManifest): ComfyParameter | null {
  const texts = manifest.parameters.filter((parameter) => parameter.kind === "text");
  const multiline = texts.find((parameter) => parameter.multiline === true);
  if (multiline) return multiline;
  return texts[0] ?? null;
}

/**
 * The workflows a composer offers: asked from a picture, those that take one;
 * asked of the board, which has no picture to give, those that need none. A
 * workflow ComfyUI cannot run is shown, not pickable.
 */
export function workflowOptions(
  entries: readonly ComfyLibraryEntry[],
  context: ComposerTargetContext,
): ComposerTargetOption[] {
  const fromPicture = sourceImage(context) !== null;
  let offered = filterEntries(entries, "", fromPicture);
  if (!fromPicture) offered = offered.filter((entry) => !needsPicture(entry.manifest));
  return offered.map((entry) => {
    const unavailable = describeAvailability(entry.availability);
    return {
      id: entryKey(entry),
      label: entry.manifest.name,
      hint: unavailable ?? entry.manifest.description,
      disabled: unavailable !== null,
    };
  });
}

/** Whether a workflow cannot run without a picture: it has an image input with no default. */
function needsPicture(manifest: ComfyWorkflowManifest): boolean {
  const image = imageParameter(manifest);
  return image !== null && image.default === undefined;
}

/**
 * Parameters the form under the composer shows: all but the one its text fills
 * and the picture its card fills.
 */
export function formParameters(
  manifest: ComfyWorkflowManifest,
  context: ComposerTargetContext,
): ComfyParameter[] {
  const prompt = promptParameter(manifest);
  const image = imageParameter(manifest);
  const filledImage = image !== null && sourceImage(context) !== null;
  return manifest.parameters.filter((parameter) => {
    if (parameter === prompt) return false;
    if (parameter === image && filledImage) return false;
    return true;
  });
}

/** What the run is given: defaults, the card's picture, the form's values, and the text. */
export function requestValues(
  manifest: ComfyWorkflowManifest,
  request: ComposerTargetRequest,
): FormValues {
  const values: FormValues = {
    ...initialValues(manifest, sourceImage(request.context)),
    ...formValues(request.values),
  };
  const prompt = promptParameter(manifest);
  if (prompt) values[prompt.id] = request.text;
  return values;
}

/** Why the workflow cannot run yet, in a few words; null when it can. */
export function blockedReason(
  entry: ComfyLibraryEntry,
  request: ComposerTargetRequest,
): string | null {
  const unavailable = describeAvailability(entry.availability);
  if (unavailable !== null) return unavailable;
  const missing = missingRequired(entry.manifest, requestValues(entry.manifest, request));
  if (missing.length === 0) return null;
  return `Needs ${missing.map((parameter) => parameter.label.toLowerCase()).join(", ")}`;
}

/**
 * The run a request becomes. Its result goes where it was asked for; with no
 * picture to sit beside, into the board on screen rather than a folder of its own.
 */
export function runInput(
  entry: ComfyLibraryEntry,
  request: ComposerTargetRequest,
): ComfyRunWorkflowInput {
  const { context } = request;
  const input: ComfyRunWorkflowInput = {
    cwd: context.cwd,
    source: entry.source,
    workflowId: entry.manifest.id,
    values: valuesToSend(requestValues(entry.manifest, request)),
  };
  if (context.at) input.at = context.at;
  if (sourceImage(context) === null) input.outputDirectory = context.boardDirectory;
  return input;
}

/** The form's values as the workflow form keeps them; anything else is dropped. */
export function formValues(values: Record<string, unknown>): FormValues {
  const kept: FormValues = {};
  for (const [id, value] of Object.entries(values)) {
    if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
      kept[id] = value;
    }
  }
  return kept;
}
