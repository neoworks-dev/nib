/**
 * The workflow library: what nib ships, what the user saved, and what a project
 * keeps in `.nib/.comfyui/workflows`. All three are the same manifest file; they
 * differ only in where the file lives and who may change it. The library reads
 * the directories on every call, so a file an agent writes there is listed and
 * runnable straight away.
 */

import { mkdir, readdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import {
  applyParameters,
  bundledWorkflows,
  inputKey,
  parseManifest,
  validateWorkflow,
  WORKFLOW_ID,
  workflowAvailability,
} from "@nib-ui/comfy";
import type {
  ComfyEditorRequest,
  ComfyLibraryEntry,
  ComfyNodeDefinitions,
  ComfyRun,
  ComfyRunWorkflowInput,
  ComfySaveWorkflowInput,
  ComfyValidationIssue,
  ComfyWorkflowManifest,
  ComfyWorkflowSource,
} from "@nib-ui/ui-contracts";
import type { Disposer } from "@nib-ui/kernel";
import { COMFYUI_DIRECTORY, VAULT_DIRECTORY } from "@nib-ui/vault";
import type { ComfyUIService, VaultService } from "./services";
import { userConfigPath } from "./user-config";

/** The vault directory project workflows live in, out of the scan's sight. */
export const PROJECT_WORKFLOW_DIRECTORY = `${COMFYUI_DIRECTORY}/workflows`;

/** A workflow that cannot be run or saved as asked, with the issues that say why. */
export class ComfyWorkflowError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly issues: ComfyValidationIssue[] = [],
  ) {
    super(message);
  }
}

/** The user's own workflows, next to the user config. */
export function userWorkflowDirectory(): string {
  return join(dirname(userConfigPath()), "comfyui-workflows");
}

export interface ComfyLibraryOptions {
  comfyui: Pick<ComfyUIService, "nodeDefinitions" | "queue">;
  vault: Pick<VaultService, "write" | "writeText" | "trash">;
  userDirectory: string;
}

/** What the library adds to the ComfyUI service; the routes and agent tools reach it through this. */
export class ComfyLibrary {
  private readonly editorListeners = new Set<(request: ComfyEditorRequest) => void>();

  constructor(private readonly options: ComfyLibraryOptions) {}

  /** Every workflow, with availability when ComfyUI answers; bundled first, then the user's, then the project's. */
  async list(cwd: string | null): Promise<ComfyLibraryEntry[]> {
    const definitions = await this.definitionsOrNull();
    const entries: ComfyLibraryEntry[] = [];
    const add = (source: ComfyWorkflowSource, manifest: ComfyWorkflowManifest): void => {
      entries.push({ source, manifest, availability: availabilityOf(manifest, definitions) });
    };
    for (const manifest of bundledWorkflows()) add("bundled", manifest);
    for (const manifest of await readManifests(this.options.userDirectory)) add("user", manifest);
    if (cwd !== null) {
      for (const manifest of await readManifests(projectDirectory(cwd))) add("project", manifest);
    }
    return entries;
  }

  /** One workflow by source and id, or null. */
  async get(
    source: ComfyWorkflowSource,
    id: string,
    cwd: string | null,
  ): Promise<ComfyWorkflowManifest | null> {
    if (source === "bundled") {
      return bundledWorkflows().find((manifest) => manifest.id === id) ?? null;
    }
    const directory = this.directoryFor(source, cwd);
    const manifests = await readManifests(directory);
    return manifests.find((manifest) => manifest.id === id) ?? null;
  }

  /**
   * Fills a workflow's parameters, checks the result against the server's nodes,
   * and queues it. Nothing is queued when a value or the graph is wrong.
   */
  async run(input: ComfyRunWorkflowInput): Promise<ComfyRun> {
    const manifest = await this.get(input.source, input.workflowId, input.cwd);
    if (!manifest)
      throw new ComfyWorkflowError(`no ${input.source} workflow ${input.workflowId}`, 404);
    const applied = applyParameters(manifest, input.values);
    if (applied.issues.length > 0) {
      throw new ComfyWorkflowError(summarise(applied.issues), 400, applied.issues);
    }
    const skipValues = new Set(
      applied.uploads.map((upload) => inputKey(upload.nodeId, upload.input)),
    );
    const definitions = await this.options.comfyui.nodeDefinitions(false);
    const issues = validateWorkflow(applied.workflow, definitions, { skipValues });
    if (issues.length > 0) throw new ComfyWorkflowError(summarise(issues), 400, issues);
    return this.options.comfyui.queue({
      cwd: input.cwd,
      workflow: applied.workflow,
      uploads: applied.uploads,
      outputDirectory: input.outputDirectory,
    });
  }

