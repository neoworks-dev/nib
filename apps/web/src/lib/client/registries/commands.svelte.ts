import type {
  CommandRegistration,
  CommandRegistry,
  SearchProvider,
  SearchResult,
} from "@nib-ui/ui-contracts";

export class ReactiveCommandRegistry implements CommandRegistry {
  paletteOpen = $state(false);
  private commands = $state<CommandRegistration[]>([]);
  // Raw, not deep: reading a `$state` array hands back proxies of its entries, and
  // the disposer has nothing but the provider's identity to remove it by.
  private providers = $state.raw<SearchProvider[]>([]);

  register(command: CommandRegistration) {
    this.commands = [...this.commands, command];
    return () => {
      this.commands = this.commands.filter((entry) => entry !== command);
    };
  }

  list(): CommandRegistration[] {
    return this.commands;
  }

  run(id: string) {
    const command = this.commands.find((entry) => entry.id === id);
    if (!command) throw new Error(`unknown command "${id}"`);
    return command.run();
  }

  registerSearch(provider: SearchProvider): () => void {
    this.providers = [...this.providers, provider];
    return () => {
      this.providers = this.providers.filter((entry) => entry !== provider);
    };
  }

  /** Groups in contributed order; a group with nothing to say is left out. */
  search(query: string): { group: string; results: SearchResult[] }[] {
    const groups: { group: string; results: SearchResult[] }[] = [];
    const ordered = [...this.providers].sort(
      (left, right) => (left.order ?? 0) - (right.order ?? 0),
    );
    for (const provider of ordered) {
      const results = provider.search(query);
      if (results.length > 0) groups.push({ group: provider.group, results });
    }
    return groups;
  }

  togglePalette(open?: boolean) {
    this.paletteOpen = open ?? !this.paletteOpen;
  }
}
