import { css } from '@app/lib/css'
import { bumpSelectionTitleVersion } from '@app/lib/globals'
import { InspectorSection } from '@app/ui/anarkai'
import { goods as gameGoods } from 'engine-rules'
import type {
	FreightLineDefinition,
	FreightLineMode,
	SyntheticFreightLineObject,
} from 'ssh/freight/freight-line'
import { freightLineStationLabel } from 'ssh/freight/freight-line'
import type { GoodSelectionPolicy } from 'ssh/freight/goods-selection-policy'
import {
	collectSortedDistinctTagsFromGoodsCatalog,
	freightLineEditorGoodsSelectionPolicy,
	patchGoodsSelectionFromEditor,
	UNRESTRICTED_GOODS_SELECTION_POLICY,
} from 'ssh/freight/goods-selection-policy'
import { i18nState } from 'ssh/i18n'
import type { GoodType } from 'ssh/types/base'
import GoodSelectionRulesEditor from './GoodSelectionRulesEditor'
import InspectorObjectLink from './InspectorObjectLink'
import LinkedEntityControl from './LinkedEntityControl'
import PropertyGrid from './PropertyGrid'
import PropertyGridRow from './PropertyGridRow'

css`
.freight-line-properties__name,
.freight-line-properties__mode,
.freight-line-properties__radius {
	width: 100%;
	box-sizing: border-box;
	padding: 0.35rem 0.5rem;
	border: 1px solid color-mix(in srgb, var(--ak-text-muted) 18%, transparent);
	border-radius: 0.45rem;
	background: color-mix(in srgb, var(--ak-surface-panel) 92%, transparent);
	color: var(--ak-text);
}

.freight-line-properties__radius[disabled] {
	opacity: 0.6;
}

.freight-line-properties__stop,
.freight-line-properties__uid {
	font-family: ui-monospace, monospace;
	font-size: 0.75rem;
	color: var(--ak-text-muted);
	word-break: break-word;
}

.freight-line-properties__stop-link {
	display: inline-flex;
	align-items: center;
	gap: 0.5rem;
}

.freight-line-properties__stations-group {
	margin-top: 0.75rem;
	border: 1px solid color-mix(in srgb, var(--ak-text-muted) 18%, transparent);
	border-radius: 0.6rem;
	background: color-mix(in srgb, var(--ak-surface-panel) 88%, transparent);
	overflow: hidden;
}

.freight-line-properties__stations-summary {
	cursor: pointer;
	padding: 0.65rem 0.8rem;
	font-size: 0.8rem;
	font-weight: 600;
	list-style: none;
	display: flex;
	align-items: center;
	justify-content: space-between;
	gap: 0.75rem;
}

.freight-line-properties__stations-summary::-webkit-details-marker {
	display: none;
}

.freight-line-properties__stations-summary-label {
	display: inline-flex;
	align-items: center;
	gap: 0.5rem;
}

.freight-line-properties__stations-summary-caret {
	display: inline-flex;
	align-items: center;
	justify-content: center;
	font-size: 0.85rem;
	color: var(--ak-text-muted);
	transform: rotate(-90deg);
	transition: transform 120ms ease;
}

.freight-line-properties__stations-group[open] .freight-line-properties__stations-summary-caret {
	transform: rotate(0deg);
}

.freight-line-properties__stations-body {
	display: flex;
	flex-direction: column;
	gap: 0.5rem;
	padding: 0 0.8rem 0.8rem;
}

.freight-line-properties__station-item {
	display: flex;
	align-items: center;
	gap: 0.5rem;
}

.freight-line-properties__goods-selection {
	width: 100%;
}
`

interface FreightLinePropertiesProps {
	lineObject: SyntheticFreightLineObject
}

const goodsList = Object.keys(gameGoods) as GoodType[]

const sortedDistinctTags = collectSortedDistinctTagsFromGoodsCatalog(gameGoods)

