/**
 * Ring buffer of freight dock register/unregister events, used to correlate the
 * "repairing missing dock registration" warning with the lifecycle that dropped
 * a registration. Lives in its own module (no heavy imports) so both `Hive`
 * (hive.ts) and the dock-sync module can write/read it without a cycle.
 */
export interface DockRegistryEvent {
	kind: 'register' | 'unregister'
	vehicleUid: string
	hiveName: string
	bayName: string
	time: number
	/** Shortened caller stack (first few frames past the registry helpers). */
	stack: string
}

const MAX_EVENTS = 64
const events: DockRegistryEvent[] = []

export function recordDockRegistryEvent(
	event: Omit<DockRegistryEvent, 'time' | 'stack'>,
	time: number
): void {
	const stack =
		new Error().stack?.split('\n').slice(2, 9).map((line) => line.trim()).join(' <- ') ?? ''
	events.push({ ...event, time, stack })
	if (events.length > MAX_EVENTS) events.splice(0, events.length - MAX_EVENTS)
}

export function recentDockRegistryEventsForVehicle(vehicleUid: string): DockRegistryEvent[] {
	return events.filter((event) => event.vehicleUid === vehicleUid).slice(-16)
}

/** Test/headless seam: clears the buffer. */
export function resetDockRegistryEvents(): void {
	events.length = 0
}
