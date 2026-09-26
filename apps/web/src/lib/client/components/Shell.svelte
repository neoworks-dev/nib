<script lang="ts">
  /**
   * The board is the window. Nothing is reserved around it: the one piece of
   * chrome is a floating dark pill in the top-left corner, holding only what has
   * nowhere better to be — the project switcher, the search popup and settings.
   * Every other pane opens from the thing it belongs to, or from the palette.
   */
  import { canvasState } from "@nib-ui/plugin-canvas";
  import { RECEDE_TRANSITION, RECEDED_TRANSFORM } from "@nib-ui/ui-contracts";
  import { provideKernelContext, SlotHost } from "@nib-ui/ui-contracts/svelte";
  import { clientContext } from "../context";
  import { reactivePanes } from "../registries/panes.svelte";
  import CommandPalette from "./CommandPalette.svelte";
  import PaneHost from "./PaneHost.svelte";

  // The shell owns the kernel; everything below it — app component or plugin
  // contribution — resolves services through the Svelte context it publishes here.
  const context = clientContext();
  provideKernelContext(context);

  const sessions = context.require("sessions");
  const session = $derived(sessions.active);

  const panes = reactivePanes(context.require("panes"));
  /**
   * The toolbar sits on the board, so it is set back with it behind a raised
   * sheet — a document's, or a folder's, which rises over the board it is on.
   */
  const receded = $derived(panes.sheets.length > 0 || canvasState.vault.topic !== null);
</script>

<div class="relative h-screen overflow-hidden bg-canvas text-default">
  <main class="absolute inset-0 flex flex-col">
    <PaneHost {session} />
  </main>

  <!--
    Floats over the board; the wrapper lets clicks through to it and only the bar
    itself is solid. One dark pill, the same one the selection toolbar is: chrome
    that sits on the table reads as an object on it, not as a panel behind it.
  -->
  <div
    class="pointer-events-none absolute inset-x-0 top-0 z-raised flex origin-top justify-start p-3"
    style:transform={receded ? RECEDED_TRANSFORM : "none"}
    style:transition={RECEDE_TRANSITION}
  >
    <div
      class="pointer-events-auto flex max-w-full items-center gap-1 rounded-xl bg-neutral-900 p-1 shadow-lg"
    >
      <SlotHost slot="app.toolbar" {session} class="flex items-center gap-0.5" />
    </div>
  </div>
</div>

<CommandPalette />
