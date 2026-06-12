import { css } from '@app/lib/css'
import { game } from '@app/lib/globals'
import { activeWorldViewPov } from '@app/lib/interactive-state'
import { InspectorSection } from '@app/ui/anarkai'
import { effect, reactive } from 'mutts'
import type { NpcSettlementTradeProfile } from 'ssh/commerce/settlement-trade'
import { compareSettlementPrices, type SettlementPriceEntry } from 'ssh/commerce/settlement-trade'
import type { AxialCoord } from 'ssh/utils'
import { axial } from 'ssh/utils'

const MAX_SETTLEMENTS = 8

css`
.commercial-overview {
	display: flex;
	flex-direction: column;
	gap: 0;
	height: 100%;
	color: var(--ak-text);
	box-sizing: border-box;
	background-color: var(--app-bg);
	padding: 0.5rem;
	overflow-y: auto;
}

.commercial-overview__price-table {
	width: 100%;
	border-collapse: collapse;
	font-size: 0.72rem;
}

.commercial-overview__price-table th,
.commercial-overview__price-table td {
	padding: 0.2rem 0.4rem;
	text-align: left;
	border-bottom: 1px solid color-mix(in srgb, var(--ak-text-muted) 8%, transparent);
}

.commercial-overview__price-table th {
	font-size: 0.68rem;
	text-transform: uppercase;
	color: var(--ak-text-muted);
	font-weight: 600;
}

.commercial-overview__price-source {
	color: #22c55e;
}

.commercial-overview__price-sink {
	color: #f59e0b;
}

.commercial-overview__empty {
	font-size: 0.9rem;
	opacity: 0.75;
	padding: 0.5rem;
}

.commercial-overview__meta {
	font-size: 0.68rem;
	color: var(--ak-text-muted);
	padding-bottom: 0.5rem;
}
`

function distanceFrom(center: AxialCoord, profile: NpcSettlementTradeProfile): number {
	return axial.distance(center, profile.center)
}

const CommercialOverviewWidget = () => {
	const local = reactive({ revision: 0 })

	const sortedProfiles = (): NpcSettlementTradeProfile[] => {
		void local.revision
		const center = activeWorldViewPov.center
		if (!center) return game.listSettlementTradeProfiles()
		const profiles = [...game.listSettlementTradeProfiles()]
		profiles.sort((a, b) => distanceFrom(center, a) - distanceFrom(center, b))
		return profiles.slice(0, MAX_SETTLEMENTS)
	}

	const priceData = () => {
		const profiles = sortedProfiles()
		if (profiles.length < 2) return undefined
		const comparison = compareSettlementPrices(profiles)
		const goodSet = new Set<string>()
		for (const key of Object.keys(comparison.cheapestSources)) goodSet.add(key)
		for (const key of Object.keys(comparison.bestSinks)) goodSet.add(key)
		const goods = [...goodSet].sort()
		if (goods.length === 0) return undefined

		interface PriceRow {
			good: string
			cheapestSource?: SettlementPriceEntry
			bestSink?: SettlementPriceEntry
		}
		const rows: PriceRow[] = []
		for (const good of goods) {
			const sources =
				(comparison.cheapestSources as Record<string, SettlementPriceEntry[]>)[good] ?? []
			const sinks = (comparison.bestSinks as Record<string, SettlementPriceEntry[]>)[good] ?? []
			rows.push({ good, cheapestSource: sources[0], bestSink: sinks[0] })
		}
		return {
			rows,
			profileCount: profiles.length,
			totalCount: game.listSettlementTradeProfiles().length,
		}
	}

	// Trigger settlement generation near camera when opened
	effect`commercial-overview:ensure-settlements`(() => {
		const center = activeWorldViewPov.center
		void local.revision
		if (!center) return
		const cur = game.listSettlementTradeProfiles()
		if (cur.length >= MAX_SETTLEMENTS) return
		void game.ensureNearbySettlements(center, MAX_SETTLEMENTS).then(() => {
			local.revision++
		})
	})

	return (
		<div class="commercial-overview">
			<InspectorSection title="Settlement prices">
				<div if={!priceData()} class="commercial-overview__empty">
					Need at least two settlements within range to show price comparison.
				</div>
				<div if={!!priceData()}>
					<div class="commercial-overview__meta">
						Showing nearest {priceData()!.profileCount} of {priceData()!.totalCount} settlements
					</div>
					<table class="commercial-overview__price-table">
						<thead>
							<tr>
								<th>Good</th>
								<th>Cheapest source</th>
								<th>Best sink</th>
							</tr>
						</thead>
						<tbody>
							<for each={priceData()!.rows}>
								{(row) => (
									<tr>
										<td>{row.good}</td>
										<td>
											<span if={!!row.cheapestSource} class="commercial-overview__price-source">
												{row.cheapestSource?.settlementName} {row.cheapestSource?.priceVp} vp
											</span>
											<span else class="commercial-overview__empty">
												—
											</span>
										</td>
										<td>
											<span if={!!row.bestSink} class="commercial-overview__price-sink">
												{row.bestSink?.settlementName} {row.bestSink?.priceVp} vp
											</span>
											<span else class="commercial-overview__empty">
												—
											</span>
										</td>
									</tr>
								)}
							</for>
						</tbody>
					</table>
				</div>
			</InspectorSection>
		</div>
	)
}

export default CommercialOverviewWidget
