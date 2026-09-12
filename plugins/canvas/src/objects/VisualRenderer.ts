/**
 * A picture or a clip, drawn edge to edge. There is no header, no filename strip
 * and no padding: the card **is** the image, clipped to the board's own corner
 * radius, and a video plays itself.
 *
 * `cover` rather than `contain`. A card the user has sized is theirs, and letter
 * boxing it would put the table's grey inside the card instead of the picture.
 */

import type {
  ActivationGesture,
  CanvasEngineApi,
  CanvasObjectKind,
  CanvasObjectRenderer,
} from "@nib-ui/ui-contracts";
import { Assets, Sprite, Texture } from "pixi.js";
import { type VisualObject, parseVisual } from "../board-view";
import type { BoardTheme } from "../theme";
import { CardRenderer } from "./CardRenderer";

export interface VisualDeps {
  theme(): BoardTheme;
  /** Where a card fetches its own bytes; null while no project is open. */
  fileUrl(path: string): string | null;
  /** A double click opens the file in whatever handles that kind. */
  open(visual: VisualObject): void;
}

class VisualCardRenderer extends CardRenderer<VisualObject> {
  private readonly picture = new Sprite();
  /** The path whose bytes were asked for, so a card fetches each file once. */
  private loadedPath = "";

  constructor(
    engine: CanvasEngineApi,
    private readonly deps: VisualDeps,
  ) {
    super(engine);
    this.content.addChild(this.picture);
    this.picture.visible = false;
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
    const texture = this.picture.texture;
    if (!this.picture.visible || texture.width === 0 || texture.height === 0) return;

    const ratio = texture.width / texture.height;
    const boxRatio = this.height > 0 ? this.width / this.height : 1;
    const drawWidth = ratio > boxRatio ? this.height * ratio : this.width;
    const drawHeight = ratio > boxRatio ? this.height : this.width / ratio;

    this.picture.setSize(drawWidth, drawHeight);
    this.picture.position.set((this.width - drawWidth) / 2, (this.height - drawHeight) / 2);
  }

  /**
   * A file that cannot be read keeps the empty card it already had, which says
   * more than a broken frame would.
   */
  private async load(data: VisualObject): Promise<void> {
    this.picture.visible = false;
    this.picture.texture = Texture.EMPTY;

    const url = this.deps.fileUrl(data.path);
    if (url === null) return;

    let texture: Texture;
    try {
      texture = (await Assets.load(url)) as Texture;
    } catch {
      return;
    }
    // The card may have been re-pointed at another file while the bytes loaded.
    if (this.loadedPath !== data.path) return;

    if (data.video) startPlayback(texture);
    this.picture.texture = texture;
    this.picture.visible = true;
    this.layout();
  }
}

/**
 * Muted and looping, because a board of clips that each asked for attention would
 * be unusable — and because a browser refuses to autoplay anything with sound.
 */
function startPlayback(texture: Texture): void {
  const source = texture.source.resource;
  if (!(source instanceof HTMLVideoElement)) return;
  source.loop = true;
  source.muted = true;
  source.playsInline = true;
  void source.play().catch(() => {
    // Autoplay refused: the first frame is already on the card, which is enough.
  });
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
