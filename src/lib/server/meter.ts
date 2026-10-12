import { PERPLEXITY_SEARCH_TYPE } from '$app/env/private';

/** Search API price per request, USD */
const SEARCH_PRICE = { fast: 0.001, web: 0.005 };
const PRICES_TTL_MS = 6 * 60 * 60 * 1000;

/** Adds up the estimated API cost of one request (searches + AI Gateway calls), in USD. */
export class Meter {
	usd = 0;

	add(usd: number) {
		if (Number.isFinite(usd) && usd > 0) this.usd += usd;
	}

	search() {
		this.add(SEARCH_PRICE[PERPLEXITY_SEARCH_TYPE]);
	}

	/** Chat completions: the gateway reports the charged amount; otherwise price the tokens. */
	async chat(model: string, usage: { cost?: number; prompt_tokens?: number; completion_tokens?: number } | undefined) {
		if (!usage) return;
		if (typeof usage.cost === 'number') return this.add(usage.cost);
		this.add(await tokenCost(model, usage.prompt_tokens ?? 0, usage.completion_tokens ?? 0));
	}

	/** Decisions and rerank report tokens only. */
	async tokens(model: string, input: number, output = 0) {
		this.add(await tokenCost(model, input, output));
	}

	get micros() {
		return Math.round(this.usd * 1_000_000);
	}
}

let prices: Promise<Map<string, { input: number; output: number }>> | null = null;
let pricesAt = 0;

/** Per-token prices from the AI Gateway model list, cached for a few hours. */
function loadPrices() {
	if (!prices || Date.now() - pricesAt > PRICES_TTL_MS) {
		pricesAt = Date.now();
		prices = fetch('https://ai-gateway.vercel.sh/v1/models', { signal: AbortSignal.timeout(5000) })
			.then((res) => res.json())
			.then(
				(data: { data: { id: string; pricing?: { input?: string; output?: string } }[] }) =>
					new Map(
						data.data.map((m) => [
							m.id,
							{ input: Number(m.pricing?.input ?? 0), output: Number(m.pricing?.output ?? 0) }
						])
					)
			)
			.catch((e) => {
				console.error('Loading model prices failed', e);
				prices = null;
				return new Map();
			});
	}
	return prices;
}

async function tokenCost(model: string, input: number, output: number) {
	const price = (await loadPrices()).get(model);
	return price ? input * price.input + output * price.output : 0;
}
