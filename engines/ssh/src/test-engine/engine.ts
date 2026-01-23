import type { Game, GameGenerationOptions, SaveState } from '$lib/game/game';
import { setupEnvironment } from './environment';
import { loadStandardMocks } from './mocks';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export class TestEngine {
    public game!: Game;
    private options?: GameGenerationOptions;

    constructor(options?: GameGenerationOptions) {
        this.options = options;
        setupEnvironment();
        loadStandardMocks(); 
    }

    /**
     * Waits for the game to be fully loaded (including dynamic imports like Hive)
     */
    public async init() {
         // Dynamic import to allow mocks to apply
        const { Game } = await import('$lib/game/game');
        this.game = new Game(this.options);
        await this.game.loaded;
    }

    /**
     * Loads a scenario state into the game.
     * Use this to setup the test board.
     */
    public loadScenario(scenario: Partial<SaveState>) {
        // Ensure generationOptions are present
        const fullScenario = {
            ...scenario,
            generationOptions: scenario.generationOptions ?? this.options ?? { boardSize: 12, terrainSeed: 1234, characterCount: 0 }
        } as SaveState;
        this.game.loadGameData(fullScenario);
    }

    /**
     * advances the game simulation by a specific amount of time.
     * @param seconds Total time to advance
     * @param tickRate Time per tick (default 0.1s)
     */
    public tick(seconds: number, tickRate: number = 0.1) {
        let elapsed = 0;
        // Avoid infinite loop if seconds is huge, but usually fine
        while (elapsed < seconds) {
            this.step(tickRate);
            elapsed += tickRate;
        }
    }

    /**
     * Executes a single simulation step.
     * accesses the private tickedObjects of the game to update them.
     */
    private step(delta: number) {
            // Access private tickedObjects via type assertion
            const objects = (this.game as any).tickedObjects as Set<{ update(dt: number): void }>;
            // console.log(`Step ${delta}: ${objects.size} ticked objects`);
            for (const object of objects) {
                // Skip destroyed objects
                if ('destroyed' in object && (object as any).destroyed) continue;
                object.update(delta);
            }
    }

    /**
     * Helper to spawn a character at a specific location
     */
    public spawnCharacter(name: string, coord: { q: number, r: number }) {
        return this.game.population.createCharacter(name, coord);
    }

    public loadScript(filename: string) {
        // Assuming ./assets/scripts structure relative to package root
        // engines/ssh/assets/scripts
        const scriptPath = path.resolve(__dirname, '../../assets/scripts', filename);
        return fs.readFileSync(scriptPath, 'utf-8');
    }
}
