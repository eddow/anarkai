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
        <div class="header">
            <span class="label">{{ label }}</span>
            <span v-if="showValue !== false" class="value">{{ percentage }}%</span>
        </div>
        <div class="track">
            <div class="bar" :class="colorClass" :style="{ width: `${percentage}%` }"></div>
        </div>
    </div>
</template>

<style scoped>
.stat-progress-bar {
    min-width: 0;
}
.header {
    display: flex;
    justify-content: space-between;
    margin-bottom: 0.25rem;
    font-size: 0.8em;
}
.label {
    font-weight: 500;
}
.value {
    color: var(--pico-muted-color);
}
.track {
    width: 100%;
    height: 0.5rem;
    background-color: var(--pico-muted-border-color); /* fallback */
    background-color: rgba(128,128,128,0.2);
    border-radius: 999px;
    overflow: hidden;
}
.bar {
    height: 100%;
    transition: width 0.3s ease, background-color 0.3s ease;
}

.bg-green { background-color: #22c55e; }
.bg-yellow { background-color: #eab308; }
.bg-orange { background-color: #f97316; }
.bg-red { background-color: #ef4444; }
</style>
