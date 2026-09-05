import { css } from '@app/lib/css'
import { Button } from '@app/ui/anarkai'
import { goods as sensoryGoods } from 'engine-rules/visual-content'
import { reactive } from 'mutts'
import {
	type GoodAvailability,
	type GoodAvailabilityKind,
	measureGoodAvailability,
} from 'ssh/commerce/board-sources'
import type { ProjectSourcingMode } from 'ssh/commerce/commerce-model'
import type { Game } from 'ssh/game'
import type { Project } from 'ssh/project'
import type { GoodType } from 'ssh/types/base'
import type { AxialCoord } from 'ssh/utils/axial'
import EntityBadge from './EntityBadge'

/**
 * The project sourcing decision, as a single availability-sorted list with a
 * "take / buy" divider.
 *
 * Bill-only (the project's `requiredGoods`), sorted **nearest → not produced**:
 *
 *   - `produced`  — some hive holds the good above its reserve (exportable).
 *   - `held`      — a hive has it, but below reserve (not immediately free).
 *   - `unproduced`— no hive produces/holds it.
 *
 * The **default** split puts produced/held goods above the line (`take` — await
 * locally) and unproduced goods below it (`buy` — auto-buy). The player overrides
 * with one click per good (flip), drag-and-drop across the line, or "Take all" /
 * "Buy all".
 *
 * Semantics (see `ProjectSourcingMode`): `buy` = the automation buys from the
 * best-ranked NPC sell offer (cheapest `priceVp`, nearest on price ties) and pays
 * `priceVp × qty` from the wallet — an NPC brings it. `take` = await locally
 * (self-haul) or bring it yourself with a player-authored import line (including
 * an NPC trade-stop line to choose the buying place); the automation never
 * auto-buys a `take` good, and any player line already covering the need
 * suppresses automated orders.
 */

css`
.project-sourcing {
	display: flex;
	flex-direction: column;
	gap: 0.4rem;
	font-size: 0.82rem;
}

.project-sourcing__actions {
	display: flex;
	gap: 0.4rem;
	flex-wrap: wrap;
}

.project-sourcing__group {
	display: flex;
	flex-direction: column;
	gap: 0.2rem;
}

.project-sourcing__group-title {
	font-weight: 650;
	color: var(--ak-text-muted);
	font-size: 0.72rem;
	text-transform: uppercase;
	letter-spacing: 0.04em;
}

.project-sourcing__zone {
	display: flex;
	flex-direction: column;
	gap: 0.2rem;
	padding: 0.25rem;
	border-radius: 0.4rem;
	border: 1px dashed var(--ak-border);
	min-height: 1.5rem;
}

.project-sourcing__zone--take {
	border-color: color-mix(in srgb, #22c55e 45%, var(--ak-border));
}

.project-sourcing__zone--buy {
	border-color: color-mix(in srgb, #d97706 45%, var(--ak-border));
}

.project-sourcing__divider {
	display: flex;
	align-items: center;
	gap: 0.5rem;
	color: var(--ak-text-muted);
	font-size: 0.72rem;
	padding: 0.15rem 0.35rem;
	border-radius: 0.3rem;
	background: color-mix(in srgb, var(--ak-surface-panel) 80%, transparent);
	cursor: ns-resize;
}

.project-sourcing__divider::before,
.project-sourcing__divider::after {
	content: '';
	flex: 1;
	height: 1px;
	background: var(--ak-border);
}

.project-sourcing__row {
	display: flex;
	align-items: center;
	gap: 0.4rem;
	padding: 0.25rem 0.4rem;
	border-radius: 0.3rem;
	border: 1px solid transparent;
}

/* Directional move cursor: a take row moves down (→ buy), a buy row moves up (→ take).
   Custom arrow cursors (native resize as fallback). */
.project-sourcing__row[data-mode='take'] {
	cursor:
		url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='24' height='24' viewBox='0 0 24 24' fill='none' stroke='%23d97706' stroke-width='2.5' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='M12 4v16m0 0l-6-6m6 6l6-6'/%3E%3C/svg%3E")
			12 12,
		s-resize;
}

.project-sourcing__row[data-mode='buy'] {
	cursor:
		url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='24' height='24' viewBox='0 0 24 24' fill='none' stroke='%2322c55e' stroke-width='2.5' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='M12 20V4m0 0L6 10m6-6l6 6'/%3E%3C/svg%3E")
			12 12,
		n-resize;
}

.project-sourcing__row:hover {
	background: color-mix(in srgb, var(--ak-accent, #2563eb) 8%, transparent);
}

.project-sourcing__row[data-dragging='true'] {
	opacity: 0.5;
	cursor: grabbing;
}

.project-sourcing__name {
	flex: 1;
}

.project-sourcing__hint {
	font-size: 0.72rem;
	color: var(--ak-text-muted);
	font-variant-numeric: tabular-nums;
}

.project-sourcing__empty {
	color: var(--ak-text-muted);
	font-size: 0.82rem;
	padding: 0.25rem 0.4rem;
}
`

const HINT_LABEL: Record<GoodAvailabilityKind, string> = {
	produced: '✓ produced',
	held: '~ in stock',
	unproduced: '— not produced',
}

/** Availability sort rank: produced (nearest) → held → unproduced. */
const AVAIL_RANK: Record<GoodAvailabilityKind, number> = {
	produced: 0,
	held: 1,
	unproduced: 2,
}

