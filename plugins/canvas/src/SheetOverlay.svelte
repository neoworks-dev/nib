<script lang="ts">
  /**
   * A sheet, full-screen. White, no chrome at all: no title bar, no close button,
   * no border. Escape or a click outside the page closes it, and it shrinks back
   * into the card it grew out of.
   *
   * Nothing from `@neoworks-dev/ui` fits here. `Card` is a bordered, elevated
   * surface and this is a full-bleed page with no edge of its own, and there is
   * no modal or overlay primitive in the package to build on.
   */
  import { parseDocument } from "./markdown";
  import { canvasState } from "./state.svelte";
  import { CARD_TYPE } from "./theme";

  const editor = canvasState.editor;
  const sheet = $derived(editor.sheet);
  const closing = $derived(editor.closing);

  /** The page is ~800px of text, centred, whatever the pane is. */
  const PAGE_WIDTH = 800;
  const OPEN_MS = 260;

  const blocks = $derived.by(() => {
    const source = sheet?.source;
    if (source === null || source === undefined) return [];
    return parseDocument(source).blocks;
  });

  /**
   * The open transition runs from the card's own rectangle to the full pane, so
   * the sheet reads as the card growing rather than as a dialog appearing. It is
   * driven by a flag rather than a keyframe so the same values run it backwards.
   */
  let grown = $state(false);

  $effect(() => {
    if (!sheet) {
      grown = false;
      return;
    }
    // One frame at the card's size, then the grown size, so the browser has two
    // states to interpolate between rather than one.
    const handle = requestAnimationFrame(() => {
      grown = true;
    });
    return () => cancelAnimationFrame(handle);
  });

  $effect(() => {
    if (!closing) return;
    grown = false;
    const handle = setTimeout(() => editor.closed(), OPEN_MS);
    return () => clearTimeout(handle);
  });

  const frame = $derived.by(() => {
    const origin = sheet?.origin;
    if (!origin || grown) return null;
    return origin;
  });

  function onKeydown(event: KeyboardEvent): void {
    if (event.key !== "Escape" || !sheet) return;
    event.preventDefault();
    editor.requestClose();
  }
</script>

<svelte:window onkeydown={onKeydown} />

{#if sheet}
  <!-- svelte-ignore a11y_click_events_have_key_events -->
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div
    class="absolute inset-0 z-modal overflow-hidden"
    onclick={(event) => event.target === event.currentTarget && editor.requestClose()}
  >
    <div
      class="absolute overflow-y-auto bg-white"
      style:left="{frame ? frame.x : 0}px"
      style:top="{frame ? frame.y : 0}px"
      style:width={frame ? `${frame.width}px` : "100%"}
      style:height={frame ? `${frame.height}px` : "100%"}
      style:opacity={frame ? "0.4" : "1"}
      style:transition="left {OPEN_MS}ms ease-out, top {OPEN_MS}ms ease-out, width {OPEN_MS}ms
      ease-out, height {OPEN_MS}ms ease-out, opacity {OPEN_MS}ms ease-out"
    >
      <!-- svelte-ignore a11y_click_events_have_key_events -->
      <!-- svelte-ignore a11y_no_static_element_interactions -->
      <div
        class="mx-auto px-10 py-16"
        style:max-width="{PAGE_WIDTH}px"
        onclick={(event) => event.stopPropagation()}
      >
        {#if sheet.error}
          <p class="text-sm text-red">{sheet.error}</p>
        {:else if sheet.source === null}
          <p class="text-sm text-dim">Reading…</p>
        {:else}
          {#each blocks as block, index (index)}
            {#if block.style === "display"}
              <h1
                class="mt-6 mb-3 font-bold tracking-tight text-black"
                style:font-size="{CARD_TYPE.headlineSize * 1.9}px"
                style:line-height="1.12"
              >
                {block.text}
              </h1>
            {:else if block.style === "headline"}
              <h2 class="mt-6 mb-2 text-2xl font-semibold text-black">{block.text}</h2>
            {:else if block.style === "subheader"}
              <h3 class="mt-5 mb-2 text-lg font-semibold text-black">{block.text}</h3>
            {:else if block.style === "list"}
              <p class="my-1 pl-6 text-base text-neutral-800">· {block.text}</p>
            {:else if block.style === "task"}
              <p class="my-1 flex items-start gap-2 pl-6 text-base text-neutral-800">
                <span
                  class="mt-1.5 inline-block size-3 shrink-0 rounded-sm border border-neutral-400"
                  class:bg-black={block.done}
                  class:border-black={block.done}
                ></span>
                <span>{block.text}</span>
              </p>
            {:else if block.text.trim().length === 0}
              <div class="h-4"></div>
            {:else}
              <p class="my-2 text-base leading-relaxed text-neutral-800">{block.text}</p>
            {/if}
          {/each}
        {/if}
      </div>
    </div>
  </div>
{/if}
