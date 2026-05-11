import type { ArtGeneration } from './types'

export async function downloadGeneration(generation: ArtGeneration): Promise<void> {
	const response = await fetch(generation.imageUrl, { mode: 'cors' })
	if (!response.ok) {
		throw new Error(`Download failed with ${response.status}`)
	}

	const blob = await response.blob()
	const objectUrl = URL.createObjectURL(blob)
	const link = document.createElement('a')
	link.href = objectUrl
	link.download = generation.downloadName
	document.body.append(link)
	link.click()
	link.remove()
	URL.revokeObjectURL(objectUrl)
}
