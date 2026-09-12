/**
 * The two cards the vault itself contributes: a **topic**, which is a directory,
 * and a **file**, which is anything else in one. Neither is authored — the board
 * derives them from disk and remembers only where they sit.
 *
 * One renderer serves both because the only difference is what they say: a topic
 * reports how much is inside it, a file shows its own opening lines.
 */

import type {
  ActivationGesture,
  CanvasEngineApi,
  CanvasObject,
  CanvasObjectKind,
  CanvasObjectRenderer,
  Point,
  Rect,
} from "@nib-ui/ui-contracts";
import { Assets, Container, type FederatedPointerEvent, Graphics, Sprite, Texture } from "pixi.js";
import {
  type BoardObject,
  type FileObject,
  MIN_CARD_SIZE,
  parseFile,
  parseTopic,
  type TopicObject,
} from "../board-view";
import { ObjectRenderer } from "../engine/ObjectRenderer";
import {
  drawCornerHandles,
  type ResizeHandle,
  type ResizableRenderer,
  resizeHandleAt,
  resizedRect,
} from "../engine/resize";
import { pointInRect } from "../engine/utils/geometry";
import {
  type BakedText,
  resolutionForZoom,
  type TextRun,
  type TextTextureCache,
} from "../engine/utils/textTexture";
import { type BoardTheme, themeRevision } from "../theme";

const PAD = 14;
const RADIUS = 12;
/** The strip down the left edge that tells a topic from a file at a glance. */
const ACCENT = 4;
const TITLE_SIZE = 15;
const BODY_SIZE = 13;
const FOOTER_SIZE = 10;
/** Screen pixels the selection ring sits outside the card's own border. */
const RING_OFFSET = 3;

const DEFAULT_WIDTH = 288;
const DEFAULT_HEIGHT = 132;

/** Extensions a card draws itself rather than describing. */
const DRAWABLE = new Set(["png", "jpg", "jpeg", "webp", "avif", "bmp", "gif", "svg"]);

export interface VaultDeps {
  theme(): BoardTheme;
  textures: TextTextureCache;
  /** A single click on a topic: show what is inside it. */
  preview(topic: TopicObject): void;
  /** A double click on a topic: make its board the canvas. */
  enter(topic: TopicObject): void;
  /** A double click on a file: open it in whatever handles that kind. */
  openFile(file: FileObject): void;
  /**
   * Where a card fetches its own bytes. A picture in the vault is a picture on the
   * board, not a card that says `PNG`; null while no project is open.
   */
  fileUrl(path: string): string | null;
}

class VaultCardRenderer extends ObjectRenderer<CanvasObject> implements ResizableRenderer {
  readonly container = new Container();

  private readonly ring = new Graphics();
  private readonly background = new Graphics();
  private readonly accentShape = new Graphics();
  private readonly handles = new Graphics();
  private readonly titleSprite = new Sprite();
  private readonly bodySprite = new Sprite();
  private readonly picture = new Sprite();
  /** Strip behind the name when the card is a picture and has no room for it. */
  private readonly caption = new Graphics();

  /** The path whose bytes were asked for, so a card fetches each file once. */
  private loadedPath = "";
  private data: CanvasObject | null = null;
  private width = 0;
  private height = 0;
  private signature = "";
  private resolution = 1;
  private selected = false;
  private pointer: Point | null = null;
  private hotHandle: ResizeHandle | null = null;
  private hovering = false;
  private hoverT = 0;
  private resizeFrom: Rect | null = null;

