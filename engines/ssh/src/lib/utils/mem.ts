import { reactive } from 'mutts'
import { type Axial, type AxialKey, type AxialRef, axial } from '.'

export interface AxialKeyDictionary<T> {
	get(key: AxialRef): T | undefined
	set(key: AxialRef, value: T): void
	has(key: AxialRef): boolean

	keys(): Iterable<AxialKey>
	entries(): Iterable<[AxialKey, T]>
	values(): Iterable<T>
}

export class AxialKeyMap<T> implements AxialKeyDictionary<T>, Iterable<[AxialKey, T]> {
	// LLM: No need ot make this map reactive - it will be made reactive automatically if the AxialKeyMap is reactive
	private map: Map<AxialKey, T>

	constructor(
		init: Iterable<[AxialRef, T]> = [],
		private readonly defaultValue?: () => T,
	) {
		this.map = reactive(new Map(
			(function* () {
				for (const [k, v] of init) yield [axial.key(k), v]
			})(),
		))
	}
	[Symbol.iterator](): Iterator<[AxialKey, T], any, any> {
		return this.map[Symbol.iterator]()
	}
	get(key: AxialRef): T | undefined {
		if (!this.defaultValue || this.map.has(axial.key(key))) return this.map.get(axial.key(key))!
		const value = this.defaultValue()
		this.map.set(axial.key(key), value)
		return value
	}

	set(key: AxialRef, value: T): void {
		this.map.set(axial.key(key), value)
	}

	has(key: AxialRef): boolean {
		return this.map.has(axial.key(key))
	}

	delete(key: AxialRef): boolean {
		return this.map.delete(axial.key(key))
	}

	keys(): Iterable<AxialKey> {
		return this.map.keys()
	}
	*coords(): Iterable<Axial> {
		for (const key of this.map.keys()) yield axial.keyAccess(key)
	}
	entries(): MapIterator<[AxialKey, T]> {
		return this.map.entries()
	}
	values(): Iterable<T, any, any> {
		return this.map.values()
	}
	clear(): void {
		this.map.clear()
	}
	get size(): number {
		return this.map.size
	}
}

export class AxialSet implements Iterable<Axial> {
	private set: AxialKeyMap<Axial>

	constructor(init: Iterable<AxialRef> = []) {
		this.set = new AxialKeyMap(
			(function* () {
				for (const k of init) yield [axial.key(k), axial.access(k)]
			})(),
		)
	}
	[Symbol.iterator](): Iterator<Axial, any, any> {
		return this.set.values()[Symbol.iterator]()
	}
	add(aRef: AxialRef): void {
		this.set.set(aRef, axial.access(aRef))
	}
	has(aRef: AxialRef): boolean {
		return this.set.has(aRef)
	}
	values(): Iterable<Axial> {
		return this.set.values()
	}
	delete(aRef: AxialRef): boolean {
		return this.set.delete(aRef)
	}

	clear(): void {
		this.set.clear()
	}
	get size(): number {
		return this.set.size
	}
}

export abstract class Heap<Indexed, Comparable extends number | string> {
	protected indexMap = new Map<Indexed, number>()

	constructor(protected readonly heap: [Indexed, Comparable][] = []) {
		heap.forEach((entry, idx) => {
			this.indexMap.set(entry[0], idx)
		})
		if (heap.length) this.heapifyDown(0)
	}

	protected abstract compare(a: Comparable, b: Comparable): boolean

	set(a: Indexed, c: Comparable): void {
		const index = this.indexMap.get(a)
		if (index === undefined) {
			this.heap.push([a, c])
			this.indexMap.set(a, this.heap.length - 1)
			this.heapifyUp(this.heap.length - 1)
		} else {
			const old = this.heap[index][1]
			this.heap[index][1] = c
			if (this.compare(c, old)) this.heapifyUp(index)
			else this.heapifyDown(index)
		}
	}

	remove(a: Indexed): void {
		const index = this.indexMap.get(a)
		if (index === undefined) return

		const last = this.heap.pop()!
		if (index < this.heap.length) {
			this.heap[index] = last
			this.indexMap.set(last[0], index)
			this.heapifyDown(index)
		} else this.indexMap.delete(last[0])

		this.indexMap.delete(a)
	}

	get peek(): Indexed | undefined {
		return this.heap[0]?.[0]
	}

	get top(): Comparable | undefined {
		return this.heap[0]?.[1]
	}

	pop(): [Indexed, Comparable] | undefined {
		if (!this.heap.length) return
		const top = this.heap[0]
		const last = this.heap.pop()!
		this.indexMap.delete(last[0])
		if (this.heap.length) {
			this.heap[0] = last
			this.indexMap.set(this.heap[0][0], 0)
		}
		this.heapifyDown(0)
		this.indexMap.delete(top[0])
		return top
	}

	get isEmpty(): boolean {
		return !this.heap.length
	}

	get size(): number {
		return this.heap.length
	}

	private heapifyUp(index: number): void {
		while (index > 0) {
			const parentIndex = Math.floor((index - 1) / 2)
			const parent = this.heap[parentIndex]
			const current = this.heap[index]
			if (this.compare(parent[1], current[1])) break
			this.swap(index, parentIndex)
			index = parentIndex
		}
	}

	private heapifyDown(index: number): void {
		while (true) {
			const leftChildIndex = 2 * index + 1
			const rightChildIndex = 2 * index + 2
			let target = index
			if (
				leftChildIndex < this.heap.length &&
				this.compare(this.heap[leftChildIndex][1], this.heap[target][1])
			) {
				target = leftChildIndex
			}
			if (
				rightChildIndex < this.heap.length &&
				this.compare(this.heap[rightChildIndex][1], this.heap[target][1])
			) {
				target = rightChildIndex
			}
			if (target === index) break
			this.swap(index, target)
			index = target
		}
	}

	private swap(i: number, j: number): void {
		const temp = this.heap[i]
		this.heap[i] = this.heap[j]
		this.heap[j] = temp
		this.indexMap.set(this.heap[i][0], i)
		this.indexMap.set(this.heap[j][0], j)
	}
}

export class HeapMax<Indexed, Comparable extends number | string> extends Heap<
	Indexed,
	Comparable
> {
	protected compare(a: Comparable, b: Comparable): boolean {
		return a > b
	}
}

export class HeapMin<Indexed, Comparable extends number | string> extends Heap<
	Indexed,
	Comparable
> {
	protected compare(a: Comparable, b: Comparable): boolean {
		return a < b
	}
}
