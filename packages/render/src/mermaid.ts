/**
 * Mermaid as one call, shared by everything that draws a diagram: the chat's
 * markdown, the note editor's live preview, and the board's own diagram card.
 *
 * Mermaid renders through the DOM — it lays a diagram out by measuring real text
 * in a detached element — so this is browser-only. Nothing here is imported from
 * a test or from the server.
 *
 * The SVG comes back sized. Mermaid's own root carries a `viewBox` and a
 * percentage width, which is what a page wants and what a rasteriser cannot use:
 * an `<img>` of a width-less SVG decodes to nothing, and that is the board's
 * whole path onto a texture.
 */

import mermaid from "mermaid";

export interface MermaidDiagram {
  /** The rendered markup, with explicit `width`/`height` on its root. */
  svg: string;
  /** The diagram's own size in user units, which is what fits it to a card. */
  width: number;
  height: number;
}

export type MermaidTheme = "light" | "dark";

/**
 * A source mermaid will not parse. The message is mermaid's own — it names the
 * line the diagram broke on, which is the only thing worth showing the author.
 */
export class MermaidError extends Error {
  override readonly name = "MermaidError";
}

/** What mermaid was last initialised for, so a theme switch reconfigures it. */
let configuredTheme: MermaidTheme | null = null;

function configure(theme: MermaidTheme): void {
  if (configuredTheme === theme) return;
  configuredTheme = theme;
  mermaid.initialize({
    startOnLoad: false,
    // A diagram in a chat is model output and a diagram in the vault is a file
    // someone was handed. Neither is trusted, so the markup mermaid emits is
    // sanitised and no label may carry a script or a link out.
    securityLevel: "strict",
    theme: theme === "dark" ? "dark" : "neutral",
    fontFamily: "system-ui, -apple-system, BlinkMacSystemFont, sans-serif",
    // Labels as SVG text rather than as HTML in a `foreignObject`. The board
    // draws a diagram by rasterising it through an `<img>`, and a browser
    // renders no foreign content there: every label would come out blank.
    flowchart: { htmlLabels: false },
  });
}

/**
 * Renders are cached by source and theme: a streaming message re-renders its
 * markdown on every chunk, and a card redraws whenever the board does. The entry
 * is the promise rather than the result, so two cards holding the same diagram
 * share one render instead of racing.
 */
const cache = new Map<string, Promise<MermaidDiagram>>();

/** Mermaid writes this into the ids inside the SVG, so it has to be unique. */
let renderCount = 0;

/**
 * The same renders, settled. A diagram already drawn goes back onto the page in
 * the tick it is asked for, which is what keeps a streaming message from blinking
 * its diagrams once per chunk as the markdown around them is replaced.
 */
const settled = new Map<string, MermaidDiagram>();

function cacheKey(source: string, theme: MermaidTheme): string {
  return `${theme}:${source}`;
}

/** What `renderMermaid` already drew for this source, if anything has. */
export function renderedMermaid(
  source: string,
  theme: MermaidTheme = "light",
): MermaidDiagram | undefined {
  return settled.get(cacheKey(source, theme));
}

/** The theme the page is in, which is the one a diagram is drawn for. */
export function documentMermaidTheme(root: HTMLElement = document.documentElement): MermaidTheme {
  return root.dataset["theme"] === "dark" ? "dark" : "light";
}

export async function renderMermaid(
  source: string,
  theme: MermaidTheme = "light",
): Promise<MermaidDiagram> {
  const key = cacheKey(source, theme);
  const cached = cache.get(key);
  if (cached) return cached;

  const pending = render(source, theme).then((diagram) => {
    settled.set(key, diagram);
    return diagram;
  });
  cache.set(key, pending);
  // A diagram that failed because the author was mid-word has to be able to
  // render once it is finished, so only what succeeded is kept.
  pending.catch(() => cache.delete(key));
  return pending;
}

async function render(source: string, theme: MermaidTheme): Promise<MermaidDiagram> {
  configure(theme);
  renderCount += 1;
  const id = `nib-mermaid-${renderCount}`;

  try {
    const { svg } = await mermaid.render(id, source);
    return sized(svg);
  } catch (error) {
    // Mermaid lays the diagram out in an element it appends to the body and
    // takes away once it has measured it. A source it cannot parse throws out of
    // the middle of that, leaving the scratch element on the page for good.
    document.getElementById(`d${id}`)?.remove();
    throw new MermaidError(error instanceof Error ? error.message : String(error));
  }
}

