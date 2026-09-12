<script lang="ts">
  /**
   * A sheet, full-screen. White, no chrome at all: no title bar, no close button,
   * no border. Escape or a click outside the page closes it, and it shrinks back
   * into the card it grew out of.
   *
   * Every line is its own editable element rather than one textarea, because a
   * line is a block and a block has a style: a single field could not draw a
   * heading as a heading, and the grip would have nothing to point at.
   *
   * Nothing from `@neoworks-dev/ui` fits here. `Card` is a bordered, elevated
   * surface and this is a full-bleed page with no edge of its own, and there is
   * no modal or overlay primitive in the package to build on.
   */
  import BlockPopover from "./BlockPopover.svelte";
  import { canvasState } from "./state.svelte";

  const editor = canvasState.editor;
  const sheet = $derived(editor.sheet);
  const closing = $derived(editor.closing);
  const popover = $derived(editor.popover);

  /** The page is ~800px of text, centred, whatever the pane is. */
  const PAGE_WIDTH = 800;
  const OPEN_MS = 260;

  /**
   * The open transition runs from the card's own rectangle to the full pane, so
   * the sheet reads as the card growing rather than as a dialog appearing. It is
   * driven by a flag rather than a keyframe so the same values run it backwards.
   */
  let grown = $state(false);
  /** The line to put the caret in once it is rendered, or null. */
  let caretAt = $state<number | null>(null);

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
    const handle = setTimeout(() => void editor.closed(), OPEN_MS);
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
    if (popover) {
      editor.closePopover();
      return;
    }
    editor.requestClose();
  }

  /**
   * Enter starts the next block and Backspace on an empty line folds it into the
   * one above, which is the whole of the keyboard model: everything else a line
   * does is typing.
   */
  function onLineKeydown(event: KeyboardEvent, index: number): void {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      caretAt = editor.splitAt(index);
      return;
    }
    const target = event.currentTarget as HTMLElement;
    if (event.key === "Backspace" && target.textContent?.length === 0) {
      event.preventDefault();
      caretAt = editor.removeAt(index);
    }
  }

  /** Puts the caret at the end of a line the model just asked for. */
  function focusLine(element: HTMLElement, index: number): { destroy(): void } {
    $effect(() => {
      if (caretAt !== index) return;
      caretAt = null;
      element.focus();
      const range = document.createRange();
      range.selectNodeContents(element);
      range.collapse(false);
      const selection = globalThis.getSelection();
      selection?.removeAllRanges();
      selection?.addRange(range);
    });
    return { destroy() {} };
  }

  function openGrip(event: MouseEvent, index: number): void {
    const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
    const host = (event.currentTarget as HTMLElement).closest(".sheet-page");
    const origin = host?.getBoundingClientRect() ?? { left: 0, top: 0 };
    editor.openPopover(index, rect.right - origin.left, rect.top - origin.top);
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
      class="sheet-page absolute overflow-y-auto bg-white"
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
        class="relative mx-auto px-16 py-16 transition-opacity duration-150"
        class:opacity-30={popover !== null}
        style:max-width="{PAGE_WIDTH}px"
        onclick={(event) => event.stopPropagation()}
      >
        {#if sheet.error}
          <p class="text-sm text-red">{sheet.error}</p>
        {:else if sheet.blocks === null}
          <p class="text-sm text-neutral-400">Reading…</p>
        {:else}
          {#each sheet.blocks as block, index (index)}
            <div class="group relative">
              <!--
                The grip. Transparent until the row is hovered, so a page at rest
                is text and nothing else.
              -->
              <button
                type="button"
                aria-label="Change this block"
                class="absolute top-1 -left-12 flex h-7 w-[46px] items-center justify-center rounded-full text-neutral-400 opacity-0 transition-opacity group-hover:opacity-100 hover:bg-neutral-100"
                onclick={(event) => openGrip(event, index)}
              >
                ••
              </button>

              {#if block.style === "task"}
                <button
                  type="button"
                  aria-label="Toggle this task"
                  class="absolute top-2.5 left-0 size-3.5 rounded-sm border border-neutral-400"
                  class:bg-black={block.done}
                  class:border-black={block.done}
                  onclick={() => editor.toggle(index)}
                ></button>
              {:else if block.style === "list"}
                <span class="absolute top-2 left-0.5 text-neutral-400">·</span>
              {/if}

              <div
                contenteditable="plaintext-only"
                role="textbox"
                tabindex="0"
                use:focusLine={index}
                class="outline-none"
                class:pl-6={block.style === "task" || block.style === "list"}
                class:text-5xl={block.style === "display"}
                class:font-bold={block.style === "display"}
                class:tracking-tight={block.style === "display"}
                class:leading-tight={block.style === "display"}
                class:text-2xl={block.style === "headline"}
                class:text-lg={block.style === "subheader"}
                class:font-semibold={block.style === "headline" || block.style === "subheader"}
                class:text-base={block.style === "body" ||
                  block.style === "list" ||
                  block.style === "task"}
                class:leading-relaxed={block.style === "body"}
                class:text-black={block.style !== "body"}
                class:text-neutral-800={block.style === "body"}
                class:py-1={true}
                onkeydown={(event) => onLineKeydown(event, index)}
                oninput={(event) =>
                  editor.setText(index, (event.currentTarget as HTMLElement).textContent ?? "")}
              >
                {block.text}
              </div>
            </div>
          {/each}
        {/if}

        {#if popover}
          <!-- svelte-ignore a11y_click_events_have_key_events -->
          <!-- svelte-ignore a11y_no_static_element_interactions -->
          <div class="fixed inset-0 z-overlay" onclick={() => editor.closePopover()}></div>
          <div
            class="absolute z-overlay opacity-100"
            style:left="{popover.x}px"
            style:top="{popover.y}px"
          >
            <BlockPopover
              current={sheet.blocks?.[popover.index]?.style ?? "body"}
              onPick={(style) => editor.setStyle(popover.index, style)}
            />
          </div>
        {/if}
      </div>
    </div>
  </div>
{/if}
