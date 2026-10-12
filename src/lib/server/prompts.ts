/**
 * Query expansion prompt. One call returns both the extra queries we search with
 * and the related searches shown to the user.
 */
export const EXPANSION_SYSTEM = `You expand web search queries for a search engine.

Given the user's query, return JSON with:

- "variants": exactly 2 alternative search queries for the SAME information need.
  The results will be merged with results for the original query, so each variant
  should surface different but still relevant pages:
  1. A rephrasing with synonyms, more precise terminology, or the expanded/abbreviated form.
  2. A different angle on the same intent, such as a key subtopic, a comparison,
     or the phrasing an expert or official source would use.
- "related": 6 follow-up searches the user is likely to make next — adjacent topics,
  narrower questions, or common comparisons. Not rephrasings of the original.

Rules:
- Write every query in the same language and script as the user's query (e.g. Korean
  queries use Hangul only — never mix in Chinese characters or another language).
  Keep proper nouns, product names, and code identifiers as written.
- Queries are short, natural search-box phrasing (2–8 words), not questions to an assistant.
- No duplicates, no quotes or search operators, no numbering.
- If the query is ambiguous, cover its most likely meaning.`;

export const EXPANSION_SCHEMA = {
	type: 'object',
	properties: {
		variants: { type: 'array', items: { type: 'string' } },
		related: { type: 'array', items: { type: 'string' } }
	},
	required: ['variants', 'related'],
	additionalProperties: false
};

/** Relevance levels for the decision model; the answer is the expected level index (0–3). */
export const RELEVANCE_LEVELS = [
	{
		label: '0 irrelevant',
		description: 'Different topic, or same words with a different meaning. Useless for this query.'
	},
	{
		label: '1 tangential',
		description: 'Same general topic, but does not address what the query asks.'
	},
	{
		label: '2 partial',
		description:
			'Addresses the query but incompletely, indirectly, or as one part of a broader page.'
	},
	{
		label: '3 direct',
		description:
			'Directly and specifically answers what the query asks; a page the searcher would want first.'
	}
];

export const RELEVANCE_SCALE = `Scale: 0 = lowest (irrelevant), 3 = highest (directly answers the query). Use the full range; most result sets contain both weak and strong results. Judge only the title and snippet shown, against the searcher's intent, not keyword overlap.`;

/* ---------- AI search (research) ---------- */

const LANGUAGE_RULE = `Write in the same language as the user's topic (Korean topics get Korean, Hangul only — never mix in Chinese characters). Keep proper nouns, product names and code identifiers as written.`;

export const PLAN_SYSTEM = `You plan web research for a user who wants a written answer on a topic.

Return JSON with:
- "goal": one or two sentences stating what the final document must answer for this user.
- "criteria": 3–5 short checklist items — the specific facts or points the document needs
  (e.g. dates, numbers, conditions, comparisons, official sources). Each must be checkable
  against search results.
- "queries": exactly 3 web search queries that together cover the criteria. Short,
  search-box phrasing (2–8 words), each aimed at a different criterion or angle.

${LANGUAGE_RULE}
If the topic is ambiguous, plan for its most likely meaning.`;

export const PLAN_SCHEMA = {
	type: 'object',
	properties: {
		goal: { type: 'string' },
		criteria: { type: 'array', items: { type: 'string' } },
		queries: { type: 'array', items: { type: 'string' } }
	},
	required: ['goal', 'criteria', 'queries'],
	additionalProperties: false
};

export const REVIEW_SYSTEM = `You review web search results for a research task.

You get the goal, a numbered list of criteria, the notes gathered so far, and new
search results. Each result has an id in square brackets. Judge only from the titles
and snippets shown.

Return JSON with:
- "picked": the new results worth citing — relevant, specific and credible. For each,
  { "id": <result id>, "reason": a short phrase on what it contributes }. Skip duplicates,
  thin SEO pages, and results that only repeat what the notes already have.
- "notes": new facts extracted from the picked results, one per item, each ending with
  its source id(s) like [3] or [3][7]. Concrete: numbers, dates, names, conditions.
- "covered": indexes (0-based) of ALL criteria the notes so far plus these new notes now
  answer adequately.
- "enough": true when every criterion is covered well enough to write the document.
- "missing": if not enough, one sentence on what is still missing; otherwise "".
- "next": if not enough, 1–3 new search queries aimed at what is missing (different
  from the queries already used); otherwise [].

${LANGUAGE_RULE}`;

export const REVIEW_SCHEMA = {
	type: 'object',
	properties: {
		picked: {
			type: 'array',
			items: {
				type: 'object',
				properties: { id: { type: 'integer' }, reason: { type: 'string' } },
				required: ['id', 'reason'],
				additionalProperties: false
			}
		},
		notes: { type: 'array', items: { type: 'string' } },
		covered: { type: 'array', items: { type: 'integer' } },
		enough: { type: 'boolean' },
		missing: { type: 'string' },
		next: { type: 'array', items: { type: 'string' } }
	},
	required: ['picked', 'notes', 'covered', 'enough', 'missing', 'next'],
	additionalProperties: false
};

export const WRITE_SYSTEM = `You write a concise research document in Markdown from gathered notes and sources.

- Start with a 2–3 sentence summary that directly answers the goal (no heading above it).
- Then sections with "## " headings. Use bullet lists for enumerations; no tables, no HTML.
- Every factual sentence cites its source ids in square brackets, e.g. "... 2026년부터 [3][5]."
  Cite only ids from the provided sources. Never invent facts, numbers or sources.
- If something the goal asks for was not found, say so plainly in a short final section.
- Do not add a sources or references list at the end; it is added separately.

${LANGUAGE_RULE}`;
