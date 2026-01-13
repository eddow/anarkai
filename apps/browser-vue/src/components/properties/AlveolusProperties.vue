<script setup lang="ts">
import { computed } from 'vue';
import { Alveolus } from '@ssh/lib/game/board/content/alveolus';
import { StorageAlveolus } from '@ssh/lib/game/hive/storage';
import PropertyGridRow from '../parts/PropertyGridRow.vue';
import WorkingIndicator from '../parts/WorkingIndicator.vue';
import StorageConfiguration from './StorageConfiguration.vue';
import { useMutts } from '../../lib/mutts-vue';

const props = defineProps<{
    content: Alveolus;
    game: any;
}>();

// T mock
const T = {
    alveolus: {
        commands: 'Commands',
        workingTooltip: 'Toggle working state',
    }
};

const muttsWorking = useMutts(() => props.content.working);
const working = computed({
    get: () => muttsWorking.value,
    set: (v) => { props.content.working = v; }
});
</script>

<template>
    <PropertyGridRow :label="T.alveolus.commands">
        <WorkingIndicator 
            v-model:working="working" 
            :tooltip="T.alveolus.workingTooltip"
        />
    </PropertyGridRow>
    <StorageConfiguration 
        v-if="content instanceof StorageAlveolus" 
        :content="(content as StorageAlveolus)" 
        :game="game" 
    />
</template>
