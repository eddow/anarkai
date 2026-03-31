import {
	tablerFilledPlayerPause,
	tablerFilledPlayerPlay,
	tablerFilledPlayerSkipForward,
	tablerFilledPlayerTrackNext,
	tablerFilledPointer,
	tablerFilledSquareRoundedMinus,
	tablerFilledZoomMoney,
	tablerOutlineTrees,
} from 'pure-glyf/icons'
import * as gameContent from 'ssh/assets/game-content'

/**
 * Single source of truth for toolbar + palette time controls (legacy bar and IDE palette).
 */
export const appShellTimeControls = [
	{ value: 'pause', label: 'Pause', icon: tablerFilledPlayerPause },
	{ value: 'play', label: 'Play', icon: tablerFilledPlayerPlay },
	{
		value: 'fast-forward',
		label: 'Fast Forward',
		icon: tablerFilledPlayerSkipForward,
	},
	{ value: 'gonzales', label: 'Gonzales', icon: tablerFilledPlayerTrackNext },
] as const

export type AppShellTimeControl = (typeof appShellTimeControls)[number]

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
 * Alveolus types that can be built (construction), for toolbar radios and palette action list.
 */
export function getAppShellBuildableAlveoli(): GameAlveolusEntry[] {
	return (Object.entries(gameContent.alveoli) as GameAlveolusEntry[]).filter(
		([, alveolus]) => 'construction' in alveolus
	)
}

export type PaletteSelectedActionValue = {
	value: string
	label: string
	icon?: string
	keywords?: string[]
}

/**
 * Enum options for the palette `selectedAction` tool (command box keywords stay aligned with labels).
 */
export function buildPaletteSelectedActionValues(
	buildableAlveoli: readonly GameAlveolusEntry[]
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
