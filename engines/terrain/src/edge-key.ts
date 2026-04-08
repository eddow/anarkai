import { axial } from './hex/axial'
import type { AxialKey } from './hex/types'
import type { EdgeKey } from './types'

/** Canonical edge key: numerically ordered by (q,r) to avoid lexicographic mis-ordering. */
export function edgeKey(a: AxialKey, b: AxialKey): EdgeKey {
	const ac = axial.coord(a)
	const bc = axial.coord(b)
	const aFirst = ac.q < bc.q || (ac.q === bc.q && ac.r < bc.r)
	return aFirst ? `${a}-${b}` : `${b}-${a}`
}
