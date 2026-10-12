# simpleSearch

Minimal web search UI (SvelteKit + Bun) on top of the raw [Perplexity Search API](https://docs.perplexity.ai/api-reference/search-post) (`POST /search`).

- Each search runs 3 sequential rounds (up to 60 results): the raw query, then two LLM-generated variants that exclude domains already seen. Duplicate URLs are dropped.
- Results are streamed as NDJSON and re-ranked as each round arrives: a decision model (`typesafe-ai/jev`) scores relevance per round, a reranker (`voyage/rerank-3`) breaks ties and stands in if the decision model fails.
- Query expansion, related searches and scoring go through [Vercel AI Gateway](https://vercel.com/docs/ai-gateway). Without a key, rounds 2–3 fall back to the raw query and results are not scored.
- Google-style operators: `"phrase"`, `-word`, `a OR b`, `site:`, `-site:`, `when:1h|1d|1w|1m|1y`, `after:YYYY-MM-DD`, `before:YYYY-MM-DD`, `lang:ko`. API-backed ones become Perplexity parameters; the rest are applied as post-filters.
- Search history per anonymous browser id (cookie) in SQLite (`bun:sqlite`).

```sh
cp .env.example .env   # set PERPLEXITY_API_KEY, optionally AI_GATEWAY_API_KEY
bun install
bun run dev
```

Env vars are declared in `src/env.ts`. The expansion prompt lives in `src/lib/server/prompts.ts`.
