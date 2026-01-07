import { configuration } from '$lib/globals'
import { css } from '$lib/css'
import { type DockviewWidgetProps, Inline, Radio } from 'pounce-ui/src'

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

const ConfigurationWidget = (props: DockviewWidgetProps, scope: Record<string, any>) => {
	props.title = 'Configuration'

	const handleDarkModeToggle = () => {
		if (scope.toggleTheme) {
			scope.toggleTheme()
		}
	}

	return (
		<div class="configuration-widget">
			<label class="configuration-widget__toggle">
				<input
					type="checkbox"
					checked={scope.theme === 'dark'}
					onChange={handleDarkModeToggle}
				/>
				<span>Dark mode</span>
			</label>
			<fieldset class="configuration-widget__fieldset">
				<legend>Time control</legend>
				<Inline gap="sm" class="configuration-widget__radios">
					{timeOptions.map((option) => (
						<Radio
							name={`time-control-${props.api?.id ?? 'panel'}`}
							value={option.value}
							checked={configuration.timeControl === option.value}
							onChange={() => {
								configuration.timeControl = option.value
							}}
						>
							{option.label}
						</Radio>
					))}
				</Inline>
			</fieldset>
		</div>
	)
}

export default ConfigurationWidget
