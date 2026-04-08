import { document, latch } from '@sursaut/core'
import { reactive } from 'mutts'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@app/lib/css', () => ({
	css: () => '',
}))

vi.mock('@app/ui/anarkai', () => ({
	Stars: (props: {
		maximum: number
		value?: number | [number, number]
		onChange?: (value: number | [number, number]) => void
	}) => {
		const value = props.value ?? 0
		const serialized = Array.isArray(value) ? value.join(',') : String(value)
		return (
			<button
				data-testid="stars"
				data-maximum={String(props.maximum)}
				data-value={serialized}
				onClick={() =>
					props.onChange?.(Array.isArray(value) ? [value[0] + 1, value[1] + 1] : value + 1)
				}
			>
				stars
			</button>
		)
	},
}))

vi.mock('engine-pixi/assets/visual-content', () => ({
	goods: {
		wood: { sprites: ['wood-sprite'] },
		stone: { sprites: ['stone-sprite'] },
		berries: { sprites: ['berries-sprite'] },
	},
}))

vi.mock('../PropertyGridRow', () => ({
	default: (props: { label?: string; children?: any }) => (
		<div class="property-grid-row">
			<div class="property-grid-row__label">{props.label ?? ''}</div>
			<div class="property-grid-row__value">{props.children}</div>
		</div>
	),
}))

vi.mock('./GoodMultiSelect', () => ({
	default: (props: {
		value: string[]
		availableGoods: string[]
		onAdd: (good: string) => void
		onRemove: (good: string) => void
		renderItemExtra?: (good: string) => any
		children?: any
	}) => (
		<div class="good-multi-select-mock">
			<div class="value">{props.value.join(',')}</div>
			<div class="available">{props.availableGoods.join(',')}</div>
			<div class="fallback">{props.children}</div>
			<div class="extras">
				<for each={props.value}>{(good: string) => props.renderItemExtra?.(good)}</for>
			</div>
			<button
				class="mock-add"
				onClick={() => {
					const next = props.availableGoods[0]
					if (next) props.onAdd(next)
				}}
			>
				add
			</button>
			<button
				class="mock-remove"
				onClick={() => {
					const current = props.value[0]
					if (current) props.onRemove(current)
				}}
			>
				remove
			</button>
		</div>
	),
}))

vi.mock('ssh/storage/slotted-storage', () => ({
	SlottedStorage: class SlottedStorage {
		slots: Array<undefined>
		maxQuantityPerSlot: number

		constructor(slots: number, capacity: number) {
			this.slots = Array.from({ length: slots }, () => undefined)
			this.maxQuantityPerSlot = capacity
		}
	},
}))

let SlottedStorageConfiguration: typeof import('./SlottedStorageConfiguration').default
let SlottedStorage: typeof import('ssh/storage/slotted-storage').SlottedStorage

function createContent() {
	const totalSlots = 6
	const configuration = reactive<Ssh.SlottedStorageAlveolusConfiguration>({
		working: true,
		generalSlots: 2,
		goods: {
			wood: {
				minSlots: 1,
				maxSlots: 2,
			},
		},
	})

	const clampConfiguration = () => {
		let bufferedSlots = 0
		for (const rule of Object.values(configuration.goods)) {
			if (!rule) continue
			rule.minSlots = Math.max(0, Math.floor(rule.minSlots))
			bufferedSlots += rule.minSlots
		}

		const remainingBudget = Math.max(0, totalSlots - bufferedSlots)
		for (const [goodType, rule] of Object.entries(configuration.goods)) {
			if (!rule) continue
			rule.maxSlots = Math.max(0, Math.min(remainingBudget, Math.floor(rule.maxSlots)))
			if (rule.minSlots <= 0 && rule.maxSlots <= 0) {
				delete configuration.goods[goodType]
			}
		}
		configuration.generalSlots = Math.max(
			0,
			Math.min(remainingBudget, Math.floor(configuration.generalSlots))
		)
	}

	const content = {
		storage: new SlottedStorage(totalSlots, 3),
		get slottedStorageConfiguration() {
			return configuration
		},
		setSlottedGeneralSlots(generalSlots: number) {
			configuration.generalSlots = generalSlots
			clampConfiguration()
		},
		setSlottedGoodConfiguration(
			goodType: string,
			rule: Partial<Ssh.SlottedStorageGoodConfiguration> | undefined
		) {
			if (!rule) {
				delete configuration.goods[goodType]
				clampConfiguration()
				return
			}
			const current = configuration.goods[goodType] ?? { minSlots: 0, maxSlots: 0 }
			configuration.goods[goodType] = {
				minSlots: rule.minSlots ?? current.minSlots,
				maxSlots: rule.maxSlots ?? current.maxSlots,
			}
			clampConfiguration()
		},
		removeSlottedGoodConfiguration(goodType: string) {
			delete configuration.goods[goodType]
			clampConfiguration()
		},
	}

	return { configuration, content }
}

describe('SlottedStorageConfiguration', () => {
	let container: HTMLElement
	let stop: (() => void) | undefined

	beforeAll(async () => {
		;({ default: SlottedStorageConfiguration } = await import('./SlottedStorageConfiguration'))
		;({ SlottedStorage } = await import('ssh/storage/slotted-storage'))
	})

	beforeEach(() => {
		container = document.createElement('div')
		document.body.appendChild(container)
	})

	afterEach(() => {
		stop?.()
		stop = undefined
		container.remove()
		document.body.innerHTML = ''
	})

	it('adds and removes specific goods', () => {
		const { configuration, content } = createContent()

		stop = latch(
			container,
			<table>
				<tbody>
					<SlottedStorageConfiguration content={content as never} game={{} as never} />
				</tbody>
			</table>
		)

		;(container.querySelector('.mock-add') as HTMLButtonElement).click()
		expect(configuration.goods.stone).toEqual({ minSlots: 0, maxSlots: 1 })

		;(container.querySelector('.mock-remove') as HTMLButtonElement).click()
		expect(configuration.goods.wood).toBeUndefined()
	})

	it('recomputes remaining slot budget when buffer slots change', () => {
		const { content } = createContent()

		stop = latch(
			container,
			<table>
				<tbody>
					<SlottedStorageConfiguration content={content as never} game={{} as never} />
				</tbody>
			</table>
		)

		const initialStars = Array.from(
			container.querySelectorAll('[data-testid="stars"]')
		) as HTMLButtonElement[]
		expect(initialStars.map((button) => button.dataset.maximum)).toEqual(['5', '6'])
		expect(initialStars[1].dataset.value).toBe('1,3')
		expect(container.textContent).toContain('2 / 5 slots')

		initialStars[1].click()

		const updatedStars = Array.from(
			container.querySelectorAll('[data-testid="stars"]')
		) as HTMLButtonElement[]
		expect(updatedStars[0].dataset.maximum).toBe('4')
		expect(updatedStars[1].dataset.maximum).toBe('6')
		expect(updatedStars[1].dataset.value).toBe('2,4')
		expect(container.textContent).toContain('2 / 4 slots')
		expect(container.textContent).toContain('buffer 2, total 4')
	})
})