/** Centroid of a project's placed entries (the demand site for distance). */
function projectCentroid(project: Project): AxialCoord {
	if (project.entries.length === 0) return { q: 0, r: 0 }
	let q = 0
	let r = 0
	for (const entry of project.entries) {
		q += entry.coord[0]
		r += entry.coord[1]
	}
	return { q: Math.round(q / project.entries.length), r: Math.round(r / project.entries.length) }
}

interface ProjectSourcingEditorProps {
	game: Game
	project: Project
}

export default function ProjectSourcingEditor(props: ProjectSourcingEditorProps) {
	// Dragging state: the good currently being dragged across the line.
	const state = reactive({ dragging: undefined as GoodType | undefined })

	const billGoods = () => Object.keys(props.project.validationProgress.requiredGoods) as GoodType[]

	const anchor = () => projectCentroid(props.project)

	const availability = (good: GoodType) => measureGoodAvailability(props.game, good, anchor())

	const effectiveMode = (good: GoodType): ProjectSourcingMode =>
		props.project.sourcing[good] ?? (availability(good).kind === 'unproduced' ? 'buy' : 'take')

	const rows = () => {
		const list = billGoods().map((good) => ({
			good,
			avail: availability(good),
			mode: effectiveMode(good),
		}))
		list.sort(
			(a, b) =>
				AVAIL_RANK[a.avail.kind] - AVAIL_RANK[b.avail.kind] ||
				a.avail.distance - b.avail.distance ||
				a.good.localeCompare(b.good)
		)
		return list
	}

	const takeRows = () => rows().filter((row) => row.mode === 'take')
	const buyRows = () => rows().filter((row) => row.mode === 'buy')

	const setMode = (good: GoodType, mode: ProjectSourcingMode) => {
		props.game.projects.setSourcingMode(props.project, good, mode)
	}
	const flip = (good: GoodType) => setMode(good, effectiveMode(good) === 'take' ? 'buy' : 'take')

	const takeAll = () =>
		props.game.projects.setSourcing(
			props.project,
			Object.fromEntries(billGoods().map((good) => [good, 'take' as const]))
		)
	const buyAll = () =>
		props.game.projects.setSourcing(
			props.project,
			Object.fromEntries(billGoods().map((good) => [good, 'buy' as const]))
		)

	const sprite = (good: GoodType) =>
		sensoryGoods[good as keyof typeof sensoryGoods]?.sprites?.[0] || 'default'

	const readOnly = () => props.project.stage === 'archived'

	type Row = { good: GoodType; avail: GoodAvailability; mode: ProjectSourcingMode }

	const hint = (r: Row) =>
		`${HINT_LABEL[r.avail.kind]}${
			Number.isFinite(r.avail.distance) ? ` · ${r.avail.distance} hex` : ''
		}`

	const drop = (mode: ProjectSourcingMode) => {
		const good = state.dragging
		state.dragging = undefined
		if (!good || readOnly()) return
		setMode(good, mode)
	}

	const row = (r: Row) => {
		// A "take" row moves down (→ buy) on click; a "buy" row moves up (→ take).
		// The direction is conveyed by the row's custom cursor, not an inline icon.
		const movesToBuy = r.mode === 'take'
		return (
			<div
				class="project-sourcing__row"
				data-mode={r.mode}
				data-dragging={state.dragging === r.good ? 'true' : 'false'}
				draggable={!readOnly()}
				title={movesToBuy ? 'Move to "buy automatically"' : 'Move to "await locally"'}
				onDragStart={() => (state.dragging = r.good)}
				onDragEnd={() => (state.dragging = undefined)}
				onClick={() => flip(r.good)}
			>
				<EntityBadge game={props.game} sprite={sprite(r.good)} text={r.good} />
				<span class="project-sourcing__name">{r.good}</span>
				<span class="project-sourcing__hint">{hint(r)}</span>
			</div>
		)
	}

	return (
		<div class="project-sourcing">
			<div class="project-sourcing__actions">
				<Button disabled={readOnly()} onClick={takeAll}>
					Take all
				</Button>
				<Button disabled={readOnly()} onClick={buyAll}>
					Buy all
				</Button>
			</div>

			<div class="project-sourcing__group">
				<div class="project-sourcing__group-title">Await locally (take)</div>
				<div
					class="project-sourcing__zone project-sourcing__zone--take"
					onDragOver={(event: Event) => event.preventDefault()}
					onDrop={() => drop('take')}
				>
					<for each={takeRows()}>{row}</for>
					<div if={takeRows().length === 0} class="project-sourcing__empty">
						Nothing awaited locally.
					</div>
				</div>
			</div>

			<div
				class="project-sourcing__divider"
				title="Drag goods across this line"
				onDragOver={(event: Event) => event.preventDefault()}
				onDrop={() => drop('buy')}
			>
				buy automatically ↓
			</div>

			<div class="project-sourcing__group">
				<div class="project-sourcing__group-title">Buy automatically (buy)</div>
				<div
					class="project-sourcing__zone project-sourcing__zone--buy"
					onDragOver={(event: Event) => event.preventDefault()}
					onDrop={() => drop('buy')}
				>
					<for each={buyRows()}>{row}</for>
					<div if={buyRows().length === 0} class="project-sourcing__empty">
						Everything is awaited locally.
					</div>
				</div>
			</div>
		</div>
	)
}
