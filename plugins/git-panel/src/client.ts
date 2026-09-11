export interface GitFileChange {
  path: string;
  indexStatus: string;
  worktreeStatus: string;
  staged: boolean;
  added: number;
  removed: number;
}

export interface GitStatus {
  repository: boolean;
  branch: string | null;
  ahead: number;
  behind: number;
  files: GitFileChange[];
}

async function request<T>(input: string, init?: RequestInit): Promise<T> {
  const response = await fetch(input, init);
  if (!response.ok) throw new Error(await response.text());
  return (await response.json()) as T;
}

export function fetchStatus(sessionId: string): Promise<GitStatus> {
  return request(`/api/sessions/${sessionId}/git`);
}

export function fetchDiff(
  sessionId: string,
  path: string,
  staged: boolean,
): Promise<{ patch: string }> {
  const params = new URLSearchParams({ path, staged: String(staged) });
  return request(`/api/sessions/${sessionId}/git/diff?${params}`);
}

export function setStaged(
  sessionId: string,
  paths: string[],
  staged: boolean,
): Promise<{ ok: boolean }> {
  return request(`/api/sessions/${sessionId}/git/stage`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ paths, staged }),
  });
}

export function commitChanges(
  sessionId: string,
  message: string,
  paths: string[],
): Promise<{ output: string }> {
  return request(`/api/sessions/${sessionId}/git/commit`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ message, paths }),
  });
}

/** Porcelain codes are terse; the panel shows a word. */
export function changeLabel(change: GitFileChange): string {
  const code = change.staged ? change.indexStatus : change.worktreeStatus;
  switch (code) {
    case "A":
      return "added";
    case "M":
      return "modified";
    case "D":
      return "deleted";
    case "R":
      return "renamed";
    case "?":
      return "untracked";
    default:
      return code.trim() || "changed";
  }
}
