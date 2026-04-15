import { css } from '@app/lib/css'
import { Button } from '@app/ui/anarkai'
import { goods as sensoryGoods } from 'engine-pixi/assets/visual-content'
import { memoize, reactive } from 'mutts'
import { inputBufferSize } from 'ssh/assets/constants'
import { Alveolus } from 'ssh/board/content/alveolus'
import type { BasicDwelling } from 'ssh/board/content/basic-dwelling'
import { BuildDwelling } from 'ssh/board/content/build-dwelling'
import type { Game } from 'ssh/game'
import { BuildAlveolus } from 'ssh/hive/build'
import { StorageAlveolus } from 'ssh/hive/storage'
import { TransformAlveolus } from 'ssh/hive/transform'
import { i18nState } from 'ssh/i18n'
import type { GoodType } from 'ssh/types/base'
import type { ExchangePriority, GoodsRelations } from 'ssh/utils/advertisement'
import EntityBadge from '../EntityBadge'
import PropertyGridRow from '../PropertyGridRow'

css`
.stored-goods-fieldset {
	display: grid;
	gap: 0.75rem;
	margin: 0;
	padding: 0.5rem 0.75rem 0.75rem;
	border: 1px solid var(--ak-border);
	border-radius: var(--ak-radius-sm);
	background: color-mix(in srgb, var(--ak-surface-panel) 92%, transparent);
}

.stored-goods-fieldset__legend {
	padding: 0 0.25rem;
}

.stored-goods-fieldset__toggle {
	display: inline-flex;
	align-items: center;
	gap: 0.4rem;
	padding: 0;
	border: 0;
	background: transparent;
	color: var(--ak-text);
	font: inherit;
	font-weight: 700;
	cursor: pointer;
}

.stored-goods-fieldset__chevron {
	opacity: 0.8;
	font-size: 0.8rem;
}

.stored-goods-toggle-only {
	display: inline-flex;
	align-items: center;
	padding: 0;
}

.stored-goods-list {
	display: flex;
	flex-wrap: wrap;
	align-items: center;
	gap: 0.5rem;
}

.good-badge {
	display: inline-flex;
	align-items: flex-start;
	gap: 0.125rem;
}

.good-badge__asset {
	position: relative;
	display: inline-flex;
}

.good-status {
	position: absolute;
	top: -0.3rem;
	right: -0.2rem;
	display: inline-flex;
	align-items: center;
	justify-content: center;
	min-width: 1rem;
	height: 1rem;
	padding: 0 0.2rem;
	border-radius: 999px;
	font-weight: 800;
	line-height: 1;
	background: color-mix(in srgb, var(--ak-surface-panel) 88%, transparent);
	border: 1px solid color-mix(in srgb, var(--ak-border) 70%, transparent);
	box-shadow: 0 0 0 1px color-mix(in srgb, var(--ak-surface-panel) 60%, transparent);
}

.good-status.is-provide {
	color: #15803d;
}

.good-status.is-demand {
	color: #b45309;
}

.good-status.is-buffer {
	font-size: 0.7rem;
	opacity: 0.7;
}

.good-status.is-use {
	font-size: 0.82rem;
	opacity: 1;
}

.good-remove {
	position: absolute;
	right: -0.15rem;
	bottom: -0.2rem;
	width: 1rem;
	height: 1rem;
	min-width: 1rem;
	min-height: 1rem;
	padding: 0;
	border-radius: 0.2rem;
	font-size: 0.7rem;
	color: #ef4444;
	background: color-mix(in srgb, var(--ak-surface-panel) 94%, transparent);
	border: 1px solid color-mix(in srgb, var(--ak-border) 70%, transparent);
	box-shadow: 0 0 0 1px color-mix(in srgb, var(--ak-surface-panel) 60%, transparent);
	opacity: 0.85;
}

.good-remove:hover {
	opacity: 1;
}

.cleanup-btn {
	padding: 0.25rem;
	min-height: auto;
	height: auto;
	color: #ef4444;
}

.confirm-overlay {
	display: flex;
	align-items: center;
	flex-wrap: wrap;
	gap: 0.5rem;
	font-size: 0.9rem;
}
`

type GoodsRelation = NonNullable<GoodsRelations[GoodType]>

interface StoredGoodEntry {
	good: GoodType
	qty: number
	relation?: GoodsRelation
	expectedQty?: number
}

interface StoredGoodsRowProps {
	content: Alveolus | BuildDwelling | BasicDwelling
	game: Game
	label: string
}

