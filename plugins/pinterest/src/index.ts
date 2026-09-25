import type { Plugin } from "@nib-ui/kernel";
import { fitSize, type MediaObject, mediaTypeFor } from "@nib-ui/plugin-canvas-media";
import type { Point } from "@nib-ui/ui-contracts";
import PushPinIcon from "phosphor-svelte/lib/PushPinIcon";
import { storePinImage } from "./client";
import PinterestPane from "./PinterestPane.svelte";
import PinterestSettings from "./PinterestSettings.svelte";
import { parsePinTransfer, pinFileName, type PinterestPin, pinTransferType } from "./pins";
import { pinterestState } from "./state.svelte";

export const pinterestPaneId = "pinterest.pins";

let counter = 0;

function createId(): string {
  counter += 1;
  return `pin-media:${Date.now().toString(36)}:${counter.toString(36)}`;
}

export const pinterestPlugin: Plugin = {
  name: "pinterest",
  inject: ["canvas", "panes", "commands", "slots"],
  apply(ctx) {
    const canvas = ctx.require("canvas");
    const panes = ctx.require("panes");

    ctx.effect(() =>
      panes.register({
        id: pinterestPaneId,
        kind: "pinterest",
        title: "Pins",
        icon: PushPinIcon,
        component: PinterestPane,
      }),
    );
    ctx.effect(() =>
      ctx
        .require("slots")
        .register("settings.section", { component: PinterestSettings, order: 20 }),
    );
    ctx.effect(() =>
      ctx.require("commands").register({
        id: "pinterest.toggle",
        title: "Toggle the Pinterest pane",
        run: () => panes.toggle(pinterestPaneId),
      }),
    );

    pinterestState.openSettings = () => panes.open("settings");

    /**
     * The picture is copied into the asset store before the object is placed:
     * a board that outlives the pin draws it from the app's own bytes, and the
     * shape it lands at is the pin's, not a square that pops once it loads.
     */
    const place = async (pins: PinterestPin[], at: Point): Promise<boolean> => {
      let x = at.x;
      for (const pin of pins) {
        const asset = await storePinImage(pin.imageUrl).catch((cause: unknown) => {
          pinterestState.error = `could not copy ${pin.title}: ${cause instanceof Error ? cause.message : String(cause)}`;
          return null;
        });
        if (!asset) continue;

        const mediaType = mediaTypeFor(asset.contentType);
        if (!mediaType) {
          pinterestState.error = `the board does not draw ${asset.contentType}`;
          continue;
        }

        const size = fitSize(pin.width, pin.height);
        canvas.addObject({
          kind: "media",
          id: createId(),
          x: Math.round(x),
          y: Math.round(at.y),
          assetId: asset.assetId,
          mediaType,
          w: size.width,
          h: size.height,
          name: pinFileName(pin),
          sourceUrl: pin.url,
        } satisfies MediaObject);
        x += size.width + 16;
      }
      return true;
    };

    // Ahead of the media and link handlers: a dragged pin also carries its page
    // as text, which the links handler would otherwise place as a bookmark.
    ctx.effect(() =>
      canvas.registerDropHandler({
        order: 5,
        handle: (payload, at) => {
          const dragged = payload.data?.[pinTransferType];
          if (!dragged) return false;
          const pins = parsePinTransfer(dragged);
          return pins.length > 0 ? place(pins, at) : false;
        },
      }),
    );

    ctx.effect(() => () => {
      pinterestState.openSettings = null;
    });
  },
};

export {
  type PinAsset,
  type PinterestCredentials,
  type PinterestStatus,
  fetchPinterestBoards,
  fetchPinterestPins,
  fetchPinterestStatus,
  storePinImage,
} from "./client";
export {
  type PinterestBoard,
  type PinterestPin,
  parsePinTransfer,
  pinFileName,
  pinTransferType,
} from "./pins";
