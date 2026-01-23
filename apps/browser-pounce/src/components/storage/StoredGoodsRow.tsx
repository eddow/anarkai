import { derived, reactive } from 'mutts'
import { goods as sensoryGoods } from 'engine-pixi/assets/visual-content'
import type { Alveolus } from 'ssh/src/lib/board/content/alveolus'
import type { GoodType } from 'ssh/src/lib/types/base'

import PropertyGridRow from '../PropertyGridRow'
import EntityBadge from '../EntityBadge'
import { Button } from 'pounce-ui/src'
import { mdiBroom, mdiCloseCircleOutline } from 'pure-glyf/icons'
import { T } from 'ssh/src/lib/i18n'
import { css } from '@app/lib/css'
import type { Game } from 'ssh/src/lib/game'

css`
.stored-goods-row {
	display: flex;
	flex-wrap: wrap;
	align-items: center;
	gap: 0.5rem;
}

.good-with-cleanup {
	display: inline-flex;
	align-items: center;
	gap: 0.125rem;
	position: relative;
}

.cleanup-btn {
	padding: 0.25rem;
	min-height: auto;
	height: auto;
	color: var(--pico-del-color, #ef4444);
}

.cleanup-btn-small {
	padding: 0.125rem;
	min-height: auto;
	height: auto;
	font-size: 0.75rem;
	color: var(--pico-del-color, #ef4444);
	opacity: 0.7;
}

.cleanup-btn-small:hover {
	opacity: 1;
}

.confirm-overlay {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    font-size: 0.9rem;
}
`

interface StoredGoodsRowProps {
	content: Alveolus
	game: Game
	label: string
}

export default function StoredGoodsRow(props: StoredGoodsRowProps) {
	// Access stock reactively
	const stock = derived(() => props.content.storage?.stock || {})

	const entries = derived(() =>
		Object.entries(stock.value)
			.filter(([, qty]) => qty && qty > 0)
			.sort(([a], [b]) => a.localeCompare(b))
	)

	const hasGoods = derived(() => entries.value.length > 0)
	const hasMultipleTypes = derived(() => entries.value.length > 1)

	const confirmState = reactive({
		mode: undefined as 'all' | 'good' | undefined,
		good: undefined as string | undefined, // For single good confirmation
	})

	const getSprite = (good: string) => {
		return sensoryGoods[good as keyof typeof sensoryGoods]?.sprites?.[0] || 'default'
	}

	const startCleanAll = () => {
		confirmState.mode = 'all'
		confirmState.good = undefined
	}

	const startCleanGood = (good: string) => {
		confirmState.mode = 'good'
		confirmState.good = good
	}

	const cancelConfirm = () => {
		confirmState.mode = undefined
		confirmState.good = undefined
	}

	const doConfirm = () => {
		if (confirmState.mode === 'all') {
			props.content.cleanUp()
		} else if (confirmState.mode === 'good' && confirmState.good) {
			props.content.cleanUpGood(confirmState.good as GoodType)
		}
		cancelConfirm()
	}

	return (
		<>
			{hasGoods.value && (
				<PropertyGridRow label={props.label}>
					{confirmState.mode ? (
						<div class="confirm-overlay">
							<span>{String(T.alveolus.cleanUpConfirmText)}</span>
							<Button
								onClick={doConfirm}
								el={{ title: 'Confirm' }}
							>
								{String(T.alveolus.clear)}
							</Button>
							<Button
								variant="secondary"
								onClick={cancelConfirm}
								el={{ title: 'Cancel', class: 'outline' }}
							>
								{String(T.alveolus.keep)}
							</Button>
						</div>
					) : (
						<div class="stored-goods-row">
							<Button
								icon={mdiBroom}
								onClick={startCleanAll}
								el={{ title: String(T.alveolus.cleanUpTooltip), class: 'cleanup-btn' }}
							/>
							{entries.value.map(([good, qty]) => (
								<div class="good-with-cleanup">
									<EntityBadge
										game={props.game}
										sprite={getSprite(good)}
										text={good}
										qty={qty}
									/>
									{hasMultipleTypes.value && (
										<Button
											icon={mdiCloseCircleOutline}
											onClick={() => startCleanGood(good)}
											el={{ title: String(T.alveolus.cleanUpGoodTooltip({ goodType: good })), class: 'cleanup-btn-small' }}
										/>
									)}
								</div>
							))}
						</div>
					)}
				</PropertyGridRow>
			)}
		</>
	)
}
