import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "bun:test";
import {
  type CanvasObject,
  type ComfyRun,
  type ComfyWorkflow,
  emptyBoard,
} from "@nib-ui/ui-contracts";
import type { PlacementMap } from "@nib-ui/vault";
import type { PlacementWrite } from "../src/lib/server/board-store";
import {
  ComfyApiError,
  ComfyClient,
  normalizeBaseUrl,
  outputFiles,
  parseHistory,
  parseSocketMessage,
  promptErrorMessage,
  socketUrl,
  withInputs,
} from "../src/lib/server/comfyui";
import { applyEvent, queuedRun } from "../src/lib/server/comfyui-runs";
import { ComfyHost, type SocketHandlers } from "../src/lib/server/plugins/comfyui";

const BASE_URL = "http://comfy.test:8188";
const PROMPT_ID = "prompt-1";

const workflow: ComfyWorkflow = {
  "1": { class_type: "LoadImage", inputs: { image: "placeholder.png" } },
  "2": { class_type: "KSampler", inputs: { steps: 3 } },
  "3": { class_type: "SaveImage", inputs: { images: ["2", 0], filename_prefix: "nib" } },
};

/** A socket message as ComfyUI sends it. */
function message(type: string, data: Record<string, unknown>): string {
  return JSON.stringify({ type, data: { prompt_id: PROMPT_ID, ...data } });
}

/** A json response. */
function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status });
}

/** Resolves once pending promise continuations and timers of zero delay have run. */
function settle(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 5));
}

/** Everything a fake ComfyUI saw and sends. */
class FakeComfy {
  requests: { method: string; path: string; body: unknown }[] = [];
  sockets: SocketHandlers[] = [];
  uploads: { name: string; bytes: string }[] = [];
  queued: ComfyWorkflow[] = [];
  history: Record<string, unknown> = {};
  reachable = true;
  /** Messages the socket sends while `POST /prompt` is still being answered. */
  duringQueue: string[] = [];

  /** The fetch the host is given. */
  fetch = async (input: URL | string, init: RequestInit = {}): Promise<Response> => {
    if (!this.reachable) throw new TypeError("fetch failed: ECONNREFUSED");
    const url = new URL(String(input));
    const method = init.method ?? "GET";
    this.requests.push({ method, path: url.pathname, body: init.body });
    return this.answer(method, url, init);
  };

  /** The socket factory the host is given; it opens on the next tick. */
  openSocket = (_url: string, handlers: SocketHandlers): { close(): void } => {
    this.sockets.push(handlers);
    if (!this.reachable) {
      setTimeout(() => handlers.close(), 0);
      return { close: () => {} };
    }
    setTimeout(() => handlers.open(), 0);
    return { close: () => {} };
  };

  /** Sends a message down the most recent socket. */
  send(text: string): void {
    const socket = this.sockets.at(-1);
    if (!socket) throw new Error("no socket is open");
    socket.message(text);
  }

  /** Answers one request the way ComfyUI would. */
  private async answer(method: string, url: URL, init: RequestInit): Promise<Response> {
    if (url.pathname === "/system_stats") {
      return jsonResponse({ system: { comfyui_version: "0.33.0" } });
    }
    if (url.pathname === "/upload/image") return this.upload(init);
    if (url.pathname === "/prompt") return this.prompt(init);
    if (url.pathname.startsWith("/history/")) return jsonResponse(this.history);
    if (url.pathname === "/view") {
      return new Response(`bytes of ${url.searchParams.get("filename")}`);
    }
    if (method === "POST") return jsonResponse({});
    return jsonResponse({ error: { message: "not found" } }, 404);
  }

  /** `POST /upload/image`. */
  private async upload(init: RequestInit): Promise<Response> {
    const form = init.body;
    if (!(form instanceof FormData)) throw new Error("upload without a form");
    const file = form.get("image");
    if (!(file instanceof File)) throw new Error("upload without a file");
    this.uploads.push({ name: file.name, bytes: await file.text() });
    return jsonResponse({ name: file.name, subfolder: "nib", type: "input" });
  }

