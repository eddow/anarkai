import { css } from '@app/lib/css'
import { reorderWithInsertionGap } from '@app/lib/good-selection-tag-reorder'
import { Button } from '@app/ui/anarkai'
import { renderAnarkaiIcon } from '@app/ui/anarkai/icons/render-icon'
import { listen } from '@sursaut/core'
import {
	measureLocalDragTarget,
	resolveLocalDragInsertion,
	startLocalDragSession,
} from '@sursaut/ui'
import { goods as sensoryGoods } from 'engine-pixi/assets/visual-content'
import { effect, reactive } from 'mutts'
import { tablerFilledSquareRoundedMinus, tablerOutlineGripVertical } from 'pure-glyf/icons'
import type {
	GoodSelectionEffect,
	GoodSelectionGoodRule,
	GoodSelectionPolicy,
	GoodSelectionTagMatch,
	GoodSelectionTagRule,
} from 'ssh/freight/goods-selection-policy'
import { normalizeGoodSelectionPolicy } from 'ssh/freight/goods-selection-policy'
import type { Game } from 'ssh/game'
import { getTranslator } from '@app/lib/i18n'
import type { GoodType } from 'ssh/types/base'
import EntityBadge from './EntityBadge'
import GoodPickerButton from './GoodPickerButton'
import GoodTagBadge from './GoodTagBadge'
import TagPickerButton from './TagPickerButton'

css`
.good-selection-rules {
	display: flex;
	flex-direction: column;
	gap: 0.75rem;
	font-size: 0.8rem;
}
.good-selection-rules__section-title {
	font-weight: 700;
	color: var(--ak-text-muted);
	font-size: 0.72rem;
	text-transform: uppercase;
	letter-spacing: 0.04em;
}
.good-selection-rules__rows {
	display: flex;
	flex-direction: column;
	gap: 0.45rem;
}
.good-selection-rules__row {
	display: flex;
	flex-wrap: wrap;
	align-items: center;
	gap: 0.35rem;
	padding: 0.35rem 0.45rem;
	border-radius: 0.45rem;
	border: 1px solid color-mix(in srgb, var(--ak-text-muted) 16%, transparent);
	background: color-mix(in srgb, var(--ak-surface-panel) 92%, transparent);
}
.good-selection-rules__row--tag {
	flex-wrap: nowrap;
	position: relative;
	transition:
		transform 150ms ease,
		opacity 120ms ease,
		box-shadow 120ms ease;
}
.good-selection-rules__row--tag > * {
	flex: 0 0 auto;
}
.good-selection-rules__btn {
	padding: 0.2rem 0.45rem;
	border-radius: 0.35rem;
	border: 1px solid color-mix(in srgb, var(--ak-text-muted) 22%, transparent);
	background: color-mix(in srgb, var(--ak-surface-1) 88%, transparent);
	color: var(--ak-text);
	font-size: 0.72rem;
	cursor: pointer;
}
.good-selection-rules__btn[disabled] {
	opacity: 0.55;
	cursor: not-allowed;
}
.good-selection-rules__toolbar {
	display: flex;
	flex-wrap: wrap;
	gap: 0.35rem;
}
.good-selection-rules__effect-toggle {
	display: inline-flex;
	align-items: center;
	gap: 0.35rem;
	padding: 0.25rem 0.5rem;
	border-radius: 999px;
	border: 1px solid color-mix(in srgb, var(--ak-text-muted) 22%, transparent);
	background: color-mix(in srgb, var(--ak-surface-1) 88%, transparent);
	color: var(--ak-text);
	cursor: pointer;
	font-size: 0.74rem;
}
.good-selection-rules__effect-toggle[disabled] {
	opacity: 0.55;
	cursor: not-allowed;
}
.good-selection-rules__effect-toggle--allow {
	border-color: color-mix(in srgb, #22c55e 28%, var(--ak-text-muted));
	background: color-mix(in srgb, #22c55e 10%, var(--ak-surface-1));
}
.good-selection-rules__effect-toggle--deny {
	border-color: color-mix(in srgb, #ef4444 28%, var(--ak-text-muted));
	background: color-mix(in srgb, #ef4444 10%, var(--ak-surface-1));
}
.good-selection-rules__effect-icon {
	display: inline-flex;
	align-items: center;
	justify-content: center;
	width: 1rem;
	height: 1rem;
	border-radius: 999px;
	font-size: 0.72rem;
	font-weight: 700;
	background: color-mix(in srgb, var(--ak-surface-0) 92%, transparent);
}
.good-selection-rules__fallback {
	display: flex;
	align-items: center;
	gap: 0.45rem;
	flex-wrap: wrap;
}
.good-selection-rules__remove-btn {
	padding: 0;
	min-height: auto;
	height: 1.35rem;
	width: 1.35rem;
	border-radius: 999px;
	border-color: color-mix(in srgb, #ef4444 35%, var(--ak-border));
	color: #ef4444;
	background: color-mix(in srgb, #ef4444 10%, var(--ak-surface-panel));
	opacity: 0.85;
}
.good-selection-rules__remove-btn:hover {
	opacity: 1;
	border-color: color-mix(in srgb, #ef4444 55%, var(--ak-border));
	color: #dc2626;
}
.good-selection-rules__toolbar-picker {
	align-self: flex-start;
}
.good-selection-rules__tag-rows {
	overflow: visible;
}
.good-selection-rules__row--tag::before,
.good-selection-rules__row--tag::after {
	content: '';
	position: absolute;
	left: 0.55rem;
	right: 0.55rem;
	height: 2px;
	border-radius: 999px;
	background: color-mix(in srgb, #60a5fa 82%, white);
	opacity: 0;
	transform: scaleX(0.6);
	transition:
		opacity 120ms ease,
		transform 120ms ease;
	pointer-events: none;
}
.good-selection-rules__row--tag::before {
	top: -5px;
}
.good-selection-rules__row--tag::after {
	bottom: -5px;
}
.good-selection-rules__row--tag[data-drop-before='true']::before,
.good-selection-rules__row--tag[data-drop-after='true']::after {
	opacity: 1;
	transform: scaleX(1);
}
.good-selection-rules__row--tag[data-dragging='true'] {
	opacity: 0.72;
	box-shadow: 0 0 0 1px color-mix(in srgb, #60a5fa 45%, transparent);
}
.good-selection-rules__tag-drag {
	display: inline-flex;
	align-items: center;
	justify-content: center;
	padding: 0.1rem 0.2rem;
	margin-right: 0.1rem;
	cursor: grab;
	border: none;
	background: transparent;
	color: var(--ak-text-muted);
	line-height: 1;
	border-radius: 0.25rem;
}
.good-selection-rules__tag-drag:active {
	cursor: grabbing;
}
.good-selection-rules__tag-drag[disabled] {
	opacity: 0.45;
	cursor: not-allowed;
}
`

