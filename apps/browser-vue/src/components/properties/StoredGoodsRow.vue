<script setup lang="ts">
import { ref, computed } from 'vue';
import { goods as sensoryGoods } from 'engine-pixi/assets/visual-content';
import { Alveolus } from '@ssh/lib/game/board/content/alveolus';
import type { GoodType } from '@ssh/lib/types/base';

import PropertyGridRow from '../parts/PropertyGridRow.vue';
import EntityBadge from './EntityBadge.vue';
import Button from '../Button.vue';
import { useMutts } from '../../lib/mutts-vue';
import { T } from '@ssh/lib/i18n';

const props = defineProps<{
    content: Alveolus;
    game: any;
    label: string;
}>();

const stock = useMutts(() => props.content.storage?.stock || {});

const entries = computed(() => 
    Object.entries(stock.value)
        .filter(([, qty]) => qty && qty > 0)
        .sort(([a], [b]) => a.localeCompare(b))
);

const hasGoods = computed(() => entries.value.length > 0);
const hasMultipleTypes = computed(() => entries.value.length > 1);

const storedRow = ref<InstanceType<typeof PropertyGridRow> | null>(null);

const getSprite = (good: string) => {
    return sensoryGoods[good as keyof typeof sensoryGoods]?.sprites?.[0] || 'default';
};

const handleCleanAll = async () => {
    if (!storedRow.value) return;
    
    const confirmed = await storedRow.value.confirm({
        text: T.alveolus.cleanUpConfirmText,
        confirmText: T.alveolus.clear,
        cancelText: T.alveolus.keep,
    });

    if (confirmed) {
        props.content.cleanUp();
    }
};

const handleCleanGood = async (goodType: string) => {
    if (!storedRow.value) return;
    
    const confirmed = await storedRow.value.confirm({
        text: T.alveolus.cleanUpConfirmText,
        confirmText: T.alveolus.clear,
        cancelText: T.alveolus.keep,
    });

    if (confirmed) {
        props.content.cleanUpGood(goodType as GoodType);
    }
};
</script>

<template>
    <PropertyGridRow v-if="hasGoods" ref="storedRow" :label="label">
        <div class="stored-goods-row">
            <!-- Clean All button -->
            <Button 
                icon="mdi:broom" 
                @click="handleCleanAll"
                :title="T.alveolus.cleanUpTooltip"
                class="cleanup-btn"
            />
            
            <!-- Goods with individual cleanup -->
            <div 
                v-for="[good, qty] in entries" 
                :key="good"
                class="good-with-cleanup"
            >
                <EntityBadge 
                    :game="game" 
                    :sprite="getSprite(good)" 
                    :text="good"
                    :qty="qty" 
                />
                <Button 
                    v-if="hasMultipleTypes"
                    icon="mdi:close-circle-outline"
                    @click="handleCleanGood(good)"
                    :title="T.alveolus.cleanUpGoodTooltip({goodType: good})"
                    class="cleanup-btn-small"
                />
            </div>
        </div>
    </PropertyGridRow>
</template>

<style scoped>
.stored-goods-row {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.5rem;
}

.good-with-cleanup {
    display: inline-flex;
    align-items: center;
    gap: 0.125rem;
    position: relative;
}

.cleanup-btn {
    padding: 0.25rem;
    min-height: auto;
    height: auto;
    color: var(--pico-del-color, #ef4444);
}

.cleanup-btn-small {
    padding: 0.125rem;
    min-height: auto;
    height: auto;
    font-size: 0.75rem;
    color: var(--pico-del-color, #ef4444);
    opacity: 0.7;
}

.cleanup-btn-small:hover {
    opacity: 1;
}
</style>
