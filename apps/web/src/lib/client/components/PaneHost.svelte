<script lang="ts">
  import type { SessionView } from "@nib-ui/protocol";
  import type { PaneEdge } from "@nib-ui/ui-contracts";
  import { kernelContext } from "@nib-ui/ui-contracts/svelte";
  import { paneDrag } from "../layout/pane-drag.svelte";
  import { type ReactivePaneRegistry, rootPaneId } from "../registries/panes.svelte";
  import PaneDockView from "./PaneDockView.svelte";

  const { session }: { session: SessionView | null } = $props();

  const panes = kernelContext().require("panes") as ReactivePaneRegistry;

  const root = $derived(panes.definition(rootPaneId));
  const top = $derived(panes.dock("top"));
  const left = $derived(panes.dock("left"));
  const right = $derived(panes.dock("right"));
  const bottom = $derived(panes.dock("bottom"));
  /** The edge a pane let go of here would dock against, drawn as a band on it. */
  const edgeHint = $derived(paneDrag.edgeHint);

  const hintClass: Record<PaneEdge, string> = {
    left: "inset-y-0 left-0 w-1/4",
    right: "inset-y-0 right-0 w-1/4",
    top: "inset-x-0 top-0 h-1/4",
    bottom: "inset-x-0 bottom-0 h-1/4",
  };

  let width = $state(0);
  let height = $state(0);

  $effect(() => {
    if (width > 0 && height > 0) panes.setBounds({ width, height });
  });
</script>

<!--
  Docks take the edges and the board keeps the rest of the area. It is never
  covered: a pane cannot float over it, and a dock cannot grow past the board's
  own minimum, so the board is on screen whatever is open.
-->
<div
  bind:clientWidth={width}
  bind:clientHeight={height}
  data-pane-host
  class="relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-elevated"
>
  {#if top}
    <PaneDockView dock={top} {session} />
  {/if}

  <div class="flex min-h-0 min-w-0 flex-1">
    {#if left}
      <PaneDockView dock={left} {session} />
    {/if}

    <div class="relative min-h-0 min-w-0 flex-1 overflow-hidden">
      {#if root}
        {@const Root = root.component}
        <Root {session} instanceId={rootPaneId} />
      {:else}
        <p class="px-3 py-2 text-xs text-dim">No plugin provides the “{rootPaneId}” view.</p>
      {/if}
    </div>

    {#if right}
      <PaneDockView dock={right} {session} />
    {/if}
  </div>

  {#if bottom}
    <PaneDockView dock={bottom} {session} />
  {/if}

  {#if edgeHint}
    <div
      class="pointer-events-none absolute z-overlay rounded-xl border-2 border-action bg-action/15 {hintClass[
        edgeHint
      ]}"
    ></div>
  {/if}
</div>
