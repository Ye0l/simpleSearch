import { json } from '@sveltejs/kit';
import { clearHistory, listHistory } from '#lib/server/db.ts';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = ({ locals }) => json(listHistory(locals.clientId));

export const DELETE: RequestHandler = ({ locals }) => {
	clearHistory(locals.clientId);
	return new Response(null, { status: 204 });
};