  constructor(
    private readonly engine: CanvasEngineApi,
    private readonly deps: VaultDeps,
  ) {
    super();
    this.container.eventMode = "static";
    this.container.cursor = "pointer";
    this.container.addChild(
      this.ring,
      this.background,
      this.picture,
      this.caption,
      this.accentShape,
      this.titleSprite,
      this.bodySprite,
      this.handles,
    );
    this.picture.visible = false;

    this.container.on("pointerleave", () => {
      this.hovering = false;
      this.pointer = null;
      this.hotHandle = null;
      this.drawChrome();
    });
    // Handles fade with how close the pointer is, so the card has to track it. Scoped
    // to the card rather than `globalpointermove`, which would wake every card on the
    // board on every mouse move.
    this.container.on("pointermove", (event: FederatedPointerEvent) => {
      this.pointer = event.getLocalPosition(this.container);
      this.hovering = pointInRect(this.pointer.x, this.pointer.y, {
        x: 0,
        y: 0,
        width: this.width,
        height: this.height,
      });
      this.drawChrome();
    });
    this.animate(() => {
      const target = this.hovering || this.selected ? 1 : 0;
      if (Math.abs(target - this.hoverT) > 0.004) {
        this.hoverT += (target - this.hoverT) * 0.18;
        this.applyHoverScale(this.hoverT);
      }
      return false;
    });
  }

  sync(data: CanvasObject, selection: string[]): void {
    this.data = data;
    const selected = selection.includes(data.id);
    // Loading is keyed on the path rather than folded into the signature: the
    // signature changes on every resize, and the bytes do not.
    const path = readString(data, "path");
    if (data.kind === "file" && path !== this.loadedPath) {
      this.loadedPath = path;
      void this.loadPicture(path, readString(data, "extension"));
    }
    const width = Math.max(MIN_CARD_SIZE.w, readNumber(data, "w", DEFAULT_WIDTH));
    const height = Math.max(MIN_CARD_SIZE.h, readNumber(data, "h", DEFAULT_HEIGHT));
    const resolution = resolutionForZoom(this.engine.camera.zoom);

    const signature = [
      data.kind,
      readString(data, "name"),
      readString(data, "title"),
      readString(data, "preview"),
      readString(data, "extension"),
      readNumber(data, "count", 0),
      width,
      height,
      resolution,
      themeRevision(),
    ].join(" ");

    if (signature !== this.signature) {
      this.signature = signature;
      this.width = width;
      this.height = height;
      this.resolution = resolution;
      this.redraw();
    }

    if (this.selected !== selected) this.selected = selected;
    if (Math.abs(this.engine.camera.zoom - this.chromeZoom) > this.chromeZoom * 0.02)
      this.drawChrome();

    // Position is the top-left of the card; the pivot is its centre, so the hover
    // and spawn scaling grow from the middle.
    this.container.pivot.set(this.width / 2, this.height / 2);
    this.container.position.set(
      readNumber(data, "x", 0) + this.width / 2,
      readNumber(data, "y", 0) + this.height / 2,
    );
  }

  override bounds(): Rect {
    const data = this.data;
    return {
      x: data ? readNumber(data, "x", 0) : 0,
      y: data ? readNumber(data, "y", 0) : 0,
      width: this.width,
      height: this.height,
    };
  }

  handleAt(worldX: number, worldY: number): ResizeHandle | null {
    const bounds = this.bounds();
    return resizeHandleAt(
      worldX - bounds.x,
      worldY - bounds.y,
      this.width,
      this.height,
      this.engine.camera.zoom,
    );
  }

  hoverHandle(handle: ResizeHandle | null): void {
    if (handle === this.hotHandle) return;
    this.hotHandle = handle;
    this.drawChrome();
  }

  beginResize(): void {
    const data = this.data;
    this.resizeFrom = data
      ? {
          x: readNumber(data, "x", 0),
          y: readNumber(data, "y", 0),
          width: this.width,
          height: this.height,
        }
      : null;
  }

  applyResize(handle: ResizeHandle, deltaX: number, deltaY: number): void {
    const from = this.resizeFrom;
    const data = this.data;
    if (!from || !data) return;

    // Measured from the size the gesture started at, so the far corner stays put.
    const next = resizedRect(from, handle, deltaX, deltaY, true, MIN_CARD_SIZE.w);
    this.engine.updateObject(data.id, {
      x: next.x,
      y: next.y,
      w: next.width,
      h: next.height,
    });
  }

