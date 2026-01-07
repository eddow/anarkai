<script setup lang="ts">
import { ref } from 'vue';
import Button from '../Button.vue'; // Adjust path if needed
// Assuming Button component supports icon and click
// or I can import Icon directly if Button is too limited?
// Button.vue supports icon props.

const props = defineProps<{
    label?: string;
    class?: string;
}>();

interface ConfirmationOptions {
    text: string;
    confirmText?: string;
    cancelText?: string;
    confirmColor?: string; // e.g. 'red', 'gray'
    cancelColor?: string;
}

const isConfirming = ref(false);
const confirmationText = ref('');
const confirmText = ref('Confirm');
const cancelText = ref('Cancel');

let confirmationResolve: ((value: boolean) => void) | null = null;

const confirm = (options: ConfirmationOptions): Promise<boolean> => {
    return new Promise((resolve) => {
        confirmationText.value = options.text;
        confirmText.value = options.confirmText || 'Confirm';
        cancelText.value = options.cancelText || 'Cancel';
        isConfirming.value = true;
        confirmationResolve = resolve;
    });
};

const handleConfirm = () => {
    isConfirming.value = false;
    if (confirmationResolve) {
        confirmationResolve(true);
        confirmationResolve = null;
    }
};

const handleCancel = () => {
    isConfirming.value = false;
    if (confirmationResolve) {
        confirmationResolve(false);
        confirmationResolve = null;
    }
};

defineExpose({ confirm });
</script>

<template>
    <tr class="property-grid-row">
        <template v-if="isConfirming">
            <th class="property-label">
                <Button 
                    size="small" 
                    icon="mdi:check"
                    @click="handleConfirm"
                >
                    {{ confirmText }}
                </Button>
            </th>
            <td class="property-value" colspan="1">
                <div class="confirm-content">
                    <span>{{ confirmationText }}</span>
                    <Button 
                        size="small"
                        icon="mdi:close"
                        @click="handleCancel"
                    >
                        {{ cancelText }}
                    </Button>
                </div>
            </td>
        </template>
        <template v-else>
             <th v-if="label" class="property-label">
                <span>{{ label }}</span>
            </th>
            <td class="property-value" :class="props.class" :colspan="label ? 1 : 2">
                <slot></slot>
            </td>
        </template>
    </tr>
</template>

<style scoped>
.property-grid-row {
    border-bottom: 1px solid var(--pico-muted-border-color);
}
.property-grid-row:last-child {
    border-bottom: none;
}

.property-label {
    padding: 0.5rem;
    vertical-align: top;
    width: 30%;
    min-width: 100px;
    font-weight: 600;
    text-align: left;
    color: var(--app-text); /* Ensure we use app text color */
    background: var(--app-surface-tint);
}

.property-value {
    padding: 0.5rem;
    vertical-align: top;
    color: var(--app-text);
}

.confirm-content {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    justify-content: space-between;
}
</style>
