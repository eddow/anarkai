/**
 * Projection layer: walks `engine-rules` content (goods, alveoli + variants,
 * deposits, shops) and emits a plain, serialisable graph model that the
 * Cytoscape view can consume. Keeping this pure (no cytoscape import) means
 * it stays unit-testable and reusable for other projections later.
 */

import { alveoli, deposits, goods, shopNeedTags, shops } from 'engine-rules'

export type NodeKind = 'good' | 'building' | 'shop' | 'tag' | 'deposit'

export interface AtlasNode {
	readonly id: string
	readonly label: string
	readonly kind: NodeKind
	/** Compound parent id when the node is grouped (tag group, building root). */
	readonly parent?: string
	/** Free-form payload for tooltips/inspectors. */
	readonly data?: Readonly<Record<string, unknown>>
}

export interface AtlasEdge {
	readonly id: string
	readonly source: string
	readonly target: string
	readonly kind: 'consumes' | 'produces' | 'stocks' | 'harvests' | 'plants'
}

export interface EconomyGraph {
	readonly nodes: readonly AtlasNode[]
	readonly edges: readonly AtlasEdge[]
	/** Game-content (GC) errors found while projecting — e.g. exclusivity violations. */
	readonly errors: readonly string[]
}

/**
 * The production grouping tags — the curated, *mutually exclusive* set used to
 * group goods. A well-formed good carries EXACTLY ONE of these; zero or ≥2 is
 * a game-content bug (surfaced in `errors` + rendered as a red node).
 */
export const PRODUCTION_GROUPS = [
	'food',
	'raw',
	'material',
	'research',
	'wearable',
	'component',
	'ingredient',
	'refined',
	'household',
] as const
export type ProductionGroup = (typeof PRODUCTION_GROUPS)[number]

/** The production group a good belongs to, and any exclusivity violation. */
function productionGroupOf(
	name: string,
	tags: readonly string[],
	errors: string[]
): ProductionGroup | undefined {
	const hits = PRODUCTION_GROUPS.filter((g) => tags.includes(g))
	if (hits.length > 1) {
		errors.push(
			`good "${name}" has ${hits.length} production tags (${hits.join(', ')}) — expected exactly 1`
		)
		return hits[0] // deterministic home despite the bug
	}
	if (hits.length === 0) {
		errors.push(
			`good "${name}" has NO production tag — expected one of ${PRODUCTION_GROUPS.join(', ')}`
		)
		return undefined
	}
	return hits[0]
}

/** Tag prefix-match: a rule tag `food` matches good tag `food` and `food/x`. */
function tagMatches(rule: string, tag: string): boolean {
	return tag === rule || tag.startsWith(`${rule}/`)
}

function goodHasAnyTag(goodTags: readonly string[], rules: readonly string[]): boolean {
	if (rules.length === 0) return true // catch-all (general shop)
	return goodTags.some((t) => rules.some((r) => tagMatches(r, t)))
}

interface VariantDef {
	readonly construction?: { readonly goods: Readonly<Record<string, number>> }
	readonly action?: { readonly type: string; readonly [k: string]: unknown }
	readonly variants?: Readonly<Record<string, VariantDef>>
}

/**
 * Build the economy graph from rules content.
 *
 * The projection is deterministic: every good/building is emitted (fixed node
 * set), goods are grouped into their production-group compound boxes, and
 * production flows (harvest/transform + shop stock) form the edges.
 * Construction costs are deliberately NOT part of the chart.
 */
/** Only these alveolus action types are part of the production graph. */
const PRODUCTION_ACTIONS = new Set(['harvest', 'transform', 'plant'])

