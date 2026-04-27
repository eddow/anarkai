import { document, latch } from '@sursaut/core'
import { reactive } from 'mutts'
import type { GoodSelectionPolicy } from 'ssh/freight/goods-selection-policy'
import {
	normalizeGoodSelectionPolicy,
	UNRESTRICTED_GOODS_SELECTION_POLICY,
} from 'ssh/freight/goods-selection-policy'
import type { GoodType } from 'ssh/types/base'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@app/lib/css', () => ({
	css: () => '',
}))

vi.mock('@app/ui/anarkai/icons/render-icon', () => ({
	renderAnarkaiIcon: () => <span data-testid="mock-render-icon" />,
}))

vi.mock('engine-pixi/assets/visual-content', () => ({
	goods: {
		wood: { sprites: ['wood-sprite'] },
		berries: { sprites: ['berries-sprite'] },
	},
}))

vi.mock('./EntityBadge', () => ({
	default: (props: { text?: string }) => <span data-testid="entity-badge">{props.text ?? ''}</span>,
}))

vi.mock('./GoodTagBadge', () => ({
	default: (props: { label: string }) => <span data-testid="good-tag-badge">{props.label}</span>,
}))

vi.mock('./ComboDropdownPicker', () => ({
	default: (props: {
		mode: 'icon' | 'value'
		testId?: string
		valueLabel?: string
		items: readonly { id: string; label: string }[]
		onSelect: (id: string) => void
		disabled?: boolean
		renderValueTrigger?: () => JSX.Element
	}) => {
		const selectedId = () =>
			props.items.find((entry) => entry.label === props.valueLabel)?.id ?? props.items[0]?.id
		return (
			<div data-testid={props.testId}>
				<button
					if={props.mode === 'icon'}
					type="button"
					disabled={props.disabled}
					onClick={() => {
						const next = props.items[0]
						if (next) props.onSelect(next.id)
					}}
				>
					pick
				</button>
				<select
					if={props.mode === 'value'}
					disabled={props.disabled}
					value={selectedId()}
					update:value={(value: string) => props.onSelect(value)}
				>
					<for each={props.items}>{(opt) => <option value={opt.id}>{opt.label}</option>}</for>
				</select>
			</div>
		)
	},
	goodsAddComboIcon: () => <span data-testid="mock-goods-add-icon" />,
	tagsAddComboIcon: () => <span data-testid="mock-tags-add-icon" />,
}))

vi.mock('./GoodPickerButton', () => ({
	default: (props: {
		testId?: string
		availableGoods: readonly GoodType[]
		disabled?: boolean
		onSelect: (good: GoodType) => void
	}) => (
		<div data-testid={props.testId}>
			<button
				type="button"
				disabled={props.disabled}
				onClick={() => {
					const next = props.availableGoods[0]
					if (next) props.onSelect(next)
				}}
			>
				pick
			</button>
		</div>
	),
}))

vi.mock('./TagPickerButton', () => ({
	default: (props: {
		testId?: string
		pickerItems: readonly { id: string; label: string }[]
		disabled?: boolean
		onSelect: (id: string) => void
	}) => (
		<div data-testid={props.testId}>
			<button
				type="button"
				disabled={props.disabled}
				onClick={() => {
					const next = props.pickerItems[0]
					if (next) props.onSelect(next.id)
				}}
			>
				pick-tag
			</button>
		</div>
	),
}))

vi.mock('@app/ui/anarkai', () => ({
	Button: (props: {
		onClick?: () => void
		disabled?: boolean
		icon?: string | JSX.Element
		'el:data-testid'?: string
		'el:title'?: string
		'el:class'?: string
	}) => (
		<button
			type="button"
			class={props['el:class']}
			data-testid={props['el:data-testid']}
			title={props['el:title']}
			disabled={props.disabled}
			onClick={props.onClick}
		>
			{props.icon ? (
				typeof props.icon === 'string' ? (
					props.icon
				) : (
					<span data-testid="btn-icon-node">{props.icon}</span>
				)
			) : (
				''
			)}
		</button>
	),
}))

vi.mock('@app/lib/i18n', () => {
	const i18nState = {
		translator: {
			line: {
				goodsSelection: {
					goodRules: 'Goods rules',
					tagRules: 'Tag rules',
					fallback: 'Default',
					fallbackHint: 'When no rule matches:',
					addGoodRule: 'Add good rule',
					addTagRule: 'Add tag rule',
					remove: 'Remove',
					moveUp: 'Up',
					moveDown: 'Down',
					reorderTagRule: 'Reorder tag rule',
					effectAllow: 'Allow',
					effectDeny: 'Deny',
					matchPresent: 'Present',
					matchAbsent: 'Absent',
					noGoodsToAdd: 'No goods left to add',
					noTagsToAdd: 'No tags left to add',
				},
			},
			goods: {
				wood: 'Wood',
				berries: 'Berries',
			},
			goodsTags: {
				food: 'Food',
			},
		},
	}
	return {
		i18nState,
		getTranslator: () => i18nState.translator,
	}
})

