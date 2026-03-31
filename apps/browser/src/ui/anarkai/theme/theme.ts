export const anarkaiThemeModes = ['light', 'dark'] as const

export type AnarkaiThemeMode = (typeof anarkaiThemeModes)[number]

export const ANARKAI_THEME_ATTRIBUTE = 'data-theme'

export const resolveAnarkaiThemeMode = (darkMode: boolean): AnarkaiThemeMode =>
	darkMode ? 'dark' : 'light'

export const getAnarkaiThemeAttributes = (theme: AnarkaiThemeMode) => ({
	[ANARKAI_THEME_ATTRIBUTE]: theme,
})
