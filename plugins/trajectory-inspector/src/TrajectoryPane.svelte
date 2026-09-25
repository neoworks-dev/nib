<script lang="ts">
  /**
   * The inspector as a pane. It shows the session of the chat it is docked
   * beside — read off that pane's params, so it follows the conversation across
   * a hand-off to another harness — and the task in the foreground when it has
   * no chat next to it. Filters and the selection are its own: two inspectors
   * open on two chats do not share a search box.
   */
  import type { PaneProps } from "@nib-ui/ui-contracts";
  import { kernelContext } from "@nib-ui/ui-contracts/svelte";
  import MagnifyingGlassIcon from "phosphor-svelte/lib/MagnifyingGlassIcon";
  import XIcon from "phosphor-svelte/lib/XIcon";
  import DetailPane from "./DetailPane.svelte";
  import { categorizeEvent, type EventCategory, eventCategories, indexBlockKinds } from "./filter";
  import TimelineStrip from "./TimelineStrip.svelte";
  import { buildTimeline, markIndex, type TimeRange, withinRange } from "./timeline";
  import TraceRow from "./TraceRow.svelte";
  import { buildTrace, type TraceNode } from "./trace";

  const { session: activeSession, instanceId }: PaneProps = $props();

  const context = kernelContext();
  const sessions = context.require("sessions");
  const attachments = context.require("attachments");

  const session = $derived.by(() => {
    const chat = attachments.find(instanceId, "chat");
    const sessionId = chat?.params?.sessionId;
    if (typeof sessionId === "string") return sessions.view(sessionId);
    return activeSession;
  });

  let query = $state("");
  let categories = $state<EventCategory[]>([]);
  let selectedEventId = $state<string | null>(null);
  /** Brushed window on the timeline; null means the whole session. */
  let range = $state<TimeRange | null>(null);

  // No session yet — a chat whose task has not been launched — has no log to show.
  const events = $derived.by(() => {
    if (!session) return [];
    return sessions.events(session.sessionId);
  });
  const blockKinds = $derived(indexBlockKinds(events));
  const trace = $derived(buildTrace(events));
  const marks = $derived(markIndex(buildTimeline(trace)));
  const visible = $derived(trace.filter(matches));
  const selected = $derived(visible.find((node) => node.id === selectedEventId) ?? null);

  function matches(node: TraceNode): boolean {
    if (!withinRange(marks.get(node.id), range)) return false;

    if (
      categories.length > 0 &&
      !node.events.some((event) => categories.includes(categorizeEvent(event, blockKinds)))
    )
      return false;

    const needle = query.trim().toLowerCase();
    if (needle.length === 0) return true;
    return `${node.badge} ${node.title} ${node.detail} ${node.result ?? ""}`
      .toLowerCase()
      .includes(needle);
  }

  function toggleCategory(category: EventCategory): void {
    categories = categories.includes(category)
      ? categories.filter((entry) => entry !== category)
      : [...categories, category];
  }
</script>

<div class="flex h-full min-h-0 flex-col">
  <TimelineStrip
    nodes={trace}
    {range}
    selectedId={selectedEventId}
    onbrush={(next) => (range = next)}
    onselect={(nodeId) => (selectedEventId = nodeId)}
  />

  <div class="flex flex-col gap-2 border-b border-line px-3 py-2">
    <div class="flex items-center gap-2 rounded-md border border-line bg-input px-2 py-1.5">
      <span class="text-faint"><MagnifyingGlassIcon size={14} /></span>
      <input
        bind:value={query}
        placeholder="Search steps, payloads and results"
        class="min-w-0 flex-1 bg-transparent text-xs text-default placeholder:text-faint focus:outline-none"
      />
      {#if query}
        <button
          type="button"
          class="text-faint hover:text-default"
          aria-label="Clear the search"
          onclick={() => (query = "")}
        >
          <XIcon size={12} />
        </button>
      {/if}
      <span class="text-2xs text-faint tabular-nums">{visible.length}/{trace.length}</span>
    </div>

    <div class="flex flex-wrap gap-1.5">
      {#each eventCategories as category (category.id)}
        <button
          type="button"
          class="rounded-full border px-2 py-0.5 text-2xs"
          class:border-action={categories.includes(category.id)}
          class:bg-raised={categories.includes(category.id)}
          class:text-default={categories.includes(category.id)}
          class:border-line={!categories.includes(category.id)}
          class:text-dim={!categories.includes(category.id)}
          class:hover:text-default={!categories.includes(category.id)}
          onclick={() => toggleCategory(category.id)}
        >
          {category.label}
        </button>
      {/each}
    </div>
  </div>

  <div class="min-h-0 flex-1 overflow-y-auto font-mono text-2xs">
    {#each visible as node (node.id)}
      <TraceRow
        {node}
        selected={node.id === selectedEventId}
        onselect={() => (selectedEventId = selectedEventId === node.id ? null : node.id)}
      />
    {/each}
    {#if visible.length === 0}
      <p class="px-4 py-3 font-sans text-xs text-dim">
        {events.length === 0
          ? "No events recorded for this session yet."
          : "No steps match the filter."}
      </p>
    {/if}
  </div>

  {#if selected}
    <div class="flex h-[45%] min-h-0 flex-col">
      <DetailPane node={selected} />
    </div>
  {/if}
</div>
