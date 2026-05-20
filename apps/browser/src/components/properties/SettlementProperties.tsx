import { css } from '@app/lib/css'
import { game } from '@app/lib/globals'
import { InspectorSection } from '@app/ui/anarkai'
import { goods as visualGoods } from 'engine-pixi/assets/visual-content'
import type {
	NpcSettlementTradeOffer,
	NpcSettlementTradeProfile,
	SettlementTradeObject,
} from 'ssh/commerce/settlement-trade'
import EntityBadge from '../EntityBadge'
import PropertyGrid from '../PropertyGrid'
import PropertyGridRow from '../PropertyGridRow'

css`
.settlement-properties__offers {
	display: flex;
	flex-direction: column;
	gap: 0.35rem;
}

.settlement-properties__offer {
	display: flex;
	align-items: center;
	justify-content: space-between;
	gap: 0.6rem;
	min-width: 0;
}

.settlement-properties__price {
	font-variant-numeric: tabular-nums;
	color: var(--ak-text-muted);
	white-space: nowrap;
}
`

interface SettlementPropertiesProps {
	settlementObject?: SettlementTradeObject
	profile?: NpcSettlementTradeProfile
}

const formatKind = (kind: string): string => kind.charAt(0).toUpperCase() + kind.slice(1)

const singlePriceOffers = (
	profile: NpcSettlementTradeProfile
): Array<NpcSettlementTradeOffer & { directions: Set<NpcSettlementTradeOffer['direction']> }> => {
	const byGood = new Map<
		string,
		NpcSettlementTradeOffer & { directions: Set<NpcSettlementTradeOffer['direction']> }
	>()
	for (const offer of profile.offers) {
		const existing = byGood.get(offer.good)
		if (existing) {
			existing.directions.add(offer.direction)
			continue
		}
		byGood.set(offer.good, { ...offer, directions: new Set([offer.direction]) })
	}
	return [...byGood.values()].sort((left, right) => left.good.localeCompare(right.good))
}

const OfferRows = (props: { offers: readonly NpcSettlementTradeOffer[] }) => (
	<div class="settlement-properties__offers">
		<for each={props.offers}>
			{(offer) => {
				const visual = visualGoods[offer.good as keyof typeof visualGoods]
				const sprite = visual?.sprites?.[0] ?? ''
				return (
					<div
						class="settlement-properties__offer"
						data-testid="settlement-market-price"
					>
						<EntityBadge
							game={game}
							height={16}
							sprite={sprite}
							text={offer.good}
							qtyLabel={offer.good}
						/>
						<span class="settlement-properties__price">{offer.priceVp} vp</span>
					</div>
				)
			}}
		</for>
	</div>
)

const SettlementProperties = (props: SettlementPropertiesProps) => {
	const profile = () => props.profile ?? props.settlementObject!.profile
	const prices = () => singlePriceOffers(profile())
	const center = () => profile().center

	return (
		<InspectorSection title={profile().name}>
			<PropertyGrid>
				<PropertyGridRow label="Kind">{formatKind(profile().kind)}</PropertyGridRow>
				<PropertyGridRow label="Center">
					{center().q}, {center().r}
				</PropertyGridRow>
				<PropertyGridRow label="Radius">{profile().radius}</PropertyGridRow>
				<PropertyGridRow if={prices().length > 0} label="Market">
					<OfferRows offers={prices()} />
				</PropertyGridRow>
			</PropertyGrid>
		</InspectorSection>
	)
}

export default SettlementProperties
