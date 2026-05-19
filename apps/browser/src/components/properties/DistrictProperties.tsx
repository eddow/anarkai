import { appShellZoneActions, buildPaletteSelectedActionValues } from '@app/lib/app-shell-controls'
import { css } from '@app/lib/css'
import { showProps } from '@app/lib/follow-selection'
import { game, interactionMode } from '@app/lib/globals'
import { Button, InspectorSection } from '@app/ui/anarkai'
import { alveoli as visualAlveoli, goods as visualGoods } from 'engine-pixi/assets/visual-content'
import { reactive } from 'mutts'
import {
	tablerOutlineRoad,
	tablerOutlineSquareMinus,
	tablerOutlineSquarePlus,
} from 'pure-glyf/icons'
import * as gameContent from 'ssh/assets/game-content'
import { isConstructionSiteShell } from 'ssh/build-site'
import {
	type NpcSettlementTradeProfile,
	type NpcTradeDirection,
	type SettlementTradeObject,
	settlementTradeObjectUid,
} from 'ssh/commerce/settlement-trade'
import type { DistrictObject } from 'ssh/district/district'
import type { DistrictPurchaseRequest } from 'ssh/district/procurement'
import type { GoodType } from 'ssh/types/base'
import EntityBadge from '../EntityBadge'
import PropertyGrid from '../PropertyGrid'
import PropertyGridRow from '../PropertyGridRow'
import ResourceImage from '../ResourceImage'

css`
.district-properties {
	display: flex;
	flex-direction: column;
	gap: 0.75rem;
	padding: 0.75rem;
	color: var(--ak-text);
}

.district-properties__actions {
	display: flex;
	flex-wrap: wrap;
	gap: 0.4rem;
}

.district-properties__tool-group {
	display: flex;
	flex-direction: column;
	gap: 0.45rem;
}

.district-properties__tool-group + .district-properties__tool-group {
	margin-top: 0.65rem;
}

.district-properties__tool-group-header {
	display: flex;
	align-items: center;
	justify-content: space-between;
	gap: 0.5rem;
}

.district-properties__tool-group-title {
	margin: 0;
	font-size: 0.82rem;
	font-weight: 650;
	color: var(--ak-muted-text, var(--ak-text));
}

.district-properties__tool-button {
	inline-size: 2.15rem;
	block-size: 2.15rem;
	padding: 0.25rem;
}

.district-properties__collapse-button {
	inline-size: 1.75rem;
	block-size: 1.75rem;
	padding: 0.18rem;
}

.district-properties__materials {
	display: flex;
	flex-direction: column;
	gap: 0.35rem;
}

.district-properties__markets {
	display: flex;
	flex-direction: column;
	gap: 0.5rem;
}

.district-properties__market {
	display: grid;
	grid-template-columns: minmax(0, 1fr) auto;
	align-items: center;
	gap: 0.55rem;
}

.district-properties__market-name {
	overflow: hidden;
	text-overflow: ellipsis;
	white-space: nowrap;
	font-weight: 650;
}

.district-properties__market-meta {
	display: block;
	margin-top: 0.15rem;
	color: var(--ak-text-muted);
	font-size: 0.78rem;
}

.district-properties__procurement {
	display: flex;
	flex-direction: column;
	gap: 0.4rem;
}

.district-properties__procurement-controls {
	display: grid;
	grid-template-columns: minmax(0, 1fr) auto;
	align-items: center;
	gap: 0.4rem 0.55rem;
}

.district-properties__number-input {
	inline-size: 5.25rem;
	min-inline-size: 0;
}

.district-properties__procurement-row {
	display: grid;
	grid-template-columns: minmax(0, 1fr) auto;
	align-items: center;
	gap: 0.55rem;
}

.district-properties__request-meta {
	display: block;
	margin-top: 0.15rem;
	color: var(--ak-text-muted);
	font-size: 0.78rem;
}
`

const buildableAlveoli = Object.entries(gameContent.alveoli).filter(
	([, alveolus]) => 'construction' in alveolus
) as Array<[string, (typeof gameContent.alveoli)[keyof typeof gameContent.alveoli]]>

