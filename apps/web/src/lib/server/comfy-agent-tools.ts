/**
 * The ComfyUI tools an agent is handed: find nodes and models, use and extend
 * the workflow library, check a graph, run it and read what it made. They are
 * served beside the agent-control tools, bound to the calling session's project.
 */

import {
  describeNodes,
  installedModels,
  parseManifest,
  searchNodes,
  validateWorkflow,
} from "@nib-ui/comfy";
import {
  type AgentControlTool,
  comfyCancelRunInputSchema,
  comfyDeleteWorkflowInputSchema,
  comfyDescribeNodesInputSchema,
  comfyListModelsInputSchema,
  comfyListRunsInputSchema,
  comfyListWorkflowsInputSchema,
  comfyProposeInputSchema,
  comfyReadRunInputSchema,
  comfyReadWorkflowInputSchema,
  comfyRunInputSchema,
  comfySaveInputSchema,
  comfySearchNodesInputSchema,
  comfyToolNames,
  comfyValidateInputSchema,
} from "@nib-ui/protocol";
import type { ComfyLibraryEntry, ComfyParameter, ComfyRun } from "@nib-ui/ui-contracts";
import type { ComfyLibrary } from "./comfyui-library";
import type { ComfyUIService } from "./services";

/** Search results returned unless the agent asks for fewer or more. */
const DEFAULT_SEARCH_LIMIT = 25;
/** How long `comfy_run_workflow` waits for a run before handing back its id. */
const RUN_WAIT_MS = 15 * 60 * 1000;

export interface ComfyToolServices {
  comfyui: Pick<ComfyUIService, "nodeDefinitions" | "queue" | "cancel" | "runs" | "subscribe">;
  library: Pick<ComfyLibrary, "list" | "get" | "run" | "save" | "delete" | "openInEditor">;
}

/** A run as an agent reads it. */
interface RunReport {
  runId: string;
  /** The library workflow's name, or null for a graph of the agent's own. */
  label: string | null;
  status: ComfyRun["status"];
  /** Vault paths of the pictures it was given. */
  inputs: string[];
  /** The node executing, and its steps when it reports them. */
  node: string | null;
  progress: ComfyRun["progress"];
  /** Vault paths the outputs were written to. */
  outputs: string[];
  error: ComfyRun["error"];
  /** Set while the run is still going when the wait ran out. */
  note?: string;
}

