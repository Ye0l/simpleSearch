import { json } from '@sveltejs/kit';
import { listReports } from '#lib/server/db.ts';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = ({ locals }) => json(listReports(locals.clientId));
