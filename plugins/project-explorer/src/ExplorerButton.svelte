<script lang="ts">
  import type { SlotProps } from "@nib-ui/ui-contracts";
  import { kernelContext } from "@nib-ui/ui-contracts/svelte";
  import FolderOpenIcon from "phosphor-svelte/lib/FolderOpenIcon";
  import { projectExplorerPaneId } from "./pane";

  // The tree belongs to the project on screen, not to any one conversation.
  // oxlint-disable-next-line no-empty-pattern
  const {}: SlotProps = $props();

  const panes = kernelContext().require("panes");
  const open = $derived(panes.isOpen(projectExplorerPaneId));
  const tone = $derived(
    open ? "bg-white/10 text-white" : "text-neutral-300 hover:bg-white/10 hover:text-white",
  );
</script>

<button
  type="button"
  title="Project files"
  aria-label="{open ? 'Close' : 'Open'} the project explorer"
  aria-pressed={open}
  class="flex size-9 items-center justify-center rounded-lg transition-colors {tone}"
  onclick={() => panes.toggle(projectExplorerPaneId)}
>
  <FolderOpenIcon size={17} />
</button>
