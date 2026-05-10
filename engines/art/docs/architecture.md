# Engine Art Architecture

`engines/art` is a standalone Sursaut client application for proposing prompts, generating images, displaying the result, and downloading it locally.

## Shape

- `src/App.tsx` owns the first client workflow: prompt editing, provider selection, request creation, preview state, and download action.
- `src/art-engine/types.ts` defines the app contracts: prompt proposals, generation requests, generated image metadata, and provider adapters.
- `src/art-engine/prompt-library.ts` is the initial local prompt proposer. It is deliberately synchronous so the first version stays client-only.
- `src/art-engine/pollinations-provider.ts` converts an `ArtGenerationRequest` into a Pollinations image URL.
- `src/art-engine/session.ts` creates immutable generation records from UI input and the selected provider.
- `src/art-engine/download.ts` fetches the generated image and saves it through a browser object URL.

## Provider Boundary

Providers expose one method:

```ts
generateUrl(request: ArtGenerationRequest): string
```

That keeps the first Pollinations integration simple while leaving room for providers that later need POST requests, queued jobs, local caches, or account-backed auth. The UI talks to `ArtGenerationRequest` and `ArtGeneration`, not to Pollinations parameters directly.

## Pollinations Assumptions

The first provider targets `https://gen.pollinations.ai/image/{prompt}` with `model`, `size`, optional `seed`, and optional publishable `pk_` key query parameters. Secret `sk_` keys are intentionally not supported in the client path.

## Open Decisions

- Prompt proposal source: local curated list, LLM text endpoint, project-aware asset brief, or a mix.
- Whether generation should be URL-only, blob-backed immediately, or cached in IndexedDB.
- Final metadata model for galleries, history, favorites, and reproducible seeds.
- Whether `engines/art` remains a standalone app only or also exports reusable art tooling for `apps/browser`.
