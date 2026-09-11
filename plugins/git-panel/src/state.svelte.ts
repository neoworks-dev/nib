class GitPanelState {
  open = $state(false);
  selectedPath = $state<string | null>(null);

  toggle(next?: boolean): void {
    this.open = next ?? !this.open;
  }

  reset(): void {
    this.open = false;
    this.selectedPath = null;
  }
}

export const gitPanelState = new GitPanelState();
