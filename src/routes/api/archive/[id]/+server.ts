import { error, json } from '@sveltejs/kit';
import { deleteArchived, getArchivedSearch } from '#lib/server/db.ts';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = ({ params, locals }) => {
	const entry = getArchivedSearch(locals.clientId, Number(params.id));
	if (!entry) error(404, 'Archived search not found');
	return json(entry);
};

export const DELETE: RequestHandler = ({ params, locals }) => {
	deleteArchived(locals.clientId, Number(params.id));
	return new Response(null, { status: 204 });
};
