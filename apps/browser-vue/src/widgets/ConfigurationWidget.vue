```
<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { effect } from 'mutts';
import { configuration as uiConfig } from '../lib/globals';
import { configuration as gameConfig } from '@ssh/lib/globals';

const timeOptions = [
	{ value: 'pause', label: 'Pause' },
	{ value: 'play', label: 'Play' },
	{ value: 'fast-forward', label: 'Fast Forward' },
	{ value: 'gonzales', label: 'Gonzales' },
] as const;


const timeControl = ref(gameConfig.timeControl);
const darkMode = ref(uiConfig.darkMode);

onMounted(() => {
    effect(() => {
        timeControl.value = gameConfig.timeControl;
    });
    effect(() => {
        darkMode.value = uiConfig.darkMode;
    });
});

const setTimeControl = (val: string) => {
    gameConfig.timeControl = val as any;
}

const toggleDarkMode = () => {
    uiConfig.darkMode = !uiConfig.darkMode;
}
</script>

<template>
  <div class="configuration-widget">
    <fieldset class="configuration-widget__fieldset">
        <legend>Time control</legend>
         <div class="configuration-widget__radios">
            <label v-for="option in timeOptions" :key="option.value" class="configuration-widget__radio">
                <input 
                    type="radio" 
                    :name="`time-control-${api?.id}`"
                    :value="option.value"
                    :checked="timeControl === option.value"
                    @change="setTimeControl(option.value)"
                />
                {{ option.label }}
            </label>
        </div>
    </fieldset>

    <fieldset class="configuration-widget__fieldset">
        <legend>Appearance</legend>
         <div class="configuration-widget__radios">
            <label class="configuration-widget__radio">
                <input 
                    type="checkbox" 
                    :checked="darkMode"
                    @change="toggleDarkMode"
                />
                Dark mode
            </label>
        </div>
    </fieldset>
  </div>
</template>

<style scoped>
.configuration-widget {
	display: flex;
	flex-direction: column;
	gap: 1rem;
	padding: 1.2rem;
	color: var(--pico-color);
}

.configuration-widget__fieldset {
	margin: 0;
	border-radius: 0.75rem;
	border: 1px solid var(--pico-muted-border-color);
	padding: 0.75rem 1rem 1rem;
}

.configuration-widget__radios {
	display: flex;
	flex-direction: column;
	gap: 0.5rem;
	margin-top: 0.5rem;
}

.configuration-widget__radio {
	display: flex;
	align-items: center;
	gap: 0.5rem;
    cursor: pointer;
}
</style>
