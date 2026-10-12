import { error, json } from '@sveltejs/kit';
import {
	MIN_PASSWORD,
	clearFailures,
	hashPassword,
	isLocked,
	normalizeId,
	recordFailure,
	startSession,
	verifyPassword
} from '#lib/server/auth.ts';
import { getAccount, setFirstPassword } from '#lib/server/db.ts';
import type { RequestHandler } from './$types';

/** Signs in, or sets the password first for an account that has none yet. */
export const POST: RequestHandler = async ({ request, cookies, url }) => {
	const body = await request.json().catch(() => null);
	const id = normalizeId(body?.id);
	const password = typeof body?.password === 'string' ? body.password : '';
	const account = getAccount(id);
	if (!account) error(404, '등록되지 않은 아이디예요');
	if (isLocked(id)) error(429, '로그인 시도가 너무 많아요. 1분 뒤에 다시 해 주세요');

	if (!account.passwordHash) {
		if (password.length < MIN_PASSWORD) error(400, `비밀번호는 ${MIN_PASSWORD}자 이상이어야 해요`);
		if (!setFirstPassword(id, await hashPassword(password))) {
			error(409, '이미 비밀번호가 설정된 아이디예요');
		}
	} else if (!(await verifyPassword(password, account.passwordHash))) {
		recordFailure(id);
		error(401, '비밀번호가 맞지 않아요');
	}

	clearFailures(id);
	startSession(cookies, url, id);
	return json({ id });
};
