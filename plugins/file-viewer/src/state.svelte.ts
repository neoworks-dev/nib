import type { SessionsService } from "@nib-ui/ui-contracts";
import type { Verdict } from "./changes";

export interface OpenFile {
  path: string;
  text: string;
}

const maxTabs = 8;

/**
 * How a vault note is filed among the tabs: the vault directory in front of it,
 * which both names where the file actually is and keeps it from colliding with a
 * workspace file of the same relative path.
 */
export function vaultTabPath(path: string): string {
  return `.nib/${path}`;
}

class FileViewerState {
  tabs = $state<OpenFile[]>([]);
  activePath = $state<string | null>(null);
  error = $state<string | null>(null);
  /** Set while the plugin is loaded; the review needs it to answer the agent. */
  sessions = $state<SessionsService | null>(null);
  /** Edit block id → the user's verdict. An edit missing here is still pending. */
  verdicts = $state<Record<string, Verdict>>({});

  get active(): OpenFile | null {
    return this.tabs.find((tab) => tab.path === this.activePath) ?? null;
  }

  /**
   * Opening a file that is already open refetches it: the request usually comes
   * from a diff the agent just applied, so the cached text is the stale half.
   *
   * `activate` false lands it as a background tab — what the agent read, beside
   * what the user is reading rather than instead of it.
   */
  async open(sessionId: string, path: string, activate = true): Promise<void> {
    const file = await this.read(sessionId, path);
    if (file) this.show(file, activate);
  }

  private show(file: OpenFile, activate: boolean): void {
    if (this.tabs.some((tab) => tab.path === file.path)) {
      this.tabs = this.tabs.map((tab) => (tab.path === file.path ? file : tab));
    } else {
      // Oldest tabs make room for the new one, except the one being read: a
      // background open must not close the file in front of the user.
      const opened = [...this.tabs, file];
      let excess = opened.length - maxTabs;
      this.tabs = opened.filter((tab) => {
        if (excess <= 0 || tab.path === this.activePath) return true;
        excess -= 1;
        return false;
      });
    }
    // An empty viewer has no tab to protect, so the first background open shows.
    if (activate || this.activePath === null) this.activePath = file.path;
  }

  /**
   * A note from a project's vault. The tab is labelled with the vault directory in
   * front of it, which both names where the file actually is and keeps it from
   * colliding with a workspace file of the same relative path.
   */
  async openVault(cwd: string, path: string, activate = true): Promise<void> {
    const params = new URLSearchParams({ cwd, path });
    const file = await this.fetchText(`/api/vault/file?${params.toString()}`, vaultTabPath(path));
    if (file) this.show(file, activate);
  }

  /**
   * A file out of a project directory. It is filed under the project-relative
   * path, the same one a session in that directory would name, so the same file
   * reached either way is the same tab.
   */
  async openProject(cwd: string, path: string, activate = true): Promise<void> {
    const params = new URLSearchParams({ cwd, path });
    const file = await this.fetchText(`/api/fs/file?${params.toString()}`, path);
    if (file) this.show(file, activate);
  }

  /** Re-reads an open file in place, leaving tab order and focus alone. */
  async reload(sessionId: string, path: string): Promise<void> {
    const file = await this.read(sessionId, path);
    if (file) this.tabs = this.tabs.map((tab) => (tab.path === file.path ? file : tab));
  }

  decide(editId: string, verdict: Verdict): void {
    this.verdicts = { ...this.verdicts, [editId]: verdict };
  }

  close(path: string): void {
    const index = this.tabs.findIndex((tab) => tab.path === path);
    if (index < 0) return;
    this.tabs = this.tabs.filter((tab) => tab.path !== path);
    if (this.activePath === path)
      this.activePath = (this.tabs[index] ?? this.tabs[index - 1])?.path ?? null;
  }

  reset(): void {
    this.tabs = [];
    this.activePath = null;
    this.error = null;
    this.verdicts = {};
    this.sessions = null;
  }

  private async read(sessionId: string, path: string): Promise<OpenFile | null> {
    try {
      const response = await fetch(
        `/api/sessions/${sessionId}/file?path=${encodeURIComponent(path)}`,
      );
      if (!response.ok) throw new Error(await response.text());
      const file = (await response.json()) as { path: string; text: string };
      this.error = null;
      return { path: file.path, text: file.text };
    } catch (cause) {
      this.error = cause instanceof Error ? cause.message : String(cause);
      return null;
    }
  }

  /**
   * The vault route serves bytes rather than a json document, deliberately: it is
   * the same endpoint a card loads an image from, and nothing it hands back is
   * allowed to be a document this origin runs.
   */
  private async fetchText(url: string, label: string): Promise<OpenFile | null> {
    try {
      const response = await fetch(url);
      if (!response.ok) throw new Error(await response.text());
      this.error = null;
      return { path: label, text: await response.text() };
    } catch (cause) {
      this.error = cause instanceof Error ? cause.message : String(cause);
      return null;
    }
  }
}

export const fileViewerState = new FileViewerState();
