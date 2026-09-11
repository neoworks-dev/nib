import type { Plugin } from "@nib-ui/kernel";
import {
  type AnyAgentEvent,
  type HarnessDescriptor,
  type SessionCommand,
  safeParseAgentEvent,
} from "@nib-ui/protocol";
import type {
  BoardDoc,
  BoardSummary,
  CreateSessionInput,
  DirectoryEntry,
  SessionSummary,
  TransportService,
  UserPreferences,
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

  saveBoard(board: BoardDoc): Promise<BoardDoc> {
    return requestJson(`/api/boards?cwd=${encodeURIComponent(board.cwd)}`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(board),
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
