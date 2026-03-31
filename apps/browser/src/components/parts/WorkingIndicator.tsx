import { css } from '@app/lib/css'

css`
.working-indicator {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    position: relative;
    width: 2.5rem;
    height: 2.5rem;
    padding: 0;
    border: 1px solid var(--ak-border);
    border-radius: 50%;
    background: var(--app-surface-tint, transparent);
    cursor: pointer;
    transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
}

.working-indicator:hover {
    background: var(--ak-surface-1);
    transform: scale(1.05);
}

.working-indicator.not-working {
    border-color: #ef444455;
    background: rgba(239, 68, 68, 0.05);
}

.working-indicator .gear-icon {
    font-size: 1.5rem;
    color: var(--ak-accent);
    transition: color 0.3s, transform 0.5s;
    /* Ensure iconify icon inside scales */
    width: 1.5rem;
    height: 1.5rem;
}

.working-indicator.not-working .gear-icon {
    color: var(--ak-text-muted);
    filter: grayscale(1);
}

@keyframes rotate-gear {
    from { transform: rotate(0deg); }
    to { transform: rotate(360deg); }
}

.working-indicator:not(.not-working) .gear-icon {
    animation: rotate-gear 4s linear infinite;
}

.status-icon {
    position: absolute;
    bottom: -2px;
    right: -2px;
    font-size: 1rem;
    /* In browser-vue, background uses variable, falling back to white. */
    background: var(--ak-surface-0);
    border-radius: 50%;
    padding: 1px;
    box-shadow: 0 1px 3px rgba(0,0,0,0.2);
    width: 1rem; 
    height: 1rem;
}

.status-ok {
    color: #22c55e;
}

.status-off {
    color: #ef4444;
}

.working-indicator.not-working::after {
    content: '';
    position: absolute;
    top: 50%;
    left: 15%;
    width: 70%;
    height: 2px;
    background: #ef4444;
    transform: rotate(-45deg);
    pointer-events: none;
    box-shadow: 0 0 2px rgba(239, 68, 68, 0.5);
}
`

interface WorkingIndicatorProps {
	checked: boolean
	tooltip?: string
	onChange?: (checked: boolean) => void
}

const WorkingIndicator = (props: WorkingIndicatorProps) => {
	const toggle = () => {
		props.onChange?.(!props.checked)
	}

	return (
		<button
			class={`working-indicator ${!props.checked ? 'not-working' : ''}`}
			onClick={toggle}
			title={props.tooltip}
			aria-checked={props.checked ? 'true' : 'false'}
			role="switch"
		>
			<span class="gear-icon">⚙</span>
			<span if={props.checked} class="status-icon status-ok">
				✓
			</span>
			<span else class="status-icon status-off">
				✕
			</span>
		</button>
	)
}

export default WorkingIndicator
