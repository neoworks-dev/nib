<script lang="ts">
  import CheckIcon from "phosphor-svelte/lib/CheckIcon";
  import type { PillOption } from "./pill";

  const {
    option,
    selected,
    onpick,
  }: {
    option: PillOption;
    selected: boolean;
    onpick: () => void;
  } = $props();

  const OptionIcon = $derived(option.icon);
  const tone = $derived(rowTone());

  /** A disabled row is faint, the picked one stands out, the rest light up on hover. */
  function rowTone(): string {
    if (option.disabled) return "cursor-default text-faint";
    if (selected) return "bg-hover text-default";
    return "text-muted hover:bg-hover";
  }
</script>

<button
  type="button"
  disabled={option.disabled}
  class={["flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs", tone]}
  onclick={onpick}
>
  {#if OptionIcon}
    <span class="shrink-0"><OptionIcon size={14} /></span>
  {/if}
  <span class="flex min-w-0 flex-col gap-0.5">
    <span class="truncate">{option.label}</span>
    {#if option.hint}
      <span class="truncate text-2xs text-faint">{option.hint}</span>
    {/if}
  </span>
  {#if option.disabled}
    <span class="ml-auto shrink-0 rounded-full bg-raised px-1.5 py-px text-2xs text-faint"
      >Soon</span
    >
  {:else if selected}
    <span class="ml-auto shrink-0 text-muted"><CheckIcon size={12} /></span>
  {/if}
</button>
