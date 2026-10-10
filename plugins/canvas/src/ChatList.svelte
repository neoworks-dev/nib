<script lang="ts">
  /**
   * The chat drawer's overview: every chat of the project, running ones first,
   * the rest grouped by when they last moved. Rows are plain until hovered, the
   * way a chat app's history reads, so the titles carry the list rather than
   * the boxes around them.
   */
  import { LoadingSpinner } from "@neoworks-dev/ui";
  import { formatRelativeTime } from "@nib-ui/ui-contracts";
  import DotsThreeIcon from "phosphor-svelte/lib/DotsThreeIcon";
  import CircleIcon from "phosphor-svelte/lib/CircleIcon";
  import ChatsCircleIcon from "phosphor-svelte/lib/ChatsCircleIcon";
  import HandIcon from "phosphor-svelte/lib/HandIcon";
  import type { ChatListEntry, ChatListGroup } from "./chat-list";
  import ChatRowMenu from "./ChatRowMenu.svelte";

  const {
    groups,
    now,
    selectedId = null,
    unreadIds = new Set<string>(),
    compact = false,
    onOpen,
    onPin,
    onRename,
    onBranch,
    onDelete,
  }: {
    groups: ChatListGroup[];
    now: number;
    /** Chats that moved since the user last looked at them, drawn bold with a dot. */
    unreadIds?: Set<string>;
    /** The chat open beside the list, marked so the sidebar says where you are. */
    selectedId?: string | null;
    /** Drawn in a sidebar: the empty state is a line, not an invitation. */
    compact?: boolean;
    onOpen: (sessionId: string) => void;
    onPin: (sessionId: string, pinned: boolean) => void;
    onRename: (sessionId: string, label: string) => void;
    onBranch: (sessionId: string) => void;
    onDelete: (sessionId: string) => void;
  } = $props();

  /** The chat whose options menu is open, and the button it hangs from. */
  let menu = $state<{ chat: ChatListEntry; anchor: DOMRect } | null>(null);
  /** The chat being renamed in place, and what has been typed so far. */
  let renaming = $state<{ sessionId: string; label: string } | null>(null);

  function openMenu(event: MouseEvent & { currentTarget: HTMLElement }, chat: ChatListEntry): void {
    menu = { chat, anchor: event.currentTarget.getBoundingClientRect() };
  }

  function startRename(chat: ChatListEntry): void {
    renaming = { sessionId: chat.sessionId, label: chat.title };
  }

  /** Keeps the new name when there is one; an emptied field keeps the old. */
  function finishRename(): void {
    if (!renaming) return;
    const label = renaming.label.trim();
    if (label.length > 0) onRename(renaming.sessionId, label);
    renaming = null;
  }

  function renameKeydown(event: KeyboardEvent): void {
    if (event.key === "Enter") finishRename();
    if (event.key === "Escape") renaming = null;
  }

  /** Focuses a field the moment it appears and selects what is in it. */
  function focusAndSelect(node: HTMLInputElement): void {
    node.focus();
    node.select();
  }

  /** The row's second line: what the chat last said, unless it is waiting on the user. */
  function secondLine(chat: ChatListEntry): string {
    if (chat.needsInput) return "Needs your input";
    if (chat.preview) return chat.preview;
    if (chat.running) return "Working…";
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
            <li class="group relative">
              {#if renaming?.sessionId === chat.sessionId}
                <input
                  class="w-full rounded-lg border border-line-strong bg-input px-3 py-2 text-sm text-default outline-none"
                  aria-label="Chat name"
                  bind:value={renaming.label}
                  use:focusAndSelect
                  onkeydown={renameKeydown}
                  onblur={finishRename}
                />
              {:else}
                <button
                  type="button"
                  class="flex w-full items-start gap-2 rounded-lg px-3 py-2 text-left transition-colors hover:bg-hover"
                  class:bg-raised={chat.sessionId === selectedId}
                  aria-current={chat.sessionId === selectedId ? "page" : undefined}
                  onclick={() => onOpen(chat.sessionId)}
                >
                  <span class="min-w-0 flex-1">
                    <span
                      class="block truncate text-sm text-default"
                      class:font-semibold={unreadIds.has(chat.sessionId)}>{chat.title}</span
                    >
                    <span
                      class="block truncate text-xs"
                      class:text-blue={chat.running && !chat.needsInput}
                      class:text-amber={chat.needsInput}
                      class:text-dim={!chat.running}
                    >
                      {secondLine(chat)}
                    </span>
                  </span>

                  <!-- What time-ago would say, unless the chat needs a look: then that takes its place. -->
                  <span
                    class="mt-0.5 flex h-4 shrink-0 items-center text-2xs text-faint tabular-nums group-focus-within:invisible group-hover:invisible"
                  >
                    {#if chat.needsInput}
                      <span class="text-amber"
                        ><HandIcon size={14} weight="fill" aria-label="Needs input" /></span
                      >
                    {:else if chat.running}
                      <span class="text-blue"
                        ><LoadingSpinner size={12} thickness={3} label="Running" /></span
                      >
                    {:else if unreadIds.has(chat.sessionId)}
                      <span class="text-action"
                        ><CircleIcon size={8} weight="fill" aria-label="Unread" /></span
                      >
                    {:else}
                      {formatRelativeTime(chat.updatedAt, now)}
                    {/if}
                  </span>
                </button>

                <button
                  type="button"
                  class="absolute top-2 right-2 hidden size-5 items-center justify-center rounded-md text-muted group-focus-within:flex group-hover:flex hover:bg-hover hover:text-default"
                  aria-label="Chat options"
                  aria-haspopup="menu"
                  onclick={(event) => openMenu(event, chat)}
                >
                  <DotsThreeIcon size={16} weight="bold" />
                </button>
              {/if}
            </li>
          {/each}
        </ul>
      </section>
    {/each}
  </div>
{/if}

{#if menu}
  {@const target = menu.chat}
  <ChatRowMenu
    anchor={menu.anchor}
    pinned={target.pinned}
    branchable={target.branchable}
    onPin={() => onPin(target.sessionId, !target.pinned)}
    onRename={() => startRename(target)}
    onBranch={() => onBranch(target.sessionId)}
    onDelete={() => onDelete(target.sessionId)}
    onClose={() => (menu = null)}
  />
{/if}
