import { error, json } from '@sveltejs/kit';
import { deleteReport, getReport } from '#lib/server/db.ts';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = ({ params, locals }) => {
	const report = getReport(locals.clientId, Number(params.id));
	if (!report) error(404, 'Report not found');
	return json(report);
};

export const DELETE: RequestHandler = ({ params, locals }) => {
	deleteReport(locals.clientId, Number(params.id));
	return new Response(null, { status: 204 });
};
