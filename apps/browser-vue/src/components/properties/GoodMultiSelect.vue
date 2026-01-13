<script setup lang="ts">
import { GoodType } from '@ssh/lib/types/base';
import { goods as sensoryGoods } from 'engine-pixi/assets/visual-content';
import Button from '../Button.vue';
import EntityBadge from './EntityBadge.vue';
import AddGoodButton from './AddGoodButton.vue';

const props = defineProps<{
    modelValue: GoodType[];
    availableGoods: GoodType[];
    game: any;
    addTitle?: string;
    addLabel?: string;
}>();

const emit = defineEmits<{
    (e: 'update:modelValue', value: GoodType[]): void;
    (e: 'add', good: GoodType): void;
    (e: 'remove', good: GoodType): void;
}>();

const handleAdd = (good: GoodType) => {
    console.log('GoodMultiSelect: handleAdd', good);
    emit('add', good);
    // Also emit update for convenience if parent wants to just bind v-model
    if (!props.modelValue.includes(good)) {
        console.log('GoodMultiSelect: emitting update:modelValue', [...props.modelValue, good]);
        emit('update:modelValue', [...props.modelValue, good]);
    } else {
        console.log('GoodMultiSelect: good already in modelValue');
    }
};

const handleRemove = (good: GoodType) => {
    emit('remove', good);
    emit('update:modelValue', props.modelValue.filter(g => g !== good));
};

const getSprite = (good: string) => {
    return sensoryGoods[good as keyof typeof sensoryGoods]?.sprites?.[0] || 'default';
};
</script>

<template>
    <div class="good-multi-select">
		<!-- DEBUG: Display modelValue -->
		<pre style="font-size: 0.7rem; color: orange;">{{ JSON.stringify(modelValue) }}</pre>

        <div class="goods-list" v-if="modelValue.length > 0">
            <div v-for="gt in modelValue" :key="gt" class="good-row">
                <EntityBadge :game="game" :sprite="getSprite(gt)" :text="gt" />
                
                <div class="row-controls">
                    <slot name="item-extra" :good="gt"></slot>
                    
                    <Button 
                        icon="mdi:close" 
                        size="small" 
                        class="remove-btn" 
                        @click="handleRemove(gt)"
                        title="Remove"
                    />
                </div>
            </div>
        </div>
        
        <div v-else class="empty-list">
            <slot name="empty">No items selected</slot>
        </div>

        <div class="add-btn-wrapper">
             <AddGoodButton 
                :available-goods="availableGoods"
                :game="game"
                :title="addTitle"
                @select="handleAdd"
            >
                <slot name="add-button-label">{{ addLabel || 'Add' }}</slot>
            </AddGoodButton>
        </div>
    </div>
</template>

<style scoped>
.good-multi-select {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
}

.goods-list {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
}

.good-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    background: var(--app-surface-tint);
    border-radius: 4px;
    padding-right: 4px; /* Space for controls */
}



.row-controls {
    display: flex;
    align-items: center;
    gap: 0.25rem;
}

.remove-btn {
    padding: 2px;
    min-height: auto;
    height: 18px;
    width: 18px;
    opacity: 0.6;
}

.remove-btn:hover {
    opacity: 1;
    color: var(--pico-del-color);
}

.empty-list {
    font-style: italic;
    color: var(--pico-muted-color);
    font-size: 0.8rem;
}

.add-btn-wrapper {
    align-self: flex-start;
}
</style>
