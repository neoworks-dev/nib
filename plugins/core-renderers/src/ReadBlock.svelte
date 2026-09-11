<script lang="ts">
  import { FileIcon } from "@nib-ui/file-icons";
  import { blockToolInput, blockToolOutput, findToolResultBlock } from "@nib-ui/protocol";
  import type { RendererProps } from "@nib-ui/ui-contracts";

  const { block, session }: RendererProps = $props();

  const path = $derived.by(() => {
    const input = blockToolInput<{ file_path?: string; notebook_path?: string }>(block);
    if (input?.file_path) return input.file_path;
    if (input?.notebook_path) return input.notebook_path;
    return "unknown file";
  });

  const text = $derived.by(() => {
    const output = blockToolOutput(findToolResultBlock(session, block.toolUseId));
    if (typeof output === "string") return output;
    if (output) return JSON.stringify(output, null, 2);
    return "no output yet";
  });
</script>

<div class="overflow-hidden rounded-lg border border-line-faint bg-input text-xs">
  <header class="flex items-center gap-2 px-3 py-1.5">
    <FileIcon {path} size={14} />
    <span class="truncate font-mono text-2xs text-muted">{path}</span>
  </header>
  <pre
    class="max-h-72 overflow-auto border-t border-line-faint px-3 py-2 font-mono text-2xs whitespace-pre-wrap text-muted">{text}</pre>
</div>
