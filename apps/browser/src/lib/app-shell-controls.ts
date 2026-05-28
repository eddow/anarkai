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
	/** Palette action value, e.g. "build:engineer#building" */
	value: string
	/** Display label, e.g. "Build engineer (building)" */
	label: string
	/** The root alveolus type name for icon lookup. */
	rootName: string
}

/** Walk variant trees and produce palette entries for every leaf. */
export function getAppShellVariantEntries(): AppShellVariantEntry[] {
	const entries: AppShellVariantEntry[] = []
	for (const [name, def] of Object.entries(gameContent.alveoli) as GameAlveolusEntry[]) {
		if (!('construction' in def)) continue
		const variants = (def as any).variants as Record<string, any> | undefined
		if (!variants) continue
		const collect = (prefix: string, v: Record<string, any>, parentLabel: string) => {
			for (const [key, vdef] of Object.entries(v)) {
				const fullId = prefix ? `${prefix}.${key}` : key
				const hasSubVariants = !!(vdef as any).variants
				entries.push({
					value: `build:${name}#${fullId}`,
					label: `Build ${name} (${fullId})`,
					rootName: name,
				})
				if (hasSubVariants) {
					collect(fullId, (vdef as any).variants, `${parentLabel} ${key}`)
				}
			}
		}
		collect('', variants, name)
	}
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
