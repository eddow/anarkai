import { reactive } from 'mutts'
import {
	type CondensedDictionary,
	I18nClient,
	type LocaleFlagsEngine,
	type TextKey,
	type Translator,
} from 'omni18n/ts/s-a'
import gameEn from 'ssh/assets/locales/en.json'
import gameFr from 'ssh/assets/locales/fr.json'
import baseEn from '../locales/en.json'
import baseFr from '../locales/fr.json'

export const locales = ['en', 'fr'] as const
export type Locale = (typeof locales)[number]

export type TextInfos = {}
export type KeyInfos = {}

type I18nState = {
	locale: Locale
	translator: Translator
	localeFlags: LocaleFlagsEngine | undefined
}

const placeholderTranslation = '...'
const reportedTranslationErrorKeys = new Set<string>()

class BrowserI18nClient extends I18nClient {
	report(key: TextKey, error: string, spec: object) {
		const id = String(key)
		if (reportedTranslationErrorKeys.has(id)) return
		reportedTranslationErrorKeys.add(id)
		console.warn(`Translation error for key "${key}": ${error}`, { key, error, spec })
	}
}

function savedLocale(): Locale {
	if (typeof localStorage === 'undefined') return 'en'
	const locale = localStorage.getItem('locale')
	return locale === 'fr' ? locale : 'en'
}

function createPlaceholderTranslator(): Translator {
	const translate = (..._args: unknown[]) => placeholderTranslation
	const handler: ProxyHandler<typeof translate> = {
		get(_target, key) {
			switch (key) {
				case 'then':
				case '__v_isRef':
				case '__v_raw':
					return undefined
				case 'toString':
				case 'valueOf':
				case Symbol.toPrimitive:
					return translate
				case Symbol.toStringTag:
					return 'Translator'
				case 'constructor':
					return String
			}
			if (typeof key !== 'string') return undefined
			return placeholderTranslator
		},
	}
	const placeholderTranslator = new Proxy(translate, handler) as Translator
	return placeholderTranslator
}

const dictionaries = {
	'': {
		en: baseEn as CondensedDictionary,
		fr: baseFr as CondensedDictionary,
	},
	gameX: {
		en: gameEn as CondensedDictionary,
		fr: gameFr as CondensedDictionary,
	},
}

type DictionaryZone = keyof typeof dictionaries

function isDictionaryZone(zone: string): zone is DictionaryZone {
	return zone in dictionaries
}

let queryLocale: Locale = savedLocale()
let localeRequestToken = 0

async function condense(_locales: string[], zones: string[]) {
	return zones.map((zone) => {
		if (!isDictionaryZone(zone)) throw new Error(`Unknown i18n zone "${zone}"`)
		return dictionaries[zone][queryLocale]
	})
}

export const i18nClient = new BrowserI18nClient(['en'], condense)
const initialTranslator = createPlaceholderTranslator()

export const i18nState: I18nState = reactive({
	locale: queryLocale,
	translator: initialTranslator,
	localeFlags: undefined,
})

// TODO: Replace by `export let T` then make sure that in omni18n, the translation finalization uses the current directory so that a dependency is created in mutts
export function getTranslator() {
	return i18nState.translator
}

async function loadLocale(locale: Locale, requestId: number) {
	queryLocale = locale
	await i18nClient.setLocales([locale])
	const translator = await i18nClient.enter('gameX')
	if (requestId !== localeRequestToken) return
	i18nState.translator = translator
}

export async function initTranslator() {
	const requestId = ++localeRequestToken
	await loadLocale(i18nState.locale, requestId)
	return i18nState.translator
}

export function setLocale(newLocale: Locale) {
	i18nState.locale = newLocale
	if (typeof localStorage !== 'undefined') {
		localStorage.setItem('locale', newLocale)
	}
	void initTranslator()
}

export function setLocaleFlags(engine: LocaleFlagsEngine | undefined) {
	i18nState.localeFlags = engine
}