let GoodSelectionRulesEditor: typeof import('./GoodSelectionRulesEditor').default

describe('GoodSelectionRulesEditor', () => {
	let container: HTMLElement
	let stop: (() => void) | undefined

	beforeAll(async () => {
		;({ default: GoodSelectionRulesEditor } = await import('./GoodSelectionRulesEditor'))
	})

	beforeEach(() => {
		container = document.createElement('div')
		document.body.appendChild(container)
	})

	afterEach(() => {
		stop?.()
		container.remove()
	})

	it('adds a tag rule when prompted', () => {
		let latest: GoodSelectionPolicy = UNRESTRICTED_GOODS_SELECTION_POLICY
		stop = latch(
			container,
			<GoodSelectionRulesEditor
				policy={UNRESTRICTED_GOODS_SELECTION_POLICY}
				disabled={false}
				game={{} as never}
				goodOptions={[{ id: 'wood' as GoodType, label: 'Wood' }]}
				tagOptions={[{ id: 'food', label: 'Food' }]}
				onPolicyChange={(next) => {
					latest = next
				}}
			/>
		)

		container
			.querySelector<HTMLButtonElement>('[data-testid="good-selection-add-tag-rule"] button')
			?.click()

		expect(latest.tagRules.length).toBe(1)
		expect(latest.tagRules[0]?.tag).toBe('food')
		expect(latest.tagRules[0]?.match).toBe('present')
		expect(latest.tagRules[0]?.effect).toBe('allow')
	})

	it('adds a good rule when prompted', () => {
		let latest: GoodSelectionPolicy = UNRESTRICTED_GOODS_SELECTION_POLICY
		const handleChange = (next: GoodSelectionPolicy) => {
			latest = next
		}

		stop = latch(
			container,
			<GoodSelectionRulesEditor
				policy={UNRESTRICTED_GOODS_SELECTION_POLICY}
				disabled={false}
				game={{} as never}
				goodOptions={[
					{ id: 'wood' as GoodType, label: 'Wood' },
					{ id: 'berries' as GoodType, label: 'Berries' },
				]}
				tagOptions={[{ id: 'food', label: 'Food' }]}
				onPolicyChange={handleChange}
			/>
		)

		container
			.querySelector<HTMLButtonElement>('[data-testid="good-selection-add-good-rule"] button')
			?.click()

		expect(latest.goodRules.length).toBe(1)
		expect(latest.goodRules[0]?.goodType).toBe('wood')
		expect(latest.goodRules[0]?.effect).toBe('allow')
		expect(container.querySelector('[data-testid="good-selection-good-rule-0"]')).not.toBeNull()
	})

	it('still allows adding a tag rule after a good rule was added', () => {
		let latest: GoodSelectionPolicy = UNRESTRICTED_GOODS_SELECTION_POLICY

		stop = latch(
			container,
			<GoodSelectionRulesEditor
				policy={UNRESTRICTED_GOODS_SELECTION_POLICY}
				disabled={false}
				game={{} as never}
				goodOptions={[
					{ id: 'wood' as GoodType, label: 'Wood' },
					{ id: 'berries' as GoodType, label: 'Berries' },
				]}
				tagOptions={[{ id: 'food', label: 'Food' }]}
				onPolicyChange={(next) => {
					latest = next
				}}
			/>
		)

		container
			.querySelector<HTMLButtonElement>('[data-testid="good-selection-add-good-rule"] button')
			?.click()
		container
			.querySelector<HTMLButtonElement>('[data-testid="good-selection-add-tag-rule"] button')
			?.click()

		expect(latest.goodRules.length).toBe(1)
		expect(latest.tagRules.length).toBe(1)
		expect(latest.tagRules[0]?.tag).toBe('food')
	})

	it('renders both good and tag rows in DOM when adding good then tag with parent feedback', () => {
		const parent = reactive({ policy: UNRESTRICTED_GOODS_SELECTION_POLICY as GoodSelectionPolicy })

		stop = latch(
			container,
			<GoodSelectionRulesEditor
				policy={parent.policy}
				disabled={false}
				game={{} as never}
				goodOptions={[
					{ id: 'wood' as GoodType, label: 'Wood' },
					{ id: 'berries' as GoodType, label: 'Berries' },
				]}
				tagOptions={[{ id: 'food', label: 'Food' }]}
				onPolicyChange={(next) => {
					parent.policy = normalizeGoodSelectionPolicy(next)
				}}
			/>
		)

		container
			.querySelector<HTMLButtonElement>('[data-testid="good-selection-add-good-rule"] button')
			?.click()

		expect(container.querySelector('[data-testid="good-selection-good-rule-0"]')).not.toBeNull()

		container
			.querySelector<HTMLButtonElement>('[data-testid="good-selection-add-tag-rule"] button')
			?.click()

		expect(
			container.querySelector('[data-testid="good-selection-good-rule-0"]'),
			'good rule should still be visible after adding tag'
		).not.toBeNull()
		expect(
			container.querySelector('[data-testid="good-selection-tag-rule-0"]'),
			'tag rule should appear after adding it'
		).not.toBeNull()
	})

	it('renders both tag and good rows in DOM when adding tag then good with parent feedback', () => {
		const parent = reactive({ policy: UNRESTRICTED_GOODS_SELECTION_POLICY as GoodSelectionPolicy })

		stop = latch(
			container,
			<GoodSelectionRulesEditor
				policy={parent.policy}
				disabled={false}
				game={{} as never}
				goodOptions={[
					{ id: 'wood' as GoodType, label: 'Wood' },
					{ id: 'berries' as GoodType, label: 'Berries' },
				]}
				tagOptions={[{ id: 'food', label: 'Food' }]}
				onPolicyChange={(next) => {
					parent.policy = normalizeGoodSelectionPolicy(next)
				}}
			/>
		)

		container
			.querySelector<HTMLButtonElement>('[data-testid="good-selection-add-tag-rule"] button')
			?.click()

		expect(container.querySelector('[data-testid="good-selection-tag-rule-0"]')).not.toBeNull()

		container
			.querySelector<HTMLButtonElement>('[data-testid="good-selection-add-good-rule"] button')
			?.click()

		expect(
			container.querySelector('[data-testid="good-selection-tag-rule-0"]'),
			'tag rule should still be visible after adding good'
		).not.toBeNull()
		expect(
			container.querySelector('[data-testid="good-selection-good-rule-0"]'),
			'good rule should appear after adding it'
		).not.toBeNull()
	})

	it('toggles tag rule match present/absent', () => {
		const initial: GoodSelectionPolicy = {
			goodRules: [],
			tagRules: [{ tag: 'food', match: 'present', effect: 'deny' }],
			defaultEffect: 'deny',
		}
		let latest = initial

		stop = latch(
			container,
			<GoodSelectionRulesEditor
				policy={initial}
				disabled={false}
				game={{} as never}
				goodOptions={[{ id: 'wood' as GoodType, label: 'Wood' }]}
				tagOptions={[{ id: 'food', label: 'Food' }]}
				onPolicyChange={(next) => {
					latest = next
				}}
			/>
		)

		container
			.querySelector<HTMLButtonElement>('[data-testid="good-selection-tag-match-0"]')
			?.click()

		expect(latest.tagRules[0]?.match).toBe('absent')
	})

	it('does not allow tag reselection and hides move up/down controls', () => {
		stop = latch(
			container,
			<GoodSelectionRulesEditor
				policy={{
					goodRules: [{ goodType: 'wood' as GoodType, effect: 'allow' }],
					tagRules: [{ tag: 'food', match: 'present', effect: 'allow' }],
					defaultEffect: 'deny',
				}}
				disabled={false}
				game={{} as never}
				goodOptions={[{ id: 'wood' as GoodType, label: 'Wood' }]}
				tagOptions={[{ id: 'food', label: 'Food' }]}
				onPolicyChange={() => {}}
			/>
		)

		const tagBadgeHost = container.querySelector('[data-testid="good-selection-tag-tag-0"]')
		expect(tagBadgeHost).not.toBeNull()
		expect(tagBadgeHost?.querySelector('select')).toBeNull()
		expect(container.querySelector('[data-testid="good-selection-tag-move-up-0"]')).toBeNull()
		expect(container.querySelector('[data-testid="good-selection-tag-move-down-0"]')).toBeNull()
	})

	it('toggles the default effect with the fallback button', () => {
		let latest: GoodSelectionPolicy = {
			goodRules: [],
			tagRules: [],
			defaultEffect: 'allow',
		}

		stop = latch(
			container,
			<GoodSelectionRulesEditor
				policy={latest}
				disabled={false}
				game={{} as never}
				goodOptions={[{ id: 'wood' as GoodType, label: 'Wood' }]}
				tagOptions={[{ id: 'food', label: 'Food' }]}
				onPolicyChange={(next) => {
					latest = next
				}}
			/>
		)

		container
			.querySelector<HTMLButtonElement>('[data-testid="good-selection-default-effect"]')
			?.click()

		expect(latest.defaultEffect).toBe('deny')
	})

	it('falls back to tag ids when tag labels are non-primitive', () => {
		stop = latch(
			container,
			<GoodSelectionRulesEditor
				policy={{
					goodRules: [],
					tagRules: [{ tag: 'food', match: 'present', effect: 'allow' }],
					defaultEffect: 'deny',
				}}
				disabled={false}
				game={{} as never}
				goodOptions={[{ id: 'wood' as GoodType, label: 'Wood' }]}
				tagOptions={[{ id: 'food', label: (() => 'Food') as never }]}
				onPolicyChange={() => {}}
			/>
		)

		const badgesText = [...container.querySelectorAll('[data-testid="good-tag-badge"]')]
			.map((badge) => badge.textContent ?? '')
			.join(' | ')
		expect(badgesText).toContain('food')
		expect(badgesText).not.toContain("() => 'Food'")
	})
})
