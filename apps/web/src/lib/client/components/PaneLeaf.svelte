<script lang="ts">
  import type { SessionView } from "@nib-ui/protocol";
  import type { PaneEdge } from "@nib-ui/ui-contracts";
  import { kernelContext } from "@nib-ui/ui-contracts/svelte";
  import XIcon from "phosphor-svelte/lib/XIcon";
  import { cubicOut } from "svelte/easing";
  import { scale } from "svelte/transition";
  import { nearestEdge } from "../layout/docks";
  import { clearPaneDrag, paneDrag } from "../layout/pane-drag.svelte";
  import { dropEdge } from "../layout/tree";
  import { reactivePanes } from "../registries/panes.svelte";

  const { instanceId, session }: { instanceId: string; session: SessionView | null } = $props();

  const panes = reactivePanes(kernelContext().require("panes"));

  const instance = $derived(panes.instance(instanceId));
  const definition = $derived(instance ? panes.definition(instance.paneId) : undefined);
  const focused = $derived(panes.focusedInstanceId === instanceId);
  const quiet = $derived(definition?.chrome === "quiet");
  const docked = $derived(panes.frameOf(instanceId)?.layer === "dock");
  const title = $derived.by(() => {
    if (!definition) return instance?.paneId ?? instanceId;
    if (definition.label) return definition.label(instance?.params);
    return definition.title;
  });
  /** Exactly one edge, or none: where a pane dropped on this one would go. */
  const hint = $derived<PaneEdge | null>(
    paneDrag.hint?.instanceId === instanceId ? paneDrag.hint.edge : null,
  );

  const hintClass: Record<PaneEdge, string> = {
    left: "inset-y-0 left-0 w-1/3",
    right: "inset-y-0 right-0 w-1/3",
    top: "inset-x-0 top-0 h-1/3",
    bottom: "inset-x-0 bottom-0 h-1/3",
  };

  /**
   * A pane settles in rather than appearing. Scale, not size: the box the pane is
   * laid out in never changes, so whatever is inside it — a canvas, an editor —
   * measures itself once against its final width instead of on every frame.
   *
   * `|global` on the element, because the pane arriving is usually the dock around
   * it arriving, and a local transition sits out its own parent's creation.
   */
  const settling = { duration: 160, start: 0.985, opacity: 0, easing: cubicOut };

  /** Below this the gesture is a click on the title bar, not a drag of the pane. */
  const dragThreshold = 6;

  let element = $state<HTMLElement>();
  let drag = $state<{ startX: number; startY: number; moved: boolean } | null>(null);

  /**
   * The pane under the pointer, read off the document rather than off geometry
   * the registry would have to keep: a dock is laid out by the browser, and the
   * boxes it gives are the ones the user is looking at.
   */
  function leafUnder(event: PointerEvent): HTMLElement | null {
    const under = document.elementFromPoint(event.clientX, event.clientY);
    return under?.closest<HTMLElement>("[data-pane-leaf]") ?? null;
  }

  /** Which edge of the area the pointer is nearest, in the host's own coordinates. */
  function edgeAt(event: PointerEvent): PaneEdge | null {
    const host = element?.closest("[data-pane-host]")?.getBoundingClientRect();
    if (!host) return null;
    return nearestEdge(event.clientX - host.left, event.clientY - host.top, panes.bounds);
  }

  function start(event: PointerEvent) {
    if (event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    panes.focusInstance(instanceId);
    drag = { startX: event.clientX, startY: event.clientY, moved: false };
    paneDrag.instanceId = instanceId;
    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
  }

  function track(event: PointerEvent) {
    if (!drag) return;
    const moved =
      drag.moved ||
      Math.hypot(event.clientX - drag.startX, event.clientY - drag.startY) >= dragThreshold;
    drag = { ...drag, moved };
    if (!moved) return;

    const under = leafUnder(event);
    const target = under?.dataset.paneLeaf;
    const targetFrame = target ? panes.frameOf(target) : undefined;
    const accepted = targetFrame !== undefined && panes.canDragInto(instanceId, targetFrame);
    if (under && target && target !== instanceId && accepted) {
      const box = under.getBoundingClientRect();
      paneDrag.hint = {
        instanceId: target,
        edge: dropEdge(
          { x: box.left, y: box.top, width: box.width, height: box.height },
          event.clientX,
          event.clientY,
        ),
      };
      paneDrag.edgeHint = null;
      return;
    }

    // Over the board, or over nothing: the pane docks against the edge it is
    // nearest, because there is nowhere in this shell for it to float. Over its
    // own pane it is not a drop at all, and nothing is armed. Only a docked pane
    // docks: the drawer and the sheets are layers, not edges.
    paneDrag.hint = null;
    paneDrag.edgeHint = target || !docked ? null : edgeAt(event);
  }

  function finish() {
    const gesture = drag;
    const target = paneDrag.hint;
    const edge = paneDrag.edgeHint;
    drag = null;
    clearPaneDrag();
    if (!gesture?.moved) return;
    if (target) panes.attach(instanceId, target.instanceId, target.edge);
    else if (edge) panes.attachToEdge(instanceId, edge);
  }
</script>

<div
  bind:this={element}
  data-pane-leaf={instanceId}
  class="group relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden"
  transition:scale|global={settling}
>
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <header
    class="flex h-8 shrink-0 cursor-grab items-center gap-1.5 px-2.5 select-none"
    class:border-b={!quiet}
    class:border-line={!quiet}
    class:bg-raised={!quiet && focused}
    class:absolute={quiet}
    class:inset-x-0={quiet}
    class:top-0={quiet}
    class:z-raised={quiet}
    class:opacity-0={quiet}
    class:transition-opacity={quiet}
    class:group-hover:opacity-100={quiet}
    class:focus-within:opacity-100={quiet}
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
      {title}
    </span>
    <button
      type="button"
      class="rounded-md p-1 text-faint hover:bg-hover hover:text-default"
      aria-label="Close the {title} pane"
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

  {#if hint}
    <div
      class="pointer-events-none absolute z-raised border-2 border-action bg-action/20 {hintClass[
        hint
      ]}"
    ></div>
  {/if}
</div>
