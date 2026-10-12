/// <reference types="bun" />
import type { Cookies } from '@sveltejs/kit';
import { setSession } from '#lib/server/db.ts';

export const SESSION_COOKIE = 'session';
const SESSION_DAYS = 30;
export const MIN_PASSWORD = 8;

export const normalizeId = (id: unknown) => (typeof id === 'string' ? id.trim().toLowerCase() : '');

/** Only the hash is stored, so a leaked database can't be used to sign in. */
export function hashToken(token: string) {
	return new Bun.CryptoHasher('sha256').update(token).digest('hex');
}

export const hashPassword = (password: string) => Bun.password.hash(password);
export const verifyPassword = (password: string, hash: string) =>
	Bun.password.verify(password, hash);

/** Starts a new session for the account, replacing (and so signing out) any existing one. */
export function startSession(cookies: Cookies, url: URL, id: string) {
	const token = Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString('base64url');
	setSession(id, hashToken(token));
	cookies.set(SESSION_COOKIE, token, {
		path: '/',
		httpOnly: true,
		sameSite: 'lax',
		// Plain http on a LAN address would otherwise drop the cookie.
		secure: url.protocol === 'https:',
		maxAge: 60 * 60 * 24 * SESSION_DAYS
	});
}

// Slows down password guessing: after MAX_FAILURES wrong passwords, the id is locked briefly.
const MAX_FAILURES = 5;
const LOCK_MS = 60_000;
const failures = new Map<string, { count: number; until: number }>();

export function isLocked(id: string) {
	const f = failures.get(id);
	return !!f && f.count >= MAX_FAILURES && f.until > Date.now();
}

export function recordFailure(id: string) {
	const f = failures.get(id);
	const count = f && f.until > Date.now() ? f.count + 1 : 1;
	failures.set(id, { count, until: Date.now() + LOCK_MS });
}

export const clearFailures = (id: string) => failures.delete(id);
