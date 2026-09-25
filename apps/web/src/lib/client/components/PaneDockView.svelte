<script lang="ts">
  /**
   * One dock: the panes attached to one edge of the main area, and the splitter
   * that decides how much of the area they take. The splitter is always on the
   * board's side of the dock, so dragging it towards the edge gives the board
   * back what the dock was using.
   */
  import type { SessionView } from "@nib-ui/protocol";
  import type { PaneDock } from "@nib-ui/ui-contracts";
  import { kernelContext } from "@nib-ui/ui-contracts/svelte";
  import { cubicOut } from "svelte/easing";
  import { slide } from "svelte/transition";
  import { dockAxis, dockExtent, dockPixels } from "../layout/docks";
  import type { ReactivePaneRegistry } from "../registries/panes.svelte";
  import PaneTreeView from "./PaneTreeView.svelte";

  const { dock, session }: { dock: PaneDock; session: SessionView | null } = $props();

  const panes = kernelContext().require("panes") as ReactivePaneRegistry;

  const axis = $derived(dockAxis(dock.edge));
  const pixels = $derived(dockPixels(dock.edge, dock.size, panes.bounds));
  /** The board is inside the dock's edge, so those docks carry the splitter first. */
  const splitterFirst = $derived(dock.edge === "right" || dock.edge === "bottom");
  const label = $derived(`Panes docked ${dock.edge}`);
  /** A side dock is a row of panes with a vertical splitter; a top or bottom one is not. */
  const sideways = $derived(axis === "row");

  /**
   * The dock pushes the board aside rather than appearing over it, so the first
   * pane on an edge opens by growing from that edge: double-clicking a document
   * reads as the board making room for it, not as a panel popping into place.
   */
  const opening = $derived({
    axis: sideways ? ("x" as const) : ("y" as const),
    duration: 180,
    easing: cubicOut,
  });

  /** Deltas are taken against the last pointer position, so the drag survives clamping. */
  let pointer = $state<number | null>(null);

  function start(event: PointerEvent): void {
    if (event.button !== 0) return;
    event.preventDefault();
    pointer = axis === "row" ? event.clientX : event.clientY;
    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
  }

  function track(event: PointerEvent): void {
    if (pointer === null) return;
    const position = axis === "row" ? event.clientX : event.clientY;
    // A dock on the far side grows as the pointer moves towards the origin.
    const delta = (position - pointer) * (splitterFirst ? -1 : 1);
    const extent = dockExtent(dock.edge, panes.bounds);
    if (extent > 0) panes.setDockSize(dock.edge, (pixels + delta) / extent);
    pointer = position;
  }
</script>

{#snippet splitter()}
  <div
    role="separator"
    aria-orientation={sideways ? "vertical" : "horizontal"}
    aria-label="Resize the {dock.edge} dock"
    class="shrink-0 bg-line hover:bg-line-strong"
    class:w-1={sideways}
    class:cursor-col-resize={sideways}
    class:h-1={!sideways}
    class:cursor-row-resize={!sideways}
    onpointerdown={start}
    onpointermove={track}
    onpointerup={() => (pointer = null)}
    onpointercancel={() => (pointer = null)}
  ></div>
{/snippet}

<section
  aria-label={label}
  class="flex shrink-0"
  class:flex-row={sideways}
  class:flex-col={!sideways}
  style:width={sideways ? `${pixels}px` : null}
  style:height={sideways ? null : `${pixels}px`}
  transition:slide={opening}
>
  {#if splitterFirst}{@render splitter()}{/if}

  <div class="flex min-h-0 min-w-0 flex-1 overflow-hidden">
    <PaneTreeView {dock} {session} />
  </div>

  {#if !splitterFirst}{@render splitter()}{/if}
</section>