  /** `POST /prompt`, sending the queued-early messages before it answers. */
  private prompt(init: RequestInit): Response {
    if (typeof init.body !== "string") throw new Error("a prompt without a json body");
    const body: { prompt: ComfyWorkflow } = JSON.parse(init.body);
    this.queued.push(body.prompt);
    for (const text of this.duringQueue) this.send(text);
    return jsonResponse({ prompt_id: PROMPT_ID, number: 1, node_errors: {} });
  }
}

interface WrittenOutput {
  cwd: string;
  directory: string;
  name: string;
  text: string;
}

interface TestHost {
  host: ComfyHost;
  written: WrittenOutput[];
  seen: ComfyRun[];
  directory: string;
  /** Each `boards.place` call, with the run's status at the moment it was made. */
  placed: { writes: readonly PlacementWrite[]; status: ComfyRun["status"] | undefined }[];
  /** Every object handed to `boards.addObjects`. */
  linked: CanvasObject[];
}

/** A host against a fake ComfyUI, with a vault and a board that keep writes in memory. */
async function createHost(comfy: FakeComfy, placements: PlacementMap = {}): Promise<TestHost> {
  const directory = await mkdtemp(join(tmpdir(), "nib-comfy-"));
  const written: WrittenOutput[] = [];
  const seen: ComfyRun[] = [];
  const placed: TestHost["placed"] = [];
  const linked: CanvasObject[] = [];
  const board = { ...emptyBoard("/project"), placements };
  const host = new ComfyHost({
    vault: {
      readFile: (_cwd, path) =>
        Promise.resolve({ bytes: Buffer.from(`vault ${path}`), contentType: "image/png" }),
      write: (cwd, directory, name, bytes) => {
        written.push({ cwd, directory, name, text: Buffer.from(bytes).toString() });
        return Promise.resolve({ path: `${directory}/${name}` });
      },
    },
    boards: {
      read: () => Promise.resolve(board),
      place: (_cwd, writes) => {
        placed.push({ writes, status: seen.at(-1)?.status });
        return Promise.resolve(board);
      },
      addObjects: (_cwd, objects) => {
        linked.push(...objects);
        return Promise.resolve(board);
      },
    },
    settingsPath: join(directory, "comfyui.json"),
    fetchImpl: comfy.fetch,
    openSocket: comfy.openSocket,
    reconnectDelayMs: 10,
  });
  await host.configure(BASE_URL);
  host.subscribe((run) => seen.push(run));
  return { host, written, seen, directory, placed, linked };
}

/** The run through a whole successful execution, as the socket reports it. */
function sendSuccessfulRun(comfy: FakeComfy): void {
  comfy.send(message("execution_start", {}));
  comfy.send(message("executing", { node: "2" }));
  comfy.send(message("progress", { node: "2", value: 1, max: 3 }));
  comfy.send(message("progress", { node: "2", value: 2, max: 3 }));
  comfy.send(message("executing", { node: "3" }));
  comfy.send(
    message("executed", {
      node: "3",
      output: {
        images: [
          { filename: "nib_00001_.png", subfolder: "", type: "output" },
          { filename: "preview.png", subfolder: "", type: "temp" },
        ],
      },
    }),
  );
  comfy.send(message("execution_success", {}));
}

describe("normalizeBaseUrl", () => {
  it("strips a trailing slash and keeps a path prefix", () => {
    expect(normalizeBaseUrl("http://127.0.0.1:8188/")).toBe("http://127.0.0.1:8188");
    expect(normalizeBaseUrl(" https://host/comfy/ ")).toBe("https://host/comfy");
  });

  it("refuses anything that is not http", () => {
    expect(() => normalizeBaseUrl("file:///etc/passwd")).toThrow(ComfyApiError);
    expect(() => normalizeBaseUrl("not a url")).toThrow(ComfyApiError);
  });

  it("derives the socket address from it", () => {
    expect(socketUrl("https://host/comfy", "client-1")).toBe(
      "wss://host/comfy/ws?clientId=client-1",
    );
  });
});

