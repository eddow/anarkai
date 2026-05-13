export {}

declare global {
	interface ImportMeta {
		readonly url: string
	}

	var WebAssembly: unknown

	var process:
		| {
				versions?: {
					node?: string
				}
		  }
		| undefined

	var console: {
		log(...args: unknown[]): void
		warn(...args: unknown[]): void
	}
}
