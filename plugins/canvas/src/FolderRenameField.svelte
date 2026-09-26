<script lang="ts">
  /**
   * A folder's name, edited where it is drawn. The field is laid over the name on
   * the card in the card's own world units and scaled by the camera, so the name
   * appears to become editable rather than to be replaced by a box: same panel
   * colour, same type, no border.
   *
   * It wraps like the drawn name and grows upward from the name's last line, so
   * the count under it stays uncovered. A name is held to the two lines the card
   * draws; an edit that would take it past them is turned away.
   *
   * Enter or clicking away keeps the new name; Escape keeps the old one. The
   * rename itself is a real `mv` of the directory, done by the vault store.
   */
  import { SANS } from "./engine/utils/textTexture";
  import type { OpenRename } from "./registry.svelte";
  import { canvasState } from "./state.svelte";
  import { boardTheme, CARD_TYPE, STICKY_COLORS } from "./theme";

  interface Props {
    rename: OpenRename;
  }

  const { rename }: Props = $props();

  /** The drawn name's type, which `FolderRenderer.drawLabel` sets. */
  const NAME_SIZE = CARD_TYPE.titleSize - 3;
  const LINE_HEIGHT = Math.round(NAME_SIZE * 1.25);
  const MAX_LINES = 2;

  const registry = canvasState.registry;
  const theme = boardTheme();
  const panelColor = `#${theme.cardRaised.toString(16).padStart(6, "0")}`;

  // Seeded once: the field owns the text from here, and the prop does not change
  // while it is open — a new rename remounts it.
  // svelte-ignore state_referenced_locally
  let value = $state(rename.name);
  /** The last text that fit in two lines, which a rejected edit falls back to. */
  // svelte-ignore state_referenced_locally
  let fitting = rename.name;
  /** Set once the field has answered, so the blur that follows Enter does not answer twice. */
  let settled = false;

  /** Where the name's last line ends: the field grows up from here. */
  const anchor = $derived(
    registry.worldToScreen(rename.rect.x, rename.rect.y + rename.rect.height),
  );
  const zoom = $derived(registry.camera.zoom);

  /** Sizes the field to its text, focuses it and selects the name, so typing replaces it. */
  function prepare(field: HTMLTextAreaElement): void {
    fitHeight(field);
    field.focus();
    field.select();
  }

  /**
   * Makes the field as tall as its text, and never shorter than the name it was
   * opened over, so no line of the drawn name shows above it. Answers how many
   * lines the text takes.
   */
  function fitHeight(field: HTMLTextAreaElement): number {
    field.style.height = "0px";
    const content = field.scrollHeight;
    field.style.height = `${Math.max(content, rename.rect.height)}px`;
    return Math.round(content / LINE_HEIGHT);
  }

  /**
   * A name is one line of text that wraps: a pasted line break becomes a space.
   * An edit that would take it past the drawn two lines is put back, with the
   * caret where it was before the edit.
   */
  function onInput(event: Event & { currentTarget: HTMLTextAreaElement }): void {
    const field = event.currentTarget;
    if (/[\r\n]/.test(field.value)) {
      value = field.value.replace(/\s*[\r\n]+\s*/g, " ");
      field.value = value;
    }
    if (fitHeight(field) <= MAX_LINES) {
      fitting = value;
      return;
    }
    const caret = field.selectionStart - (field.value.length - fitting.length);
    value = fitting;
    field.value = fitting;
    field.setSelectionRange(caret, caret);
    fitHeight(field);
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
  The anchor is the bottom left of the name, a point with no size, scaled from
  itself so the type matches the card's at any zoom; the field hangs above it.
-->
<div
  class="absolute z-overlay origin-top-left"
  style:left="{anchor.x}px"
  style:top="{anchor.y}px"
  style:transform="scale({zoom})"
>
  <textarea
    class="rename-field absolute bottom-0 left-0 block resize-none overflow-hidden border-0 p-0 font-semibold outline-none"
    style:width="{rename.rect.width}px"
    style:font-size="{NAME_SIZE}px"
    style:line-height="{LINE_HEIGHT}px"
    style:font-family={SANS}
    style:background={panelColor}
    style:color={theme.text}
    style:--rename-selection={STICKY_COLORS.blue.css}
    rows="1"
    aria-label="Folder name"
    spellcheck="false"
    bind:value
    use:prepare
    oninput={onInput}
    onkeydown={onKeydown}
    onblur={commit}></textarea>
</div>

<style>
  .rename-field::selection {
    background: var(--rename-selection);
  }
</style>
