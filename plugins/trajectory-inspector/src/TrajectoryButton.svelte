<script lang="ts">
  /**
   * The button in a chat's title row that opens the inspector beside it. The
   * chat it belongs to is the focused pane: pressing anything inside a pane
   * focuses it before the click lands, so no instance id has to travel through
   * the slot.
   */
  import type { SlotProps } from "@nib-ui/ui-contracts";
  import { kernelContext } from "@nib-ui/ui-contracts/svelte";
  import PulseIcon from "phosphor-svelte/lib/PulseIcon";
  import { toggleTrajectory } from "./open";

  const { session }: SlotProps = $props();

  const context = kernelContext();
  const panes = context.require("panes");
  const attachments = context.require("attachments");
  const sessions = context.require("sessions");

  const count = $derived(session ? sessions.events(session.sessionId).length : 0);
</script>

<button
  type="button"
  class="flex items-center gap-1 rounded-md px-1.5 py-0.5 text-2xs text-dim hover:bg-hover hover:text-default"
  title="Trajectory"
  aria-label="Toggle the trajectory inspector beside this chat"
  onclick={() => toggleTrajectory(panes, attachments)}
>
  <PulseIcon size={13} />
  <span class="tabular-nums">{count}</span>
</button>
