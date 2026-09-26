<script lang="ts">
  /**
   * The sheets raised over the window, oldest first. Each rises from the bottom
   * and stops short of the top, so a strip of what is behind stays in view; a
   * sheet raised over another sets that one back the way the window behind all
   * of them is set back. A click on the scrim or Escape dismisses the front one.
   */
  import type { SessionView } from "@nib-ui/protocol";
  import type { PaneSheet } from "@nib-ui/ui-contracts";
  import { kernelContext } from "@nib-ui/ui-contracts/svelte";
  import { cubicOut } from "svelte/easing";
  import { fade, type TransitionConfig } from "svelte/transition";
  import { reactivePanes } from "../registries/panes.svelte";
  import PaneTreeView from "./PaneTreeView.svelte";

  const { sheets, session }: { sheets: PaneSheet[]; session: SessionView | null } = $props();

  const panes = reactivePanes(kernelContext().require("panes"));

  /** How far each sheet behind the front one is set back. */
  const RECEDE_SCALE = 0.04;
  const RECEDE_LIFT = 14;
  const RECEDE_TRANSITION =
    "transform var(--dur-slow) var(--ease-out), filter var(--dur-slow) var(--ease-out)";

  /** Scale and lift for a sheet this many places behind the front one. */
  function recede(depth: number): string {
    if (depth === 0) return "none";
    return `translateY(${-depth * RECEDE_LIFT}px) scale(${1 - depth * RECEDE_SCALE})`;
  }

  /** Rises from below the window; `global` because it arrives with its first pane. */
  function rise(_node: Element): TransitionConfig {
    return {
      duration: 280,
      easing: cubicOut,
      css: (progress: number) => `transform: translateY(${(1 - progress) * 100}%)`,
    };
  }

  function dismissFront(): void {
    const front = sheets.at(-1);
    if (front) panes.closeSheet(front.sheetId);
  }

  /** Escape the pane inside did not claim itself, such as closing a menu. */
  function dismissOnEscape(event: KeyboardEvent): void {
    if (event.key !== "Escape" || event.defaultPrevented) return;
    event.preventDefault();
    dismissFront();
  }
</script>

<svelte:window onkeydown={dismissOnEscape} />

<!-- The scrim is a pointer target only: Escape is the keyboard's way out. -->
<!-- svelte-ignore a11y_no_static_element_interactions, a11y_click_events_have_key_events -->
<div
  data-sheet-scrim
  class="absolute inset-0 z-modal bg-black/40"
  onclick={dismissFront}
  transition:fade={{ duration: 200 }}
></div>

{#each sheets as sheet, index (sheet.sheetId)}
  {@const depth = sheets.length - 1 - index}
  <section
    aria-label="Sheet"
    class="absolute inset-x-0 top-10 bottom-0 z-modal flex origin-top overflow-hidden rounded-t-xl border border-b-0 border-line bg-elevated shadow-lg"
    class:brightness-75={depth > 0}
    style:transform={recede(depth)}
    style:transition={RECEDE_TRANSITION}
    transition:rise|global
  >
    <PaneTreeView frame={{ layer: "sheet", sheetId: sheet.sheetId }} root={sheet.root} {session} />
  </section>
{/each}
