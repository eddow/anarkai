import { document, latch } from '@sursaut/core'
import { afterEach, describe, expect, it } from 'vitest'
import { Button } from './Button'
import { ButtonGroup } from './ButtonGroup'
import { Toolbar } from './Toolbar'

const SegmentedToolbar = () => (
	<Toolbar>
		<ButtonGroup>
			<Button ariaLabel="First">First</Button>
			<Button ariaLabel="Second">Second</Button>
		</ButtonGroup>
		<Toolbar.Spacer />
		<ButtonGroup>
			<Button ariaLabel="Third">Third</Button>
		</ButtonGroup>
	</Toolbar>
)

describe('Toolbar', () => {
	let container: HTMLElement
	let stop: (() => void) | undefined

	afterEach(() => {
		stop?.()
		stop = undefined
		container?.remove()
		document.body.innerHTML = ''
	})

	it('uses spacer markers to move Tab focus between toolbar segments', () => {
		container = document.createElement('div')
		document.body.appendChild(container)
		stop = latch(container, <SegmentedToolbar />)

		const buttons = Array.from(container.querySelectorAll('button')) as HTMLButtonElement[]
		expect(buttons).toHaveLength(3)

		buttons[1]!.focus()
		buttons[1]!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true }))
		expect(document.activeElement).toBe(buttons[2])
	})
})
