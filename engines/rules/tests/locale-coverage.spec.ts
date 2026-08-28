import { describe, expect, it } from 'vitest'
import en from '../assets/locales/en.json'
import fr from '../assets/locales/fr.json'
import { alveoli, deposits, goods, shops } from '../src'

/**
 * Locale coverage guard: every piece of engine-rules content (goods, alveoli,
 * deposits, shops) and every good tag must have an entry in BOTH the English
 * and French locale files. Content that falls out of sync with the catalog is
 * the exact regression this test exists to catch.
 */

function nestedKeys(obj: Record<string, unknown>, prefix = ''): string[] {
	return Object.entries(obj).flatMap(([k, v]) => {
		const path = prefix ? `${prefix}.${k}` : k
		if (v && typeof v === 'object' && !Array.isArray(v)) {
			return nestedKeys(v as Record<string, unknown>, path)
		}
		return [path]
	})
}

describe('locale coverage', () => {
	it('translates every good in both languages', () => {
		for (const name of Object.keys(goods)) {
			expect((en as any).goods[name], `en.goods.${name}`).toBeTruthy()
			expect((fr as any).goods[name], `fr.goods.${name}`).toBeTruthy()
		}
	})

	it('translates every alveolus in both languages', () => {
		for (const name of Object.keys(alveoli)) {
			expect((en as any).alveoli[name], `en.alveoli.${name}`).toBeTruthy()
			expect((fr as any).alveoli[name], `fr.alveoli.${name}`).toBeTruthy()
		}
	})

	it('translates every deposit in both languages', () => {
		for (const name of Object.keys(deposits)) {
			expect((en as any).deposits[name], `en.deposits.${name}`).toBeTruthy()
			expect((fr as any).deposits[name], `fr.deposits.${name}`).toBeTruthy()
		}
	})

	it('translates every shop type in both languages', () => {
		for (const name of Object.keys(shops)) {
			expect((en as any).shop[name], `en.shop.${name}`).toBeTruthy()
			expect((fr as any).shop[name], `fr.shop.${name}`).toBeTruthy()
		}
	})

	it('translates every good tag in both languages', () => {
		const tags = new Set<string>()
		for (const def of Object.values(goods)) {
			for (const tag of def.tags) tags.add(tag)
		}
		for (const tag of tags) {
			expect((en as any).goodsTags[tag], `en.goodsTags.${tag}`).toBeTruthy()
			expect((fr as any).goodsTags[tag], `fr.goodsTags.${tag}`).toBeTruthy()
		}
	})

	it('keeps the two locale files structurally identical', () => {
		expect(nestedKeys(en).sort()).toEqual(nestedKeys(fr).sort())
	})
})
