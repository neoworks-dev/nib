<script lang="ts">
  /**
   * A sheet, in a pane docked beside the board. White, no chrome of its own: the
   * pane's title bar is what closes it, and the page fills whatever the dock is.
   *
   * Nothing from `@neoworks-dev/ui` fits here. `Card` is a bordered, elevated
   * surface and this is a full-bleed page with no edge of its own.
   */
  import type { PaneProps } from "@nib-ui/ui-contracts";
  import { untrack } from "svelte";
  import MarkdownEditor from "./MarkdownEditor.svelte";
  import { canvasState } from "./state.svelte";

  const { params }: PaneProps = $props();

  const editor = canvasState.editor;
  const path = $derived((params as { path?: string } | undefined)?.path ?? "");
  const note = $derived(path.length > 0 ? editor.note(path) : null);

  /** The page is ~800px of text, centred, whatever the dock is. */
  const PAGE_WIDTH = 800;

  // The pane is what holds a note open: closing it is what writes and drops it.
  // The open is untracked because it reads the note it is about to add, and an
  // effect that both reads and writes that reopens the note forever.
  $effect(() => {
    const target = path;
    if (target.length === 0) return;
    untrack(() => void editor.open(target));
    return () => void editor.close(target);
  });
</script>

<div class="sheet-page relative h-full w-full overflow-y-auto bg-white">
  <div class="relative mx-auto px-16 py-10" style:max-width="{PAGE_WIDTH}px">
    {#if !note}
      <p class="text-sm text-neutral-400">No note is open.</p>
    {:else if note.error}
      <p class="text-sm text-red">{note.error}</p>
    {:else if note.text === null}
      <p class="text-sm text-neutral-400">Reading…</p>
    {:else}
      <MarkdownEditor
        text={note.text}
        onChange={(text) => editor.setText(path, text)}
        theme="sheet"
        autofocus
      />
    {/if}
  </div>
</div>
