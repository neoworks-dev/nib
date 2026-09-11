<script lang="ts">
  import { StatusBadge } from "@neoworks-dev/ui";
  import type { SessionView } from "@nib-ui/protocol";
  import PaperPlaneRightIcon from "phosphor-svelte/lib/PaperPlaneRightIcon";
  import type { PaneRole } from "./relay";
  import { gauntletState } from "./state.svelte";

  const { role, title, tone }: { role: PaneRole; title: string; tone: "blue" | "violet" } =
    $props();

  let draft = $state("");
  let feed = $state<HTMLDivElement>();

  const sessions = $derived(gauntletState.sessions);
  const sessionId = $derived(gauntletState.sessionId(role));
  const view = $derived<SessionView | null>(sessionId ? (sessions?.view(sessionId) ?? null) : null);
  const options = $derived(sessions?.summaries ?? []);
  const status = $derived(view?.status ?? "idle");

  $effect(() => {
    view?.lastSeq;
    feed?.scrollTo({ top: feed.scrollHeight });
  });

  async function send() {
    const text = draft.trim();
    if (text.length === 0 || !sessionId) return;
    draft = "";
    await sessions?.sendTo(sessionId, text);
  }
</script>

<section class="flex min-h-0 min-w-0 flex-1 flex-col border border-line bg-canvas">
  <header class="flex items-center gap-2 border-b border-line px-3 py-2">
    <span class="text-2xs tracking-caps uppercase {tone === 'blue' ? 'text-blue' : 'text-violet'}"
      >{title}</span
    >
    <select
      value={sessionId ?? ""}
      onchange={(event) => gauntletState.assign(role, event.currentTarget.value || null)}
      class="min-w-0 flex-1 truncate rounded-md border border-line bg-input px-2 py-1 text-xs text-default focus:outline-none"
    >
      <option value="">Pick a task…</option>
      {#each options as summary (summary.id)}
        <option value={summary.id}>{summary.title ?? summary.cwd}</option>
      {/each}
    </select>
    <StatusBadge tone={status === "error" ? "red" : status === "working" ? "blue" : "neutral"}
      >{status}</StatusBadge
    >
  </header>

  <div bind:this={feed} class="min-h-0 flex-1 overflow-y-auto px-3 py-3">
    {#if !view}
      <p class="text-xs text-dim">Assign a task to this pane.</p>
    {:else}
      {#each view.messages as message (message.id)}
        <article class="mb-3 flex flex-col gap-1">
          <span class="text-2xs tracking-caps uppercase text-faint">{message.role}</span>
          {#each message.blocks as block (block.id)}
            {@const Renderer = gauntletState.renderers?.resolve(block)}
            {#if Renderer}
              <Renderer {block} session={view} />
            {/if}
          {/each}
        </article>
      {/each}
      {#if view.messages.length === 0}
        <p class="text-xs text-dim">No turns yet.</p>
      {/if}
    {/if}
  </div>

  <div class="flex items-end gap-2 border-t border-line px-3 py-2">
    <textarea
      bind:value={draft}
      rows="2"
      placeholder="Message this agent"
      onkeydown={(event) => {
        if (event.key === "Enter" && !event.shiftKey) {
          event.preventDefault();
          void send();
        }
      }}
      class="min-h-12 flex-1 resize-y rounded-lg border border-line bg-input px-2 py-1.5 text-xs text-default placeholder:text-faint focus:border-line-strong focus:outline-none"
    ></textarea>
    <button
      type="button"
      class="rounded-md border border-line px-2 py-1.5 text-dim hover:text-default disabled:opacity-40"
      disabled={!sessionId || draft.trim().length === 0}
      aria-label="Send to this pane"
      onclick={send}
    >
      <PaperPlaneRightIcon size={14} />
    </button>
  </div>
</section>
