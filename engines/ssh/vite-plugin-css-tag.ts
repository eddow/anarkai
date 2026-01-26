import MagicString from 'magic-string'
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

			// Skip library files that might contain the implementation itself to avoid circular issues
			if (id.includes('/lib/css.ts') || id.endsWith('lib/css.ts')) return null

			const matches = findCSSTagCalls(code)
			if (matches.length === 0) return null

			const s = new MagicString(code)
			const hasInjectCSSImport = /import\s+.*__injectCSS.*from/.test(code)

			for (const match of matches) {
				const replacement = `__injectCSS(${JSON.stringify(match.cssContent)});`
				s.overwrite(match.startIndex, match.endIndex, replacement)
			}

			if (!hasInjectCSSImport) {
				s.prepend("import { __injectCSS } from '@ssh/lib/css';\n")
			}

			return {
				code: s.toString(),
				map: s.generateMap({
					file: id,
					source: id,
					includeContent: true,
					hires: true,
				}),
			}
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
