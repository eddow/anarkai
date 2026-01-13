<script setup lang="ts">
import { reactive, computed, ref } from 'vue';
import { GoodType } from '@ssh/lib/types/base';
import { goods as sensoryGoods } from 'engine-pixi/assets/visual-content';
import Button from '../Button.vue';
import EntityBadge from './EntityBadge.vue';

const props = defineProps<{
    availableGoods: GoodType[];
    game: any;
    title?: string;
}>();

const emit = defineEmits<{
    (e: 'select', good: GoodType): void;
}>();

const menuState = reactive({
    show: false,
    x: 0,
    y: 0,
});

const buttonWrapper = ref<HTMLElement | null>(null);

const openMenu = () => {
    if (!buttonWrapper.value) return;
    const rect = buttonWrapper.value.getBoundingClientRect();
    menuState.x = rect.left;
    menuState.y = rect.bottom;
    menuState.show = true;
};

const handleSelect = (gt: GoodType) => {
    emit('select', gt);
    menuState.show = false;
};

const getSprite = (good: string) => {
    return sensoryGoods[good as keyof typeof sensoryGoods]?.sprites?.[0] || 'default';
};
</script>

<template>
    <div class="add-good-wrapper" ref="buttonWrapper">
        <Button 
            icon="mdi:plus" 
            size="small" 
            @click="openMenu"
            :title="title || 'Add'"
        >
            <slot>Add</slot>
        </Button>

        <Teleport to="body">
            <div 
                v-if="menuState.show" 
                class="floating-menu-overlay" 
                @click="menuState.show = false"
            >
                <div 
                    class="floating-menu" 
                    :style="{ top: menuState.y + 'px', left: menuState.x + 'px' }"
                    @click.stop
                >
                    <div 
                        v-for="gt in availableGoods" 
                        :key="gt" 
                        class="menu-item"
                        @click="handleSelect(gt)"
                    >
                        <EntityBadge :game="game" :sprite="getSprite(gt)" :text="gt" />
                    </div>
                    <div v-if="availableGoods.length === 0" class="menu-empty">
                        No goods available
                    </div>
                </div>
            </div>
        </Teleport>
    </div>
</template>

<style scoped>
.add-good-wrapper {
    display: inline-block;
}

/* Floating Menu Styles */
.floating-menu-overlay {
    position: fixed;
    top: 0;
    left: 0;
    width: 100vw;
    height: 100vh;
    z-index: 9999;
}

.floating-menu {
    position: absolute;
    background: var(--app-surface);
    border: 1px solid var(--pico-muted-border-color);
    box-shadow: 0 4px 6px rgba(0,0,0,0.3);
    min-width: 120px;
    max-height: 200px;
    overflow-y: auto;
    border-radius: 4px;
    padding: 0.25rem;
    transform: translateY(4px); 
}

.menu-item {
    padding: 0.25rem;
    cursor: pointer;
    border-radius: 2px;
}

.menu-item:hover {
    background: var(--app-surface-tint);
}

.menu-empty {
    padding: 0.5rem;
    font-size: 0.8rem;
    color: var(--pico-muted-color);
}
</style>
