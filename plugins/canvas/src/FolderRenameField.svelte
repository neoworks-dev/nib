<script lang="ts">
  /**
   * A folder's name, edited where it is drawn. The field is laid over the name on
   * the card in the card's own world units and scaled by the camera, so the name
   * appears to become editable rather than to be replaced by a box.
   *
   * Enter or clicking away keeps the new name; Escape keeps the old one. The
   * rename itself is a real `mv` of the directory, done by the vault store.
   */
  import type { OpenRename } from "./registry.svelte";
  import { canvasState } from "./state.svelte";
  import { CARD_TYPE } from "./theme";

  interface Props {
    rename: OpenRename;
  }

  const { rename }: Props = $props();

  const registry = canvasState.registry;

  // Seeded once: the field owns the text from here, and the prop does not change
  // while it is open — a new rename remounts it.
  // svelte-ignore state_referenced_locally
  let value = $state(rename.name);
  /** Set once the field has answered, so the blur that follows Enter does not answer twice. */
  let settled = false;

  const origin = $derived(registry.worldToScreen(rename.rect.x, rename.rect.y));
  const zoom = $derived(registry.camera.zoom);

  /** Focuses the field and selects the name, so typing replaces it. */
  function selectOnMount(field: HTMLInputElement): void {
    field.focus();
    field.select();
  }

  /** Keeps the new name, if it is one, and closes the field. */
  function commit(): void {
    if (settled) return;
    settled = true;
    // Read before closing: closing unmounts the field, and the prop goes with it.
    const { path, name: previous } = rename;
    registry.closeRename();
    const name = value.trim();
    if (name.length === 0 || name === previous) return;
    void canvasState.vault.renameEntry(path, name);
  }

  /** Closes the field with the name as it was. */
  function cancel(): void {
    if (settled) return;
    settled = true;
    registry.closeRename();
  }

  function onKeydown(event: KeyboardEvent): void {
    if (event.key === "Enter") {
      event.preventDefault();
      commit();
      return;
    }
    if (event.key !== "Escape") return;
    event.preventDefault();
    // The board's own Escape clears the selection; this one only ends the edit.
    event.stopPropagation();
    cancel();
  }
</script>

<!--
  Laid out in world units and scaled from its top left, which is the point the
  name is placed by, so the type matches the card's at any zoom.
-->
<input
  class="absolute z-overlay origin-top-left rounded-md bg-surface px-1 font-semibold text-text shadow-md outline-none ring-2 ring-action"
  style:left="{origin.x}px"
  style:top="{origin.y}px"
  style:width="{rename.rect.width}px"
  style:height="{rename.rect.height}px"
  style:font-size="{CARD_TYPE.titleSize - 3}px"
  style:transform="scale({zoom})"
  aria-label="Folder name"
  spellcheck="false"
  bind:value
  use:selectOnMount
  onkeydown={onKeydown}
  onblur={commit}
/>
