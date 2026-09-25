<script lang="ts">
  import { blockToolInput, blockToolOutput, findToolResultBlock } from "@nib-ui/protocol";
  import { type RendererProps, toolDisplayName } from "@nib-ui/ui-contracts";
  import CircleNotchIcon from "phosphor-svelte/lib/CircleNotchIcon";
  import WrenchIcon from "phosphor-svelte/lib/WrenchIcon";
  import BlockShell from "./BlockShell.svelte";

  const { block, session }: RendererProps = $props();

  const input = $derived(blockToolInput(block));
  /**
   * An argument object reads as its own fields, not as the JSON they travelled
   * in: braces and quotes are the transport. Anything else — a string, an array,
   * a call still streaming — has no fields to name, so it stays as it arrived.
   */
  const fields = $derived.by(() => {
    if (input === null || typeof input !== "object" || Array.isArray(input)) return null;
    const entries = Object.entries(input as Record<string, unknown>);
    if (entries.length === 0) return null;
    return entries.map(([name, value]) => ({
      name,
      text: typeof value === "string" ? value : JSON.stringify(value, null, 2),
    }));
  });
  const serialized = $derived(typeof input === "string" ? input : JSON.stringify(input, null, 2));

  // The result renders folded into its call, so an expanded call has to carry it.
  const result = $derived(findToolResultBlock(session, block.toolUseId));
  const output = $derived(blockToolOutput(result));
  const outputText = $derived(
    typeof output === "string" ? output : output ? JSON.stringify(output, null, 2) : "",
  );
  const failed = $derived(
    result?.content?.kind === "tool_result" && (result.content as { isError?: boolean }).isError,
  );
</script>

<BlockShell
  icon={block.completed ? WrenchIcon : CircleNotchIcon}
  title={toolDisplayName(block.toolName ?? "tool")}
  tone={block.completed ? "blue" : "amber"}
  status={block.completed ? undefined : "streaming"}
>
  {#if fields}
    <dl class="flex flex-col gap-1.5 px-3 py-2 text-xs leading-relaxed">
      {#each fields as fieldEntry (fieldEntry.name)}
        <div class="flex min-w-0 gap-2">
          <dt class="w-28 shrink-0 truncate text-2xs tracking-caps uppercase text-faint">
            {fieldEntry.name}
          </dt>
          <dd
            class="max-h-48 min-w-0 flex-1 overflow-auto font-mono whitespace-pre-wrap text-muted"
          >
            {fieldEntry.text}
          </dd>
        </div>
      {/each}
    </dl>
  {:else}
    <pre
      class="overflow-x-auto px-3 py-2 font-mono text-xs leading-relaxed text-muted">{serialized ??
        ""}</pre>
  {/if}
  {#if outputText.length > 0}
    <pre
      class="max-h-72 overflow-auto border-t border-line-faint px-3 py-2 font-mono text-xs leading-relaxed whitespace-pre-wrap {failed
        ? 'text-red'
        : 'text-muted'}">{outputText}</pre>
  {/if}
</BlockShell>
