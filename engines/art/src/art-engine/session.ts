import { findProvider } from './providers'
import type { ArtGeneration, ArtGenerationRequest, ArtProvider, ArtProviderContext } from './types'

export function createArtGeneration(
	request: ArtGenerationRequest,
	providers: readonly ArtProvider[],
	context?: ArtProviderContext
): ArtGeneration {
	const provider = findProvider(providers, request.providerId)
	const createdAt = new Date().toISOString()

	return {
		id: `${request.providerId}-${Date.now()}`,
		request,
		imageUrl: provider.generateUrl(request, context),
		downloadName: createDownloadName(request.prompt, createdAt),
		createdAt,
	}
}

function createDownloadName(prompt: string, createdAt: string): string {
	const slug = prompt
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/^-|-$/g, '')
		.slice(0, 48)
	const stamp = createdAt.replace(/[-:]/g, '').replace(/\..+$/, '').replace('T', '-')
	return `anarkai-art-${slug || 'image'}-${stamp}.png`
}
