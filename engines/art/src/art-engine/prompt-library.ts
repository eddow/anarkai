import type { ArtPromptProposal } from "./types";

const PROMPTS: ArtPromptProposal[] = [
	{
		id: "settlement-map",
		title: "Settlement Map",
		prompt:
			"top-down illustrated map of a small cooperative settlement, timber workshops, gardens, footpaths, river bend, clear readable shapes, warm daylight, board game art",
	},
	{
		id: "freight-yard",
		title: "Freight Yard",
		prompt:
			"compact fantasy freight yard with hand carts, labeled crates, tiny workers, modular tile layout, crisp isometric perspective, cozy industrial atmosphere",
	},
	{
		id: "character-study",
		title: "Worker Portrait",
		prompt:
			"stylized portrait of a thoughtful workshop engineer, practical clothes, soft natural light, expressive face, painterly game concept art",
	},
	{
		id: "terrain-tile",
		title: "Terrain Tile",
		prompt:
			"single hex terrain tile, lush meadow with a narrow stream and small stones, clean game asset, centered composition, transparent-feeling background",
	},
];

export function listPromptProposals(): readonly ArtPromptProposal[] {
	return PROMPTS;
}

export function randomPromptProposal(): ArtPromptProposal {
	return PROMPTS[Math.floor(Math.random() * PROMPTS.length)] ?? PROMPTS[0];
}