const tagRuleSignature = (rules: ReadonlyArray<{ tag: string; match: string; effect: string }>) =>
	rules.map((r) => `${r.tag}:${r.match}:${r.effect}`).join('|')

const measureTagRuleRowElements = (root: Element | null): HTMLElement[] => {
	if (!root) return []
	const rowHost = root.querySelector('.good-selection-rules__tag-rows')
	if (!rowHost) return []
	return [...rowHost.querySelectorAll<HTMLElement>('[data-tag-rule-index]')]
}

const clearTagDragPreview = (root: Element | null) => {
	const rows = measureTagRuleRowElements(root)
	for (const row of rows) {
		row.style.transform = ''
		row.removeAttribute('data-dragging')
		row.removeAttribute('data-drop-before')
		row.removeAttribute('data-drop-after')
	}
}

const previewTagDragInsertion = (
	root: Element | null,
	fromIndex: number,
	insertionIndex: number
) => {
	const rows = measureTagRuleRowElements(root)
	if (rows.length === 0) return
	const draggedRow = rows[fromIndex]
	if (!draggedRow) return
	const draggedRect = draggedRow.getBoundingClientRect()
	const prevRect = fromIndex > 0 ? rows[fromIndex - 1]?.getBoundingClientRect() : undefined
	const nextRect =
		fromIndex + 1 < rows.length ? rows[fromIndex + 1]?.getBoundingClientRect() : undefined
	const gap = prevRect
		? Math.max(0, draggedRect.top - prevRect.bottom)
		: nextRect
			? Math.max(0, nextRect.top - draggedRect.bottom)
			: 0
	const shift = draggedRect.height + gap
	for (const [index, row] of rows.entries()) {
		row.removeAttribute('data-drop-before')
		row.removeAttribute('data-drop-after')
		if (index === fromIndex) {
			row.setAttribute('data-dragging', 'true')
			row.style.transform = ''
			continue
		}
		row.removeAttribute('data-dragging')
		let translateY = 0
		if (insertionIndex > fromIndex && index > fromIndex && index < insertionIndex) {
			translateY = -shift
		}
		if (insertionIndex < fromIndex && index >= insertionIndex && index < fromIndex) {
			translateY = shift
		}
		row.style.transform = translateY ? `translateY(${translateY}px)` : ''
	}
	if (insertionIndex <= 0) {
		rows[0]?.setAttribute('data-drop-before', 'true')
		return
	}
	if (insertionIndex >= rows.length) {
		rows[rows.length - 1]?.setAttribute('data-drop-after', 'true')
		return
	}
	rows[insertionIndex]?.setAttribute('data-drop-before', 'true')
}

