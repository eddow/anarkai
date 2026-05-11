export interface ArtPromptProposal {
	readonly id: string
	readonly title: string
	readonly prompt: string
}

export interface ArtGenerationRequest {
	readonly prompt: string
	readonly providerId: string
	readonly model?: string
	readonly size: ArtImageSize
	readonly seed?: number
}

export interface ArtImageSize {
	readonly width: number
	readonly height: number
}

export interface ArtGeneration {
	readonly id: string
	readonly request: ArtGenerationRequest
	readonly imageUrl: string
	readonly downloadName: string
	readonly createdAt: string
}

export interface ArtProvider {
	readonly id: string
	readonly label: string
	generateUrl(request: ArtGenerationRequest, context?: ArtProviderContext): string
}

export interface ArtProviderContext {
	readonly apiKey?: string
}