export default function StoredGoodsRow(props: StoredGoodsRowProps) {
	const stock = memoize(() => props.content.storage?.stock || {})
	const relations = memoize(() => props.content.goodsRelations ?? {})

	const getExpectedQty = (good: GoodType, relation?: GoodsRelation) => {
		if (props.content instanceof BuildDwelling || props.content instanceof BuildAlveolus) {
			return props.content.requiredGoods[good]
		}

		if (relation?.advertisement !== 'demand') return undefined

		if (props.content instanceof StorageAlveolus) {
			const expectedQty = props.content.buffers.get(good)
			return expectedQty && expectedQty > 0 ? expectedQty : undefined
		}

		if (props.content instanceof TransformAlveolus) {
			const expectedQty = (props.content.action?.inputs?.[good] ?? 0) * inputBufferSize
			return expectedQty > 0 ? expectedQty : undefined
		}
		return undefined
	}

	const entries = memoize((): StoredGoodEntry[] =>
		Array.from(
			new Set<GoodType>([
				...Object.entries(stock())
					.filter(([, qty]) => qty > 0)
					.map(([good]) => good as GoodType),
				...(Object.keys(relations()) as GoodType[]),
			])
		)
			.map((good) => {
				const relation = relations()[good] as GoodsRelation | undefined
				return {
					good,
					qty: stock()[good] ?? 0,
					relation,
					expectedQty: getExpectedQty(good, relation),
				}
			})
			.filter((entry) => entry.qty > 0 || !!entry.relation)
			.sort((a, b) => a.good.localeCompare(b.good))
	)

	const hasGoods = memoize(() => entries().length > 0)
	const storedEntries = memoize(() => entries().filter((entry: StoredGoodEntry) => entry.qty > 0))
	const hasMultipleTypes = memoize(() => storedEntries().length > 1)
	const supportsCleanup = memoize(() => props.content instanceof Alveolus)

	const confirmState = reactive({
		mode: undefined as 'all' | 'good' | undefined,
		good: undefined as string | undefined, // For single good confirmation
		expanded: true,
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
		const content = props.content as Alveolus
		if (!supportsCleanup()) return
		if (confirmState.mode === 'all') {
			content.cleanUp()
		} else if (confirmState.mode === 'good' && confirmState.good) {
			content.cleanUpGood(confirmState.good as GoodType)
		}
		cancelConfirm()
	}

	const getPriorityClassName = (priority: ExchangePriority) => {
		switch (priority) {
			case '1-buffer':
				return 'is-buffer'
			case '2-use':
				return 'is-use'
			default:
				return ''
		}
	}

	const getStatusGlyph = (relation?: GoodsRelation) => {
		if (!relation || relation.priority === '0-store') return undefined
		if (relation.priority === '2-use') {
			return relation.advertisement === 'demand' ? '▼' : '▲'
		}
		return relation.advertisement === 'demand' ? '↓' : '↑'
	}

	const getStatusTitle = (entry: StoredGoodEntry) => {
		const relation = entry.relation
		if (!relation || relation.priority === '0-store') return undefined
		const target =
			entry.expectedQty !== undefined && relation.advertisement === 'demand'
				? `, target ${entry.expectedQty}`
				: ''
		return `${entry.good}: ${relation.advertisement} (${relation.priority})${target}`
	}

	const getQtyLabel = (entry: StoredGoodEntry) => {
		if (
			(props.content instanceof BuildAlveolus || props.content instanceof BuildDwelling) &&
			entry.expectedQty !== undefined
		) {
			return `${entry.qty}/${entry.expectedQty}`
		}
		if (entry.expectedQty !== undefined && entry.relation?.advertisement === 'demand') {
			return `${entry.qty}/${entry.expectedQty}`
		}
		if (entry.qty > 0) return `×${entry.qty}`
		if (entry.relation?.advertisement === 'demand') return '0'
		return undefined
	}

	const renderBadge = (entry: StoredGoodEntry) => {
		const relation = entry.relation
		const statusGlyph = getStatusGlyph(relation)
		return (
			<div class="good-badge">
				<div class="good-badge__asset">
					<EntityBadge
						game={props.game}
						sprite={getSprite(entry.good)}
						text={entry.good}
						qtyLabel={getQtyLabel(entry)}
					/>
					<span
						if={statusGlyph}
						class={[
							'good-status',
							relation?.advertisement === 'provide' ? 'is-provide' : 'is-demand',
							relation ? getPriorityClassName(relation.priority) : '',
						]}
						title={getStatusTitle(entry)}
					>
						{statusGlyph}
					</span>
					<Button
						if={supportsCleanup() && confirmState.expanded && entry.qty > 0 && hasMultipleTypes()}
						onClick={() => startCleanGood(entry.good)}
						el:title={String(
							i18nState.translator?.alveolus.cleanUpGoodTooltip?.({
								goodType: entry.good,
							}) ?? ''
						)}
						el:class="good-remove"
					>
						×
					</Button>
				</div>
			</div>
		)
	}

	return (
		<>
			<PropertyGridRow if={hasGoods()}>
				<button
					if={!confirmState.expanded && !confirmState.mode}
					type="button"
					class={['stored-goods-fieldset__toggle', 'stored-goods-toggle-only']}
					onClick={() => (confirmState.expanded = true)}
				>
					<span>{props.label}</span>
					<span class="stored-goods-fieldset__chevron">▶</span>
				</button>

				<fieldset else class="stored-goods-fieldset">
					<legend class="stored-goods-fieldset__legend">
						<button
							type="button"
							class="stored-goods-fieldset__toggle"
							onClick={() => (confirmState.expanded = !confirmState.expanded)}
						>
							<span>{props.label}</span>
							<span class="stored-goods-fieldset__chevron">
								{confirmState.expanded ? '▼' : '▶'}
							</span>
						</button>
					</legend>

					<div if={confirmState.mode} class="confirm-overlay">
						<span>{String(i18nState.translator?.alveolus.cleanUpConfirmText ?? '')}</span>
						<Button onClick={doConfirm} el:title="Confirm">
							{String(i18nState.translator?.alveolus.clear ?? '')}
						</Button>
						<Button onClick={cancelConfirm} el:title="Cancel">
							{String(i18nState.translator?.alveolus.keep ?? '')}
						</Button>
					</div>

					<div else class="stored-goods-list">
						<Button
							if={supportsCleanup() && confirmState.expanded && storedEntries().length > 0}
							onClick={startCleanAll}
							el:title={String(i18nState.translator?.alveolus.cleanUpTooltip ?? '')}
							el:class="cleanup-btn"
						>
							🧹
						</Button>
						<for each={entries()}>{(entry) => renderBadge(entry)}</for>
					</div>
				</fieldset>
			</PropertyGridRow>
		</>
	)
}
