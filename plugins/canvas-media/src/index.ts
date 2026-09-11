import type { Plugin } from "@nib-ui/kernel";
import { boardTheme, TextTextureCache } from "@nib-ui/plugin-canvas";
import type { CanvasPastePayload, CanvasRegistry, Point } from "@nib-ui/ui-contracts";
import { assetUrl, measureMedia, storeWorkspaceAsset, uploadMedia } from "./client";
import { mediaKind } from "./MediaRenderer";
import {
  isMediaFile,
  type MediaObject,
  mediaMime,
  mediaTypeFor,
  mediaTypeForName,
  parseMedia,
} from "./media";

let counter = 0;

function createId(): string {
  counter += 1;
  return `media:${Date.now().toString(36)}:${counter.toString(36)}`;
}

/**
 * Held so a file the session already has can be placed without a pane or a
 * component in hand. Set only while the plugin is loaded.
 */
let registry: CanvasRegistry | null = null;

export interface WorkspaceMediaPlacement {
  sessionId: string;
  /** Workspace-relative, as the session names it. */
  path: string;
  /** World point for the top-left corner. Defaults to the top-left of the view. */
  at?: Point;
}

/**
 * Places a file that already exists in a session's workspace. The bytes go from
 * the workspace into the asset store server-side; only the stored copy is read
 * back here, and only to measure what shape the object should land at.
 */
export async function placeWorkspaceMedia(
  placement: WorkspaceMediaPlacement,
): Promise<string | null> {
  const canvas = registry;
  if (!canvas) throw new Error("the canvas-media plugin is not loaded");

  const asset = await storeWorkspaceAsset(placement.sessionId, placement.path);
  const mediaType = mediaTypeFor(asset.contentType) ?? mediaTypeForName(asset.path);
  if (!mediaType) return null;

  const stored = await fetch(assetUrl(asset.assetId));
  const size = stored.ok
    ? await measureMedia(await stored.blob(), mediaType)
    : { width: 320, height: 320 };
  const at = placement.at ?? canvas.screenToWorld(96, 96);
  const id = createId();
  canvas.addObject({
    kind: "media",
    id,
    x: Math.round(at.x),
    y: Math.round(at.y),
    assetId: asset.assetId,
    mediaType,
    w: size.width,
    h: size.height,
    name: asset.path.slice(asset.path.lastIndexOf("/") + 1),
  } satisfies MediaObject);
  return id;
}

export const canvasMediaPlugin: Plugin = {
  name: "canvas-media",
  inject: ["canvas"],
  apply(ctx) {
    const canvas = ctx.require("canvas");
    const textures = new TextTextureCache(64);
    registry = canvas;

    ctx.effect(() =>
      canvas.registerKind(
        mediaKind({
          textures,
          theme: boardTheme,
          openAsset: (assetId) => void globalThis.open(assetUrl(assetId), "_blank", "noopener"),
        }),
      ),
    );

    /** Dropped files land in a row rather than stacked on one point. */
    const place = async (files: File[], at: Point): Promise<boolean> => {
      const media = files.filter(isMediaFile);
      if (media.length === 0) return false;

      let x = at.x;
      for (const file of media) {
        const uploaded = await uploadMedia(file).catch(() => null);
        if (!uploaded) continue;
        canvas.addObject({
          kind: "media",
          id: createId(),
          x: Math.round(x),
          y: Math.round(at.y),
          assetId: uploaded.assetId,
          mediaType: uploaded.mediaType,
          w: uploaded.width,
          h: uploaded.height,
          name: uploaded.name,
        } satisfies MediaObject);
        x += uploaded.width + 16;
      }
      return true;
    };

    ctx.effect(() =>
      canvas.registerPasteHandler({
        order: 10,
        // Claimed only when there is a file: a copied image arrives with an
        // HTML fallback the links handler would otherwise have to skip past.
        handle: (payload: CanvasPastePayload, at) => place(payload.files, at),
      }),
    );
    ctx.effect(() =>
      canvas.registerDropHandler({ order: 10, handle: (payload, at) => place(payload.files, at) }),
    );

    // A picture linked to a task travels with its prompt: the harness looks at an
    // image itself and opens the rest from the path the attachment resolves to.
    ctx.effect(() =>
      canvas.registerContextProvider({
        order: 10,
        contextFor: (object) => {
          const media = parseMedia(object);
          if (!media) return null;
          const name = media.name ?? media.assetId;
          return {
            label: name,
            attachments: [{ assetId: media.assetId, mime: mediaMime(media.assetId), name }],
          };
        },
      }),
    );
    ctx.effect(() => () => {
      textures.clear();
      registry = null;
    });
  },
};

export {
  type AssetRef,
  assetUrl,
  measureMedia,
  storeWorkspaceAsset,
  uploadAsset,
  uploadMedia,
  type WorkspaceAsset,
} from "./client";
export {
  fitSize,
  isMediaFile,
  type MediaObject,
  type MediaType,
  mediaTypeFor,
  mediaTypeForName,
  parseMedia,
} from "./media";
