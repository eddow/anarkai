
import type { GoodType } from '@ssh/lib/types/base'
import { Stars } from 'pounce-ui/src'
import { css } from '@app/lib/css'
import type { Game } from '@ssh/lib/game'
import PropertyGridRow from '../PropertyGridRow'
import ResourceImage from '../ResourceImage'
import { tablerOutlinePackage, tablerOutlinePackageOff } from 'pure-glyf/icons'
import { goods as visualGoods } from 'engine-pixi/assets/visual-content'

css`
.specific-storage-config {
	display: contents;
}

.good-buffer-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.5rem;
    padding: 0.25rem 0;
}

.buffer-stars-container {
	display: flex;
	flex-direction: column;
	align-items: flex-end;
	gap: 2px;
}

.buffer-quantity {
	font-size: 0.75rem;
	color: var(--pico-muted-color);
    min-width: 3rem;
    text-align: right;
}
`

interface SpecificStorageConfigurationProps {
	action: Ssh.SpecificStorageAction
	configuration: Ssh.SpecificStorageAlveolusConfiguration
	game: Game
}

export default function SpecificStorageConfiguration(props: SpecificStorageConfigurationProps) {
	const buffers = props.configuration?.buffers || {}
	// Verify action exists before accessing properties
	if (!props.action) return null
	const goods = Object.keys(props.action.goods) as GoodType[]

	// Calculate scale parameters: { maxStars, step }
	const getScaleParams = (max: number) => {
		if (max <= 0) return { maxStars: 5, step: 0 }

		// Target 5, 6, 4 in that order
		if (max % 5 === 0) return { maxStars: 5, step: max / 5 }
		if (max % 6 === 0) return { maxStars: 6, step: max / 6 }
		if (max % 4 === 0) return { maxStars: 4, step: max / 4 }

		// Fallback: 5 stars, with ceiling step
		return { maxStars: 5, step: Math.ceil(max / 5) }
	}

	const getBufferStars = (goodType: GoodType) => {
		const val = buffers[goodType] || 0
		// Allow 0 value (0 stars)
		if (val <= 0) return 0

		const max = props.action.goods[goodType] || 0
		if (max === 0) return 0

		const { step } = getScaleParams(max)
		if (step === 0) return 0

		// val / step => number of stars
		return Math.round(val / step)
	}

	const setBufferFromStars = (goodType: GoodType, stars: number) => {
		if (!props.configuration) return

		let newVal = 0
		if (stars > 0) {
			const max = props.action.goods[goodType] || 0
			const { step, maxStars } = getScaleParams(max)
			// Cap at maxStars just in case, though UI limits it
			const safeStars = Math.min(stars, maxStars)
			newVal = Math.round(safeStars * step)
			// Ensure we don't exceed true max due to rounding
			if (newVal > max) newVal = max
		}

		if (newVal <= 0) {
			delete props.configuration.buffers[goodType]
		} else {
			props.configuration.buffers[goodType] = newVal
		}
	}

	return (
		<div class="specific-storage-config">
			<for each={goods}>
				{(good: GoodType) => {
					const maxQuantity = props.action.goods[good] || 0
					const { maxStars } = getScaleParams(maxQuantity)

					return (
						<div>
							<PropertyGridRow label="">
								<div class="good-buffer-row">
									<ResourceImage
										sprite={visualGoods[good]?.sprites?.[0]}
										width={24}
										height={24}
										game={props.game}
									/>

									<div class="buffer-stars-container">
										<Stars
											maximum={maxStars}
											value={getBufferStars(good)}
											onChange={(v: number | [number, number]) =>
												setBufferFromStars(good, typeof v === 'number' ? v : v[1])
											}
											size="1rem"
											zeroElement={tablerOutlinePackageOff}
											before={tablerOutlinePackage}
											after={tablerOutlinePackage}
										/>
										<span class="buffer-quantity">
											{buffers[good] || 0} / {maxQuantity}
										</span>
									</div>
								</div>
							</PropertyGridRow>
						</div>
					)
				}}
			</for>
		</div>
	)
}
