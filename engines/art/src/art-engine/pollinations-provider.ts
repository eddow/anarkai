import type { ArtGenerationRequest, ArtProvider, ArtProviderContext } from "./types";

const DEFAULT_BASE_URL = "https://gen.pollinations.ai";
const DEFAULT_MODEL = "flux";

export interface PollinationsProviderOptions {
	readonly baseUrl?: string;
	readonly apiKey?: string;
}

export function createPollinationsProvider(
	options: PollinationsProviderOptions = {},
): ArtProvider {
	const baseUrl = options.baseUrl ?? DEFAULT_BASE_URL;

	return {
		id: "pollinations",
		label: "Pollinations",
		generateUrl(request: ArtGenerationRequest, context?: ArtProviderContext) {
			const url = new URL(`/image/${encodeURIComponent(request.prompt)}`, baseUrl);
			url.searchParams.set("model", request.model ?? DEFAULT_MODEL);
			url.searchParams.set("size", `${request.size.width}x${request.size.height}`);
			if (typeof request.seed === "number") {
				url.searchParams.set("seed", String(request.seed));
			}
			const apiKey = context?.apiKey ?? options.apiKey;
			if (apiKey) {
				url.searchParams.set("key", apiKey);
			}
			return url.toString();
		},
	};
}
