import { getBrowserPalette } from '@app/palette/browser-palette'
import type {
	Palette,
	PaletteItem,
	PaletteRegion,
	PaletteSchema,
	PaletteScope,
	PaletteTool,
	PaletteToolbarItem,
} from '@sursaut/ui/palette'
import { palettes, renderPaletteConfigurator } from '@sursaut/ui/palette'
import { effect, unwrap } from 'mutts'
import type { Game } from 'ssh/game'

/** Stable Dockview panel id for the floating toolbar-item inspector. */
export const PALETTE_INSPECTOR_DOCK_PANEL_ID = 'palette.toolbar-inspector'

export type BrowserPaletteInspectorProps = {
	readonly clockGame?: Game
}

function inspectorPrimaryLabel(item: PaletteToolbarItem): string {
	const c = item.config
	if (c && typeof c === 'object' && 'label' in c) {
		const label = (c as { label?: string }).label
		if (typeof label === 'string' && label.length > 0) return label
	}
	return item.tool ?? item.editor
}

function inspectionEntryForPalette(palette: Palette<PaletteSchema>) {
	const entry = palettes.inspecting
	if (unwrap(entry?.palette) !== unwrap(palette)) return undefined
	return entry
}

export function BrowserPaletteInspectorBody<TSchema extends PaletteSchema>(props: {
	readonly palette: Palette<TSchema>
	readonly item: PaletteItem<TSchema>
	readonly tool: PaletteTool<TSchema['tools']> | undefined
	readonly region: PaletteRegion | undefined
	readonly clockGame?: Game
}) {
	/** Deferred reads — body runs once; configurator must be re-evaluated when `item` / `tool` change. */
	const fields = {
		get scope(): PaletteScope<TSchema> {
			return {
				palette: props.palette,
				region: props.region,
				...(props.clockGame !== undefined ? { clockGame: props.clockGame } : {}),
			}
		},
		get configurator() {
			return renderPaletteConfigurator(props.palette, props.item, props.tool, this.scope)
		},
		get titleLabel() {
			return inspectorPrimaryLabel(props.item)
		},
		get toolId() {
			return typeof props.item.tool === 'string' ? props.item.tool : '— (editor-only)'
		},
		get editorId() {
			return props.item.editor
		},
		get regionSuffix() {
			return props.region !== undefined ? ` · ${props.region}` : ''
		},
	}
	return (
		<div class="ak-palette-inspector">
			<div class="ak-palette-inspector__head">
				<div class="ak-palette-inspector__identity">
					<strong class="ak-palette-inspector__title">{fields.titleLabel}</strong>
					<div class="ak-palette-inspector__meta">
						<span class="ak-palette-inspector__meta-line">
							Tool <code>{fields.toolId}</code> · editor <code>{fields.editorId}</code>
							{fields.regionSuffix}
						</span>
					</div>
				</div>
			</div>
			<div if={fields.configurator != null} class="ak-palette-inspector__config">
				{fields.configurator}
			</div>
			<p else class="ak-palette-inspector__none">
				No configuration panel for this item.
			</p>
		</div>
	)
}

/**
 * Inspector UI for the floating Dockview panel (mount only while palette edit mode is on).
 * Uses getters so `palettes.inspecting` updates reactively (Sursaut component body rules).
 */
export function PaletteToolbarInspectorPanel(props: BrowserPaletteInspectorProps) {
	const { palette } = getBrowserPalette()
	const view = {
		get entry() {
			return inspectionEntryForPalette(palette)
		},
		get inspectingItem() {
			return this.entry?.item
		},
		get region() {
			return this.entry?.region
		},
	}

	effect`browser-palette-inspector:escape`(() => {
		if (!view.inspectingItem) return
		const onKey = (event: KeyboardEvent) => {
			if (event.defaultPrevented || event.key !== 'Escape') return
			if (!view.inspectingItem) return
			delete palettes.inspecting
			event.preventDefault()
		}
		window.addEventListener('keydown', onKey)
		return () => window.removeEventListener('keydown', onKey)
	})

	/**
	 * Configurator + labels must be read through this object in the panel return so they track
	 * `palettes.inspecting` when the selected item changes (child props alone are not enough for
	 * SurSaut’s single body run + Dockview host lifecycle).
	 */
	const dock = {
		get item() {
			return view.inspectingItem
		},
		get scope(): PaletteScope<PaletteSchema> | undefined {
			const item = this.item
			if (!item) return undefined
			return {
				palette,
				region: view.region,
				...(props.clockGame !== undefined ? { clockGame: props.clockGame } : {}),
			}
		},
		get tool() {
			const item = this.item
			if (!item || typeof item.tool !== 'string') return undefined
			return palette.tool(item.tool)
		},
		get configurator() {
			const item = this.item
			const scope = this.scope
			if (!item || !scope) return undefined
			return renderPaletteConfigurator(palette, item, this.tool, scope)
		},
		get titleLabel() {
			const item = this.item
			return item ? inspectorPrimaryLabel(item) : ''
		},
		get toolId() {
			const item = this.item
			return item && typeof item.tool === 'string' ? item.tool : '— (editor-only)'
		},
		get editorId() {
			return this.item?.editor ?? ''
		},
		get regionSuffix() {
			return view.region !== undefined ? ` · ${view.region}` : ''
		},
	}

	return (
		<div class="ak-palette-inspector-widget">
			<div
				if={view.inspectingItem === undefined}
				class="ak-palette-inspector ak-palette-inspector--hint"
			>
				<p class="ak-palette-inspector__hint">
					Select a toolbar item (strip beside the control in edit mode) to inspect and configure it.
					Press Escape to clear the selection.
				</p>
			</div>
			<div if={view.inspectingItem !== undefined} class="ak-palette-inspector">
				<div class="ak-palette-inspector__head">
					<div class="ak-palette-inspector__identity">
						<strong class="ak-palette-inspector__title">{dock.titleLabel}</strong>
						<div class="ak-palette-inspector__meta">
							<span class="ak-palette-inspector__meta-line">
								Tool <code>{dock.toolId}</code> · editor <code>{dock.editorId}</code>
								{dock.regionSuffix}
							</span>
						</div>
					</div>
				</div>
				<div if={dock.configurator != null} class="ak-palette-inspector__config">
					{dock.configurator}
				</div>
				<p else class="ak-palette-inspector__none">
					No configuration panel for this item.
				</p>
			</div>
		</div>
	)
}
