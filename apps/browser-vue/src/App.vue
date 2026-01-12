<script setup lang="ts">
import { ref, onMounted, shallowRef } from 'vue';
import { Button, Toolbar, ButtonGroup, ToolbarSpacer } from './components'; 
import Dockview from './components/Dockview.vue';
import ResourceImage from './components/ResourceImage.vue';
import { widgets } from './widgets';

// Import ssh globals and content
import * as gameContent from '$assets/game-content';
import { games, interactionMode, selectionState, getDockviewLayout, configuration as gameConfig, getObjectInfoPanelId, validateStoredSelectionState } from '@ssh/lib/globals';
import { configuration as uiConfig } from './lib/globals';
import { useMutts, useMuttsEffect } from './lib/mutts-vue';

const game = games.game('GameX');

// Dockview API Ref
const api = shallowRef<any>(null);

// Setup local state synced with globals
const LAYOUT_KEY = 'ssh-vue:dockview-layout';
const loadLayout = () => {
    const saved = localStorage.getItem(LAYOUT_KEY);
    if (saved) {
        try {
            return JSON.parse(saved);
        } catch (e) {
            console.warn('Failed to parse saved layout:', e);
        }
    }
    return getDockviewLayout();
};

const savedLayout = ref(loadLayout());

// Reactive State using Mutts Composables
const timeControl = useMutts(() => gameConfig.timeControl); 
const selectedAction = useMutts(() => interactionMode.selectedAction); 
const darkMode = useMutts(() => uiConfig.darkMode); 

// Helper Functions
const ensurePanel = (component: string, id: string, params?: any, options?: any) => {
    if (!api.value) return;
    
    // Defensive check: dockview might have the panel even if getPanel doesn't see it yet during restoration
    const existing = api.value.getPanel(id);
    if (existing) {
        if (params) existing.api.updateParameters(params);
        existing.focus();
        return;
    }
    
    const titles: Record<string, string> = {
        'game-view': 'Game',
        'system.configuration': 'Configuration',
        'info': 'Information'
    };
    
    let title = titles[id] || options?.title || id;
    if (id.startsWith('pinned:')) {
        const uid = id.replace('pinned:', '');
        const obj = game.getObject(uid);
        title = obj?.title || 'Pinned';
    }

    try {
        api.value.addPanel({
            id,
            component,
            params,
            title,
            floating: options?.floating === false ? undefined : {
                width: 400,
                height: 600
            }
        });
    } catch (e: any) {
        // If the error implies the panel already exists, we recover by finding and focusing it
        if (typeof e.toString === 'function' && e.toString().includes('already exists')) {
             console.warn(`Panel ${id} collision detected, recovering focus.`);
        } else {
             console.warn(`Failed to add panel ${id}:`, e);
        }
        
        // last ditch attempt to focus if it exists but lookup failed earlier
        const fallback = api.value.getPanel(id);
        if (fallback) {
            if (params) fallback.api.updateParameters(params);
            fallback.focus();
        }
    }
}

/**
 * Logic to open/focus the correct info panel for a given UID.
 * 5- When a selectable object is clicked, either his specific info panel is shown/focussed, 
 *    either, if it has none, the "last selected info panel" shows the properties.
 */
const openObjectInfoPanel = (uid: string) => {
    // Check if there is an existing pinned panel for this object
    const pinnedId = getObjectInfoPanelId(uid);
    if (pinnedId) {
        // If pinned panel exists, just focus it
        ensurePanel('info', pinnedId, { uid });
    } else {
        // Otherwise, update or create the shared 'info' panel
        ensurePanel('info', 'info', { uid });
    }
};

const openGamePanel = () => ensurePanel('game', 'game-view', { game: 'GameX' }, { floating: false });
const openConfigurationPanel = () => ensurePanel('configuration', 'system.configuration');

const onDockviewReady = (dockview: any) => {
    api.value = dockview;
    validateStoredSelectionState(dockview);
};

const updateLayout = (layout: any) => {
    // Validate layout before saving to prevent corrupt state
    // Dockview.toJSON() returns an object with 'grid' and 'panels' at the root level.
    if (!layout?.grid) {
        console.warn('Skipping save: layout missing grid structure');
        return;
    }

    // Check if layout has any content
    const hasPanels = layout.panels && Object.keys(layout.panels).length > 0;
    
    // Allow saving if there are panels, even if root complexity varies
    if (!hasPanels) {
         console.warn('Skipping save: layout has no panels');
         return;
    }

    try {
        localStorage.setItem(LAYOUT_KEY, JSON.stringify(layout));
        // Update the ref so that if the component re-renders it has the latest state
        savedLayout.value = layout;
    } catch (e) {
        // Handle quota exceeded or other storage errors
        console.warn('Failed to save layout to localStorage:', e);
    }
};

