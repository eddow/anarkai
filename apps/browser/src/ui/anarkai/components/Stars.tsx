import { extend } from '@sursaut/core'
import { arranged } from '@sursaut/ui'
import {
	type StarsProps as BaseStarsProps,
	type StarItemState,
	starsModel,
} from '@sursaut/ui/models'

export type StarsProps = BaseStarsProps

const STAR_GLYPHS: Record<string, string> = {
	'star-filled': '★',
	'star-outline': '☆',
}

function starGlyph(iconName: string): string {
	return STAR_GLYPHS[iconName] ?? iconName
}

function StarItem(props: {
	item: StarItemState
	size: string
	readonly?: boolean
	selectedZero?: () => boolean
}) {
	return (
		<span
			{...(props.item.el ?? {})}
			class={[
				'ak-stars__item',
				`ak-stars__item--${props.item.status}`,
				props.selectedZero?.() ? 'is-selected-zero' : undefined,
				props.item.el?.class,
			]}
			style={{
				...(typeof props.item.el?.style === 'object' ? props.item.el.style : {}),
				fontSize: props.size,
			}}
			aria-hidden="true"
			data-readonly={props.readonly ? 'true' : undefined}
		>
			{starGlyph(props.item.iconName)}
		</span>
	)
}

export const Stars = (props: StarsProps, scope: Record<string, unknown>) => {
	const layout = arranged(scope, props)
	const model = starsModel(extend(props, {
		get orientation() {
			return layout.orientation
		},
	}))

	return (
		<div
			{...model.container}
			class={['ak-stars', layout.class]}
			data-orientation={layout.orientation ?? 'horizontal'}
			data-readonly={model.readonly ? 'true' : undefined}
			style={{
				fontSize: model.size,
			}}
		>
			<StarItem
				if={model.hasZeroElement}
				item={model.zeroItem}
				size={model.size}
				readonly={model.readonly}
				selectedZero={() => !Array.isArray(props.value) && props.value === 0}
			/>
			<for each={model.starItems}>
				{(item: StarItemState) => (
					<StarItem item={item} size={model.size} readonly={model.readonly} />
				)}
			</for>
		</div>
	)
}