export interface GoodSelectionRulesEditorProps {
	policy: GoodSelectionPolicy
	disabled?: boolean
	game: Game
	goodOptions: readonly { id: GoodType; label: string }[]
	tagOptions: readonly { id: string; label: string }[]
	onPolicyChange: (next: GoodSelectionPolicy) => void
}

const toggleEffect = (effect: GoodSelectionEffect): GoodSelectionEffect =>
	effect === 'allow' ? 'deny' : 'allow'
const toggleMatch = (match: GoodSelectionTagMatch): GoodSelectionTagMatch =>
	match === 'present' ? 'absent' : 'present'

const toDisplayText = (value: unknown, fallback = ''): string => {
	switch (typeof value) {
		case 'string':
			return value
		case 'number':
		case 'boolean':
			return `${value}`
		default:
			return fallback
	}
}

const GoodSelectionRulesEditor = (props: GoodSelectionRulesEditorProps) => {
	const ls = () => getTranslator().line.goodsSelection
	const sig = (p: GoodSelectionPolicy) =>
		`${tagRuleSignature(p.tagRules)}||${p.goodRules.map((r) => `${r.goodType}:${r.effect}`).join('|')}||${p.defaultEffect}`

	const state = reactive({
		goodRules: [] as GoodSelectionGoodRule[],
		tagRules: [] as GoodSelectionTagRule[],
		defaultEffect: 'allow' as GoodSelectionEffect,
		lastSig: '',
	})

	const snapshot = (): GoodSelectionPolicy => ({
		goodRules: state.goodRules.map((r) => ({ ...r })),
		tagRules: state.tagRules.map((r) => ({ ...r })),
		defaultEffect: state.defaultEffect,
	})

	const applyPolicy = (p: GoodSelectionPolicy) => {
		state.goodRules = p.goodRules.map((r) => ({ ...r }))
		state.tagRules = p.tagRules.map((r) => ({ ...r }))
		state.defaultEffect = p.defaultEffect
	}

	effect`good-selection-rules:sync`(() => {
		const normalized = normalizeGoodSelectionPolicy(props.policy)
		const s = sig(normalized)
		if (s === state.lastSig) return
		applyPolicy(normalized)
		state.lastSig = s
	})

	const emit = (next: GoodSelectionPolicy) => {
		const normalized = normalizeGoodSelectionPolicy(next)
		applyPolicy(normalized)
		state.lastSig = sig(normalized)
		props.onPolicyChange(normalized)
	}

	const availableGoodsToAdd = (): GoodType[] => {
		const used = new Set(state.goodRules.map((r) => r.goodType))
		return props.goodOptions.filter((entry) => !used.has(entry.id)).map((entry) => entry.id)
	}

	const availableTagIdsToAdd = (): string[] => {
		const used = new Set(state.tagRules.map((r) => r.tag))
		return props.tagOptions.filter((entry) => !used.has(entry.id)).map((entry) => entry.id)
	}

	const addGoodRuleFromPicker = (goodType: GoodType) => {
		emit({
			...snapshot(),
			goodRules: [...state.goodRules, { goodType, effect: 'allow' }],
		})
	}

	const getSprite = (good: string) => {
		return sensoryGoods[good as keyof typeof sensoryGoods]?.sprites?.[0] || 'default'
	}

	const updateGoodRule = (
		index: number,
		patch: Partial<{ goodType: GoodType; effect: GoodSelectionEffect }>
	) => {
		const goodRules = state.goodRules.map((rule, i) => (i === index ? { ...rule, ...patch } : rule))
		emit({ ...snapshot(), goodRules })
	}

	const removeGoodRule = (index: number) => {
		emit({ ...snapshot(), goodRules: state.goodRules.filter((_, i) => i !== index) })
	}

	const addTagRuleFromPicker = (tag: string) => {
		emit({
			...snapshot(),
			tagRules: [
				...state.tagRules,
				{ tag, match: 'present' as GoodSelectionTagMatch, effect: 'allow' },
			],
		})
	}

	const tagOptionLabel = (tag: string) =>
		toDisplayText(props.tagOptions.find((entry) => entry.id === tag)?.label, tag)

	const matchOptionLabel = (match: GoodSelectionTagMatch) =>
		match === 'present' ? ls().matchPresent : ls().matchAbsent

	const updateTagRule = (
		index: number,
		patch: Partial<{ tag: string; match: GoodSelectionTagMatch; effect: GoodSelectionEffect }>
	) => {
		const tagRules = state.tagRules.map((rule, i) => (i === index ? { ...rule, ...patch } : rule))
		emit({ ...snapshot(), tagRules })
	}

	const removeTagRule = (index: number) => {
		emit({ ...snapshot(), tagRules: state.tagRules.filter((_, i) => i !== index) })
	}

	const beginTagRuleDrag = (event: PointerEvent, fromIndex: number) => {
		if (props.disabled) return
		const root =
			(event.currentTarget as HTMLElement | null)?.closest('[data-good-selection-rules]') ?? null
		startLocalDragSession({
			event,
			axis: 'vertical',
			capture: 'pointer',
			previewBehavior: 'none',
			onMove: (snap) => {
				const rowEls = measureTagRuleRowElements(root)
				if (rowEls.length === 0) {
					clearTagDragPreview(root)
					return
				}
				const targets = rowEls.map((el, index) => measureLocalDragTarget(index, el))
				const insertion = resolveLocalDragInsertion(
					targets,
					{ x: snap.current.x, y: snap.current.y },
					'vertical'
				)
				if (!insertion) {
					clearTagDragPreview(root)
					return
				}
				previewTagDragInsertion(root, fromIndex, insertion.index)
			},
			onStop: (snap) => {
				if (snap.cancelled) {
					clearTagDragPreview(root)
					return
				}
				const rowEls = measureTagRuleRowElements(root)
				if (rowEls.length === 0) {
					clearTagDragPreview(root)
					return
				}
				const targets = rowEls.map((el, index) => measureLocalDragTarget(index, el))
				const insertion = resolveLocalDragInsertion(
					targets,
					{ x: snap.current.x, y: snap.current.y },
					'vertical'
				)
				if (!insertion) {
					clearTagDragPreview(root)
					return
				}
				const nextOrder = reorderWithInsertionGap(state.tagRules, fromIndex, insertion.index)
				if (tagRuleSignature(nextOrder) === tagRuleSignature(state.tagRules)) {
					clearTagDragPreview(root)
					return
				}
				emit({ ...snapshot(), tagRules: nextOrder })
				requestAnimationFrame(() => clearTagDragPreview(root))
			},
		})
	}

	return (
		<div class="good-selection-rules" data-good-selection-rules>
			<div class="good-selection-rules__section-title">{ls().goodRules}</div>
			<div class="good-selection-rules__toolbar">
				<div class="good-selection-rules__toolbar-picker">
					<GoodPickerButton
						testId="good-selection-add-good-rule"
						availableGoods={availableGoodsToAdd()}
						game={props.game}
						disabled={
							props.disabled || props.goodOptions.length === 0 || availableGoodsToAdd().length === 0
						}
						title={ls().addGoodRule}
						emptyMessage={ls().noGoodsToAdd}
						onSelect={addGoodRuleFromPicker}
					/>
				</div>
			</div>
			<div class="good-selection-rules__rows">
				<for each={state.goodRules.map((rule, index) => ({ rule, index }))}>
					{({ rule, index }) => (
						<div
							class="good-selection-rules__row"
							data-testid={`good-selection-good-rule-${index}`}
						>
							<EntityBadge
								game={props.game}
								sprite={getSprite(rule.goodType)}
								text={rule.goodType}
							/>
							<button
								type="button"
								class={[
									'good-selection-rules__effect-toggle',
									rule.effect === 'allow'
										? 'good-selection-rules__effect-toggle--allow'
										: 'good-selection-rules__effect-toggle--deny',
								]}
								data-testid={`good-selection-good-effect-${index}`}
								disabled={props.disabled}
								onClick={() => updateGoodRule(index, { effect: toggleEffect(rule.effect) })}
							>
								<span class="good-selection-rules__effect-icon" aria-hidden="true">
									{rule.effect === 'allow' ? '✓' : '✕'}
								</span>
								<span>
									{rule.effect === 'allow'
										? ls().effectAllow
										: ls().effectDeny}
								</span>
							</button>
							<Button
								icon={tablerFilledSquareRoundedMinus}
								ariaLabel={ls().remove}
								disabled={props.disabled}
								onClick={() => removeGoodRule(index)}
								el:title={ls().remove}
								el:class="good-selection-rules__remove-btn"
								el:data-testid={`good-selection-remove-good-rule-${index}`}
							/>
						</div>
					)}
				</for>
			</div>

			<div class="good-selection-rules__section-title">{ls().tagRules}</div>
			<div class="good-selection-rules__toolbar">
				<div class="good-selection-rules__toolbar-picker">
					<TagPickerButton
						testId="good-selection-add-tag-rule"
						pickerItems={availableTagIdsToAdd().map((id) => ({
							id,
							label: tagOptionLabel(id),
						}))}
						disabled={
							props.disabled || props.tagOptions.length === 0 || availableTagIdsToAdd().length === 0
						}
						title={ls().addTagRule}
						ariaLabel={ls().addTagRule}
						emptyMessage={ls().noTagsToAdd}
						onSelect={addTagRuleFromPicker}
					/>
				</div>
			</div>
			<div class="good-selection-rules__rows good-selection-rules__tag-rows">
				<for each={state.tagRules.map((rule, index) => ({ rule, index }))}>
					{({ rule, index }) => (
						<div
							class={['good-selection-rules__row', 'good-selection-rules__row--tag']}
							data-testid={`good-selection-tag-rule-${index}`}
							data-tag-rule-index={index}
						>
							<button
								type="button"
								class="good-selection-rules__tag-drag"
								data-testid={`good-selection-tag-drag-${index}`}
								disabled={props.disabled}
								aria-label={ls().reorderTagRule}
								title={ls().reorderTagRule}
								use={(target: Node | readonly Node[] | undefined) => {
									const element = Array.isArray(target) ? target[0] : target
									if (!(element instanceof HTMLElement)) return
									return listen(element, 'pointerdown', (event) => {
										if (!(event instanceof PointerEvent)) return
										beginTagRuleDrag(event, index)
									})
								}}
							>
								{renderAnarkaiIcon(tablerOutlineGripVertical, { size: 16 })}
							</button>
							<div data-testid={`good-selection-tag-tag-${index}`}>
								<GoodTagBadge tagId={rule.tag} label={tagOptionLabel(rule.tag)} size={20} />
							</div>
							<button
								type="button"
								class="good-selection-rules__effect-toggle"
								data-testid={`good-selection-tag-match-${index}`}
								disabled={props.disabled}
								onClick={() => updateTagRule(index, { match: toggleMatch(rule.match) })}
							>
								<span>{matchOptionLabel(rule.match)}</span>
							</button>
							<button
								type="button"
								class={[
									'good-selection-rules__effect-toggle',
									rule.effect === 'allow'
										? 'good-selection-rules__effect-toggle--allow'
										: 'good-selection-rules__effect-toggle--deny',
								]}
								data-testid={`good-selection-tag-effect-${index}`}
								disabled={props.disabled}
								onClick={() => updateTagRule(index, { effect: toggleEffect(rule.effect) })}
							>
								<span class="good-selection-rules__effect-icon" aria-hidden="true">
									{rule.effect === 'allow' ? '✓' : '✕'}
								</span>
								<span>
									{rule.effect === 'allow'
										? ls().effectAllow
										: ls().effectDeny}
								</span>
							</button>
							<Button
								icon={tablerFilledSquareRoundedMinus}
								ariaLabel={ls().remove}
								disabled={props.disabled}
								onClick={() => removeTagRule(index)}
								el:title={ls().remove}
								el:class="good-selection-rules__remove-btn"
								el:data-testid={`good-selection-remove-tag-rule-${index}`}
							/>
						</div>
					)}
				</for>
			</div>

			<div class="good-selection-rules__section-title">{ls().fallback}</div>
			<div class="good-selection-rules__fallback">
				<span>{ls().fallbackHint}</span>
				<button
					type="button"
					class={[
						'good-selection-rules__effect-toggle',
						state.defaultEffect === 'allow'
							? 'good-selection-rules__effect-toggle--allow'
							: 'good-selection-rules__effect-toggle--deny',
					]}
					data-testid="good-selection-default-effect"
					disabled={props.disabled}
					onClick={() =>
						emit({
							...snapshot(),
							defaultEffect: toggleEffect(state.defaultEffect),
						})
					}
				>
					<span class="good-selection-rules__effect-icon" aria-hidden="true">
						{state.defaultEffect === 'allow' ? '✓' : '✕'}
					</span>
					<span>
						{state.defaultEffect === 'allow'
							? ls().effectAllow
							: ls().effectDeny}
					</span>
				</button>
			</div>
		</div>
	)
}

export default GoodSelectionRulesEditor
