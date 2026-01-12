<script setup lang="ts">
import { Icon } from '@iconify/vue';

defineProps<{
  icon?: string;
  label?: string;
  active?: boolean;
}>();

defineEmits<{
  (e: 'click', event: MouseEvent): void;
}>();
</script>

<template>
  <button 
    class="v-button" 
    :class="{ 'v-button--active': active, 'v-button--icon-only': !label && icon }"
    @click="$emit('click', $event)"
  >
    <Icon v-if="icon" :icon="icon" class="v-button__icon" />
    <span v-if="label" class="v-button__label">{{ label }}</span>
    <slot></slot>
  </button>
</template>

<style scoped>
.v-button {
  gap: 0.25rem;
  padding: 0 0.5rem;
  margin: 0;
  border: 1px solid transparent;
  background: transparent;
  color: inherit; /* Use inherited toolbar color */
  cursor: pointer;
  border-radius: var(--pico-border-radius);
  transition: all 0.2s;
  min-height: auto; 
  height: 3rem; /* Standard pounce height */
}

.v-button:hover {
  background-color: var(--pico-secondary-hover-background); /* Or derive from toolbar */
  border-color: var(--toolbar-border);
}

.v-button--active {
  background-color: var(--toolbar-active);
  border-color: var(--toolbar-active-border);
  color: var(--pico-primary); /* Or active text color */
  box-shadow: none; /* Pounce doesn't use strong shadow */
  transform: none;
}

.v-button--icon-only {
    padding: 0.5rem;
    aspect-ratio: 1;
}

.v-button__icon {
    font-size: 1.5rem;
}
</style>
