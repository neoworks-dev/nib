<script lang="ts">
  /**
   * The workflow library: pick a workflow, fill in its parameters, run it. The
   * outputs land in the vault's `comfyui/` folder, so they reach the board the
   * way any file does; this pane only shows the run's progress.
   *
   * Opened with `image` (a vault path) from a card's menu, it lists only the
   * workflows that take a picture and fills it in.
   */
  import { Button, ListRow, StatusBadge } from "@neoworks-dev/ui";
  import type { ComfyLibraryEntry, ComfyWorkflowManifest, PaneProps } from "@nib-ui/ui-contracts";
  import ArrowLeftIcon from "phosphor-svelte/lib/ArrowLeftIcon";
  import FlowArrowIcon from "phosphor-svelte/lib/FlowArrowIcon";
  import PlayIcon from "phosphor-svelte/lib/PlayIcon";
  import {
    describeAvailability,
    entryKey,
    errorMessage,
    filterEntries,
    type FormValues,
    groupByCategory,
    initialValues,
    missingRequired,
    valuesToSend,
  } from "./form";
  import ParameterField from "./ParameterField.svelte";
  import { describeRun, isActive } from "./runs";
  import { comfyPluginState } from "./store.svelte";

  const { params }: PaneProps = $props();

  const IMAGE_FILE = /\.(png|jpe?g|webp|gif|bmp)$/i;

  const store = $derived(comfyPluginState.store);
  const host = $derived(comfyPluginState.host);
  const imagePath = $derived(typeof params?.image === "string" ? params.image : null);
  const cwd = $derived(host?.cwd() ?? "");

  let entries = $state<ComfyLibraryEntry[]>([]);
  let loadError = $state<string | null>(null);
  let query = $state("");
  let selectedKey = $state<string | null>(null);
  let values = $state<FormValues>({});
  let imagePaths = $state<string[]>([]);
  let runId = $state<string | null>(null);
  let runError = $state<string | null>(null);
  let starting = $state(false);

  const visible = $derived(filterEntries(entries, query, imagePath !== null));
  const groups = $derived(groupByCategory(visible));
  const selected = $derived(entries.find((entry) => entryKey(entry) === selectedKey) ?? null);
  const run = $derived(store?.runs.find((candidate) => candidate.id === runId) ?? null);
  const unavailable = $derived(describeAvailability(selected?.availability ?? null));
  const missing = $derived(selected ? missingRequired(selected.manifest, values) : []);

  $effect(() => {
    void load(cwd);
  });

  $effect(() => {
    void loadImages(cwd);
  });

  // The pane is reused for the next picture a card's menu sends it; that starts over at the list.
  $effect(() => {
    void imagePath;
    selectedKey = null;
  });

  /** Reads the library, with the open project's workflows, and opens the one the pane was asked for. */
  async function load(project: string): Promise<void> {
    if (!store) return;
    try {
      entries = await store.library(project.length > 0 ? project : null);
      loadError = null;
    } catch (cause) {
      loadError = errorMessage(cause);
      return;
    }
    const wanted = entries.find((entry) => entryKey(entry) === params?.workflow);
    if (wanted && selectedKey === null) choose(wanted);
  }

  /** The vault's pictures, which image parameters choose from. */
  async function loadImages(project: string): Promise<void> {
    if (!host || project.length === 0) return;
    const vault = await host.transport.loadVault(project, { previewChars: 0 });
    imagePaths = vault.items.map((item) => item.path).filter((path) => IMAGE_FILE.test(path));
  }

  /**
   * Returns to the list, read again: a workflow saved from the editor or by an
   * agent since the pane opened shows up there.
   */
  function back(): void {
    selectedKey = null;
    void load(cwd);
  }

  /** Opens a workflow's form, starting from its defaults and the picture it was opened for. */
  function choose(entry: ComfyLibraryEntry): void {
    selectedKey = entryKey(entry);
    values = initialValues(entry.manifest, imagePath);
    runId = null;
    runError = null;
  }

  /** Queues the selected workflow with the form's values. */
  async function start(): Promise<void> {
    if (!store || !selected || cwd.length === 0) return;
    starting = true;
    runError = null;
    try {
      const queued = await store.runWorkflow({
        cwd,
        source: selected.source,
        workflowId: selected.manifest.id,
        values: valuesToSend(values),
      });
      runId = queued.id;
    } catch (cause) {
      runError = errorMessage(cause);
    } finally {
      starting = false;
    }
  }

  /** Shows the workflow's graph in the node editor. */
  function openInEditor(entry: ComfyLibraryEntry): void {
    store?.openInEditor({ source: entry.source, manifest: entry.manifest, cwd: cwd || null });
  }

  /** Deletes a user or project workflow and returns to the list. */
  async function remove(entry: ComfyLibraryEntry): Promise<void> {
    if (!store || entry.source === "bundled") return;
    await store.deleteWorkflow(entry.source, entry.manifest.id, cwd || null);
    selectedKey = null;
    await load(cwd);
  }

  /** The value of one field. */
  function setValue(id: string, value: string | number | boolean): void {
    values = { ...values, [id]: value };
  }

  /** A subtitle for a list row: why it cannot run, or what it does. */
  function subtitle(entry: ComfyLibraryEntry): string {
    return describeAvailability(entry.availability) ?? entry.manifest.description;
  }

  /** The label on the source badge. */
  function sourceLabel(
    manifest: ComfyWorkflowManifest,
    source: ComfyLibraryEntry["source"],
  ): string {
    if (source === "bundled") return manifest.category;
    return source;
  }
