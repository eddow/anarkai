const SETTINGS_KEY = 'anarkai:art:settings'

export interface ArtSettings {
	readonly pollinationsApiKey: string
}

const DEFAULT_SETTINGS: ArtSettings = {
	pollinationsApiKey: '',
}

export function loadArtSettings(): ArtSettings {
	if (typeof localStorage === 'undefined') return DEFAULT_SETTINGS

	try {
		const value = localStorage.getItem(SETTINGS_KEY)
		if (!value) return DEFAULT_SETTINGS
		const parsed = JSON.parse(value) as Partial<ArtSettings>
		return {
			pollinationsApiKey:
				typeof parsed.pollinationsApiKey === 'string' ? parsed.pollinationsApiKey : '',
		}
	} catch {
		return DEFAULT_SETTINGS
	}
}

export function saveArtSettings(settings: ArtSettings): void {
	if (typeof localStorage === 'undefined') return
	localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings))
}
