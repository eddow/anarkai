<script setup lang="ts">
</script>

<template>
  <div class="v-toolbar">
    <slot></slot>
  </div>
</template>

<style scoped>
.v-toolbar {
  display: flex;
  align-items: center;
  gap: 0.25rem; /* Compact gap */
  padding: 0.25rem; /* Compact padding */
  background-color: var(--toolbar-bg);
  border: 1px solid var(--toolbar-border);
  border-radius: var(--pico-border-radius);
  color: var(--toolbar-text);
}
</style>