</script>

<div class="flex h-full min-h-0 flex-col" data-testid="comfyui-workflows">
  <header class="flex items-center gap-2 border-b border-line px-4 py-3">
    {#if selected}
      <Button size="sm" variant="ghost" icon={ArrowLeftIcon} onclick={back}>Back</Button>
      <h2 class="truncate text-sm font-semibold">{selected.manifest.name}</h2>
    {:else}
      <FlowArrowIcon size={16} />
      <h2 class="text-sm font-semibold">Workflows</h2>
      {#if imagePath}
        <span class="truncate text-xs text-dim">for {imagePath}</span>
      {/if}
    {/if}
  </header>

  {#if !selected}
    <div class="border-b border-line p-2">
      <input
        bind:value={query}
        type="search"
        placeholder="Search workflows"
        class="h-8 w-full rounded-md border border-line bg-input px-2 text-xs text-default placeholder:text-faint focus:border-line-strong focus:outline-none"
      />
    </div>
    <div class="min-h-0 flex-1 overflow-y-auto p-2 text-xs">
      {#if loadError}
        <p class="p-2 text-red">{loadError}</p>
      {/if}
      {#each groups as group (group.category)}
        <p class="px-2 pt-2 pb-1 text-2xs tracking-caps uppercase text-dim">{group.category}</p>
        {#each group.entries as entry (entryKey(entry))}
          <ListRow
            title={entry.manifest.name}
            subtitle={subtitle(entry)}
            onclick={() => choose(entry)}
            chevron
          >
            {#snippet trailing()}
              {#if entry.availability && !entry.availability.available}
                <StatusBadge tone="red">unavailable</StatusBadge>
              {:else if entry.source !== "bundled"}
                <StatusBadge>{sourceLabel(entry.manifest, entry.source)}</StatusBadge>
              {/if}
            {/snippet}
          </ListRow>
        {/each}
      {:else}
        <p class="p-2 text-dim">No workflow matches.</p>
      {/each}
    </div>
  {:else}
    <div
      class="min-h-0 flex-1 space-y-3 overflow-y-auto p-4 text-xs"
      data-testid="comfyui-workflow-form"
    >
      <p class="text-dim">{selected.manifest.description}</p>
      {#if unavailable}
        <p class="rounded-md border border-line p-2 text-red">{unavailable}</p>
      {/if}

      {#each selected.manifest.parameters as parameter (parameter.id)}
        <ParameterField
          {parameter}
          value={values[parameter.id]}
          onchange={(value) => setValue(parameter.id, value)}
          {imagePaths}
          imageUrl={(path) => host?.transport.vaultFileUrl(cwd, path) ?? ""}
        />
      {/each}

      <div class="flex flex-wrap items-center gap-2 pt-1">
        <Button
          size="sm"
          variant="primary"
          icon={PlayIcon}
          disabled={starting ||
            unavailable !== null ||
            missing.length > 0 ||
            cwd.length === 0 ||
            (run !== null && isActive(run))}
          onclick={start}
        >
          Run
        </Button>
        {#if run && isActive(run)}
          <Button size="sm" variant="ghost" onclick={() => store?.cancel(run.id)}>Cancel</Button>
        {/if}
        <Button size="sm" variant="ghost" onclick={() => openInEditor(selected)}
          >Open in editor</Button
        >
        {#if selected.source !== "bundled"}
          <Button size="sm" variant="ghost" onclick={() => remove(selected)}>Delete</Button>
        {/if}
      </div>
      {#if missing.length > 0}
        <p class="text-dim">Needs {missing.map((parameter) => parameter.label).join(", ")}.</p>
      {/if}
      {#if runError}
        <p class="text-red" data-testid="comfyui-run-error">{runError}</p>
      {/if}
      {#if run}
        <p class="text-dim" data-testid="comfyui-run-status">{describeRun(run)}</p>
      {/if}
    </div>
  {/if}
</div>
