import { usageOf } from '#lib/server/usage.ts';
import type { LayoutServerLoad } from './$types';

export const load: LayoutServerLoad = ({ locals }) => ({
	user: locals.user && { id: locals.user.id, usage: usageOf(locals.user) }
});
