export interface GitLogEntry {
	hash: string;
	shortHash: string;
	parents: string[];
	authorName: string;
	authorDate: string;
	subject: string;
	refs: string[];
}

export interface GitLog {
	repository: boolean;
	commits: GitLogEntry[];
}

async function request<T>(input: string, init?: RequestInit): Promise<T> {
	const response = await fetch(input, init);
	if (!response.ok) throw new Error(await response.text());
	return (await response.json()) as T;
}

export function fetchLog(sessionId: string, limit = 200): Promise<GitLog> {
	const params = new URLSearchParams({ limit: String(limit) });
	return request(`/api/sessions/${sessionId}/git/log?${params}`);
}
