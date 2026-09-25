/**
 * The `.nib` vault inside a project directory, as the server serves it.
 *
 * The project directory *is* the vault root: a board is one directory's canvas
 * (PLAN §5), and the board's `cwd` is that directory, so no walking upwards is
 * needed to find a vault.
 *
 * Nothing is cached yet. A scan is a directory walk over text files, and the
 * watcher that would make a cache worth invalidating is not built (§14 step 6).
 */

import { createReadStream } from "node:fs";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { join, resolve, sep } from "node:path";
import {
  toSnapshot,
  unlinkedMentions,
  VAULT_DIRECTORY,
  VAULT_GUIDE,
  VAULT_GUIDE_FILE,
  type VaultDoc,
} from "@nib-ui/vault";
import { scanVault } from "@nib-ui/vault/scan";

export { VAULT_DIRECTORY };

/** Media lives in the vault, so this is the ceiling on what a card can show inline. */
export const MAX_VAULT_FILE_BYTES = 16 * 1024 * 1024;

/** Absolute path of a project's vault. The project directory is the vault root. */
export function vaultRoot(cwd: string): string {
  return join(cwd, VAULT_DIRECTORY);
}

/**
 * A vault-relative path resolved against its root, or `null` for anything that
 * escapes it. Every read and every write goes through here: the vault is a
 * directory the user owns, and a path from a client is not to be trusted with it.
 */
export function confineToVault(root: string, path: string): string | null {
  const absolute = resolve(root, path);
  if (absolute === root) return absolute;
  if (!absolute.startsWith(`${root}${sep}`)) return null;
  return absolute;
}

export interface VaultOpenOptions {
  previewChars?: number;
  /** Computed on request: quadratic in the number of items. */
  mentions?: boolean;
}

export interface VaultOpenResult extends VaultDoc {
  /** Absolute path of the vault directory. */
  root: string;
}

/**
 * Opening a project creates its vault, so a directory with nothing in it is still a
 * project rather than an error (PLAN §3). A vault that cannot be created is reported
 * and the project opens anyway: losing the board is better than losing the boot.
 */
export async function openVault(
  cwd: string,
  options: VaultOpenOptions = {},
): Promise<VaultOpenResult> {
  const root = vaultRoot(cwd);
  const failure = await ensureVault(root);
  const index = await scanVault(root);

  return {
    cwd,
    root,
    writable: failure === null,
    reason: failure,
    ...toSnapshot(index, {
      previewChars: options.previewChars,
      mentions: options.mentions ? unlinkedMentions(index) : undefined,
    }),
  };
}

/**
 * The guide is seeded only by the call that creates the vault — `mkdir` names the
 * first directory it made and nothing otherwise — so a guide the user deleted or
 * rewrote is never restored on the next open (PLAN §8).
 */
async function ensureVault(root: string): Promise<string | null> {
  try {
    const created = await mkdir(root, { recursive: true });
    if (created !== undefined) await writeFile(join(root, VAULT_GUIDE_FILE), VAULT_GUIDE);
    return null;
  } catch (cause) {
    return describe(cause);
  }
}

export interface VaultFile {
  bytes: Buffer;
  contentType: string;
}

/**
 * One file's bytes, addressed the way the board addresses it: a vault-relative
 * path. Anything that escapes the vault, is not a regular file, or is over the cap
 * reads as `null` rather than throwing: a card that cannot load its image should
 * not take the board with it.
 */
export async function readVaultFile(
  cwd: string,
  path: string,
  options: { maxBytes?: number } = {},
): Promise<VaultFile | null> {
  const absolute = confineToVault(vaultRoot(cwd), path);
  if (absolute === null) return null;

  const maxBytes = options.maxBytes ?? MAX_VAULT_FILE_BYTES;
  try {
    const info = await stat(absolute);
    if (!info.isFile()) return null;
    if (info.size > maxBytes) return null;
    return { bytes: await readFile(absolute), contentType: contentTypeOf(path) };
  } catch {
    return null;
  }
}

/** What a file is, without reading it: what a range request is answered from. */
export interface VaultFileInfo {
  absolute: string;
  size: number;
  contentType: string;
}

/**
 * A file's size and type, for serving it a piece at a time. There is no cap here
 * and there is no read: a clip is played out of the vault rather than loaded from
 * it, and a player that cannot ask for the middle of a file cannot seek in it.
 */
