import { afterEach, describe, expect, it, vi } from 'vitest'

describe('Commitment GC leak registry', () => {
	afterEach(() => {
		vi.unstubAllGlobals()
		vi.resetModules()
	})

	it('uses the commitment as unregister token so resolved commitments are not reported as leaks', async () => {
		const registries: Array<{
			register: ReturnType<typeof vi.fn>
			unregister: ReturnType<typeof vi.fn>
		}> = []

		class FakeFinalizationRegistry {
			register = vi.fn()
			unregister = vi.fn()

			constructor() {
				registries.push(this)
			}
		}

		vi.resetModules()
		vi.stubGlobal('FinalizationRegistry', FakeFinalizationRegistry)

		const { Commitment } = await import('../../src/lib/commitment/commitment')
		const commitment = new Commitment('move-to')
		const registry = registries.find((candidate) => candidate.register.mock.calls.length)

		expect(registry?.register).toHaveBeenCalledWith(
			commitment,
			expect.objectContaining({ label: 'move-to' }),
			commitment
		)

		commitment.fulfill()

		expect(registry?.unregister).toHaveBeenCalledWith(commitment)
	})
})
