import { document, latch } from '@sursaut/core'
import { afterEach, describe, expect, it } from 'vitest'
import { Button } from './Button'
import { ButtonGroup } from './ButtonGroup'

const KeyedButtonGroup = () => (
	<ButtonGroup>
		<Button ariaLabel="First">First</Button>
		<Button ariaLabel="Second">Second</Button>
		<Button ariaLabel="Third">Third</Button>
	</ButtonGroup>
)

describe('ButtonGroup', () => {
	let container: HTMLElement
	let stop: (() => void) | undefined

	afterEach(() => {
		stop?.()
		stop = undefined
		container?.remove()
		document.body.innerHTML = ''
	})

	it('restores arrow-key navigation between grouped buttons', () => {
		container = document.createElement('div')
		document.body.appendChild(container)
		stop = latch(container, <KeyedButtonGroup />)

		const buttons = Array.from(container.querySelectorAll('button')) as HTMLButtonElement[]
		expect(buttons).toHaveLength(3)

		buttons[0]!.focus()
		buttons[0]!.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }))
		expect(document.activeElement).toBe(buttons[1])

		buttons[1]!.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }))
		expect(document.activeElement).toBe(buttons[0])
	})
})
