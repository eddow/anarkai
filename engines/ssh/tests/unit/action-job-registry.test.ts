import { alveoli } from 'engine-rules'
import { getActionJobProvider, registerActionJobProvider } from 'ssh/jobs/action-job-registry'
import { describe, expect, it } from 'vitest'

describe('Action→job provider registry coverage', () => {
	/** Collect all unique action types across all alveolus definitions. */
	function allActionTypes(): string[] {
		const types = new Set<string>()
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		for (const [, def] of Object.entries(alveoli) as [string, any][]) {
			if (def?.action?.type) types.add(def.action.type)
			const variants = def?.variants as Record<string, { action?: { type?: string }; variants?: Record<string, unknown> }> | undefined
			if (variants) {
				const walk = (v: { action?: { type?: string }; variants?: Record<string, unknown> }) => {
					if (v.action?.type) types.add(v.action.type)
					if (v.variants) {
						for (const child of Object.values(v.variants) as typeof v[]) walk(child as typeof v)
					}
				}
				for (const v of Object.values(variants)) walk(v as typeof v)
			}
		}
		return [...types].sort()
	}

	it('every alveolus action type has a registered job provider', () => {
		const missing: string[] = []
		for (const actionType of allActionTypes()) {
			if (!getActionJobProvider(actionType)) {
				missing.push(actionType)
			}
		}
		expect(missing).toEqual([])
	})

	it('unknown action type returns undefined provider', () => {
		expect(getActionJobProvider('non-existent-action-type')).toBeUndefined()
	})

	it('registerActionJobProvider overrides existing provider', () => {
		const dummy = () => ({ proposedJobs: [] as const, jobForCharacter: () => undefined })
		registerActionJobProvider('harvest', dummy)
		expect(getActionJobProvider('harvest')).toBe(dummy)
	})
})
