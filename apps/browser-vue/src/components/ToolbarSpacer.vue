<script setup lang="ts">
defineProps<{
    visible?: boolean;
}>();
</script>

<template>
  <div class="v-toolbar-spacer" :class="{ 'v-toolbar-spacer--visible': visible }"></div>
</template>

<style scoped>
.v-toolbar-spacer {
  flex: 1;
  min-width: 1rem;
}

.v-toolbar-spacer--visible {
  flex: none;
  width: 1px;
  background-color: var(--pico-muted-border-color);
  margin: 0 0.5rem;
  height: 2rem; /* Or match button height */
  opacity: 0.5;
}
</style>
