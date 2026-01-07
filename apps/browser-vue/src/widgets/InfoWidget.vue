<script setup lang="ts">
import { ref, shallowRef, computed, onMounted, onUnmounted, watch as vueWatch } from 'vue';
import { games, selectionState, registerObjectInfoPanel, unregisterObjectInfoPanel, mrg } from '@ssh/lib/globals';
import { effect, watch as muttsWatch } from 'mutts';
import { toWorldCoord } from '@ssh/lib/utils/position';

import TileProperties from '../components/properties/TileProperties.vue';
import CharacterProperties from '../components/properties/CharacterProperties.vue';
import { Button } from '../components';

const props = defineProps<{
    params?: { uid?: string };
    api?: any;
}>();

const game = games.game('GameX');
const object = shallowRef<any>(null);
const logs = ref<string[]>([]);
const logsContainer = ref<HTMLElement | null>(null);

let stopLogWatch: (() => void) | undefined;
let stopSelectionEffect: (() => void) | undefined;

// Determines if we are in "Pinned" mode or "Selection" mode
const isPinned = computed(() => props.api?.id.startsWith('pinned:'));

const getSafeTitle = (obj: any) => {
    try {
        return obj?.title;
    } catch (e) {
        console.warn('Failed to get title for object:', obj, e);
        return 'Invalid Object';
    }
};

const objectTitle = computed(() => getSafeTitle(object.value) || 'Object');

const updateObject = () => {
    // If pinned, we ONLY show the specific object we were created for.
    // If not pinned, we follow the global selection.
    const uid = isPinned.value ? props.params?.uid : selectionState.selectedUid;
    
    if (uid) {
        const obj = game.getObject(uid);
        if (obj !== object.value) {
            object.value = obj;
            // Setup log watcher
            if (stopLogWatch) stopLogWatch();
            logs.value = [];
            
            if (obj && obj.logs) {
                 // Initial sync
                 logs.value = [...(obj.logs || [])];
                 // Watch for updates
                 stopLogWatch = muttsWatch(obj.logs, (newLogs: string[]) => {
                     logs.value = [...newLogs];
                     scrollToBottom();
                 });
            }

            // Update title
            if (props.api) {
                props.api.setTitle(getSafeTitle(obj) || 'Information');
            }
        }
        
        // Register panel if pinned
        if (isPinned.value && props.api) {
            registerObjectInfoPanel(uid, props.api.id);
        } else if (!isPinned.value && props.api) {
            selectionState.panelId = props.api.id;
        }

    } else {
        object.value = null;
        logs.value = [];
        if (props.api) {
            props.api.setTitle('Information');
        }
    }
};

const scrollToBottom = () => {
    setTimeout(() => {
        if (logsContainer.value) {
            logsContainer.value.scrollTop = logsContainer.value.scrollHeight;
        }
    }, 10);
};

// Lifecycle
onMounted(() => {
    updateObject();
    
    // If not pinned, we need to react to selection changes
    if (!isPinned.value) {
        stopSelectionEffect = effect(() => {
            // Access dependency
            void selectionState.selectedUid; 
            updateObject();
        });
    }
});

// React to params change (if panel is reused/pinned dynamically)
vueWatch(() => props.params, () => {
   updateObject();
}, { deep: true });


onUnmounted(() => {
    if (stopLogWatch) stopLogWatch();
    if (stopSelectionEffect) stopSelectionEffect();
    
    // If we are pinned, unregister our specific UID
    if (isPinned.value && object.value?.uid) {
        unregisterObjectInfoPanel(object.value.uid);
    } 
    
    // If we were the dynamic panel, clear the global tracking
    if (props.api?.id === 'info') {
        selectionState.panelId = undefined;
    }
});

// Actions
const goTo = () => {
    if (!object.value || !object.value.position) return;
    const coord = toWorldCoord(object.value.position);
    if (coord && game.gameView) {
        game.gameView.goTo(coord.x, coord.y);
    }
}

/**
 * 6- When this "pin icon" is clicked, the panel becomes a specified info panel on what it is showing,
 *    and there is no more "last selected info panel" (next object click might open a new one)
 */
const pin = () => {
    if (!object.value || !props.api) return;
    const uid = object.value.uid;
    
    // Register it as pinned first. 
    // This will notify App.vue's watcher to open the pinned panel.
    registerObjectInfoPanel(uid, `pinned:${uid}`);
    
    // Close the current 'info' panel.
    // App.vue will then open the new pinned panel because selectionState.selectedUid is still set.
    props.api.close();
    
    // Explicitly clear selectionState.panelId to ensure App.vue knows the dynamic panel is gone
    selectionState.panelId = undefined;
}

const simulateEnter = () => {
    console.log('[InfoWidget] simulateEnter', object.value?.uid);
    if (object.value) {
       mrg.hoveredObject = object.value;
    }
}

const simulateLeave = () => {
    console.log('[InfoWidget] simulateLeave', object.value?.uid);
    // Only clear if WE are the one being hovered off
    if (mrg.hoveredObject?.uid === object.value?.uid) {
        mrg.hoveredObject = undefined;
    }
}
</script>

<template>
  <div class="info-widget" @mouseenter="simulateEnter" @mouseleave="simulateLeave">
      <div v-if="object" class="content-wrapper">
          <header class="toolbar">
              <div class="title">{{ objectTitle }}</div>
              <div class="actions">
                  <Button icon="mdi:eye" @click="goTo" class="action-btn" />
                  <Button v-if="!isPinned" icon="mdi:pin" @click="pin" class="action-btn" />
              </div>
           </header>
          
          <div class="properties-container">
              <TileProperties v-if="String(object.isa) === 'Tile'" :tile="object" :game="game" />
              <CharacterProperties v-else-if="String(object.isa) === 'Character'" :character="object" :game="game" />
              <div v-else>
                  Unknown Object: {{ object.constructor.name }} (isa: {{ object.isa }})
                  <pre>{{ object.debugInfo }}</pre>
              </div>
          </div>

          <div class="logs-container" ref="logsContainer">
              <div v-for="(log, i) in logs" :key="i" class="log-line">{{ log }}</div>
          </div>
      </div>
      <div v-else class="empty-state">
          <p>No selection</p>
      </div>
  </div>
</template>

<style scoped>
.info-widget {
    height: 100%;
    display: flex;
    flex-direction: column;
    background: var(--pico-background-color);
    color: var(--pico-color);
    font-size: 0.9rem;
}
.content-wrapper {
    display: flex;
    flex-direction: column;
    height: 100%;
}
.toolbar {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 0.5rem;
    border-bottom: 1px solid var(--pico-muted-border-color);
    background: var(--pico-card-background-color);
}
.title {
    font-weight: bold;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
}
.actions {
    display: flex;
    gap: 0.25rem;
}
.action-btn {
    padding: 0.25rem; /* Compact */
}

.properties-container {
    padding: 0;
    overflow-y: auto;
    flex: 0 0 auto; /* Natural height up to a point? */
    max-height: 50%;
}

.logs-container {
    flex: 1;
    overflow-y: auto;
    border-top: 1px solid var(--pico-muted-border-color);
    background: var(--pico-card-background-color); /* slightly different */
    padding: 0;
    font-family: monospace;
    font-size: 0.8em;
}
.log-line {
    white-space: pre-wrap;
    border-bottom: 1px solid rgba(128,128,128,0.1);
}

.empty-state {
    padding: 2rem;
    text-align: center;
    color: var(--pico-muted-color);
}
</style>
