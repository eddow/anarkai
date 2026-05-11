import {
	type ArtGeneration,
	createArtGeneration,
	createArtProviders,
	downloadGeneration,
	listPromptProposals,
	loadArtSettings,
	randomPromptProposal,
	saveArtSettings,
} from '@art/art-engine'
import { reactive } from 'mutts'

const providers = createArtProviders()
const proposals = listPromptProposals()
const sizes = [
	{ label: 'Default', width: 256, height: 2256 },
	{ label: 'Square', width: 1024, height: 1024 },
	{ label: 'Wide', width: 1344, height: 768 },
	{ label: 'Tall', width: 768, height: 1344 },
]

const initialProposal = randomPromptProposal()
const initialSettings = loadArtSettings()

export default function App() {
	const state = reactive({
		prompt: initialProposal.prompt,
		providerId: providers[0]?.id ?? 'pollinations',
		sizeLabel: sizes[0]?.label ?? 'Square',
		model: 'flux',
		seed: '',
		pollinationsApiKey: initialSettings.pollinationsApiKey,
		generation: undefined as ArtGeneration | undefined,
		previewUrl: '',
		previewAlt: '',
		busy: false,
		error: '',
	})

	const selectedSize = () =>
		sizes.find((size) => size.label === state.sizeLabel) ??
		sizes[0] ?? { width: 1024, height: 1024 }

	const proposePrompt = () => {
		state.prompt = randomPromptProposal().prompt
		state.error = ''
	}

	const setPollinationsApiKey = (apiKey: string) => {
		state.pollinationsApiKey = apiKey.trim()
		saveArtSettings({ pollinationsApiKey: state.pollinationsApiKey })
	}

	const generate = () => {
		const prompt = state.prompt.trim()
		if (!prompt) {
			state.error = 'Write or choose a prompt first.'
			return
		}

		const size = selectedSize()
		const generation = createArtGeneration(
			{
				prompt,
				providerId: state.providerId,
				model: state.model.trim() || undefined,
				size: { width: size.width, height: size.height },
				seed: state.seed ? Number(state.seed) : undefined,
			},
			providers,
			{ apiKey: state.providerId === 'pollinations' ? state.pollinationsApiKey : undefined }
		)
		state.generation = generation
		state.previewUrl = generation.imageUrl
		state.previewAlt = generation.request.prompt
		state.busy = true
		state.error = ''
	}

	const download = async () => {
		if (!state.generation) return
		try {
			state.error = ''
			await downloadGeneration(state.generation)
		} catch (error) {
			state.error = error instanceof Error ? error.message : 'The image could not be downloaded.'
		}
	}

	return (
		<main class="art-shell">
			<section class="art-workbench" aria-label="Anarkai art generator">
				<div class="art-controls">
					<div class="art-title">
						<p>Anarkai Art</p>
						<h1>Prompt, generate, keep the good ones.</h1>
					</div>

					<label class="art-field">
						<span>Prompt</span>
						<textarea
							value={state.prompt}
							update:value={(value: string) => {
								state.prompt = value
							}}
							rows={8}
						/>
					</label>

					<div class="art-suggestions" aria-label="Prompt proposals">
						<for each={proposals}>
							{(proposal) => (
								<button
									type="button"
									class="art-chip"
									onClick={() => {
										state.prompt = proposal.prompt
									}}
								>
									{proposal.title}
								</button>
							)}
						</for>
					</div>

					<div class="art-grid">
						<label class="art-field">
							<span>Provider</span>
							<select
								value={state.providerId}
								update:value={(value: string) => {
									state.providerId = value
								}}
							>
								<for each={providers}>
									{(provider) => <option value={provider.id}>{provider.label}</option>}
								</for>
							</select>
						</label>

						<label class="art-field">
							<span>Size</span>
							<select
								value={state.sizeLabel}
								update:value={(value: string) => {
									state.sizeLabel = value
								}}
							>
								<for each={sizes}>
									{(size) => (
										<option value={size.label}>
											{size.label} - {size.width}x{size.height}
										</option>
									)}
								</for>
							</select>
						</label>

						<label class="art-field">
							<span>Model</span>
							<input
								value={state.model}
								update:value={(value: string) => {
									state.model = value
								}}
							/>
						</label>

						<label class="art-field">
							<span>Seed</span>
							<input
								inputMode="numeric"
								placeholder="random"
								value={state.seed}
								update:value={(value: string) => {
									state.seed = value.replace(/\D/g, '')
								}}
							/>
						</label>

						<label class="art-field art-field-wide">
							<span>API key</span>
							<input
								type="password"
								autoComplete="off"
								placeholder="optional"
								value={state.pollinationsApiKey}
								update:value={setPollinationsApiKey}
							/>
						</label>
					</div>

					<div class="art-actions">
						<button type="button" class="art-button secondary" onClick={proposePrompt}>
							Propose
						</button>
						<button type="button" class="art-button primary" onClick={generate}>
							Generate
						</button>
						<button
							type="button"
							class="art-button"
							disabled={!state.generation}
							onClick={download}
						>
							Download
						</button>
					</div>

					<p if={state.error} class="art-error">
						{state.error}
					</p>
				</div>

				<div class="art-stage">
					<div if={!state.previewUrl} class="art-empty">
						<span>Image preview</span>
					</div>
					<img
						if={state.previewUrl}
						src={state.previewUrl}
						alt={state.previewAlt}
						onLoad={() => {
							state.busy = false
						}}
						onError={() => {
							state.busy = false
							state.error = 'The provider did not return an image.'
						}}
					/>
					<div if={state.busy} class="art-loading">
						Generating...
					</div>
				</div>
			</section>
		</main>
	)
}
