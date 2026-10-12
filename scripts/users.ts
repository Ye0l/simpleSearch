// Account admin for the sh wrappers in this folder. Run from the project root (bun loads .env).
import { DEFAULT_DAILY_LIMIT, UNLIMITED, openDatabase } from '../src/lib/server/schema.ts';

const ID = /^[a-z0-9][a-z0-9._-]{1,31}$/;
const [command, rawId, rawLimit] = process.argv.slice(2);
const id = rawId?.trim().toLowerCase() ?? '';

function fail(message: string): never {
	console.error(message);
	process.exit(1);
}

function parseLimit(value: string | undefined, fallback?: number) {
	if (value === undefined && fallback !== undefined) return fallback;
	if (value === 'unlimited') return UNLIMITED;
	const n = Number(value);
	if (!Number.isInteger(n) || n < 0) {
		fail(`한도는 0 이상의 정수 또는 unlimited여야 해요 (입력: "${value ?? ''}")`);
	}
	return n;
}

const describe = (limit: number) => (limit === UNLIMITED ? '무제한' : `${limit}회`);

const db = openDatabase(process.env.DATABASE_PATH || 'data/search.db');
const exists = () => !!db.query('SELECT 1 FROM users WHERE id = ?').get(id);

switch (command) {
	case 'create': {
		if (!ID.test(id)) fail('아이디는 2–32자, 영소문자·숫자·. _ - 만 쓸 수 있고 영문/숫자로 시작해야 해요');
		const limit = parseLimit(rawLimit, DEFAULT_DAILY_LIMIT);
		if (exists()) fail(`"${id}"는 이미 있는 아이디예요`);
		db.query('INSERT INTO users (id, daily_limit, created_at) VALUES (?, ?, ?)').run(id, limit, Date.now());
		console.log(`"${id}" 생성 완료 (일일 한도 ${describe(limit)}). 비밀번호는 첫 로그인 때 설정해요.`);
		break;
	}
	case 'limit': {
		const limit = parseLimit(rawLimit);
		if (!exists()) fail(`"${id}" 아이디가 없어요`);
		db.query('UPDATE users SET daily_limit = ? WHERE id = ?').run(limit, id);
		console.log(`"${id}" 일일 한도: ${describe(limit)}`);
		break;
	}
	default:
		fail('Usage: bun scripts/users.ts create <id> [daily_limit] | limit <id> <daily_limit>');
}
