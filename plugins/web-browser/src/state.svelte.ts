import { displayHost, normalizeUrl } from "./url";

/** Each tab owns a live iframe, so the count is capped to keep memory and sockets bounded. */
export const maxTabCount = 8;

export interface BrowserTab {
  id: string;
  url: string;
  title: string;
  history: string[];
  historyIndex: number;
}

class WebBrowserState {
  open = $state(false);
  tabs = $state<BrowserTab[]>([]);
  activeId = $state<string | null>(null);
  private nextTabNumber = 1;

  get activeTab(): BrowserTab | null {
    return this.tabs.find((tab) => tab.id === this.activeId) ?? null;
  }

  openTab(url?: string): BrowserTab | null {
    if (this.tabs.length >= maxTabCount) return null;
    const target = url ? normalizeUrl(url) : null;
    const tab: BrowserTab = {
      id: `tab-${this.nextTabNumber}`,
      url: target ?? "",
      title: target ? displayHost(target) : "",
      history: target ? [target] : [],
      historyIndex: target ? 0 : -1,
    };
    this.nextTabNumber += 1;
    this.tabs.push(tab);
    this.activeId = tab.id;
    return tab;
  }

  close(id: string): void {
    const index = this.tabs.findIndex((tab) => tab.id === id);
    if (index < 0) return;
    this.tabs.splice(index, 1);
    if (this.activeId !== id) return;
    this.activeId = this.tabs[Math.min(index, this.tabs.length - 1)]?.id ?? null;
  }

  navigate(id: string, url: string): boolean {
    const tab = this.tabById(id);
    const target = normalizeUrl(url);
    if (!tab || !target) return false;
    if (target !== tab.url) {
      tab.history = [...tab.history.slice(0, tab.historyIndex + 1), target];
      tab.historyIndex = tab.history.length - 1;
    }
    tab.url = target;
    tab.title = displayHost(target);
    return true;
  }

  back(id: string): boolean {
    const tab = this.tabById(id);
    if (!tab || tab.historyIndex <= 0) return false;
    this.moveTo(tab, tab.historyIndex - 1);
    return true;
  }

  forward(id: string): boolean {
    const tab = this.tabById(id);
    if (!tab || tab.historyIndex >= tab.history.length - 1) return false;
    this.moveTo(tab, tab.historyIndex + 1);
    return true;
  }

  toggle(next?: boolean): void {
    this.open = next ?? !this.open;
    if (this.open && this.tabs.length === 0) this.openTab();
  }

  reset(): void {
    this.open = false;
    this.tabs = [];
    this.activeId = null;
    this.nextTabNumber = 1;
  }

  private tabById(id: string): BrowserTab | null {
    return this.tabs.find((tab) => tab.id === id) ?? null;
  }

  private moveTo(tab: BrowserTab, index: number): void {
    tab.historyIndex = index;
    tab.url = tab.history[index] ?? tab.url;
    tab.title = displayHost(tab.url);
  }
}

export const webBrowserState = new WebBrowserState();
