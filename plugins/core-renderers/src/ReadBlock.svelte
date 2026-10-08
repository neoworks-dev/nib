<script lang="ts">
  import { FileIcon } from "@nib-ui/file-icons";
  import { toolInputString, toolOutputText, type ToolItem } from "@nib-ui/protocol";
  import type { RendererProps } from "@nib-ui/ui-contracts";

  const { item }: RendererProps<ToolItem> = $props();

  const path = $derived.by(() => {
    const fromInput = toolInputString(item, "file_path", "path", "notebook_path");
    if (fromInput !== undefined) return fromInput;
    const location = item.locations[0];
    if (location) return location.path;
    return "unknown file";
  });

  const text = $derived.by(() => {
    const output = toolOutputText(item);
    if (output.length > 0) return output;
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
