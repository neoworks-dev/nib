<script lang="ts">
  import type { SessionView } from "@nib-ui/protocol";
  import type { PaneFrame } from "@nib-ui/ui-contracts";
  import { kernelContext } from "@nib-ui/ui-contracts/svelte";
  import XIcon from "phosphor-svelte/lib/XIcon";
  import { dropEdge, frameChrome, pointInRect } from "../layout/frames";
  import { clearPaneDrag, paneDrag } from "../layout/pane-drag.svelte";
  import { moveRect, snapAt, snapRect } from "../layout/windows";
  import type { ReactivePaneRegistry } from "../registries/panes.svelte";

  const {
    frame,
    instanceId,
    session,
  }: { frame: PaneFrame; instanceId: string; session: SessionView | null } = $props();

  const panes = kernelContext().require("panes") as ReactivePaneRegistry;

  const instance = $derived(panes.instance(instanceId));
  const definition = $derived(instance ? panes.definition(instance.paneId) : undefined);
  const focused = $derived(panes.focusedInstanceId === instanceId);
  /**
   * The only leaf in its frame: dragging its title bar moves the frame itself,
   * because there is no other pane it could be taken away from.
   */
  const moves = $derived(frameChrome(frame.root).leafDrag === "move");

  /** Below this the gesture is a click on the title bar, not a drag of the pane. */
  const dragThreshold = 6;

  let header = $state<HTMLElement>();
  let drag = $state<{
    startX: number;
    startY: number;
    pointerX: number;
    pointerY: number;
    moved: boolean;
  } | null>(null);

  /** Frame rects are in the pane host's box, which is what the drop test needs. */
  function hostPoint(event: PointerEvent): { x: number; y: number } | null {
    const host = header?.closest("[data-pane-host]")?.getBoundingClientRect();
    return host ? { x: event.clientX - host.left, y: event.clientY - host.top } : null;
  }

  function hintAt(
    event: PointerEvent,
  ): { frameId: string; edge: "left" | "right" | "top" | "bottom" } | null {
    const point = hostPoint(event);
    if (!point) return null;
    // Topmost first, and never the frame being dragged whole — it follows the
    // pointer, so it would swallow every drop.
    for (let index = panes.frames.length - 1; index >= 0; index -= 1) {
      const candidate = panes.frames[index]!;
      if (moves && candidate.frameId === frame.frameId) continue;
      if (!pointInRect(candidate.rect, point.x, point.y)) continue;
      return { frameId: candidate.frameId, edge: dropEdge(candidate.rect, point.x, point.y) };
    }
    return null;
  }

  function start(event: PointerEvent) {
    if (event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    panes.focusInstance(instanceId);
    drag = {
      startX: event.clientX,
      startY: event.clientY,
      pointerX: event.clientX,
      pointerY: event.clientY,
      moved: false,
    };
    paneDrag.instanceId = instanceId;
    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
  }

  function track(event: PointerEvent) {
    if (!drag) return;
    const dx = event.clientX - drag.pointerX;
    const dy = event.clientY - drag.pointerY;
    const moved =
      drag.moved ||
      Math.hypot(event.clientX - drag.startX, event.clientY - drag.startY) >= dragThreshold;
    if (moves) panes.setFrameRect(frame.frameId, moveRect(frame.rect, dx, dy, panes.bounds));
    drag = { ...drag, pointerX: event.clientX, pointerY: event.clientY, moved };

    // Against the area's own edge the window takes that edge; the drop hint is
    // suppressed there, because a frame's third is wide enough to cover a margin
    // the pointer has plainly been driven into.
    const point = moved && moves ? hostPoint(event) : null;
    paneDrag.snap = point ? snapAt(point.x, point.y, panes.bounds) : null;
    paneDrag.hint = moved && !paneDrag.snap ? hintAt(event) : null;
  }

  function finish(event: PointerEvent) {
    const gesture = drag;
    const hint = paneDrag.hint;
    const snap = paneDrag.snap;
    drag = null;
    clearPaneDrag();
    if (!gesture?.moved) return;
    if (snap) {
      panes.setFrameRect(frame.frameId, snapRect(snap, panes.bounds));
      return;
    }
    if (hint) {
      panes.attachToFrame(instanceId, hint.frameId, hint.edge);
      return;
    }
    // Dropped on nothing: a shared frame gives the pane up, a whole frame has
    // already followed the pointer there.
    if (!moves) {
      const point = hostPoint(event);
      panes.detach(instanceId, point ?? undefined);
    }
  }
</script>

<div class="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <header
    bind:this={header}
    class="flex h-8 shrink-0 cursor-grab items-center gap-1.5 border-b border-line px-2.5 select-none {focused
      ? 'bg-raised'
      : ''}"
    onpointerdown={start}
    onpointermove={track}
    onpointerup={finish}
    onpointercancel={() => {
      drag = null;
      clearPaneDrag();
    }}
  >
    {#if definition?.icon}
      {@const Icon = definition.icon}
      <span class="text-faint"><Icon size={12} /></span>
    {/if}
    <span class="min-w-0 flex-1 truncate text-2xs tracking-caps text-faint uppercase">
      {definition?.title ?? instance?.paneId ?? instanceId}
    </span>
    <button
      type="button"
      class="rounded-md p-1 text-faint hover:bg-hover hover:text-default"
      aria-label="Close the {definition?.title ?? instance?.paneId ?? 'pane'} pane"
      onpointerdown={(event) => event.stopPropagation()}
      onclick={() => panes.closeInstance(instanceId)}
    >
      <XIcon size={12} />
    </button>
  </header>

  <!-- Working in a pane focuses it, the same as clicking its title bar: a plugin
	     asking the registry which instance has focus must not need one of its own. -->
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div
    class="min-h-0 min-w-0 flex-1 overflow-hidden"
    onpointerdowncapture={() => panes.focusInstance(instanceId)}
    onfocusin={() => panes.focusInstance(instanceId)}
  >
    {#if definition}
      {@const Pane = definition.component}
      <Pane {session} {instanceId} params={instance?.params} />
    {:else}
      <p class="px-3 py-2 text-xs text-dim">
        No plugin provides the pane “{instance?.paneId ?? instanceId}”.
      </p>
    {/if}
  </div>
</div>
