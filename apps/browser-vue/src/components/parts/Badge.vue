<script setup lang="ts">
import { computed } from 'vue';

const props = defineProps<{
    color?: 'red' | 'green' | 'yellow' | 'indigo' | 'purple' | 'pink' | 'blue' | 'gray';
}>();

const style = computed(() => {
    const map: Record<string, string> = {
        red: '#ef4444',
        green: '#22c55e',
        yellow: '#eab308',
        indigo: '#6366f1',
        purple: '#a855f7',
        pink: '#ec4899',
        blue: '#3b82f6',
        gray: '#6b7280'
    };
    const c = map[props.color || 'gray'];
    return {
        backgroundColor: `${c}20`, // 12% opacity roughly
        color: c,
        border: `1px solid ${c}40`
    };
});
</script>

<template>
    <span class="badge" :style="style">
        <slot></slot>
    </span>
</template>

<style scoped>
.badge {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    padding: 0.125rem 0.5rem;
    border-radius: 9999px;
    font-size: 0.75rem;
    font-weight: 500;
    line-height: 1;
}
</style>
