import {
	tablerFilledPointer,
	tablerFilledSquareRoundedMinus,
	tablerFilledZoomMoney,
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

export type PaletteSelectedActionValue = {
	value: string
	label: string
	icon?: string | JSX.Element | (() => JSX.Element)
	keywords?: string[]
}

/**
 * Enum options for the palette `selectedAction` tool (command box keywords stay aligned with labels).
 */
export function buildPaletteSelectedActionValues(
	buildableAlveoli: readonly GameAlveolusEntry[],
	getBuildIcon?: (name: string) => string | JSX.Element | (() => JSX.Element) | undefined
): PaletteSelectedActionValue[] {
	const select: PaletteSelectedActionValue[] = [
		{
			value: '',
			label: 'Select',
			icon: typeof tablerFilledPointer === 'string' ? tablerFilledPointer : undefined,
			keywords: ['select', 'pointer'],
		},
	]
	const build = buildableAlveoli.map(([name]) => ({
		value: `build:${name}`,
		label: `Build ${name}`,
		icon: getBuildIcon?.(name),
		keywords: ['build', 'construction', name],
	}))
	const zones = appShellZoneActions.map((z) => ({
		value: z.value,
		label: z.label,
		icon: typeof z.icon === 'string' ? z.icon : undefined,
		keywords:
			z.value === 'zone:residential'
				? ['zone', 'residential', 'zoning']
				: z.value === 'zone:harvest'
					? ['zone', 'harvest', 'trees']
					: ['zone', 'unzone', 'clear'],
	}))
	return [...select, ...build, ...zones]
}
