/**
 * Merge policy implementations for bay queue controllers.
 *
 * When several ingress branches can feed the same downstream node, the bay group needs a
 * merge policy to decide who goes next.
 *
 * ## Design rules
 *
 * 1. **Pure ordering only.** Merge policies return a logical order plus a selected branch
 *    label, but they do **not** mutate round-robin state. The controller commits state
 *    changes only after a movement grant is actually issued.
 *
 * 2. **Branch identity is stable.** Policies group by `ingressBranch` (or fall back to the
 *    authored `branch` property on the vehicle's current node). A vehicle's `ingressBranch`
 *    is set once when it first enters the queue graph and never changes, so round-robin
 *    fairness is not affected by intermediate holding positions.
 *
 * 3. **Logical order vs physical feasibility.** The merge policy produces a sorted list;
 *    the admission loop iterates it and picks the first candidate that can physically move.
 *    `skipBlocked` on the policy config controls whether to skip or stall.
 *
 * ```
 * logical order  = who should go first (merge policy)
 * physical feasibility = who can actually move now (admission loop)
 * decision = first logical candidate that has a legal movement, unless policy allows skipping
 * ```
 */

import type {
	DockRequest,
	MergeOrdering,
	MergePolicy,
	RuntimeQueueNode,
} from './bay-queue-types'

// ─── Pure ordering functions (no side effects) ─────────────────────────────

/**
 * `global_fifo`: earliest arrival first across all branches.
 */
export function orderGlobalFifo(candidates: DockRequest[]): MergeOrdering {
	return {
		ordered: [...candidates].sort((a, b) => a.arrivedAt - b.arrivedAt),
	}
}

/**
 * `priority_then_fifo`: highest priority, then earliest arrival.
 * This is the **default** policy.
 */
export function orderPriorityThenFifo(candidates: DockRequest[]): MergeOrdering {
	return {
		ordered: [...candidates].sort((a, b) => {
			const pDiff = b.priority - a.priority
			if (pDiff !== 0) return pDiff
			return a.arrivedAt - b.arrivedAt
		}),
	}
}

/**
 * `round_robin_by_branch`: alternate between ingress branches.
 *
 * Returns candidates from the next branch first, then all others as fallback.
 * The `branchIndex` is the caller-controlled round-robin position — the caller
 * looks at `selectedBranch` in the result and advances the index **after** a
 * grant is issued.
 */
export function orderRoundRobinByBranch(
	candidates: DockRequest[],
	branchIndex: number,
	branchList: string[]
): MergeOrdering {
	if (candidates.length === 0 || branchList.length === 0) {
		return { ordered: orderPriorityThenFifo(candidates).ordered }
	}

	const grouped = groupByBranch(candidates)

	// Wrap the index safely
	const idx = ((branchIndex % branchList.length) + branchList.length) % branchList.length
	const selectedBranch = branchList[idx]

	const selected = grouped.get(selectedBranch)
		? orderPriorityThenFifo(grouped.get(selectedBranch)!).ordered
		: []

	const others = branchList
		.filter((b) => b !== selectedBranch)
		.flatMap((b) => (grouped.get(b) ? orderPriorityThenFifo(grouped.get(b)!).ordered : []))

	return {
		ordered: [...selected, ...others],
		selectedBranch,
	}
}

/**
 * `weighted_round_robin_by_branch`: give some branches more turns than others.
 *
 * Like `round_robin_by_branch` but the caller provides a `consecutiveCount`
 * (how many grants this branch has already received in a row) and `weight`.
 * If `consecutiveCount < weight`, the same branch is selected again.
 */
export function orderWeightedRoundRobinByBranch(
	candidates: DockRequest[],
	branchIndex: number,
	branchList: string[],
	branchWeights: ReadonlyMap<string, number>,
	consecutiveCount: number
): MergeOrdering {
	if (candidates.length === 0 || branchList.length === 0) {
		return { ordered: orderPriorityThenFifo(candidates).ordered }
	}

	const idx = ((branchIndex % branchList.length) + branchList.length) % branchList.length
	const currentBranch = branchList[idx]
	const weight = branchWeights.get(currentBranch) ?? 1

	const grouped = groupByBranch(candidates)

	// If the current branch has remaining turns and has candidates, keep it
	if (consecutiveCount < weight && grouped.has(currentBranch)) {
		const selected = orderPriorityThenFifo(grouped.get(currentBranch)!).ordered
		const others = branchList
			.filter((b) => b !== currentBranch)
			.flatMap((b) => (grouped.get(b) ? orderPriorityThenFifo(grouped.get(b)!).ordered : []))
		return {
			ordered: [...selected, ...others],
			selectedBranch: currentBranch,
		}
	}

	// Advance to next branch
	const nextIdx = (idx + 1) % branchList.length
	const nextBranch = branchList[nextIdx]

	const selected = grouped.get(nextBranch)
		? orderPriorityThenFifo(grouped.get(nextBranch)!).ordered
		: []

	const others = branchList
		.filter((b) => b !== nextBranch)
		.flatMap((b) => (grouped.get(b) ? orderPriorityThenFifo(grouped.get(b)!).ordered : []))

	return {
		ordered: [...selected, ...others],
		selectedBranch: nextBranch,
	}
}

