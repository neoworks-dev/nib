<script lang="ts">
  import { Button } from "@neoworks-dev/ui";
  import { FileIcon } from "@nib-ui/file-icons";
  import type { PaneProps } from "@nib-ui/ui-contracts";
  import ArrowsClockwiseIcon from "phosphor-svelte/lib/ArrowsClockwiseIcon";
  import GitBranchIcon from "phosphor-svelte/lib/GitBranchIcon";
  import {
    changeLabel,
    commitChanges,
    fetchDiff,
    fetchStatus,
    type GitStatus,
    setStaged,
  } from "./client";
  import DiffView from "./DiffView.svelte";
  import { gitPanelState } from "./state.svelte";

  const { session }: PaneProps = $props();

  let status = $state<GitStatus | null>(null);
  let patch = $state("");
  let message = $state("");
  let busy = $state(false);
  let error = $state<string | null>(null);

  const sessionId = $derived(session?.sessionId ?? null);
  const staged = $derived(status?.files.filter((file) => file.staged) ?? []);
  const unstaged = $derived(status?.files.filter((file) => !file.staged) ?? []);
  const totals = $derived({
    added: status?.files.reduce((sum, file) => sum + file.added, 0) ?? 0,
    removed: status?.files.reduce((sum, file) => sum + file.removed, 0) ?? 0,
  });

  $effect(() => {
    // Refresh when the session changes and after every turn the agent lands.
    if (!sessionId) return;
    session?.lastSeq;
    void refresh(sessionId);
  });

  $effect(() => {
    const path = gitPanelState.selectedPath;
    if (!sessionId || !path) {
      patch = "";
      return;
    }
    let current = true;
    const isStaged = status?.files.find((file) => file.path === path)?.staged ?? false;
    void fetchDiff(sessionId, path, isStaged).then((result) => {
      if (current) patch = result.patch;
    });
    return () => {
      current = false;
    };
  });

  async function refresh(id: string) {
    try {
      status = await fetchStatus(id);
      error = null;
    } catch (cause) {
      error = describe(cause);
    }
  }

  async function toggleStaged(path: string, next: boolean) {
    if (!sessionId) return;
    busy = true;
    try {
      await setStaged(sessionId, [path], next);
      await refresh(sessionId);
    } catch (cause) {
      error = describe(cause);
    }
    busy = false;
  }

  async function commit() {
    if (!sessionId || message.trim().length === 0) return;
    busy = true;
    try {
      await commitChanges(sessionId, message.trim(), []);
      message = "";
      await refresh(sessionId);
      error = null;
    } catch (cause) {
      error = describe(cause);
    }
    busy = false;
  }

  function describe(cause: unknown): string {
    return cause instanceof Error ? cause.message : String(cause);
  }
</script>

<div class="flex h-full min-h-0 flex-col">
  <header class="flex items-center gap-2 border-b border-line px-4 py-3">
    <GitBranchIcon size={16} />
    <h2 class="text-sm font-semibold">{status?.branch ?? "Git"}</h2>
    {#if status && (status.ahead > 0 || status.behind > 0)}
      <span class="text-2xs text-faint">↑{status.ahead} ↓{status.behind}</span>
    {/if}
    <span class="ml-auto flex items-center gap-2">
      <span class="font-mono text-2xs text-green">+{totals.added}</span>
      <span class="font-mono text-2xs text-red">-{totals.removed}</span>
      <button
        type="button"
        class="text-dim hover:text-default"
        aria-label="Refresh git status"
        onclick={() => sessionId && refresh(sessionId)}
      >
        <ArrowsClockwiseIcon size={14} />
      </button>
    </span>
  </header>

  <div class="min-h-0 flex-1 overflow-y-auto">
    {#if error}
      <p class="border-b border-line px-4 py-2 text-xs text-red">{error}</p>
    {/if}

    {#if status && !status.repository}
      <p class="px-4 py-3 text-xs text-dim">This workspace is not a git repository.</p>
    {:else}
      {#each [{ title: "Staged", files: staged, staged: true }, { title: "Changes", files: unstaged, staged: false }] as group (group.title)}
        {#if group.files.length > 0}
          <h3 class="px-4 py-1.5 text-2xs tracking-caps uppercase text-dim">{group.title}</h3>
          {#each group.files as file (file.path)}
            <div
              class="flex items-center gap-2 px-3 py-1.5 text-xs {gitPanelState.selectedPath ===
              file.path
                ? 'bg-raised'
                : 'hover:bg-hover'}"
            >
              <button
                type="button"
                class="flex min-w-0 flex-1 items-center gap-2 text-left"
                onclick={() => (gitPanelState.selectedPath = file.path)}
              >
                <FileIcon path={file.path} size={14} />
                <span class="truncate font-mono text-default">{file.path}</span>
                <span class="shrink-0 text-2xs text-faint">{changeLabel(file)}</span>
              </button>
              <span class="shrink-0 font-mono text-2xs text-green">+{file.added}</span>
              <span class="shrink-0 font-mono text-2xs text-red">-{file.removed}</span>
              <button
                type="button"
                class="shrink-0 rounded-md border border-line px-1.5 py-0.5 text-2xs text-dim hover:text-default"
                disabled={busy}
                onclick={() => toggleStaged(file.path, !group.staged)}
              >
                {group.staged ? "Unstage" : "Stage"}
              </button>
            </div>
          {/each}
        {/if}
      {/each}

      {#if status && status.files.length === 0}
        <p class="px-4 py-3 text-xs text-dim">Working tree clean.</p>
      {/if}
    {/if}

    {#if patch}
      <DiffView {patch} />
    {/if}
  </div>

  <footer class="flex flex-col gap-2 border-t border-line px-4 py-3">
    <textarea
      bind:value={message}
      rows="2"
      placeholder="Commit message"
      class="resize-y rounded-lg border border-line bg-input px-3 py-2 text-xs text-default placeholder:text-faint focus:border-line-strong focus:outline-none"
    ></textarea>
    <div class="flex items-center gap-2">
      <Button
        size="sm"
        variant="primary"
        disabled={busy || message.trim().length === 0 || staged.length === 0}
        onclick={commit}>Commit {staged.length > 0 ? `${staged.length} staged` : ""}</Button
      >
      <span class="text-2xs text-faint">Commits stay local — nothing is pushed.</span>
    </div>
  </footer>
</div>
