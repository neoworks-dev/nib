import type { Plugin } from "@nib-ui/kernel";
import {
  type AnyAgentEvent,
  type HarnessDescriptor,
  type SessionCommand,
  safeParseAgentEvent,
} from "@nib-ui/protocol";
import type { TrashEntry, VaultDoc } from "@nib-ui/vault";
import type {
  BoardDoc,
  BoardSummary,
  BoardWrite,
  ComfyEditorRequest,
  ComfyLibraryEntry,
  ComfyNodeDefinitions,
  ComfyQueueInput,
  ComfyRun,
  ComfyRunWorkflowInput,
  ComfySaveWorkflowInput,
  ComfyStatus,
  CreateSessionInput,
  DirectoryEntry,
  SessionSummary,
  TransportService,
  UserPreferences,
  VaultLoadOptions,
  VaultMoveOptions,
  VaultMoveResult,
} from "@nib-ui/ui-contracts";

async function requestJson<T>(input: string, init?: RequestInit): Promise<T> {
  const response = await fetch(input, init);
  if (!response.ok) throw new Error(await response.text());
  return (await response.json()) as T;
}

class SseTransport implements TransportService {
  async listHarnesses(): Promise<HarnessDescriptor[]> {
    const { harnesses } = await requestJson<{ harnesses: HarnessDescriptor[] }>("/api/harnesses");
    return harnesses;
  }

  async listSessions(): Promise<SessionSummary[]> {
    const { sessions } = await requestJson<{ sessions: SessionSummary[] }>("/api/sessions");
    return sessions;
  }

