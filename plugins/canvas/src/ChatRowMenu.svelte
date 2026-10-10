<script lang="ts">
  /**
   * What can be done to one chat in the list: pin it, rename it, branch it into a
   * new chat, delete it. Fixed to the button that opened it so the list's own
   * scrolling does not clip it. Delete asks a second time, since it takes the
   * transcript with it.
   */
  import GitBranchIcon from "phosphor-svelte/lib/GitBranchIcon";
  import PencilSimpleIcon from "phosphor-svelte/lib/PencilSimpleIcon";
  import PushPinIcon from "phosphor-svelte/lib/PushPinIcon";
  import PushPinSlashIcon from "phosphor-svelte/lib/PushPinSlashIcon";
  import TrashIcon from "phosphor-svelte/lib/TrashIcon";

  const {
    anchor,
    pinned,
    branchable,
    onPin,
    onRename,
    onBranch,
    onDelete,
    onClose,
  }: {
    /** The button the menu hangs from. */
    anchor: DOMRect;
    pinned: boolean;
    branchable: boolean;
    onPin: () => void;
    onRename: () => void;
    onBranch: () => void;
    onDelete: () => void;
    onClose: () => void;
  } = $props();

  const MENU_WIDTH = 176;
  let confirmingDelete = $state(false);
  let menu = $state<HTMLElement>();

  /** Any press outside the menu, or Escape, dismisses it. */
  function dismissOnOutsidePress(event: PointerEvent): void {
    if (menu && event.target instanceof Node && menu.contains(event.target)) return;
    onClose();
  }

  function dismissOnEscape(event: KeyboardEvent): void {
    if (event.key === "Escape") onClose();
  }

  /** Runs an action and closes the menu. */
  function choose(action: () => void): void {
    action();
    onClose();
  }

  function askOrDelete(): void {
    if (!confirmingDelete) {
      confirmingDelete = true;
      return;
    }
    choose(onDelete);
  }
</script>

<svelte:window onpointerdown={dismissOnOutsidePress} onkeydown={dismissOnEscape} />

<div
  bind:this={menu}
  role="menu"
  class="fixed z-overlay flex flex-col gap-0.5 rounded-xl border border-line bg-elevated p-1 shadow-lg"
  style:width="{MENU_WIDTH}px"
  style:left="{Math.max(8, anchor.right - MENU_WIDTH)}px"
  style:top="{anchor.bottom + 4}px"
>
  <button
    type="button"
    role="menuitem"
    class="flex items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-sm text-default hover:bg-hover"
    onclick={() => choose(onPin)}
  >
    {#if pinned}
      <PushPinSlashIcon size={16} /> Unpin
    {:else}
      <PushPinIcon size={16} /> Pin
    {/if}
  </button>
  <button
    type="button"
    role="menuitem"
    class="flex items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-sm text-default hover:bg-hover"
    onclick={() => choose(onRename)}
  >
    <PencilSimpleIcon size={16} /> Rename
  </button>
  {#if branchable}
    <button
      type="button"
      role="menuitem"
      class="flex items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-sm text-default hover:bg-hover"
      onclick={() => choose(onBranch)}
    >
      <GitBranchIcon size={16} /> Branch in new chat
    </button>
  {/if}
  <button
    type="button"
    role="menuitem"
    class="flex items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-sm text-red hover:bg-hover"
    onclick={askOrDelete}
  >
    <TrashIcon size={16} />
    {confirmingDelete ? "Click again to delete" : "Delete"}
  </button>
</div>
