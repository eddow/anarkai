import { css } from '@app/lib/css'
import { game } from '@app/lib/globals'
import { InspectorSection } from '@app/ui/anarkai'
import { goods as visualGoods } from 'engine-pixi/assets/visual-content'
import type { NpcSettlementTradeOffer, SettlementTradeObject } from 'ssh/commerce/settlement-trade'
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
	settlementObject: SettlementTradeObject
}

const formatKind = (kind: string): string => kind.charAt(0).toUpperCase() + kind.slice(1)

const offersFor = (
	settlementObject: SettlementTradeObject,
	direction: NpcSettlementTradeOffer['direction']
) => settlementObject.profile.offers.filter((offer) => offer.direction === direction)

const OfferRows = (props: { offers: readonly NpcSettlementTradeOffer[] }) => (
	<div class="settlement-properties__offers">
		<for each={props.offers}>
			{(offer) => {
				const visual = visualGoods[offer.good as keyof typeof visualGoods]
				const sprite = visual?.sprites?.[0] ?? ''
				return (
					<div
						class="settlement-properties__offer"
						data-testid={`settlement-offer-${offer.direction}`}
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
	const profile = () => props.settlementObject.profile
	const sells = () => offersFor(props.settlementObject, 'sell')
	const buys = () => offersFor(props.settlementObject, 'buy')
	const center = () => profile().center

	return (
		<InspectorSection title={profile().name}>
			<PropertyGrid>
				<PropertyGridRow label="Kind">{formatKind(profile().kind)}</PropertyGridRow>
				<PropertyGridRow label="Center">
					{center().q}, {center().r}
				</PropertyGridRow>
				<PropertyGridRow label="Radius">{profile().radius}</PropertyGridRow>
				<PropertyGridRow if={sells().length > 0} label="Sells">
					<OfferRows offers={sells()} />
				</PropertyGridRow>
				<PropertyGridRow if={buys().length > 0} label="Buys">
					<OfferRows offers={buys()} />
				</PropertyGridRow>
			</PropertyGrid>
		</InspectorSection>
	)
}

export default SettlementProperties
