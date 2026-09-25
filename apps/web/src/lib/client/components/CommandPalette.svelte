<script lang="ts">
  /**
   * One popup over the board, the way Spotlight is one field: what is typed goes
   * to every search provider and to the command list at once, and the rows come
   * back grouped. There is no search pane — the vault is searched from here.
   */
  import type { SearchResult } from "@nib-ui/ui-contracts";
  import { kernelContext } from "@nib-ui/ui-contracts/svelte";

  const commands = kernelContext().require("commands");
  let query = $state("");
  let selected = $state(0);

  const groups = $derived.by(() => {
    const needle = query.trim().toLowerCase();
    const matched = commands
      .list()
      .filter((command) => command.when?.() !== false)
      .filter((command) => command.title.toLowerCase().includes(needle))
      .map((command): SearchResult => {
        const result: SearchResult = {
          id: command.id,
          title: command.title,
          open: () => commands.run(command.id),
        };
        if (command.keybinding) result.detail = command.keybinding;
        return result;
      });

    // Contributed results lead: a typed name is more often a note than a command.
    // An empty field searches too, and every provider answers it with nothing.
    const found = commands.search(query);
    if (matched.length === 0) return found;
    return [...found, { group: "Commands", results: matched }];
  });

  const rows = $derived(groups.flatMap((group) => group.results));

  async function open(result: SearchResult): Promise<void> {
    commands.togglePalette(false);
    query = "";
    await result.open();
  }

  function onKeydown(event: KeyboardEvent): void {
    if (event.key === "Escape") {
      commands.togglePalette(false);
      return;
    }
    if (event.key === "ArrowDown") {
      event.preventDefault();
      selected = rows.length === 0 ? 0 : (selected + 1) % rows.length;
      return;
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      selected = rows.length === 0 ? 0 : (selected - 1 + rows.length) % rows.length;
      return;
    }
    if (event.key === "Enter") {
      const row = rows[selected];
      if (row) void open(row);
    }
  }
</script>

{#if commands.paletteOpen}
  <div
    class="fixed inset-0 z-100 flex items-start justify-center bg-black/50 pt-32"
    role="presentation"
    onclick={() => commands.togglePalette(false)}
  >
    <div
      class="w-[36rem] max-w-[90vw] overflow-hidden rounded-xl border border-line bg-elevated shadow-lg"
      role="presentation"
      onclick={(event) => event.stopPropagation()}
    >
      <!-- svelte-ignore a11y_autofocus -->
      <input
        bind:value={query}
        autofocus
        placeholder="Search this project, or run a command"
        class="w-full border-b border-line bg-input px-4 py-3 text-base text-default placeholder:text-faint"
        oninput={() => (selected = 0)}
        onkeydown={onKeydown}
      />
      <div class="max-h-96 overflow-y-auto py-1">
        {#each groups as group (group.group)}
          <p class="px-4 pt-2 pb-1 text-2xs font-medium text-faint">{group.group}</p>
          <ul>
            {#each group.results as result (result.id)}
              {@const index = rows.indexOf(result)}
              <li>
                <button
                  type="button"
                  class="flex w-full items-center gap-3 px-4 py-2 text-left text-sm text-default hover:bg-hover"
                  class:bg-hover={index === selected}
                  onmouseenter={() => (selected = index)}
                  onclick={() => open(result)}
                >
                  <span class="min-w-0 flex-1 truncate">{result.title}</span>
                  {#if result.detail}
                    <span class="max-w-56 shrink-0 truncate text-2xs text-dim">{result.detail}</span
                    >
                  {/if}
                </button>
              </li>
            {/each}
          </ul>
        {:else}
          <p class="px-4 py-3 text-sm text-dim">
            {query.trim().length === 0 ? "Type to search." : "Nothing here says that."}
          </p>
        {/each}
      </div>
    </div>
  </div>
{/if}
