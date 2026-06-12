import { css } from '@app/lib/css'
import { game } from '@app/lib/globals'
import { variantBadges } from 'engine-pixi/assets/visual-content'
import ResourceImage from '../ResourceImage'

css`
  .variant-picker {
    position: relative;
    display: inline-flex;
  }

  .variant-picker > details > summary {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 1.45rem;
    height: 1.45rem;
    padding: 0;
    border: 1.5px solid color-mix(in srgb, var(--ak-text-muted) 16%, transparent);
    border-radius: 4px;
    background: color-mix(in srgb, var(--ak-surface-panel) 88%, transparent);
    cursor: pointer;
    overflow: hidden;
    list-style: none;
    box-sizing: border-box;
  }

  .variant-picker > details > summary::-webkit-details-marker {
    display: none;
  }

  .variant-picker > details > summary:hover {
    border-color: #3b82f6;
    background: rgba(59, 130, 246, 0.10);
  }

  .variant-picker > details[open] > summary {
    border-color: #3b82f6;
    background: rgba(59, 130, 246, 0.14);
  }

  .variant-picker__panel {
    position: absolute;
    top: 100%;
    left: 0;
    z-index: 20;
    display: flex;
    flex-wrap: wrap;
    gap: 3px;
    padding: 4px;
    margin-top: 3px;
    border: 1px solid color-mix(in srgb, var(--ak-text-muted) 14%, transparent);
    border-radius: 6px;
    background: var(--ak-surface-panel);
    box-shadow: 0 4px 14px rgba(0, 0, 0, 0.18);
    min-width: max-content;
  }

  .variant-picker__btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 1.45rem;
    height: 1.45rem;
    padding: 1px;
    border: 1.5px solid transparent;
    border-radius: 4px;
    background: color-mix(in srgb, var(--ak-surface-panel) 84%, transparent);
    cursor: pointer;
    box-sizing: border-box;
    overflow: hidden;
  }

  .variant-picker__btn:hover {
    background: color-mix(in srgb, var(--ak-surface-panel) 66%, transparent);
    border-color: color-mix(in srgb, var(--ak-text-muted) 24%, transparent);
  }

  .variant-picker__btn[data-selected='true'] {
    border-color: #3b82f6;
    background: rgba(59, 130, 246, 0.14);
    box-shadow: 0 0 0 1px rgba(59, 130, 246, 0.18);
  }

  .variant-picker__btn--root {
    color: var(--ak-text-muted);
    font-size: 0.68rem;
    font-weight: 700;
    line-height: 1;
  }
`

export interface VariantOption {
	value: string
	label: string
	badgeSprite?: string
}

/** Map internal variant segment keys to display names. */
const variantNameOverrides: Record<string, string> = {
	extra: 'Reinforced',
}

/** Turn a variant segment key into a display label. */
export function variantDisplayLabel(key: string): string {
	const override = variantNameOverrides[key]
	if (override) return override
	return key
		.replace(/[._]+/g, ' ')
		.replace(/\s+/g, ' ')
		.trim()
		.replace(/\b\w/g, (letter) => letter.toUpperCase())
}

interface VariantPickerProps {
	options: readonly VariantOption[]
	value: string
	onChange: (value: string) => void
	rootLabel?: string
	/** Hide the root (∅) button when a variant is already active. */
	hideRoot?: boolean
	/** Root type key (e.g. 'engineer') for looking up the current variant badge directly. */
	typeKey?: string
}

const VariantPicker = (props: VariantPickerProps) => {
	const selectedOption = () =>
		props.value ? props.options.find((opt) => opt.value === props.value) : undefined
	const selectedBadge = () =>
		selectedOption()?.badgeSprite ??
		(props.value && props.typeKey
			? variantBadges[`${props.typeKey}.${props.value}`]?.sprites?.[0]
			: undefined)
	const selectedTitle = () =>
		selectedOption()?.label ??
		(props.value
			? variantDisplayLabel(props.value.split('.').pop() ?? props.value)
			: (props.rootLabel ?? 'Root'))

	const pick = (value: string, detailsEl: HTMLDetailsElement | null) => {
		props.onChange(value)
		if (detailsEl) detailsEl.open = false
	}

	const syncOpen = (detailsEl: HTMLDetailsElement) => {
		const onDocClick = (e: MouseEvent) => {
			if (!(e.target instanceof Node)) return
			if (!detailsEl.contains(e.target)) detailsEl.open = false
		}
		document.addEventListener('click', onDocClick, true)
		return () => document.removeEventListener('click', onDocClick, true)
	}

	return (
		<div class="variant-picker">
			<details use={syncOpen}>
				<summary title={selectedTitle()}>
					{selectedBadge() ? (
						<ResourceImage
							game={game}
							sprite={selectedBadge()!}
							width={18}
							height={18}
							alt={selectedTitle()}
						/>
					) : (
						<span class="variant-picker__btn--root">∅</span>
					)}
				</summary>
				<div class="variant-picker__panel">
					<button
						if={!props.hideRoot}
						type="button"
						class="variant-picker__btn variant-picker__btn--root"
						data-selected={!props.value ? 'true' : 'false'}
						title={props.rootLabel ?? 'Root'}
						onClick={(event) => {
							const details = (event.currentTarget as HTMLElement).closest(
								'details'
							) as HTMLDetailsElement | null
							pick('', details)
						}}
					>
						∅
					</button>
					<for each={props.options}>
						{(opt) => (
							<button
								type="button"
								class="variant-picker__btn"
								data-selected={props.value === opt.value ? 'true' : 'false'}
								title={opt.label}
								onClick={(event) => {
									const details = (event.currentTarget as HTMLElement).closest(
										'details'
									) as HTMLDetailsElement | null
									pick(opt.value, details)
								}}
							>
								{opt.badgeSprite ? (
									<ResourceImage
										game={game}
										sprite={opt.badgeSprite}
										width={18}
										height={18}
										alt={opt.label}
									/>
								) : (
									<span>{opt.label.slice(0, 2)}</span>
								)}
							</button>
						)}
					</for>
				</div>
			</details>
		</div>
	)
}

export default VariantPicker