  endResize(): void {
    this.resizeFrom = null;
  }

  private chromeZoom = 1;

  private drawChrome(): void {
    const theme = this.deps.theme();
    const zoom = this.engine.camera.zoom;
    this.chromeZoom = zoom;
    const scale = Math.max(0.2, zoom);

    const ring = this.ring;
    ring.clear();
    if (this.selected) {
      const offset = RING_OFFSET / scale;
      ring.roundRect(
        -offset,
        -offset,
        this.width + offset * 2,
        this.height + offset * 2,
        RADIUS + offset,
      );
      ring.stroke({ width: 1.5 / scale, color: theme.action, alpha: 0.85 });
    }

    drawCornerHandles(
      this.handles,
      this.width,
      this.height,
      zoom,
      this.selected ? this.pointer : null,
      this.hotHandle,
      { fill: theme.card, ring: theme.action, hot: theme.action },
    );
  }

  /**
   * The card's own bytes. A file that cannot be drawn — or cannot be read — keeps
   * the card it already had, which says more than a broken frame would.
   */
  private async loadPicture(path: string, extension: string): Promise<void> {
    this.picture.visible = false;
    this.picture.texture = Texture.EMPTY;
    if (!DRAWABLE.has(extension)) return;

    const url = this.deps.fileUrl(path);
    if (url === null) return;

    let texture: Texture;
    try {
      texture = (await Assets.load(url)) as Texture;
    } catch {
      return;
    }
    // The card may have been re-pointed at another file while the bytes loaded.
    if (this.loadedPath !== path) return;

    this.picture.texture = texture;
    this.picture.visible = true;
    this.signature = "";
  }

  private redraw(): void {
    const data = this.data;
    const theme = this.deps.theme();
    if (!data) return;

    const isTopic = data.kind === "topic";
    const contentWidth = Math.max(1, this.width - PAD * 2 - ACCENT);
    const label = readString(data, "title");
    const named = label ?? readString(data, "name");

    this.background
      .clear()
      .roundRect(0, 0, this.width, this.height, RADIUS)
      .fill({ color: theme.card })
      .stroke({ width: 1, color: theme.border });

    // A picture is the card. Its name goes on a strip across the foot rather than
    // above it, so the frame is the image and not a header with a thumbnail.
    if (this.picture.visible) {
      this.drawPicture(
        theme,
        named && named.length > 0 ? named : readString(data, "name"),
        data.id,
      );
      return;
    }
    this.caption.clear();
    this.accentShape.visible = true;
    this.picture.mask = null;

    // A pill down the left edge rather than a full-height strip: the card's own
    // corners are rounded, and a square strip would poke out of them.
    this.accentShape
      .clear()
      .roundRect(1.5, 6, ACCENT - 1, Math.max(4, this.height - 12), ACCENT / 2)
      .fill({ color: isTopic ? theme.action : theme.borderStrong, alpha: isTopic ? 0.9 : 0.5 });

    const title = this.bake(
      `vault:title:${data.id}`,
      [
        {
          text: named && named.length > 0 ? named : data.kind,
          size: TITLE_SIZE,
          color: theme.text,
          weight: 600,
          maxLines: 2,
        },
      ],
      contentWidth,
    );
    this.titleSprite.texture = title.texture;
    this.titleSprite.position.set(PAD + ACCENT, PAD);
    this.titleSprite.setSize(title.width, title.height);

    const body = isTopic ? this.topicBody(data) : this.fileBody(data);
    this.bodySprite.visible = body.length > 0;
    if (body.length === 0) return;

    const baked = this.bake(`vault:body:${data.id}`, body, contentWidth);
    this.bodySprite.texture = baked.texture;
    this.bodySprite.position.set(PAD + ACCENT, PAD + title.height + 6);
    this.bodySprite.setSize(baked.width, baked.height);
  }

