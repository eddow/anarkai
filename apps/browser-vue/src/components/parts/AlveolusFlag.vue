<script setup lang="ts">
import Button from '../Button.vue';

const checked = defineModel<boolean>('checked');

const props = defineProps<{
    icon: string;
    name: string;
    tooltip: string;
}>();

const toggle = () => {
    checked.value = !checked.value;
}
</script>

<template>
    <Button 
        :active="checked" 
        :icon="icon" 
        :title="tooltip"
        @click="toggle"
        class="alveolus-flag"
    >
        {{ props.name }}
    </Button>
</template>

<style scoped>
.alveolus-flag {
    /* Button styles are handled by Button component mostly */
    /* But we want to show text too, which Button might not support if only icon? */
    /* Looking at Button.vue, it uses slot if provided? Or relies on props. */
}
</style>
