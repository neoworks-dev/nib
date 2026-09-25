import type { ComposerTarget, ComposerTargetRegistry } from "@nib-ui/ui-contracts";

/** The composer targets plugins registered, in registration order. */
export class ReactiveComposerTargetRegistry implements ComposerTargetRegistry {
  targets = $state<ComposerTarget[]>([]);

  /** Adds a target; the disposer takes it out again. */
  register(target: ComposerTarget) {
    this.targets = [...this.targets, target];
    return () => {
      this.targets = this.targets.filter((candidate) => candidate !== target);
    };
  }
}
