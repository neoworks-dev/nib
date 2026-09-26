<script lang="ts">
  /**
   * The drawer: panes laid over the right side of the board rather than docked
   * beside it, so the board keeps its full width and the cards under the drawer
   * are only covered, never moved. It slides in from the edge and is widened by
   * the handle on its board side.
   */
  import type { SessionView } from "@nib-ui/protocol";
  import type { PaneDrawer } from "@nib-ui/ui-contracts";
  import { kernelContext } from "@nib-ui/ui-contracts/svelte";
  import { cubicOut } from "svelte/easing";
  import type { TransitionConfig } from "svelte/transition";
  import { DRAWER_MARGIN, dockExtent, dockPixels } from "../layout/docks";
  import { reactivePanes } from "../registries/panes.svelte";
  import PaneTreeView from "./PaneTreeView.svelte";

  const { drawer, session }: { drawer: PaneDrawer; session: SessionView | null } = $props();

  const panes = reactivePanes(kernelContext().require("panes"));

  const pixels = $derived(dockPixels("right", drawer.size, panes.bounds));

  /** Enters from beyond the right edge; `global` because it arrives with its first pane. */
  function slideIn(_node: Element): TransitionConfig {
    return {
      duration: 240,
      easing: cubicOut,
      css: (progress: number) =>
        `transform: translateX(calc(${(1 - progress) * 100}% + ${(1 - progress) * DRAWER_MARGIN}px))`,
    };
  }

  /** Deltas are taken against the last pointer position, so the drag survives clamping. */
  let pointer = $state<number | null>(null);

  function start(event: PointerEvent): void {
    if (event.button !== 0) return;
    event.preventDefault();
    pointer = event.clientX;
    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
  }

  function track(event: PointerEvent): void {
    if (pointer === null) return;
    // The drawer grows leftwards, towards the pointer.
    const delta = pointer - event.clientX;
    const extent = dockExtent("right", panes.bounds);
    if (extent > 0) panes.setDrawerSize((pixels + delta) / extent);
    pointer = event.clientX;
  }
</script>

<section
  aria-label="Drawer"
  class="absolute z-overlay flex overflow-hidden rounded-xl border border-line bg-elevated shadow-xl"
  style:top="{DRAWER_MARGIN}px"
  style:right="{DRAWER_MARGIN}px"
  style:bottom="{DRAWER_MARGIN}px"
  style:width="{pixels}px"
  transition:slideIn|global
>
  <div
    role="separator"
    aria-orientation="vertical"
    aria-label="Resize the drawer"
    class="absolute inset-y-0 -left-1 z-raised w-2 cursor-col-resize"
    onpointerdown={start}
    onpointermove={track}
    onpointerup={() => (pointer = null)}
    onpointercancel={() => (pointer = null)}
  ></div>

  <div class="flex min-h-0 min-w-0 flex-1 overflow-hidden">
    <PaneTreeView frame={{ layer: "drawer" }} root={drawer.root} {session} />
  </div>
</section>
