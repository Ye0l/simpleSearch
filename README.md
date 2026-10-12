# simpleSearch

Minimal web search UI (SvelteKit + Bun) on top of the raw [Perplexity Search API](https://docs.perplexity.ai/api-reference/search-post) (`POST /search`).

- Each search runs 3 sequential rounds (up to 60 results): the raw query, then two LLM-generated variants that exclude domains already seen. Duplicate URLs are dropped.
- Results are streamed as NDJSON and re-ranked as each round arrives: a decision model (`typesafe-ai/jev`) scores relevance per round. An optional reranker (`RERANK_MODEL`, e.g. `voyage/rerank-3`; off by default) breaks ties and stands in if the decision model fails.
- Query expansion, related searches and scoring go through [Vercel AI Gateway](https://vercel.com/docs/ai-gateway). Without a key, rounds 2–3 fall back to the raw query and results are not scored.
- Google-style operators: `"phrase"`, `-word`, `a OR b`, `site:`, `-site:`, `when:1h|1d|1w|1m|1y`, `after:YYYY-MM-DD`, `before:YYYY-MM-DD`, `lang:ko`. API-backed ones become Perplexity parameters; the rest are applied as post-filters.
- Thumbnails: each result page's `og:image` / `twitter:image` is read from its `<head>` (YouTube thumbnails come from the video id) and streamed after its round. The Search API itself returns no images.
- Accounts only (no sign-up): everything except `/login` requires a session. One session per account; a login on another device signs the previous one out.
- Each account has a daily search limit (default 100, resets at server-local midnight). One search (all 3 rounds) counts once; cached and archived pages are free.
- Search history per account in SQLite (`bun:sqlite`).
- AI search (the **AI** toggle next to the search box): a research model (`RESEARCH_MODEL`, default `deepseek/deepseek-v4.1-flash`) plans 3 queries and a checklist, searches, picks the useful results and checks what is still missing (up to 3 rounds), then writes a Markdown document citing its sources. The whole process streams live: side by side on wide screens, switchable tabs on narrower ones. Requests are pinned to `RESEARCH_PROVIDERS` (default `morph,runware`) via `providerOptions.gateway.only`. Finished reports are saved and listed in the side menu; one AI search counts once against the daily limit.
- Archive (side menu): save a whole results page or single results. Archived entries are copies, so they survive history deletion and re-searches.

```sh
cp .env.example .env   # set PERPLEXITY_API_KEY, optionally AI_GATEWAY_API_KEY
bun install
scripts/create-user.sh <id> [daily_limit]   # default 100; the password is set on first login
bun run dev
```

Accounts:

```sh
scripts/create-user.sh alice        # new account, 100 searches/day
scripts/create-user.sh bob 300      # new account, custom limit
scripts/set-limit.sh alice 50       # change a limit (applies immediately)
scripts/set-limit.sh alice unlimited  # no limit
```

On the login page, an account without a password goes straight to setting one.

Docker: every push to `main` builds `ghcr.io/ye0l/simplesearch` (`latest` + `sha-…` tags) via `.github/workflows/docker.yml`.

```sh
docker compose pull && docker compose up -d       # serves on :5288, data in ./data
docker compose exec app scripts/create-user.sh alice
```

The repo is private, so the package is too: run `docker login ghcr.io` (a token with `read:packages`) on the host first. The container runs as uid 1000, so `./data` must be writable by it.

Env vars are declared in `src/env.ts`. The expansion prompt lives in `src/lib/server/prompts.ts`.
