import { Button } from 'pounce-ui/src'
import { css } from '@app/lib/css'

css`
  .alveolus-flag {
    display: inline-flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.25rem 0.5rem;
    border: 1px solid var(--pico-border-color);
    border-radius: var(--pico-border-radius);
    transition: background-color 0.2s, border-color 0.2s, color 0.2s;
    font-size: 0.875rem;
    cursor: pointer;
  }

  .alveolus-flag--checked {
    background-color: var(--pico-primary-background);
    border-color: var(--pico-primary-border);
    color: var(--pico-primary-inverse);
  }

  .alveolus-flag--unchecked {
    background-color: var(--pico-secondary-background);
    border-color: var(--pico-border-color);
    color: var(--pico-color);
  }

  .alveolus-flag--unchecked:hover {
    background-color: var(--pico-secondary-hover-background);
  }

  .alveolus-flag__name {
    font-weight: 500;
  }
`

interface AlveolusFlagProps {
  checked: boolean
  icon: string
  name: string
  tooltip: string
  onChange?: (checked: boolean) => void
}

const AlveolusFlag = ({ checked, icon, name, tooltip, onChange }: AlveolusFlagProps) => {
 	const toggle = () => {
 		onChange?.(!checked)
 	}

	return (
		<Button
			icon={icon}
			onClick={toggle}
			aria-label={tooltip}
			el:class={`alveolus-flag ${checked ? 'alveolus-flag--checked' : 'alveolus-flag--unchecked'}`}
		>
			<span class="alveolus-flag__name">{name}</span>
		</Button>
	)
}

export default AlveolusFlag