/**
 * The same SVG with its own size on it. `max-width` is appended rather than
 * replaced so the diagram still shrinks into a narrow column in a page, while
 * the width and height attributes give an `<img>` something to decode against.
 *
 * Not every diagram type comes back the same way. Most carry a `viewBox`, some
 * carry only `width` and `height`, and some carry a percentage width and nothing
 * else at all — so the last resort is to put the thing on the page and measure
 * what it drew.
 */
function sized(svg: string): MermaidDiagram {
  const root = parseSvg(svg);
  const box = boxOf(root);

  root.setAttribute("viewBox", `${box.x} ${box.y} ${box.width} ${box.height}`);
  root.setAttribute("width", String(box.width));
  root.setAttribute("height", String(box.height));
  const style = root.getAttribute("style");
  root.setAttribute("style", style === null ? "max-width:100%" : `${style};max-width:100%`);
  // The HTML parser keeps the namespace on the node rather than as an attribute,
  // and an `<img>` decodes an SVG only if the markup declares it.
  if (!root.hasAttribute("xmlns")) root.setAttribute("xmlns", "http://www.w3.org/2000/svg");

  return {
    svg: new XMLSerializer().serializeToString(root),
    width: box.width,
    height: box.height,
  };
}

interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Through the HTML parser rather than the XML one. Mermaid's output is not
 * always well-formed XML — a label carrying a bare `&`, or an entity the XML
 * parser has never heard of, is enough — and an XML parse that fails returns a
 * `<parsererror>` document instead of throwing, which is an element with none of
 * an SVG's own methods on it. The HTML parser takes the same markup and gives
 * back a real `<svg>`.
 */
function parseSvg(svg: string): SVGSVGElement {
  const root = new DOMParser().parseFromString(svg, "text/html").body.querySelector("svg");
  if (!root) throw new MermaidError("The diagram rendered without an <svg> root.");
  return root;
}

/** What the diagram measures, by whichever of the three the render left behind. */
function boxOf(root: SVGSVGElement): Box {
  const declared = viewBoxOf(root);
  if (declared) return declared;

  const declaredSize = attributeSizeOf(root);
  if (declaredSize) return declaredSize;

  return measuredBoxOf(root);
}

function viewBoxOf(root: Element): Box | null {
  const viewBox = root.getAttribute("viewBox");
  if (viewBox === null) return null;

  const [x = NaN, y = NaN, width = NaN, height = NaN] = viewBox.split(/[\s,]+/).map(Number);
  if (!usable(width) || !usable(height) || !Number.isFinite(x) || !Number.isFinite(y)) return null;
  return { x, y, width, height };
}

/** `width="820"` or `width="820px"`. A percentage says nothing about a size. */
function attributeSizeOf(root: Element): Box | null {
  const width = lengthOf(root.getAttribute("width"));
  const height = lengthOf(root.getAttribute("height"));
  if (width === null || height === null) return null;
  return { x: 0, y: 0, width, height };
}

function lengthOf(value: string | null): number | null {
  if (value === null || value.trim().endsWith("%")) return null;
  const length = Number.parseFloat(value);
  return usable(length) ? length : null;
}

/**
 * What the diagram actually drew, measured off the page. The element has to be
 * in the document for the browser to lay its geometry out, so it goes into a
 * hidden holder and comes straight back out — `getBBox` is geometry rather than
 * layout, so nothing about where it was put changes the answer.
 */
function measuredBoxOf(root: SVGSVGElement): Box {
  const holder = document.createElement("div");
  holder.setAttribute("style", "position:absolute;left:-99999px;top:0;visibility:hidden");
  document.body.append(holder);
  holder.append(root);

  try {
    const box = root.getBBox();
    if (!usable(box.width) || !usable(box.height))
      throw new MermaidError("The diagram rendered without a size.");
    // Rounded outwards: half a pixel of a box clipped off an edge is a line of
    // the diagram missing from the card that draws it.
    return {
      x: Math.floor(box.x),
      y: Math.floor(box.y),
      width: Math.ceil(box.width + (box.x - Math.floor(box.x))),
      height: Math.ceil(box.height + (box.y - Math.floor(box.y))),
    };
  } finally {
    root.remove();
    holder.remove();
  }
}

function usable(value: number): boolean {
  return Number.isFinite(value) && value > 0;
}
