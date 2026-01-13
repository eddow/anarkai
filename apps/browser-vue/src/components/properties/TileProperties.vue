<script setup lang="ts">
import { ref, computed, watchEffect } from 'vue'
import { Tile } from '@ssh/lib/game/board/tile'
import { alveoli as visualAlveoli } from 'engine-pixi/assets/visual-content'
import { computeStyleFromTexture } from '@ssh/lib/utils/images'

import PropertyGrid from '../parts/PropertyGrid.vue'
import PropertyGridRow from '../parts/PropertyGridRow.vue'
import Badge from '../parts/Badge.vue'
import EntityBadge from './EntityBadge.vue'
import GoodsList from './GoodsList.vue'
import StoredGoodsRow from './StoredGoodsRow.vue'
import AlveolusProperties from './AlveolusProperties.vue'
import UnBuiltProperties from './UnBuiltProperties.vue'

import { configuration as uiConfig } from '../../lib/globals'
import { useMutts } from '../../lib/mutts-vue'
import { Alveolus } from '@ssh/lib/game/board/content/alveolus'
import { UnBuiltLand } from '@ssh/lib/game/board/content/unbuilt-land'

const props = defineProps<{
    tile: Tile;
    game: any;
}>();

const isDark = useMutts(() => uiConfig.darkMode);

const T = {
    tile: { walkTime: 'Walk Time', unwalkable: 'Unwalkable' },
    goods: { stored: 'Stored', loose: 'Loose' }
};

const tileContent = computed(() => props.tile.content);
const stock = useMutts(() => props.tile.content?.storage?.stock || {});

const freeStock = useMutts(() => {
    const counts: Record<string, number> = {};
    for (const fg of props.tile.freeGoods) {
        if (!fg.available) continue;
        counts[fg.goodType] = (counts[fg.goodType] || 0) + 1;
    }
    return counts;
});

interface ContentInfo {
    type: string;
    sprite: string;
    name: string;
    terrain: string;
}

const contentInfo = computed<ContentInfo>(() => {
    const c = tileContent.value;
    
    // Check specific types first
    if (c instanceof UnBuiltLand) {
         return {
             type: 'UnBuiltLand',
             sprite: `terrain.${c.terrain}`, // Use terrain icon for unbuilt land
             name: c.name,
             terrain: c.terrain
         };
    }

    const resolvedType = c?.name;
    if (c instanceof Alveolus || resolvedType) {
        // Use a more relaxed type for dynamic access to avoid 'never' errors
        const def = resolvedType ? (visualAlveoli as Record<string, any>)[resolvedType] : undefined;
        return {
            type: resolvedType || 'unknown',
            sprite: def?.icon || (Array.isArray(def?.sprites) ? def.sprites[0] : ''),
            name: resolvedType || 'Unknown',
            terrain: (c as any).terrain || 'concrete' // Support Alveolus terrain or fallback
        };
    }

    return {
         type: '',
         sprite: '',
         name: '',
         terrain: c instanceof UnBuiltLand ? (c as UnBuiltLand).terrain : 'concrete'
    };
});

const terrainBackgroundStyle = ref({});

watchEffect(async () => {
    if (contentInfo.value?.terrain) {
        await props.game.rendererReady;
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
        <div v-if="contentInfo.name" class="header-badge">
             <EntityBadge
                :game="game"
                :sprite="contentInfo.sprite"
                :text="contentInfo.name"
                :height="24"
             />
        </div>

        <PropertyGrid>
            <!-- Walk Time -->
            <PropertyGridRow :label="T.tile.walkTime">
                <Badge :color="walkTimeColor">{{ walkTimeDisplay }}</Badge>
            </PropertyGridRow>
            
            <!-- Stored (with cleanup for Alveolus) -->
            <StoredGoodsRow 
                v-if="tileContent instanceof Alveolus"
                :content="tileContent" 
                :game="game" 
                :label="T.goods.stored" 
            />
            <PropertyGridRow v-else-if="Object.keys(stock).length > 0" :label="T.goods.stored">
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
                 <AlveolusProperties :content="tileContent" :game="game" />
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
