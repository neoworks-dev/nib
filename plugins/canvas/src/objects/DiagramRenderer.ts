/**
 * A diagram: a `.mmd`, or a note whose whole body is one mermaid fence, drawn as
 * the picture it describes rather than as the source it is written in.
 *
 * `contain` rather than `cover`. A flow chart with its edges cropped off is not a
 * flow chart, so the drawing is fitted inside the card and centred, with the
 * paper showing around it.
 *
 * The source is what the board carries; the picture is made here. Mermaid lays a
 * diagram out by measuring text in the DOM, so the SVG it returns is rasterised
 * through an `<img>` into a texture — the same path a picture takes, one step
 * further back.
 */

import type {
  ActivationGesture,
  CanvasEngineApi,
  CanvasObjectKind,
  CanvasObjectRenderer,
} from "@nib-ui/ui-contracts";
import { documentMermaidTheme, renderMermaid } from "@nib-ui/render";
import { Sprite, Texture } from "pixi.js";
import { type DiagramObject, parseDiagram } from "../board-view";
import { svgTexture } from "../engine/utils/texture";
import { SANS, type TextRun, type TextTextureCache } from "../engine/utils/textTexture";
import { type BoardTheme, SHEET_TYPE, themeRevision } from "../theme";
import { CardRenderer } from "./CardRenderer";

/** Breathing room between the drawing and the edge of the card it is on. */
const DIAGRAM_PADDING = 14;

export interface DiagramDeps {
  theme(): BoardTheme;
  textures: TextTextureCache;
  /** A double click opens the source, which is the only way to change a diagram. */
  open(diagram: DiagramObject): void;
}

class DiagramCardRenderer extends CardRenderer<DiagramObject> {
  protected override get spawnable(): boolean {
    return true;
  }

  private readonly picture = new Sprite();
  /** What mermaid said about a source it would not parse. */
  private readonly message = new Sprite();

  /** The source the current texture was made from, so it is rendered once. */
  private drawnSource = "";
  private error: string | null = null;

  constructor(
    engine: CanvasEngineApi,
    private readonly deps: DiagramDeps,
  ) {
    super(engine);
    this.content.addChild(this.picture, this.message);
    this.picture.visible = false;
    this.message.visible = false;
  }

  protected theme(): BoardTheme {
    return this.deps.theme();
  }

  /** A diagram is drawn on paper, like the note it came out of. */
  protected surfaceColor(theme: BoardTheme): number {
    return theme.card;
  }

  protected contentSignature(data: DiagramObject): string {
    return [data.id, data.source].join(" ");
  }

  protected drawContent(): void {
    const data = this.data;
    if (!data) return;

    // Rendering is keyed on the source alone: the signature changes with every
    // resize, and a diagram redrawn on each one would rasterise on every frame
    // of a drag.
    if (data.source !== this.drawnSource) {
      this.drawnSource = data.source;
      void this.render(data.source);
    }
    this.layout();
    this.drawMessage();
  }

  /** Fitted inside the card, centred, with the whole drawing kept. */
  private layout(): void {
    const texture = this.picture.texture;
    if (!this.picture.visible || texture.width === 0 || texture.height === 0) return;

    const room = {
      width: Math.max(1, this.width - DIAGRAM_PADDING * 2),
      height: Math.max(1, this.height - DIAGRAM_PADDING * 2),
    };
    const scale = Math.min(room.width / texture.width, room.height / texture.height);
    const drawWidth = texture.width * scale;
    const drawHeight = texture.height * scale;

    this.picture.setSize(drawWidth, drawHeight);
    this.picture.position.set((this.width - drawWidth) / 2, (this.height - drawHeight) / 2);
  }

  private async render(source: string): Promise<void> {
    this.picture.visible = false;
    this.picture.texture = Texture.EMPTY;
    this.error = null;

    if (source.trim().length === 0) {
      // A diagram file with nothing in it. An empty card says that on its own.
      return;
    }

    try {
      const diagram = await renderMermaid(source, documentMermaidTheme());
      const texture = await svgTexture(diagram.svg, diagram.width, diagram.height);
      // The card may have been re-pointed at another file while mermaid worked.
      if (this.drawnSource !== source) return;

      this.picture.texture = texture;
      this.picture.visible = true;
      this.layout();
    } catch (failure) {
      if (this.drawnSource !== source) return;
      this.error = failure instanceof Error ? failure.message : String(failure);
      this.drawMessage();
    }
  }

  /**
   * Mermaid's own complaint, which names the line the diagram broke on. Drawn on
   * the card rather than swallowed: the file is on the board, so what is wrong
   * with it belongs on the board too.
   */
  private drawMessage(): void {
    const data = this.data;
    const failure = this.error;
    this.message.visible = data !== null && failure !== null;
    if (!data || failure === null) return;

    const theme = this.deps.theme();
    const column = Math.max(1, this.width - DIAGRAM_PADDING * 2);
    const runs: TextRun[] = [
      {
        text: failure,
        size: SHEET_TYPE.body,
        color: theme.dim,
        family: SANS,
        lineHeight: Math.round(SHEET_TYPE.body * 1.5),
        maxLines: 6,
      },
    ];

    const baked = this.deps.textures.get(
      `diagram:${themeRevision()}:${data.id}:${failure}`,
      runs,
      column,
      this.resolution,
    );
    this.message.texture = baked.texture;
    this.message.setSize(baked.width, baked.height);
    this.message.position.set(DIAGRAM_PADDING, DIAGRAM_PADDING);
  }
}

export function diagramKind(deps: DiagramDeps): CanvasObjectKind<DiagramObject> {
  return {
    kind: "diagram",
    parse: parseDiagram,
    createRenderer: (engine: CanvasEngineApi): CanvasObjectRenderer<DiagramObject> =>
      new DiagramCardRenderer(engine, deps),
    activate: (object: DiagramObject, gesture: ActivationGesture): void => {
      if (gesture === "doubleClick") deps.open(object);
    },
  };
}
