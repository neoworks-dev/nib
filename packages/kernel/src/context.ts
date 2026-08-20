import { Kernel, type EvaluableFork } from './kernel';
import { Scope } from './scope';
import type {
	ConfigArgs,
	Disposer,
	EventArgs,
	EventListener,
	EventName,
	ForkHandle,
	Plugin,
	ServiceName,
	Services,
} from './types';

class Fork<C> implements EvaluableFork, ForkHandle {
	active = false;
	ready: Promise<void> = Promise.resolve();
	private childScope: Scope | null = null;
	private settling = false;
	private readonly detach: Disposer;

	constructor(
		private readonly kernel: Kernel,
		private readonly parentScope: Scope,
		private readonly plugin: Plugin<C>,
		private config: C,
	) {
		kernel.forks.add(this);
		this.detach = parentScope.register(() => {
			this.settling = true;
			kernel.forks.delete(this);
			this.deactivate();
		});
	}

	get name(): string {
		return this.plugin.name;
	}

	/** Guards against a teardown-triggered `flush()` reactivating a fork mid-unwind. */
	evaluate(): boolean {
		if (this.settling) return false;
		const satisfied = (this.plugin.inject ?? []).every((service) => this.kernel.services.has(service));
		if (satisfied === this.active) return false;
		if (satisfied) this.activate();
		else this.deactivate();
		return true;
	}

	private activate(): void {
		const scope = this.parentScope.fork();
		this.childScope = scope;
		this.active = true;
		try {
			const result = this.plugin.apply(new Context(this.kernel, scope), this.config);
			this.ready = Promise.resolve(result).then(() => undefined);
			this.ready.catch(() => undefined);
		} catch (error) {
			this.deactivate();
			throw error;
		}
		this.kernel.emit('internal/plugin', [this.plugin.name, 'activated']);
	}

	private deactivate(): void {
		if (!this.active && !this.childScope) return;
		const wasSettling = this.settling;
		this.settling = true;
		this.active = false;
		this.childScope?.dispose();
		this.childScope = null;
		this.ready = Promise.resolve();
		this.settling = wasSettling;
		this.kernel.emit('internal/plugin', [this.plugin.name, 'deactivated']);
	}

	reload(...config: [config?: unknown]): void {
		if (config.length > 0) this.config = config[0] as C;
		this.deactivate();
		this.kernel.flush();
	}

	dispose(): void {
		this.detach();
	}
}

export class Context {
	constructor(
		readonly kernel: Kernel,
		readonly scope: Scope,
	) {}

	use<C>(plugin: Plugin<C>, ...config: ConfigArgs<C>): ForkHandle {
		const fork = new Fork(this.kernel, this.scope, plugin, config[0] as C);
		fork.evaluate();
		this.kernel.flush();
		return fork;
	}

	provide<K extends ServiceName>(name: K, value: Services[K]): Disposer {
		if (this.kernel.services.has(name)) throw new Error(`service "${name}" is already provided`);
		this.kernel.services.set(name, value);
		this.kernel.emit('internal/service', [name, value]);
		const remove = this.scope.register(() => {
			this.kernel.services.delete(name);
			this.kernel.emit('internal/service', [name, undefined]);
			this.kernel.flush();
		});
		this.kernel.flush();
		return remove;
	}

	get<K extends ServiceName>(name: K): Services[K] | undefined {
		return this.kernel.services.get(name) as Services[K] | undefined;
	}

	require<K extends ServiceName>(name: K): Services[K] {
		if (!this.kernel.services.has(name)) throw new Error(`service "${name}" is not available`);
		return this.kernel.services.get(name) as Services[K];
	}

	on<K extends EventName>(event: K, listener: EventListener<K>): Disposer {
		const remove = this.kernel.addListener(event, listener as unknown as (...args: never[]) => void);
		return this.scope.register(remove);
	}

	emit<K extends EventName>(event: K, ...args: EventArgs<K>): void {
		this.kernel.emit(event, args as unknown[]);
	}

	effect(setup: () => Disposer | void): Disposer {
		const cleanup = setup();
		return this.scope.register(() => cleanup?.());
	}

	/** Child scope for callers that need their own disposal boundary without a plugin. */
	fork(): Context {
		return new Context(this.kernel, this.scope.fork());
	}

	dispose(): void {
		this.scope.dispose();
	}
}

export function createContext(): Context {
	return new Context(new Kernel(), new Scope());
}
