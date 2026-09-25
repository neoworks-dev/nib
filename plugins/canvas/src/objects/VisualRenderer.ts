/**
 * A picture or a clip, drawn edge to edge. There is no header, no filename strip
 * and no padding: the card **is** the image, clipped to the board's own corner
 * radius, and a video plays itself.
 *
 * `cover` rather than `contain`. A card the user has sized is theirs, and letter
 * boxing it would put the table's grey inside the card instead of the picture.
 *
 * A clip is **not** drawn from its own texture. Pixi hands the whole decoded
 * frame to the GPU on every update, and a 2160×2160 clip is 18MB a frame however
 * small the card is — twelve of those on one board is several gigabytes a second
 * to draw a row of thumbnails. Each frame is scaled into a canvas the size the
 * card is actually on screen and that is what the sprite samples, so the upload
 * is the card rather than the source. How many clips decode at once is the other
 * half, and that belongs to the board rather than to any one card: see
 * `playbackBudget`.
 */

import type {
  ActivationGesture,
  CanvasEngineApi,
  CanvasObjectKind,
  CanvasObjectRenderer,
} from "@nib-ui/ui-contracts";
import { CanvasSource, Graphics, Sprite, Texture, VideoSource } from "pixi.js";
import { type VisualObject, parseVisual } from "../board-view";
import { playbackBudget } from "../engine/utils/playback";
import { loadTexture } from "../engine/utils/texture";
import type { BoardTheme } from "../theme";
import { CardRenderer } from "./CardRenderer";

/** The playhead, in world units: a hairline along the foot of a playing clip. */
const BAR_HEIGHT = 4;
const BAR_INSET = 12;
/** Below this the bar is off the card: a thumbnail is not a player. */
const BAR_MIN_WIDTH = 96;

/**
 * Screen pixels a card has to cover before its clip is worth playing. Decoding a
 * clip costs the same whether it is drawn over half the window or as a speck at
 * 8% zoom, so a board panned away from is a board of paused clips.
 */
const PLAY_MIN_SIZE = 48;
/** How far off screen a clip keeps playing, so a nudge of the camera is not a stall. */
const PLAY_MARGIN = 96;

/** The longest side a clip is scaled into, whatever the source or the card is. */
const FRAME_MAX = 720;
/** And the shortest, so a card zoomed down does not sample a postage stamp. */
const FRAME_MIN = 96;
/** How often a frame is scaled across — above what anything is shot at is waste. */
const FRAME_MS = 1000 / 30;
/**
 * How much the card has to have changed size before the frame buffer is rebuilt.
 * Resizing a canvas clears it, so a drag that resized it every pixel would flicker.
 */
const FRAME_RESIZE_RATIO = 1.25;

export interface VisualDeps {
  theme(): BoardTheme;
  /** Where a card fetches its own bytes; null while no project is open. */
  fileUrl(path: string): string | null;
  /** A double click opens the file in whatever handles that kind. */
  open(visual: VisualObject): void;
}

class VisualCardRenderer extends CardRenderer<VisualObject> {
  protected override get spawnable(): boolean {
    return true;
  }

  private readonly picture = new Sprite();
  /** How far through the clip is, drawn over the picture at its foot. */
  private readonly playhead = new Graphics();
  /** The path whose bytes were asked for, so a card fetches each file once. */
  private loadedPath = "";
  /** The fraction the bar was last drawn at, so it is redrawn only as it moves. */
  private drawnProgress = -1;

  /** The clip itself, which is decoded but never drawn: see the note on the file. */
  private videoElement: HTMLVideoElement | null = null;
  /** Where its frames are scaled to, at the size the card is on screen. */
  private frameSource: CanvasSource | null = null;
  private frameContext: CanvasRenderingContext2D | null = null;
  private frameTexture: Texture | null = null;
  private frameAt = 0;
  private frameDrawn = false;
  /** The card and texture `layout` last measured, so a buffer recut under the sprite is caught. */
  private fitted = "";

