<script lang="ts">
  /**
   * A workflow's width and height as one pill: a picture's size is one decision,
   * so the common shapes are one click and the exact numbers sit under them.
   */
  import { PillMenu, PillOptionRow } from "@nib-ui/ui-contracts/svelte";
  import CornersOutIcon from "phosphor-svelte/lib/CornersOutIcon";
  import { type SizePair, sizeLabel, sizePresets, rangeHint } from "./parameter-pills";

  type Value = string | number | boolean | undefined;

  interface Props {
    pair: SizePair;
    width: Value;
    height: Value;
    onchange: (width: number | string, height: number | string) => void;
  }

  const { pair, width, height, onchange }: Props = $props();

  const INPUT_CLASS =
    "h-8 w-full rounded-md border border-line bg-input px-2 text-xs text-default placeholder:text-faint focus:border-line-strong focus:outline-none font-mono";

  let open = $state(false);

  const presets = $derived(sizePresets(pair));
  const range = $derived(rangeHint(pair.width));

  /** The value as text, for the inputs. */
  function asText(current: Value): string {
    if (current === undefined) return "";
    return String(current);
  }

  /** A number field's text as a number, or empty while it is being cleared. */
  function numberFrom(text: string): string | number {
    if (text.trim() === "") return "";
    return Number(text);
  }

  /** The current width or height as the number the inputs send back. */
  function current(value: Value): string | number {
    if (typeof value === "number") return value;
    return asText(value);
  }
</script>

<PillMenu bind:open icon={CornersOutIcon} label={sizeLabel(width, height)} title="Size in pixels">
  <ul class="flex flex-col gap-1">
    {#each presets as preset (preset.label)}
      <li>
        <PillOptionRow
          option={{
            value: preset.label,
            label: preset.label,
            hint: sizeLabel(preset.width, preset.height),
          }}
          selected={preset.width === width && preset.height === height}
          onpick={() => {
            open = false;
            onchange(preset.width, preset.height);
          }}
        />
      </li>
    {/each}
  </ul>

  <div class="flex flex-col gap-1.5 border-t border-line p-2">
    <div class="flex items-center gap-2">
      <input
        type="number"
        value={asText(width)}
        min={pair.width.min}
        max={pair.width.max}
        step="64"
        aria-label={pair.width.label}
        class={INPUT_CLASS}
        oninput={(event) => onchange(numberFrom(event.currentTarget.value), current(height))}
      />
      <span class="text-xs text-faint">×</span>
      <input
        type="number"
        value={asText(height)}
        min={pair.height.min}
        max={pair.height.max}
        step="64"
        aria-label={pair.height.label}
        class={INPUT_CLASS}
        oninput={(event) => onchange(current(width), numberFrom(event.currentTarget.value))}
      />
    </div>
    {#if range}
      <span class="text-2xs text-faint">{range} pixels</span>
    {/if}
  </div>
</PillMenu>
