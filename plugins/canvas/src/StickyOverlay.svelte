<script lang="ts">
  /**
   * A sticky, edited on the card rather than in a dialog. It is a DOM overlay laid
   * exactly over the card's bounds and styled to match it — the same paper colour,
   * the same padding, the same angle on the table — so the card appears to become
   * editable rather than to be replaced by something else.
   *
   * Inline editing on the Pixi card itself would mean a text engine with a caret,
   * selection and an IME inside the renderer. The overlay is the same pixels for
   * a fraction of that.
   */
  import MarkdownEditor from "./MarkdownEditor.svelte";
  import { canvasState } from "./state.svelte";
  import { CARD_TYPE, STICKY_COLORS, stickyColor } from "./theme";

  const editor = canvasState.editor;
  const placed = $derived(editor.sticky);
  const sticky = $derived(editor.stickyNote());
  const path = $derived(placed?.path ?? "");

  /** The card's own paper, so the overlay is the note rather than a panel over it. */
  const paper = $derived.by(() => {
    const card = canvasState.objects.find((object) => object.id === path);
    const declared = typeof card?.["color"] === "string" ? card["color"] : null;
    return STICKY_COLORS[stickyColor(declared)].css;
  });
  const tilt = $derived(((placed?.tilt ?? 0) * 180) / Math.PI);

  function onKeydown(event: KeyboardEvent): void {
    if (event.key !== "Escape" || !sticky) return;
    event.preventDefault();
    void editor.closeSticky();
  }
</script>

<svelte:window onkeydown={onKeydown} />

{#if sticky && placed}
  <!-- svelte-ignore a11y_click_events_have_key_events -->
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div class="absolute inset-0 z-modal" onclick={() => void editor.closeSticky()}>
    <!-- svelte-ignore a11y_click_events_have_key_events -->
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <!--
      Laid out in the card's own world units and then scaled by the camera, so
      the type on the overlay is the type on the card at any zoom. Scaling and
      turning happen about the middle, which is the point the card is placed by.
    -->
    <div
      class="absolute origin-center overflow-hidden rounded-xl text-neutral-950 shadow-2xl"
      style:left="{placed.centre.x - placed.size.w / 2}px"
      style:top="{placed.centre.y - placed.size.h / 2}px"
      style:width="{placed.size.w}px"
      style:min-height="{placed.size.h}px"
      style:padding="{CARD_TYPE.padding}px"
      style:background={paper}
      style:transform="scale({placed.zoom}) rotate({tilt}deg)"
      onclick={(event) => event.stopPropagation()}
    >
      {#if sticky.error}
        <p class="text-sm text-red">{sticky.error}</p>
      {:else if sticky.text === null}
        <p class="text-sm text-neutral-500">Reading…</p>
      {:else}
        <MarkdownEditor
          text={sticky.text}
          onChange={(text) => editor.setText(path, text)}
          theme="sticky"
          autofocus
        />
      {/if}
    </div>
  </div>
{/if}
