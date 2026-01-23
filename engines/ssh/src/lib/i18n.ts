import { effect, reactive } from 'mutts'
import {
	type CondensedDictionary,
	I18nClient,
	type LocaleFlagsEngine,
	type TextKey,
	type Translator,
} from 'omni18n/ts/s-a'

export const locales = ['en', 'fr'] as const
export type Locale = (typeof locales)[number]

export type TextInfos = {}
export type KeyInfos = {}

type I18nState = {
	locale: Locale
	translator: Translator | undefined
	localeFlags: LocaleFlagsEngine | undefined
}

class ClientSideClient extends I18nClient {
	report(key: TextKey, error: string, spec: object) {
		console.warn(`Translation error for key "${key}": ${error}`, spec)
	}
}

const savedLocale =
	(typeof localStorage !== 'undefined'
		? (localStorage.getItem('locale') as Locale | null)
		: null) ?? 'en'

let queryLocale: Locale = savedLocale
let localeRequestToken = 0

const imports = {
	'': {
		en: () => import('@app/locales/en.json'),
		fr: () => import('@app/locales/fr.json'),
	},
	gameX: {
		en: () => import('$assets/locales/en.json'),
		fr: () => import('$assets/locales/fr.json'),
	},
}

async function condense(_lng: string[], zones: string[]) {
	return Promise.all(
		zones.map((zone) => imports[zone as keyof typeof imports][queryLocale]()),
	).then((cds) => cds.map((cd) => cd.default) as CondensedDictionary[])
}

export const i18nClient = new ClientSideClient(['en'], condense)

export const i18nState: I18nState = reactive({
	locale: savedLocale,
	translator: undefined,
	localeFlags: undefined,
})
export let T: Translator = null!
effect(() => {
	T = i18nState.translator!
})
async function loadLocale(locale: Locale, requestId: number) {
	queryLocale = locale
	await i18nClient.setLocales([locale])
	const translator = await i18nClient.enter('gameX')
	if (requestId !== localeRequestToken) return
	i18nState.translator = translator
}

const translationEffect = effect(() => {
	const currentLocale = i18nState.locale
	const requestId = ++localeRequestToken
	void loadLocale(currentLocale, requestId)
})
void translationEffect // Store to avoid GC cleanup

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
}

export function setLocaleFlags(engine: LocaleFlagsEngine | undefined) {
	i18nState.localeFlags = engine
}
