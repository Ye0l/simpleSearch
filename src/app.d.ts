// See https://svelte.dev/docs/kit/types#app.d.ts
// for information about these interfaces
declare global {
	namespace App {
		// interface Error {}
		interface Locals {
			/** Scopes history and archive; the signed-in account id */
			clientId: string;
			user?: {
				id: string;
				/** Estimated API cost allowed per day, micro-USD; -1 = no limit */
				dailyBudget: number;
			};
		}
		// interface PageData {}
		// interface PageState {}
		// interface Platform {}
	}
}

export {};
