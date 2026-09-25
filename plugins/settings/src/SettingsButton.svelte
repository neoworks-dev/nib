<script lang="ts">
  import type { SlotProps } from "@nib-ui/ui-contracts";
  import { kernelContext } from "@nib-ui/ui-contracts/svelte";
  import GearSixIcon from "phosphor-svelte/lib/GearSixIcon";

  // Settings belong to the app, not to whatever conversation is in the foreground.
  // oxlint-disable-next-line no-empty-pattern
  const {}: SlotProps = $props();

  const panes = kernelContext().require("panes");
  const open = $derived(panes.isOpen("settings"));
  const tone = $derived(
    open ? "bg-white/10 text-white" : "text-neutral-300 hover:bg-white/10 hover:text-white",
  );
</script>

<button
  type="button"
  title="Settings"
  aria-label="{open ? 'Close' : 'Open'} settings"
  aria-pressed={open}
  class="flex size-9 items-center justify-center rounded-lg transition-colors {tone}"
  onclick={() => panes.toggle("settings")}
>
  <GearSixIcon size={17} />
</button>
