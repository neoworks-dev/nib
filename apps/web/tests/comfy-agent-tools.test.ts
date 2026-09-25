import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { bundledWorkflows } from "@nib-ui/comfy";
import { type AgentControlTool, comfyToolNames } from "@nib-ui/protocol";
import type {
  ComfyEditorRequest,
  ComfyNodeDefinitions,
  ComfyQueueInput,
  ComfyRun,
  ComfyWorkflowManifest,
} from "@nib-ui/ui-contracts";
import { createComfyTools } from "../src/lib/server/comfy-agent-tools";
import { ComfyLibrary } from "../src/lib/server/comfyui-library";
import { writeVaultFile, writeVaultText } from "../src/lib/server/vault-write";

const DEFINITIONS_FILE = join(
  import.meta.dir,
  "../../../packages/comfy/tests/fixtures/object_info.json",
);

let root: string;
let project: string;
let definitions: ComfyNodeDefinitions;
let queued: ComfyQueueInput[];
let cancelled: string[];
let trashed: string[];
let runs: ComfyRun[];
let listeners: Set<(run: ComfyRun) => void>;
let editorRequests: ComfyEditorRequest[];
let tools: AgentControlTool[];

/** A run in the given state. */
function runState(id: string, status: ComfyRun["status"], outputs: string[] = []): ComfyRun {
  return {
    id,
    cwd: project,
    label: null,
    inputs: [],
    slot: null,
    status,
    queuedAt: 1,
    finishedAt: null,
    nodeId: null,
    nodeType: null,
    progress: null,
    outputs,
    error: null,
  };
}

/** Moves a run on, as the host does when ComfyUI reports. */
function advance(run: ComfyRun): void {
  runs = [run, ...runs.filter((existing) => existing.id !== run.id)];
  for (const listener of listeners) listener(run);
}

/** The value, or a failed test when it is missing. */
function must<T>(value: T | null | undefined): T {
  if (value === null || value === undefined) throw new Error("expected a value");
  return value;
}

/** A bundled workflow by id, copied so a test can change it. */
function bundled(id: string): ComfyWorkflowManifest {
  return structuredClone(must(bundledWorkflows().find((manifest) => manifest.id === id)));
}

