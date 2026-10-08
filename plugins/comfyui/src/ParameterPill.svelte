<script lang="ts">
  /**
   * One workflow parameter as a pill in the composer's row. Choices and pictures
   * are plain pickers, a toggle flips in place, and everything else opens a small
   * menu with the field in it, so the composer stays one line of pills under the
   * prompt however many parameters a workflow has.
   */
  import { Slider } from "@neoworks-dev/ui";
  import type { ComfyParameter } from "@nib-ui/ui-contracts";
  import { PillMenu, PillSelect } from "@nib-ui/ui-contracts/svelte";
  import CheckIcon from "phosphor-svelte/lib/CheckIcon";
  import { integerChoices, parameterPillLabel, rangeHint } from "./parameter-pills";

  interface Props {
    parameter: ComfyParameter;
    value: string | number | boolean | undefined;
    onchange: (value: string | number | boolean) => void;
    /** Vault images an image parameter can take. */
    imagePaths: string[];
  }

  const { parameter, value, onchange, imagePaths }: Props = $props();

  const INPUT_CLASS =
    "h-8 w-full rounded-md border border-line bg-input px-2 text-xs text-default placeholder:text-faint focus:border-line-strong focus:outline-none";

  const label = $derived(parameterPillLabel(parameter, value));
  const choices = $derived(integerChoices(parameter));
  const range = $derived(rangeHint(parameter));

  /** The value as text, for the inputs. */
  function asText(current: typeof value): string {
    if (current === undefined) return "";
    return String(current);
  }

  /** A number field's text as a number, or empty while it is being cleared. */
  function numberFrom(text: string): string | number {
    if (text.trim() === "") return "";
    return Number(text);
  }

  /** Where the slider sits: the value, else the default, else the bottom of the range. */
  function sliderValue(): number {
    if (typeof value === "number") return value;
    if (typeof parameter.default === "number") return parameter.default;
    return parameter.min ?? 0;
  }

  /** The step the slider moves in; a float parameter without one gets a hundredth of its range. */
  function sliderStep(): number {
    if (parameter.step !== undefined) return parameter.step;
    if (parameter.kind === "integer") return 1;
    const span = (parameter.max ?? 1) - (parameter.min ?? 0);
    return span / 100;
  }
</script>

{#if parameter.kind === "choice"}
  <PillSelect
    value={asText(value)}
    placeholder={parameter.label}
    options={(parameter.options ?? []).map((option) => ({
      value: option,
      label: option,
      short: `${parameter.label} ${option}`,
    }))}
    onChange={onchange}
  />
{:else if parameter.kind === "image"}
  <PillSelect
    value={asText(value)}
    placeholder={parameter.label}
    searchable
    searchPlaceholder="Search the vault's pictures"
    options={imagePaths.map((path) => ({
      value: path,
      label: path,
      short: parameterPillLabel(parameter, path),
    }))}
    onChange={onchange}
  />
{:else if parameter.kind === "boolean"}
  <button
    type="button"
    aria-pressed={value === true}
    title={parameter.description}
    class={[
      "flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs transition-colors duration-fast",
      {
        "border-line-strong text-default": value === true,
        "border-line text-muted hover:border-line-strong hover:text-default": value !== true,
      },
    ]}
    onclick={() => onchange(value !== true)}
  >
    {#if value === true}
      <CheckIcon size={12} />
    {/if}
    {label}
  </button>
{:else}
  <PillMenu {label} title={parameter.description}>
    <div class="flex flex-col gap-2 p-2" data-testid={`comfyui-parameter-${parameter.id}`}>
      <span class="text-xs text-default">{parameter.label}</span>
      {#if parameter.description}
        <span class="text-2xs text-faint">{parameter.description}</span>
      {/if}

      {#if parameter.kind === "text"}
        <textarea
          value={asText(value)}
          rows="4"
          aria-label={parameter.label}
          class="w-full resize-none rounded-md border border-line bg-input px-2 py-1.5 text-xs text-default placeholder:text-faint focus:border-line-strong focus:outline-none"
          oninput={(event) => onchange(event.currentTarget.value)}></textarea>
      {:else if parameter.kind === "seed"}
        {@render seedField()}
      {:else if choices}
        {@render choiceRow(choices)}
      {:else}
        {@render numberField()}
      {/if}
    </div>
  </PillMenu>
{/if}

{#snippet seedField()}
  <div class="flex items-center gap-2">
    <button
      type="button"
      aria-pressed={value === undefined || value === ""}
      class={[
        "shrink-0 rounded-full border px-2 py-1 text-2xs transition-colors duration-fast",
        {
          "border-line-strong bg-hover text-default": value === undefined || value === "",
          "border-line text-muted hover:bg-hover": value !== undefined && value !== "",
        },
      ]}
      onclick={() => onchange("")}
    >
      Random
    </button>
    <input
      type="number"
      value={asText(value)}
      step="1"
      placeholder="Fixed seed"
      aria-label="Fixed seed"
      class={`${INPUT_CLASS} font-mono`}
      oninput={(event) => onchange(numberFrom(event.currentTarget.value))}
    />
  </div>
{/snippet}

{#snippet choiceRow(values: number[])}
  <div class="flex flex-wrap gap-1">
    {#each values as choice (choice)}
      <button
        type="button"
        aria-pressed={value === choice}
        class={[
          "min-w-8 rounded-full border px-2 py-1 text-2xs transition-colors duration-fast",
          {
            "border-line-strong bg-hover text-default": value === choice,
            "border-line text-muted hover:bg-hover": value !== choice,
          },
        ]}
        onclick={() => onchange(choice)}
      >
        {choice}
      </button>
    {/each}
  </div>
{/snippet}

{#snippet numberField()}
  {#if parameter.min !== undefined && parameter.max !== undefined}
    <Slider
      value={sliderValue()}
      min={parameter.min}
      max={parameter.max}
      step={sliderStep()}
      label={parameter.label}
      oninput={onchange}
    />
  {/if}
  <input
    type="number"
    value={asText(value)}
    min={parameter.min}
    max={parameter.max}
    step={parameter.step ?? (parameter.kind === "number" ? "any" : 1)}
    placeholder={asText(parameter.default)}
    aria-label={parameter.label}
    class={`${INPUT_CLASS} font-mono`}
    oninput={(event) => onchange(numberFrom(event.currentTarget.value))}
  />
  {#if range}
    <span class="text-2xs text-faint">{range}</span>
  {/if}
{/snippet}
