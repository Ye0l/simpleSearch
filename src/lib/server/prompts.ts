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
