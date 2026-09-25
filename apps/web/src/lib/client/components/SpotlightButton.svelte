<script lang="ts">
  import type { SlotProps } from "@nib-ui/ui-contracts";
  import { kernelContext } from "@nib-ui/ui-contracts/svelte";
  import MagnifyingGlassIcon from "phosphor-svelte/lib/MagnifyingGlassIcon";

  // The palette searches the project, not a conversation.
  // oxlint-disable-next-line no-empty-pattern
  const {}: SlotProps = $props();

  const commands = kernelContext().require("commands");
</script>

<button
  type="button"
  title="Search (⌘/Ctrl+K)"
  aria-label="Search this project"
  class="flex size-9 items-center justify-center rounded-lg text-neutral-300 transition-colors hover:bg-white/10 hover:text-white"
  onclick={() => commands.togglePalette(true)}
>
  <MagnifyingGlassIcon size={17} />
</button>
