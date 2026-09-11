<script lang="ts">
  import { FileIcon } from "@nib-ui/file-icons";
  import type { PaneProps } from "@nib-ui/ui-contracts";
  import CaretRightIcon from "phosphor-svelte/lib/CaretRightIcon";
  import XIcon from "phosphor-svelte/lib/XIcon";
  import { type Selection, selectionPrompt, sliceLines } from "./ask";
  import {
    hunkRange,
    latestEdits,
    placeHunks,
    type ReviewOutcome,
    reviewLines,
    reviewMessage,
    type Verdict,
  } from "./changes";
  import { highlightLines, languageFor } from "./highlight";
  import ReviewBar from "./ReviewBar.svelte";
  import SelectionAsk from "./SelectionAsk.svelte";
  import { fileViewerState } from "./state.svelte";
  import "./theme.css";

  const { session }: PaneProps = $props();

  let selection = $state<Selection | null>(null);
  /** The line a drag started on; null when no drag is in flight. */
  let anchor: number | null = null;
  let dragged = false;

  const active = $derived(fileViewerState.active);
  const language = $derived(active ? (languageFor(active.path) ?? "text") : "");
  const workspace = $derived(session?.cwd?.slice(session.cwd.lastIndexOf("/") + 1) ?? "workspace");

  const edits = $derived(session && active ? latestEdits(session, active.path) : []);
  const hunks = $derived(active ? placeHunks(active.text, edits) : []);
  const pending = $derived(hunks.filter((hunk) => !fileViewerState.verdicts[hunk.editId]));
  const ranges = $derived(new Map(hunks.map((hunk) => [hunk.editId, hunkRange(hunk)])));
  // The gutter numbers file lines, so highlighting is keyed to them, not to the diff.
  const markup = $derived(active ? highlightLines(active.text, active.path) : []);
  const lines = $derived(active ? reviewLines(active.text, hunks) : []);

  const rowStyle = { context: "", added: "bg-green-soft", removed: "bg-red-soft" } as const;
  // Focusing the input collapses the browser's own selection, so the range is
  // painted here instead — the highlight has to survive typing into the prompt.
  function selected(line: number | null): boolean {
    return selection !== null && line !== null && line >= selection.from && line <= selection.to;
  }
  const markerStyle = { context: "text-faint", added: "text-green", removed: "text-red" } as const;
  const markers = { context: " ", added: "+", removed: "-" } as const;

  // An edit superseded by a later one in the same turn never reappears in the
  // file, so the reload is attempted once per edit set rather than per miss.
  let reloadedFor = "";

  $effect(() => {
    // An edit whose replacement is absent means the cached text predates it.
    if (!session || !active || edits.length === 0) return;
    const signature = `${active.path}:${edits.map((edit) => edit.id).join("|")}`;
    if (reloadedFor === signature) return;
    if (edits.every((edit) => active.text.includes(edit.after))) return;
    reloadedFor = signature;
    void fileViewerState.reload(session.sessionId, active.path);
  });

  $effect(() => {
    // A different file is a different selection.
    active?.path;
    selection = null;
  });

  $effect(() => {
    // A drag that ends past the pane's edge still has to finish.
    window.addEventListener("mouseup", endSelect);
    return () => window.removeEventListener("mouseup", endSelect);
  });

  /**
   * The code host suppresses the browser's own selection, so dragging is tracked
   * here and drawn a line at a time. Asking about lines competes with reviewing
   * them, so the prompt only appears once the file has nothing left to decide.
   */
  function beginSelect(event: MouseEvent) {
    if (pending.length > 0 || event.button !== 0) return;
    const line = lineOf(event.target);
    if (line === null) return;
    anchor = line;
    dragged = false;
    selection = { from: line, to: line, text: "" };
  }

  function extendSelect(event: MouseEvent) {
    if (anchor === null) return;
    const line = lineOf(event.target);
    if (line === null) return;
    dragged = true;
    selection = { from: Math.min(anchor, line), to: Math.max(anchor, line), text: "" };
  }

  /** A press that never moved is a click, and a click is not a selection. */
  function endSelect() {
    if (anchor === null) return;
    anchor = null;
    if (!dragged) return void (selection = null);
    if (selection && active)
      selection = { ...selection, text: sliceLines(active.text, selection.from, selection.to) };
  }

  function lineOf(target: EventTarget | null): number | null {
    const element = target instanceof Element ? target : null;
    const value = element?.closest("[data-line]")?.getAttribute("data-line");
    return value ? Number(value) : null;
  }

  function ask(request: string) {
    if (!session || !active || !selection) return;
    const prompt = selectionPrompt(active.path, selection, request);
    selection = null;
    if (prompt) void fileViewerState.sessions?.sendTo(session.sessionId, prompt);
  }

  function decide(editId: string, verdict: Verdict) {
    const decided = { ...fileViewerState.verdicts, [editId]: verdict };
    fileViewerState.decide(editId, verdict);
    if (!session || !active) return;
    if (hunks.some((hunk) => !decided[hunk.editId])) return;

    // That was the file's last undecided change, so the review is complete.
    const outcomes: ReviewOutcome[] = hunks.map((hunk) => ({
      editId: hunk.editId,
      verdict: decided[hunk.editId]!,
      lines: hunkRange(hunk),
    }));
    const message = reviewMessage(active.path, outcomes);
    if (message) void fileViewerState.sessions?.sendTo(session.sessionId, message);
  }