export function buildEconomyGraph(): EconomyGraph {
	const errors: string[] = []
	const nodes = new Map<string, AtlasNode>()
	const edges: AtlasEdge[] = []
	let edgeSeq = 0
	const pushEdge = (e: Omit<AtlasEdge, 'id'>) => edges.push({ id: `e${edgeSeq++}`, ...e })

	// --- Goods ------------------------------------------------------------
	// Every good is ALWAYS emitted and grouped into its production-group box.
	const boxedTagIds = new Set<string>()
	const goodParent = (group: ProductionGroup | undefined): string | undefined => {
		if (!group) return undefined
		const id = `tag:${group}`
		if (!boxedTagIds.has(id)) {
			boxedTagIds.add(id)
			nodes.set(id, { id, label: group, kind: 'tag' })
		}
		return id
	}

	for (const [name, def] of Object.entries(goods)) {
		const group = productionGroupOf(name, def.tags, errors)
		const goodTags = def.tags as readonly string[]
		const violated =
			// red-flag: 0 or ≥2 production tags (productionGroupOf already logged it)
			PRODUCTION_GROUPS.filter((g) => goodTags.includes(g)).length !== 1
		nodes.set(`good:${name}`, {
			id: `good:${name}`,
			label: name,
			kind: 'good',
			parent: goodParent(group),
			data: {
				tags: def.tags,
				group,
				violated: violated || undefined,
				massKg: def.massKg,
				baseValueVp: def.baseValueVp,
			},
		})
	}

	// --- Deposits ---------------------------------------------------------
	for (const [name, def] of Object.entries(deposits)) {
		nodes.set(`deposit:${name}`, { id: `deposit:${name}`, label: name, kind: 'deposit' })
		// Passive generation (berry_bush → berries, tree → mushrooms).
		const gen = (def as { generation?: Readonly<Record<string, number>> }).generation
		if (gen) {
			for (const g of Object.keys(gen)) {
				if (nodes.has(`good:${g}`)) {
					pushEdge({ source: `deposit:${name}`, target: `good:${g}`, kind: 'produces' })
				}
			}
		}
	}

	// --- Alveoli (buildings) + variants -----------------------------------
	const actionGoods = (
		action: { readonly type: string; readonly [k: string]: unknown } | undefined,
		buildingId: string
	) => {
		if (!action) return
		if (action.type === 'transform') {
			const rates = (action as { rates?: Readonly<Record<string, number>> }).rates ?? {}
			for (const [g, rate] of Object.entries(rates)) {
				if (!nodes.has(`good:${g}`)) continue
				pushEdge(
					rate < 0
						? { source: `good:${g}`, target: buildingId, kind: 'consumes' }
						: { source: buildingId, target: `good:${g}`, kind: 'produces' }
				)
			}
		} else if (action.type === 'harvest') {
			const deposit = (action as { deposit?: string }).deposit
			if (deposit && nodes.has(`deposit:${deposit}`)) {
				pushEdge({ source: `deposit:${deposit}`, target: buildingId, kind: 'harvests' })
			}
			const output = (action as { output?: Readonly<Record<string, number>> }).output ?? {}
			for (const g of Object.keys(output)) {
				if (nodes.has(`good:${g}`)) {
					pushEdge({ source: buildingId, target: `good:${g}`, kind: 'produces' })
				}
			}
		} else if (action.type === 'plant') {
			const deposit = (action as { deposit?: string }).deposit
			if (deposit && nodes.has(`deposit:${deposit}`)) {
				pushEdge({ source: buildingId, target: `deposit:${deposit}`, kind: 'plants' })
			}
		}
	}

	const walkVariants = (
		rootId: string,
		rootLabel: string,
		variants: Readonly<Record<string, VariantDef>> | undefined,
		path: string
	) => {
		if (!variants) return
		for (const [vName, vDef] of Object.entries(variants)) {
			const vId = `${rootId}.${vName}`
			const vPath = `${path}.${vName}`
			nodes.set(vId, {
				id: vId,
				label: `${rootLabel}·${vName}`,
				kind: 'building',
				parent: rootId,
				data: { variantPath: vPath },
			})
			actionGoods(vDef.action, vId)
			walkVariants(rootId, `${rootLabel}·${vName}`, vDef.variants, vPath)
		}
	}

	for (const [name, def] of Object.entries(alveoli)) {
		// Only production buildings (harvest / transform) belong on the chart —
		// storage, freight, engineer, etc. are infrastructure, not economy flow.
		if (!PRODUCTION_ACTIONS.has(def.action.type)) continue
		const id = `alveolus:${name}`
		nodes.set(id, { id, label: name, kind: 'building', data: { actionType: def.action.type } })
		actionGoods(def.action as { type: string } & Record<string, unknown>, id)
		const variants = (def as { variants?: Readonly<Record<string, VariantDef>> }).variants
		walkVariants(id, name, variants, name)
	}

	// --- Shops (stock by tag rule) -----------------------------------------
	for (const [name, def] of Object.entries(shops)) {
		const id = `shop:${name}`
		nodes.set(id, { id, label: name, kind: 'shop', data: { stockTags: def.stockTags } })
		const need = shopNeedTags(def)
		for (const [gName, gDef] of Object.entries(goods)) {
			if (goodHasAnyTag(gDef.tags, def.stockTags)) {
				pushEdge({ source: `good:${gName}`, target: id, kind: 'stocks' })
			}
			// need side only when it differs from stock side
			if (need !== def.stockTags && goodHasAnyTag(gDef.tags, need)) {
				pushEdge({ source: id, target: `good:${gName}`, kind: 'consumes' })
			}
		}
	}

	// --- Finalise -----------------------------------------------------------
	// Drop edges referencing a non-existent endpoint, and empty tag boxes.
	const liveEdges = edges.filter((e) => nodes.has(e.source) && nodes.has(e.target))
	const childCount = new Map<string, number>()
	for (const n of nodes.values())
		if (n.parent) childCount.set(n.parent, (childCount.get(n.parent) ?? 0) + 1)
	const finalNodes = [...nodes.values()].filter(
		(n) => n.kind !== 'tag' || (childCount.get(n.id) ?? 0) > 0
	)

	return { nodes: finalNodes, edges: liveEdges, errors }
}
