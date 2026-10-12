// See https://svelte.dev/docs/kit/types#app.d.ts
// for information about these interfaces
declare global {
	namespace App {
		// interface Error {}
		interface Locals {
			/** Scopes history and archive; the signed-in account id */
			clientId: string;
			user?: { id: string; dailyLimit: number };
		}
		// interface PageData {}
		// interface PageState {}
		// interface Platform {}
	}
}

export {};