const buildActions = buildPaletteSelectedActionValues(buildableAlveoli)
	.filter((entry) => entry.value.startsWith('build:'))
	.map((entry) => {
		const alveolusType = entry.value.slice('build:'.length)
		const sprite = visualAlveoli[alveolusType]?.sprites?.[0]
		return {
			...entry,
			icon: sprite
				? () => (
						<ResourceImage game={game} sprite={sprite} width={20} height={20} alt={entry.label} />
					)
				: entry.icon,
		}
	})

const roadActions = [
	{
		value: 'road:path',
		label: 'Path',
		icon: typeof tablerOutlineRoad === 'string' ? tablerOutlineRoad : undefined,
	},
] as const

const collapsedGroups = reactive({
	build: false,
	zones: false,
	roads: false,
})

type ToolGroupId = keyof typeof collapsedGroups

type DistrictToolAction = {
	value: string
	label: string
	icon?: string | JSX.Element | (() => JSX.Element)
}

function groupIcon(group: ToolGroupId): string | undefined {
	if (collapsedGroups[group]) {
		return typeof tablerOutlineSquarePlus === 'string' ? tablerOutlineSquarePlus : undefined
	}
	return typeof tablerOutlineSquareMinus === 'string' ? tablerOutlineSquareMinus : undefined
}

function toggleGroup(group: ToolGroupId): void {
	collapsedGroups[group] = !collapsedGroups[group]
}

function setAction(value: string): void {
	interactionMode.selectedAction = value
}

function ToolActionButton(props: { action: DistrictToolAction }): JSX.Element {
	const icon = () =>
		typeof props.action.icon === 'function' ? props.action.icon() : props.action.icon
	return (
		<Button
			ariaLabel={props.action.label}
			el:class="district-properties__tool-button"
			el:title={props.action.label}
			icon={icon()}
			onClick={() => setAction(props.action.value)}
		/>
	)
}

function DistrictToolGroup(props: {
	id: ToolGroupId
	title: string
	actions: readonly DistrictToolAction[]
}): JSX.Element {
	const toggleTitle = () => `${collapsedGroups[props.id] ? 'Expand' : 'Collapse'} ${props.title}`
	return (
		<section class="district-properties__tool-group">
			<div class="district-properties__tool-group-header">
				<h3 class="district-properties__tool-group-title">{props.title}</h3>
				<button
					aria-label={toggleTitle()}
					class="ak-control-button district-properties__collapse-button"
					data-icon-only="true"
					title={toggleTitle()}
					type="button"
					onClick={() => toggleGroup(props.id)}
				>
					<span class="ak-control-button__icon">
						<span class={groupIcon(props.id)} />
					</span>
				</button>
			</div>
			<div if={!collapsedGroups[props.id]} class="district-properties__actions">
				<for each={props.actions}>
					{(action: DistrictToolAction) => <ToolActionButton action={action} />}
				</for>
			</div>
		</section>
	)
}

function materialSprite(good: GoodType): string {
	return visualGoods[good]?.sprites?.[0] ?? visualGoods[good]?.icon ?? ''
}

function summarizeDistrictMaterials(district = game.getDistrict()) {
	const missing: Partial<Record<GoodType, number>> = {}
	let activeSites = 0
	for (const coord of district?.members ?? []) {
		const tile = game.hex.getTile(coord)
		const content = tile?.content
		const constructionSite =
			content && 'constructionSite' in content ? content.constructionSite : undefined
		if (!constructionSite) continue
		activeSites++
		const required = isConstructionSiteShell(content)
			? constructionSite.requiredGoods
			: constructionSite.foundationRequiredGoods
		const delivered = isConstructionSiteShell(content)
			? constructionSite.deliveredGoods
			: constructionSite.foundationDeliveredGoods
		for (const [good, qty] of Object.entries(required) as [GoodType, number][]) {
			const need = Math.max(0, (qty ?? 0) - (delivered[good] ?? 0))
			if (need > 0) missing[good] = (missing[good] ?? 0) + need
		}
	}
	return { activeSites, missing }
}

