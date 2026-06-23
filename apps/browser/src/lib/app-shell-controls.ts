import {
	tablerFilledPointer,
	tablerFilledSquareRoundedMinus,
	tablerFilledZoomMoney,
	tablerOutlineBuildingStore,
	tablerOutlineRoad,
	tablerOutlineTrees,
} from 'pure-glyf/icons'
import * as gameContent from 'ssh/assets/game-content'

/**
 * Zone / unzone interaction values shared by legacy toolbar and palette enum.
 */
export const appShellZoneActions = [
	{
		value: 'zone:residential',
		label: 'Residential',
		icon: tablerFilledZoomMoney,
	},
	{ value: 'zone:harvest', label: 'Harvest', icon: tablerOutlineTrees },
	{ value: 'zone:commercial', label: 'Commercial', icon: tablerOutlineBuildingStore },
	{ value: 'zone:none', label: 'Unzone', icon: tablerFilledSquareRoundedMinus },
] as const

export type AppShellZoneAction = (typeof appShellZoneActions)[number]

type GameAlveolusMap = typeof gameContent.alveoli
type GameAlveolusEntry = [string, GameAlveolusMap[keyof GameAlveolusMap]]

function humanizeAppShellName(value: string): string {
	return value
		.replace(/[._]+/g, ' ')
		.replace(/\s+/g, ' ')
		.trim()
		.replace(/\b\w/g, (letter) => letter.toUpperCase())
}

/**
 * Alveolus types that can be built from the toolbar / palette.
 */
export function getAppShellBuildableAlveoli(): GameAlveolusEntry[] {
	return (Object.entries(gameContent.alveoli) as GameAlveolusEntry[]).filter(
		([, alveolus]) => 'construction' in alveolus
	)
}

/** A flat entry for a buildable variant leaf. */
export interface AppShellVariantEntry {
	/** Palette action value, e.g. "build:engineer.building" */
	value: string
	/** Display label, e.g. "Build engineer (building)" */
	label: string
	/** The root alveolus type name for icon lookup. */
	rootName: string
}

export interface AppShellBuildVariantNode {
	/** Variant path relative to the root alveolus, e.g. "wood.extra". */
	id: string
	/** Human-readable label for the toolbar trigger or choice. */
	label: string
	/** Palette action value, e.g. "build:pile.wood.extra". */
	value: string
	/** Child variants, when this node opens another drawer level. */
	children: AppShellBuildVariantNode[]
}

export interface AppShellBuildToolbarRoot {
	/** Root alveolus name from ssh/assets/game-content. */
	rootName: string
	/** Human-readable label for the root toolbar button. */
	label: string
	/** Palette action value for the root build action. */
	value: string
	/** Nested build variants available under this root. */
	variants: AppShellBuildVariantNode[]
}

function appShellBuildVariantNodes(
	rootName: string,
	variants: Record<string, any>,
	prefix = ''
): AppShellBuildVariantNode[] {
	return Object.entries(variants).map(([key, variant]) => {
		const id = prefix ? `${prefix}.${key}` : key
		const nested =
			typeof variant === 'object' && variant !== null && 'variants' in variant && variant.variants
				? appShellBuildVariantNodes(rootName, variant.variants as Record<string, any>, id)
				: []
		return {
			id,
			label: humanizeAppShellName(key),
			value: `build:${rootName}.${id}`,
			children: nested,
		}
	})
}

/** Buildable root alveoli plus nested variant trees for toolbar generation. */
export function getAppShellBuildToolbarRoots(): AppShellBuildToolbarRoot[] {
	return getAppShellBuildableAlveoli().map(([name, def]) => ({
		rootName: name,
		label: humanizeAppShellName(name),
		value: `build:${name}`,
		variants:
			typeof def === 'object' && def !== null && 'variants' in def && def.variants
				? appShellBuildVariantNodes(name, def.variants as Record<string, any>)
				: [],
	}))
}

/** Walk variant trees and produce palette entries for every leaf. */
export function getAppShellVariantEntries(): AppShellVariantEntry[] {
	const entries: AppShellVariantEntry[] = []
	const collect = (rootName: string, nodes: readonly AppShellBuildVariantNode[]) => {
		for (const node of nodes) {
			entries.push({
				value: node.value,
				label: `Build ${humanizeAppShellName(rootName)} (${node.id})`,
				rootName,
			})
			if (node.children.length > 0) collect(rootName, node.children)
		}
	}
	for (const root of getAppShellBuildToolbarRoots()) collect(root.rootName, root.variants)
	return entries
}

export type PaletteSelectedActionValue = {
	value: string
	label: string
	icon?: string | JSX.Element | (() => JSX.Element)
	keywords?: string[]
}

/**
 * Enum options for the palette `selectedAction` tool (command box keywords stay aligned with labels).
 * Includes root alveoli as well as variant leaf entries.
 */
export function buildPaletteSelectedActionValues(
	buildableAlveoli: readonly GameAlveolusEntry[],
	getBuildIcon?: (name: string) => string | JSX.Element | (() => JSX.Element) | undefined,
	getCommandIcon?: (name: string) => string | JSX.Element | (() => JSX.Element) | undefined
): PaletteSelectedActionValue[] {
	const select: PaletteSelectedActionValue[] = [
		{
			value: '',
			label: 'Select',
			icon: typeof tablerFilledPointer === 'string' ? tablerFilledPointer : undefined,
			keywords: ['select', 'pointer'],
		},
	]
	const buildRoots = buildableAlveoli.map(([name]) => ({
		value: `build:${name}`,
		label: `Build ${name}`,
		icon: getBuildIcon?.(name),
		keywords: ['build', 'construction', name],
	}))
	const variantEntries = getAppShellVariantEntries().map((v) => ({
		value: v.value,
		label: v.label,
		icon: getBuildIcon?.(v.rootName),
		keywords: ['build', 'construction', 'variant', v.rootName],
	}))
	const build = [...buildRoots, ...variantEntries]
	const bulldoze: PaletteSelectedActionValue = {
		value: 'bulldoze',
		label: 'Bulldoze',
		icon: getCommandIcon?.('bulldoze'),
		keywords: ['bulldoze', 'remove', 'delete', 'clear'],
	}
	const zones = appShellZoneActions.map((z) => ({
		value: z.value,
		label: z.label,
		icon: typeof z.icon === 'string' ? z.icon : undefined,
		keywords:
			z.value === 'zone:residential'
				? ['zone', 'residential', 'zoning']
				: z.value === 'zone:harvest'
					? ['zone', 'harvest', 'trees']
					: z.value === 'zone:commercial'
						? ['zone', 'commercial', 'shop', 'restaurant', 'leisure']
						: ['zone', 'unzone', 'clear'],
	}))
	const roads: PaletteSelectedActionValue[] = [
		{
			value: 'road:path',
			label: 'Path',
			icon: typeof tablerOutlineRoad === 'string' ? tablerOutlineRoad : undefined,
			keywords: ['road', 'path'],
		},
		{
			value: 'road:asphalt',
			label: 'Asphalt',
			icon: typeof tablerOutlineRoad === 'string' ? tablerOutlineRoad : undefined,
			keywords: ['road', 'asphalt', 'paved'],
		},
	]
	return [...select, ...build, bulldoze, ...zones, ...roads]
}
