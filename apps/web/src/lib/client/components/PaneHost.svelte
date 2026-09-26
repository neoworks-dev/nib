<script lang="ts">
  import type { SessionView } from "@nib-ui/protocol";
  import type { PaneEdge } from "@nib-ui/ui-contracts";
  import { kernelContext } from "@nib-ui/ui-contracts/svelte";
  import { DRAWER_MARGIN, dockPixels } from "../layout/docks";
  import { paneDrag } from "../layout/pane-drag.svelte";
  import { RECEDE_TRANSITION, RECEDED_TRANSFORM } from "@nib-ui/ui-contracts";
  import { reactivePanes, rootPaneId } from "../registries/panes.svelte";
  import PaneDockView from "./PaneDockView.svelte";
  import PaneDrawerView from "./PaneDrawerView.svelte";
  import PaneSheetStack from "./PaneSheetStack.svelte";

  const { session }: { session: SessionView | null } = $props();

  const panes = reactivePanes(kernelContext().require("panes"));

  const root = $derived(panes.definition(rootPaneId));
  const top = $derived(panes.dock("top"));
  const left = $derived(panes.dock("left"));
  const right = $derived(panes.dock("right"));
  const bottom = $derived(panes.dock("bottom"));
  const drawer = $derived(panes.drawer);
  /** How much of the board's right side the drawer covers, with the gap it keeps. */
  const drawerPixels = $derived(
    drawer ? dockPixels("right", drawer.size, panes.bounds) + DRAWER_MARGIN : 0,
  );
  const sheets = $derived(panes.sheets);
  /** Behind a raised sheet the whole window is set back, so the sheet reads as a layer on it. */
  const receded = $derived(sheets.length > 0);
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
  Docks take the edges and the board keeps the rest of the area: a dock cannot
  grow past the board's own minimum, so the board is on screen whatever is open.
  The drawer lies over the board's right side instead of taking width from it,
  and a sheet rises over all of it, setting the rest back while it is up.
-->
<div
  bind:clientWidth={width}
  bind:clientHeight={height}
  data-pane-host
  class="relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-black"
>
  <div
    data-pane-stage
    class="flex min-h-0 min-w-0 flex-1 origin-top flex-col overflow-hidden bg-elevated"
    class:rounded-xl={receded}
    style:transform={receded ? RECEDED_TRANSFORM : "none"}
    style:transition={RECEDE_TRANSITION}
  >
    {#if top}
      <PaneDockView dock={top} {session} />
    {/if}

    <div class="flex min-h-0 min-w-0 flex-1">
      {#if left}
        <PaneDockView dock={left} {session} />
      {/if}

      <!-- `--board-inset-right` is how much of the board's right side the drawer covers,
           so the board's own floating controls can keep clear of it. -->
      <div
        data-pane-root
        class="relative min-h-0 min-w-0 flex-1 overflow-hidden"
        style:--board-inset-right="{drawerPixels}px"
      >
        {#if root}
          {@const Root = root.component}
          <Root {session} instanceId={rootPaneId} />
        {:else}
          <p class="px-3 py-2 text-xs text-dim">No plugin provides the “{rootPaneId}” view.</p>
        {/if}

        {#if drawer}
          <PaneDrawerView {drawer} {session} />
        {/if}
      </div>

      {#if right}
        <PaneDockView dock={right} {session} />
      {/if}
    </div>

    {#if bottom}
      <PaneDockView dock={bottom} {session} />
    {/if}
  </div>

  {#if edgeHint}
    <div
      class="pointer-events-none absolute z-overlay rounded-xl border-2 border-action bg-action/15 {hintClass[
        edgeHint
      ]}"
    ></div>
  {/if}

  {#if receded}
    <PaneSheetStack {sheets} {session} />
  {/if}
</div>
