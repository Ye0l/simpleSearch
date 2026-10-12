<script lang="ts">
	import { tick } from 'svelte';
	import { fly } from 'svelte/transition';
	import { goto } from '$app/navigation';
	import { page } from '$app/state';

	// One field at a time: id → password, or id → new password → confirm.
	type Step = 'id' | 'password' | 'create' | 'confirm';

	const MIN_PASSWORD = 8;
	const PROMPTS: Record<Step, { label: string; placeholder: string }> = {
		id: { label: '아이디', placeholder: '아이디' },
		password: { label: '비밀번호', placeholder: '비밀번호' },
		create: { label: '새 비밀번호', placeholder: `새 비밀번호 (${MIN_PASSWORD}자 이상)` },
		confirm: { label: '비밀번호 확인', placeholder: '한 번 더 입력' }
	};

	let step = $state<Step>('id');
	let id = $state('');
	let password = $state('');
	let confirm = $state('');
	let busy = $state(false);
	let message = $state(
		page.url.searchParams.get('reason') === 'taken'
			? '다른 기기에서 로그인되어 로그아웃됐어요.'
			: ''
	);
	let inputEl = $state<HTMLInputElement>();

	async function post(path: string, body: object) {
		const res = await fetch(path, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify(body)
		});
		const data = await res.json().catch(() => null);
		if (!res.ok) throw new Error(data?.message ?? `HTTP ${res.status}`);
		return data;
	}

	async function go(next: Step) {
		step = next;
		message = '';
		await tick();
		inputEl?.focus();
	}

	async function submit(e: SubmitEvent) {
		e.preventDefault();
		if (busy) return;
		message = '';

		if (step === 'create') {
			if (password.length < MIN_PASSWORD) {
				message = `비밀번호는 ${MIN_PASSWORD}자 이상이어야 해요.`;
				return;
			}
			return go('confirm');
		}
		if (step === 'confirm' && confirm !== password) {
			confirm = '';
			message = '비밀번호가 서로 달라요.';
			return;
		}
		if (!value().trim()) return;

		busy = true;
		try {
			if (step === 'id') {
				const { next } = await post('/api/auth/lookup', { id });
				await go(next);
			} else {
				await post('/api/auth/login', { id, password });
				await goto('/', { invalidateAll: true });
			}
		} catch (err) {
			message = (err as Error).message;
			if (step !== 'id') {
				password = '';
				confirm = '';
				if (step === 'confirm') step = 'create';
			}
			await tick();
			inputEl?.focus();
		} finally {
			busy = false;
		}
	}

	function back() {
		password = '';
		confirm = '';
		go('id');
	}

	const value = () => (step === 'id' ? id : step === 'confirm' ? confirm : password);
</script>

<svelte:head>
	<title>로그인 – simpleSearch</title>
</svelte:head>

