/**
 * Compute CSS background styles from a PixiJS texture
 * @param texture - The PixiJS texture object
 * @param options - Styling options including dimensions
 * @returns CSS background style string
 */
export function computeStyleFromTexture(
	texture: any,
	options: {
		width?: number
		height?: number
		backgroundRepeat?: string
		imageRendering?: string
		opacity?: number
	} = {},
) {
	if (!texture) return ''

	// Source URL (resource.src doesn't work, resource._sourceOrigin is well set but "private", label seems to work)
	const src: string | undefined = texture?.source?.resource?.src ?? texture?.source?.label
	if (!src) return ''

	const frame = texture?.frame ?? {
		x: 0,
		y: 0,
		width: texture?.width ?? 0,
		height: texture?.height ?? 0,
	}
	const realWidth = frame?.width ?? texture?.width ?? 0
	const realHeight = frame?.height ?? texture?.height ?? 0

	// Use provided dimensions or texture dimensions
	const targetW = options.width ?? realWidth
	const targetH = options.height ?? realHeight

	// Source image pixel size and resolution
	const res: number = texture?.source?.resolution ?? 1
	const sourcePixelW: number = texture?.source?.pixelWidth ?? (texture?.source?.width ?? 0) * res
	const sourcePixelH: number = texture?.source?.pixelHeight ?? (texture?.source?.height ?? 0) * res

	// Fit scale so frame fits inside target maintaining aspect ratio
	const fitScale = Math.min(
		targetW / Math.max(1, frame?.width || 0),
		targetH / Math.max(1, frame?.height || 0),
	)

	// Background-size scales the entire source image
	const bgScale = fitScale / res
	const bgW = sourcePixelW * bgScale
	const bgH = sourcePixelH * bgScale

	// Position to show the frame origin at top-left of the box
	const posX = -((frame?.x || 0) * fitScale)
	const posY = -((frame?.y || 0) * fitScale)

	const styles = [
		`background-image: url(${JSON.stringify(src)});`,
		`background-position: ${posX}px ${posY}px;`,
		`background-size: ${bgW}px ${bgH}px;`,
		`background-repeat: ${options.backgroundRepeat ?? 'no-repeat'};`,
		`image-rendering: ${options.imageRendering ?? 'pixelated'};`,
	]

	if (options.opacity !== undefined) {
		styles.push(`opacity: ${options.opacity};`)
	}

	return styles.join(' ')
}
