/**
 * The workflow picker's logic, kept out of the components: which workflows a
 * search shows, what the form starts with, and how availability reads.
 */

import type {
  ComfyAvailability,
  ComfyLibraryEntry,
  ComfyParameter,
  ComfyWorkflowManifest,
} from "@nib-ui/ui-contracts";

/** A form's values, keyed by parameter id. */
export type FormValues = Record<string, string | number | boolean>;

/** Where a library entry is addressed: its source and id. */
export function entryKey(entry: ComfyLibraryEntry): string {
  return `${entry.source}:${entry.manifest.id}`;
}

/** The first image parameter, which a picture from the board fills. */
export function imageParameter(manifest: ComfyWorkflowManifest): ComfyParameter | null {
  return manifest.parameters.find((parameter) => parameter.kind === "image") ?? null;
}

/**
 * Entries matching every word of the query in their name, description or
 * category; with `needsImage`, only those that take a picture.
 */
export function filterEntries(
  entries: readonly ComfyLibraryEntry[],
  query: string,
  needsImage: boolean,
): ComfyLibraryEntry[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  return entries.filter((entry) => {
    if (needsImage && !imageParameter(entry.manifest)) return false;
    const { name, description, category } = entry.manifest;
    const text = `${name} ${description} ${category}`.toLowerCase();
    return words.every((word) => text.includes(word));
  });
}

/** Entries grouped by category, categories in first-seen order. */
export function groupByCategory(
  entries: readonly ComfyLibraryEntry[],
): { category: string; entries: ComfyLibraryEntry[] }[] {
  const groups = new Map<string, ComfyLibraryEntry[]>();
  for (const entry of entries) {
    let group = groups.get(entry.manifest.category);
    if (!group) {
      group = [];
      groups.set(entry.manifest.category, group);
    }
    group.push(entry);
  }
  return [...groups].map(([category, grouped]) => ({ category, entries: grouped }));
}

/**
 * What the form starts with: each parameter's default, the picture it was opened
 * for in the first image parameter, and seeds left empty so each run draws one.
 */
export function initialValues(
  manifest: ComfyWorkflowManifest,
  imagePath: string | null,
): FormValues {
  const values: FormValues = {};
  for (const parameter of manifest.parameters) {
    if (parameter.default !== undefined && parameter.kind !== "seed") {
      values[parameter.id] = parameter.default;
    }
  }
  const image = imageParameter(manifest);
  if (image && imagePath !== null) values[image.id] = imagePath;
  return values;
}

/** The values a run is sent: empty fields left out so the server applies defaults. */
export function valuesToSend(values: FormValues): Record<string, unknown> {
  const sent: Record<string, unknown> = {};
  for (const [id, value] of Object.entries(values)) {
    if (value === "") continue;
    sent[id] = value;
  }
  return sent;
}

/** Parameters that have to be filled before the run button does anything. */
export function missingRequired(
  manifest: ComfyWorkflowManifest,
  values: FormValues,
): ComfyParameter[] {
  return manifest.parameters.filter((parameter) => {
    if (parameter.default !== undefined || parameter.kind === "seed") return false;
    const value = values[parameter.id];
    return value === undefined || value === "";
  });
}

/** Why a workflow cannot run, in one line; null when it can or when nobody knows yet. */
export function describeAvailability(availability: ComfyAvailability | null): string | null {
  if (!availability || availability.available) return null;
  const parts: string[] = [];
  if (availability.missingNodes.length > 0) {
    parts.push(`nodes ${availability.missingNodes.join(", ")}`);
  }
  const files = [...new Set(availability.missingValues.map((missing) => missing.value))];
  if (files.length > 0) parts.push(files.join(", "));
  return `Missing ${parts.join("; ")}`;
}