describe("parseSocketMessage", () => {
  it("reads the events a run is followed by", () => {
    expect(parseSocketMessage(message("executing", { node: "2" }))).toEqual({
      type: "executing",
      promptId: PROMPT_ID,
      nodeId: "2",
    });
    expect(parseSocketMessage(message("progress", { node: "2", value: 4, max: 20 }))).toEqual({
      type: "progress",
      promptId: PROMPT_ID,
      nodeId: "2",
      value: 4,
      max: 20,
    });
    expect(
      parseSocketMessage(
        message("execution_error", {
          node_id: "2",
          node_type: "KSampler",
          exception_message: "CUDA out of memory\n",
        }),
      ),
    ).toEqual({
      type: "execution_error",
      promptId: PROMPT_ID,
      nodeId: "2",
      nodeType: "KSampler",
      message: "CUDA out of memory",
    });
  });

  it("ignores status, progress_state and anything that is not json", () => {
    const status = JSON.stringify({ type: "status", data: { status: {} } });
    expect(parseSocketMessage(status)).toBeNull();
    expect(parseSocketMessage(message("progress_state", { nodes: {} }))).toBeNull();
    expect(parseSocketMessage("not json")).toBeNull();
  });
});

describe("outputFiles", () => {
  it("collects saved files from every output list and skips previews", () => {
    const files = outputFiles({
      "3": { images: [{ filename: "a.png", subfolder: "", type: "output" }] },
      "4": { "3d": [{ filename: "mesh.glb", subfolder: "3d", type: "output" }] },
      "5": { images: [{ filename: "preview.png", subfolder: "", type: "temp" }] },
    });
    expect(files).toEqual([
      { filename: "a.png", subfolder: "", type: "output" },
      { filename: "mesh.glb", subfolder: "3d", type: "output" },
    ]);
  });
});

describe("parseHistory", () => {
  it("reads a finished prompt's outputs and a failed one's error", () => {
    const success = parseHistory(
      {
        [PROMPT_ID]: {
          outputs: { "3": { images: [{ filename: "a.png", subfolder: "", type: "output" }] } },
          status: { status_str: "success", completed: true, messages: [] },
        },
      },
      PROMPT_ID,
    );
    expect(success.status).toBe("success");
    expect(success.outputs).toHaveLength(1);

    const failure = parseHistory(
      {
        [PROMPT_ID]: {
          outputs: {},
          status: {
            status_str: "error",
            messages: [["execution_error", { exception_message: "bad input" }]],
          },
        },
      },
      PROMPT_ID,
    );
    expect(failure).toEqual({ outputs: [], status: "error", errorMessage: "bad input" });
    expect(parseHistory({}, PROMPT_ID).status).toBe("pending");
  });
});

describe("promptErrorMessage", () => {
  it("reads the top-level error and every node error", () => {
    const text = promptErrorMessage({
      error: {
        type: "prompt_outputs_failed_validation",
        message: "Prompt outputs failed validation",
        details: "",
      },
      node_errors: {
        "4": {
          class_type: "CheckpointLoaderSimple",
          errors: [{ message: "Value not in list", details: "ckpt_name: 'x' not in [...]" }],
        },
      },
    });
    expect(text).toBe(
      "Prompt outputs failed validation\nnode 4 (CheckpointLoaderSimple): Value not in list: ckpt_name: 'x' not in [...]",
    );
  });
});

describe("withInputs", () => {
  it("writes into a copy and refuses a node the workflow lacks", () => {
    const next = withInputs(workflow, [{ nodeId: "1", input: "image", value: "nib/in.png" }]);
    expect(next["1"]?.inputs.image).toBe("nib/in.png");
    expect(workflow["1"]?.inputs.image).toBe("placeholder.png");
    expect(() => withInputs(workflow, [{ nodeId: "9", input: "image", value: "x" }])).toThrow(
      ComfyApiError,
    );
  });
});

