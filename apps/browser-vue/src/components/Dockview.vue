<script setup lang="ts">
import { ref, onMounted, onUnmounted, shallowRef, watch } from 'vue';
import { DockviewComponent } from 'dockview-core';
import 'dockview-core/dist/styles/dockview.css';
import { createApp, type Component } from 'vue';

const props = defineProps<{
    api?: DockviewComponent;
    widgets: Record<string, Component>;
    layout?: any;
    theme?: string;
}>();

const emit = defineEmits<{
    (e: 'update:layout', layout: any): void;
    (e: 'ready', api: DockviewComponent): void;
}>();

const container = ref<HTMLElement | null>(null);
const dockview = shallowRef<DockviewComponent | null>(null);

// Store active vue apps to unmount them later
const activeApps = new Map<string, any>();

// Store event disposables for cleanup
const disposables: { dispose: () => void }[] = [];

const updateTheme = (theme: string) => {
    if (!container.value) return;
    const themeName = theme || 'light';
    // dockview-core creates a child element where it applies its theme
    const dockviewRoot = container.value.firstElementChild as HTMLElement;
    if (!dockviewRoot) return;

    const classes = dockviewRoot.classList;
    // Remove all dockview themes
    Array.from(classes).forEach(c => {
        if (c.startsWith('dockview-theme-')) {
            classes.remove(c);
        }
    });
    classes.add(`dockview-theme-${themeName}`);
};

watch(() => props.theme, (newTheme) => {
    updateTheme(newTheme || 'light');
});

onMounted(() => {
    if (!container.value) return;
    updateTheme(props.theme || 'light');

    dockview.value = new DockviewComponent(container.value, {
        createComponent: (options) => {
            const component = props.widgets[options.name];
            if (component) {
                const el = document.createElement('div');
                el.style.width = '100%';
                el.style.height = '100%';

                let app: any = null;

                return {
                    element: el,
                    init: (params: any) => {
                         // params are passed here
                         if (!app) {
                             try {
                                 app = createApp(component, {
                                     params: params.params,
                                     api: params.api
                                 });
                                 app.mount(el);
                                 activeApps.set(options.id, app);
                             } catch (e) {
                                 console.error(`Failed to mount widget "${options.name}" (id: ${options.id}):`, e);
                                 el.innerHTML = `<div style="color: red; padding: 1rem;">Widget error: ${options.name}</div>`;
                             }
                         }
                    },
                    dispose: () => {
                        if (app) {
                            app.unmount();
                            activeApps.delete(options.id);
                        }
                        el.remove();
                    }
                };
            }

            // Fallback
            const el = document.createElement('div');
            el.innerText = `Unknown component: ${options.name}`;
            return {
                element: el,
                init: (_params) => {},
                dispose: () => { el.remove(); }
            };
        }
    });

    if (props.layout) {
        try {
            dockview.value.fromJSON(props.layout);
        } catch (e) {
            console.warn('Failed to restore dockview layout, using empty layout:', e);
        }
    }

    // Mark as ready after initial layout is applied
    const isReady = ref(false);
    isReady.value = true;

    // Track layout changes for persistence (debounced)
    let layoutUpdateTimer: any = null;
    disposables.push(
        dockview.value.onDidLayoutChange(() => {
            if (!isReady.value) return;
            
            if (layoutUpdateTimer) clearTimeout(layoutUpdateTimer);
            layoutUpdateTimer = setTimeout(() => {
                const layout = dockview.value?.toJSON();
                if (layout) {
                     emit('update:layout', layout);
                }
            }, 500);
        })
    );

    // Auto-close empty groups when last panel is removed
    disposables.push(
        dockview.value.onDidRemovePanel(() => {
            // After a panel is removed, check if its group is now empty
            // We need to defer this check since the group state updates after the event
            if (!dockview.value) return;

            // Find and remove empty groups
            for (const group of dockview.value.groups) {
                if (group.panels.length === 0) {
                    try {
                        // Ensure group is still attached before removing
                        if (dockview.value && dockview.value.groups.includes(group)) {
                            dockview.value.removeGroup(group);
                        }
                    } catch (e) {
                        // Group may already be disposed
                    }
                }
            }
        })
    );

    emit('ready', dockview.value);
});

onUnmounted(() => {
    // Clean up event listeners first
    disposables.forEach(d => d.dispose());
    disposables.length = 0;

    dockview.value?.dispose();
    activeApps.forEach(app => app.unmount());
    activeApps.clear();
});

</script>

<template>
  <div ref="container" class="dockview-container"></div>
</template>

<style>
/* Styles moved to global style.scss */
</style>
