/**
 * A file the board cannot read: a transcript, an archive, anything that is not
 * markdown, a picture or a clip. It is drawn as what it is — a name, and the
 * type under it — rather than as a page with nothing on it.
 *
 * Deliberately the plainest card on the table. A file is not a note, so it gets
 * no headline weight and no prose, and double-clicking it hands it to whatever
 * opens that kind rather than to the sheet editor.
 */

import type {
  ActivationGesture,
  CanvasEngineApi,
  CanvasObjectKind,
  CanvasObjectRenderer,
} from "@nib-ui/ui-contracts";
import { Sprite } from "pixi.js";
import { type FileObject, parseFile } from "../board-view";
import { MONO, SANS, type TextRun, type TextTextureCache } from "../engine/utils/textTexture";
import { type BoardTheme, CARD_TYPE } from "../theme";
import { CardRenderer } from "./CardRenderer";

export interface FileDeps {
  theme(): BoardTheme;
  textures: TextTextureCache;
  /** A double click hands the file to whatever opens that kind. */
  open(file: FileObject): void;
}

class FileCardRenderer extends CardRenderer<FileObject> {
  protected override get spawnable(): boolean {
    return true;
  }

  private readonly label = new Sprite();

  constructor(
    engine: CanvasEngineApi,
    private readonly deps: FileDeps,
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

  protected contentSignature(data: FileObject): string {
    return [data.id, data.title ?? "", data.name, data.extension].join(" ");
  }

  protected drawContent(): void {
    const data = this.data;
    if (!data) return;

    const theme = this.deps.theme();
    const pad = CARD_TYPE.padding;
    const column = Math.max(1, this.width - pad * 2);

    // A name is often an opaque id, so it is set in mono and allowed to wrap:
    // a uuid broken across lines reads, and one clipped to an ellipsis does not.
    const runs: TextRun[] = [
      {
        text: data.title ?? data.name,
        size: CARD_TYPE.bodySize,
        color: theme.text,
        weight: 500,
        family: MONO,
        lineHeight: Math.round(CARD_TYPE.bodySize * 1.45),
        maxLines: 3,
        gapAfter: 8,
      },
      {
        text: data.extension.length > 0 ? data.extension.toUpperCase() : "FILE",
        size: CARD_TYPE.metaSize,
        color: theme.dim,
        family: SANS,
        lineHeight: Math.round(CARD_TYPE.metaSize * 1.4),
        maxLines: 1,
      },
    ];

    const baked = this.deps.textures.get(`file:${data.id}`, runs, column, this.resolution);
    this.label.texture = baked.texture;
    this.label.setSize(baked.width, baked.height);
    this.label.position.set(pad, pad);
  }
}

export function fileKind(deps: FileDeps): CanvasObjectKind<FileObject> {
  return {
    kind: "file",
    parse: parseFile,
    createRenderer: (engine: CanvasEngineApi): CanvasObjectRenderer<FileObject> =>
      new FileCardRenderer(engine, deps),
    activate: (object: FileObject, gesture: ActivationGesture): void => {
      if (gesture === "doubleClick") deps.open(object);
    },
  };
}
