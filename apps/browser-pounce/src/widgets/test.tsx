import { reactive } from 'mutts'
import type { DockviewWidgetProps } from 'pounce-ui/src'
import GoodsList from '../components/GoodsList'
import type { GoodType } from '@ssh/lib/types/base'
import { games } from '@app/lib/globals'

export default (_props: DockviewWidgetProps) => {
	const state = reactive({
		// Now using an array for the goods selection
		goods: ['wood', 'berries'] as GoodType[]
	})

	let game: any
	try {
		game = games.game('GameX')
	} catch (e) {
		console.warn('GameX not found for TestWidget')
	}

	return (
		<div style={{ padding: '1rem', height: '100%', overflow: 'auto' }}>
			<h2>Test Widget</h2>
			<p>Interactive GoodsList (Array + Two-Way Binding):</p>
			{game ? (
				<>
					<div style={{ marginTop: '1rem', border: '1px solid var(--pico-border-color)', padding: '1rem', borderRadius: '4px' }}>
						<GoodsList
							game={game}
							goods={state.goods}
							editable={true}
							renderItemExtra={(good, index) => (
								<span style={{ fontSize: '10px', marginLeft: '4px', opacity: 0.7 }}>
									#{index}
								</span>
							)}
						/>
					</div>
					<pre style={{ marginTop: '1rem', padding: '0.5rem', background: 'var(--pico-card-background-color)', fontSize: '0.8rem' }}>
						{JSON.stringify(state.goods, null, 2)}
					</pre>
				</>
			) : (
				<p>Game instance 'GameX' not found. Please open a game first.</p>
			)}
		</div>
	)
}
