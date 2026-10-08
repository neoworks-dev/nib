<script lang="ts">
  import { effortLabel } from "@nib-ui/ui-contracts";
  import {
    harnessIcon,
    PillMenu,
    type PillOption,
    PillOptionRow,
  } from "@nib-ui/ui-contracts/svelte";

  /**
   * Harness, model and effort as one pill. The model list and the effort levels
   * both belong to the harness, so they are picked in that order from one menu,
   * and the pill reads as the one thing they add up to: who runs the work, and how.
   */
  const {
    harnesses,
    harnessId,
    models,
    model,
    effortLevels,
    effort,
    onHarness,
    onModel,
    onEffort,
  }: {
    /** Offered only when there is more than one to choose between. */
    harnesses: PillOption[];
    harnessId: string | null;
    models: PillOption[];
    model: string | null;
    effortLevels: string[];
    effort: string | null;
    onHarness: (harnessId: string) => void;
    onModel: (model: string) => void;
    onEffort: (effort: string) => void;
  } = $props();

  let open = $state(false);

  const harness = $derived(harnesses.find((option) => option.value === harnessId));
  const selectedModel = $derived(models.find((option) => option.value === model));

  /** Model and effort when they are known; the harness's name until a model is. */
  function pillLabel(): string {
    const parts: string[] = [];
    if (selectedModel) parts.push(selectedModel.short ?? selectedModel.label);
    else parts.push(harness?.label ?? "Agent");
    if (effort) parts.push(effortLabel(effort));
    return parts.join(" · ");
  }

  /** The pill leaves the harness to its icon; the tooltip names all three. */
  function pillTitle(): string {
    const parts: string[] = [];
    if (harness) parts.push(harness.label);
    if (selectedModel) parts.push(selectedModel.label);
    if (effort) parts.push(`${effortLabel(effort)} effort`);
    return parts.join(" · ");
  }

  /** A new harness changes what the rest of the menu offers, so the menu closes on it. */
  function pickHarness(option: PillOption): void {
    if (option.disabled) return;
    open = false;
    if (option.value !== harnessId) onHarness(option.value);
  }

  function pickModel(option: PillOption): void {
    if (option.disabled) return;
    open = false;
    if (option.value !== model) onModel(option.value);
  }

  /** Effort stays open: it is a toggle row, and the change shows in place. */
  function pickEffort(level: string): void {
    if (level !== effort) onEffort(level);
  }
</script>

<PillMenu
  bind:open
  icon={harnessIcon(harnessId ?? "")}
  iconTone="muted"
  label={pillLabel()}
  title={pillTitle()}
  wide
>
  {#if harnesses.length > 1}
    {@render heading("Harness")}
    <ul class="flex flex-col gap-1">
      {#each harnesses as option (option.value)}
        <li>
          <PillOptionRow
            {option}
            selected={option.value === harnessId}
            onpick={() => pickHarness(option)}
          />
        </li>
      {/each}
    </ul>
  {/if}

  {#if models.length > 0}
    {@render heading("Model")}
    <ul class="flex max-h-56 flex-col gap-1 overflow-y-auto">
      {#each models as option (option.value)}
        <li>
          <PillOptionRow
            {option}
            selected={option.value === model}
            onpick={() => pickModel(option)}
          />
        </li>
      {/each}
    </ul>
  {/if}

  {#if effortLevels.length > 0}
    {@render heading("Effort")}
    <div class="flex flex-wrap gap-1 px-1 pb-1">
      {#each effortLevels as level (level)}
        <button
          type="button"
          aria-pressed={level === effort}
          class={[
            "rounded-full border px-1.5 py-0.5 text-2xs transition-colors duration-fast",
            {
              "border-line-strong bg-hover text-default": level === effort,
              "border-line text-muted hover:bg-hover": level !== effort,
            },
          ]}
          onclick={() => pickEffort(level)}
        >
          {effortLabel(level)}
        </button>
      {/each}
    </div>
  {/if}
</PillMenu>

{#snippet heading(text: string)}
  <div class="px-2 pt-1.5 pb-0.5 text-2xs text-faint first:pt-1">{text}</div>
{/snippet}