const FreightLineProperties = (props: FreightLinePropertiesProps) => {
	const currentGame = () => props.lineObject?.game
	const currentLine = () => {
		const fallback = props.lineObject?.line
		const lineId = props.lineObject?.lineId
		const game = currentGame()
		if (!fallback || !game || !lineId) return fallback
		return game.freightLines.find((line) => line.id === lineId) ?? fallback
	}
	const currentMode = () => currentLine()?.mode ?? 'gather'
	const currentName = () => currentLine()?.name ?? ''
	const currentRadius = () => currentLine()?.radius
	const stationLabel = (stop: FreightLineDefinition['stops'][number]) => {
		return stop ? freightLineStationLabel(stop) : '—'
	}
	const stationTile = (stop: FreightLineDefinition['stops'][number]) => {
		const game = currentGame()
		if (!game) return undefined
		return game.hex.getTile({ q: stop.coord[0], r: stop.coord[1] })
	}
	const stations = () => currentLine()?.stops ?? []
	const updateLine = (patch: Partial<FreightLineDefinition>) => {
		const line = currentLine()
		const game = currentGame()
		if (!line || !game) return
		const nextName = patch.name
		const hasTitleChange = typeof nextName === 'string' && nextName !== line.name
		game.replaceFreightLine({
			...line,
			...patch,
		})
		if (hasTitleChange) bumpSelectionTitleVersion()
	}
	const goodsSelectionPolicy = () => {
		const line = currentLine()
		if (!line) return UNRESTRICTED_GOODS_SELECTION_POLICY
		return freightLineEditorGoodsSelectionPolicy(line)
	}
	const goodOptions = () =>
		goodsList.map((id) => ({
			id,
			label: i18nState.translator?.goods?.[id] ?? id,
		}))
	const tagOptions = () =>
		sortedDistinctTags.map((id) => ({
			id,
			label: i18nState.translator?.goodsTags?.[id] ?? id,
		}))
	const isGoodEligibleForLine = (_good: GoodType) => true
	const handleGoodsSelectionChange = (next: GoodSelectionPolicy) => {
		const line = currentLine()
		if (!line) return
		const filtered = {
			...next,
			goodRules: next.goodRules.filter((rule) => isGoodEligibleForLine(rule.goodType)),
		}
		updateLine({
			...patchGoodsSelectionFromEditor(filtered),
			filters: undefined,
		})
	}
	const handleModeChange = (mode: FreightLineMode) => {
		updateLine({
			mode,
			radius: mode === 'gather' ? currentRadius() : undefined,
		})
	}
	const handleRadiusChange = (value: string) => {
		const radius =
			value.trim() === '' || Number.isNaN(Number(value))
				? undefined
				: Math.max(0, Math.floor(Number(value)))
		updateLine({
			radius: currentMode() === 'gather' ? radius : undefined,
		})
	}
	const isAvailable = () => !!props.lineObject && !!currentLine()

	return (
		<InspectorSection title={i18nState.translator?.line?.section ?? 'Freight line'}>
			<PropertyGrid>
				<PropertyGridRow if={!isAvailable()}>
					<span class="freight-line-properties__stop">
						{i18nState.translator?.line?.unavailable ?? 'Line is no longer available.'}
					</span>
				</PropertyGridRow>
				<PropertyGridRow label={i18nState.translator?.line?.name ?? 'Name'}>
					<input
						class="freight-line-properties__name"
						type="text"
						disabled={!isAvailable()}
						value={currentName()}
						onInput={(event) =>
							updateLine({ name: (event.currentTarget as HTMLInputElement).value })
						}
					/>
				</PropertyGridRow>
				<PropertyGridRow label={i18nState.translator?.line?.mode ?? 'Mode'}>
					<select
						class="freight-line-properties__mode"
						disabled={!isAvailable()}
						value={currentMode()}
						update:value={(value: string) => handleModeChange(value as FreightLineMode)}
					>
						<option value="gather">{i18nState.translator?.line?.modes?.gather ?? 'Gather'}</option>
						<option value="distribute">
							{i18nState.translator?.line?.modes?.distribute ?? 'Distribute'}
						</option>
					</select>
				</PropertyGridRow>
				<PropertyGridRow label={i18nState.translator?.line?.radius ?? 'Radius'}>
					<input
						class="freight-line-properties__radius"
						type="text"
						inputMode="numeric"
						disabled={!isAvailable() || currentMode() !== 'gather'}
						value={currentRadius() === undefined ? '' : String(currentRadius())}
						update:value={handleRadiusChange}
					/>
				</PropertyGridRow>
				<PropertyGridRow
					label={i18nState.translator?.line?.goodsSelection?.section ?? 'Goods selection'}
				>
					<div class="freight-line-properties__goods-selection">
						<GoodSelectionRulesEditor
							if={isAvailable()}
							policy={goodsSelectionPolicy()}
							disabled={!isAvailable()}
							game={currentGame()!}
							goodOptions={goodOptions().filter((entry) => isGoodEligibleForLine(entry.id))}
							tagOptions={tagOptions()}
							onPolicyChange={handleGoodsSelectionChange}
						/>
					</div>
				</PropertyGridRow>
			</PropertyGrid>
			<details if={stations().length > 0} class="freight-line-properties__stations-group" open>
				<summary class="freight-line-properties__stations-summary">
					<span class="freight-line-properties__stations-summary-label">
						<span>{i18nState.translator?.line?.stations ?? 'Stations'}</span>
						<span>({stations().length})</span>
					</span>
					<span class="freight-line-properties__stations-summary-caret" aria-hidden="true">
						▾
					</span>
				</summary>
				<div class="freight-line-properties__stations-body">
					<for each={stations()}>
						{(stop) => (
							<div class="freight-line-properties__station-item">
								<LinkedEntityControl if={stationTile(stop)} object={stationTile(stop)!} />
								<InspectorObjectLink
									if={stationTile(stop)}
									object={stationTile(stop)!}
									label={stationLabel(stop)}
								/>
								<span if={!stationTile(stop)} class="freight-line-properties__stop">
									{stationLabel(stop)}
								</span>
							</div>
						)}
					</for>
				</div>
			</details>
		</InspectorSection>
	)
}

export default FreightLineProperties
