<script lang="ts">
  /**
   * The block menu a paragraph grip opens: four styles, a divider, then the two
   * list kinds. Exactly one row is greyed — the style the block already has —
   * because picking it would do nothing, and dropping it from the list would make
   * it a style the user cannot get back to.
   *
   * `@neoworks-dev/ui` has no menu or popover primitive; `ListRow` is a full-width
   * row for a list surface, not a floating menu, and `Select` is a form control
   * bound to a value rather than a command list.
   */
  import { type BlockStyle, blockStyleRows } from "./markdown";

  const { current, onPick }: { current: BlockStyle; onPick: (style: BlockStyle) => void } =
    $props();

  const rows = $derived(blockStyleRows(current));
</script>

<div class="w-[370px] rounded-2xl bg-white py-2 shadow-2xl ring-1 ring-black/5">
  {#each rows as row (row.style)}
    {#if row.dividerBefore}
      <div class="my-2 h-px bg-neutral-200"></div>
    {/if}
    <button
      type="button"
      disabled={row.disabled}
      class="mx-2 flex w-[calc(100%-1rem)] items-center gap-3 rounded-lg px-3 py-2.5 text-left text-sm"
      class:text-neutral-300={row.disabled}
      class:text-neutral-800={!row.disabled}
      class:hover:bg-neutral-100={!row.disabled}
      onclick={() => onPick(row.style)}
    >
      <span class="grow">{row.label}</span>
      <span
        class="text-xs"
        class:text-neutral-300={row.disabled}
        class:text-neutral-400={!row.disabled}
      >
        {row.hint}
      </span>
    </button>
  {/each}
</div>
