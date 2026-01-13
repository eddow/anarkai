<script setup lang="ts">
import { Icon } from '@iconify/vue';

const working = defineModel<boolean>('working');

defineProps<{
    tooltip?: string;
}>();

const toggle = () => {
    working.value = !working.value;
};
</script>

<template>
    <button 
        class="working-indicator" 
        :class="{ 'not-working': !working }" 
        @click="toggle"
        :title="tooltip"
    >
        <Icon icon="mdi:cog" class="gear-icon" />
        <Icon 
            v-if="working" 
            icon="mdi:check" 
            class="status-icon status-ok" 
        />
        <Icon 
            v-else 
            icon="mdi:close" 
            class="status-icon status-off" 
        />
    </button>
</template>

<style scoped>
.working-indicator {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    position: relative;
    width: 2.5rem;
    height: 2.5rem;
    padding: 0;
    border: 1px solid var(--pico-muted-border-color);
    border-radius: 50%; /* Circle looks better for a toggle */
    background: var(--app-surface-tint, transparent);
    cursor: pointer;
    transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
}

.working-indicator:hover {
    background: var(--pico-secondary-hover-background);
    transform: scale(1.05);
}

.working-indicator.not-working {
    border-color: #ef444455;
}

.gear-icon {
    font-size: 1.5rem;
    color: var(--pico-primary, #3b82f6);
    transition: color 0.3s, transform 0.5s;
}

.not-working .gear-icon {
    color: var(--pico-muted-color, #94a3b8);
    filter: grayscale(1);
}

/* Rotate animation when working */
@keyframes rotate {
    from { transform: rotate(0deg); }
    to { transform: rotate(360deg); }
}

.working-indicator:not(.not-working) .gear-icon {
    animation: rotate 4s linear infinite;
}

.status-icon {
    position: absolute;
    bottom: -2px;
    right: -2px;
    font-size: 1rem;
    background: var(--pico-background-color, #fff);
    border-radius: 50%;
    padding: 1px;
    box-shadow: 0 1px 3px rgba(0,0,0,0.2);
}

.status-ok {
    color: #22c55e; /* green */
}

.status-off {
    color: #ef4444; /* red */
}

/* Strikethrough effect on the icon overlay */
.not-working::after {
    content: '';
    position: absolute;
    top: 50%;
    left: 15%;
    width: 70%;
    height: 2px;
    background: #ef4444;
    transform: rotate(-45deg);
    pointer-events: none;
    box-shadow: 0 0 2px rgba(239, 68, 68, 0.5);
}
</style>
