import type { Context } from "./context";

export type Disposer = () => void;

/**
 * Service map. Augment from consumer packages:
 *
 *   declare module '@nib-ui/kernel' {
 *     interface Services { sessions: SessionService }
 *   }
 */
// eslint-disable-next-line @typescript-eslint/no-empty-object-type -- declaration-merging anchor; a type alias cannot be augmented.
export interface Services {}

/** Event map. Keys are event names, values are listener signatures. */
export interface Events {
  "internal/service"(name: string, value: unknown): void;
  "internal/plugin"(name: string, state: "activated" | "deactivated"): void;
}

export type ServiceName = keyof Services & string;
export type EventName = keyof Events & string;

export type EventArgs<K extends EventName> = Events[K] extends (...args: infer A) => unknown
  ? A
  : never;
export type EventListener<K extends EventName> = (...args: EventArgs<K>) => void;

/** `[]` for plugins that take no config, `[C]` otherwise — keeps `ctx.use(plugin)` legal. */
export type ConfigArgs<C> = void extends C ? [config?: C] : [config: C];

export interface Plugin<C = void> {
  name: string;
  inject?: ServiceName[];
  apply(ctx: Context, config: C): void | Promise<void>;
}

export interface ForkHandle {
  readonly name: string;
  readonly active: boolean;
  /** Resolves once a pending async `apply` has settled. */
  readonly ready: Promise<void>;
  dispose(): void;
  reload(...config: [config?: unknown]): void;
}