  /** Writes a manifest into the user's library or the project's vault, replacing one with the same id. */
  async save(input: ComfySaveWorkflowInput): Promise<ComfyLibraryEntry> {
    const parsed = parseManifest(input.manifest);
    if (!parsed.ok) throw new ComfyWorkflowError(parsed.error, 400);
    const text = `${JSON.stringify(parsed.manifest, null, 2)}\n`;
    if (input.source === "user")
      await writeUserFile(this.options.userDirectory, parsed.manifest.id, text);
    if (input.source === "project")
      await this.writeProjectFile(requireCwd(input.cwd), parsed.manifest.id, text);
    const definitions = await this.definitionsOrNull();
    return {
      source: input.source,
      manifest: parsed.manifest,
      availability: availabilityOf(parsed.manifest, definitions),
    };
  }

  /** Removes a user workflow, or bins a project one so the board's undo can bring it back. */
  async delete(source: "user" | "project", id: string, cwd: string | null): Promise<void> {
    if (!WORKFLOW_ID.test(id)) throw new ComfyWorkflowError(`${id} is not a workflow id`, 400);
    if (source === "user") {
      await rm(join(this.options.userDirectory, `${id}.json`), { force: true });
      return;
    }
    await this.options.vault.trash(requireCwd(cwd), `${PROJECT_WORKFLOW_DIRECTORY}/${id}.json`);
  }

  /** Asks every open window's editor to show a workflow. */
  openInEditor(request: ComfyEditorRequest): void {
    for (const listener of this.editorListeners) listener(request);
  }

  subscribeEditorRequests(listener: (request: ComfyEditorRequest) => void): Disposer {
    this.editorListeners.add(listener);
    return () => this.editorListeners.delete(listener);
  }

  /** The directory a saved workflow's source keeps its files in. */
  private directoryFor(source: "user" | "project", cwd: string | null): string {
    if (source === "user") return this.options.userDirectory;
    return projectDirectory(requireCwd(cwd));
  }

  /** A project workflow goes through the vault's writes: in place when it exists, created when not. */
  private async writeProjectFile(cwd: string, id: string, text: string): Promise<void> {
    const existing = await readManifests(projectDirectory(cwd));
    if (existing.some((manifest) => manifest.id === id)) {
      await this.options.vault.writeText(cwd, `${PROJECT_WORKFLOW_DIRECTORY}/${id}.json`, text);
      return;
    }
    await this.options.vault.write(
      cwd,
      PROJECT_WORKFLOW_DIRECTORY,
      `${id}.json`,
      new TextEncoder().encode(text),
    );
  }

  /** Node definitions, or null while ComfyUI is not answering. */
  private async definitionsOrNull(): Promise<ComfyNodeDefinitions | null> {
    try {
      return await this.options.comfyui.nodeDefinitions(false);
    } catch {
      return null;
    }
  }
}

/** A project's workflow directory on disk. */
function projectDirectory(cwd: string): string {
  return join(cwd, VAULT_DIRECTORY, PROJECT_WORKFLOW_DIRECTORY);
}

/** The project a `project` workflow needs. */
function requireCwd(cwd: string | null | undefined): string {
  if (!cwd) throw new ComfyWorkflowError("a project workflow needs a project", 400);
  return cwd;
}

/** Availability against the definitions, or null without them. */
function availabilityOf(
  manifest: ComfyWorkflowManifest,
  definitions: ComfyNodeDefinitions | null,
): ComfyLibraryEntry["availability"] {
  if (!definitions) return null;
  return workflowAvailability(manifest.workflow, manifest.parameters, definitions);
}

/** Every valid manifest in a directory; files that are not one are skipped. */
async function readManifests(directory: string): Promise<ComfyWorkflowManifest[]> {
  let names: string[];
  try {
    names = await readdir(directory);
  } catch {
    return [];
  }
  const manifests: ComfyWorkflowManifest[] = [];
  for (const name of names.filter((entry) => entry.endsWith(".json")).sort()) {
    const manifest = await readManifest(join(directory, name));
    if (manifest) manifests.push(manifest);
  }
  return manifests;
}

/** One manifest file, or null when it is unreadable or not a manifest. */
async function readManifest(path: string): Promise<ComfyWorkflowManifest | null> {
  try {
    const parsed = parseManifest(JSON.parse(await readFile(path, "utf8")));
    if (parsed.ok) return parsed.manifest;
    return null;
  } catch {
    return null;
  }
}

/** Writes a user workflow atomically, creating the directory on first save. */
async function writeUserFile(directory: string, id: string, text: string): Promise<void> {
  await mkdir(directory, { recursive: true });
  const target = join(directory, `${id}.json`);
  const temporary = `${target}.${process.pid}.tmp`;
  await writeFile(temporary, text, "utf8");
  await rename(temporary, target);
}

/** Issues as one message, for a thrown error. */
function summarise(issues: ComfyValidationIssue[]): string {
  return issues.map((issue) => issue.message).join("; ");
}
