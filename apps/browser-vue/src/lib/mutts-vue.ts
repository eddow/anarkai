import { onUnmounted, shallowRef, shallowReadonly, type Ref } from 'vue';
import { effect } from 'mutts';

/**
 * Creates a mutts effect that is automatically cleaned up when the Vue component is unmounted.
 * @param fn The effect logic to execute.
 * @returns The stop handle for the effect.
 */
export function useMuttsEffect(fn: () => void): () => void {
    const stop = effect(fn);
    onUnmounted(stop);
    return stop;
}

/**
 * Creates a Vue ref that tracks a mutts reactive state derived by the getter.
 * The effect handles correct dependency tracking and cleanup.
 * @param getter A function that returns the value to track.
 * @returns A readonly Vue ref containing the checked value.
 */
export function useMutts<T>(getter: () => T): Readonly<Ref<T>> {
    const state = shallowRef<T>(getter());
    
    useMuttsEffect(() => {
        state.value = getter();
    });

    return shallowReadonly(state) as Readonly<Ref<T>>;
}
