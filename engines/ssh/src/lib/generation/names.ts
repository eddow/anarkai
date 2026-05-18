import { LCG } from 'ssh/utils/numbers'

export type NameThemeId = 'uk-ish' | 'hungarian-ish' | 'middle-earth-ish'
export type NameKind = 'settlement' | 'region' | 'regionSet' | 'hive' | 'character'

export const defaultNameTheme: NameThemeId = 'uk-ish'

type NameTheme = {
	readonly onsets: readonly string[]
	readonly vowels: readonly string[]
	readonly codas: readonly string[]
	readonly joiners: readonly string[]
	readonly suffixes: Partial<Record<NameKind, readonly string[]>>
	readonly compounds: Partial<Record<NameKind, readonly string[]>>
	readonly syllableRange: readonly [number, number]
}

const themes: Record<NameThemeId, NameTheme> = {
	'uk-ish': {
		onsets: ['br', 'cr', 'd', 'f', 'gl', 'h', 'k', 'l', 'm', 'n', 'p', 'r', 's', 't', 'v', 'w'],
		vowels: ['a', 'e', 'i', 'o', 'u', 'ae', 'ea', 'oa'],
		codas: ['b', 'ck', 'd', 'f', 'g', 'l', 'ld', 'm', 'n', 'nd', 'r', 'rd', 's', 'st', 'th'],
		joiners: ['', '', '', 'en', 'er'],
		suffixes: {
			settlement: ['bury', 'ford', 'mere', 'stead', 'wick'],
			region: ['reach', 'weald', 'mere', 'fold'],
			regionSet: ['march', 'shire', 'wold'],
			hive: ['hold', 'works', 'yard'],
			character: ['', '', 'en', 'et'],
		},
		compounds: {
			region: ['Vale', 'Reach', 'Fold'],
			regionSet: ['Marches', 'Wolds', 'Lands'],
			hive: ['Hive', 'Hold', 'Works'],
		},
		syllableRange: [1, 2],
	},
	'hungarian-ish': {
		onsets: ['b', 'cs', 'd', 'f', 'gy', 'h', 'k', 'l', 'm', 'ny', 'p', 'r', 'sz', 't', 'v', 'zs'],
		vowels: ['a', 'e', 'i', 'o', 'u', 'ai', 'eo', 'ia', 'ou'],
		codas: ['d', 'g', 'k', 'l', 'm', 'n', 'r', 's', 'sz', 't', 'v', 'z'],
		joiners: ['', '', 'a', 'e', 'i'],
		suffixes: {
			settlement: ['var', 'hely', 'kert', 'lak', 'szeg'],
			region: ['mez', 'ret', 'volgy', 'tava'],
			regionSet: ['orsz', 'fold', 'hat'],
			hive: ['haz', 'mu', 'telep'],
			character: ['', '', 'ka', 'os'],
		},
		compounds: {
			region: ['Ret', 'Volgy', 'Mezo'],
			regionSet: ['Fold', 'Hatar', 'Videk'],
			hive: ['Haz', 'Muhely', 'Telep'],
		},
		syllableRange: [2, 3],
	},
	'middle-earth-ish': {
		onsets: ['b', 'br', 'd', 'dr', 'f', 'g', 'gl', 'h', 'l', 'm', 'n', 'r', 's', 'th', 'v', 'yr'],
		vowels: ['a', 'e', 'i', 'o', 'u', 'ia', 'io', 'ua', 'y'],
		codas: ['l', 'm', 'n', 'nd', 'r', 'rn', 's', 'th', 'v'],
		joiners: ['', '', 'a', 'el', 'ir'],
		suffixes: {
			settlement: ['bar', 'dun', 'lond', 'nor', 'thir'],
			region: ['dor', 'len', 'rim', 'var'],
			regionSet: ['dair', 'nor', 'ven'],
			hive: ['bar', 'dorn', 'waith'],
			character: ['', '', 'ion', 'eth'],
		},
		compounds: {
			region: ['Dales', 'Rim', 'Reach'],
			regionSet: ['Lands', 'Wards', 'Realms'],
			hive: ['Hall', 'Hive', 'Ward'],
		},
		syllableRange: [2, 3],
	},
}

export function listNameThemes(): NameThemeId[] {
	return Object.keys(themes) as NameThemeId[]
}

function pick<T>(rnd: (max?: number, min?: number) => number, values: readonly T[]): T {
	return values[Math.floor(rnd(values.length))]!
}

function capitalize(value: string): string {
	return value.slice(0, 1).toUpperCase() + value.slice(1)
}

function compactRepeatedLetters(value: string): string {
	return value.replace(/([a-z])\1{2,}/g, '$1$1')
}

function makeRoot(theme: NameTheme, rnd: (max?: number, min?: number) => number): string {
	const [min, max] = theme.syllableRange
	const count = min + Math.floor(rnd(max - min + 1))
	let out = ''
	for (let i = 0; i < count; i++) {
		const joiner = i === 0 ? '' : pick(rnd, theme.joiners)
		out += joiner + pick(rnd, theme.onsets) + pick(rnd, theme.vowels)
		if (rnd() > 0.28) out += pick(rnd, theme.codas)
	}
	return compactRepeatedLetters(out)
}

function withKindShape(
	kind: NameKind,
	root: string,
	theme: NameTheme,
	rnd: (max?: number, min?: number) => number
): string {
	const suffixes = theme.suffixes[kind] ?? []
	const compounds = theme.compounds[kind] ?? []
	if (suffixes.length > 0 && rnd() > 0.22) return `${root}${pick(rnd, suffixes)}`
	if (compounds.length > 0 && rnd() > 0.45) return `${root} ${pick(rnd, compounds)}`
	return root
}

export function generateName(args: {
	readonly seed: number
	readonly theme?: NameThemeId
	readonly kind: NameKind
	readonly key: string
	readonly level?: string | number
}): string {
	const themeId = args.theme ?? defaultNameTheme
	const theme = themes[themeId] ?? themes[defaultNameTheme]
	const rnd = LCG('name', args.seed, themeId, args.kind, args.key, String(args.level ?? ''))
	const root = makeRoot(theme, rnd)
	return capitalize(withKindShape(args.kind, root, theme, rnd))
}