/**
 * `physical_first_available`: no logical reordering.
 *
 * The admission loop iterates candidates in FIFO order and picks the first
 * one that can physically move now.
 */
export function orderPhysicalFirstAvailable(candidates: DockRequest[]): MergeOrdering {
	return { ordered: orderGlobalFifo(candidates).ordered }
}

// ─── Policy selector ───────────────────────────────────────────────────────

/**
 * Apply the configured merge policy to produce a logical ordering.
 *
 * This is a pure function — it does not mutate any state. The caller
 * (the controller) is responsible for committing round-robin position
 * changes after a grant is issued.
 *
 * @param candidates - Dock requests to order.
 * @param policy - The merge policy configuration.
 * @param branchState - Caller-controlled round-robin state:
 *   - `branchList`: ordered list of branch labels (collected once from the graph).
 *   - `branchIndex`: which branch the policy should favor this cycle.
 *   - `branchWeights`: per-branch weights (weighted policy only).
 *   - `consecutiveCount`: how many grants the current branch has already received in a row (weighted only).
 * @returns A logical ordering with an optional `selectedBranch`.
 */
export function applyMergePolicy(
	candidates: DockRequest[],
	policy: MergePolicy,
	branchState?: {
		branchList: string[]
		branchIndex: number
		branchWeights?: ReadonlyMap<string, number>
		consecutiveCount?: number
	}
): MergeOrdering {
	switch (policy.kind) {
		case 'global_fifo':
			return orderGlobalFifo(candidates)
		case 'priority_then_fifo':
			return orderPriorityThenFifo(candidates)
		case 'round_robin_by_branch':
			return orderRoundRobinByBranch(
				candidates,
				branchState?.branchIndex ?? 0,
				branchState?.branchList ?? []
			)
		case 'weighted_round_robin_by_branch':
			return orderWeightedRoundRobinByBranch(
				candidates,
				branchState?.branchIndex ?? 0,
				branchState?.branchList ?? [],
				branchState?.branchWeights ?? new Map(),
				branchState?.consecutiveCount ?? 0
			)
		case 'physical_first_available':
			return orderPhysicalFirstAvailable(candidates)
		default:
			return orderPriorityThenFifo(candidates)
	}
}

// ─── Branch helpers ────────────────────────────────────────────────────────

/**
 * Extract the branch label from a dock request.
 *
 * Uses `ingressBranch` if set (preferred — stable across node changes).
 * Falls back to the authored `branch` on the vehicle's current node.
 * Returns `'__default__'` if nothing is available.
 */
export function branchLabel(request: DockRequest): string {
	if (request.ingressBranch) return request.ingressBranch
	if (request.currentNode?.branch) return request.currentNode.branch
	return '__default__'
}

/**
 * Collect all unique branch labels from a set of runtime nodes.
 *
 * Only includes labels from **ingress nodes** (nodes with no incoming edges).
 * Service nodes, merge gates, and other internal nodes do not contribute to
 * the branch list. A node without an explicit `branch` property that has
 * no incoming edges gets the label `'__default__'`.
 *
 * Used by the controller to build the `branchList` for round-robin policies.
 */
export function collectBranchLabels(nodes: RuntimeQueueNode[]): string[] {
	// Find ingress nodes (no incoming edges)
	const hasIncoming = new Set<RuntimeQueueNode>()
	for (const node of nodes) {
		for (const edge of node.outgoing) {
			hasIncoming.add(edge.to)
		}
	}

	const seen = new Set<string>()
	const result: string[] = []
	for (const node of nodes) {
		// Skip non-ingress nodes — they don't define branches
		if (hasIncoming.has(node)) continue
		const label = node.branch ?? '__default__'
		if (!seen.has(label)) {
			seen.add(label)
			result.push(label)
		}
	}
	return result
}

/** Group candidates by their stable branch label. */
function groupByBranch(candidates: DockRequest[]): Map<string, DockRequest[]> {
	const map = new Map<string, DockRequest[]>()
	for (const c of candidates) {
		const branch = branchLabel(c)
		const list = map.get(branch)
		if (list) {
			list.push(c)
		} else {
			map.set(branch, [c])
		}
	}
	return map
}
