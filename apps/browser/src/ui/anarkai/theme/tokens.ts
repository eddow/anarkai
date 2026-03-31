export const anarkaiTokens = {
	surface0: '--ak-surface-0',
	surface1: '--ak-surface-1',
	surfacePanel: '--ak-surface-panel',
	border: '--ak-border',
	borderStrong: '--ak-border-strong',
	accent: '--ak-accent',
	accentActive: '--ak-accent-active',
	text: '--ak-text',
	textMuted: '--ak-text-muted',
	radiusSm: '--ak-radius-sm',
	radiusMd: '--ak-radius-md',
	shadowInset: '--ak-shadow-inset',
	shadowRaised: '--ak-shadow-raised',
	spaceXs: '--ak-space-xs',
	spaceSm: '--ak-space-sm',
	spaceMd: '--ak-space-md',
	controlHeightCompact: '--ak-control-height-compact',
	iconSizeSm: '--ak-icon-size-sm',
	iconSizeMd: '--ak-icon-size-md',
} as const

export type AnarkaiTokenName = (typeof anarkaiTokens)[keyof typeof anarkaiTokens]

export const anarkaiTokenNames = Object.values(anarkaiTokens)

export const anarkaiTokenVar = (token: AnarkaiTokenName) => `var(${token})`