/** The ComfyUI tools, working in the project `requireCwd` names. */
export function createComfyTools(
  services: ComfyToolServices,
  requireCwd: () => string,
): AgentControlTool[] {
  const { comfyui, library } = services;
  return [
    {
      name: comfyToolNames.searchNodes,
      description:
        "Search the node classes installed in ComfyUI by name, category or description. Returns " +
        "names, display names and categories; read a node's inputs and outputs with " +
        "comfy_describe_nodes.",
      inputSchema: comfySearchNodesInputSchema,
      handler: async (input) => {
        const { query, limit } = comfySearchNodesInputSchema.parse(input);
        let count = DEFAULT_SEARCH_LIMIT;
        if (limit !== undefined) count = limit;
        return { nodes: searchNodes(await comfyui.nodeDefinitions(false), query, count) };
      },
    },
    {
      name: comfyToolNames.describeNodes,
      description:
        "The inputs (name, type, whether it is a typed widget or a link, default, range, options) " +
        "and outputs (index, name, type) of node classes, for wiring them in API format: a link " +
        "is [sourceNodeId, outputIndex].",
      inputSchema: comfyDescribeNodesInputSchema,
      handler: async (input) => {
        const { names } = comfyDescribeNodesInputSchema.parse(input);
        return describeNodes(await comfyui.nodeDefinitions(false), names);
      },
    },
    {
      name: comfyToolNames.listModels,
      description:
        "The model files installed in ComfyUI, keyed by the loader input that takes them " +
        "(e.g. CheckpointLoaderSimple.ckpt_name). Use these exact names in that input; a name " +
        "not listed fails.",
      inputSchema: comfyListModelsInputSchema,
      handler: async (input) => {
        const { folder } = comfyListModelsInputSchema.parse(input);
        const models = installedModels(await comfyui.nodeDefinitions(false));
        if (folder === undefined) return { models };
        return { models: modelsMatching(models, folder) };
      },
    },
    {
      name: comfyToolNames.listWorkflows,
      description:
        "The workflow library: bundled, the person's own and this project's workflows, each with " +
        "its parameters and whether the connected ComfyUI can run it. Start here — running or " +
        "adapting one of these beats writing a graph from nothing. This project's workflows are " +
        "manifest files in .nib/.comfyui/workflows/<id>.json: edit or add one there and it is " +
        "listed and runnable at once.",
      inputSchema: comfyListWorkflowsInputSchema,
      handler: async (input) => {
        comfyListWorkflowsInputSchema.parse(input);
        const entries = await library.list(requireCwd());
        return { workflows: entries.map(summariseEntry) };
      },
    },
    {
      name: comfyToolNames.readWorkflow,
      description:
        "One library workflow in full: its API-format graph and its parameters, to run it or to " +
        "adapt it into a new one.",
      inputSchema: comfyReadWorkflowInputSchema,
      handler: async (input) => {
        const { source, id } = comfyReadWorkflowInputSchema.parse(input);
        const manifest = await library.get(source, id, requireCwd());
        if (!manifest)
          throw new Error(`no ${source} workflow ${id}; comfy_list_workflows lists them`);
        const { graph: _graph, ...withoutLayout } = manifest;
        return withoutLayout;
      },
    },
    {
      name: comfyToolNames.validate,
      description:
        "Check an API-format graph against the installed nodes without running it. Returns " +
        "{ valid, issues }; each issue names the node, the input, and what was expected versus " +
        "given (unknown node, missing input, bad link, type mismatch, value out of range, model " +
        "not installed). Fix every issue and validate again before running.",
      inputSchema: comfyValidateInputSchema,
      handler: async (input) => {
        const { workflow } = comfyValidateInputSchema.parse(input);
        const issues = validateWorkflow(workflow, await comfyui.nodeDefinitions(false));
        return { valid: issues.length === 0, issues };
      },
    },
    {
      name: comfyToolNames.run,
      description:
        "Run a workflow: either `library` (source, id and parameter values — an image parameter " +
        "takes a vault path) or a `workflow` graph of your own. The graph is validated first and " +
        "nothing runs if it is invalid. Waits for the run and returns { runId, status, outputs, " +
        "error }: outputs are vault paths, already on the board. With wait: false it returns at " +
        "once; comfy_read_run follows the run.",
      inputSchema: comfyRunInputSchema,
      handler: async (input) => {
        const { workflow, library: fromLibrary, wait } = comfyRunInputSchema.parse(input);
        const cwd = requireCwd();
        let run: ComfyRun;
        if (fromLibrary) {
          run = await library.run({
            cwd,
            source: fromLibrary.source,
            workflowId: fromLibrary.id,
            values: fromLibrary.values,
          });
        } else if (workflow) {
          const issues = validateWorkflow(workflow, await comfyui.nodeDefinitions(false));
          if (issues.length > 0) return { valid: false, issues };
          run = await comfyui.queue({ cwd, workflow });
        } else {
          throw new Error("pass either `library` or `workflow`");
        }
        if (wait === false) return report(run);
        return report(await waitForRun(comfyui, run.id, RUN_WAIT_MS));
      },
    },
    {
      name: comfyToolNames.readRun,
      description:
        "A run's status, outputs (vault paths) and error, from comfy_run_workflow's runId. With " +
        "wait: true it waits for the run to finish.",
      inputSchema: comfyReadRunInputSchema,
      handler: async (input) => {
        const { runId, wait } = comfyReadRunInputSchema.parse(input);
        const run = comfyui.runs().find((candidate) => candidate.id === runId);
        if (!run) throw new Error(`no run ${runId}`);
        if (wait !== true) return report(run);
        return report(await waitForRun(comfyui, runId, RUN_WAIT_MS));
      },
    },
    {
      name: comfyToolNames.listRuns,
      description:
        "This project's runs, newest first: what is queued, running (with the node and its steps) " +
        "and finished (with output vault paths or the error). Includes runs the person started " +
        "from the Workflows pane.",
      inputSchema: comfyListRunsInputSchema,
      handler: (input) => {
        const { status } = comfyListRunsInputSchema.parse(input);
        const cwd = requireCwd();
        const runs = comfyui.runs().filter((run) => run.cwd === cwd && matchesStatus(run, status));
        return Promise.resolve({ runs: runs.map(report) });
      },
    },
    {
      name: comfyToolNames.cancelRun,
      description:
        "Stop a run: a queued one is taken off the queue, a running one is interrupted. Returns " +
        "the run as it stands; a running one reads cancelled once ComfyUI confirms.",
      inputSchema: comfyCancelRunInputSchema,
      handler: async (input) => {
        const { runId } = comfyCancelRunInputSchema.parse(input);
        const run = projectRun(comfyui, runId, requireCwd());
        await comfyui.cancel(run.id);
        return report(projectRun(comfyui, runId, run.cwd));
      },
    },
    {
      name: comfyToolNames.propose,
      description:
        "Open a workflow in nib's node editor for the person to review, change and save into the " +
        "library. Use this for a workflow you built for reuse; it saves nothing by itself.",
      inputSchema: comfyProposeInputSchema,
      handler: (input) => {
        const { manifest } = comfyProposeInputSchema.parse(input);
        const parsed = parseManifest(manifest);
        if (!parsed.ok) throw new Error(parsed.error);
        library.openInEditor({ source: "draft", manifest: parsed.manifest, cwd: requireCwd() });
        return Promise.resolve({ opened: true });
      },
    },
    {
      name: comfyToolNames.save,
      description:
        "Save a workflow into the library so it can be run again from the Workflows pane: into " +
        "this project (default) or the person's own library. Expose the inputs worth changing " +
        "(image, prompt, strength, seed, …) as parameters. Replaces a saved workflow with the " +
        "same id. Validate it first.",
      inputSchema: comfySaveInputSchema,
      handler: async (input) => {
        const { manifest, scope } = comfySaveInputSchema.parse(input);
        let source: "project" | "user" = "project";
        if (scope === "user") source = "user";
        const entry = await library.save({ source, cwd: requireCwd(), manifest });
        return summariseEntry(entry);
      },
    },
    {
      name: comfyToolNames.deleteWorkflow,
      description:
        "Delete a saved workflow: a project one goes to the vault's bin, where the person can " +
        "restore it; one from the person's own library is removed. Bundled workflows cannot be " +
        "deleted.",
      inputSchema: comfyDeleteWorkflowInputSchema,
      handler: async (input) => {
        const { source, id } = comfyDeleteWorkflowInputSchema.parse(input);
        const cwd = requireCwd();
        if (!(await library.get(source, id, cwd))) {
          throw new Error(`no ${source} workflow ${id}; comfy_list_workflows lists them`);
        }
        await library.delete(source, id, cwd);
        return { deleted: true };
      },
    },
  ];
}

