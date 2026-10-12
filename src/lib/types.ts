export interface SearchResult {
	title: string;
	url: string;
	snippet: string;
	date: string | null;
	/** Cosine similarity between the original query and title + snippet */
	score?: number;
	/** Search round (1–3) that found this result */
	round?: number;
}

export interface Expansion {
	/** Extra queries used for rounds 2 and 3 */
	variants: string[];
	/** Related searches shown to the user */
	related: string[];
}

export interface Round {
	query: string;
	/** New (non-duplicate) results this round added */
	count: number;
}

/** NDJSON events streamed by GET /api/search */
export type SearchEvent =
	| { type: 'results'; round: number; query: string; results: SearchResult[] }
	| ({ type: 'expansion' } & Expansion)
	| { type: 'done'; id: number; ms: number }
	| { type: 'error'; message: string };

export interface HistoryItem {
	id: number;
	query: string;
	count: number;
	createdAt: number;
}

export interface CachedSearch extends HistoryItem, Expansion {
	results: SearchResult[];
	rounds: Round[];
}
