export type AnarkaiImageIcon = {
	kind: 'image'
	src: string
	alt?: string
}

export type AnarkaiSvgIcon = {
	kind: 'svg'
	svg: string
	alt?: string
}

export type AnarkaiGlyphIcon = {
	kind: 'glyph'
	glyph: string
}

export type AnarkaiNodeIcon = {
	kind: 'node'
	node: JSX.Element
}

export type AnarkaiIconSource =
	| string
	| JSX.Element
	| AnarkaiGlyphIcon
	| AnarkaiImageIcon
	| AnarkaiSvgIcon
	| AnarkaiNodeIcon
	| false
	| null
	| undefined

export type RenderAnarkaiIconOptions = {
	class?: string
	size?: number | string
	label?: string
}

const formatSize = (size: number | string | undefined) =>
	size === undefined ? undefined : typeof size === 'number' ? `${size}px` : size

const svgToDataUri = (svg: string) => `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`

const isInlineSvg = (icon: string) => icon.trimStart().startsWith('<svg')

const isClassTokenString = (icon: string) =>
	/^(?:[A-Za-z_][\w:-]*)(?:\s+[A-Za-z_][\w:-]*)*$/.test(icon) &&
	(/[\s-]/.test(icon) ||
		/^[a-z]+[A-Z]/.test(icon) ||
		icon.startsWith('glyf') ||
		icon.startsWith('mdi') ||
		icon.startsWith('tabler'))

const isImageIcon = (icon: AnarkaiIconSource): icon is AnarkaiImageIcon =>
	typeof icon === 'object' && icon !== null && 'kind' in icon && icon.kind === 'image'

const isSvgIcon = (icon: AnarkaiIconSource): icon is AnarkaiSvgIcon =>
	typeof icon === 'object' && icon !== null && 'kind' in icon && icon.kind === 'svg'

const isGlyphIcon = (icon: AnarkaiIconSource): icon is AnarkaiGlyphIcon =>
	typeof icon === 'object' && icon !== null && 'kind' in icon && icon.kind === 'glyph'

const isNodeIcon = (icon: AnarkaiIconSource): icon is AnarkaiNodeIcon =>
	typeof icon === 'object' && icon !== null && 'kind' in icon && icon.kind === 'node'

const getAccessibleIconAttributes = (label: string | undefined) =>
	label
		? {
				role: 'img' as const,
				'aria-label': label,
			}
		: {
				'aria-hidden': true,
			}

export function renderAnarkaiIcon(
	icon: AnarkaiIconSource,
	options: RenderAnarkaiIconOptions = {}
): JSX.Element | null {
	if (!icon) return null

	const size = formatSize(options.size)
	const style = size ? { '--ak-icon-size': size } : undefined

	if (typeof icon === 'string') {
		if (isInlineSvg(icon)) {
			return (
				<span class={['ak-icon', 'ak-icon--svg', options.class]} style={style}>
					<img alt={options.label ?? ''} src={svgToDataUri(icon)} />
				</span>
			)
		}

		if (isClassTokenString(icon)) {
			return (
				<span
					{...getAccessibleIconAttributes(options.label)}
					class={['ak-icon', 'ak-icon--glyph', options.class, icon]}
					style={style}
				/>
			)
		}

		return (
			<span
				{...getAccessibleIconAttributes(options.label)}
				class={['ak-icon', 'ak-icon--glyph', 'ak-icon--literal', options.class]}
				style={style}
			>
				{icon}
			</span>
		)
	}

	if (isImageIcon(icon)) {
		return (
			<span class={['ak-icon', 'ak-icon--image', options.class]} style={style}>
				<img alt={options.label ?? icon.alt ?? ''} src={icon.src} />
			</span>
		)
	}

	if (isSvgIcon(icon)) {
		return (
			<span class={['ak-icon', 'ak-icon--svg', options.class]} style={style}>
				<img alt={options.label ?? icon.alt ?? ''} src={svgToDataUri(icon.svg)} />
			</span>
		)
	}

	if (isGlyphIcon(icon)) {
		return (
			<span
				{...getAccessibleIconAttributes(options.label)}
				class={['ak-icon', 'ak-icon--glyph', 'ak-icon--literal', options.class]}
				style={style}
			>
				{icon.glyph}
			</span>
		)
	}

	if (isNodeIcon(icon)) {
		return (
			<span
				{...getAccessibleIconAttributes(options.label)}
				class={['ak-icon', 'ak-icon--node', options.class]}
				style={style}
			>
				{icon.node}
			</span>
		)
	}

	return (
		<span
			{...getAccessibleIconAttributes(options.label)}
			class={['ak-icon', 'ak-icon--node', options.class]}
			style={style}
		>
			{icon}
		</span>
	)
}