/** Whether a run is in the group `comfy_list_runs` was asked for. */
function matchesStatus(run: ComfyRun, status: "active" | "finished" | "all" | undefined): boolean {
  if (status === "active") return !isFinished(run);
  if (status === "finished") return isFinished(run);
  return true;
}

/** A run of this project by id; another project's runs are not the agent's to see. */
function projectRun(comfyui: ComfyToolServices["comfyui"], runId: string, cwd: string): ComfyRun {
  const run = comfyui.runs().find((candidate) => candidate.id === runId);
  if (!run || run.cwd !== cwd) throw new Error(`no run ${runId}; comfy_list_runs lists them`);
  return run;
}

/** A library workflow as an agent chooses among them: no graph, no parameter targets. */
interface WorkflowSummary {
  source: ComfyLibraryEntry["source"];
  id: string;
  name: string;
  description: string;
  category: string;
  parameters: Omit<ComfyParameter, "targets">[];
  availability: ComfyLibraryEntry["availability"];
}

/** A library entry without its graph, which the model does not need to choose. */
function summariseEntry(entry: ComfyLibraryEntry): WorkflowSummary {
  const { manifest, source, availability } = entry;
  return {
    source,
    id: manifest.id,
    name: manifest.name,
    description: manifest.description,
    category: manifest.category,
    parameters: manifest.parameters.map(({ targets: _targets, ...parameter }) => parameter),
    availability,
  };
}

/** What a run looks like to an agent. */
function report(run: ComfyRun): RunReport {
  const result: RunReport = {
    runId: run.id,
    label: run.label,
    status: run.status,
    inputs: run.inputs,
    node: run.nodeType,
    progress: run.progress,
    outputs: run.outputs,
    error: run.error,
  };
  if (!isFinished(run)) result.note = "still running; comfy_read_run with wait: true follows it";
  return result;
}

/** Whether a run has stopped. */
function isFinished(run: ComfyRun): boolean {
  return run.status === "succeeded" || run.status === "failed" || run.status === "cancelled";
}

/** The run once it finishes, or as it stands when `timeoutMs` runs out. */
export function waitForRun(
  comfyui: ComfyToolServices["comfyui"],
  runId: string,
  timeoutMs: number,
): Promise<ComfyRun> {
  const current = comfyui.runs().find((run) => run.id === runId);
  if (current && isFinished(current)) return Promise.resolve(current);
  return new Promise((resolve, reject) => {
    let latest = current;
    const timer = setTimeout(() => {
      unsubscribe();
      if (latest) resolve(latest);
      else reject(new Error(`run ${runId} is unknown`));
    }, timeoutMs);
    const unsubscribe = comfyui.subscribe((run) => {
      if (run.id !== runId) return;
      latest = run;
      if (!isFinished(run)) return;
      clearTimeout(timer);
      unsubscribe();
      resolve(run);
    });
  });
}

/** The loader inputs whose key mentions `filter`, e.g. `lora` or `upscale`. */
function modelsMatching(
  models: Record<string, string[]>,
  filter: string,
): Record<string, string[]> {
  const matching: Record<string, string[]> = {};
  const needle = filter.toLowerCase();
  for (const [key, files] of Object.entries(models)) {
    if (key.toLowerCase().includes(needle)) matching[key] = files;
  }
  return matching;
}
