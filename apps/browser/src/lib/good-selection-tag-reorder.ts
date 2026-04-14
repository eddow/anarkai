/**
 * Reorders one item in a list to a gap index returned by `resolveLocalDragInsertion`
 * (0 … list.length). Mirrors the usual “remove then insert” index adjustment when
 * `insertionIndex` is measured on the pre-move layout.
 */
export function reorderWithInsertionGap<T>(
	items: readonly T[],
	fromIndex: number,
	insertionIndex: number
): T[] {
	const n = items.length
	if (n === 0) return []
	if (fromIndex < 0 || fromIndex >= n) return [...items]
	const clampedInsert = Math.max(0, Math.min(insertionIndex, n))
	const next = [...items]
	const [moved] = next.splice(fromIndex, 1)
	let target = clampedInsert
	if (clampedInsert > fromIndex) target = clampedInsert - 1
	next.splice(target, 0, moved as T)
	return next
}
