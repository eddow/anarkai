<script setup lang="ts">
import { computed } from 'vue';
import { StorageAlveolus } from '@ssh/lib/game/hive/storage';
import { GoodType } from '@ssh/lib/types/base';
import { goods as goodsCatalog } from '$assets/game-content';
import { useMutts } from '../../lib/mutts-vue';
import PropertyGridRow from '../parts/PropertyGridRow.vue';
import Button from '../Button.vue';
import GoodMultiSelect from './GoodMultiSelect.vue'; // New component
import { SlottedStorage } from '@ssh/lib/game/storage/slotted-storage';
import { SpecificStorage } from '@ssh/lib/game/storage/specific-storage';

const props = defineProps<{
    content: StorageAlveolus;
    game: any;
}>();

// Robust getters
const mode = useMutts(() => props.content.storageMode || 'all-but');
const exceptions = useMutts(() => {
    const val = props.content.storageExceptions || [];
    console.log('StorageConfiguration: exceptions getter', val);
    return val;
});
const buffers = useMutts(() => props.content.storageBuffers || {});

const allGoodTypes = Object.keys(goodsCatalog) as GoodType[];

// --- Mode Logic ---
const toggleMode = () => {
    props.content.storageMode = props.content.storageMode === 'all-but' ? 'only' : 'all-but';
};

const modeLabel = computed(() => {
    return mode.value === 'all-but' ? 'Store all but...' : 'Store only...';
});

// --- Exception Logic ---
const availableExceptionCandidates = computed(() => {
    const exc = exceptions.value; // Access value to ensure dependency
    return allGoodTypes.filter(gt => !exc.includes(gt));
});

const addException = (good: GoodType) => {
    console.log('StorageConfiguration: addException', good);
    // Ensure array exists (should be initialized but safe to check)
    if (!props.content.storageExceptions) {
        props.content.storageExceptions = [];
    }
    // Mutate in place
    props.content.storageExceptions.push(good);
};

const removeException = (good: GoodType) => {
    console.log('StorageConfiguration: removeException', good);
    const idx = props.content.storageExceptions.indexOf(good);
    if (idx !== -1) {
        props.content.storageExceptions.splice(idx, 1);
    }
};

// --- Buffer Logic ---
const isSlotted = computed(() => props.content.storage instanceof SlottedStorage);

const bufferedGoods = computed(() => {
    return Object.keys(buffers.value) as GoodType[];
});

const availableBufferCandidates = computed(() => {
    const currentBufferKeys = Object.keys(buffers.value);
    let candidates: GoodType[] = [];
    
    if (isSlotted.value) {
        candidates = allGoodTypes;
    } else if (props.content.storage instanceof SpecificStorage) {
        candidates = Object.keys(props.content.storage.maxAmounts) as GoodType[];
    }
    
    return candidates.filter(gt => !currentBufferKeys.includes(gt));
});

const getBufferValue = (goodType: GoodType) => {
    const val = buffers.value[goodType] || 0;
    if (isSlotted.value) {
        return val * (props.content.storage as SlottedStorage).maxQuantityPerSlot;
    }
    return val;
};

const setBufferValue = (goodType: GoodType, pieces: number) => {
    const newBuffers = { ...props.content.storageBuffers };
    if (pieces <= 0) {
        delete newBuffers[goodType];
    } else {
        if (isSlotted.value) {
            newBuffers[goodType] = Math.ceil(pieces / (props.content.storage as SlottedStorage).maxQuantityPerSlot);
        } else {
            newBuffers[goodType] = pieces;
        }
    }
    props.content.storageBuffers = newBuffers;
};

const handleBufferAdd = (gt: GoodType) => {
     // Init buffer with 0 or 1 slot/unit
    setBufferValue(gt, isSlotted.value ? (props.content.storage as SlottedStorage).maxQuantityPerSlot : 1);
};

const handleBufferRemove = (gt: GoodType) => {
    setBufferValue(gt, 0);
};

</script>

<template>
    <div class="storage-config">
        <!-- Acceptance Mode -->
        <PropertyGridRow label="Acceptance">
            <div class="mode-control">
                <Button @click="toggleMode" size="small" class="mode-toggle">
                    {{ modeLabel }}
                </Button>
                
                <GoodMultiSelect
                    :model-value="exceptions"
                    :available-goods="availableExceptionCandidates"
                    :game="game"
                    add-title="Add Exception"
                    @add="addException"
                    @remove="removeException"
                >
                    <template #empty>No exceptions</template>
                </GoodMultiSelect>
            </div>
        </PropertyGridRow>

        <!-- Buffers -->
        <PropertyGridRow label="Buffers">
            <GoodMultiSelect
                :model-value="bufferedGoods"
                :available-goods="availableBufferCandidates"
                :game="game"
                add-title="Add Buffer"
                add-label="Add Buffer"
                @add="handleBufferAdd"
                @remove="handleBufferRemove"
            >
                <template #empty>No active buffers</template>
                <template #item-extra="{ good }">
                    <input 
                        type="number" 
                        :value="getBufferValue(good)" 
                        @input="e => setBufferValue(good, parseInt((e.target as HTMLInputElement).value) || 0)"
                        min="0"
                        class="buffer-input"
                    />
                </template>
            </GoodMultiSelect>
        </PropertyGridRow>
    </div>
</template>

<style scoped>
.storage-config {
    display: contents;
}

.mode-control {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
}

.mode-toggle {
    align-self: flex-start;
    white-space: nowrap;
}

.buffer-input {
    width: 60px;
    padding: 2px 4px;
    font-size: 0.8rem;
    height: 24px;
    text-align: right;
    border: 1px solid var(--pico-muted-border-color);
    border-radius: 4px;
    background: var(--pico-background-color);
    color: var(--pico-color);
}
</style>