describe("applyEvent", () => {
  it("follows the executing node and its steps, then records the failure", () => {
    let run = queuedRun(PROMPT_ID, "/project", 1);
    run = applyEvent(run, { type: "executing", promptId: PROMPT_ID, nodeId: "2" }, workflow, 2);
    expect(run).toMatchObject({ status: "running", nodeId: "2", nodeType: "KSampler" });
    run = applyEvent(
      run,
      { type: "progress", promptId: PROMPT_ID, nodeId: "2", value: 2, max: 3 },
      workflow,
      3,
    );
    expect(run.progress).toEqual({ value: 2, max: 3 });
    run = applyEvent(
      run,
      {
        type: "execution_error",
        promptId: PROMPT_ID,
        nodeId: "2",
        nodeType: "KSampler",
        message: "boom",
      },
      workflow,
      4,
    );
    expect(run).toMatchObject({ status: "failed", finishedAt: 4, nodeId: null });
    expect(run.error).toEqual({ message: "boom", nodeId: "2", nodeType: "KSampler" });

    const after = applyEvent(run, { type: "execution_start", promptId: PROMPT_ID }, workflow, 5);
    expect(after).toBe(run);
  });
});

describe("ComfyClient", () => {
  it("throws ComfyUI's validation errors on a rejected prompt", async () => {
    const client = new ComfyClient(BASE_URL, () =>
      Promise.resolve(
        jsonResponse(
          {
            error: {
              type: "missing_node_type",
              message: "Node 'Nope' not found.",
              details: "Node ID '#1'",
            },
            node_errors: {},
          },
          400,
        ),
      ),
    );
    const queued = client.queue({ "1": { class_type: "Nope", inputs: {} } }, "client");
    const failure: unknown = await queued.catch((cause) => cause);
    expect(failure).toBeInstanceOf(ComfyApiError);
    expect(failure).toMatchObject({ message: "Node 'Nope' not found.: Node ID '#1'", status: 400 });
  });
});

