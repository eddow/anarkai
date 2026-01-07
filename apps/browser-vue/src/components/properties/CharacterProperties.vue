<script setup lang="ts">
import { computed } from 'vue';
import { Character } from '@ssh/lib/game/population/character';
import type { ActivityType } from '@ssh/lib/types/base';
import { Alveolus } from '@ssh/lib/game/board';
// import { AEvolutionStep } from '@ssh/lib/game/npcs/steps'; // Not easily importable, using duck typing for now

import PropertyGrid from '../parts/PropertyGrid.vue';
import PropertyGridRow from '../parts/PropertyGridRow.vue';
import StatProgressBar from '../parts/StatProgressBar.vue';
import Badge from '../parts/Badge.vue';
import GoodsList from './GoodsList.vue';
import { useMutts } from '../../lib/mutts-vue';

const props = defineProps<{
    character: Character;
    game: any;
}>();

const T = {
    character: {
        hunger: 'Hunger',
        tiredness: 'Tiredness',
        fatigue: 'Fatigue',
        currentActivity: 'Activity',
        noActivity: 'No activity',
    },
    goods: 'Goods',
    step: { idle: 'Idle' } as Record<string, string>
};

const activityBadgeColors: Record<ActivityType, string> = {
    walk: 'yellow',
    work: 'red',
    eat: 'green',
    sleep: 'purple',
    idle: 'gray',
    fight: 'red'
};

// ... (inside setup)

const state = useMutts(() => {
    const c = props.character;
    const step = c.stepExecutor;
    const assigned = c.assignedAlveolus;
    return {
        name: c.name,
        uid: c.uid,
        hunger: c.hunger,
        tiredness: c.tiredness,
        fatigue: c.fatigue,
        triggerLevels: c.triggerLevels,
        stepType: c.stepExecutor?.type as ActivityType | undefined,
        stepDescription: (c.stepExecutor?.description || undefined) as string | undefined,
        step: (step?.isa === 'AEvolutionStep' || step?.isa === 'ALerpStep') ? step : undefined,
        goods: c.carry?.stock || {},
        actions: [...(c.actionDescription || [])],
        vehicle: c.vehicle?.name,
        assignedAlveolus: assigned?.name || (assigned && (assigned as any).title) // specific title fallback if needed
    };
});

const stepEvolution = computed(() => {
    const step = state.value.step;
    return step && step.isa !== 'ALerpStep'
        ? Math.max(0, Math.min(1, (step as any).evolution))
        : 0;
});

const badgeColor = computed(() => {
    const type = state.value.stepType || 'idle';
    return activityBadgeColors[type] || 'gray';
});

const stepLabel = computed(() => {
    const desc = state.value.stepDescription;
    return desc ? (T.step[desc] || desc) : T.step.idle;
});

</script>

<template>
    <div class="character-properties">
        <!-- Stats -->
        <div v-if="state.triggerLevels" class="stats-grid">
             <StatProgressBar
                :value="state.hunger"
                :levels="state.triggerLevels.hunger"
                :label="T.character.hunger"
             />
             <StatProgressBar
                :value="state.tiredness"
                :levels="state.triggerLevels.tiredness"
                :label="T.character.tiredness"
             />
             <StatProgressBar
                :value="state.fatigue"
                :levels="state.triggerLevels.fatigue"
                :label="T.character.fatigue"
             />
        </div>

        <PropertyGrid class="props-grid">
            <PropertyGridRow label="Vehicle">
                <Badge color="gray">{{ state.vehicle || 'None' }}</Badge>
            </PropertyGridRow>

            <PropertyGridRow v-if="state.assignedAlveolus" label="Assigned To">
                <span>{{ state.assignedAlveolus }}</span>
            </PropertyGridRow>

            <PropertyGridRow :label="T.goods">
                <GoodsList :goods="state.goods" :game="game" />
            </PropertyGridRow>

            <!-- Current Activity -->
            <PropertyGridRow v-if="state.actions" :label="T.character.currentActivity">
                 <div class="activity-row">
                    <Badge :color="badgeColor as any">{{ stepLabel }}</Badge>
                    <div v-if="stepEvolution > 0" class="mini-progress">
                        <div class="bar" :style="{ width: `${Math.floor(stepEvolution * 100)}%` }"></div>
                    </div>
                 </div>
            </PropertyGridRow>

            <!-- Actions List -->
             <PropertyGridRow>
                <div class="actions-container">
                    <div class="actions-header">Planned Actions</div>
                    <div v-if="state.actions.length > 0" class="action-stack">
                        <div v-for="(act, i) in state.actions" :key="i" class="action-card">
                            {{ act }}
                        </div>
                    </div>
                    <div v-else class="no-activity">
                        {{ T.character.noActivity }}
                    </div>
                </div>
            </PropertyGridRow>

        </PropertyGrid>
    </div>
</template>

<style scoped>
.character-properties {
    display: flex;
    flex-direction: column;
    gap: 1rem;
}

.character-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    border-bottom: 2px solid var(--pico-muted-border-color);
    padding-bottom: 0.5rem;
}

.character-header h3 {
    margin: 0;
    font-size: 1.2rem;
}

.uid-tag {
    font-size: 0.7rem;
    opacity: 0.6;
}

.stats-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(120px, 1fr));
    gap: 1rem;
    margin-bottom: 0.5rem;
}

.props-grid {
    margin-top: 0.5rem;
}

.activity-row {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    width: 100%;
}

.mini-progress {
    flex: 1;
    height: 0.5rem;
    background-color: var(--pico-muted-border-color);
    border-radius: 999px;
    overflow: hidden;
}
.mini-progress .bar {
    height: 100%;
    background-color: var(--pico-primary-background);
    width: 0%;
    transition: width 0.2s;
}

.actions-container {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
}

.actions-header {
    font-size: 0.9em;
    font-weight: 600;
    color: var(--pico-muted-color);
    text-transform: uppercase;
    letter-spacing: 0.05em;
    margin-bottom: 0.25rem;
}

.action-stack {
    display: flex;
    flex-direction: column;
    gap: 0.4rem;
}

.action-card {
    background: var(--pico-card-background-color);
    border: 1px solid var(--pico-muted-border-color);
    border-left: 3px solid var(--pico-primary-background);
    padding: 0.5rem 0.75rem;
    border-radius: 4px;
    font-size: 0.9em;
    box-shadow: 0 1px 2px rgba(0,0,0,0.1);
    position: relative;
    /* transition: transform 0.2s; */
}

/* .action-card:hover {
    transform: translateX(2px);
} */

.action-card::before {
    /* Optional: Index number or icon? */
    content: ''; 
}

.no-activity {
    font-style: italic;
    color: var(--pico-muted-color);
    padding: 0.5rem;
    text-align: center;
    background: var(--app-surface-tint);
    border-radius: 4px;
}
</style>
