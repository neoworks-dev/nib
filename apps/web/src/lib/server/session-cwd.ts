import { sessionHost } from './context';

/** Every session-scoped route resolves the working directory the same way. */
export function sessionCwd(sessionId: string): string | null {
	return (
		sessionHost()
			.list()
			.find((session) => session.id === sessionId)?.cwd ?? null
	);
}