  constructor(
    engine: CanvasEngineApi,
    private readonly deps: VisualDeps,
  ) {
    super(engine);
    this.content.addChild(this.picture, this.playhead);
    this.picture.visible = false;
    this.playhead.visible = false;

    // Playback is the video element's own, not the board's: the bar reads where
    // it has got to each frame rather than being driven from here, and a clip
    // nobody is looking at is stopped rather than decoded into an empty room.
    this.animate((now) => {
      // What the board steers the number of running clips by. Every card reports
      // it and the budget keeps the first reading of each frame.
      playbackBudget.frame(now);
      this.holdPlayback();
      this.scaleFrame();
      this.refit();
      this.drawPlayhead();
      return false;
    });
  }

  protected theme(): BoardTheme {
    return this.deps.theme();
  }

  /** Only ever seen while the bytes are still loading, or behind a transparent png. */
  protected surfaceColor(theme: BoardTheme): number {
    return theme.cardRaised;
  }

  protected contentSignature(data: VisualObject): string {
    return [data.id, data.path, String(data.video)].join(" ");
  }

  protected drawContent(): void {
    const data = this.data;
    if (!data) return;

    // Loading is keyed on the path rather than folded into the signature: the
    // signature changes on every resize, and the bytes do not.
    if (data.path !== this.loadedPath) {
      this.loadedPath = data.path;
      void this.load(data);
    }
    this.layout();
  }

  /**
   * Fills the card, centred, with whatever falls outside it cropped away by the
   * surface mask the base renderer already applies.
   */
  private layout(): void {
    // The bar is drawn in the card's own units, so a resize has to redraw it even
    // where playback has not moved a frame.
    this.drawnProgress = -1;
    const texture = this.picture.texture;
    if (!this.picture.visible || texture.width === 0 || texture.height === 0) return;

    const ratio = texture.width / texture.height;
    const boxRatio = this.height > 0 ? this.width / this.height : 1;
    const drawWidth = ratio > boxRatio ? this.height * ratio : this.width;
    const drawHeight = ratio > boxRatio ? this.height : this.width / ratio;

    this.picture.setSize(drawWidth, drawHeight);
    this.picture.position.set((this.width - drawWidth) / 2, (this.height - drawHeight) / 2);
    this.fitted = fitOf(this.width, this.height, texture.width, texture.height);
  }

  /**
   * A sprite is sized once against the texture it had then: `setSize` stores a
   * scale, not a size. A clip's buffer is recut whenever the camera zooms far
   * enough, so the texture under the sprite changes size and the scale that was
   * right for the old one draws the new one too small — the clip shrinking inside
   * its own card on zoom. Re-fitting whenever the pair changes is what keeps the
   * two agreeing, whoever moved.
   */
  private refit(): void {
    if (!this.picture.visible) return;
    const texture = this.picture.texture;
    if (fitOf(this.width, this.height, texture.width, texture.height) === this.fitted) return;
    this.layout();
  }

  /**
   * A file that cannot be read keeps the empty card it already had, which says
   * more than a broken frame would.
   */
  private async load(data: VisualObject): Promise<void> {
    this.picture.visible = false;
    this.playhead.visible = false;
    this.picture.texture = Texture.EMPTY;
    this.releaseClip();

    const url = this.deps.fileUrl(data.path);
    if (url === null) return;

    let texture: Texture;
    try {
      texture = await loadTexture(url, data.path, { video: data.video });
    } catch {
      return;
    }
    // The card may have been re-pointed at another file while the bytes loaded.
    if (this.loadedPath !== data.path) return;

    const clip = data.video ? videoOf(texture) : null;
    if (!clip) {
      this.picture.texture = texture;
      this.picture.visible = true;
      this.layout();
      return;
    }

    // Nothing draws the clip's own texture, so Pixi is told to stop pushing it at
    // the GPU: what the sprite samples is the scaled copy this card keeps.
    if (texture.source instanceof VideoSource) texture.source.autoUpdate = false;
    this.videoElement = clip;
    prepareClip(clip);
    this.scaleFrame();
  }

