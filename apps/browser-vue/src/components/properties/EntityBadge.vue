<script setup lang="ts">
import ResourceImage from '../ResourceImage.vue';

defineProps<{
    game: any;
    sprite: string;
    text: string;
    qty?: number;
    height?: number;
}>();
</script>

<template>
  <div class="entity-badge">
    <ResourceImage 
        :game="game" 
        :sprite="sprite" 
        :height="height || 20" 
        :width="height || 20"
        :alt="text" 
    />
    <span v-if="qty" class="qty">×{{ qty }}</span>
    <span v-else class="label">{{ text || '?' }}</span>
  </div>
</template>

<style scoped>
.entity-badge {
    display: inline-flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.25rem 0.5rem;
    border: 1px solid var(--pico-muted-border-color);
    border-radius: var(--pico-border-radius);
    background-color: var(--pico-card-background-color);
    font-size: 0.875rem;
}
.qty {
    font-weight: bold;
}
</style>
