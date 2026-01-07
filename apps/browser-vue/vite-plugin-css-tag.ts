import type { Plugin } from 'vite'

interface CSSTagMatch {
	fullMatch: string
	cssContent: string
	startIndex: number
	endIndex: number
}

export function cssTagPlugin(): Plugin {
	return {
		name: 'vite-plugin-css-tag',
		enforce: 'pre',
		async transform(code, id) {
			if (!/\.(tsx?|jsx?)$/.test(id)) return null

			// Skip the css implementation file itself to avoid infinite recursion/bad replaces
			// Adjusted path check for ssh-vue context if needed, but generic names work
			if (id.includes('/lib/css.ts') || id.endsWith('lib/css.ts')) return null

			const matches = findCSSTagCalls(code)
			if (matches.length === 0) return null

			const hasInjectCSSImport = /import\s+.*__injectCSS.*from/.test(code)

			let transformedCode = code
			let offset = 0

			for (const match of matches.reverse()) {
				const replacement = `__injectCSS(${JSON.stringify(match.cssContent)});`
				const before = transformedCode.substring(0, match.startIndex + offset)
				const after = transformedCode.substring(match.endIndex + offset)
				transformedCode = before + replacement + after
				offset += replacement.length - (match.endIndex - match.startIndex)
			}

			if (!hasInjectCSSImport) {
                // IMPORTANT: Point to the ssh css lib via alias or relative path
                // Since we use $lib pointing to ssh/src/lib, we can use $lib/css
				transformedCode = `import { __injectCSS } from '$lib/css'; ${transformedCode}`
			}

			return { code: transformedCode, map: null }
		},
	}
}

function findCSSTagCalls(code: string): CSSTagMatch[] {
	const matches: CSSTagMatch[] = []

	const regex = /\bcss\s*`([^`${]*(?:\\.[^`${]*)*)`/g

	for (let match = regex.exec(code); match !== null; match = regex.exec(code)) {
		const [fullMatch, cssContent] = match

		if (fullMatch.includes('${')) continue

		const unescapedContent = cssContent
			.replace(/\\`/g, '`')
			.replace(/\\\$/g, '$')
			.replace(/\\n/g, '\n')
			.replace(/\\r/g, '\r')
			.replace(/\\t/g, '\t')

		matches.push({
			fullMatch,
			cssContent: unescapedContent,
			startIndex: match.index!,
			endIndex: match.index! + fullMatch.length,
		})
	}

	return matches
}
