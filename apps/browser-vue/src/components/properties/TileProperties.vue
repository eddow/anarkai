<script setup lang="ts">
import { ref, computed, watchEffect } from 'vue';
import { Tile } from '@ssh/lib/game/board/tile';
import { alveoli } from '$assets/game-content';
import { computeStyleFromTexture } from '@ssh/lib/utils/images';

import PropertyGrid from '../parts/PropertyGrid.vue';
import PropertyGridRow from '../parts/PropertyGridRow.vue';
import Badge from '../parts/Badge.vue';
import EntityBadge from './EntityBadge.vue';
import GoodsList from './GoodsList.vue';
import AlveolusProperties from './AlveolusProperties.vue';
import UnBuiltProperties from './UnBuiltProperties.vue';

import { configuration as uiConfig } from '../../lib/globals';
import { useMutts } from '../../lib/mutts-vue';
import { Alveolus, UnBuiltLand } from '@ssh/lib/game/board';

const props = defineProps<{
    tile: Tile;
    game: any;
}>();

const isDark = useMutts(() => uiConfig.darkMode);

const T = {
    tile: { walkTime: 'Walk Time', unwalkable: 'Unwalkable' },
    goods: { stored: 'Stored', loose: 'Loose' }
};

const tileContent = useMutts(() => props.tile.content);
const stock = useMutts(() => props.tile.content?.storage?.stock || {});

const freeStock = useMutts(() => {
    const counts: Record<string, number> = {};
    for (const fg of props.tile.freeGoods) {
        if (!fg.available) continue;
        counts[fg.goodType] = (counts[fg.goodType] || 0) + 1;
    }
    return counts;
});

const contentInfo = computed(() => {
    const c = tileContent.value;
    console.log('[TileProperties] contentInfo calculation', { 
        isa: c?.isa, 
        constructor: c?.constructor?.name,
        name: c?.name,
        c 
    });
    
    // Support GcClassed names
    const resolvedType = c?.name;

    if (c instanceof Alveolus || resolvedType) {
        // Alveolus
        const def = resolvedType ? alveoli[resolvedType as keyof typeof alveoli] : undefined;
        return {
            type: resolvedType || 'unknown',
            sprite: def?.sprites?.[0] || '',
            name: resolvedType || 'Unknown', // i18n missing

            terrain: 'concrete'
        };
    }
    return {
         terrain: c instanceof UnBuiltLand ? c.terrain : 'concrete'
    };
});

const terrainBackgroundStyle = ref({});

watchEffect(async () => {
    if (contentInfo.value?.terrain) {
        await props.game.loaded;
        const texture = props.game.getTexture(`terrain.${contentInfo.value.terrain}`);
        if (texture) {
            // computeStyleFromTexture returns object or string? 
            // In Svelte it returned style object or string? 
            // `style={terrainBackgroundStyle}`
            // Looking at legacy import: import { computeStyleFromTexture } from '$lib/utils/images'
            // It likely returns CSSProperties object.
            try {
                terrainBackgroundStyle.value = computeStyleFromTexture(texture, {
                    backgroundRepeat: 'repeat',
                });
            } catch (e) {
                console.warn(e);
                terrainBackgroundStyle.value = {};
            }
        }
    } else {
        terrainBackgroundStyle.value = {};
    }
});

const walkTimeDisplay = computed(() => {
    const wt = tileContent.value?.walkTime;
    return wt === Infinity ? T.tile.unwalkable : wt;
});

const walkTimeColor = computed(() => {
     return tileContent.value?.walkTime === Infinity ? 'red' : 'yellow';
});

</script>

<template>
    <div class="tile-properties" :class="{ 'dark-terrain': isDark }" :style="terrainBackgroundStyle">
        <!-- Main title/icon -->
        <div v-if="contentInfo.type" class="header-badge">
             <EntityBadge
                :game="game"
                :sprite="contentInfo.sprite"
                :text="contentInfo.name"
             />
        </div>

        <PropertyGrid>
            <!-- Walk Time -->
            <PropertyGridRow :label="T.tile.walkTime">
                <Badge :color="walkTimeColor">{{ walkTimeDisplay }}</Badge>
            </PropertyGridRow>

            <!-- Elevation & Biome -->
            <PropertyGridRow label="Elevation">
                <span>{{ tile.elevation?.toFixed(1) || '0.0' }}</span>
            </PropertyGridRow>
            
            <PropertyGridRow v-if="contentInfo.terrain" label="Terrain">
                <Badge color="indigo">{{ contentInfo.terrain }}</Badge>
            </PropertyGridRow>
            
            <!-- Stored -->
            <PropertyGridRow v-if="Object.keys(stock).length > 0" :label="T.goods.stored">
                <GoodsList :goods="stock" :game="game" />
            </PropertyGridRow>

            <!-- Loose -->
            <PropertyGridRow v-if="Object.keys(freeStock).length > 0" :label="T.goods.loose">
                <GoodsList :goods="freeStock" :game="game" />
            </PropertyGridRow>

            <!-- Specific Properties -->
            <template v-if="tileContent instanceof UnBuiltLand">
                 <UnBuiltProperties :content="tileContent" />
            </template>
            <template v-else-if="tileContent instanceof Alveolus">
                 <AlveolusProperties :content="tileContent" />
            </template>

        </PropertyGrid>
    </div>
</template>

<style scoped>
.tile-properties {
    padding: 1rem;
    position: relative;
    /* ensure background texture is visible */
    background-size: 64px 64px; /* assumption */
    color: var(--app-text);
}
.tile-properties.dark-terrain {
    /* Darken the terrain background so text is readable */
    /* We can use a pseudo-element or multiple backgrounds, but simplest is a filter if background-image is set */
    /* Wait, filter affects children too. Better use multiple background or overlay if we can. */
    /* Actually we can use background-blend-mode if we specify a composite color. */
    background-color: rgba(0, 0, 0, 0.4);
    background-blend-mode: multiply;
}
.header-badge {
    margin-bottom: 1rem;
}
</style>
