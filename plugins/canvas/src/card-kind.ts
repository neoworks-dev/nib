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

export type CardKind = "sticky" | "sheet" | "visual" | "webclip" | "folder";

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
 * is a sheet, because a card that can only name its file is still a page.
 *
 * `truncated` is decisive on its own: the server clipped the body, so there is
 * more of it than the preview holds, and that is already more than a sticky.
 */
export function cardKindFor(item: VaultSnapshotItem): CardKind {
  if (item.kind === "topic") return "folder";
  if (isImagePath(item.path) || isVideoPath(item.path)) return "visual";
  if (!isMarkdownPath(item.path)) return "sheet";
  if (urlBody(item.preview) !== null && !item.truncated) return "webclip";
  if (item.truncated) return "sheet";
  return bodyLineCount(item.preview) <= STICKY_MAX_LINES ? "sticky" : "sheet";
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