  /**
   * Full-bleed picture, masked to the card's own rounded frame, with the file's
   * name on a strip across the bottom. `contain` rather than `cover`: a card the
   * user resized is theirs to shape, and cropping their picture to it is not.
   */
  private drawPicture(theme: BoardTheme, name: string, id: string): void {
    const texture = this.picture.texture;
    const ratio = texture.height > 0 ? texture.width / texture.height : 1;
    const boxRatio = this.height > 0 ? this.width / this.height : 1;
    const drawWidth = ratio > boxRatio ? this.width : this.height * ratio;
    const drawHeight = ratio > boxRatio ? this.width / ratio : this.height;

    this.picture.setSize(drawWidth, drawHeight);
    this.picture.position.set((this.width - drawWidth) / 2, (this.height - drawHeight) / 2);
    this.picture.mask = this.background;
    this.accentShape.visible = false;
    this.bodySprite.visible = false;

    const title = this.bake(
      `vault:picture:${id}`,
      [{ text: name, size: FOOTER_SIZE, color: theme.text, weight: 600, maxLines: 1 }],
      Math.max(1, this.width - PAD * 2),
    );
    const stripHeight = title.height + 10;

    this.caption
      .clear()
      .roundRect(0, this.height - stripHeight, this.width, stripHeight, RADIUS)
      .fill({ color: theme.card, alpha: 0.88 });

    this.titleSprite.texture = title.texture;
    this.titleSprite.setSize(title.width, title.height);
    this.titleSprite.position.set(PAD, this.height - stripHeight + 5);
  }

  private topicBody(data: CanvasObject): TextRun[] {
    const theme = this.deps.theme();
    const count = readNumber(data, "count", 0);
    if (count === 0) return [{ text: "empty", size: BODY_SIZE, color: theme.faint, italic: true }];
    return [
      {
        text: count === 1 ? "1 thing inside" : `${count} things inside`,
        size: BODY_SIZE,
        color: theme.muted,
      },
    ];
  }

  private fileBody(data: CanvasObject): TextRun[] {
    const theme = this.deps.theme();
    const preview = (readString(data, "preview") ?? "").trim();
    const extension = readString(data, "extension") ?? "";
    const runs: TextRun[] = [];

    if (preview.length > 0) {
      const room = this.height - PAD * 2 - 30;
      runs.push({
        text: preview,
        size: BODY_SIZE,
        color: theme.muted,
        maxLines: Math.max(1, Math.floor(room / Math.round(BODY_SIZE * 1.45))),
      });
    }
    if (extension.length > 0) {
      runs.push({
        text: extension.toUpperCase(),
        size: FOOTER_SIZE,
        color: theme.faint,
        weight: 600,
      });
    }
    return runs;
  }

  /** The palette is baked into the texture, so a theme switch has to miss the cache. */
  private bake(key: string, runs: TextRun[], width: number): BakedText {
    return this.deps.textures.get(`${themeRevision()}:${key}`, runs, width, this.resolution);
  }
}

/**
 * A topic answers both gestures, because what a single click means — show me what
 * is inside — is not what a double click means. A file only answers the double
 * click, leaving the single click to the select tool.
 */
export function vaultCardKind(
  kind: "topic" | "file",
  deps: VaultDeps,
): CanvasObjectKind<BoardObject> {
  return {
    kind,
    parse: kind === "topic" ? parseTopic : parseFile,
    createRenderer: (engine: CanvasEngineApi): CanvasObjectRenderer<BoardObject> =>
      new VaultCardRenderer(engine, deps),
    activate: (object: BoardObject, gesture: ActivationGesture): void => {
      if (object.kind === "topic") {
        if (gesture === "doubleClick") deps.enter(object);
        else deps.preview(object);
        return;
      }
      if (object.kind === "file" && gesture === "doubleClick") deps.openFile(object);
    },
  };
}

function readString(data: CanvasObject, key: string): string {
  const value = data[key];
  if (typeof value !== "string") return "";
  return value;
}

function readNumber(data: CanvasObject, key: string, fallback: number): number {
  const value = data[key];
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}
