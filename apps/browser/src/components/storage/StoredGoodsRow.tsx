import { css } from '@app/lib/css'
import { Button } from '@sursaut'
import { goods as sensoryGoods } from 'engine-pixi/assets/visual-content'
import { memoize, reactive } from 'mutts'
import type { Alveolus } from 'ssh/board/content/alveolus'
import type { Game } from 'ssh/game'
import { i18nState } from 'ssh/i18n'
import type { GoodType } from 'ssh/types/base'
import EntityBadge from '../EntityBadge'
import PropertyGridRow from '../PropertyGridRow'

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
	const stock = memoize(() => props.content.storage?.stock || {})

	const entries = memoize(() =>
		Object.entries(stock())
			.filter(([, qty]) => qty && qty > 0)
			.sort(([a], [b]) => a.localeCompare(b))
	)

	const hasGoods = memoize(() => entries().length > 0)
	const hasMultipleTypes = memoize(() => entries().length > 1)

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
			<PropertyGridRow if={hasGoods()} label={props.label}>
				<div if={confirmState.mode} class="confirm-overlay">
					<span>{String(i18nState.translator?.alveolus.cleanUpConfirmText ?? '')}</span>
					<Button onClick={doConfirm} title="Confirm">
						{String(i18nState.translator?.alveolus.clear ?? '')}
					</Button>
					<Button variant="secondary" onClick={cancelConfirm} title="Cancel" class="outline">
						{String(i18nState.translator?.alveolus.keep ?? '')}
					</Button>
				</div>
				<div else class="stored-goods-row">
					<Button
						onClick={startCleanAll}
						title={String(i18nState.translator?.alveolus.cleanUpTooltip ?? '')}
						class="cleanup-btn"
					>
						🧹
					</Button>
					<for each={entries()}>
						{([good, qty]: [string, number]) => (
							<div class="good-with-cleanup">
								<EntityBadge game={props.game} sprite={getSprite(good)} text={good} qty={qty} />
								<Button
									if={hasMultipleTypes()}
									onClick={() => startCleanGood(good)}
									title={String(i18nState.translator?.alveolus.cleanUpGoodTooltip?.({ goodType: good }) ?? '')}
									class="cleanup-btn-small"
								>
									×
								</Button>
							</div>
						)}
					</for>
				</div>
			</PropertyGridRow>
		</>
	)
}