<main>
	<div class="brand">
		<span class="mark" aria-hidden="true"></span>
		<span>simple<b>Search</b></span>
	</div>

	<form onsubmit={submit} aria-busy={busy}>
		{#if step !== 'id'}
			<div class="who" in:fly={{ y: -6, duration: 200 }}>
				<span>{id}</span>
				<button type="button" onclick={back}>다른 아이디</button>
			</div>
			{#if step === 'create' || step === 'confirm'}
				<p class="hint">처음 로그인이에요. 사용할 비밀번호를 정해 주세요.</p>
			{/if}
		{/if}

		{#key step}
			<div class="field" in:fly={{ x: 24, duration: 260, delay: 60 }}>
				<!-- svelte-ignore a11y_autofocus -->
				{#if step === 'id'}
					<input
						bind:this={inputEl}
						bind:value={id}
						aria-label={PROMPTS.id.label}
						placeholder={PROMPTS.id.placeholder}
						autocomplete="username"
						autocapitalize="none"
						spellcheck="false"
						enterkeyhint="next"
						autofocus
					/>
				{:else}
					<!-- Keeps the id next to the password for password managers. -->
					<input type="text" value={id} autocomplete="username" hidden readonly />
					<input
						bind:this={inputEl}
						type="password"
						value={step === 'confirm' ? confirm : password}
						oninput={(e) =>
							step === 'confirm'
								? (confirm = e.currentTarget.value)
								: (password = e.currentTarget.value)}
						aria-label={PROMPTS[step].label}
						placeholder={PROMPTS[step].placeholder}
						autocomplete={step === 'password' ? 'current-password' : 'new-password'}
						enterkeyhint={step === 'create' ? 'next' : 'go'}
						autofocus
					/>
				{/if}
				<button class="next" aria-label="다음" disabled={busy}>
					{#if busy}
						<span class="spinner" aria-hidden="true"></span>
					{:else}
						<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h14M13 6l6 6-6 6" /></svg>
					{/if}
				</button>
			</div>
		{/key}

		<p class="message" role="alert">{message}</p>
	</form>
</main>

<style>
	main {
		display: grid;
		justify-items: center;
		align-content: start;
		gap: 28px;
		min-height: 100dvh;
		padding: calc(32dvh - 60px) 20px 40px;
	}

	.brand {
		display: inline-flex;
		align-items: center;
		gap: 12px;
		font-size: 34px;
		font-weight: 500;
		letter-spacing: -0.03em;
	}
	.brand b {
		font-weight: 700;
		color: var(--accent);
	}
	.mark {
		width: 0.95em;
		height: 0.95em;
		border-radius: 30%;
		background: linear-gradient(135deg, var(--accent), var(--accent-strong));
		box-shadow: 0 4px 14px -4px var(--accent);
	}

	form {
		display: grid;
		gap: 12px;
		width: min(400px, 100%);
	}

	.who {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 8px;
		padding: 0 6px;
		font-size: 15px;
		font-weight: 600;
	}
	.who button {
		border: 0;
		background: none;
		font-size: 13px;
		color: var(--text-3);
		cursor: pointer;
	}
	.who button:hover {
		color: var(--accent-strong);
	}
	.hint {
		margin: -4px 6px 0;
		font-size: 13px;
		color: var(--text-2);
	}

	.field {
		display: flex;
		align-items: center;
		height: 56px;
		padding: 0 6px 0 22px;
		background: var(--surface);
		border: 1px solid var(--border);
		border-radius: 999px;
		box-shadow: var(--shadow);
		transition:
			border-color 0.15s var(--ease),
			box-shadow 0.15s var(--ease);
	}
	.field:focus-within {
		border-color: var(--accent);
		box-shadow:
			var(--shadow),
			0 0 0 4px var(--ring);
	}
	input {
		flex: 1;
		min-width: 0;
		height: 100%;
		border: 0;
		background: transparent;
		font-size: 16px;
		color: var(--text);
		outline: 0;
	}
	input::placeholder {
		color: var(--text-3);
	}

	.next {
		display: grid;
		place-items: center;
		flex: none;
		width: 44px;
		height: 44px;
		border: 0;
		border-radius: 50%;
		background: var(--accent);
		color: #fff;
		cursor: pointer;
		transition: background-color 0.15s;
	}
	.next:hover:not(:disabled) {
		background: var(--accent-strong);
	}
	.next svg {
		width: 20px;
		height: 20px;
		fill: none;
		stroke: currentColor;
		stroke-width: 2;
		stroke-linecap: round;
		stroke-linejoin: round;
	}
	.spinner {
		width: 18px;
		height: 18px;
		border-radius: 50%;
		border: 2px solid rgb(255 255 255 / 0.35);
		border-top-color: #fff;
		animation: spin 0.7s linear infinite;
	}

	.message {
		min-height: 1.5em;
		margin: 0 6px;
		font-size: 13.5px;
		color: var(--rose);
	}

	@media (max-width: 600px) {
		main {
			padding-top: calc(26dvh - 40px);
		}
		.brand {
			font-size: 28px;
		}
	}

	@keyframes spin {
		to {
			transform: rotate(1turn);
		}
	}
</style>
