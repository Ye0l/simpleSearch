import { DATABASE_PATH } from '$app/env/private';
import { UNLIMITED, openDatabase } from '#lib/server/schema.ts';
import type {
	ArchiveItem,
	CachedSearch,
	Expansion,
	HistoryItem,
	Report,
	ReportItem,
	ResearchEvent,
	Round,
	SearchResult
} from '#lib/types.ts';

const db = openDatabase(DATABASE_PATH);

interface Row {
	id: number;
	query: string;
	results: string;
	expansion: string;
	rounds: string;
	created_at: number;
}

/** Saves a search, replacing any older entry for the same query. */
export function saveSearch(
	clientId: string,
	query: string,
	results: SearchResult[],
	expansion: Expansion,
	rounds: Round[]
): number {
	return db.transaction(() => {
		db.query('DELETE FROM searches WHERE client_id = ? AND query = ?').run(clientId, query);
		const { lastInsertRowid } = db
			.query(
				'INSERT INTO searches (client_id, query, results, expansion, rounds, created_at) VALUES (?, ?, ?, ?, ?, ?)'
			)
			.run(
				clientId,
				query,
				JSON.stringify(results),
				JSON.stringify(expansion),
				JSON.stringify(rounds),
				Date.now()
			);
		return Number(lastInsertRowid);
	})();
}

export function listHistory(clientId: string, limit = 20): HistoryItem[] {
	return db
		.query<Row & { count: number }, [string, number]>(
			`SELECT id, query, json_array_length(results) AS count, created_at
			 FROM searches WHERE client_id = ? ORDER BY created_at DESC LIMIT ?`
		)
		.all(clientId, limit)
		.map((r) => ({ id: r.id, query: r.query, count: r.count, createdAt: r.created_at }));
}

export function getSearch(clientId: string, id: number): CachedSearch | null {
	const row = db
		.query<Row, [number, string]>(
			'SELECT id, query, results, expansion, rounds, created_at FROM searches WHERE id = ? AND client_id = ?'
		)
		.get(id, clientId);
	if (!row) return null;
	const results: SearchResult[] = JSON.parse(row.results);
	const expansion: Expansion = JSON.parse(row.expansion);
	return {
		id: row.id,
		query: row.query,
		results,
		...expansion,
		rounds: JSON.parse(row.rounds),
		count: results.length,
		createdAt: row.created_at
	};
}

export function deleteSearch(clientId: string, id: number) {
	db.query('DELETE FROM searches WHERE id = ? AND client_id = ?').run(id, clientId);
}

export function clearHistory(clientId: string) {
	db.query('DELETE FROM searches WHERE client_id = ?').run(clientId);
}

interface ArchiveRow {
	id: number;
	kind: 'search' | 'result';
	query: string;
	data: string;
	created_at: number;
}

function insertArchive(clientId: string, kind: ArchiveRow['kind'], query: string, data: object) {
	const { lastInsertRowid } = db
		.query('INSERT INTO archive (client_id, kind, query, data, created_at) VALUES (?, ?, ?, ?, ?)')
		.run(clientId, kind, query, JSON.stringify(data), Date.now());
	return Number(lastInsertRowid);
}

/** Copies a stored search into the archive. Returns null if it isn't the client's. */
export function archiveSearch(clientId: string, searchId: number): number | null {
	const search = getSearch(clientId, searchId);
	if (!search) return null;
	const { results, variants, related, rounds } = search;
	return insertArchive(clientId, 'search', search.query, { results, variants, related, rounds });
}

export function archiveResult(clientId: string, query: string, result: SearchResult): number {
	return insertArchive(clientId, 'result', query, result);
}

export function listArchive(clientId: string): ArchiveItem[] {
	return db
		.query<ArchiveRow, [string]>(
			`SELECT id, kind, query, CASE kind WHEN 'search' THEN json_array_length(data, '$.results') ELSE data END AS data, created_at
			 FROM archive WHERE client_id = ? ORDER BY created_at DESC`
		)
		.all(clientId)
		.map((r) =>
			r.kind === 'search'
				? { id: r.id, kind: r.kind, query: r.query, count: Number(r.data), createdAt: r.created_at }
				: { id: r.id, kind: r.kind, query: r.query, result: JSON.parse(r.data), createdAt: r.created_at }
		);
}

