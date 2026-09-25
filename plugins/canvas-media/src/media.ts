import type { CanvasObject } from "@nib-ui/ui-contracts";

/** What the board draws it as, derived from the type the server sniffed. */
export type MediaType = "image" | "gif" | "video" | "pdf";

export interface MediaObject extends CanvasObject {
  kind: "media";
  x: number;
  y: number;
  assetId: string;
  mediaType: MediaType;
  w?: number;
  h?: number;
  /** The dropped file's name. Only a pdf shows it — the others are the picture. */
  name?: string;
  /**
   * Where the picture came from, when it came from somewhere with a page of its
   * own — a pin, a post. The board draws the stored bytes either way; this is
   * what a task is told the picture is.
   */
  sourceUrl?: string;
}

export const MEDIA_MIN_SIZE = 48;
export const MEDIA_DEFAULT_SIZE = 320;

const TYPES: Record<string, MediaType> = {
  "image/png": "image",
  "image/jpeg": "image",
  "image/webp": "image",
  "image/gif": "gif",
  "video/mp4": "video",
  "video/webm": "video",
  "application/pdf": "pdf",
};

/** Extensions of the same set, for a file named rather than typed — a workspace path. */
const EXTENSIONS: Record<string, MediaType> = {
  png: "image",
  jpg: "image",
  jpeg: "image",
  webp: "image",
  gif: "gif",
  mp4: "video",
  webm: "video",
  pdf: "pdf",
};

export function mediaTypeFor(contentType: string): MediaType | null {
  return TYPES[contentType.split(";")[0]!.trim().toLowerCase()] ?? null;
}

const MIMES: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
  gif: "image/gif",
  mp4: "video/mp4",
  webm: "video/webm",
  pdf: "application/pdf",
};

/**
 * The type a stored asset is sent to a harness as. The object carries only what
 * the board draws it as, so the id's own extension — the one the server sniffed
 * the bytes into — is what names the format again.
 */
export function mediaMime(assetId: string): string {
  const extension = assetId.slice(assetId.lastIndexOf(".") + 1).toLowerCase();
  return MIMES[extension] ?? "application/octet-stream";
}

export function mediaTypeForName(fileName: string): MediaType | null {
  const extension = fileName.slice(fileName.lastIndexOf(".") + 1).toLowerCase();
  return EXTENSIONS[extension] ?? null;
}

/** True for a file worth uploading at all, so a paste can be declined early. */
export function isMediaFile(file: File): boolean {
  return mediaTypeFor(file.type) !== null;
}

export function parseMedia(raw: unknown): MediaObject | null {
  if (!raw || typeof raw !== "object") return null;
  const candidate = raw as Partial<MediaObject>;
  if (candidate.kind !== "media" || typeof candidate.id !== "string") return null;
  if (typeof candidate.x !== "number" || typeof candidate.y !== "number") return null;
  if (typeof candidate.assetId !== "string" || candidate.assetId.length === 0) return null;
  const mediaType = candidate.mediaType;
  if (mediaType !== "image" && mediaType !== "gif" && mediaType !== "video" && mediaType !== "pdf")
    return null;

  return {
    kind: "media",
    id: candidate.id,
    x: candidate.x,
    y: candidate.y,
    assetId: candidate.assetId,
    mediaType,
    ...(typeof candidate.w === "number" && { w: Math.max(MEDIA_MIN_SIZE, candidate.w) }),
    ...(typeof candidate.h === "number" && { h: Math.max(MEDIA_MIN_SIZE, candidate.h) }),
    ...(typeof candidate.name === "string" && { name: candidate.name }),
    ...(typeof candidate.sourceUrl === "string" && { sourceUrl: candidate.sourceUrl }),
  };
}

/**
 * Fits the intrinsic size into a box without upscaling, so a screenshot lands at
 * a sane size on the board rather than at whatever the display's pixel count is.
 */
export function fitSize(
  width: number,
  height: number,
  box = MEDIA_DEFAULT_SIZE,
): { width: number; height: number } {
  if (width <= 0 || height <= 0) return { width: box, height: box };
  const scale = Math.min(1, box / Math.max(width, height));
  return { width: Math.round(width * scale), height: Math.round(height * scale) };
}
