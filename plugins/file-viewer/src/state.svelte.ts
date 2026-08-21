export interface OpenFile {
	path: string;
	text: string;
}

const maxTabs = 8;

class FileViewerState {
	tabs = $state<OpenFile[]>([]);
	activePath = $state<string | null>(null);
	error = $state<string | null>(null);

	get active(): OpenFile | null {
		return this.tabs.find((tab) => tab.path === this.activePath) ?? null;
	}

	/** Opening a file that is already open just focuses its tab. */
	async open(sessionId: string, path: string): Promise<void> {
		const existing = this.tabs.find((tab) => tab.path === path);
		if (existing) return void (this.activePath = existing.path);

		try {
			const response = await fetch(`/api/sessions/${sessionId}/file?path=${encodeURIComponent(path)}`);
			if (!response.ok) throw new Error(await response.text());
			const file = (await response.json()) as { path: string; text: string };
			this.tabs = [...this.tabs, { path: file.path, text: file.text }].slice(-maxTabs);
			this.activePath = file.path;
			this.error = null;
		} catch (cause) {
			this.error = cause instanceof Error ? cause.message : String(cause);
		}
	}

	close(path: string): void {
		const index = this.tabs.findIndex((tab) => tab.path === path);
		if (index < 0) return;
		this.tabs = this.tabs.filter((tab) => tab.path !== path);
		if (this.activePath === path) this.activePath = (this.tabs[index] ?? this.tabs[index - 1])?.path ?? null;
	}

	reset(): void {
		this.tabs = [];
		this.activePath = null;
		this.error = null;
	}
}

export const fileViewerState = new FileViewerState();
