/**
 * Push-based async iterable used as the SDK `prompt`. Streaming input mode is
 * what makes `interrupt()` and `setPermissionMode()` available, and it needs an
 * iterable that stays open for the life of the session.
 */
export class AsyncMessageQueue<T> implements AsyncIterable<T> {
	private readonly buffered: T[] = [];
	private waiting: ((result: IteratorResult<T>) => void) | null = null;
	private closed = false;

	push(item: T): void {
		if (this.closed) throw new Error('cannot push to a closed queue');
		const waiting = this.waiting;
		this.waiting = null;
		if (waiting) return waiting({ value: item, done: false });
		this.buffered.push(item);
	}

	close(): void {
		if (this.closed) return;
		this.closed = true;
		const waiting = this.waiting;
		this.waiting = null;
		waiting?.({ value: undefined, done: true });
	}

	async *[Symbol.asyncIterator](): AsyncIterator<T> {
		while (true) {
			const buffered = this.buffered.shift();
			if (buffered !== undefined) {
				yield buffered;
				continue;
			}
			if (this.closed) return;
			const next = await new Promise<IteratorResult<T>>((resolve) => {
				this.waiting = resolve;
			});
			if (next.done) return;
			yield next.value;
		}
	}
}
