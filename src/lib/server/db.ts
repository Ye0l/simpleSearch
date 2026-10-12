/// <reference types="bun" />
import { Database } from 'bun:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DATABASE_PATH } from '$app/env/private';
import type { CachedSearch, Expansion, HistoryItem, Round, SearchResult } from '#lib/types.ts';

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
