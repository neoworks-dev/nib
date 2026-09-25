/**
 * A webclip: a markdown file whose whole body is one url, drawn as the page it
 * points at. Portrait, sharp-cornered and a fixed viewport — it is a capture, and
 * rounding it or letting it reflow would make it look like a card about a site
 * rather than a picture of one.
 *
 * Until the capture lands the card is opaque white with a blinking caret and a
 * small close button at the bottom centre, which is exactly what Spatial shows.
 */

import type {
  ActivationGesture,
  CanvasEngineApi,
  CanvasObjectKind,
  CanvasObjectRenderer,
} from "@nib-ui/ui-contracts";
import { Graphics, Sprite, Texture } from "pixi.js";
import { type WebclipObject, parseWebclip } from "../board-view";
import { loadTexture } from "../engine/utils/texture";
import { SANS, type TextRun, type TextTextureCache } from "../engine/utils/textTexture";
import { type BoardTheme, CARD_TYPE, SHARP_RADIUS, themeRevision } from "../theme";
import type { PageCapture } from "../vault.svelte";
import { CardRenderer } from "./CardRenderer";

/** The portrait card a capture is taken into. */
export const WEBCLIP_ASPECT = 2 / 3;

/** World units, for the loading chrome. */
const CARET_WIDTH = 2;
const CARET_HEIGHT = 22;
const CLOSE_RADIUS = 9;
const CLOSE_INSET = 34;
const BLINK_MS = 560;

export interface WebclipDeps {
  theme(): BoardTheme;
  textures: TextTextureCache;
  /** The cached capture for a url, or null while it has not been taken yet. */
  capture(url: string): PageCapture | null;
  /** The close button under a loading card: give up on this clip. */
  cancel(clip: WebclipObject): void;
  /** A double click opens the site itself. */
  open(clip: WebclipObject): void;
}

class WebclipCardRenderer extends CardRenderer<WebclipObject> {
  protected override get spawnable(): boolean {
    return true;
  }

  private readonly capture = new Sprite();
  private readonly label = new Sprite();
  private readonly chrome = new Graphics();
  private readonly caret = new Graphics();

  private loadedUrl = "";
  private loading = true;
  /** Where the capture stops, which is where the page's own name starts. */
  private captureBottom = 0;

  constructor(
    engine: CanvasEngineApi,
    private readonly deps: WebclipDeps,
  ) {
    super(engine);
    this.content.addChild(this.capture, this.label, this.chrome, this.caret);
    this.capture.visible = false;
    this.label.visible = false;

    // The caret blinks for as long as the card is waiting, which is the only
    // thing on a loading clip that says it is still going.
    this.animate(() => {
      this.caret.visible = this.loading && Math.floor(performance.now() / BLINK_MS) % 2 === 0;
      return false;
    });
  }

  protected theme(): BoardTheme {
    return this.deps.theme();
  }

  /** A capture is a screenshot of a page, and pages are white. */
  protected surfaceColor(theme: BoardTheme): number {
    return theme.card;
  }

  protected override get radius(): number {
    return SHARP_RADIUS;
  }

  protected contentSignature(data: WebclipObject): string {
    const capture = this.deps.capture(data.url);
    return [data.id, data.url, capture?.image ?? "", capture?.title ?? ""].join(" ");
  }

  /** The close button is the one thing on a loading clip that answers a press. */
  pressAt(worldX: number, worldY: number): boolean {
    const data = this.data;
    if (!data || !this.loading) return false;

    const bounds = this.bounds();
    const centerX = this.width / 2;
    const centerY = this.height - CLOSE_INSET;
    const distance = Math.hypot(worldX - bounds.x - centerX, worldY - bounds.y - centerY);
    if (distance > CLOSE_RADIUS * 1.6) return false;

    this.deps.cancel(data);
    return true;
  }

  protected drawContent(): void {
    const data = this.data;
    if (!data) return;

    const capture = this.deps.capture(data.url);
    if (capture !== null && capture.image !== this.loadedUrl) {
      this.loadedUrl = capture.image;
      void this.load(capture.image);
    }
    if (capture === null) {
      this.loading = true;
      this.loadedUrl = "";
      this.capture.visible = false;
    }

    this.layoutCapture();
    this.drawLabel(capture);
    this.drawLoadingChrome();
  }

