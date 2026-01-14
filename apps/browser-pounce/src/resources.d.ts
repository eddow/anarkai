declare namespace Ssh {
	type SpriteDefinition = string
	type Sprite = string

	interface DepositDefinition {
		sprites?: Sprite[]
	}

	interface AlveolusDefinition {
		icon?: Sprite
		sprites?: Sprite[]
	}

	interface GoodsDefinition {
		icon?: Sprite
		sprites?: Sprite[]
	}

	interface VehicleDefinition {
		sprites?: Sprite[]
	}
}
