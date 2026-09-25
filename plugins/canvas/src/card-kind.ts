/**
 * What a vault item is drawn as. Nothing on the board is authored: a card's kind
 * is read off the item's own content and extension, never off frontmatter (PLAN
 * decision 2). A note does not declare that it is a sticky — it is one because it
 * is short, and it becomes a sheet by being written.
 *
 * Pure: no Pixi, no reactivity, no vault access. It is handed what the snapshot
 * already carries.
 */

import type { VaultSnapshotItem } from "@nib-ui/vault";

export type CardKind =
  "sticky" | "sheet" | "visual" | "webclip" | "folder" | "file" | "transcript" | "diagram";

/**
 * A markdown body of at most this many lines is a sticky; anything longer is a
 * sheet. The one number the split turns on, so the boundary is a thing that can
 * be argued about in one place rather than a rule spread across renderers.
 */
export const STICKY_MAX_LINES = 12;

/** Drawn as the picture itself rather than as a card describing one. */
const IMAGE_EXTENSIONS = new Set([
  "png",
  "jpg",
  "jpeg",
  "gif",
  "webp",
  "avif",
  "bmp",
  "ico",
  "svg",
  "heic",
  "tiff",
]);

const VIDEO_EXTENSIONS = new Set(["mp4", "mov", "webm", "avi", "m4v"]);

const MARKDOWN_EXTENSIONS = new Set(["md", "markdown"]);

/** A file that is nothing but a diagram: its whole body is the mermaid source. */
const DIAGRAM_EXTENSIONS = new Set(["mmd", "mermaid"]);

/** Only the two schemes a capture can be taken of. */
const URL_PATTERN = /^https?:\/\/\S+$/i;

export function extensionOf(path: string): string {
  const base = path.slice(path.lastIndexOf("/") + 1);
  const dot = base.lastIndexOf(".");
  if (dot <= 0) return "";
  return base.slice(dot + 1).toLowerCase();
}

export function isImagePath(path: string): boolean {
  return IMAGE_EXTENSIONS.has(extensionOf(path));
}

export function isVideoPath(path: string): boolean {
  return VIDEO_EXTENSIONS.has(extensionOf(path));
}

export function isMarkdownPath(path: string): boolean {
  return MARKDOWN_EXTENSIONS.has(extensionOf(path));
}

export function isDiagramPath(path: string): boolean {
  return DIAGRAM_EXTENSIONS.has(extensionOf(path));
}

/**
 * A chat. A `.jsonl` in a vault is a transcript by construction — the host writes
 * one per session into the project it is about (PLAN §7) — and its name is the
 * session id, which is how the card reaches the live projection of the chat.
 */
export function isTranscriptPath(path: string): boolean {
  return extensionOf(path) === "jsonl";
}

/** The session a transcript is of: its file name without the extension. */
export function sessionIdOf(path: string): string {
  const base = path.slice(path.lastIndexOf("/") + 1);
  return base.slice(0, base.lastIndexOf("."));
}

/**
 * The url a webclip stands for, or null for a body that is anything else. A
 * webclip is a markdown file whose **whole** body is one url: a note that merely
 * opens with a link is still a note, and drawing it as a page capture would lose
 * everything written under it.
 *
 * Frontmatter is not body, so a file carrying `id:` or `title:` still qualifies.
 */
export function urlBody(body: string): string | null {
  const text = stripFrontmatter(body).trim();
  if (text.length === 0) return null;
  if (!URL_PATTERN.test(text)) return null;
  return text;
}

/**
 * The mermaid source a note is, or null for a note that is anything else. The
 * rule is `urlBody`'s: a note whose **whole** body is one mermaid fence stands
 * for that diagram, while a note that merely contains one among its prose is a
 * note — drawing it as the diagram alone would lose everything written around it.
 *
 * Frontmatter is not body, so a file carrying `id:` or `title:` still qualifies.
 */
