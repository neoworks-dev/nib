<script lang="ts">
  /**
   * The panes of one dock, drawer or sheet, drawn flat from its tree. Every leaf is one keyed
   * element placed by the box the tree gives it, so a leaf that gains a sibling
   * or is dragged into another split moves instead of being torn down under a
   * new parent — the note or terminal in it is kept. Splitters are lines laid
   * over the boundaries, each leaf giving up half of one along the sides it has.
   */
  import type { SessionView } from "@nib-ui/protocol";
  import type { PaneNode } from "@nib-ui/ui-contracts";
  import { kernelContext } from "@nib-ui/ui-contracts/svelte";
  import {
    layoutTree,
    type LeafPlacement,
    minimumFraction,
    nodeAt,
    resizeSiblings,
    type SplitterPlacement,
  } from "../layout/tree";
  import { type PaneFrame, reactivePanes } from "../registries/panes.svelte";
  import PaneLeaf from "./PaneLeaf.svelte";

  const {
    frame,
    root,
    session,
  }: { frame: PaneFrame; root: PaneNode; session: SessionView | null } = $props();

  const panes = reactivePanes(kernelContext().require("panes"));

  const layout = $derived(layoutTree(root));

  let width = $state(0);
  let height = $state(0);

  /** The splitter is 4px, centred on the boundary: 2px of it lies over each neighbour. */
  const HALF_SPLITTER = 2;

  /** Where a leaf's element goes, less its half of each splitter beside it. */
  function leafBox(leaf: LeafPlacement): Record<"left" | "top" | "width" | "height", string> {
    const { box, gutters } = leaf;
    const left = gutters.left ? HALF_SPLITTER : 0;
    const right = gutters.right ? HALF_SPLITTER : 0;
    const top = gutters.top ? HALF_SPLITTER : 0;
    const bottom = gutters.bottom ? HALF_SPLITTER : 0;
    return {
      left: `calc(${box.x * 100}% + ${left}px)`,
      top: `calc(${box.y * 100}% + ${top}px)`,
      width: `calc(${box.width * 100}% - ${left + right}px)`,
      height: `calc(${box.height * 100}% - ${top + bottom}px)`,
    };
  }

  let drag = $state<{ key: string; pointer: number } | null>(null);

  function start(event: PointerEvent, splitter: SplitterPlacement): void {
    if (event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    drag = { key: splitter.key, pointer: splitter.axis === "row" ? event.clientX : event.clientY };
    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
  }

  function track(event: PointerEvent): void {
    if (!drag) return;
    const splitter = layout.splitters.find((entry) => entry.key === drag?.key);
    const split = splitter && nodeAt(root, splitter.path);
    if (!splitter || !split || split.kind !== "split") return;

    const row = splitter.axis === "row";
    /** Pixels along the split's own axis, which is what a drag fraction is taken against. */
    const extent = splitter.extent * (row ? width : height);
    if (extent <= 0) return;

    const pointer = row ? event.clientX : event.clientY;
    const minimum = minimumFraction(split.axis, extent, split.children.length);
    panes.setSplitSizes(
      frame,
      splitter.path,
      resizeSiblings(split.sizes, splitter.index, (pointer - drag.pointer) / extent, minimum),
    );
    drag = { key: splitter.key, pointer };
  }
</script>

<div
  bind:clientWidth={width}
  bind:clientHeight={height}
  class="relative min-h-0 min-w-0 flex-1 overflow-hidden"
>
  {#each layout.leaves as leaf (leaf.instanceId)}
    {@const box = leafBox(leaf)}
    <div
      class="absolute flex"
      style:left={box.left}
      style:top={box.top}
      style:width={box.width}
      style:height={box.height}
    >
      <PaneLeaf instanceId={leaf.instanceId} {session} />
    </div>
  {/each}

  {#each layout.splitters as splitter (splitter.key)}
    <div
      role="separator"
      aria-orientation={splitter.axis === "row" ? "vertical" : "horizontal"}
      class="absolute z-raised bg-line hover:bg-line-strong"
      class:w-1={splitter.axis === "row"}
      class:cursor-col-resize={splitter.axis === "row"}
      class:h-1={splitter.axis === "column"}
      class:cursor-row-resize={splitter.axis === "column"}
      style:left={splitter.axis === "row"
        ? `calc(${splitter.box.x * 100}% - ${HALF_SPLITTER}px)`
        : `${splitter.box.x * 100}%`}
      style:top={splitter.axis === "row"
        ? `${splitter.box.y * 100}%`
        : `calc(${splitter.box.y * 100}% - ${HALF_SPLITTER}px)`}
      style:width={splitter.axis === "row" ? null : `${splitter.box.width * 100}%`}
      style:height={splitter.axis === "row" ? `${splitter.box.height * 100}%` : null}
      onpointerdown={(event) => start(event, splitter)}
      onpointermove={track}
      onpointerup={() => (drag = null)}
      onpointercancel={() => (drag = null)}
    ></div>
  {/each}
</div>
