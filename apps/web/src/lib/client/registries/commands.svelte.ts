import type { CommandRegistration, CommandRegistry } from '@nib-ui/ui-contracts';

export class ReactiveCommandRegistry implements CommandRegistry {
	paletteOpen = $state(false);
	private commands = $state<CommandRegistration[]>([]);

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

	togglePalette(open?: boolean) {
		this.paletteOpen = open ?? !this.paletteOpen;
	}
}
