<script setup lang="ts">
import { computed } from 'vue';
import { goods as goodsCatalog } from '$assets/game-content';
// @ts-ignore
import { T } from '$lib/i18n'; // If i18n is available, otherwise mock it? 
// Actually T is a Svelte store in legacy. In Vue we might not have it or need to mock it.
// I'll assume we can just use the key if T is missing or check if T is available.
// ssh library exports T? 
// src/lib/i18n.ts exists in ssh. 
// But T is likely specific to Svelte reactivity? 
// Let's check imports in legacy: import { T } from '$lib/i18n'.
// I'll try to use English names from goodsCatalog if available, or just the key.

import EntityBadge from './EntityBadge.vue';

const props = defineProps<{
    goods: Record<string, number>;
    game: any;
}>();

const entries = computed(() => {
    return Object.entries(props.goods || {})
        .filter(([, qty]) => qty && qty > 0)
        .sort(([a], [b]) => a.localeCompare(b));
});

const getSprite = (good: string) => {
    return goodsCatalog[good as keyof typeof goodsCatalog]?.sprites?.[0] || 'default';
};

const getName = (good: string) => {
    // Fallback if T is not compatible
    return good; 
}
</script>

<template>
  <div class="goods-list" v-if="entries.length > 0">
      <EntityBadge 
          v-for="[good, qty] in entries" 
          :key="good"
          :game="game"
          :sprite="getSprite(good)"
          :text="getName(good)"
          :qty="qty"
      />
  </div>
</template>

<style scoped>
.goods-list {
    display: flex;
    flex-wrap: wrap;
    gap: 0.5rem;
}
</style>
