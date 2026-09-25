<script lang="ts">
  import { blockToolInput, blockToolOutput, findToolResultBlock } from "@nib-ui/protocol";
  import type { SpawnAgentInput } from "@nib-ui/protocol";
  import {
    type RendererProps,
    showAgentSession,
    statusLabel,
    statusTone,
  } from "@nib-ui/ui-contracts";
  import { harnessIcon, kernelContext } from "@nib-ui/ui-contracts/svelte";
  import BlockShell from "./BlockShell.svelte";
  import { parseSpawnResult } from "./spawn-result";

  const { block, session }: RendererProps = $props();

  const context = kernelContext();
  const sessions = context.require("sessions");
  const panes = context.require("panes");

  const input = $derived(blockToolInput<Partial<SpawnAgentInput>>(block));
  const HarnessIcon = $derived(harnessIcon(input?.harness ?? ""));
  const harnessName = $derived.by(() => {
    const descriptor = sessions.harnesses.find((entry) => entry.id === input?.harness);
    if (descriptor) return descriptor.displayName;
    if (input?.harness) return input.harness;
    return "Agent";
  });

  /** Null until the harness answers: the agent does not exist before then. */
  const spawned = $derived.by(() => {
    const result = findToolResultBlock(session, block.toolUseId);
    return parseSpawnResult(blockToolOutput(result));
  });
  // What the agent is called and where it has got to are its own to say, so they
  // are read off the live session rather than off what the spawn answered with.
  const summary = $derived(sessions.summaries.find((entry) => entry.id === spawned?.sessionId));
  const view = $derived(spawned ? sessions.view(spawned.sessionId) : null);
  const status = $derived.by(() => {
    if (view) return view.status;
    if (summary) return summary.status;
    return null;
  });
  const stateWord = $derived(status ? statusLabel(status) : null);
  const tone = $derived(status ? statusTone(status) : "blue");

  const title = $derived.by(() => {
    if (view?.title) return view.title;
    if (summary?.title) return summary.title;
    if (spawned?.title) return spawned.title;
    if (input?.label) return input.label;
    return firstLine(input?.prompt);
  });
  const prompt = $derived(firstLine(input?.prompt));

  function firstLine(text: string | undefined): string {
    const line = text?.split("\n").find((entry) => entry.trim().length > 0);
    return line?.trim() ?? "Starting an agent";
  }

  function open(): void {
    if (spawned) showAgentSession(panes, sessions, session.sessionId, spawned.sessionId);
  }
</script>

<BlockShell icon={HarnessIcon} title={harnessName} {tone} status={stateWord ?? undefined}>
  <button
    type="button"
    class="flex w-full flex-col gap-1 px-3 py-2 text-left enabled:hover:bg-hover"
    disabled={!spawned}
    onclick={open}
  >
    <span class="flex w-full min-w-0 items-center gap-2">
      <span class="min-w-0 flex-1 truncate text-xs text-default">{title}</span>
      {#if input?.model}
        <span class="shrink-0 text-2xs text-faint">{input.model}</span>
      {/if}
    </span>
    {#if prompt !== title}
      <span class="line-clamp-2 text-2xs leading-relaxed text-dim">{prompt}</span>
    {/if}
  </button>
</BlockShell>
