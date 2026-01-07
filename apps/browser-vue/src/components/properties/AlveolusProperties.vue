<script setup lang="ts">
import { ref, computed } from 'vue';
import { Alveolus } from '@ssh/lib/game/board/content/alveolus';
import PropertyGridRow from '../parts/PropertyGridRow.vue';
import AlveolusFlag from '../parts/AlveolusFlag.vue';
import Button from '../Button.vue';
import { useMutts } from '../../lib/mutts-vue';

const props = defineProps<{
    content: Alveolus;
}>();

// T mock
const T = {
    alveolus: {
        commands: 'Commands',
        working: 'Working',
        workingTooltip: 'Toggle working state',
        cleanUp: 'Clean Up',
        cleanUpTooltip: 'Clean up storage',
        cleanUpConfirmText: 'Are you sure you want to clean up storage?',
        clear: 'Clear',
        keep: 'Keep',
    }
};

const muttsWorking = useMutts(() => props.content.working);
const working = computed({
    get: () => muttsWorking.value,
    set: (v) => { props.content.working = v; }
});

const isStorageEmpty = useMutts(() => props.content.storage?.isEmpty);

const commandsRow = ref<InstanceType<typeof PropertyGridRow> | null>(null);

const handleCleanUp = async () => {
    if (!commandsRow.value) return;
    
    const confirmed = await commandsRow.value.confirm({
        text: T.alveolus.cleanUpConfirmText,
        confirmText: T.alveolus.clear,
        cancelText: T.alveolus.keep,
    });

    if (confirmed) {
        props.content.cleanUp();
        console.log('Clean up completed for alveolus:', props.content.name);
    }

};
</script>

<template>
    <PropertyGridRow ref="commandsRow" :label="T.alveolus.commands">
        <div class="flex gap-2">
            <AlveolusFlag
                v-model:checked="working"
                icon="mdi:cog"
                :name="T.alveolus.working"
                :tooltip="T.alveolus.workingTooltip"
            />
            <Button
                v-if="!isStorageEmpty"
                @click="handleCleanUp"
                :title="T.alveolus.cleanUpTooltip"
                class="btn-danger"
            >
                Start Cleanup
            </Button>
        </div>
    </PropertyGridRow>
</template>

<style scoped>
.flex { display: flex; }
.gap-2 { gap: 0.5rem; }
.btn-danger {
    color: #ef4444; 
    border-color: #ef4444;
}
</style>
