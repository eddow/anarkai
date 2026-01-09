<script setup lang="ts">
import { computed } from 'vue';

const props = defineProps<{
    value: number;
    levels: {
        critical: number;
        high: number;
        satisfied: number;
    };
    label: string;
    showValue?: boolean;
}>();

const percentage = computed(() => Math.min(100, Math.max(0, Math.floor((100 * props.value) / props.levels.critical))));

const colorClass = computed(() => {
    if (props.value < props.levels.satisfied) return 'bg-green';
    if (props.value < props.levels.high) return 'bg-yellow';
    if (props.value < props.levels.critical) return 'bg-orange';
    return 'bg-red';
});
</script>

<template>
    <div class="stat-progress-bar">
        <div class="track">
            <div class="bar" :class="colorClass" :style="{ width: `${percentage}%` }"></div>
            <div class="overlay-text">
                <span class="label">{{ label }}</span>
                <span v-if="showValue !== false" class="value">{{ percentage }}%</span>
            </div>
        </div>
    </div>
</template>

<style scoped>
.stat-progress-bar {
    min-width: 0;
    position: relative;
}
.track {
    width: 100%;
    height: 1.1rem; /* Slightly taller to fit text */
    background-color: var(--pico-muted-border-color);
    background-color: rgba(128,128,128,0.2);
    border-radius: 4px; /* Less rounded for compact look */
    overflow: hidden;
    position: relative;
}
.bar {
    height: 100%;
    transition: width 0.3s ease, background-color 0.3s ease;
    opacity: 0.7; /* Make it see-through so text is readable */
}
.overlay-text {
    position: absolute;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 0 0.5rem;
    font-size: 0.75em;
    font-weight: 600;
    z-index: 1;
    color: var(--pico-color); /* Ensure text contrast */
    text-shadow: 0 0 2px rgba(0,0,0,0.5); /* Better readability */
}

.bg-green { background-color: #22c55e; }
.bg-yellow { background-color: #eab308; }
.bg-orange { background-color: #f97316; }
.bg-red { background-color: #ef4444; }
</style>