  /**
   * What the page calls itself, under the capture. The file behind a webclip is a
   * url and nothing else, so its name is the host and its path — the scrape is
   * the only thing that knows the page has a name, and a capture with no name
   * under it is a picture of a site rather than a reference to a page.
   */
  private drawLabel(capture: PageCapture | null): void {
    const data = this.data;
    this.label.visible = data !== null && capture !== null;
    if (!data || !capture) return;

    const theme = this.deps.theme();
    const pad = CARD_TYPE.padding;
    const column = Math.max(1, this.width - pad * 2);
    const runs: TextRun[] = [
      {
        text: capture.title,
        size: CARD_TYPE.bodySize,
        color: theme.text,
        weight: 600,
        family: SANS,
        lineHeight: Math.round(CARD_TYPE.bodySize * 1.4),
        maxLines: 3,
        gapAfter: 6,
      },
      {
        text: capture.domain,
        size: CARD_TYPE.metaSize,
        color: theme.dim,
        family: SANS,
        lineHeight: Math.round(CARD_TYPE.metaSize * 1.4),
        maxLines: 1,
      },
    ];

    const baked = this.deps.textures.get(
      `webclip:${themeRevision()}:${data.id}:${capture.title}:${capture.domain}`,
      runs,
      column,
      this.resolution,
    );
    this.label.texture = baked.texture;
    this.label.setSize(baked.width, baked.height);
    this.label.position.set(pad, this.captureBottom + pad);
  }

  /**
   * The capture is a page, so it is pinned to the top and cropped at the bottom:
   * a site's masthead is what identifies it, and centring the shot would cut it.
   */
  private layoutCapture(): void {
    const texture = this.capture.texture;
    if (!this.capture.visible || texture.width === 0) return;

    const drawHeight = (this.width / texture.width) * texture.height;
    this.capture.setSize(this.width, drawHeight);
    this.capture.position.set(0, 0);
    this.captureBottom = Math.min(drawHeight, this.height);
  }

  private drawLoadingChrome(): void {
    const theme = this.deps.theme();
    this.chrome.clear();
    this.caret.clear();
    if (!this.loading) return;

    this.caret
      .rect(
        (this.width - CARET_WIDTH) / 2,
        (this.height - CARET_HEIGHT) / 2,
        CARET_WIDTH,
        CARET_HEIGHT,
      )
      .fill({ color: theme.text });

    const centerX = this.width / 2;
    const centerY = this.height - CLOSE_INSET;
    const arm = CLOSE_RADIUS * 0.42;
    this.chrome.circle(centerX, centerY, CLOSE_RADIUS).fill({ color: theme.border });
    this.chrome
      .moveTo(centerX - arm, centerY - arm)
      .lineTo(centerX + arm, centerY + arm)
      .moveTo(centerX + arm, centerY - arm)
      .lineTo(centerX - arm, centerY + arm)
      .stroke({ width: 1.5, color: theme.dim, cap: "round" });
  }

  private async load(url: string): Promise<void> {
    let texture: Texture;
    try {
      // The capture is a png in the asset store, whatever the page it came from.
      texture = await loadTexture(url, "capture.png");
    } catch {
      // The capture failed. The card keeps waiting rather than claiming a page
      // that was never fetched, and the close button is still there to give up on.
      return;
    }
    if (this.loadedUrl !== url) return;

    this.capture.texture = texture;
    this.capture.visible = true;
    this.loading = false;
    this.layoutCapture();
    this.drawLabel(this.data ? this.deps.capture(this.data.url) : null);
    this.drawLoadingChrome();
  }
}

export function webclipKind(deps: WebclipDeps): CanvasObjectKind<WebclipObject> {
  return {
    kind: "webclip",
    parse: parseWebclip,
    createRenderer: (engine: CanvasEngineApi): CanvasObjectRenderer<WebclipObject> =>
      new WebclipCardRenderer(engine, deps),
    activate: (object: WebclipObject, gesture: ActivationGesture): void => {
      if (gesture === "doubleClick") deps.open(object);
    },
  };
}
