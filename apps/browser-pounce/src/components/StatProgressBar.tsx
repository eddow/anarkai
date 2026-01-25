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