  async createSession(input: CreateSessionInput): Promise<string> {
    const { sessionId } = await requestJson<{ sessionId: string }>("/api/sessions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(input),
    });
    return sessionId;
  }

  async deleteSession(sessionId: string): Promise<void> {
    await requestJson(`/api/sessions/${sessionId}`, { method: "DELETE" });
  }

  listDirectories(path: string): Promise<{ base: string; entries: DirectoryEntry[] }> {
    return requestJson(`/api/fs/directories?path=${encodeURIComponent(path)}`);
  }

  async workspaceBranch(path: string): Promise<string | null> {
    const { branch } = await requestJson<{ branch: string | null }>(
      `/api/fs/branch?path=${encodeURIComponent(path)}`,
    );
    return branch;
  }

  readUserConfig(): Promise<UserPreferences> {
    return requestJson("/api/config");
  }

  async saveDefaultModel(harnessId: string, model: string): Promise<void> {
    await requestJson("/api/config", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ defaultModels: { [harnessId]: model } }),
    });
  }

  async saveLastProject(cwd: string): Promise<void> {
    await requestJson("/api/config", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ lastProject: cwd }),
    });
  }

  async searchFiles(sessionId: string, query: string, limit = 20): Promise<string[]> {
    const params = new URLSearchParams({ query, limit: String(limit) });
    const { files } = await requestJson<{ files: { path: string }[] }>(
      `/api/sessions/${sessionId}/files?${params}`,
    );
    return files.map((file) => file.path);
  }

  /** EventSource reconnects on its own and sends `Last-Event-ID`, so the server resumes the replay. */
  subscribe(sessionId: string, fromSeq: number, onEvent: (event: AnyAgentEvent) => void) {
    const source = new EventSource(`/api/sessions/${sessionId}/events?fromSeq=${fromSeq}`);
    source.addEventListener("agent", (message) => {
      const event = safeParseAgentEvent(JSON.parse((message as MessageEvent<string>).data));
      if (event) onEvent(event);
    });
    return () => source.close();
  }

  async command(sessionId: string, command: SessionCommand): Promise<void> {
    await requestJson(`/api/sessions/${sessionId}/commands`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(command),
    });
  }

  async listBoards(): Promise<BoardSummary[]> {
    const { boards } = await requestJson<{ boards: BoardSummary[] }>("/api/boards/list");
    return boards;
  }

  async reviewWorkstream(cwd: string, workstreamId: string, reviewed: boolean): Promise<void> {
    await requestJson("/api/boards/review", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ cwd, workstreamId, reviewed }),
    });
  }

  loadBoard(cwd: string): Promise<BoardDoc> {
    return requestJson(`/api/boards?cwd=${encodeURIComponent(cwd)}`);
  }

  saveBoard(board: BoardWrite): Promise<BoardDoc> {
    return requestJson(`/api/boards?cwd=${encodeURIComponent(board.cwd)}`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(board),
    });
  }

  loadVault(cwd: string, options: VaultLoadOptions = {}): Promise<VaultDoc> {
    const params = new URLSearchParams({ cwd });
    if (options.mentions) params.set("mentions", "1");
    if (options.previewChars !== undefined)
      params.set("previewChars", String(options.previewChars));
    return requestJson(`/api/vault?${params.toString()}`);
  }

  moveVaultEntry(
    cwd: string,
    from: string,
    toDirectory: string,
    options: VaultMoveOptions = {},
  ): Promise<VaultMoveResult> {
    return requestJson("/api/vault/move", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ cwd, from, toDirectory, rewrite: options.rewrite }),
    });
  }

  writeVaultFile(
    cwd: string,
    directory: string,
    name: string,
    bytes: Uint8Array,
  ): Promise<{ path: string }> {
    const params = new URLSearchParams({ cwd, dir: directory, name });
    return requestJson(`/api/vault/file?${params.toString()}`, {
      method: "PUT",
      headers: { "content-type": "application/octet-stream" },
      body: new Uint8Array(bytes),
    });
  }

  async writeVaultText(cwd: string, path: string, text: string): Promise<void> {
    const params = new URLSearchParams({ cwd, path });
    await requestJson(`/api/vault/text?${params.toString()}`, {
      method: "PUT",
      headers: { "content-type": "text/markdown; charset=utf-8" },
      body: text,
    });
  }

  async deleteVaultEntry(cwd: string, path: string): Promise<void> {
    const params = new URLSearchParams({ cwd, path });
    await requestJson(`/api/vault/file?${params.toString()}`, { method: "DELETE" });
  }

  trashVaultEntry(cwd: string, path: string): Promise<TrashEntry> {
    const params = new URLSearchParams({ cwd, path });
    return requestJson(`/api/vault/trash?${params.toString()}`, { method: "POST" });
  }

  restoreTrashEntry(cwd: string, id: string): Promise<{ path: string }> {
    const params = new URLSearchParams({ cwd, id });
    return requestJson(`/api/vault/trash?${params.toString()}`, { method: "PUT" });
  }

  listTrash(cwd: string): Promise<TrashEntry[]> {
    return requestJson(`/api/vault/trash?cwd=${encodeURIComponent(cwd)}`);
  }

  async purgeTrash(cwd: string, id?: string): Promise<void> {
    const params = new URLSearchParams({ cwd });
    if (id !== undefined) params.set("id", id);
    await requestJson(`/api/vault/trash?${params.toString()}`, { method: "DELETE" });
  }

  vaultFileUrl(cwd: string, path: string): string {
    return `/api/vault/file?${new URLSearchParams({ cwd, path }).toString()}`;
  }

  async readVaultFile(cwd: string, path: string): Promise<Uint8Array> {
    const response = await fetch(this.vaultFileUrl(cwd, path));
    if (!response.ok) throw new Error(await response.text());
    return new Uint8Array(await response.arrayBuffer());
  }

  subscribeVault(cwd: string, onChange: () => void) {
    const source = new EventSource(`/api/vault/events?cwd=${encodeURIComponent(cwd)}`);
    source.addEventListener("vault", () => onChange());
    return () => source.close();
  }

  comfyStatus(): Promise<ComfyStatus> {
    return requestJson("/api/comfyui");
  }

  configureComfy(baseUrl: string): Promise<ComfyStatus> {
    return requestJson("/api/comfyui", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ baseUrl }),
    });
  }

  comfyNodeDefinitions(refresh: boolean): Promise<ComfyNodeDefinitions> {
    if (refresh) return requestJson("/api/comfyui/nodes?refresh=1");
    return requestJson("/api/comfyui/nodes");
  }

  queueComfy(input: ComfyQueueInput): Promise<ComfyRun> {
    return requestJson("/api/comfyui/runs", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(input),
    });
  }

  async cancelComfyRun(runId: string): Promise<void> {
    await requestJson(`/api/comfyui/runs/${encodeURIComponent(runId)}`, { method: "DELETE" });
  }

  subscribeComfy(
    onRun: (run: ComfyRun) => void,
    onEditorRequest: (request: ComfyEditorRequest) => void,
  ) {
    const source = new EventSource("/api/comfyui/events");
    source.addEventListener("run", (message: MessageEvent<string>) => {
      const run: ComfyRun = JSON.parse(message.data);
      onRun(run);
    });
    source.addEventListener("editor", (message: MessageEvent<string>) => {
      const request: ComfyEditorRequest = JSON.parse(message.data);
      onEditorRequest(request);
    });
    return () => source.close();
  }

  async comfyLibrary(cwd: string | null): Promise<ComfyLibraryEntry[]> {
    let url = "/api/comfyui/workflows";
    if (cwd !== null) url = `${url}?cwd=${encodeURIComponent(cwd)}`;
    const { workflows } = await requestJson<{ workflows: ComfyLibraryEntry[] }>(url);
    return workflows;
  }

  runComfyWorkflow(input: ComfyRunWorkflowInput): Promise<ComfyRun> {
    return requestJson("/api/comfyui/workflows/run", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(input),
    });
  }

  saveComfyWorkflow(input: ComfySaveWorkflowInput): Promise<ComfyLibraryEntry> {
    return requestJson("/api/comfyui/workflows", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(input),
    });
  }

  async deleteComfyWorkflow(
    source: "user" | "project",
    id: string,
    cwd: string | null,
  ): Promise<void> {
    let url = `/api/comfyui/workflows/${source}/${encodeURIComponent(id)}`;
    if (cwd !== null) url = `${url}?cwd=${encodeURIComponent(cwd)}`;
    await requestJson(url, { method: "DELETE" });
  }

  async openComfyEditor(request: ComfyEditorRequest): Promise<void> {
    await requestJson("/api/comfyui/editor", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(request),
    });
  }

  subscribeBoard(cwd: string, fromRev: number, onBoard: (board: BoardDoc) => void) {
    const params = new URLSearchParams({ cwd, fromRev: String(fromRev) });
    const source = new EventSource(`/api/boards/events?${params}`);
    source.addEventListener("board", (message) => {
      onBoard(JSON.parse((message as MessageEvent<string>).data) as BoardDoc);
    });
    return () => source.close();
  }
}

export const transportPlugin: Plugin = {
  name: "transport",
  apply(ctx) {
    ctx.provide("transport", new SseTransport());
  },
};
