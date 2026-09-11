<script lang="ts">
  import { provideKernelContext, SlotHost } from "@nib-ui/ui-contracts/svelte";
  import ArrowLeftIcon from "phosphor-svelte/lib/ArrowLeftIcon";
  import ArrowRightIcon from "phosphor-svelte/lib/ArrowRightIcon";
  import { clientContext } from "../context";
  import CommandPalette from "./CommandPalette.svelte";
  import PaneHost from "./PaneHost.svelte";
  import PaneLauncher from "./PaneLauncher.svelte";
  import SessionHeader from "./SessionHeader.svelte";

  // The shell owns the kernel; everything below it — app component or plugin
  // contribution — resolves services through the Svelte context it publishes here.
  const context = clientContext();
  provideKernelContext(context);

  const sessions = context.require("sessions");
  const session = $derived(sessions.active);
</script>

<div class="flex h-screen flex-col bg-canvas text-default">
  <header class="flex h-11 shrink-0 items-center gap-2 px-3">
    <div class="flex shrink-0 items-center">
      <button
        type="button"
        class="rounded-md p-1 text-faint enabled:hover:bg-hover enabled:hover:text-default disabled:opacity-40"
        aria-label="Back to the previous task"
        disabled={!sessions.canGoBack}
        onclick={() => sessions.back()}
      >
        <ArrowLeftIcon size={15} />
      </button>
      <button
        type="button"
        class="rounded-md p-1 text-faint enabled:hover:bg-hover enabled:hover:text-default disabled:opacity-40"
        aria-label="Forward to the next task"
        disabled={!sessions.canGoForward}
        onclick={() => sessions.forward()}
      >
        <ArrowRightIcon size={15} />
      </button>
    </div>

    {#if session}
      <div class="min-w-0 flex-1"><SessionHeader {session} /></div>
    {:else}
      <span class="truncate text-sm text-dim">No task open</span>
    {/if}
  </header>

  <div class="flex min-h-0 flex-1 gap-2 p-2">
    <!-- The rail is space the shell reserves; what fills it is contributed. -->
    <SlotHost slot="app.sidebar" session={null} class="flex min-h-0 shrink-0" />

    <main class="flex min-h-0 min-w-0 flex-1 flex-col">
      <PaneHost {session} />
    </main>
  </div>

  <footer class="flex shrink-0 items-center gap-3 px-2 pb-1.5">
    <SlotHost slot="statusbar" {session} class="flex items-center gap-4 px-1 text-xs text-dim" />

    <div class="ml-auto"><PaneLauncher /></div>
  </footer>
</div>

<CommandPalette />
