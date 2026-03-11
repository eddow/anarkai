type NamedPixiObject = {
	name: string
}

export function setPixiName<T extends NamedPixiObject>(displayObject: T, name: string): T {
	displayObject.name = name
	return displayObject
}

export function scopedPixiName(scope: string, part: string): string {
	return `${scope}/${part}`
}