function formatKind(kind: string): string {
	return kind.charAt(0).toUpperCase() + kind.slice(1)
}

function offerCount(profile: NpcSettlementTradeProfile, direction: NpcTradeDirection): number {
	return profile.offers.filter((offer) => offer.direction === direction).length
}

function openSettlementMarket(profile: NpcSettlementTradeProfile): void {
	const object = game.getObject?.(settlementTradeObjectUid(profile.id)) as
		| SettlementTradeObject
		| undefined
	if (object) showProps(object)
}

function numberInputValue(event: Event): number {
	return Math.max(0, Math.floor(Number((event.currentTarget as HTMLInputElement).value) || 0))
}

function formatRequestStatus(request: DistrictPurchaseRequest): string {
	if (request.status === 'planned') return 'Planned'
	switch (request.blockReason) {
		case 'auto_buy_disabled':
			return 'Blocked: auto-buy off'
		case 'no_seller':
			return 'Blocked: no seller'
		case 'too_expensive':
			return 'Blocked: price cap'
		case 'reserve_limit':
			return 'Blocked: reserve'
		default:
			return 'Blocked'
	}
}

function requestSourceName(request: DistrictPurchaseRequest): string {
	if (!request.providerSettlementId) return 'No source'
	return (
		game.getSettlementTradeProfile?.(request.providerSettlementId)?.name ??
		request.providerSettlementId
	)
}

function updateProcurementPolicy(
	districtId: string,
	patch: Parameters<NonNullable<typeof game.updateDistrictProcurementPolicy>>[1]
): void {
	game.updateDistrictProcurementPolicy?.(districtId, patch)
}

function DistrictMarkets(): JSX.Element {
	const markets = () => game.listSettlementTradeProfiles?.() ?? []
	const concreteSources = () =>
		markets()
			.map((profile) => ({
				profile,
				offer: profile.offers.find(
					(offer) => offer.direction === 'sell' && offer.good === 'concrete'
				),
			}))
			.filter(
				(
					entry
				): entry is {
					profile: NpcSettlementTradeProfile
					offer: NonNullable<typeof entry.offer>
				} => Boolean(entry.offer)
			)
	return (
		<div class="district-properties__markets">
			<div class="district-properties__procurement">
				<span if={concreteSources().length === 0}>No concrete sellers discovered</span>
				<for each={concreteSources()}>
					{(source) => (
						<div
							class="district-properties__procurement-row"
							data-testid="district-concrete-source"
						>
							<span>
								Concrete from {source.profile.name} · {source.offer.priceVp} vp
							</span>
							<Button
								ariaLabel={`Buy concrete from ${source.profile.name}`}
								disabled
								el:title="Procurement jobs are next: vehicle goes to seller, pays, loads at border, then returns"
							>
								Buy
							</Button>
						</div>
					)}
				</for>
			</div>
			<span if={markets().length === 0}>No settlement markets discovered</span>
			<for each={markets()}>
				{(profile: NpcSettlementTradeProfile) => (
					<div class="district-properties__market" data-testid="district-market-row">
						<div>
							<span class="district-properties__market-name">{profile.name}</span>
							<span class="district-properties__market-meta">
								{formatKind(profile.kind)} · sells {offerCount(profile, 'sell')} · buys{' '}
								{offerCount(profile, 'buy')}
							</span>
						</div>
						<Button
							ariaLabel={`Open market ${profile.name}`}
							el:title={`Open market ${profile.name}`}
							onClick={() => openSettlementMarket(profile)}
						>
							Market
						</Button>
					</div>
				)}
			</for>
		</div>
	)
}

