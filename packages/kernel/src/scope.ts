import type { Disposer } from "./types";

/**
 * A node in the disposal tree. Everything a plugin registers — services,
 * listeners, timers, child scopes — lands in one ordered list so `dispose()`
 * rolls the whole subtree back in reverse registration order.
 */
export class Scope {
  disposed = false;
  private readonly entries: Disposer[] = [];

  constructor(readonly parent: Scope | null = null) {
    parent?.register(() => this.dispose());
  }

  register(disposer: Disposer): Disposer {
    if (this.disposed) {
      disposer();
      return () => {};
    }
    this.entries.push(disposer);
    return () => {
      const index = this.entries.indexOf(disposer);
      if (index < 0) return;
      this.entries.splice(index, 1);
      disposer();
    };
  }

  fork(): Scope {
    return new Scope(this);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    while (this.entries.length > 0) this.entries.pop()!();
  }
}