</script>

<div class="flex h-full min-h-0 flex-col">
  {#if fileViewerState.tabs.length === 0}
    <p class="px-3 py-2 text-xs text-dim">
      Open a file from the browser or a diff to view it here.
    </p>
  {:else}
    <div class="flex items-center gap-1 overflow-x-auto border-b border-line px-2 py-1.5">
      {#each fileViewerState.tabs as tab (tab.path)}
        <div
          class="flex shrink-0 items-center gap-1.5 rounded-md px-2 py-1 text-xs {tab.path ===
          fileViewerState.activePath
            ? 'bg-raised text-default'
            : 'text-dim hover:bg-hover'}"
        >
          <button
            type="button"
            class="flex items-center gap-1.5"
            onclick={() => (fileViewerState.activePath = tab.path)}
          >
            <FileIcon path={tab.path} size={13} />
            {tab.path.slice(tab.path.lastIndexOf("/") + 1)}
          </button>
          <button
            type="button"
            class="text-faint hover:text-default"
            aria-label="Close {tab.path}"
            onclick={() => fileViewerState.close(tab.path)}
          >
            <XIcon size={11} />
          </button>
        </div>
      {/each}
    </div>

    {#if active}
      <div
        class="flex items-center gap-1.5 border-b border-line-faint px-3 py-1.5 text-2xs text-dim"
      >
        <span>{workspace}</span>
        <CaretRightIcon size={10} />
        <FileIcon path={active.path} size={12} />
        <span class="truncate font-mono text-default">{active.path}</span>
        {#if pending.length > 0}
          <span class="ml-auto shrink-0 text-amber">
            {pending.length}
            {pending.length === 1 ? "change to review" : "changes to review"}
          </span>
        {:else}
          <span class="ml-auto shrink-0 text-faint">{language} · {markup.length} lines</span>
        {/if}
      </div>

      <!-- svelte-ignore a11y_no_static_element_interactions -->
      <div
        class="hljs-surface min-h-0 flex-1 overflow-auto font-mono text-xs select-none"
        onmousedown={beginSelect}
        onmousemove={extendSelect}
      >
        {#each lines as line, index (index)}
          {#if selection && line.number === selection.from}
            <SelectionAsk {selection} onsubmit={ask} oncancel={() => (selection = null)} />
          {/if}
          {#if line.startsHunk && line.editId}
            <ReviewBar
              range={ranges.get(line.editId) ?? [0, 0]}
              verdict={fileViewerState.verdicts[line.editId] ?? null}
              ondecide={(verdict) => decide(line.editId!, verdict)}
            />
          {/if}
          <div
            class="flex {rowStyle[line.kind]} {selected(line.number) ? 'bg-blue-soft' : ''}"
            data-line={line.number}
          >
            <span
              class="w-12 shrink-0 border-r border-line-faint bg-surface px-2 py-px text-right text-faint tabular-nums select-none"
            >
              {line.number ?? ""}
            </span>
            <span class="w-4 shrink-0 py-px text-center select-none {markerStyle[line.kind]}">
              {markers[line.kind]}
            </span>
            {#if line.number === null}
              <code class="flex-1 px-1 py-px whitespace-pre text-red">{line.text || " "}</code>
            {:else}
              <code class="flex-1 px-1 py-px whitespace-pre"
                >{@html markup[line.number - 1] || " "}</code
              >
            {/if}
          </div>
        {/each}
      </div>
    {/if}
  {/if}

  {#if fileViewerState.error}
    <p class="border-t border-line px-3 py-2 text-xs text-red">{fileViewerState.error}</p>
  {/if}
</div>
