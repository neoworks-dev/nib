<script lang="ts">
  /**
   * The node editor: a ComfyUI graph drawn and edited with litegraph, the engine
   * under ComfyUI's own frontend. It runs the graph as it stands, saves it into
   * the library with the inputs marked as parameters, and imports what ComfyUI
   * exports — JSON, or a PNG carrying its workflow.
   *
   * The toolbar and side panel are the app's; the canvas is litegraph's, themed
   * from the app's colours. `Button` comes from `@neoworks-dev/ui`; text fields
   * follow the settings section, since the design system has none.
   */
  import "@comfyorg/litegraph/style.css";
  import { Button, StatusBadge } from "@neoworks-dev/ui";
  import { apiToUi, type InputSpec, nodeSpec, uiToApi, validateWorkflow } from "@nib-ui/comfy";
  import type {
    ComfyNodeDefinitions,
    ComfyParameter,
    ComfyValidationIssue,
    ComfyWorkflowManifest,
    ComfyWorkflowSource,
    PaneProps,
  } from "@nib-ui/ui-contracts";
  import ArrowArcLeftIcon from "phosphor-svelte/lib/ArrowArcLeftIcon";
  import ArrowArcRightIcon from "phosphor-svelte/lib/ArrowArcRightIcon";
  import CornersOutIcon from "phosphor-svelte/lib/CornersOutIcon";
  import FloppyDiskIcon from "phosphor-svelte/lib/FloppyDiskIcon";
  import PlayIcon from "phosphor-svelte/lib/PlayIcon";
  import UploadSimpleIcon from "phosphor-svelte/lib/UploadSimpleIcon";
  import { onDestroy, onMount } from "svelte";
  import { errorMessage } from "../form";
  import { describeRun, isActive } from "../runs";
  import { comfyPluginState } from "../store.svelte";
  import {
    buildManifest,
    exposeInput,
    hideInput,
    isExposed,
    manifestFromImport,
    parameterKindFor,
    readImport,
    slugify,
  } from "./document";
  import { GraphEditor, type SelectedNode } from "./graph-editor";
  import { registerNodeTypes } from "./nodes";

  const { session: _session }: PaneProps = $props();

  const FIELD_CLASS =
    "h-8 w-full rounded-md border border-line bg-input px-2 text-xs text-default placeholder:text-faint focus:border-line-strong focus:outline-none";

  const store = $derived(comfyPluginState.store);
  const host = $derived(comfyPluginState.host);
  const cwd = $derived(host?.cwd() ?? "");

  let canvasElement = $state<HTMLCanvasElement | null>(null);
  let fileInput = $state<HTMLInputElement | null>(null);
  let editor: GraphEditor | null = null;
  let definitions: ComfyNodeDefinitions | null = null;
  let unregister: (() => void) | null = null;

  let name = $state("New workflow");
  let description = $state("");
  let category = $state("image");
  let workflowId = $state<string | null>(null);
  let source = $state<ComfyWorkflowSource | "draft">("draft");
  let parameters = $state<ComfyParameter[]>([]);
  let selected = $state<SelectedNode | null>(null);
  let issues = $state<ComfyValidationIssue[]>([]);
  let notice = $state<string | null>(null);
  let failure = $state<string | null>(null);
  let runId = $state<string | null>(null);
  let dirty = $state(false);
  let loadedSerial = -1;

  const run = $derived(store?.runs.find((candidate) => candidate.id === runId) ?? null);
  const selectedInputs = $derived(widgetInputs(selected));

  onMount(() => {
    if (!canvasElement) return;
    editor = new GraphEditor(
      canvasElement,
      () => (dirty = true),
      (node) => (selected = node),
    );
    void prepare();
  });

  onDestroy(() => {
    editor?.dispose();
    unregister?.();
  });

  // A request from the library, the board or an agent replaces what is open.
  $effect(() => {
    const request = comfyPluginState.editorRequest;
    if (!request || request.serial === loadedSerial || !definitions) return;
    loadedSerial = request.serial;
    open(request.manifest, request.source);
  });

  $effect(() => {
    if (run) editor?.showRun(run);
  });

  /** Registers the server's node types, then opens whatever was asked for. */
  async function prepare(): Promise<void> {
    if (!store) return;
    try {
      definitions = await store.nodeDefinitions();
    } catch (cause) {
      failure = `ComfyUI's nodes could not be read: ${errorMessage(cause)}`;
      return;
    }
    unregister = registerNodeTypes(definitions, () => editor?.recordChange());
    const request = comfyPluginState.editorRequest;
    if (request) {
      loadedSerial = request.serial;
      open(request.manifest, request.source);
    }
  }

  /** Shows a manifest's graph, or its workflow laid out when it was never drawn. */
  function open(manifest: ComfyWorkflowManifest | null, from: ComfyWorkflowSource | "draft"): void {
    if (!editor || !definitions) return;
    issues = [];
    failure = null;
    runId = null;
    source = from;
    if (!manifest) {
      name = "New workflow";
      description = "";
      category = "image";
      workflowId = null;
      parameters = [];
      editor.clear();
      dirty = false;
      return;
    }
    name = manifest.name;
    description = manifest.description;
    category = manifest.category;
    workflowId = manifest.id;
    parameters = manifest.parameters;
    if (manifest.graph) editor.load(manifest.graph);
    if (!manifest.graph) editor.load(apiToUi(manifest.workflow, definitions), true);
    dirty = false;
  }

  /** The graph as an API workflow, with what is wrong with it; null when it cannot be converted. */
  function currentWorkflow(): ReturnType<typeof uiToApi> | null {
    if (!editor || !definitions) return null;
    try {
      return uiToApi(editor.serialize(), definitions);
    } catch (cause) {
      failure = errorMessage(cause);
      return null;
    }
  }

  /** Queues the graph as it stands, after checking it the way ComfyUI will. */
  async function runGraph(): Promise<void> {
    if (!store || !editor || !definitions || cwd.length === 0) return;
    failure = null;
    editor.randomizeSeeds();
    const converted = currentWorkflow();
    if (!converted) return;
    issues = validateWorkflow(converted.workflow, definitions);
    editor.showIssues(issues);
    if (issues.length > 0) return;
    try {
      const queued = await store.queue({ cwd, workflow: converted.workflow });
      runId = queued.id;
    } catch (cause) {
      failure = errorMessage(cause);
    }
  }

  /** Saves into the project's workflows when a project is open, else into the user's. */
  async function save(): Promise<void> {
    if (!store || !editor) return;
    const converted = currentWorkflow();
    if (!converted) return;
    let id = workflowId;
    if (id === null || source === "bundled") id = slugify(name);
    const manifest = buildManifest(
      { id, name, description, category },
      parameters,
      converted.workflow,
      editor.serialize(),
    );
    const target = cwd.length > 0 ? "project" : "user";
    try {
      await store.saveWorkflow({ source: target, cwd: cwd || undefined, manifest });
      workflowId = id;
      source = target;
      parameters = manifest.parameters;
      dirty = false;
      notice =
        target === "project"
          ? `Saved to this project's workflows as ${id}`
          : `Saved to your workflows as ${id}`;
    } catch (cause) {
      failure = errorMessage(cause);
    }
  }

  /** Opens a JSON or PNG file from disk. */
  async function importFile(event: Event & { currentTarget: HTMLInputElement }): Promise<void> {
    const file = event.currentTarget.files?.[0];
    event.currentTarget.value = "";
    if (!file) return;
    const imported = readImport(new Uint8Array(await file.arrayBuffer()));
    if (imported.kind === "none") {
      failure = imported.reason;
      return;
    }
    open(manifestFromImport(imported, file.name), "draft");
  }

  /** The widget inputs of the selected node that can become parameters. */
  function widgetInputs(node: SelectedNode | null): InputSpec[] {
    if (!node || !definitions) return [];
    const spec = nodeSpec(definitions, node.type);
    if (!spec) return [];
    return spec.inputs.filter((input) => parameterKindFor(input) !== null);
  }

  /** Marks or unmarks a widget of the selected node as a parameter. */
  function toggleParameter(input: InputSpec): void {
    if (!selected || !editor) return;
    if (isExposed(parameters, selected.id, input.name)) {
      parameters = hideInput(parameters, selected.id, input.name);
    } else {
      parameters = exposeInput(
        parameters,
        selected.id,
        input,
        editor.widgetValue(selected.id, input.name),
      );
    }
    dirty = true;
  }

  /** Renames a parameter as the form will show it. */
  function relabel(id: string, label: string): void {
    parameters = parameters.map((parameter) =>
      parameter.id === id ? { ...parameter, label } : parameter,
    );
    dirty = true;
  }

  /** Keyboard undo and redo while the pane has focus. */
  function onKeydown(event: KeyboardEvent): void {
    const target = event.target;
    if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) return;
    if (!(event.ctrlKey || event.metaKey) || event.key.toLowerCase() !== "z") return;
    event.preventDefault();
    if (event.shiftKey) editor?.redo();
    else editor?.undo();
  }
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div class="flex h-full min-h-0 flex-col" data-testid="comfyui-editor" onkeydown={onKeydown}>
  <header class="flex flex-wrap items-center gap-2 border-b border-line px-3 py-2">
    <input bind:value={name} aria-label="Workflow name" class={`${FIELD_CLASS} w-48 flex-none`} />
    {#if dirty}
      <StatusBadge>unsaved</StatusBadge>
    {/if}
    <span class="ml-auto flex items-center gap-1">
      <Button size="sm" variant="ghost" icon={ArrowArcLeftIcon} onclick={() => editor?.undo()}
        >Undo</Button
      >
      <Button size="sm" variant="ghost" icon={ArrowArcRightIcon} onclick={() => editor?.redo()}
        >Redo</Button
      >
      <Button size="sm" variant="ghost" icon={CornersOutIcon} onclick={() => editor?.fit()}
        >Fit</Button
      >
      <Button size="sm" variant="ghost" icon={UploadSimpleIcon} onclick={() => fileInput?.click()}
        >Import</Button
      >
      <Button size="sm" icon={FloppyDiskIcon} onclick={save}>Save</Button>
      <Button
        size="sm"
        variant="primary"
        icon={PlayIcon}
        disabled={cwd.length === 0 || (run !== null && isActive(run))}
        onclick={runGraph}
      >
        Run
      </Button>
    </span>
    <input
      bind:this={fileInput}
      type="file"
      accept=".json,.png,application/json,image/png"
      class="hidden"
      onchange={importFile}
    />
  </header>

  <div class="flex min-h-0 flex-1">
    <div class="relative min-w-0 flex-1 overflow-hidden">
      <canvas bind:this={canvasElement} class="absolute inset-0" data-testid="comfyui-editor-canvas"
      ></canvas>
    </div>

    <aside class="w-64 flex-none space-y-4 overflow-y-auto border-l border-line p-3 text-xs">
      <section class="space-y-2">
        <p class="text-2xs tracking-caps uppercase text-dim">Workflow</p>
        <input
          bind:value={description}
          placeholder="What it does"
          aria-label="Description"
          class={FIELD_CLASS}
        />
        <input
          bind:value={category}
          placeholder="Category"
          aria-label="Category"
          class={FIELD_CLASS}
        />
      </section>

      <section class="space-y-2" data-testid="comfyui-editor-node">
        <p class="text-2xs tracking-caps uppercase text-dim">Selected node</p>
        {#if selected}
          <p class="font-medium">{selected.title} <span class="text-faint">#{selected.id}</span></p>
          {#each selectedInputs as input (input.name)}
            <label class="flex items-center justify-between gap-2">
              <span class="truncate">{input.name}</span>
              <Button size="sm" variant="ghost" onclick={() => toggleParameter(input)}>
                {selected && isExposed(parameters, selected.id, input.name) ? "Hide" : "Expose"}
              </Button>
            </label>
          {:else}
            <p class="text-dim">Nothing on this node can be a parameter.</p>
          {/each}
        {:else}
          <p class="text-dim">Select a node to expose its inputs as parameters.</p>
        {/if}
      </section>

      <section class="space-y-2" data-testid="comfyui-editor-parameters">
        <p class="text-2xs tracking-caps uppercase text-dim">Parameters</p>
        {#each parameters as parameter (parameter.id)}
          <div class="space-y-1">
            <input
              value={parameter.label}
              aria-label={`Label of ${parameter.id}`}
              class={FIELD_CLASS}
              oninput={(event) => relabel(parameter.id, event.currentTarget.value)}
            />
            <p class="text-2xs text-faint">
              {parameter.kind} · {parameter.targets
                .map((target) => `#${target.nodeId}.${target.input}`)
                .join(", ")}
            </p>
          </div>
        {:else}
          <p class="text-dim">
            None yet: a saved workflow runs from the library with its defaults.
          </p>
        {/each}
      </section>
    </aside>
  </div>

  {#if failure || issues.length > 0 || run || notice}
    <footer
      class="space-y-1 border-t border-line px-3 py-2 text-xs"
      data-testid="comfyui-editor-status"
    >
      {#if failure}
        <p class="text-red">{failure}</p>
      {/if}
      {#each issues.slice(0, 5) as issue, index (index)}
        <p class="text-red">
          {issue.nodeType ?? "workflow"}
          {issue.nodeId ? `#${issue.nodeId}` : ""}: {issue.message}
        </p>
      {/each}
      {#if issues.length > 5}
        <p class="text-dim">and {issues.length - 5} more</p>
      {/if}
      {#if run}
        <p class="text-dim">{describeRun(run)}</p>
      {/if}
      {#if notice && !failure}
        <p class="text-dim">{notice}</p>
      {/if}
    </footer>
  {/if}
</div>
