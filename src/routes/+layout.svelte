<script lang="ts">
	import '../app.css';
	import favicon from '#lib/assets/favicon.svg';
	import { onNavigate } from '$app/navigation';
	import type { LayoutProps } from './$types';

	let { children }: LayoutProps = $props();

	// Morph brand + search box between hero and header layouts.
	onNavigate((navigation) => {
		if (!document.startViewTransition) return;
		const from = navigation.from?.url.searchParams.has('q');
		const to = navigation.to?.url.searchParams.has('q');
		if (from === to) return;

		return new Promise((resolve) => {
			document.startViewTransition(async () => {
				resolve();
				await navigation.complete;
			});
		});
	});
</script>

<svelte:head>
	<link rel="icon" href={favicon} />
</svelte:head>

{@render children()}
