import { document, latch } from '@sursaut/core'
import { afterEach, describe, expect, it } from 'vitest'
import { renderAnarkaiIcon } from './render-icon'

const IconFixture = () => (
	<div>
		<div data-testid="class-icon">
			{renderAnarkaiIcon('pure-glyf-icon glyf-tabler-filled-adjustments')}
		</div>
		<div data-testid="literal-icon">{renderAnarkaiIcon('☀', { label: 'Sun glyph' })}</div>
		<div data-testid="svg-icon">
			{renderAnarkaiIcon('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"></svg>', {
				label: 'Vector icon',
			})}
		</div>
		<div data-testid="image-icon">
			{renderAnarkaiIcon({ kind: 'image', src: '/icon.png', alt: 'Image icon' })}
		</div>
		<div data-testid="node-icon">
			{renderAnarkaiIcon(<strong>!</strong>, { label: 'Node icon' })}
		</div>
	</div>
)

describe('renderAnarkaiIcon', () => {
	let container: HTMLElement
	let stop: (() => void) | undefined

	afterEach(() => {
		stop?.()
		stop = undefined
		container?.remove()
		document.body.innerHTML = ''
	})

	it('renders class, glyph, svg, image, and labeled node icon variants', () => {
		container = document.createElement('div')
		document.body.appendChild(container)

		stop = latch(container, <IconFixture />)

		const classIcon = container.querySelector(
			'[data-testid="class-icon"] .pure-glyf-icon.glyf-tabler-filled-adjustments'
		)
		expect(classIcon).not.toBeNull()
		expect(classIcon?.hasAttribute('aria-hidden')).toBe(true)

		const literalIcon = container.querySelector('[data-testid="literal-icon"] [role="img"]')
		expect(literalIcon?.getAttribute('aria-label')).toBe('Sun glyph')
		expect(literalIcon?.textContent).toBe('☀')

		const svgImage = container.querySelector('[data-testid="svg-icon"] img')
		expect(svgImage?.getAttribute('alt')).toBe('Vector icon')
		expect(svgImage?.getAttribute('src')).toContain('data:image/svg+xml;utf8,')

		const image = container.querySelector('[data-testid="image-icon"] img')
		expect(image?.getAttribute('alt')).toBe('Image icon')
		expect(image?.getAttribute('src')).toBe('/icon.png')

		const nodeIcon = container.querySelector('[data-testid="node-icon"] [role="img"]')
		expect(nodeIcon?.getAttribute('aria-label')).toBe('Node icon')
		expect(nodeIcon?.textContent).toBe('!')
	})
})
