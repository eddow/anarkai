import {
	generateName,
	listNameThemes,
	type NameKind,
	type NameThemeId,
} from 'ssh/generation'
import { describe, expect, it } from 'vitest'
import en from '../../assets/locales/en.json'
import fr from '../../assets/locales/fr.json'

const asciiName = /^[A-Z][A-Za-z ]+$/

describe('something-ish name generation', () => {
	it('is deterministic for the same name inputs', () => {
		const first = generateName({
			seed: 42,
			theme: 'uk-ish',
			kind: 'settlement',
			key: 'settlement-2,-4',
			level: 'town',
		})
		const second = generateName({
			seed: 42,
			theme: 'uk-ish',
			kind: 'settlement',
			key: 'settlement-2,-4',
			level: 'town',
		})

		expect(first).toBe(second)
		expect(first).toMatch(asciiName)
		expect(first).not.toContain('2')
		expect(first).not.toContain('-4')
	})

	it('gives each initial theme a different voice for the same object', () => {
		const names = new Set(
			listNameThemes().map((theme) =>
				generateName({
					seed: 123,
					theme,
					kind: 'regionSet',
					key: '0,0',
				})
			)
		)

		expect(names.size).toBe(3)
	})

	it('supports every planned name kind across every initial theme', () => {
		const kinds: NameKind[] = ['settlement', 'region', 'regionSet', 'hive', 'character']

		for (const theme of listNameThemes()) {
			for (const kind of kinds) {
				const name = generateName({
					seed: 7,
					theme: theme as NameThemeId,
					kind,
					key: `${kind}:1,2`,
				})
				expect(name, `${theme}/${kind}`).toMatch(asciiName)
			}
		}
	})
})

describe('action locale coverage', () => {
	it('has initial script action keys in English and French', () => {
		const keys = [
			'action.selfCare.goEat',
			'action.selfCare.goHome',
			'action.selfCare.wander',
			'action.walk.into',
			'action.walk.until',
			'action.work.goWork',
			'action.work.harvest',
			'action.work.convey',
			'action.work.transform',
			'action.work.construct',
			'action.work.foundation',
			'action.work.defragment',
			'action.vehicle.vehicleHop',
			'action.vehicle.zoneBrowse',
			'action.vehicle.vehicleOffload',
		]

		for (const dictionary of [en, fr]) {
			for (const key of keys) {
				const value = key.split('.').reduce<unknown>((node, part) => {
					if (!node || typeof node !== 'object') return undefined
					return (node as Record<string, unknown>)[part]
				}, dictionary)
				expect(value, key).toEqual(expect.any(String))
				expect(value).not.toBe('')
			}
		}
	})
})
