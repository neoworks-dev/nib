/**
 * ComfyUI writes the workflow that made an image into the PNG: the UI graph under
 * `workflow` and the API prompt under `prompt`, each as a text chunk. Reading them
 * back is how a picture from ComfyUI opens in the editor.
 */

import type { ComfyGraph, ComfyWorkflow } from "@nib-ui/ui-contracts";
import { asRecord } from "./definitions";
import { workflowSchema } from "./manifest";

const SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

export interface EmbeddedWorkflow {
  graph: ComfyGraph | null;
  workflow: ComfyWorkflow | null;
}

/** Whether the bytes start like a PNG. */
export function isPng(bytes: Uint8Array): boolean {
  return SIGNATURE.every((byte, index) => bytes[index] === byte);
}

/** A PNG's size in pixels from its header, or null for anything that is not a PNG. */
export function pngSize(bytes: Uint8Array): { width: number; height: number } | null {
  // The signature, then IHDR: length, type, width, height — both big-endian.
  if (!isPng(bytes) || bytes.length < 24) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const width = view.getUint32(16);
  const height = view.getUint32(20);
  if (width === 0 || height === 0) return null;
  return { width, height };
}

/** The text chunks of a PNG by keyword; `tEXt` and uncompressed `iTXt`. */
export function pngTextChunks(bytes: Uint8Array): Map<string, string> {
  const chunks = new Map<string, string>();
  if (!isPng(bytes)) return chunks;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const decoder = new TextDecoder();
  let offset = SIGNATURE.length;
  while (offset + 8 <= bytes.length) {
    const length = view.getUint32(offset);
    const type = decoder.decode(bytes.subarray(offset + 4, offset + 8));
    const data = bytes.subarray(offset + 8, offset + 8 + length);
    if (type === "tEXt") addText(chunks, data, decoder);
    if (type === "iTXt") addInternationalText(chunks, data, decoder);
    if (type === "IEND") break;
    offset += 12 + length;
  }
  return chunks;
}

/** A `tEXt` chunk: keyword, NUL, text. */
function addText(chunks: Map<string, string>, data: Uint8Array, decoder: TextDecoder): void {
  const separator = data.indexOf(0);
  if (separator === -1) return;
  chunks.set(
    decoder.decode(data.subarray(0, separator)),
    decoder.decode(data.subarray(separator + 1)),
  );
}

/** An `iTXt` chunk, skipped when compressed: keyword, NUL, flag, method, language, NUL, key, NUL, text. */
function addInternationalText(
  chunks: Map<string, string>,
  data: Uint8Array,
  decoder: TextDecoder,
): void {
  const keywordEnd = data.indexOf(0);
  if (keywordEnd === -1 || data[keywordEnd + 1] !== 0) return;
  const languageEnd = data.indexOf(0, keywordEnd + 3);
  if (languageEnd === -1) return;
  const translatedEnd = data.indexOf(0, languageEnd + 1);
  if (translatedEnd === -1) return;
  chunks.set(
    decoder.decode(data.subarray(0, keywordEnd)),
    decoder.decode(data.subarray(translatedEnd + 1)),
  );
}

/** The workflow embedded in a PNG from ComfyUI, in whichever shapes it carries. */
export function readPngWorkflow(bytes: Uint8Array): EmbeddedWorkflow {
  const chunks = pngTextChunks(bytes);
  let workflow: ComfyWorkflow | null = null;
  const parsed = workflowSchema.safeParse(parseObject(chunks.get("prompt")));
  if (parsed.success) workflow = parsed.data;
  return { graph: parseObject(chunks.get("workflow")), workflow };
}

/** A chunk's JSON as an object, or null. */
function parseObject(text: string | undefined): Record<string, unknown> | null {
  if (text === undefined) return null;
  try {
    const parsed: unknown = JSON.parse(text);
    return asRecord(parsed);
  } catch {
    return null;
  }
}