  /** The clip this card is showing, or null for a card showing a picture. */
  private video(): HTMLVideoElement | null {
    return this.data?.video === true ? this.videoElement : null;
  }

  /**
   * How much of the screen this card covers, or zero for one that is not worth a
   * decoder: off screen, or too small to watch. Read in screen pixels rather than
   * world units, because the camera is what decides both — and it is what the
   * board weighs one clip against another with.
   */
  private screenArea(): number {
    const screen = this.engine.app.screen;
    const zoom = this.engine.camera.zoom;
    const width = this.width * zoom;
    const height = this.height * zoom;
    if (Math.min(width, height) < PLAY_MIN_SIZE) return 0;

    const bounds = this.bounds();
    const topLeft = this.engine.worldToScreen(bounds.x, bounds.y);
    const onScreen =
      topLeft.x + width > -PLAY_MARGIN &&
      topLeft.y + height > -PLAY_MARGIN &&
      topLeft.x < screen.width + PLAY_MARGIN &&
      topLeft.y < screen.height + PLAY_MARGIN;
    return onScreen ? width * height : 0;
  }

  /**
   * Asks the board for the clip to keep running, and gives it up when the card is
   * off screen or too small to watch. What is worth playing is decided across the
   * whole board, not here: twelve cards each deciding they are worth a decoder is
   * how a board ends up with twelve of them.
   */
  private holdPlayback(): void {
    const data = this.data;
    const clip = this.video();
    if (!data || !clip) return;

    const area = this.screenArea();
    if (area <= 0) {
      playbackBudget.release(data.id);
      return;
    }
    playbackBudget.claim(data.id, clip, area);
  }

  /**
   * Scales the clip's current frame into the card-sized buffer the sprite draws.
   * Runs while the clip is playing, and once as soon as there is a frame at all,
   * so a card that never gets the budget still shows the picture it starts on.
   */
  private scaleFrame(): void {
    const clip = this.video();
    if (!clip || clip.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) return;
    if (this.frameDrawn && clip.paused) return;

    const now = performance.now();
    if (this.frameDrawn && now - this.frameAt < FRAME_MS) return;
    this.frameAt = now;

    const context = this.frameBuffer(clip);
    if (!context) return;

    const { canvas } = context;
    context.drawImage(clip, 0, 0, canvas.width, canvas.height);
    this.frameTexture?.source.update();
    if (this.frameDrawn) return;

    // The first frame is what turns the card from an empty surface into a picture.
    this.frameDrawn = true;
    this.picture.visible = true;
    this.layout();
  }

  /**
   * The buffer for this card, at the size the card is on screen and in the shape
   * of the clip. It follows the card rather than being rebuilt with it: resizing
   * a canvas clears it, so it is only re-cut once the card has outgrown what it
   * has by enough to see — a drag that re-cut it every pixel would strobe.
   */
  private frameBuffer(clip: HTMLVideoElement): CanvasRenderingContext2D | null {
    const ratio = clip.videoWidth > 0 ? clip.videoWidth / clip.videoHeight : 1;
    const zoom = this.engine.camera.zoom;
    const longest = Math.max(this.width * zoom, this.height * zoom);
    const target = Math.round(Math.min(FRAME_MAX, Math.max(FRAME_MIN, longest)));
    const width = ratio >= 1 ? target : Math.max(1, Math.round(target * ratio));
    const height = ratio >= 1 ? Math.max(1, Math.round(target / ratio)) : target;

    const source = this.frameSource;
    if (!source) {
      const created = new CanvasSource({
        resource: document.createElement("canvas"),
        width,
        height,
      });
      this.frameSource = created;
      this.frameContext = created.context2D;
      this.frameTexture = new Texture({ source: created });
      this.picture.texture = this.frameTexture;
      this.layout();
      return this.frameContext;
    }

    // Grown past what it has, or shrunk to a fraction of it. The two thresholds
    // are not the same: growing shows, and shrinking only wastes a little memory.
    const grown = Math.max(width / source.width, height / source.height);
    const shrunk = Math.max(source.width / width, source.height / height);
    if (grown > FRAME_RESIZE_RATIO || shrunk > FRAME_RESIZE_RATIO * 2) {
      source.resize(width, height);
      // The buffer is blank again, so what is on the card has to be drawn afresh
      // rather than waiting for the clip's next frame.
      this.frameDrawn = false;
      this.layout();
    }

    return this.frameContext;
  }

