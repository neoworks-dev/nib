import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { bundledWorkflows } from "@nib-ui/comfy";
import type {
  ComfyNodeDefinitions,
  ComfyQueueInput,
  ComfyRun,
  ComfyWorkflowManifest,
} from "@nib-ui/ui-contracts";
import { ComfyLibrary, ComfyWorkflowError } from "../src/lib/server/comfyui-library";
import { writeVaultFile, writeVaultText } from "../src/lib/server/vault-write";

const DEFINITIONS_FILE = join(
  import.meta.dir,
  "../../../packages/comfy/tests/fixtures/object_info.json",
);

let root: string;
let project: string;
let userDirectory: string;
let definitions: ComfyNodeDefinitions | null;
let queued: ComfyQueueInput[];
let trashed: string[];

/** A library over temporary directories and a ComfyUI that records what it is sent. */
function library(): ComfyLibrary {
  return new ComfyLibrary({
    comfyui: {
      nodeDefinitions: () => {
        if (!definitions) return Promise.reject(new Error("ComfyUI is not reachable"));
        return Promise.resolve(definitions);
      },
      queue: (input): Promise<ComfyRun> => {
        queued.push(input);
        return Promise.resolve({
          id: "run-1",
          cwd: input.cwd,
          label: null,
          inputs: [],
          slot: null,
          status: "queued",
          queuedAt: 1,
          finishedAt: null,
          nodeId: null,
          nodeType: null,
          progress: null,
          outputs: [],
          error: null,
        });
      },
    },
    vault: {
      write: writeVaultFile,
      writeText: writeVaultText,
      trash: (_cwd, path) => {
        trashed.push(path);
        return Promise.resolve({ id: "t", path, name: path, kind: "file", deletedAt: 0 });
      },
    },
    userDirectory,
  });
}

/** The value, or a failed test when it is missing. */
function must<T>(value: T | null | undefined): T {
  if (value === null || value === undefined) throw new Error("expected a value");
  return value;
}

/** A user workflow: the bundled upscale under another id. */
function userManifest(): ComfyWorkflowManifest {
  const upscale = must(bundledWorkflows().find((manifest) => manifest.id === "upscale"));
  return { ...structuredClone(upscale), id: "my-upscale", name: "My upscale" };
}

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "nib-comfy-library-"));
  project = join(root, "project");
  userDirectory = join(root, "config", "comfyui-workflows");
  await mkdir(join(project, ".nib"), { recursive: true });
  definitions = JSON.parse(await readFile(DEFINITIONS_FILE, "utf8"));
  queued = [];
  trashed = [];
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe("ComfyLibrary", () => {
  it("lists bundled workflows as available against the server's nodes", async () => {
    const entries = await library().list(null);
    expect(entries.map((entry) => `${entry.source}:${entry.manifest.id}`)).toContain(
      "bundled:image-to-3d",
    );
    expect(entries.every((entry) => entry.availability?.available === true)).toBe(true);
  });

  it("marks a workflow whose model is missing, and says nothing while ComfyUI is down", async () => {
    const manifest = userManifest();
    must(manifest.workflow["2"]).inputs.model_name = "RealESRGAN_x4plus.pth";
    await library().save({ source: "user", manifest });
    const mine = (await library().list(null)).find((entry) => entry.manifest.id === "my-upscale");
    expect(mine?.availability?.missingValues.map((missing) => missing.value)).toEqual([
      "RealESRGAN_x4plus.pth",
    ]);

    definitions = null;
    const offline = await library().list(null);
    expect(offline.every((entry) => entry.availability === null)).toBe(true);
  });

  it("saves project workflows into the vault and replaces them in place", async () => {
    const manifest = userManifest();
    await library().save({ source: "project", cwd: project, manifest });
    await library().save({
      source: "project",
      cwd: project,
      manifest: { ...manifest, name: "Renamed" },
    });
    const file = join(project, ".nib", ".comfyui", "workflows", "my-upscale.json");
    expect(JSON.parse(await readFile(file, "utf8")).name).toBe("Renamed");
    const entries = await library().list(project);
    expect(
      entries.filter((entry) => entry.source === "project").map((entry) => entry.manifest.name),
    ).toEqual(["Renamed"]);
  });

  it("skips files in the workflow folder that are not manifests", async () => {
    await mkdir(join(project, ".nib", ".comfyui", "workflows"), { recursive: true });
    await writeFile(join(project, ".nib", ".comfyui", "workflows", "notes.json"), '{"hello": 1}');
    const entries = await library().list(project);
    expect(entries.some((entry) => entry.source === "project")).toBe(false);
  });

  it("lists and runs a workflow file written straight into .nib/.comfyui/workflows", async () => {
    const directory = join(project, ".nib", ".comfyui", "workflows");
    await mkdir(directory, { recursive: true });
    await writeFile(join(directory, "my-upscale.json"), JSON.stringify(userManifest()));

    const entries = await library().list(project);
    expect(
      entries.filter((entry) => entry.source === "project").map((entry) => entry.manifest.id),
    ).toEqual(["my-upscale"]);

    await library().run({
      cwd: project,
      source: "project",
      workflowId: "my-upscale",
      values: { image: "art/chest.png", scale: 1 },
    });
    expect(queued).toHaveLength(1);
  });

  it("runs a workflow with its parameters filled and the picture uploaded", async () => {
    const run = await library().run({
      cwd: project,
      source: "bundled",
      workflowId: "upscale",
      values: { image: "art/chest.png", scale: 1 },
    });
    expect(run.id).toBe("run-1");
    expect(queued).toHaveLength(1);
    expect(queued[0]?.uploads).toEqual([{ nodeId: "1", input: "image", path: "art/chest.png" }]);
    expect(queued[0]?.workflow["4"]?.inputs.scale_by).toBe(1);
  });

  it("refuses a run with bad values before anything is queued", async () => {
    const attempt = library().run({
      cwd: project,
      source: "bundled",
      workflowId: "upscale",
      values: { scale: 9 },
    });
    const error = await attempt.catch((cause: unknown) => cause);
    expect(error).toBeInstanceOf(ComfyWorkflowError);
    if (!(error instanceof ComfyWorkflowError)) return;
    expect(error.status).toBe(400);
    expect(error.issues.map((issue) => issue.message)).toEqual([
      "Image: a value is required",
      "Final size: above the maximum of 1",
    ]);
    expect(queued).toEqual([]);
  });

  it("deletes user workflows and bins project ones", async () => {
    await library().save({ source: "user", manifest: userManifest() });
    await library().delete("user", "my-upscale", null);
    expect((await library().list(null)).some((entry) => entry.source === "user")).toBe(false);
    await library().delete("project", "my-upscale", project);
    expect(trashed).toEqual([".comfyui/workflows/my-upscale.json"]);
  });

  it("passes editor requests to every subscriber", () => {
    const shelf = library();
    const seen: string[] = [];
    const stop = shelf.subscribeEditorRequests((request) => seen.push(request.source));
    shelf.openInEditor({ source: "draft", manifest: null, cwd: null });
    stop();
    shelf.openInEditor({ source: "draft", manifest: null, cwd: null });
    expect(seen).toEqual(["draft"]);
  });
});
