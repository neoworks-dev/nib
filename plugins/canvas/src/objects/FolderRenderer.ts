/**
 * A folder: a directory, which is a topic (PLAN §5). Drawn as the physical thing
 * rather than as a card with a folder icon on it — a tab across the top left, the
 * body below it, and the count, name and date stacked in the lower half with room
 * at the right for a star badge.
 *
 * The silhouette is the whole point, so this is the one kind that does not use
 * the base renderer's rounded-rectangle surface.
 */

import type {
  ActivationGesture,
  CanvasEngineApi,
  CanvasObjectKind,
  CanvasObjectRenderer,
} from "@nib-ui/ui-contracts";
import { Sprite } from "pixi.js";
import { type FolderObject, parseFolder } from "../board-view";
import {
  type BakedText,
  SANS,
  type TextRun,
  type TextTextureCache,
} from "../engine/utils/textTexture";
import { type BoardTheme, CARD_RADIUS, CARD_TYPE, themeRevision } from "../theme";
import { CardRenderer } from "./CardRenderer";

/** Fractions of the card, so the silhouette holds its shape at any size. */
const TAB_WIDTH = 0.42;
const TAB_HEIGHT = 0.16;
/**
 * World units kept clear in the card's lower right for the star badge. Spatial
 * puts a star there; nothing in this build sets one, because there is no gesture
 * that does, so the room is reserved and the badge itself is not drawn. Filling
 * the slot is a change to the card, not to its layout.
 */
const BADGE_SLOT = 24;

export interface FolderDeps {
  theme(): BoardTheme;
  textures: TextTextureCache;
  /** A single click lays the folder's contents out beside it. */
  preview(folder: FolderObject): void;
  /** A double click enters it: its board replaces the canvas. */
  enter(folder: FolderObject): void;
}

class FolderCardRenderer extends CardRenderer<FolderObject> {
  private readonly label = new Sprite();

  constructor(
    engine: CanvasEngineApi,
    private readonly deps: FolderDeps,
  ) {
    super(engine);
    this.content.addChild(this.label);
  }

  protected theme(): BoardTheme {
    return this.deps.theme();
  }

  protected surfaceColor(theme: BoardTheme): number {
    return theme.card;
  }

  protected contentSignature(data: FolderObject): string {
    return [data.id, data.name, data.title ?? "", data.count].join(" ");
  }

  /**
   * A folder is not a rectangle, so the surface is a tab plus a body rather than
   * the base renderer's rounded rect. The shadow stays rectangular under it:
   * at this radius and opacity the difference is not visible, and a second baked
   * texture for one kind is not worth the memory.
   */
  protected override drawSurface(): void {
    super.drawSurface();

    const theme = this.deps.theme();
    const tabWidth = Math.min(this.width * TAB_WIDTH, this.width - CARD_RADIUS * 2);
    const tabHeight = Math.max(CARD_RADIUS, this.height * TAB_HEIGHT);
    const radius = CARD_RADIUS;

    // Tab across the top left, then the body under it: one path, so the join
    // between the two is a corner rather than a seam between two fills.
    this.surface
      .clear()
      .moveTo(0, tabHeight + radius)
      .arcTo(0, tabHeight, radius, tabHeight, radius)
      .lineTo(tabWidth - radius, tabHeight)
      .arcTo(tabWidth, tabHeight, tabWidth, tabHeight - radius, radius)
      .lineTo(tabWidth, radius)
      .arcTo(tabWidth, 0, tabWidth + radius, 0, radius)
      .lineTo(this.width - radius, 0)
      .arcTo(this.width, 0, this.width, radius, radius)
      .lineTo(this.width, this.height - radius)
      .arcTo(this.width, this.height, this.width - radius, this.height, radius)
      .lineTo(radius, this.height)
      .arcTo(0, this.height, 0, this.height - radius, radius)
      .closePath()
      .fill({ color: this.surfaceColor(theme) });

    this.content.mask = this.surface;
  }

  protected drawContent(): void {
    const data = this.data;
    if (!data) return;

    const theme = this.deps.theme();
    const pad = CARD_TYPE.padding;
    const column = Math.max(1, this.width - pad * 2 - BADGE_SLOT);
    const gap = Math.round(CARD_TYPE.metaSize * 1.6);

    // Count, then name, then whatever the topic says about itself — the order the
    // hero frames read in, smallest and greyest first.
    const runs: TextRun[] = [
      {
        text: data.count === 1 ? "1 Item" : `${data.count} Items`,
        size: CARD_TYPE.metaSize,
        color: theme.dim,
        family: SANS,
        lineHeight: gap,
        maxLines: 1,
      },
      {
        text: data.title ?? data.name,
        size: CARD_TYPE.metaSize + 2,
        color: theme.text,
        weight: 600,
        family: SANS,
        lineHeight: gap,
        maxLines: 2,
      },
    ];

    const baked = this.bake(`folder:${data.id}`, runs, column);
    this.label.texture = baked.texture;
    this.label.setSize(baked.width, baked.height);
    this.label.position.set(pad, this.height - pad - baked.height);
  }

  private bake(key: string, runs: TextRun[], width: number): BakedText {
    return this.deps.textures.get(`${themeRevision()}:${key}`, runs, width, this.resolution);
  }
}

export function folderKind(deps: FolderDeps): CanvasObjectKind<FolderObject> {
  return {
    kind: "folder",
    parse: parseFolder,
    createRenderer: (engine: CanvasEngineApi): CanvasObjectRenderer<FolderObject> =>
      new FolderCardRenderer(engine, deps),
    activate: (object: FolderObject, gesture: ActivationGesture): void => {
      if (gesture === "doubleClick") deps.enter(object);
      else deps.preview(object);
    },
  };
}
