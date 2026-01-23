export function setupEnvironment() {
	if (typeof globalThis.window === 'undefined') {
		;(globalThis as any).window = globalThis
	}
	if (typeof globalThis.document === 'undefined') {
		;(globalThis as any).document = {
			baseURI: 'http://localhost/',
			createElement: () => ({
				getContext: () => ({
					getParameter: () => 0,
					getExtension: () => ({}),
				}),
				addEventListener: () => {},
			}),
		}
	}
	if (typeof globalThis.location === 'undefined') {
		;(globalThis as any).location = {
			href: 'http://localhost/',
			protocol: 'http:',
			host: 'localhost',
			hostname: 'localhost',
		}
	}
	if (typeof globalThis.navigator === 'undefined') {
		;(globalThis as any).navigator = { userAgent: 'node' }
	}
	if (typeof globalThis.requestAnimationFrame === 'undefined') {
		;(globalThis as any).requestAnimationFrame = (cb: FrameRequestCallback) => setTimeout(cb, 16)
	}
}
