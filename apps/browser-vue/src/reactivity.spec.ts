import { describe, it, expect } from 'vitest';
import { effect, reactive } from 'mutts';
import { configuration } from '@ssh/lib/globals'; // Import from engine

describe('Reactivity Integration', () => {
    it('should share reactivity instance between app and engine', () => {
        // Create a local reactive object using mutts import
        const localState = reactive({ count: 0 });
        let updateCount = 0;

        effect(() => {
            console.log('Local count:', localState.count);
            updateCount++;
        });

        expect(updateCount).toBe(1);
        localState.count++;
        expect(updateCount).toBe(2);
    });

    it('should react to engine globals changes', () => {
        // This tests the critical path: engine global -> app effect
        let lastControl = '';
        let runCount = 0;

        effect(() => {
            lastControl = configuration.timeControl;
            runCount++;
        });

        const initialRuns = runCount;
        
        // Update engine global
        configuration.timeControl = 'gonzales';

        expect(configuration.timeControl).toBe('gonzales');
        // If instances are shared, effect should run
        expect(runCount).toBeGreaterThan(initialRuns);
        expect(lastControl).toBe('gonzales');
    });
});
