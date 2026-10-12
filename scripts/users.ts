// Account admin for the sh wrappers in this folder. Run from the project root (bun loads .env).
import { DEFAULT_DAILY_BUDGET, UNLIMITED, openDatabase } from '../src/lib/server/schema.ts';

const ID = /^[a-z0-9][a-z0-9._-]{1,31}$/;
const [command, rawId, rawBudget] = process.argv.slice(2);
const id = rawId?.trim().toLowerCase() ?? '';

function fail(message: string): never {
	console.error(message);
	process.exit(1);
}

/** "150%" of the default budget, "$1" / "1" USD per day, or "unlimited"; micro-USD out. */
function parseBudget(value: string | undefined, fallback?: number) {
	if (value === undefined && fallback !== undefined) return fallback;
	if (value === 'unlimited') return UNLIMITED;
	const percent = /^(\d+(?:\.\d+)?)%$/.exec(value ?? '');
	const usd = /^\$?(\d+(?:\.\d+)?)$/.exec(value ?? '');
	if (percent) return Math.round((DEFAULT_DAILY_BUDGET * Number(percent[1])) / 100);
	if (usd) return Math.round(Number(usd[1]) * 1_000_000);
	fail(`한도는 기본값 대비 %(예: 150%), 달러(예: $1), 또는 unlimited여야 해요 (입력: "${value ?? ''}")`);
}

const describe = (budget: number) =>
	budget === UNLIMITED
		? '무제한'
		: `$${(budget / 1_000_000).toFixed(2)}/일 (기본값의 ${Math.round((budget / DEFAULT_DAILY_BUDGET) * 100)}%)`;

const db = openDatabase(process.env.DATABASE_PATH || 'data/search.db');
const exists = () => !!db.query('SELECT 1 FROM users WHERE id = ?').get(id);

switch (command) {
	case 'create': {
		if (!ID.test(id)) fail('아이디는 2–32자, 영소문자·숫자·. _ - 만 쓸 수 있고 영문/숫자로 시작해야 해요');
		const budget = parseBudget(rawBudget, DEFAULT_DAILY_BUDGET);
		if (exists()) fail(`"${id}"는 이미 있는 아이디예요`);
		db.query('INSERT INTO users (id, daily_budget, created_at) VALUES (?, ?, ?)').run(id, budget, Date.now());
		console.log(`"${id}" 생성 완료 (일일 한도 ${describe(budget)}). 비밀번호는 첫 로그인 때 설정해요.`);
		break;
	}
	case 'limit': {
		const budget = parseBudget(rawBudget);
		if (!exists()) fail(`"${id}" 아이디가 없어요`);
		db.query('UPDATE users SET daily_budget = ? WHERE id = ?').run(budget, id);
		console.log(`"${id}" 일일 한도: ${describe(budget)}`);
		break;
	}
	default:
		fail('Usage: bun scripts/users.ts create <id> [budget] | limit <id> <budget>   (budget: 150% | $1 | unlimited)');
}
