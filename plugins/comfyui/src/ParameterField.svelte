<script lang="ts">
  /**
   * One workflow parameter as a form field. The design system has no text or
   * number field, so those match the settings section's address input; choices
   * and images use its `Select`, toggles its `Checkbox`.
   */
  import { Checkbox, Select } from "@neoworks-dev/ui";
  import type { ComfyParameter } from "@nib-ui/ui-contracts";

  interface Props {
    parameter: ComfyParameter;
    value: string | number | boolean | undefined;
    onchange: (value: string | number | boolean) => void;
    /** Vault images an image parameter can take. */
    imagePaths: string[];
    /** Where a vault image is served, for the preview. */
    imageUrl: (path: string) => string;
  }

  const { parameter, value, onchange, imagePaths, imageUrl }: Props = $props();

  const INPUT_CLASS =
    "h-8 w-full rounded-md border border-line bg-input px-2 text-xs text-default placeholder:text-faint focus:border-line-strong focus:outline-none";

  const imageOptions = $derived(imagePaths.map((path) => ({ value: path, label: path })));
  const choiceOptions = $derived(
    (parameter.options ?? []).map((option) => ({ value: option, label: option })),
  );

  /** The value as text, for the text and number inputs. */
  function asText(current: typeof value): string {
    if (current === undefined) return "";
    return String(current);
  }

  /** A number field's text as a number, or empty while it is being cleared. */
  function numberFrom(text: string): string | number {
    if (text.trim() === "") return "";
    return Number(text);
  }

  /** Whether the query appears in the option's label. */
  function matches(option: { label: string }, query: string): boolean {
    return option.label.toLowerCase().includes(query.toLowerCase());
  }

  /** The placeholder of a number field: the default, or "random" for a seed. */
  function numberPlaceholder(): string {
    if (parameter.kind === "seed") return "random";
    if (parameter.default === undefined) return "";
    return String(parameter.default);
  }
</script>

<label class="block space-y-1" data-testid={`comfyui-parameter-${parameter.id}`}>
  <span class="flex items-baseline gap-2">
    <span class="text-2xs tracking-caps uppercase text-dim">{parameter.label}</span>
    {#if parameter.kind === "number" || parameter.kind === "integer"}
      {#if parameter.min !== undefined && parameter.max !== undefined}
        <span class="text-2xs text-faint">{parameter.min}–{parameter.max}</span>
      {/if}
    {/if}
  </span>

  {#if parameter.kind === "image"}
    <Select
      value={asText(value)}
      options={imageOptions}
      placeholder="Pick an image from the vault"
      filter={matches}
      onChange={(next) => {
        if (typeof next === "string") onchange(next);
      }}
    />
    {#if typeof value === "string" && value.length > 0}
      <img
        src={imageUrl(value)}
        alt={value}
        class="mt-1 max-h-40 rounded-md border border-line object-contain"
      />
    {/if}
  {:else if parameter.kind === "choice"}
    <Select
      value={asText(value)}
      options={choiceOptions}
      onChange={(next) => {
        if (typeof next === "string") onchange(next);
      }}
    />
  {:else if parameter.kind === "boolean"}
    <span class="flex items-center gap-2">
      <Checkbox
        checked={value === true}
        onchange={(event: Event & { currentTarget: HTMLInputElement }) =>
          onchange(event.currentTarget.checked)}
      />
    </span>
  {:else if parameter.kind === "text" && parameter.multiline}
    <textarea
      value={asText(value)}
      rows="3"
      class="w-full rounded-md border border-line bg-input px-2 py-1.5 text-xs text-default placeholder:text-faint focus:border-line-strong focus:outline-none"
      oninput={(event) => onchange(event.currentTarget.value)}></textarea>
  {:else if parameter.kind === "text"}
    <input
      type="text"
      value={asText(value)}
      class={INPUT_CLASS}
      oninput={(event) => onchange(event.currentTarget.value)}
    />
  {:else}
    <input
      type="number"
      value={asText(value)}
      min={parameter.min}
      max={parameter.max}
      step={parameter.step ?? (parameter.kind === "number" ? "any" : 1)}
      placeholder={numberPlaceholder()}
      class={`${INPUT_CLASS} font-mono`}
      oninput={(event) => onchange(numberFrom(event.currentTarget.value))}
    />
  {/if}

  {#if parameter.description}
    <span class="block text-2xs text-faint">{parameter.description}</span>
  {/if}
</label>
