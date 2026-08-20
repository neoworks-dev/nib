import { error, json, type RequestHandler } from '@sveltejs/kit';
import { sessionCommandSchema } from '@nib-ui/protocol';
import { sessionHost } from '$lib/server/context';

export const POST: RequestHandler = async ({ params, request }) => {
	const command = sessionCommandSchema.safeParse(await request.json());
	if (!command.success) error(400, command.error.message);

	const host = sessionHost();
	if (!host.has(params.id!)) error(404, `unknown session "${params.id}"`);

	try {
		await host.execute(params.id!, command.data);
		return json({ ok: true });
	} catch (cause) {
		error(400, cause instanceof Error ? cause.message : 'command failed');
	}
};
