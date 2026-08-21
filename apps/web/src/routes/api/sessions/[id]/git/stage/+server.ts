import { error, json, type RequestHandler } from '@sveltejs/kit';
import { z } from 'zod';
import { git } from '$lib/server/context';
import { sessionCwd } from '$lib/server/session-cwd';

const bodySchema = z.object({ paths: z.array(z.string()).min(1), staged: z.boolean() });

export const POST: RequestHandler = async ({ params, request }) => {
	const cwd = sessionCwd(params.id!);
	if (!cwd) error(404, `unknown session "${params.id}"`);
	const body = bodySchema.safeParse(await request.json());
	if (!body.success) error(400, body.error.message);

	const service = git();
	const result = body.data.staged
		? await service.stage(cwd, body.data.paths)
		: await service.unstage(cwd, body.data.paths);
	if (!result.ok) error(400, result.output || 'git failed');
	return json({ ok: true });
};
