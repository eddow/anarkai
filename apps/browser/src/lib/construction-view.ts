import type {
	ConstructionBlockingReason,
	ConstructionPhase,
	ConstructionSiteView,
} from 'ssh/construction'

export interface ConstructionTranslatorShape {
	construction?: {
		section?: string
		materials?: string
		workProgress?: string
		phases?: Partial<Record<ConstructionPhase, string>>
		blocking?: Partial<Record<ConstructionBlockingReason, string>>
	}
}

export interface ConstructionViewModel {
	phaseLabel: string
	blockingLabels: string[]
	workLine: string
	applied: number
	total: number
	/** Human-readable final target, e.g. "pile.wood.extra" or "pile" for root-only. */
	targetDisplay: string
}

const toDisplayText = (value: unknown, fallback = ''): string => {
	switch (typeof value) {
		case 'string':
			return value
		case 'number':
		case 'boolean':
			return `${value}`
		default:
			return fallback
	}
}

export function buildConstructionViewModel(
	view: ConstructionSiteView,
	translator?: ConstructionTranslatorShape
): ConstructionViewModel {
	const applied = view.constructionWorkSecondsApplied ?? 0
	const total = view.constructionTotalSeconds ?? 0
	const workTemplate = translator?.construction?.workProgress
	const target = view.variant ? `${view.target ?? ''}.${view.variant}` : (view.target ?? '')
	return {
		phaseLabel: toDisplayText(translator?.construction?.phases?.[view.phase], view.phase),
		blockingLabels: view.blockingReasons.map((reason) =>
			toDisplayText(translator?.construction?.blocking?.[reason], reason)
		),
		workLine:
			typeof workTemplate === 'string' && total > 0
				? workTemplate.replace('{applied}', String(applied)).replace('{total}', String(total))
				: total > 0
					? `Work: ${applied}s / ${total}s`
					: '',
		applied,
		total,
		targetDisplay: target,
	}
}
