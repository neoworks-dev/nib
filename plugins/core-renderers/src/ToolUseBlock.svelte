<script lang="ts">
  import { isToolSettled, toolInput, toolOutputText, type ToolItem } from "@nib-ui/protocol";
  import { type RendererProps, toolDisplayName } from "@nib-ui/ui-contracts";
  import CircleNotchIcon from "phosphor-svelte/lib/CircleNotchIcon";
  import WrenchIcon from "phosphor-svelte/lib/WrenchIcon";
  import BlockShell from "./BlockShell.svelte";

  const { item }: RendererProps<ToolItem> = $props();

  const input = $derived(toolInput(item));
  /**
   * An argument object reads as its own fields, not as the JSON they travelled
   * in: braces and quotes are the transport. Anything else has no fields to name,
   * so it stays as it arrived.
   */
  const fields = $derived.by(() => {
    if (input === undefined) return null;
    const entries = Object.entries(input);
    if (entries.length === 0) return null;
    return entries.map(([name, value]) => ({
      name,
      text: typeof value === "string" ? value : JSON.stringify(value, null, 2),
    }));
  });
  const serialized = $derived(
    typeof item.rawInput === "string" ? item.rawInput : JSON.stringify(item.rawInput, null, 2),
  );

  const outputText = $derived(toolOutputText(item));
  const failed = $derived(item.status === "failed");
  const settled = $derived(isToolSettled(item));
  const name = $derived.by(() => {
    if (item.name.length > 0) return toolDisplayName(item.name);
    if (item.title.length > 0) return item.title;
    return "tool";
  });
</script>

<BlockShell
  icon={settled ? WrenchIcon : CircleNotchIcon}
  title={name}
  tone={settled ? "blue" : "amber"}
  status={settled ? undefined : "running"}
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
  {:else if item.rawInput !== undefined}
    <pre
      class="overflow-x-auto px-3 py-2 font-mono text-xs leading-relaxed text-muted">{serialized}</pre>
  {/if}
  {#if outputText.length > 0}
    <pre
      class="max-h-72 overflow-auto border-t border-line-faint px-3 py-2 font-mono text-xs leading-relaxed whitespace-pre-wrap {failed
        ? 'text-red'
        : 'text-muted'}">{outputText}</pre>
  {/if}
</BlockShell>
