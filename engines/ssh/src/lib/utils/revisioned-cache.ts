export class RevisionedCache<T> {
	private revision: unknown
	private value: T | undefined
	private hasValue = false

	get(revision: unknown, compute: () => T): T {
		if (this.hasValue && this.revision === revision) return this.value as T
		const value = compute()
		this.revision = revision
		this.value = value
		this.hasValue = true
		return value
	}

	clear(): void {
		this.revision = undefined
		this.value = undefined
		this.hasValue = false
	}
}

export class KeyedRevisionedCache<K, T> {
	private readonly entries = new Map<K, { revision: number; value: T }>()

	get(key: K, revision: number, compute: () => T): T {
		const entry = this.entries.get(key)
		if (entry && entry.revision === revision) return entry.value
		const value = compute()
		this.entries.set(key, { revision, value })
		return value
	}

	clear(key?: K): void {
		if (key === undefined) this.entries.clear()
		else this.entries.delete(key)
	}
}