export function mermaidBody(body: string): string | null {
  const text = stripFrontmatter(body).trim();
  const match = /^(```|~~~)[ \t]*mermaid[ \t]*\n([\s\S]*?)\n[ \t]*\1$/.exec(text);
  if (!match) return null;

  const source = match[2] ?? "";
  return source.trim().length === 0 ? null : source;
}

/**
 * What a diagram card draws from: the whole file for a `.mmd`, and the one fence
 * for a note that is nothing but a diagram. Null for anything that is not one.
 */
export function diagramSource(path: string, body: string): string | null {
  if (isDiagramPath(path)) {
    const text = body.trim();
    return text.length === 0 ? null : text;
  }
  return mermaidBody(body);
}

/**
 * How many lines a body is worth, for the sticky/sheet split. Blank lines at the
 * ends do not count, and a run of them in the middle counts once: a note spaced
 * out with empty lines is not a longer note.
 */
export function bodyLineCount(body: string): number {
  const lines = stripFrontmatter(body).trim().split("\n");
  let count = 0;
  let blank = false;

  for (const line of lines) {
    if (line.trim().length === 0) {
      if (!blank) count += 1;
      blank = true;
      continue;
    }
    blank = false;
    count += 1;
  }
  return count;
}

/**
 * What this item is drawn as. A directory is a folder; a picture or a clip is a
 * visual; markdown splits three ways by what is written in it; and anything else
 * is a file.
 *
 * A file is not a sheet. The vault reads bodies for markdown only, so a `.zip`
 * drawn as a sheet is a page with a filename at the top and nothing under it,
 * and opening one puts its raw bytes in a prose editor.
 *
 * A transcript is the exception among the files the vault cannot read: it has a
 * live session behind it, so the card draws the chat rather than the file name.
 *
 * `truncated` is decisive on its own: the server clipped the body, so there is
 * more of it than the preview holds, and that is already more than a sticky.
 */
export function cardKindFor(item: VaultSnapshotItem): CardKind {
  if (item.kind === "topic") return "folder";
  if (isImagePath(item.path) || isVideoPath(item.path)) return "visual";
  if (isTranscriptPath(item.path)) return "transcript";
  // A `.mmd` is a diagram whatever is in it. Its body is read like markdown's,
  // so a truncated one is still drawn — mermaid says what it makes of the rest.
  if (isDiagramPath(item.path)) return "diagram";
  if (!isMarkdownPath(item.path)) return "file";
  if (urlBody(item.preview) !== null && !item.truncated) return "webclip";
  if (mermaidBody(item.preview) !== null && !item.truncated) return "diagram";
  if (item.truncated) return "sheet";
  return bodyLineCount(item.preview) <= STICKY_MAX_LINES ? "sticky" : "sheet";
}

/**
 * The title a note shows and the body left under it. A markdown file names
 * itself with its opening heading far more often than it carries a `title:`, and
 * a card that drew both would print the same line twice — once as its headline
 * and once as the first thing in its prose.
 *
 * Only a heading that opens the body counts. One further down is a section of
 * the note, not its name.
 *
 * `offset` is how many lines were taken off the front. A card ticking a task
 * writes back to the file, and the file still has the heading: without this the
 * write lands as many lines above the box as the title was tall.
 */
export function headingTitle(body: string): {
  title: string | null;
  body: string;
  offset: number;
} {
  const text = body.trimStart();
  const match = /^#{1,3}[ \t]+(.+?)[ \t]*(?:\n|$)/.exec(text);
  if (!match) return { title: null, body, offset: 0 };

  const title = match[1] ?? "";
  if (title.length === 0) return { title: null, body, offset: 0 };

  const rest = text.slice(match[0].length).trimStart();
  const removed = body.slice(0, body.length - rest.length);
  return { title, body: rest, offset: removed.split("\n").length - 1 };
}

/**
 * Frontmatter is metadata, not content, so neither the line count nor the url
 * test may see it. Only a block that opens the file counts.
 */
function stripFrontmatter(body: string): string {
  if (!body.startsWith("---")) return body;
  const end = body.indexOf("\n---", 3);
  if (end === -1) return body;

  const after = body.indexOf("\n", end + 1);
  // The closing `---` is the last line: the file is frontmatter and nothing else.
  if (after === -1) return "";
  return body.slice(after + 1);
}
