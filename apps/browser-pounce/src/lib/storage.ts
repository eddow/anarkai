import { cleanedBy, effect, reactive, type ScopedCallback } from 'mutts'

type JsonCodec = {
	parse: <T>(value: string) => T
	stringify: <T>(value: T) => string
}

export const json: JsonCodec = {
	parse: <T>(value: string) => JSON.parse(value) as T,
	stringify: <T>(value: T) => JSON.stringify(value),
}

export function stored<T extends Record<string, any>>(initial: T): T {
	const state: Partial<T> = reactive({})
	const read: { [K in keyof T]?: boolean } = {}

	function syncFromStorage(key: keyof T & string) {
		const storedValue = localStorage.getItem(key)
		state[key] = storedValue ? json.parse<T[typeof key]>(storedValue) : initial[key]
	}

	function handleStorageEvent(event: StorageEvent) {
		if (event.key === null) {
			for (const key in initial) {
				read[key] = false
				state[key] = initial[key]
			}
			return
		}
		if (event.key in initial) {
			const key = event.key as keyof T & string
			read[key] = false
			state[key] = event.newValue ? json.parse<T[typeof key]>(event.newValue) : initial[key]
		}
	}

	window.addEventListener('storage', handleStorageEvent)

	const cleanups: ScopedCallback[] = []
	for (const key in initial) {
		syncFromStorage(key)
		cleanups.push(
			effect(() => {
				const value = state[key]
				if (read[key]) {
					localStorage.setItem(key, json.stringify(value))
				}
				read[key] = true
			}),
		)
	}

	return cleanedBy(state as T, () => {
		for (const cleanup of cleanups) cleanup()
		window.removeEventListener('storage', handleStorageEvent)
	})
}