describe("ComfyHost", () => {
  it("uploads the inputs, follows the run and writes the outputs beside the first input", async () => {
    const comfy = new FakeComfy();
    const { host, written, seen } = await createHost(comfy);

    const run = await host.queue({
      cwd: "/project",
      workflow,
      uploads: [{ nodeId: "1", input: "image", path: "refs/sprite.png" }],
    });
    expect(run.status).toBe("queued");
    expect(comfy.uploads).toEqual([{ name: "sprite.png", bytes: "vault refs/sprite.png" }]);
    expect(comfy.queued[0]?.["1"]?.inputs.image).toBe("nib/sprite.png");

    sendSuccessfulRun(comfy);
    await settle();

    const progress = seen.find((entry) => entry.progress?.value === 2);
    expect(progress).toMatchObject({ status: "running", nodeType: "KSampler" });
    expect(written).toEqual([
      {
        cwd: "/project",
        directory: "refs",
        name: "nib_00001_.png",
        text: "bytes of nib_00001_.png",
      },
    ]);
    expect(host.runs()[0]).toMatchObject({
      status: "succeeded",
      outputs: ["refs/nib_00001_.png"],
    });
    host.dispose();
  });

  it("writes outputs into comfyui/ without an input, and at the root beside a root-level one", async () => {
    const comfy = new FakeComfy();
    const { host, written } = await createHost(comfy);

    await host.queue({ cwd: "/project", workflow });
    sendSuccessfulRun(comfy);
    await settle();
    host.dispose();

    const second = await createHost(comfy);
    await second.host.queue({
      cwd: "/project",
      workflow,
      uploads: [{ nodeId: "1", input: "image", path: "sprite.png" }],
    });
    sendSuccessfulRun(comfy);
    await settle();
    second.host.dispose();

    expect(written.map((entry) => entry.directory)).toEqual(["comfyui"]);
    expect(second.written.map((entry) => entry.directory)).toEqual([""]);
  });

  it("holds a spot beside the input while running, and places the output there before it succeeds", async () => {
    const comfy = new FakeComfy();
    const sprite = { x: 100, y: 50, w: 200, h: 150, z: 1 };
    const { host, placed } = await createHost(comfy, { refs: { "refs/sprite.png": sprite } });

    const run = await host.queue({
      cwd: "/project",
      workflow,
      uploads: [{ nodeId: "1", input: "image", path: "refs/sprite.png" }],
      label: "Upscale",
    });
    const slot = { board: "refs", x: 332, y: 50, w: 200, h: 150 };
    expect(run).toMatchObject({ label: "Upscale", inputs: ["refs/sprite.png"], slot });

    sendSuccessfulRun(comfy);
    await settle();

    expect(placed).toEqual([
      {
        writes: [{ path: "refs/nib_00001_.png", x: 332, y: 50, w: 200, h: 150 }],
        status: "running",
      },
    ]);
    expect(host.runs()[0]?.status).toBe("succeeded");
    host.dispose();
  });

  it("links each output to the picture it was made from", async () => {
    const comfy = new FakeComfy();
    const { host, linked } = await createHost(comfy);

    await host.queue({
      cwd: "/project",
      workflow,
      uploads: [{ nodeId: "1", input: "image", path: "refs/sprite.png" }],
    });
    sendSuccessfulRun(comfy);
    await settle();

    expect(linked).toEqual([
      {
        kind: "comfy-lineage",
        id: `comfy-lineage:${PROMPT_ID}:refs/sprite.png:refs/nib_00001_.png`,
        from: "refs/sprite.png",
        to: "refs/nib_00001_.png",
      },
    ]);
    host.dispose();
  });

  it("keeps events that arrive before the queue call answers", async () => {
    const comfy = new FakeComfy();
    comfy.duringQueue = [message("execution_start", {}), message("executing", { node: "2" })];
    const { host } = await createHost(comfy);

    await host.queue({ cwd: "/project", workflow });
    expect(host.runs()[0]).toMatchObject({ status: "running", nodeId: "2" });
    host.dispose();
  });

  it("drops a queued run from the queue when it is cancelled", async () => {
    const comfy = new FakeComfy();
    const { host } = await createHost(comfy);

    await host.queue({ cwd: "/project", workflow });
    await host.cancel(PROMPT_ID);

    const posted = comfy.requests.filter((request) => request.method === "POST");
    expect(posted.map((request) => request.path)).toEqual(["/prompt", "/queue", "/interrupt"]);
    expect(JSON.parse(String(posted[1]?.body))).toEqual({ delete: [PROMPT_ID] });
    expect(JSON.parse(String(posted[2]?.body))).toEqual({ prompt_id: PROMPT_ID });
    expect(host.runs()[0]?.status).toBe("cancelled");
    host.dispose();
  });

  it("marks a running run cancelled once ComfyUI reports the interrupt", async () => {
    const comfy = new FakeComfy();
    const { host } = await createHost(comfy);

    await host.queue({ cwd: "/project", workflow });
    comfy.send(message("executing", { node: "2" }));
    await host.cancel(PROMPT_ID);
    expect(host.runs()[0]?.status).toBe("running");
    comfy.send(message("execution_interrupted", { node_id: "2", node_type: "KSampler" }));
    expect(host.runs()[0]?.status).toBe("cancelled");
    host.dispose();
  });

  it("settles a run from history when the socket missed its ending", async () => {
    const comfy = new FakeComfy();
    const { host, written } = await createHost(comfy);

    await host.queue({ cwd: "/project", workflow });
    comfy.history = {
      [PROMPT_ID]: {
        outputs: { "3": { images: [{ filename: "late.png", subfolder: "", type: "output" }] } },
        status: { status_str: "success", completed: true, messages: [] },
      },
    };
    const socket = comfy.sockets.at(-1);
    socket?.close();
    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(comfy.sockets).toHaveLength(2);
    expect(written.map((entry) => entry.name)).toEqual(["late.png"]);
    expect(host.runs()[0]?.status).toBe("succeeded");
    host.dispose();
  });

  it("reports ComfyUI offline without throwing, and refuses to queue", async () => {
    const comfy = new FakeComfy();
    const { host, directory } = await createHost(comfy);
    comfy.reachable = false;

    const status = await host.status();
    expect(status).toMatchObject({ baseUrl: BASE_URL, connected: false, version: null });
    expect(status.error).toContain("not reachable");

    const failure: unknown = await host
      .queue({ cwd: "/project", workflow })
      .catch((cause) => cause);
    expect(failure).toBeInstanceOf(ComfyApiError);
    expect(failure).toMatchObject({ status: 503 });

    const settings: unknown = JSON.parse(await readFile(join(directory, "comfyui.json"), "utf8"));
    expect(settings).toEqual({ baseUrl: BASE_URL });
    host.dispose();
  });
});
