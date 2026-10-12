/// <reference types="bun" />
import { Database } from 'bun:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

/** Daily search limit for new accounts */
export const DEFAULT_DAILY_LIMIT = 100;

/**
 * Opens the database and creates or migrates tables. Free of SvelteKit imports so the
 * account scripts in scripts/ can share it.
 */
export function openDatabase(path: string) {
	mkdirSync(dirname(path), { recursive: true });
	const db = new Database(path, { create: true });
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

	// Accounts are created by scripts/create-user.sh; password_hash stays NULL until first login.
	// Only one session per account: a new login overwrites session_hash.
	db.run(`
		CREATE TABLE IF NOT EXISTS users (
			id TEXT PRIMARY KEY,
			password_hash TEXT,
			daily_limit INTEGER NOT NULL DEFAULT ${DEFAULT_DAILY_LIMIT},
			session_hash TEXT,
			created_at INTEGER NOT NULL
		)
	`);
	db.run(`
		CREATE TABLE IF NOT EXISTS usage (
			user_id TEXT NOT NULL,
			day TEXT NOT NULL,
			count INTEGER NOT NULL,
			PRIMARY KEY (user_id, day)
		)
	`);
	return db;
}
