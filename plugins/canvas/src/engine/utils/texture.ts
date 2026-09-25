/**
 * Loading a card's bytes as a texture.
 *
 * Pixi picks a loader by looking at the url's file extension, and every url the
 * board loads from is a route — `/api/vault/file?path=…`, `/api/assets/<id>` —
 * whose *path* has no extension at all. `Assets.load` finds no parser and
 * rejects, which is why a picture in the vault drew as an empty card. The parser
 * is named here instead, from what the board already knows the file is.
 */

import { Assets, Texture, VideoSource } from "pixi.js";
import { extensionOf } from "../../card-kind";

/** The Pixi parser names. `loadSVG` rasterises; the other two decode. */
type Parser = "loadTextures" | "loadVideo" | "loadSVG";

/**
 * How often a clip's current frame is uploaded to the GPU, whatever the board is
 * rendering at. Above the rate anything is shot at, and half the work Pixi's own
 * default does.
 */
export const VIDEO_UPDATE_FPS = 30;

/**
 * Names the origin Pixi resolves a root-relative src against.
 *
 * Pixi derives the root itself, and its own url helper counts only `http(s):` as
 * a url. Under the desktop app's `app://nib` origin it therefore reads the root
 * as bare `app://` and drops the host, so `/api/vault/file?…` is fetched as
 * `app://api/vault/file?…` — a request no handler answers, and every picture on
 * the board draws empty. Over http this is the same value Pixi works out.
 *
 * The resolver is a singleton shared with every other plugin that loads an
 * asset, so this is set once for all of them rather than at each call site.
 */
export function configureAssetRoot(href: string = globalThis.location.href): void {
  Assets.resolver.rootPath = new URL("/", href).href;
}

export interface LoadOptions {
  /** Decode as a video rather than as a picture. */
  video?: boolean;
  /** Plays as soon as there is something to play. Defaults to true for a video. */
  autoPlay?: boolean;
}

export function parserFor(path: string, video: boolean): Parser {
  if (video) return "loadVideo";
  if (extensionOf(path) === "svg") return "loadSVG";
  return "loadTextures";
}

/**
 * What a `<source>` has to be told a video is. Pixi derives this from the url's
 * own extension, and a route carrying the path in its query string has none it
 * can read: the element is handed a type it cannot play, `canplay` never fires,
 * and the load never settles. Hence naming it from the path.
 */
export function videoMimeFor(path: string): string | undefined {
  const extension = extensionOf(path);
  if (extension.length === 0) return undefined;
  return VideoSource.MIME_TYPES[extension] ?? `video/${extension}`;
}

/**
 * `path` is only read for its extension — the bytes come from `url`, which is
 * the route the card was handed.
 */
export async function loadTexture(
  url: string,
  path: string,
  options: LoadOptions = {},
): Promise<Texture> {
  const video = options.video === true;
  if (!video) return (await Assets.load({ src: url, parser: parserFor(path, false) })) as Texture;

  return (await Assets.load({
    src: url,
    parser: parserFor(path, true),
    // The parser reads `asset.data` whether it was handed one or not, so this is
    // not only where the mime goes: without it the load throws on its own way to
    // resolving. Muted, because a browser refuses to autoplay anything else.
    data: {
      mime: videoMimeFor(path),
      autoPlay: options.autoPlay !== false,
      muted: true,
      loop: true,
      playsinline: true,
      // A clip that is not going to play itself still has to be fetched, or its
      // first frame never arrives and the card waits on a `canplay` that the
      // element was never told to work towards.
      preload: options.autoPlay === false,
      // Frames go to the GPU at the rate clips are actually shot at, not once per
      // rendered frame. Pixi's default uploads the whole source every tick, which
      // on a board of clips is the same picture sent twice for nothing.
      updateFPS: VIDEO_UPDATE_FPS,
    },
  })) as Texture;
}

/**
 * How much bigger than its own size a diagram is drawn into its texture, so a
 * card zoomed into is not a blurred one. The board is not re-rasterised as the
 * camera moves: an SVG is decoded on the main thread, and a diagram redrawn on
 * every zoom step would stall the board in a way a picture never does.
 */
const SVG_SCALE = 2;
/** And the ceiling on that, because a wide flow chart is wide before it is scaled. */
const SVG_MAX_PIXELS = 2048;

/**
 * An SVG as a texture, rasterised at its own size.
 *
 * Through an `<img>` rather than Pixi's own SVG parser: what is being drawn is
 * mermaid's output, which is markup with its styling in it rather than a set of
 * paths, and the browser is the only thing that renders it the way the same
 * markup renders in a pane beside the board.
 */
export async function svgTexture(svg: string, width: number, height: number): Promise<Texture> {
  const scale = Math.min(SVG_SCALE, SVG_MAX_PIXELS / Math.max(width, height));
  const url = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml" }));

  try {
    const image = new Image();
    await new Promise<void>((resolve, reject) => {
      image.onload = () => resolve();
      image.onerror = () => reject(new Error("The diagram could not be decoded."));
      image.src = url;
    });

    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(width * scale));
    canvas.height = Math.max(1, Math.round(height * scale));
    const context = canvas.getContext("2d");
    if (!context) throw new Error("The diagram could not be drawn: no 2d context.");

    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    return Texture.from(canvas);
  } finally {
    URL.revokeObjectURL(url);
  }
}
