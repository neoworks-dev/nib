<script lang="ts">
  import { Button, LoadingSpinner, Select } from "@neoworks-dev/ui";
  import type { PaneProps } from "@nib-ui/ui-contracts";
  import ArrowsClockwiseIcon from "phosphor-svelte/lib/ArrowsClockwiseIcon";
  import { type PinterestPin, pinTransferType } from "./pins";
  import { pinterestState } from "./state.svelte";

  const { session: _session }: PaneProps = $props();

  const boardOptions = $derived(
    pinterestState.boards.map((board) => ({
      value: board.id,
      label: `${board.name} (${board.pinCount})`,
    })),
  );

  $effect(() => {
    void pinterestState.load();
    return pinterestState.watchConnection();
  });

  function chooseBoard(value: string | string[]): void {
    if (Array.isArray(value) || value.length === 0) return;
    void pinterestState.selectBoard(value);
  }

  /**
   * The pin travels, not the picture: whatever catches the drop has the server
   * copy the bytes into the asset store. The plain-text fallback is the pin's
   * page, which a composer and the links handler both understand.
   */
  function startDrag(event: DragEvent, pin: PinterestPin): void {
    const transfer = event.dataTransfer;
    if (!transfer) return;
    transfer.effectAllowed = "copy";
    transfer.setData(pinTransferType, JSON.stringify([pin]));
    transfer.setData("text/plain", pin.url);
  }

  function refresh(): void {
    const boardId = pinterestState.boardId;
    if (boardId) void pinterestState.selectBoard(boardId);
    else void pinterestState.loadBoards();
  }
</script>

<section class="flex h-full min-h-0 flex-col">
  <header class="flex items-center gap-1.5 px-2 py-1">
    <span class="truncate text-2xs tracking-caps uppercase text-dim">Pinterest</span>
    {#if pinterestState.connected}
      <button
        type="button"
        class="ml-auto text-faint hover:text-default"
        aria-label="Refresh the pins"
        onclick={refresh}
      >
        <ArrowsClockwiseIcon size={12} />
      </button>
    {/if}
  </header>

  {#if pinterestState.connected}
    <div class="px-2 pb-1">
      <Select
        value={pinterestState.boardId ?? ""}
        placeholder="Choose a board"
        options={boardOptions}
        onChange={chooseBoard}
      />
    </div>
  {/if}

  {#if pinterestState.error}
    <p class="px-2 py-1 text-2xs text-red">{pinterestState.error}</p>
  {/if}

  {#if !pinterestState.connected}
    <div class="space-y-2 px-2 py-2">
      <p class="text-xs text-dim">
        Connect a Pinterest account to browse the pins saved to its boards.
      </p>
      {#if pinterestState.openSettings}
        <Button size="sm" onclick={() => pinterestState.openSettings?.()}>Open settings</Button>
      {/if}
    </div>
  {:else if pinterestState.loading && pinterestState.pins.length === 0}
    <div class="flex flex-1 items-center justify-center">
      <LoadingSpinner size={20} class="text-faint" />
    </div>
  {:else}
    <div class="min-h-0 flex-1 overflow-y-auto px-2 pb-2">
      <!-- Columns rather than a grid: pins are every aspect ratio there is, and a
					 row-aligned grid would crop or letterbox most of them. -->
      <div class="columns-2 gap-2 [column-fill:_balance]">
        {#each pinterestState.pins as pin (pin.id)}
          <img
            src={pin.imageUrl}
            alt={pin.title}
            title={pin.title}
            draggable="true"
            loading="lazy"
            referrerpolicy="no-referrer"
            ondragstart={(event) => startDrag(event, pin)}
            class="mb-2 w-full cursor-grab rounded-md border border-line bg-raised"
          />
        {/each}
      </div>

      {#if pinterestState.pins.length === 0 && !pinterestState.loading}
        <p class="px-0 py-1 text-2xs text-faint">No pins on this board.</p>
      {/if}
    </div>
  {/if}
</section>
