<script setup lang="ts">
import { UnBuiltLand } from '@ssh/lib/game/board/content/unbuilt-land';
import PropertyGridRow from '../parts/PropertyGridRow.vue';
import Badge from '../parts/Badge.vue';
import EntityBadge from './EntityBadge.vue';
import { useMutts } from '../../lib/mutts-vue';

const props = defineProps<{
    content: UnBuiltLand;
}>();

const T = {
    project: 'Project',
    clearing: 'Clearing',
    deposit: 'Deposit',
    alveoli: {} as Record<string, string>, // Mock dictionary
    deposits: {} as Record<string, string>,
};

const game = props.content.tile.board.game;

const deposit = useMutts(() => {
    const d = props.content.deposit;
    return d ? {
        // Use logic name to request texture via AssetManager fallback
        sprite: `deposits.${d.name}`, 
        name: d.name,
        amount: d.amount
    } : undefined;
});


const projectData = useMutts(() => {
    const proj = props.content.project;
    return proj ? { project: proj, name: proj.replace('build:', '') } : undefined;
});

const isClearing = useMutts(() => !props.content.tile.isClear);

</script>

<template>
    <PropertyGridRow v-if="projectData" :label="T.project">
        <div class="flex items-center gap-2">
            <Badge color="blue">
                {{ projectData.name || projectData.project }}
            </Badge>
            <Badge v-if="isClearing" color="yellow">{{ T.clearing }}</Badge>
        </div>
    </PropertyGridRow>

    <PropertyGridRow v-if="deposit" :label="T.deposit">
        <EntityBadge
            v-if="deposit.sprite"
            :game="game"
            :sprite="deposit.sprite"
            :text="deposit.name"
            :qty="deposit.amount"
        />
    </PropertyGridRow>
</template>

<style scoped>
.flex { display: flex; }
.items-center { align-items: center; }
.gap-2 { gap: 0.5rem; }
</style>
