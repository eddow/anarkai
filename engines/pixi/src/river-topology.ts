export type RiverBodyAngle = 'straight180' | 'bend60' | 'bend120'

export function classifyRiverBodyAngle(
	edgeDirections: readonly number[]
): RiverBodyAngle | undefined {
	const uniq = [...new Set(edgeDirections)]
		.filter((d) => Number.isInteger(d) && d >= 0 && d <= 5)
		.sort((a, b) => a - b)
	if (uniq.length !== 2) return undefined
	const a = uniq[0]!
	const b = uniq[1]!
	const diff = (b - a + 6) % 6
	if (diff === 3) return 'straight180'
	if (diff === 1 || diff === 5) return 'bend60'
	if (diff === 2 || diff === 4) return 'bend120'
	return undefined
}
