import { unwrap } from 'mutts'

/**
 * The number ↔ live-object transformation for one cross-referenced entity type
 * (`T`), used during serialization and deserialization.
 *
 * Array position is the serialization identity (principle #3: "Index, not ID").
 * A single store serves both directions of the transform:
 *
 *   - save:  `toIndex(obj)`      → live object  → serialization number
 *   - load:  `fromIndex(index)`  → serialization number → live object
 *
 * Sharing one store type across both sides is what keeps the save-side and
 * load-side index spaces from drifting (the historical cause of the custom-zone
 * index bug, where save wrote one list order and load read another).
 *
 * Identity is keyed by the **raw** target (via `unwrap`) so a mutts reactive
 * proxy and its raw target resolve to the same number.
 */
export class IndexStore<T> {
	private readonly byObject = new Map<object, number>()
	private readonly objects: T[] = []

	/** Build a store over `items` in iteration order (position === identity). */
	static fromOrdered<T>(items: readonly T[]): IndexStore<T> {
		const store = new IndexStore<T>()
		for (const item of items) store.register(item)
		return store
	}

	/**
	 * Record `obj` and return its serialization number (appends when new).
	 *
	 * Save side: register live objects in array order. Load side: register each
	 * deserialized object in the same order so `fromIndex` can resolve it.
	 */
	register(obj: T): number {
		const raw = unwrap(obj) as unknown as object
		const existing = this.byObject.get(raw)
		if (existing !== undefined) return existing
		const index = this.objects.length
		this.byObject.set(raw, index)
		this.objects.push(obj)
		return index
	}

	/** Live object → serialization number (save direction of the transform). */
	toIndex(obj: T): number | undefined {
		return this.byObject.get(unwrap(obj) as unknown as object)
	}

	/** Serialization number → live object (load direction of the transform). */
	fromIndex(index: number): T | undefined {
		return this.objects[index]
	}

	/** The ordered backing array (array position === identity). */
	ordered(): readonly T[] {
		return this.objects
	}

	get size(): number {
		return this.objects.length
	}
}
