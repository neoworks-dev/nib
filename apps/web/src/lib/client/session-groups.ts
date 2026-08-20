import type { SessionSummary } from '@nib-ui/ui-contracts';

export interface WorkspaceGroup {
	path: string;
	name: string;
	sessions: SessionSummary[];
}

export function workspaceName(path: string): string {
	const trimmed = path.replace(/\/+$/, '');
	const name = trimmed.slice(trimmed.lastIndexOf('/') + 1);
	return name.length > 0 ? name : '/';
}

/** Newest task first inside a workspace, and the workspace with the newest task first. */
export function groupSessionsByWorkspace(summaries: SessionSummary[]): WorkspaceGroup[] {
	const groups = new Map<string, WorkspaceGroup>();
	for (const summary of summaries) {
		const group = groups.get(summary.cwd) ?? { path: summary.cwd, name: workspaceName(summary.cwd), sessions: [] };
		group.sessions.push(summary);
		groups.set(summary.cwd, group);
	}
	for (const group of groups.values()) group.sessions.sort((left, right) => right.updatedAt - left.updatedAt);
	return [...groups.values()].sort(
		(left, right) => (right.sessions[0]?.updatedAt ?? 0) - (left.sessions[0]?.updatedAt ?? 0),
	);
}
