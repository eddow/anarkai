import { css } from '$lib/css'

css`
  .stat-progress-bar {
    min-width: 0;
  }

  .stat-progress-bar__header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 0.25rem;
  }

  .stat-progress-bar__label {
    font-size: 0.875rem;
    font-weight: 500;
    color: var(--pico-color);
  }

  .stat-progress-bar__value {
    font-size: 0.875rem;
    color: var(--pico-muted-color);
  }

  .stat-progress-bar__track {
    width: 100%;
    height: 0.5rem;
    background-color: var(--pico-secondary-background);
    border-radius: 9999px;
    overflow: hidden;
  }

  .stat-progress-bar__fill {
    height: 0.5rem;
    border-radius: 9999px;
    transition: width 0.3s, background-color 0.3s;
  }

  .stat-progress-bar__fill--green {
    background-color: rgb(34 197 94);
  }

  .stat-progress-bar__fill--yellow {
    background-color: rgb(234 179 8);
  }

  .stat-progress-bar__fill--orange {
    background-color: rgb(249 115 22);
  }

  .stat-progress-bar__fill--red {
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

const StatProgressBar = ({ value, levels, label, showValue = true }: StatProgressBarProps) => {
	const percentage = Math.min(100, Math.max(0, Math.floor((100 * value) / levels.critical)))
	
	let colorClass = 'stat-progress-bar__fill--red'
	if (value < levels.satisfied) colorClass = 'stat-progress-bar__fill--green'
	else if (value < levels.high) colorClass = 'stat-progress-bar__fill--yellow'
	else if (value < levels.critical) colorClass = 'stat-progress-bar__fill--orange'

	return (
		<div class="stat-progress-bar">
			<div class="stat-progress-bar__header">
				<span class="stat-progress-bar__label">{label}</span>
				{showValue && <span class="stat-progress-bar__value">{percentage}%</span>}
			</div>
			<div class="stat-progress-bar__track">
				<div
					class={`stat-progress-bar__fill ${colorClass}`}
					style={`width: ${percentage}%`}
				/>
			</div>
		</div>
	)
}

export default StatProgressBar