/** Calls a tool by name. */
function call(name: string, input: unknown): Promise<unknown> {
  const tool = tools.find((candidate) => candidate.name === name);
  if (!tool) throw new Error(`no tool ${name}`);
  return tool.handler(input);
}

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "nib-comfy-tools-"));
  project = join(root, "project");
  await mkdir(join(project, ".nib"), { recursive: true });
  definitions = JSON.parse(await readFile(DEFINITIONS_FILE, "utf8"));
  queued = [];
  cancelled = [];
  trashed = [];
  runs = [];
  listeners = new Set();
  editorRequests = [];
  const comfyui = {
    nodeDefinitions: () => Promise.resolve(definitions),
    queue: (input: ComfyQueueInput) => {
      queued.push(input);
      const run = runState(`run-${queued.length}`, "queued");
      advance(run);
      return Promise.resolve(run);
    },
    cancel: (runId: string) => {
      cancelled.push(runId);
      return Promise.resolve();
    },
    runs: () => runs,
    subscribe: (listener: (run: ComfyRun) => void) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
  const library = new ComfyLibrary({
    comfyui,
    vault: {
      write: writeVaultFile,
      writeText: writeVaultText,
      trash: (_cwd, path) => {
        trashed.push(path);
        return Promise.resolve({ id: "t", path, name: path, kind: "file", deletedAt: 0 });
      },
    },
    userDirectory: join(root, "user-workflows"),
  });
  library.subscribeEditorRequests((request) => editorRequests.push(request));
  tools = createComfyTools({ comfyui, library }, () => project);
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe("the ComfyUI agent tools", () => {
  it("find nodes and read what they take", async () => {
    const found = (await call(comfyToolNames.searchNodes, { query: "upscale model" })) as {
      nodes: { name: string }[];
    };
    expect(found.nodes.map((node) => node.name)).toContain("ImageUpscaleWithModel");

    const described = (await call(comfyToolNames.describeNodes, {
      names: ["ImageUpscaleWithModel", "Nope"],
    })) as { nodes: { inputs: { name: string }[]; outputs: unknown[] }[]; unknown: string[] };
    expect(described.nodes[0]?.inputs.map((input) => input.name)).toEqual([
      "upscale_model",
      "image",
    ]);
    expect(described.nodes[0]?.outputs).toEqual([{ index: 0, name: "IMAGE", type: "IMAGE" }]);
    expect(described.unknown).toEqual(["Nope"]);
  });

  it("list installed models by folder", async () => {
    const all = (await call(comfyToolNames.listModels, {})) as { models: Record<string, string[]> };
    expect(all.models["CheckpointLoaderSimple.ckpt_name"]).toContain(
      "RealVisXL_V5.0_fp16.safetensors",
    );
    expect(await call(comfyToolNames.listModels, { folder: "upscale" })).toEqual({
      models: { "UpscaleModelLoader.model_name": ["4x-UltraSharp.pth"] },
    });
  });

  it("list the library without graphs and read one workflow", async () => {
    const listed = (await call(comfyToolNames.listWorkflows, {})) as {
      workflows: {
        id: string;
        parameters: Record<string, unknown>[];
        availability: { available: boolean };
      }[];
    };
    const upscale = listed.workflows.find((workflow) => workflow.id === "upscale");
    expect(upscale?.availability.available).toBe(true);
    expect(upscale?.parameters[0]).toEqual({ id: "image", label: "Image", kind: "image" });

    const read = (await call(comfyToolNames.readWorkflow, {
      source: "bundled",
      id: "upscale",
    })) as Record<string, unknown>;
    expect(Object.keys(read.workflow as object)).toEqual(["1", "2", "3", "4", "5"]);
  });

  it("report what is wrong with a graph, and run nothing invalid", async () => {
    const { workflow } = bundled("upscale");
    must(workflow["3"]).inputs.image = ["2", 0];
    const checked = (await call(comfyToolNames.validate, { workflow })) as {
      valid: boolean;
      issues: { code: string; nodeId: string; input: string; expected: string; actual: string }[];
    };
    expect(checked.valid).toBe(false);
    expect(checked.issues).toContainEqual(
      expect.objectContaining({
        code: "type_mismatch",
        nodeId: "3",
        input: "image",
        expected: "IMAGE",
        actual: "UPSCALE_MODEL",
      }),
    );
    const refused = (await call(comfyToolNames.run, { workflow })) as { valid: boolean };
    expect(refused.valid).toBe(false);
    expect(queued).toEqual([]);
  });

  it("run a library workflow and wait for what it wrote", async () => {
    const pending = call(comfyToolNames.run, {
      library: { source: "bundled", id: "upscale", values: { image: "art/chest.png" } },
    });
    await Bun.sleep(10);
    expect(queued[0]?.uploads).toEqual([{ nodeId: "1", input: "image", path: "art/chest.png" }]);
    advance(runState("run-1", "running"));
    advance(runState("run-1", "succeeded", ["comfyui/upscaled_00001_.png"]));
    expect(await pending).toEqual({
      runId: "run-1",
      label: null,
      status: "succeeded",
      inputs: [],
      node: null,
      progress: null,
      outputs: ["comfyui/upscaled_00001_.png"],
      error: null,
    });
    expect(await call(comfyToolNames.readRun, { runId: "run-1" })).toMatchObject({
      status: "succeeded",
    });
  });

  it("list this project's runs by status, and cancel one", async () => {
    advance({ ...runState("run-1", "succeeded", ["art/a_00001_.png"]), label: "Upscale" });
    advance({
      ...runState("run-2", "running"),
      nodeType: "KSampler",
      progress: { value: 3, max: 20 },
      inputs: ["art/sprite.png"],
    });
    advance({ ...runState("run-3", "queued"), cwd: "/another-project" });

    const active = (await call(comfyToolNames.listRuns, { status: "active" })) as {
      runs: Record<string, unknown>[];
    };
    expect(active.runs).toEqual([
      expect.objectContaining({
        runId: "run-2",
        node: "KSampler",
        progress: { value: 3, max: 20 },
        inputs: ["art/sprite.png"],
      }),
    ]);
    const all = (await call(comfyToolNames.listRuns, {})) as { runs: { runId: string }[] };
    expect(all.runs.map((run) => run.runId)).toEqual(["run-2", "run-1"]);

    await call(comfyToolNames.cancelRun, { runId: "run-2" });
    expect(cancelled).toEqual(["run-2"]);
    expect(call(comfyToolNames.cancelRun, { runId: "run-3" })).rejects.toThrow("no run run-3");
  });

  it("delete a saved workflow, and refuse one that is not there", async () => {
    const manifest = { ...bundled("upscale"), id: "sprite-upscale", name: "Sprite upscale" };
    await call(comfyToolNames.save, { manifest });
    expect(
      await call(comfyToolNames.deleteWorkflow, { source: "project", id: "sprite-upscale" }),
    ).toEqual({ deleted: true });
    expect(trashed).toEqual([".comfyui/workflows/sprite-upscale.json"]);
    expect(call(comfyToolNames.deleteWorkflow, { source: "user", id: "nope" })).rejects.toThrow(
      "no user workflow nope",
    );
  });

  it("propose a workflow in the editor, and save one into the project", async () => {
    const manifest = {
      ...bundled("upscale"),
      id: "sprite-upscale",
      name: "Sprite upscale",
    };
    expect(await call(comfyToolNames.propose, { manifest })).toEqual({ opened: true });
    expect(editorRequests.map((request) => `${request.source}:${request.manifest?.id}`)).toEqual([
      "draft:sprite-upscale",
    ]);

    const saved = (await call(comfyToolNames.save, { manifest })) as { source: string; id: string };
    expect(saved).toMatchObject({ source: "project", id: "sprite-upscale" });
    const file = JSON.parse(
      await readFile(join(project, ".nib", ".comfyui", "workflows", "sprite-upscale.json"), "utf8"),
    );
    expect(file.name).toBe("Sprite upscale");
  });
});
