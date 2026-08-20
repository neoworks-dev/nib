import { error, json, type RequestHandler } from '@sveltejs/kit';
import { z } from 'zod';
import { sessionHost } from '$lib/server/context';

const createBodySchema = z.object({
	harnessId: z.string(),
	cwd: z.string(),
	options: z.record(z.string(), z.unknown()).optional(),
	resume: z.object({ nativeSessionId: z.string(), fork: z.boolean().optional() }).optional(),
});

export const GET: RequestHandler = () => json({ sessions: sessionHost().list() });

export const POST: RequestHandler = async ({ request }) => {
	const body = createBodySchema.safeParse(await request.json());
	if (!body.success) error(400, body.error.message);

	const host = sessionHost();
	const { harnessId, cwd, options, resume } = body.data;
	try {
		const sessionId = resume
			? await host.resume({ harnessId, cwd, options, ...resume })
			: await host.create({ harnessId, cwd, options });
		return json({ sessionId });
	} catch (cause) {
		error(400, cause instanceof Error ? cause.message : 'failed to create session');
	}
};