const setValidation = (val: string) => {
    console.log('Setting timeControl to:', val);
    gameConfig.timeControl = val as any;
}
const setAction = (val: string) => {
    interactionMode.selectedAction = val;
}
const toggleDarkMode = () => {
    uiConfig.darkMode = !uiConfig.darkMode;
}

// Sync mutts -> vue Lifecycle
onMounted(() => {
    // Watch for interactions that should auto-open info panel
    useMuttsEffect(() => {
        const action = interactionMode.selectedAction;
        const uid = selectionState.selectedUid;
        
        // We also want to react to changes in the pinned panels map
        // so that if an object becomes pinned, we switch focus to the pinned panel.
        // Reading it here ensures the effect re-runs when the map changes for this UID.
        if (uid) void getObjectInfoPanelId(uid);

        if (action === '' && uid) {
            openObjectInfoPanel(uid);
        } else if (action === '' && !uid) {
            // Close dynamic info panel if selection is cleared
            // But don't close pinned panels!
            const existing = api.value?.getPanel('info');
            // Avoid redundant close calls that might trigger Dockview group errors
            if (existing && !existing.api.isDisposed) {
                existing.close();
            }
        }
    });

    // Dark mode CSS sync
    useMuttsEffect(() => {
        const dark = uiConfig.darkMode;
        console.log('Reactivity: darkMode changed to', dark);
        if (dark) document.documentElement.setAttribute('data-theme', 'dark');
        else document.documentElement.setAttribute('data-theme', 'light');
    });

    // Initial layout check
    // 1- There is no "info" panel opened by default.
    if (!savedLayout.value) {
        openGamePanel();
    }
});

// Constants
const timeControls = [
	{ value: 'pause', label: 'Pause', icon: 'mdi:pause' },
	{ value: 'play', label: 'Play', icon: 'mdi:play' },
	{ value: 'fast-forward', label: 'Fast Forward', icon: 'mdi:fast-forward' },
	{ value: 'gonzales', label: 'Gonzales', icon: 'mdi:fast-forward-outline' },
] as const;

const zoneActions = [
	{ value: 'zone:residential', label: 'Residential', icon: 'mdi:home-group' },
	{ value: 'zone:harvest', label: 'Harvest', icon: 'mdi:tree' },
	{ value: 'zone:none', label: 'Unzone', icon: 'mdi:eraser' },
] as const;

const buildableAlveoli = Object.entries(gameContent.alveoli).filter(
	([, alveolus]) => 'construction' in alveolus,
);
</script>

<template>
  <div class="app-shell" :data-theme="darkMode ? 'dark' : 'light'">
    <Toolbar>
        <ButtonGroup>
            <Button icon="mdi:settings" aria-label="Open configuration" @click="openConfigurationPanel" />
            <Button icon="mdi:plus" aria-label="Open game view" @click="openGamePanel" />
        </ButtonGroup>
        <ToolbarSpacer visible />
        <ButtonGroup>
             <Button 
                v-for="opt in timeControls"
                :key="opt.value"
                :icon="opt.icon"
                :title="opt.label"
                :active="timeControl === opt.value"
                @click="setValidation(opt.value)"
             />
        </ButtonGroup>
        <ToolbarSpacer visible />
        <ButtonGroup>
            <Button 
                icon="mdi:cursor-default-outline"
                aria-label="Select mode"
                :active="selectedAction === ''"
                @click="setAction('')"
            />
        </ButtonGroup>
        <ToolbarSpacer visible />
         <ButtonGroup>
             <Button
                v-for="[name, alveolus] in buildableAlveoli"
                :key="name"
                :aria-label="`Build ${name}`"
                :active="selectedAction === `build:${name}`"
                @click="setAction(`build:${name}`)"
                :id="`build-alveolus-${name}`"
             >
                <ResourceImage 
                    :game="game"
                    :sprite="alveolus.sprites?.[0]"
                    :width="24"
                    :height="24"
                    :alt="name"
                />
             </Button>
         </ButtonGroup>
        <ToolbarSpacer visible />
        <ButtonGroup>
             <Button
                v-for="zone in zoneActions"
                :key="zone.value"
                :icon="zone.icon"
                :title="zone.label"
                :active="selectedAction === zone.value"
                @click="setAction(zone.value)"
             />
        </ButtonGroup>
        <ToolbarSpacer />
        <Button 
            data-testid="toggle-theme"
            :icon="darkMode ? 'mdi:weather-night' : 'mdi:weather-sunny'"
            @click="toggleDarkMode"
        />
    </Toolbar>
    
    <main class="app-main">
        <Dockview 
            :widgets="widgets" 
            :layout="savedLayout" 
            :theme="darkMode ? 'dark' : 'light'"
            @ready="onDockviewReady"
            @update:layout="updateLayout"
        />
    </main>
  </div>
</template>

<style scoped>
/* Scoped styles removed to allow global style.scss to control layout */
</style>
