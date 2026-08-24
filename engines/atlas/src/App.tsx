import EconomyAtlas from '@atlas/atlas/EconomyAtlas'
import { reactive } from 'mutts'

export default function App() {
	const gcErrors = reactive<{ list: readonly string[] }>({ list: [] })

	return (
		<div class="atlas-shell">
			<header class="atlas-toolbar">
				<strong>Economy Atlas</strong>
				<span class="gc-badge" if={gcErrors.list.length > 0} title={gcErrors.list.join('\n')}>
					⚠ {gcErrors.list.length} GC error{gcErrors.list.length === 1 ? '' : 's'}
				</span>
				<span class="hint">click a node to spotlight its chain · double-click a group to collapse it</span>
			</header>
			<EconomyAtlas
				onErrors={(errors) => {
					gcErrors.list = errors
					for (const e of errors) console.error(`[atlas:gc] ${e}`)
				}}
			/>
		</div>
	)
}
