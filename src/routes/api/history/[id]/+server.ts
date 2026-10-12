import { error, json } from '@sveltejs/kit';
import { deleteSearch, getSearch } from '#lib/server/db.ts';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = ({ params, locals }) => {
	const entry = getSearch(locals.clientId, Number(params.id));
	if (!entry) error(404, 'Search not found');
	return json(entry);
};

export const DELETE: RequestHandler = ({ params, locals }) => {
	deleteSearch(locals.clientId, Number(params.id));
	return new Response(null, { status: 204 });
};
