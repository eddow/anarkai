/**
 * EconomyAtlas — Cytoscape view over the `engine-rules` economy graph.
 *
 * Standalone (no game booted): the projection in `economy-graph.ts` produces
 * the model, this component owns the cytoscape lifecycle, layout, and the
 * three interactions requested: zoom-out summarisation (tag compounds),
 * variant expand/collapse, and neighbourhood spotlight.
 */
import cytoscape from 'cytoscape'
import elk from 'cytoscape-elk'
import { buildEconomyGraph } from './economy-graph'
import { nodeIcon } from './icons'

cytoscape.use(elk)

const STYLES: cytoscape.StylesheetJson = [
	{
		selector: 'node',
		style: {
			label: 'data(label)',
			'font-size': 10,
			'text-valign': 'bottom',
			'text-margin-y': 4,
			color: '#c8d0e0',
			'text-outline-color': '#14181f',
			'text-outline-width': 2,
			width: 22,
			height: 22,
			'border-width': 1.5,
			'border-color': '#0b0d12',
		},
	},
	{ selector: 'node[kind="good"]', style: { 'background-color': '#4f9dd9', shape: 'ellipse' } },
	{
		selector: 'node[standaloneIcon]',
		style: {
			'background-image': 'data(icon)',
			'background-fit': 'contain',
			'background-clip': 'none',
			width: 30,
			height: 30,
		},
	},
	{
		selector: 'node[kind="deposit"][iconW]',
		style: {
			'background-image': 'data(icon)',
			'background-fit': 'none',
			'background-clip': 'node',
			'background-repeat': 'no-repeat',
			'background-width': 'data(bgW)',
			'background-height': 'data(bgH)',
			'background-position-x': 'data(bgPosX)',
			'background-position-y': 'data(bgPosY)',
			width: 'data(iconW)',
			height: 'data(iconH)',
		},
	},
	{
		selector: 'node[violated]',
		style: {
			'background-color': '#e0483e',
			'border-color': '#ffb3ad',
			'border-width': 3,
			'overlay-color': '#e0483e',
			'overlay-opacity': 0.25,
			'overlay-padding': 6,
		},
	},
	{
		selector: 'node[kind="building"]',
		style: { 'background-color': '#d9854f', shape: 'round-rectangle' },
	},
	{ selector: 'node[kind="shop"]', style: { 'background-color': '#7ed98a', shape: 'diamond' } },
	{ selector: 'node[kind="deposit"]', style: { 'background-color': '#9b8bd9', shape: 'hexagon' } },
	{
		selector: 'node[kind="tag"]',
		style: {
			label: 'data(label)',
			'background-color': '#1c2330',
			'background-opacity': 0.35,
			'border-color': '#33405a',
			'border-style': 'dashed',
			'text-valign': 'top',
			'text-margin-y': -6,
			'font-size': 12,
			padding: '14px',
			shape: 'round-rectangle',
		},
	},
	{
		selector: 'node:parent',
		style: {
			'background-opacity': 0.15,
			'text-valign': 'top',
			'text-margin-y': -6,
			padding: '12px',
			shape: 'round-rectangle',
		},
	},
	{
		selector: 'edge',
		style: {
			width: 1.4,
			'line-color': '#3a4763',
			'target-arrow-color': '#3a4763',
			'target-arrow-shape': 'triangle',
			'arrow-scale': 0.8,
			'curve-style': 'bezier',
		},
	},
	{
		selector: 'edge[kind="stocks"]',
		style: {
			'line-color': '#7ed98a',
			'target-arrow-color': '#7ed98a',
			'line-style': 'dotted',
			opacity: 0.6,
		},
	},
	{
		selector: 'edge[kind="plants"], edge[kind="harvests"]',
		style: { 'line-color': '#9b8bd9', 'target-arrow-color': '#9b8bd9' },
	},
	{ selector: '.dim', style: { opacity: 0.08 } },
	{ selector: '.spot', style: { opacity: 1 } },
	{ selector: 'node:selected', style: { 'border-color': '#ffd166', 'border-width': 3 } },
]

