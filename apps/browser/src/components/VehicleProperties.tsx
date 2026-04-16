import { css } from '@app/lib/css'
import { InspectorSection } from '@app/ui/anarkai'
import { vehicles as vehicleVisuals } from 'engine-pixi/assets/visual-content'
import { vehicleTextureKey } from 'engine-pixi/renderers/vehicle-visual'
import { effect } from 'mutts'
import { createSyntheticFreightLineObject } from 'ssh/freight/freight-line'
import { i18nState } from 'ssh/i18n'
import type { VehicleEntity } from 'ssh/population/vehicle/entity'
import {
	isVehicleLineService,
	isVehicleOffloadService,
	type WorldVehicleType,
} from 'ssh/population/vehicle/vehicle'
import type { GoodType } from 'ssh/types/base'
import EntityBadge from './EntityBadge'
import GoodsList from './GoodsList'
import InspectorObjectLink from './InspectorObjectLink'
import LinkedEntityControl from './LinkedEntityControl'
import PropertyGrid from './PropertyGrid'
import PropertyGridRow from './PropertyGridRow'

css`
.vehicle-properties {
	padding: 0;
}

.vehicle-properties__header {
	display: flex;
	align-items: center;
	gap: 0.75rem;
	width: 100%;
	margin-bottom: 1rem;
}

.vehicle-properties__linked-object {
	display: flex;
	align-items: center;
	gap: 0.5rem;
}

.vehicle-properties__service-text {
	font-size: 0.875rem;
	line-height: 1.35;
	color: var(--ak-text-muted);
	min-width: 0;
}
`

interface VehiclePropertiesProps {
	vehicle: VehicleEntity
}

function resolveVehicleSpriteKey(vehicleType: WorldVehicleType): string {
	const fromVisual = vehicleVisuals[vehicleType]?.sprites?.[0]
	return fromVisual ?? vehicleTextureKey(vehicleType)
}

const VehicleProperties = (props: VehiclePropertiesProps, scope: { setTitle?: (title: string) => void }) => {
	const computed = {
		get stock() {
			return props.vehicle?.storage?.stock ?? {}
		},
		get operator() {
			return props.vehicle?.operator
		},
		get lineServiceObject() {
			const svc = props.vehicle?.service
			if (!isVehicleLineService(svc)) return undefined
			return createSyntheticFreightLineObject(props.vehicle.game, svc.line)
		},
		get serviceSummaryText(): string {
			const v = props.vehicle
			if (!v) return ''
			const svc = v.service
			if (!svc) {
				return i18nState.translator?.vehicle?.idle ?? 'Idle'
			}
			if (isVehicleLineService(svc)) {
				const docked = svc.docked ?
						(i18nState.translator?.vehicle?.docked ?? 'Docked')
					:	(i18nState.translator?.vehicle?.underway ?? 'Underway')
				const stopLabel = i18nState.translator?.line?.stop ?? 'Stop'
				return `${svc.line.name} · ${stopLabel} ${svc.stop.id} · ${docked}`
			}
			if (isVehicleOffloadService(svc)) {
				return i18nState.translator?.vehicle?.offloadService ?? 'Offload'
			}
			return ''
		},
	}

	effect`vehicle-properties:title`(() => {
		scope.setTitle?.(props.vehicle?.title ?? 'Object')
	})

	return (
		<>
			<div if={props.vehicle} class="vehicle-properties">
				<div class="vehicle-properties__header">
					<EntityBadge
						game={props.vehicle.game}
						sprite={resolveVehicleSpriteKey(props.vehicle.vehicleType)}
						text={props.vehicle.title}
						height={32}
					/>
				</div>
				<InspectorSection>
					<PropertyGrid>
						<PropertyGridRow
							if={computed.operator}
							label={i18nState.translator?.vehicle?.operator ?? 'Operator'}
						>
							<div class="vehicle-properties__linked-object">
								<LinkedEntityControl object={computed.operator!} />
								<InspectorObjectLink object={computed.operator!} />
							</div>
						</PropertyGridRow>
						<PropertyGridRow label={String(i18nState.translator?.goods ?? '')}>
							<GoodsList
								goods={Object.keys(computed.stock) as GoodType[]}
								game={props.vehicle.game}
								getBadgeProps={(g) => ({ qty: computed.stock[g] })}
							/>
						</PropertyGridRow>
						<PropertyGridRow label={i18nState.translator?.vehicle?.service ?? 'Service'}>
							<div if={computed.lineServiceObject} class="vehicle-properties__linked-object">
								<span class="vehicle-properties__service-text">{computed.serviceSummaryText}</span>
								<LinkedEntityControl object={computed.lineServiceObject!} />
								<InspectorObjectLink object={computed.lineServiceObject!} />
							</div>
							<span else class="vehicle-properties__service-text">{computed.serviceSummaryText}</span>
						</PropertyGridRow>
					</PropertyGrid>
				</InspectorSection>
			</div>
			<div else />
		</>
	)
}

export default VehicleProperties
