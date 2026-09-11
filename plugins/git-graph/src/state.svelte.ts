class GitGraphState {
  open = $state(false);
  selectedHash = $state<string | null>(null);

  toggle(next?: boolean): void {
    this.open = next ?? !this.open;
  }

  reset(): void {
    this.open = false;
    this.selectedHash = null;
  }
}

export const gitGraphState = new GitGraphState();