export async function statVaultFile(cwd: string, path: string): Promise<VaultFileInfo | null> {
  const absolute = confineToVault(vaultRoot(cwd), path);
  if (absolute === null) return null;

  try {
    const info = await stat(absolute);
    if (!info.isFile()) return null;
    return { absolute, size: info.size, contentType: contentTypeOf(path) };
  } catch {
    return null;
  }
}

/** Inclusive byte offsets, as a `Range` header states them. */
export interface ByteRange {
  start: number;
  end: number;
}

/**
 * The range a request is asking for, or null to serve the whole file. Only the
 * single-range forms are understood — `bytes=0-`, `bytes=64-127`, `bytes=-512` —
 * which is every form a media element sends. Anything else, and anything that
 * does not land inside the file, reads as null: the whole file is a valid answer
 * to a range nobody can satisfy, and a player takes it.
 */
export function parseByteRange(header: string | null, size: number): ByteRange | null {
  if (header === null || size <= 0) return null;
  const match = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!match) return null;

  const [, from, to] = match;
  if (from === "" && to === "") return null;

  // `bytes=-512` is the last 512 bytes, not a range starting at nothing.
  if (from === "") {
    const suffix = Number(to);
    if (!Number.isFinite(suffix) || suffix <= 0) return null;
    return { start: Math.max(0, size - suffix), end: size - 1 };
  }

  const start = Number(from);
  const end = to === "" ? size - 1 : Math.min(Number(to), size - 1);
  if (!Number.isFinite(start) || start < 0 || start >= size || end < start) return null;
  return { start, end };
}

/**
 * One file, or one range of it, as a stream the response body can be.
 *
 * Read paused and resumed against the consumer rather than drained into memory:
 * a clip is the one thing in a vault bigger than the machine wants to hold.
 *
 * Built by hand rather than with `Readable.toWeb`, which returns node's own
 * `ReadableStream` — the same object as the DOM's at runtime, an unrelated
 * declaration at build time, and a response body wants the DOM's.
 */
export function vaultFileStream(
  info: VaultFileInfo,
  range?: ByteRange,
): ReadableStream<Uint8Array> {
  const file = range
    ? createReadStream(info.absolute, { start: range.start, end: range.end })
    : createReadStream(info.absolute);

  return new ReadableStream<Uint8Array>({
    start(controller) {
      file.on("data", (chunk) => {
        controller.enqueue(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
        if ((controller.desiredSize ?? 1) <= 0) file.pause();
      });
      file.on("end", () => controller.close());
      file.on("error", (cause) => controller.error(cause));
    },
    pull() {
      file.resume();
    },
    cancel() {
      file.destroy();
    },
  });
}

/**
 * Nothing is ever served as a document. An `.html` or `.svg` in a vault is a file
 * the user owns, not a page for this origin to run, so anything that a browser
 * would execute is handed over as text it can only display.
 */
const CONTENT_TYPES: Record<string, string> = {
  md: "text/plain; charset=utf-8",
  markdown: "text/plain; charset=utf-8",
  txt: "text/plain; charset=utf-8",
  jsonl: "text/plain; charset=utf-8",
  json: "application/json",
  csv: "text/plain; charset=utf-8",
  yaml: "text/plain; charset=utf-8",
  yml: "text/plain; charset=utf-8",
  toml: "text/plain; charset=utf-8",
  html: "text/plain; charset=utf-8",
  svg: "image/svg+xml",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  avif: "image/avif",
  bmp: "image/bmp",
  ico: "image/x-icon",
  pdf: "application/pdf",
  mp4: "video/mp4",
  webm: "video/webm",
  mov: "video/quicktime",
  mp3: "audio/mpeg",
  wav: "audio/wav",
  ogg: "audio/ogg",
  flac: "audio/flac",
  m4a: "audio/mp4",
  glb: "model/gltf-binary",
  gltf: "model/gltf+json",
};

function contentTypeOf(path: string): string {
  const base = path.slice(path.lastIndexOf("/") + 1);
  const dot = base.lastIndexOf(".");
  if (dot <= 0) return "application/octet-stream";
  return CONTENT_TYPES[base.slice(dot + 1).toLowerCase()] ?? "application/octet-stream";
}

function describe(cause: unknown): string {
  if (cause instanceof Error) return cause.message;
  return String(cause);
}
