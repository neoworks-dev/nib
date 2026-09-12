<script lang="ts">
  /**
   * A sticky, edited on the card rather than in a dialog. It is a DOM overlay laid
   * exactly over the card's bounds and styled to match it — bold sans title,
   * monospace body, the same padding — so the card appears to become editable
   * rather than to be replaced by something else.
   *
   * Inline editing on the Pixi card itself would mean a text engine with a caret,
   * selection and an IME inside the renderer. The overlay is the same pixels for
   * a fraction of that.
   */
  import { canvasState } from "./state.svelte";
  import { CARD_TYPE } from "./theme";

  const editor = canvasState.editor;
  const sticky = $derived(editor.sticky);

  /** The line to put the caret in once it is rendered, or null. */
  let caretAt = $state<number | null>(null);

  /** A new sticky opens with the caret in its title, which is the first line. */
  $effect(() => {
    if (sticky?.blocks && caretAt === null) caretAt = 0;
  });

  function onKeydown(event: KeyboardEvent): void {
    if (event.key !== "Escape" || !sticky) return;
    event.preventDefault();
    editor.requestClose();
  }

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
</script>

<svelte:window onkeydown={onKeydown} />

{#if sticky}
  <!-- svelte-ignore a11y_click_events_have_key_events -->
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div class="absolute inset-0 z-modal" onclick={() => editor.requestClose()}>
    <!-- svelte-ignore a11y_click_events_have_key_events -->
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div
      class="absolute overflow-hidden rounded-xl bg-[#f4f5f7] shadow-2xl"
      style:left="{sticky.origin.x}px"
      style:top="{sticky.origin.y}px"
      style:width="{sticky.origin.width}px"
      style:height="{sticky.origin.height}px"
      style:padding="{CARD_TYPE.padding}px"
      onclick={(event) => event.stopPropagation()}
    >
      {#if sticky.error}
        <p class="text-sm text-red">{sticky.error}</p>
      {:else if sticky.blocks === null}
        <p class="text-sm text-neutral-400">Reading…</p>
      {:else}
        {#each sticky.blocks as block, index (index)}
          <div class="relative">
            {#if block.style === "task"}
              <button
                type="button"
                aria-label="Toggle this task"
                class="absolute top-1.5 left-0 size-3 rounded-sm border border-neutral-400"
                class:bg-black={block.done}
                class:border-black={block.done}
                onclick={() => editor.toggle(index)}
              ></button>
            {/if}

            <div
              contenteditable="plaintext-only"
              role="textbox"
              tabindex="0"
              use:focusLine={index}
              class="outline-none"
              class:pl-[21px]={block.style === "task" || block.style === "list"}
              class:font-bold={index === 0}
              class:text-black={index === 0}
              class:text-neutral-600={index !== 0}
              class:font-mono={index !== 0}
              class:line-through={block.done}
              style:font-size="{index === 0 ? CARD_TYPE.titleSize : CARD_TYPE.bodySize}px"
              style:line-height={index === 0 ? "1.25" : "1.6"}
              onkeydown={(event) => onLineKeydown(event, index)}
              oninput={(event) =>
                editor.setText(index, (event.currentTarget as HTMLElement).textContent ?? "")}
            >
              {block.text}
            </div>
          </div>
        {/each}
      {/if}
    </div>
  </div>
{/if}