/** An archived results page, in the same shape as a cached search. */
export function getArchivedSearch(clientId: string, id: number): CachedSearch | null {
	const row = db
		.query<ArchiveRow, [number, string]>(
			"SELECT id, kind, query, data, created_at FROM archive WHERE id = ? AND client_id = ? AND kind = 'search'"
		)
		.get(id, clientId);
	if (!row) return null;
	const data: Omit<CachedSearch, keyof HistoryItem> = JSON.parse(row.data);
	return { ...data, id: row.id, query: row.query, count: data.results.length, createdAt: row.created_at };
}

export function deleteArchived(clientId: string, id: number) {
	db.query('DELETE FROM archive WHERE id = ? AND client_id = ?').run(id, clientId);
}

export interface Account {
	id: string;
	passwordHash: string | null;
	/** Micro-USD per day, or UNLIMITED */
	dailyBudget: number;
}

export function getAccount(id: string): Account | null {
	const row = db
		.query<{ id: string; password_hash: string | null; daily_budget: number }, [string]>(
			'SELECT id, password_hash, daily_budget FROM users WHERE id = ?'
		)
		.get(id);
	return row && { id: row.id, passwordHash: row.password_hash, dailyBudget: row.daily_budget };
}

/** Sets the first password. Returns false if one was already set (e.g. a concurrent sign-up). */
export function setFirstPassword(id: string, hash: string) {
	return (
		db.query('UPDATE users SET password_hash = ? WHERE id = ? AND password_hash IS NULL').run(hash, id)
			.changes === 1
	);
}

/** Replaces the account's session, which signs out any other device. */
export function setSession(id: string, sessionHash: string | null) {
	db.query('UPDATE users SET session_hash = ? WHERE id = ?').run(sessionHash, id);
}

export function accountBySession(sessionHash: string): Account | null {
	const row = db
		.query<{ id: string }, [string]>('SELECT id FROM users WHERE session_hash = ?')
		.get(sessionHash);
	return row && getAccount(row.id);
}

/** Server-local date, so the limit resets at local midnight. */
const today = () => new Date().toLocaleDateString('sv-SE');

/** Estimated API cost spent today, micro-USD */
export function spentToday(id: string): number {
	return (
		db
			.query<{ cost: number }, [string, string]>(
				'SELECT cost FROM usage WHERE user_id = ? AND day = ?'
			)
			.get(id, today())?.cost ?? 0
	);
}

/**
 * Starts a metered request. Returns false once today's budget is used up; a request that
 * starts under budget may finish over it.
 */
export function startSearch(id: string, budget: number): boolean {
	if (budget !== UNLIMITED && spentToday(id) >= budget) return false;
	db.query(
		`INSERT INTO usage (user_id, day, count) VALUES (?, ?, 1)
		 ON CONFLICT (user_id, day) DO UPDATE SET count = count + 1`
	).run(id, today());
	return true;
}

/** Adds a finished request's estimated cost (micro-USD) to today's usage. */
export function addCost(id: string, micros: number) {
	if (micros <= 0) return;
	db.query(
		`INSERT INTO usage (user_id, day, count, cost) VALUES (?, ?, 0, ?)
		 ON CONFLICT (user_id, day) DO UPDATE SET cost = cost + excluded.cost`
	).run(id, today(), micros);
}

export function saveReport(clientId: string, topic: string, events: ResearchEvent[]): number {
	const { lastInsertRowid } = db
		.query('INSERT INTO reports (client_id, topic, events, created_at) VALUES (?, ?, ?, ?)')
		.run(clientId, topic, JSON.stringify(events), Date.now());
	return Number(lastInsertRowid);
}

export function listReports(clientId: string): ReportItem[] {
	return db
		.query<{ id: number; topic: string; created_at: number }, [string]>(
			'SELECT id, topic, created_at FROM reports WHERE client_id = ? ORDER BY created_at DESC'
		)
		.all(clientId)
		.map((r) => ({ id: r.id, topic: r.topic, createdAt: r.created_at }));
}

export function getReport(clientId: string, id: number): Report | null {
	const row = db
		.query<{ id: number; topic: string; events: string; created_at: number }, [number, string]>(
			'SELECT id, topic, events, created_at FROM reports WHERE id = ? AND client_id = ?'
		)
		.get(id, clientId);
	return (
		row && { id: row.id, topic: row.topic, events: JSON.parse(row.events), createdAt: row.created_at }
	);
}

export function deleteReport(clientId: string, id: number) {
	db.query('DELETE FROM reports WHERE id = ? AND client_id = ?').run(id, clientId);
}
