import { css } from '@app/lib/css'

css`
  .stat-progress-bar {
    min-width: 0;
    position: relative;
    height: 1.25rem;
    display: flex;
    align-items: center;
  }

  .stat-progress-bar__header {
    position: absolute;
    inset: 0;
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 0 0.5rem;
    z-index: 1;
    pointer-events: none;
  }

  .stat-progress-bar__label {
    font-size: 0.75rem;
    font-weight: 600;
    color: white;
    text-shadow: 0 1px 2px rgba(0, 0, 0, 0.5);
  }

  .stat-progress-bar__value {
    font-size: 0.75rem;
    font-weight: 600;
    color: white;
    text-shadow: 0 1px 2px rgba(0, 0, 0, 0.5);
  }

  .stat-progress-bar__track {
    width: 100%;
    height: 100%;
    background-color: var(--pico-secondary-background);
    border-radius: 4px;
    overflow: hidden;
  }

  .stat-progress-bar__fill {
    height: 100%;
    transition: width 0.3s, background-color 0.3s;
  }

  .stat-progress-bar__fill.green {
    background-color: rgb(34 197 94);
  }

  .stat-progress-bar__fill.yellow {
    background-color: rgb(234 179 8);
  }

  .stat-progress-bar__fill.orange {
    background-color: rgb(249 115 22);
  }

  .stat-progress-bar__fill.red {
    background-color: rgb(239 68 68);
  }
`

interface StatProgressBarProps {
	value: number
	levels: {
		critical: number
		high: number
		satisfied: number
	}
	label: string
	showValue?: boolean
}

const StatProgressBar = (props: StatProgressBarProps) => {
	const computed = {
		get percentage() {
			return Math.min(100, Math.max(0, Math.floor((100 * props.value) / props.levels.critical)))
		},
		get colorClass() {
			if (props.value < props.levels.satisfied) return 'green'
			if (props.value < props.levels.high) return 'yellow'
			if (props.value < props.levels.critical) return 'orange'
			return 'red'
		},
	}

	return (
		<div class="stat-progress-bar">
			<div class="stat-progress-bar__header">
				<span class="stat-progress-bar__label">{props.label}</span>
				<span if={props.showValue} class="stat-progress-bar__value">{computed.percentage}%</span>
			</div>
			<div class="stat-progress-bar__track">
				<div
					class={`stat-progress-bar__fill ${computed.colorClass}`}
					style={`width: ${computed.percentage}%`}
				/>
			</div>
		</div>
	)
}

export default StatProgressBar
