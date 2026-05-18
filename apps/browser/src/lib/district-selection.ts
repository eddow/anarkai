import { showProps } from '@app/lib/follow-selection'
import { game } from '@app/lib/globals'
import type { DockviewWidgetScope } from '@sursaut/ui/dockview'
import { DEFAULT_DISTRICT_ID, districtUid } from 'ssh/district/district'
import type { DistrictObject } from 'ssh/district/district'

type DockviewApiLike = DockviewWidgetScope['dockviewApi']

export function getDistrictObject(id = DEFAULT_DISTRICT_ID): DistrictObject | undefined {
	return game.getObject(districtUid(id)) as DistrictObject | undefined
}

export function showDistrictObject(
	id = DEFAULT_DISTRICT_ID,
	preferredApi?: DockviewApiLike
): void {
	const object = getDistrictObject(id)
	if (object) showProps(object, preferredApi)
}
