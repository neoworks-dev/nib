/**
 * The one place the desktop agent touches `node:child_process`. Everything else in this
 * directory works against `SidecarProcess`, which is why the supervisor is testable.
 */
import { spawn } from 'node:child_process';
import { StringDecoder } from 'node:string_decoder';
import type { SidecarProcess } from './supervisor';

/**
 * A chunk boundary can land inside a multi-byte sequence, so the stream is decoded
 * incrementally rather than per chunk; `FrameReader` then only ever sees whole characters.
 */
/**
 * `ChildProcess` gets its event methods from an interface merge (`interface ChildProcess
 * extends InternalEventEmitter<ChildProcessEventMap>`) that does not resolve under this
 * package's tsconfig, and `skipLibCheck` turns that into missing members rather than an
 * error. The emitter half is addressed through this instead; only the two events used
 * here are declared, so nothing is loosened beyond them.
 */
interface ChildProcessEvents {
	on(event: 'error', listener: (cause: Error) => void): void;
	on(event: 'exit', listener: (code: number | null, signal: string | null) => void): void;
}

function decodeStream(onText: (text: string) => void): (chunk: Buffer) => void {
	const decoder = new StringDecoder('utf8');
	return (chunk) => {
		const text = decoder.write(chunk);
		if (text.length > 0) onText(text);
	};
}

export function spawnSidecarProcess(executable: string): SidecarProcess {
	const child = spawn(executable, [], { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });

	return {
		write(line) {
			child.stdin.write(line);
		},
		kill(signal) {
			child.kill(signal);
		},
		onStdout(listener) {
			child.stdout.on('data', decodeStream(listener));
		},
		onStderr(listener) {
			child.stderr.on('data', decodeStream(listener));
		},
		onExit(listener) {
			const events = child as unknown as ChildProcessEvents;
			// `error` fires instead of `exit` when the binary is missing or not executable,
			// and the supervisor treats both the same way: the process is gone, with a reason.
			events.on('error', (cause) => listener(cause.message));
			events.on('exit', (code, signal) => listener(signal ? `killed by ${signal}` : `code ${code ?? 'unknown'}`));
		},
	};
}