function DistrictProcurement(props: { districtObject?: DistrictObject }): JSX.Element {
	const district = () => props.districtObject?.district ?? game.getDistrict()
	const districtId = () => district()?.id ?? 'default'
	const policy = () => district()?.procurementPolicy
	const requests = () => game.listDistrictPurchaseRequests?.(districtId()) ?? []
	const sellGoods = () => game.listDistrictEligibleSellGoods?.(districtId()) ?? []
	return (
		<div class="district-properties__procurement">
			<div class="district-properties__procurement-controls">
				<label>
					<input
						type="checkbox"
						checked={policy()?.autoBuyNeededGoods ?? true}
						onChange={(event) =>
							updateProcurementPolicy(districtId(), {
								autoBuyNeededGoods: (event.currentTarget as HTMLInputElement).checked,
							})
						}
					/>{' '}
					Buy needed goods
				</label>
				<span>{game.playerAccount?.balanceVp ?? 0} vp</span>
				<label htmlFor="district-use-reserve">Use reserve</label>
				<input
					id="district-use-reserve"
					class="district-properties__number-input"
					type="number"
					min="0"
					value={String(policy()?.usePurchaseReserveVp ?? 0)}
					onInput={(event) =>
						updateProcurementPolicy(districtId(), {
							usePurchaseReserveVp: numberInputValue(event),
						})
					}
				/>
				<label htmlFor="district-buffer-reserve">Buffer reserve</label>
				<input
					id="district-buffer-reserve"
					class="district-properties__number-input"
					type="number"
					min="0"
					value={String(policy()?.bufferPurchaseReserveVp ?? 0)}
					onInput={(event) =>
						updateProcurementPolicy(districtId(), {
							bufferPurchaseReserveVp: numberInputValue(event),
						})
					}
				/>
			</div>
			<span if={requests().length === 0}>No planned purchases</span>
			<for each={requests()}>
				{(request: DistrictPurchaseRequest) => (
					<div class="district-properties__procurement-row" data-testid="district-purchase-request">
						<span>
							{request.quantity} {request.good} for {request.purpose}
							<span class="district-properties__request-meta">
								{requestSourceName(request)} ·{' '}
								{request.totalPriceVp === undefined ? 'no price' : `${request.totalPriceVp} vp`} ·{' '}
								{formatRequestStatus(request)}
							</span>
						</span>
						<span>{request.unitPriceVp === undefined ? '-' : `${request.unitPriceVp} vp`}</span>
					</div>
				)}
			</for>
			<div>
				<span>Eligible to sell: </span>
				<span>{sellGoods().length === 0 ? 'None' : sellGoods().join(', ')}</span>
			</div>
		</div>
	)
}

export default function DistrictProperties(props: {
	districtObject?: DistrictObject
}): JSX.Element {
	const district = () => props.districtObject?.district ?? game.getDistrict()
	const summary = () => summarizeDistrictMaterials(district())
	const missingGoods = () => Object.keys(summary().missing) as GoodType[]

	return (
		<div class="district-properties">
			<InspectorSection title={district()?.name ?? 'Default district'}>
				<PropertyGrid>
					<PropertyGridRow label="Kind">{district()?.kind ?? 'mixed'}</PropertyGridRow>
					<PropertyGridRow label="Members">{district()?.memberCount ?? 0}</PropertyGridRow>
					<PropertyGridRow label="Construction sites">{summary().activeSites}</PropertyGridRow>
				</PropertyGrid>
			</InspectorSection>

			<InspectorSection title="Tools">
				<DistrictToolGroup id="build" title="Build" actions={buildActions} />
				<DistrictToolGroup id="zones" title="Zones" actions={appShellZoneActions} />
				<DistrictToolGroup id="roads" title="Roads" actions={roadActions} />
			</InspectorSection>

			<InspectorSection title="Commerce">
				<DistrictProcurement districtObject={props.districtObject} />
				<DistrictMarkets />
			</InspectorSection>

			<InspectorSection title="Missing materials">
				<div class="district-properties__materials">
					<span if={missingGoods().length === 0}>None</span>
					<for each={missingGoods()}>
						{(good: GoodType) => (
							<EntityBadge
								game={game}
								height={16}
								sprite={materialSprite(good)}
								text={good}
								qty={summary().missing[good]}
							/>
						)}
					</for>
				</div>
			</InspectorSection>
		</div>
	)
}
