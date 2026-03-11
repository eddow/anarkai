import { css } from '@app/lib/css'
import { configuration, uiConfiguration } from '@app/lib/globals'
import { Inline, Radio } from '@pounce'
import { type DockviewWidgetProps, type DockviewWidgetScope } from '@pounce/ui/dockview'

css`
.configuration-widget {
	display: flex;
	flex-direction: column;
	gap: 1rem;
	padding: 1.2rem;
	color: var(--toolbar-text);
}

.configuration-widget__toggle {
	display: flex;
	align-items: center;
	gap: 0.6rem;
	font-weight: 500;
}

.configuration-widget__fieldset {
	margin: 0;
	border-radius: 0.75rem;
	border: 1px solid var(--app-border);
	padding: 0.75rem 1rem 1rem;
}

.configuration-widget__radios {
	display: flex;
	flex-direction: column;
	gap: 0.5rem;
	margin-top: 0.5rem;
}

.configuration-widget__radio {
	display: flex;
	align-items: center;
	gap: 0.5rem;
}
`

const timeOptions = [
	{ value: 'pause', label: 'Pause' },
	{ value: 'play', label: 'Play' },
	{ value: 'fast-forward', label: 'Fast forward' },
	{ value: 'gonzales', label: 'Gonzales' },
] as const

const themeOptions = [
	{ value: 'light', label: 'Light' },
	{ value: 'dark', label: 'Dark' },
] as const

const ConfigurationWidget = (props: DockviewWidgetProps, scope: DockviewWidgetScope) => {
	const api = (scope as any).panelApi
	props.title = 'Configuration'

	return (
		<div class="configuration-widget">
			<fieldset class="configuration-widget__fieldset">
				<legend>Theme</legend>
				<Inline gap="sm" class="configuration-widget__radios">
					<for each={themeOptions}>
						{(option: (typeof themeOptions)[number]) => (
							<Radio
								name={`theme-${api?.id ?? 'panel'}`}
								value={option.value}
								checked={(uiConfiguration.darkMode ? 'dark' : 'light') === option.value}
								onChange={() => {
									uiConfiguration.darkMode = option.value === 'dark'
								}}
							>
								{option.label}
							</Radio>
						)}
					</for>
				</Inline>
			</fieldset>
			<fieldset class="configuration-widget__fieldset">
				<legend>Time control</legend>
				<Inline gap="sm" class="configuration-widget__radios">
					<for each={timeOptions}>
						{(option: (typeof timeOptions)[number]) => (
							<Radio
								name={`time-control-${api?.id ?? 'panel'}`}
								value={option.value}
								checked={configuration.timeControl === option.value}
								onChange={() => {
									configuration.timeControl = option.value
								}}
							>
								{option.label}
							</Radio>
						)}
					</for>
				</Inline>
			</fieldset>
		</div>
	)
}

export default ConfigurationWidget
