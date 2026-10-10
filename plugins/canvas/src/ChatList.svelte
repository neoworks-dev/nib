<script lang="ts">
  /**
   * The chat drawer's overview: every chat of the project, running ones first,
   * the rest grouped by when they last moved. Rows are plain until hovered, the
   * way a chat app's history reads, so the titles carry the list rather than
   * the boxes around them.
   */
  import { LoadingSpinner } from "@neoworks-dev/ui";
  import { formatRelativeTime } from "@nib-ui/ui-contracts";
  import ChatCircleIcon from "phosphor-svelte/lib/ChatCircleIcon";
  import ChatsCircleIcon from "phosphor-svelte/lib/ChatsCircleIcon";
  import HandIcon from "phosphor-svelte/lib/HandIcon";
  import type { ChatListEntry, ChatListGroup } from "./chat-list";

  const {
    groups,
    now,
    selectedId = null,
    compact = false,
    onOpen,
  }: {
    groups: ChatListGroup[];
    now: number;
    /** The chat open beside the list, marked so the sidebar says where you are. */
    selectedId?: string | null;
    /** Drawn in a sidebar: the empty state is a line, not an invitation. */
    compact?: boolean;
    onOpen: (sessionId: string) => void;
  } = $props();

  /** The row's second line: what the chat is doing while it runs, else what it last said. */
  function secondLine(chat: ChatListEntry): string {
    if (chat.needsInput) return "Needs your input";
    if (chat.running) return "Working…";
    if (chat.preview) return chat.preview;
    return "No reply yet";
  }
</script>

{#if groups.length === 0 && compact}
  <p class="px-5 py-4 text-xs text-dim">No chats yet.</p>
{:else if groups.length === 0}
  <div class="flex h-full flex-col items-center justify-center gap-3 px-8 text-center">
    <div class="flex size-12 items-center justify-center rounded-2xl bg-raised text-muted">
      <ChatsCircleIcon size={24} />
    </div>
    <div>
      <p class="text-sm font-medium text-default">No chats yet</p>
      <p class="mt-1 text-xs text-dim">
        Ask for something below. The agent works on this project's files, and what it makes lands on
        the board.
      </p>
    </div>
  </div>
{:else}
  <div class="flex flex-col gap-4 px-2 py-3">
    {#each groups as group (group.label)}
      <section>
        <h3 class="px-3 pb-1 text-2xs font-medium tracking-wide text-faint uppercase">
          {group.label}
        </h3>
        <ul class="flex flex-col">
          {#each group.entries as chat (chat.sessionId)}
            <li>
              <button
                type="button"
                class="group flex w-full items-start gap-3 rounded-lg px-3 py-2 text-left transition-colors hover:bg-hover"
                class:bg-raised={chat.sessionId === selectedId}
                aria-current={chat.sessionId === selectedId ? "page" : undefined}
                onclick={() => onOpen(chat.sessionId)}
              >
                <span
                  class="mt-0.5 flex size-5 shrink-0 items-center justify-center"
                  class:text-blue={chat.running && !chat.needsInput}
                  class:text-amber={chat.needsInput}
                  class:text-faint={!chat.running}
                >
                  {#if chat.needsInput}
                    <HandIcon size={16} weight="fill" aria-label="Needs input" />
                  {:else if chat.running}
                    <LoadingSpinner size={14} thickness={3} label="Running" />
                  {:else}
                    <ChatCircleIcon size={16} />
                  {/if}
                </span>

                <span class="min-w-0 flex-1">
                  <span class="block truncate text-sm text-default">{chat.title}</span>
                  <span
                    class="block truncate text-xs"
                    class:text-blue={chat.running && !chat.needsInput}
                    class:text-amber={chat.needsInput}
                    class:text-dim={!chat.running}
                  >
                    {secondLine(chat)}
                  </span>
                </span>

                <span class="mt-0.5 shrink-0 text-2xs text-faint tabular-nums">
                  {formatRelativeTime(chat.updatedAt, now)}
                </span>
              </button>
            </li>
          {/each}
        </ul>
      </section>
    {/each}
  </div>
{/if}
