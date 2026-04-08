import { document, latch } from '@sursaut/core'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('ssh/utils/images', () => ({
	computeStyleFromTexture: vi.fn(
		(texture: { key?: string }) => `background-image: url(${texture.key ?? 'none'});`
	),
}))

let ResourceImage: typeof import('./ResourceImage').default

describe('ResourceImage', () => {
	let container: HTMLElement
	let stop: (() => void) | undefined

	beforeAll(async () => {
		;({ default: ResourceImage } = await import('./ResourceImage'))
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

	it('renders the sprite style immediately when a texture is already available', async () => {
		const game = {
			rendererReady: Promise.resolve(),
			getTexture: vi.fn().mockReturnValue({ key: 'buildings.chopper', width: 20, height: 20 }),
		}

		const props = {
			game,
			sprite: 'buildings.chopper' as Ssh.Sprite,
			height: 20,
			alt: 'chopper',
		}

		stop = latch(container, <ResourceImage {...props} />)
		await Promise.resolve()

		const image = container.querySelector('.ssh-resource-image') as HTMLDivElement
		const initialStyle = image.getAttribute('style') ?? ''
		expect(initialStyle).toContain('background-image: url("buildings.chopper")')
	})
})
