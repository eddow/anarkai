import { createPollinationsProvider } from './pollinations-provider'
import type { ArtProvider } from './types'

export function createArtProviders(): readonly ArtProvider[] {
	return [
		createPollinationsProvider({
			apiKey: import.meta.env.VITE_POLLINATIONS_API_KEY,
		}),
	]
}

export function findProvider(providers: readonly ArtProvider[], providerId: string): ArtProvider {
	const provider = providers.find((candidate) => candidate.id === providerId)
	if (!provider) {
		throw new Error(`Unknown art provider: ${providerId}`)
	}
	return provider
}
