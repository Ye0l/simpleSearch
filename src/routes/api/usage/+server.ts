import { json } from '@sveltejs/kit';
import { usageOf } from '#lib/server/usage.ts';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = ({ locals }) => json(usageOf(locals.user!));