export default function EconomyAtlas(props: { onErrors?: (errors: readonly string[]) => void }) {
	const mount = (host: HTMLElement) => {
		const graph = buildEconomyGraph()
		props.onErrors?.(graph.errors)
		const els: cytoscape.ElementsDefinition = {
			nodes: graph.nodes.map((n) => {
				const icon = nodeIcon(n.kind, n.id)
				return {
					data: {
						id: n.id,
						label: n.label,
						kind: n.kind,
						...(n.data?.violated ? { violated: true } : {}),
						...(n.parent ? { parent: n.parent } : {}),
						...(icon ? { icon: icon.image } : {}),
						...(icon?.standalone ? { standaloneIcon: true } : {}),
						...(icon?.width
							? {
									iconW: icon.width,
									iconH: icon.height,
									bgW: icon.bgWidth,
									bgH: icon.bgHeight,
									bgPosX: icon.bgPosX,
									bgPosY: icon.bgPosY,
								}
							: {}),
					},
				}
			}),
			edges: graph.edges.map((e) => ({
				data: {
					id: e.id,
					source: e.source,
					target: e.target,
					kind: e.kind,
				},
			})),
		}

		const cy = cytoscape({
			container: host,
			elements: els,
			style: STYLES,
			// `preset` = keep positions, do NOT run the default `grid` layout (it
			// crashes on compound/parent nodes). We run ELK explicitly after.
			layout: { name: 'preset' },
			// Default wheel sensitivity (1). IMPORTANT: cytoscape gates wheel-zoom
			// on `userPanningEnabled()` AND its wheel handler depends on a
			// `containerBB` cache that is NaN when the flex container is 0-sized at
			// init. So we disable cytoscape's built-in wheel zoom and implement our
			// own (see the wheel handler below), which computes renderedPosition
			// directly from getBoundingClientRect().
			userZoomingEnabled: false,
			boxSelectionEnabled: false,
			minZoom: 0.1,
			maxZoom: 3,
		})
		if (import.meta.env.DEV) (window as unknown as { __cy: cytoscape.Core }).__cy = cy

		// The container is 0-sized when cytoscape inits (flex layout hasn't
		// settled), which caches a NaN `containerBB` (scale = 0/0) and breaks
		// wheel zoom + node hit-testing (`projectIntoViewport` bails on NaN).
		// Re-measure once the container has a real size (and on any resize).
		const resizeObserver = new ResizeObserver(() => {
			if (!cy.destroyed()) cy.resize()
		})
		resizeObserver.observe(host)

		// Middle-mouse-button panning. Cytoscape only handles the left button
		// internally (its `mousedown` event never fires for the middle button), so
		// we listen on the DOM element directly and drive `cy.pan()` ourselves,
		// leaving left/right free for tap interactions.
		let panning = false
		let lastX = 0
		let lastY = 0
		const onMouseDown = (evt: MouseEvent) => {
			if (evt.button !== 1) return
			evt.preventDefault() // block the browser's middle-click autoscroll
			panning = true
			lastX = evt.clientX
			lastY = evt.clientY
			host.style.cursor = 'grabbing'
		}
		const onMouseMove = (evt: MouseEvent) => {
			if (!panning) return
			const dx = evt.clientX - lastX
			const dy = evt.clientY - lastY
			lastX = evt.clientX
			lastY = evt.clientY
			const pan = cy.pan()
			cy.pan({ x: pan.x + dx, y: pan.y + dy })
		}
		const onMouseUp = () => {
			if (!panning) return
			panning = false
			host.style.cursor = 'default'
		}
		host.addEventListener('mousedown', onMouseDown)
		window.addEventListener('mousemove', onMouseMove)
		window.addEventListener('mouseup', onMouseUp)

		// Manual wheel zoom. cytoscape's built-in wheel handler is disabled
		// (`userZoomingEnabled: false`) because its `projectIntoViewport` bails on
		// a NaN `containerBB` cache (the flex container is 0-sized at init). We
		// compute the zoom-around-cursor math directly from the container rect.
		const onWheel = (evt: WheelEvent) => {
			evt.preventDefault()
			const rect = host.getBoundingClientRect()
			const zoom = cy.zoom()
			const factor = 2 ** (-evt.deltaY / 400) // deltaY<0 (up) = zoom in
			const level = Math.min(cy.maxZoom(), Math.max(cy.minZoom(), zoom * factor))
			cy.zoom({
				level,
				renderedPosition: { x: evt.clientX - rect.left, y: evt.clientY - rect.top },
			})
		}
		host.addEventListener('wheel', onWheel, { passive: false })

		// Spotlight state — shared by the background-click blocker and tap handlers.
		let spotlit: string | null = null
		const clearSpot = () => {
			cy.elements().removeClass('dim spot')
			spotlit = null
		}

		// Block LEFT-drag panning on the background so left stays free for node
		// interactions (tap = spotlight, drag = move node). cytoscape starts a
		// background pan on a left mousedown over empty space; stop it before
		// cytoscape's own (bubble-phase) mousedown handler sees it. Middle button
		// pans instead.
		const isOverNode = (clientX: number, clientY: number): boolean => {
			const rect = host.getBoundingClientRect()
			const x = clientX - rect.left
			const y = clientY - rect.top
			for (const node of cy.nodes()) {
				if (!node.visible()) continue
				const bb = node.renderedBoundingBox({ includeLabels: false })
				if (x >= bb.x1 && x <= bb.x2 && y >= bb.y1 && y <= bb.y2) return true
			}
			return false
		}
		const onBackgroundLeftDown = (evt: MouseEvent) => {
			if (evt.button !== 0) return
			if (isOverNode(evt.clientX, evt.clientY)) return
			evt.stopImmediatePropagation()
			evt.preventDefault()
			clearSpot()
		}
		host.addEventListener('mousedown', onBackgroundLeftDown, true)

		const runLayout = (fit = true) => {
			// Defer out of the current mutts batch: cytoscape-elk's layout runs a
			// batch whose end would otherwise land inside a closed mutts batch and
			// crash (`null.notify` in endBatch). setTimeout(0) escapes it.
			setTimeout(() => {
				if (cy.destroyed()) return
				// Re-measure now that the container has a real size — this fixes the
				// NaN `containerBB` cached at init (scale = 0/0), which breaks wheel
				// zoom and node hit-testing.
				cy.resize()
				const layout = cy.layout({
					name: 'elk',
					elk: {
						algorithm: 'layered',
						'elk.direction': 'RIGHT',
						'elk.layered.spacing.nodeNodeBetweenLayers': '60',
						'elk.spacing.nodeNode': '24',
						'elk.hierarchyHandling': 'INCLUDE_CHILDREN',
					},
				} as cytoscape.LayoutOptions)
				layout.promiseOn('layoutstop').then(() => {
					if (!cy.destroyed() && fit) cy.fit(undefined, 40)
				})
				layout.run()
			}, 0)
		}
		runLayout()

		// Spotlight: tap a node → its neighbourhood stays lit, the rest dims.
		cy.on('tap', 'node', (evt) => {
			const node = evt.target as cytoscape.NodeSingular
			if (spotlit === node.id()) {
				clearSpot()
				return
			}
			spotlit = node.id()
			cy.elements().addClass('dim').removeClass('spot')
			node.closedNeighborhood().removeClass('dim').addClass('spot')
			node.ancestors().removeClass('dim')
		})
		cy.on('tap', (evt) => {
			if (evt.target === cy) clearSpot()
		})

		// Collapse a tag group on double-tap (cytoscape has no native `dbltap`,
		// so track our own timing on the tag parent nodes).
		let lastGroupTap: { id: string; at: number } | null = null
		cy.on('tap', 'node[kind="tag"]', (evt) => {
			const group = evt.target as cytoscape.NodeSingular
			const now = Date.now()
			const isDouble = lastGroupTap?.id === group.id() && now - lastGroupTap.at < 350
			lastGroupTap = { id: group.id(), at: now }
			if (!isDouble) return
			const collapsed = group.data('collapsed') === true
			group.children().style('display', collapsed ? 'element' : 'none')
			group.data('collapsed', !collapsed)
			runLayout(false)
		})

		return () => {
			resizeObserver.disconnect()
			host.removeEventListener('mousedown', onMouseDown)
			host.removeEventListener('mousedown', onBackgroundLeftDown, true)
			host.removeEventListener('wheel', onWheel)
			window.removeEventListener('mousemove', onMouseMove)
			window.removeEventListener('mouseup', onMouseUp)
			cy.destroy()
		}
	}

	return <div class="economy-atlas" use={mount} />
}