  /** A card that has gone gives up its decoder and the buffer it was scaling into. */
  private releaseClip(): void {
    const data = this.data;
    if (data) playbackBudget.release(data.id);
    this.videoElement?.pause();
    this.videoElement = null;
    this.frameDrawn = false;
    this.frameTexture?.destroy(true);
    this.frameTexture = null;
    this.frameSource = null;
    this.frameContext = null;
  }

  override destroy(): void {
    this.releaseClip();
    super.destroy();
  }

  /**
   * A track along the foot of the card with the played part filled in, which is
   * the only thing on a silent looping clip that says it is running. Redrawn only
   * when it has moved by a unit, so a board of clips is not a board of rebuilds.
   */
  private drawPlayhead(): void {
    const video = this.video();
    const width = this.width - BAR_INSET * 2;
    if (
      !video ||
      !Number.isFinite(video.duration) ||
      video.duration <= 0 ||
      width < BAR_MIN_WIDTH
    ) {
      this.playhead.visible = false;
      this.drawnProgress = -1;
      return;
    }

    const progress = Math.min(1, Math.max(0, video.currentTime / video.duration));
    if (this.playhead.visible && Math.abs(progress - this.drawnProgress) * width < 1) return;
    this.drawnProgress = progress;

    const top = this.height - BAR_INSET - BAR_HEIGHT;
    const radius = BAR_HEIGHT / 2;
    this.playhead
      .clear()
      .roundRect(BAR_INSET, top, width, BAR_HEIGHT, radius)
      .fill({ color: 0xffffff, alpha: 0.35 })
      .roundRect(BAR_INSET, top, Math.max(BAR_HEIGHT, width * progress), BAR_HEIGHT, radius)
      .fill({ color: 0xffffff, alpha: 0.95 });
    this.playhead.visible = true;
  }
}

/** One reading of what a card and its texture measure, for comparing two frames. */
function fitOf(width: number, height: number, textureWidth: number, textureHeight: number): string {
  return `${width}x${height}:${textureWidth}x${textureHeight}`;
}

/** The element Pixi decoded into, for a texture that came back as a clip. */
function videoOf(texture: Texture): HTMLVideoElement | null {
  const source = texture.source.resource;
  return source instanceof HTMLVideoElement ? source : null;
}

/**
 * Muted and looping, because a board of clips that each asked for attention would
 * be unusable — and because a browser refuses to autoplay anything with sound.
 * Whether it runs at all is the budget's call, so it starts stopped.
 */
function prepareClip(clip: HTMLVideoElement): void {
  clip.loop = true;
  clip.muted = true;
  clip.playsInline = true;
  clip.pause();
}

export function visualKind(deps: VisualDeps): CanvasObjectKind<VisualObject> {
  return {
    kind: "visual",
    parse: parseVisual,
    createRenderer: (engine: CanvasEngineApi): CanvasObjectRenderer<VisualObject> =>
      new VisualCardRenderer(engine, deps),
    activate: (object: VisualObject, gesture: ActivationGesture): void => {
      if (gesture === "doubleClick") deps.open(object);
    },
  };
}
