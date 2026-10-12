import { defineEnvVars } from '@sveltejs/kit/env';

const int = (fallback: number, min: number, max: number) => (value: string | undefined) => {
	if (!value) return fallback;
	const n = Number(value);
	if (!Number.isInteger(n) || n < min || n > max) {
		throw new Error(`must be an integer between ${min} and ${max}`);
	}
	return n;
};

export const variables = defineEnvVars({
	PERPLEXITY_API_KEY: {
		description: 'Perplexity API key (https://www.perplexity.ai/account/api)'
	},
	PERPLEXITY_SEARCH_TYPE: {
		description: '"fast" (default, $1/1k requests) or "web" ($5/1k requests)',
		schema: (value) => {
			if (!value) return 'fast';
			if (value !== 'web' && value !== 'fast') throw new Error('must be "web" or "fast"');
			return value;
		}
	},
	PERPLEXITY_MAX_RESULTS: {
		description: 'Results per query, 1–20',
		schema: int(20, 1, 20)
	},
	PERPLEXITY_MAX_TOKENS_PER_PAGE: {
		description: 'Snippet length budget per result',
		schema: int(256, 1, 1_000_000)
	},
	PERPLEXITY_COUNTRY: {
		description: 'Optional ISO 3166-1 alpha-2 country code, e.g. KR',
		schema: (value) => value || undefined
	},
	AI_GATEWAY_API_KEY: {
		description: 'Vercel AI Gateway key for query expansion. Empty = fall back to the raw query',
		schema: (value) => value || undefined
	},
	AI_MODEL: {
		description: 'AI Gateway model id used for query expansion',
		schema: (value) => value || 'anthropic/claude-haiku-5.5'
	},
	EMBEDDING_MODEL: {
		description: 'AI Gateway embedding model used to score results against the query',
		schema: (value) => value || 'perplexity/pplx-embed-v1-4b'
	},
	DATABASE_PATH: {
		description: 'SQLite file for search history',
		schema: (value) => value || 'data/search.db'
	}
});
