<script lang="ts">
  import { kernelContext } from "@nib-ui/ui-contracts/svelte";

  const commands = kernelContext().require("commands");
  let query = $state("");

  const matches = $derived(
    commands
      .list()
      .filter(
        (command) =>
          command.when?.() !== false && command.title.toLowerCase().includes(query.toLowerCase()),
      ),
  );

  async function run(id: string) {
    commands.togglePalette(false);
    query = "";
    await commands.run(id);
  }
</script>

{#if commands.paletteOpen}
  <div
    class="fixed inset-0 z-100 flex items-start justify-center bg-black/50 pt-32"
    role="presentation"
    onclick={() => commands.togglePalette(false)}
  >
    <div
      class="w-[32rem] overflow-hidden rounded-lg border border-line bg-elevated shadow-lg"
      role="presentation"
      onclick={(event) => event.stopPropagation()}
    >
      <!-- svelte-ignore a11y_autofocus -->
      <input
        bind:value={query}
        autofocus
        placeholder="Run a command"
        class="w-full border-b border-line bg-input px-4 py-3 text-base text-default placeholder:text-faint"
        onkeydown={(event) => {
          if (event.key === "Escape") commands.togglePalette(false);
          if (event.key === "Enter" && matches[0]) void run(matches[0].id);
        }}
      />
      <ul class="max-h-72 overflow-y-auto py-1">
        {#each matches as command (command.id)}
          <li>
            <button
              type="button"
              class="flex w-full items-center gap-3 px-4 py-2 text-left text-sm text-default hover:bg-hover"
              onclick={() => run(command.id)}
            >
              <span class="flex-1">{command.title}</span>
              {#if command.keybinding}
                <kbd class="rounded-sm bg-raised px-1.5 py-0.5 text-2xs text-dim"
                  >{command.keybinding}</kbd
                >
              {/if}
            </button>
          </li>
        {/each}
        {#if matches.length === 0}
          <li class="px-4 py-3 text-sm text-dim">No commands match.</li>
        {/if}
      </ul>
    </div>
  </div>
{/if}
