import { mkdir, writeFile } from 'node:fs/promises'
import { extname, resolve } from 'node:path'
import { parseArgs } from 'node:util'
import { createPollinationsProvider } from './art-engine/pollinations-provider'
import { listPromptProposals, randomPromptProposal } from './art-engine/prompt-library'
import { createArtGeneration } from './art-engine/session'
import type { ArtGenerationRequest, ArtProvider } from './art-engine/types'

const DEFAULT_SIZE = { width: 1024, height: 1024 }

const HELP = `Anarkai Art CLI — generate an image through the art engine.

Usage:
  art [prompt] [options]
  art --propose [options]

Options:
  -p, --prompt <text>   Image prompt. If omitted, the first positional argument is used.
      --propose         Pick a random curated prompt proposal.
      --list            List curated prompt proposals and exit.
      --provider <id>   Provider id (default: pollinations).
      --model <id>      Model id (default: flux).
  -s, --size <WxH>      Image size, e.g. 1024x1024 (default: 1024x1024).
      --seed <number>   Deterministic seed.
  -o, --out <dir>       Output directory (default: current directory).
      --name <file>     Output filename (default: auto-generated slug).
  -k, --api-key <key>   Pollinations API key (also read from POLLINATIONS_API_KEY).
      --json            Emit a single JSON object with the result.
  -h, --help            Show this help.

Examples:
  art "a cozy river settlement" --size 1344x768 --out ./out --json
  art --propose --seed 42 -o ./assets
  POLLINATIONS_API_KEY=pk_xxx art "freight yard"
`

interface ParsedOptions {
	prompt?: string
	propose: boolean
	list: boolean
	provider?: string
	model?: string
	size?: string
	seed?: string
	out?: string
	name?: string
	json: boolean
	apiKey?: string
	help: boolean
}

function parseSize(value: string): { width: number; height: number } {
	const match = /^(\d+)x(\d+)$/i.exec(value.trim())
	if (!match) {
		throw new Error(`Invalid size "${value}". Expected WxH, e.g. 1024x1024.`)
	}
	const width = Number(match[1])
	const height = Number(match[2])
	if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0) {
		throw new Error(`Invalid size "${value}". Dimensions must be positive integers.`)
	}
	return { width, height }
}

function parseOptions(argv: string[]): { options: ParsedOptions; positionals: string[] } {
	const { values, positionals } = parseArgs({
		args: argv,
		options: {
			prompt: { type: 'string', short: 'p' },
			propose: { type: 'boolean' },
			list: { type: 'boolean' },
			provider: { type: 'string' },
			model: { type: 'string' },
			size: { type: 'string', short: 's' },
			seed: { type: 'string' },
			out: { type: 'string', short: 'o' },
			name: { type: 'string' },
			json: { type: 'boolean' },
			'api-key': { type: 'string', short: 'k' },
			help: { type: 'boolean', short: 'h' },
		},
		allowPositionals: true,
		strict: true,
	})

	const asString = (value: string | boolean | undefined): string | undefined =>
		typeof value === 'string' ? value : undefined

	return {
		options: {
			prompt: asString(values.prompt),
			propose: values.propose === true,
			list: values.list === true,
			provider: asString(values.provider),
			model: asString(values.model),
			size: asString(values.size),
			seed: asString(values.seed),
			out: asString(values.out),
			name: asString(values.name),
			json: values.json === true,
			apiKey: asString(values['api-key']),
			help: values.help === true,
		},
		positionals,
	}
}

function ensurePngName(name: string): string {
	return extname(name) ? name : `${name}.png`
}

async function saveImage(imageUrl: string, outPath: string): Promise<void> {
	const response = await fetch(imageUrl)
	if (!response.ok) {
		throw new Error(`Download failed with ${response.status} ${response.statusText}: ${imageUrl}`)
	}
	const buffer = Buffer.from(await response.arrayBuffer())
	await writeFile(outPath, buffer)
}

async function main(): Promise<number> {
	const argv = process.argv.slice(2)
	const { options, positionals } = parseOptions(argv)

	if (options.help) {
		process.stdout.write(HELP)
		return 0
	}

	if (options.list) {
		for (const proposal of listPromptProposals()) {
			process.stdout.write(`${proposal.title}\t${proposal.prompt}\n`)
		}
		return 0
	}

	let prompt = options.prompt?.trim() || positionals[0]?.trim()
	let proposedTitle: string | undefined

	if (!prompt && options.propose) {
		const proposal = randomPromptProposal()
		prompt = proposal.prompt
		proposedTitle = proposal.title
	}

	if (!prompt) {
		process.stderr.write('Provide a prompt via --prompt, a positional argument, or --propose.\n')
		return 1
	}

	const size = options.size ? parseSize(options.size) : DEFAULT_SIZE

	let seed: number | undefined
	if (options.seed !== undefined) {
		const parsed = Number(options.seed)
		if (!Number.isInteger(parsed) || parsed < 0) {
			process.stderr.write(`Invalid seed "${options.seed}". Seed must be a non-negative integer.\n`)
			return 1
		}
		seed = parsed
	}

	const providerId = options.provider ?? 'pollinations'
	const apiKey = options.apiKey ?? process.env.POLLINATIONS_API_KEY ?? ''

	const providers: readonly ArtProvider[] = [createPollinationsProvider({ apiKey })]

	const request: ArtGenerationRequest = {
		prompt,
		providerId,
		model: options.model?.trim() || undefined,
		size,
		seed,
	}

	const generation = createArtGeneration(request, providers, { apiKey: apiKey || undefined })

	const outDir = resolve(options.out ?? process.cwd())
	await mkdir(outDir, { recursive: true })
	const outPath = resolve(
		outDir,
		options.name ? ensurePngName(options.name) : generation.downloadName
	)

	process.stderr.write(`Generating ${providerId}/${generation.request.model ?? 'default'} ...\n`)
	await saveImage(generation.imageUrl, outPath)

	if (options.json) {
		process.stdout.write(
			`${JSON.stringify(
				{
					id: generation.id,
					prompt: generation.request.prompt,
					proposedTitle: proposedTitle ?? null,
					provider: generation.request.providerId,
					model: generation.request.model ?? null,
					width: generation.request.size.width,
					height: generation.request.size.height,
					seed: generation.request.seed ?? null,
					imageUrl: generation.imageUrl,
					path: outPath,
				},
				null,
				2
			)}\n`
		)
	} else {
		process.stdout.write(`Generated ${generation.id}\n`)
		process.stdout.write(`Prompt: ${generation.request.prompt}\n`)
		process.stdout.write(`URL:    ${generation.imageUrl}\n`)
		process.stdout.write(`Saved:  ${outPath}\n`)
	}

	return 0
}

main()
	.then((code) => {
		process.exitCode = code
	})
	.catch((error) => {
		process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
		process.exitCode = 1
	})
