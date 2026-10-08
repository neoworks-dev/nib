<script lang="ts">
  import type { IconComponent } from "@neoworks-dev/ui";
  import MagnifyingGlassIcon from "phosphor-svelte/lib/MagnifyingGlassIcon";
  import { fuzzyRank } from "../fuzzy";
  import type { PillOption } from "./pill";
  import PillMenu from "./PillMenu.svelte";
  import PillOptionRow from "./PillOptionRow.svelte";

  const {
    icon,
    value,
    options,
    actions = [],
    placeholder = "Select",
    searchPlaceholder = "Search",
    searchable = false,
    placement = "top",
    onChange,
  }: {
    icon?: IconComponent;
    value: string | null;
    options: PillOption[];
    /** Rows below the divider that trigger a flow instead of selecting a value. */
    actions?: PillOption[];
    placeholder?: string;
    searchPlaceholder?: string;
    searchable?: boolean;
    placement?: "top" | "bottom";
    onChange: (value: string) => void;
  } = $props();

  let open = $state(false);
  let query = $state("");
  let search = $state<HTMLInputElement>();

  const selected = $derived(options.find((option) => option.value === value));
  const visible = $derived(
    query.trim().length === 0
      ? options
      : fuzzyRank(options, query, (option) => `${option.label} ${option.hint ?? ""}`, 50).map(
          ({ item }) => item,
        ),
  );

  $effect(() => {
    if (!open) return;
    query = "";
    search?.focus();
  });

  /** The pill's own words: the picked option's short label when it has one. */
  function pillLabel(): string {
    if (!selected) return placeholder;
    return selected.short ?? selected.label;
  }

  /** Selects an option; picking the current one again only closes the menu. */
  function pick(option: PillOption): void {
    if (option.disabled) return;
    open = false;
    if (option.value !== value) onChange(option.value);
  }

  /** Runs an action row, which always reports even though it selects nothing. */
  function run(action: PillOption): void {
    if (action.disabled) return;
    open = false;
    onChange(action.value);
  }
</script>

<PillMenu
  bind:open
  icon={selected?.icon ?? icon}
  iconTone={selected?.icon ? "muted" : "faint"}
  label={pillLabel()}
  title={selected?.short ? selected.label : undefined}
  {placement}
>
  {#if searchable}
    <div class="flex items-center gap-2 rounded-md border border-line bg-surface px-2 py-1.5">
      <span class="text-faint"><MagnifyingGlassIcon size={14} /></span>
      <input
        bind:this={search}
        bind:value={query}
        type="text"
        placeholder={searchPlaceholder}
        onkeydown={(event) => {
          if (event.key === "Escape") open = false;
          if (event.key === "Enter" && visible[0]) pick(visible[0]);
        }}
        class="w-full bg-transparent text-xs text-default placeholder:text-faint focus:outline-none"
      />
    </div>
  {/if}

  <ul class="flex max-h-72 flex-col gap-1 overflow-y-auto">
    {#each visible as option (option.value)}
      <li>
        <PillOptionRow {option} selected={option.value === value} onpick={() => pick(option)} />
      </li>
    {/each}
    {#if visible.length === 0}
      <li class="px-2 py-1.5 text-2xs text-faint">Nothing to choose yet.</li>
    {/if}
  </ul>

  {#if actions.length > 0}
    <ul class="flex flex-col gap-1 border-t border-line pt-1">
      {#each actions as action (action.value)}
        {@const ActionIcon = action.icon}
        <li>
          <button
            type="button"
            disabled={action.disabled}
            class={[
              "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs",
              {
                "cursor-default text-faint": action.disabled,
                "text-muted hover:bg-hover": !action.disabled,
              },
            ]}
            onclick={() => run(action)}
          >
            {#if ActionIcon}
              <span class="shrink-0"><ActionIcon size={14} /></span>
            {/if}
            <span class="truncate">{action.label}</span>
          </button>
        </li>
      {/each}
    </ul>
  {/if}
</PillMenu>
