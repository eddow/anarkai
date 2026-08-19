import { css } from '@app/lib/css'
import { showProps } from '@app/lib/follow-selection'
import { game, interactionMode } from '@app/lib/globals'
import { getZoneObject, unnamedZoneOwnership } from '@app/lib/zone-selection'
import { InspectorSection } from '@app/ui/anarkai'
import { renderAnarkaiIcon } from '@app/ui/anarkai/icons/render-icon'
import { tablerOutlinePencil, tablerOutlinePlus, tablerOutlineTrash } from 'pure-glyf/icons'
import type { ZoneDefinition } from 'ssh/board/zone'
import type { ZonesCollectionObject } from 'ssh/board/zone-object'

css`
.zones-properties {
	display: flex;
	flex-direction: column;
	gap: 0.6rem;
}

.zones-properties__actions {
	display: flex;
	gap: 0.35rem;
}

.zones-properties__button {
	display: inline-flex;
	align-items: center;
	justify-content: center;
	gap: 0.35rem;
	min-height: 2rem;
	padding: 0.3rem 0.55rem;
	border-radius: 0.4rem;
	border: 1px solid color-mix(in srgb, var(--ak-text-muted) 22%, transparent);
	background: color-mix(in srgb, var(--ak-surface-panel) 92%, transparent);
	color: var(--ak-text);
	cursor: pointer;
}

.zones-properties__button[disabled] {
	opacity: 0.55;
	cursor: not-allowed;
}

.zones-properties__table {
	width: 100%;
	border-collapse: collapse;
	table-layout: fixed;
	font-size: 0.78rem;
}

.zones-properties__table th {
	text-align: left;
	font-size: 0.68rem;
	text-transform: uppercase;
	color: var(--ak-text-muted);
	padding: 0.25rem 0.35rem;
}

.zones-properties__table td {
	padding: 0.35rem;
	border-top: 1px solid color-mix(in srgb, var(--ak-text-muted) 14%, transparent);
	vertical-align: middle;
}

.zones-properties__swatch {
	display: inline-flex;
	width: 1rem;
	height: 1rem;
	border-radius: 999px;
	border: 1px solid color-mix(in srgb, var(--ak-text-muted) 28%, transparent);
}

.zones-properties__name {
	min-width: 0;
	overflow: hidden;
	text-overflow: ellipsis;
	white-space: nowrap;
}

.zones-properties__row-actions {
	display: flex;
	justify-content: flex-end;
	gap: 0.25rem;
}

.zones-properties__icon-button {
	display: inline-flex;
	align-items: center;
	justify-content: center;
	width: 1.85rem;
	height: 1.85rem;
	border-radius: 0.35rem;
	border: 1px solid color-mix(in srgb, var(--ak-text-muted) 22%, transparent);
	background: color-mix(in srgb, var(--ak-surface-panel) 92%, transparent);
	color: var(--ak-text);
	cursor: pointer;
}
`

interface ZonesPropertiesProps {
	zonesObject: ZonesCollectionObject
}

const icon = (source: string) => renderAnarkaiIcon(source, { size: 15 })

const zoneLabel = (zone: ZoneDefinition) => zone.name?.trim() || zone.type

const ZonesProperties = (_props: ZonesPropertiesProps) => {
	const zones = () => game.hex.zoneManager.listZoneDefinitions()
	const memberCount = (zone: ZoneDefinition) => game.hex.zoneManager.coordsForZone(zone).length
	const createZone = () => {
		const base = `zone-${Date.now().toString(36)}`
		const zone = game.hex.zoneManager.defineZone({
			name: base,
			type: 'passive',
			color: '#4f8cff',
		})
		unnamedZoneOwnership.zone = zone
		interactionMode.selectedAction = `zone:${zone.name}`
		const object = getZoneObject(zone)
		if (object) showProps(object)
	}
	const openZone = (zone: ZoneDefinition) => {
		const object = getZoneObject(zone)
		if (object) showProps(object)
	}
	const deleteUnusedZone = (zone: ZoneDefinition) => {
		if (memberCount(zone) > 0) return
		game.hex.zoneManager.removeZoneDefinition(zone)
	}

	return (
		<InspectorSection title="Zones">
			<div class="zones-properties">
				<div class="zones-properties__actions">
					<button
						type="button"
						class="zones-properties__button"
						onClick={createZone}
						data-testid="zones-create"
					>
						{icon(tablerOutlinePlus)}
						New zone
					</button>
				</div>
				<table class="zones-properties__table">
					<thead>
						<tr>
							<th>Color</th>
							<th>Name</th>
							<th>Tiles</th>
							<th />
						</tr>
					</thead>
					<tbody>
						{zones().map((zone, i) => (
							<tr data-testid={`zones-row-${i}`}>
								<td>
									<span
										class="zones-properties__swatch"
										style={{ background: zone.color ?? '#4f8cff' }}
									/>
								</td>
								<td class="zones-properties__name">{zoneLabel(zone)}</td>
								<td>{memberCount(zone)}</td>
								<td>
									<div class="zones-properties__row-actions">
										<button
											type="button"
											class="zones-properties__icon-button"
											title="Open zone"
											onClick={() => openZone(zone)}
											data-testid={`zones-open-${i}`}
										>
											{icon(tablerOutlinePencil)}
										</button>
										<button
											type="button"
											class="zones-properties__icon-button"
											title="Delete unused zone"
											disabled={memberCount(zone) > 0}
											onClick={() => deleteUnusedZone(zone)}
											data-testid={`zones-delete-${i}`}
										>
											{icon(tablerOutlineTrash)}
										</button>
									</div>
								</td>
							</tr>
						))}
					</tbody>
				</table>
			</div>
		</InspectorSection>
	)
}

export default ZonesProperties
