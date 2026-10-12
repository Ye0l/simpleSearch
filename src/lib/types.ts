export interface SearchResult {
	title: string;
	url: string;
	snippet: string;
	date: string | null;
	/** Relevance 0–1 (decision model, or rerank as fallback) */
	score?: number;
	/** Reranker relevance 0–1, used to break ties */
	rerank?: number;
	/** Search round (1–3) that found this result */
	round?: number;
	/** Page's og:image / twitter:image (https only) */
	image?: string;
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
	/** Thumbnails for an already-sent round, keyed by result URL */
	| { type: 'images'; images: Record<string, string> }
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

/** A saved results page or a single saved result */
export type ArchiveItem =
	| { id: number; kind: 'search'; query: string; count: number; createdAt: number }
	| { id: number; kind: 'result'; query: string; result: SearchResult; createdAt: number };

/** A search result the AI search collected, numbered for citations ([id]) */
export interface Source {
	id: number;
	title: string;
	url: string;
	snippet: string;
	date: string | null;
}

/** NDJSON events streamed by GET /api/research; a saved report is the same list, replayed. */
export type ResearchEvent =
	| { type: 'plan'; goal: string; criteria: string[]; queries: string[] }
	| { type: 'searching'; round: number; queries: string[] }
	| { type: 'results'; round: number; query: string; sources: Source[] }
	| { type: 'reviewing'; round: number }
	| {
			type: 'review';
			round: number;
			picked: { id: number; reason: string }[];
			notes: string[];
			/** Indexes into the plan's criteria that the picked sources now cover */
			covered: number[];
			enough: boolean;
			missing: string;
			next: string[];
	  }
	| { type: 'writing' }
	| { type: 'delta'; text: string }
	| { type: 'done'; id: number; ms: number }
	| { type: 'error'; message: string };

export interface ReportItem {
	id: number;
	topic: string;
	createdAt: number;
}

export interface Report extends ReportItem {
	events: ResearchEvent[];
}
