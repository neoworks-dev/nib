<script lang="ts">
  import { renderMermaid, renderedMermaid } from "@nib-ui/render";
  import type { RendererProps } from "@nib-ui/ui-contracts";
  // KaTeX draws with its own fonts and its own metrics; without the stylesheet
  // a formula is a pile of overlapping characters.
  import "katex/dist/katex.min.css";
  import { documentTheme } from "./document-theme.svelte";
  import { MERMAID_SOURCE_ATTRIBUTE, openFence, renderMarkdown } from "./markdown";

  const { block }: RendererProps = $props();
  const html = $derived(renderMarkdown(block.text));
  const theme = $derived(documentTheme());

  let host = $state<HTMLElement | null>(null);

  /**
   * Fills in every mermaid fence the markdown left a placeholder for. The
   * markdown is replaced wholesale on each chunk of a streaming reply, so the
   * placeholders are new elements every time and a diagram already drawn is put
   * back from the cache in this same tick rather than after another render.
   */
  $effect(() => {
    const container = host;
    // The markup is what the placeholders come from, so a change to it is what
    // this runs on; the theme is what they are drawn in.
    const source = html;
    const drawIn = theme;
    if (!container || source.length === 0) return;

    const placeholders = [
      ...container.querySelectorAll<HTMLElement>(`[${MERMAID_SOURCE_ATTRIBUTE}]`),
    ];
    // A reply still arriving can stop mid-diagram. Rendering that draws an error
    // where the diagram is about to be, so the open one is left blank until the
    // fence that closes it turns up.
    if (openFence(block.text)) placeholders.pop();

    let dropped = false;
    for (const placeholder of placeholders) {
      const diagram = placeholder.getAttribute(MERMAID_SOURCE_ATTRIBUTE);
      if (diagram === null) continue;

      const drawn = renderedMermaid(diagram, drawIn);
      if (drawn) {
        placeholder.innerHTML = drawn.svg;
        continue;
      }
      void renderMermaid(diagram, drawIn).then(
        (rendered) => {
          if (!dropped) placeholder.innerHTML = rendered.svg;
        },
        (error: unknown) => {
          if (!dropped) placeholder.replaceChildren(diagramError(error));
        },
      );
    }

    return () => {
      dropped = true;
    };
  });

  /**
   * What a diagram that will not parse shows: mermaid's own message, which names
   * the line it broke on. The source stays on the element, so a later chunk that
   * finishes the diagram redraws it.
   */
  function diagramError(error: unknown): HTMLElement {
    const note = document.createElement("p");
    note.className = "mermaid-error";
    note.textContent = error instanceof Error ? error.message : String(error);
    return note;
  }
</script>

<div bind:this={host} class="markdown text-base leading-relaxed text-default">
  {@html html}
  {#if !block.completed}
    <span class="ml-0.5 inline-block h-4 w-1.5 animate-pulse bg-muted align-text-bottom"></span>
  {/if}
</div>

<style>
  .markdown :global(> :first-child) {
    margin-top: 0;
  }

  .markdown :global(> :last-child) {
    margin-bottom: 0;
  }

  .markdown :global(p) {
    margin-block: 0.5rem;
  }

  .markdown :global(ul),
  .markdown :global(ol) {
    margin-block: 0.5rem;
    padding-inline-start: 1.35rem;
  }

  .markdown :global(ul) {
    list-style: disc;
  }

  .markdown :global(ol) {
    list-style: decimal;
  }

  .markdown :global(li) {
    margin-block: 0.125rem;
  }

  .markdown :global(li > ul),
  .markdown :global(li > ol),
  .markdown :global(li > p) {
    margin-block: 0.125rem;
  }

  .markdown :global(h1),
  .markdown :global(h2),
  .markdown :global(h3),
  .markdown :global(h4) {
    margin-top: 0.75rem;
    margin-bottom: 0.25rem;
    font-weight: 600;
  }

  .markdown :global(h1) {
    font-size: var(--text-lg);
  }

  .markdown :global(h2) {
    font-size: var(--text-md);
  }

  .markdown :global(strong) {
    font-weight: 600;
    color: var(--text);
  }

  .markdown :global(a) {
    color: var(--ctx-blue);
    text-decoration: underline;
  }

  .markdown :global(code) {
    border-radius: var(--radius-sm);
    background: var(--surface-raised);
    padding: 0.125rem 0.25rem;
    font-size: var(--text-xs);
  }

  .markdown :global(pre) {
    margin-block: 0.5rem;
    overflow-x: auto;
    border: 1px solid var(--border);
    border-radius: var(--radius-md);
    background: var(--surface-input);
    padding: 0.75rem;
    font-size: var(--text-xs);
  }

  .markdown :global(pre code) {
    background: transparent;
    padding: 0;
  }

  .markdown :global(blockquote) {
    margin-block: 0.5rem;
    border-inline-start: 2px solid var(--border);
    padding-inline-start: 0.75rem;
    color: var(--text-muted);
  }

  .markdown :global(hr) {
    margin-block: 0.75rem;
    border-color: var(--border);
  }

  .markdown :global(table) {
    margin-block: 0.5rem;
    border-collapse: collapse;
  }

  .markdown :global(th),
  .markdown :global(td) {
    border: 1px solid var(--border);
    padding: 0.25rem 0.5rem;
    text-align: left;
  }

  .markdown :global(img) {
    max-width: 100%;
    border-radius: var(--radius-md);
  }

  .markdown :global(.mermaid) {
    margin-block: 0.75rem;
    overflow-x: auto;
  }

  /* The diagram carries its own size, which is what lets it shrink into the column. */
  .markdown :global(.mermaid svg) {
    max-width: 100%;
    height: auto;
  }

  .markdown :global(.mermaid-error) {
    border-radius: var(--radius-md);
    border: 1px solid var(--border);
    padding: 0.5rem 0.75rem;
    font-size: var(--text-xs);
    color: var(--ctx-red);
  }
</style>
