/// <reference types="bun" />
import { Database } from 'bun:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DATABASE_PATH } from '$app/env/private';
import type {
	ArchiveItem,
	CachedSearch,
	Expansion,
	HistoryItem,
	Round,
	SearchResult
} from '#lib/types.ts';

mkdirSync(dirname(DATABASE_PATH), { recursive: true });

const db = new Database(DATABASE_PATH, { create: true });
db.run('PRAGMA journal_mode = WAL');
db.run(`
	CREATE TABLE IF NOT EXISTS searches (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		client_id TEXT NOT NULL,
		query TEXT NOT NULL,
		results TEXT NOT NULL,
		created_at INTEGER NOT NULL
	)
`);
db.run('CREATE INDEX IF NOT EXISTS searches_client ON searches (client_id, created_at DESC)');

const columns = db.query<{ name: string }, []>('PRAGMA table_info(searches)').all();
if (!columns.some((c) => c.name === 'expansion')) {
	db.run(`ALTER TABLE searches ADD COLUMN expansion TEXT NOT NULL DEFAULT '{"variants":[],"related":[]}'`);
}
if (!columns.some((c) => c.name === 'rounds')) {
	db.run(`ALTER TABLE searches ADD COLUMN rounds TEXT NOT NULL DEFAULT '[]'`);
}

// Archive entries are copies, so they survive history deletion and re-searches.
db.run(`
	CREATE TABLE IF NOT EXISTS archive (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		client_id TEXT NOT NULL,
		kind TEXT NOT NULL,
		query TEXT NOT NULL,
		data TEXT NOT NULL,
		created_at INTEGER NOT NULL
	)
`);
db.run('CREATE INDEX IF NOT EXISTS archive_client ON archive (client_id, created_at DESC)');

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
