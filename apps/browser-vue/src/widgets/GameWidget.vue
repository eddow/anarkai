<script setup lang="ts">
import { onMounted, onUnmounted, ref } from 'vue';
import { GameView } from '@ssh/lib/game/game';
import { games, interactionMode, selectionState } from '@ssh/lib/globals';
import { Tile } from '@ssh/lib/game/board/tile';
import type { InteractiveGameObject } from '@ssh/lib/game';
import type { AlveolusType } from '@ssh/lib/types/base';

const props = defineProps<{
    params: { game: string };
    api?: any;
    container?: HTMLElement;
}>();

const containerRef = ref<HTMLElement | null>(null);
let gameView: GameView | undefined;

const handleProjectSelection = (object: InteractiveGameObject) => {
    selectionState.selectedUid = object.uid;
};

const handleBuildingAction = (_event: MouseEvent, object: InteractiveGameObject) => {
    if (!(object instanceof Tile)) return false;
    const action = interactionMode.selectedAction;
    const alveolusType = action.replace('build:', '') as AlveolusType;
    const success = object.build(alveolusType);
    return Boolean(success);
};

const handleZoningAction = (_event: MouseEvent, object: InteractiveGameObject) => {
    if (!(object instanceof Tile)) return false;
    const action = interactionMode.selectedAction;
    const zoneType = action.replace('zone:', '');
    if (zoneType === 'none') (object as any).zone = undefined;
    else (object as any).zone = zoneType as any;
    return true;
};

const handleZoningDrag = (tiles: Tile[]) => {
    const action = interactionMode.selectedAction;
    const zoneType = action.replace('zone:', '');
    for (const tile of tiles) {
        if (tile.content?.canInteract?.(action)) {
            if (zoneType === 'none') (tile as any).zone = undefined;
            else (tile as any).zone = zoneType as any;
        }
    }
};

const gameEvents = {
    objectClick(_event: MouseEvent, object: InteractiveGameObject) {
        if (_event.button !== 0) return;
        const action = interactionMode.selectedAction;
        if (action.startsWith('build:')) {
            const applied = handleBuildingAction(_event, object);
            if (applied && !_event.shiftKey) interactionMode.selectedAction = '';
            return;
        }
        if (action.startsWith('zone:')) {
            const applied = handleZoningAction(_event, object);
            if (applied && !_event.shiftKey) interactionMode.selectedAction = '';
            return;
        }
        handleProjectSelection(object);
    },
    objectDrag(tiles: Tile[], _event: MouseEvent) {
        if (!interactionMode.selectedAction.startsWith('zone:')) return;
        handleZoningDrag(tiles);
        if (!_event.shiftKey) interactionMode.selectedAction = '';
    },
};

onMounted(() => {
    if (!containerRef.value) return;

    const gameName = props.params?.game ?? 'GameX';
    const game = games.game(gameName);

    game.on(gameEvents);

    game.loaded.then(() => {
        if (containerRef.value && !gameView) {
            try {
                console.log('Mounting GameView');
                gameView = new GameView(game, containerRef.value);
                if (props.api?.accessor) {
                    // Validation moved to App.vue
                }
            } catch(e) {
                console.error('Failed to mount GameView', e);
            }
        }
    });

    // Use ResizeObserver for robust sizing across layout changes
    const resizeObserver = new ResizeObserver((entries) => {
        for (const entry of entries) {
            if (entry.target === containerRef.value && gameView?.pixi?.renderer) {
                const { width, height } = entry.contentRect;
                if (width > 0 && height > 0) {
                    gameView.resize(width, height);
                }
            }
        }
    });

    if (containerRef.value) {
        resizeObserver.observe(containerRef.value);
    }

    // Polling to ensure initial size is correct even if ResizeObserver misses the first frame
    const initInterval = setInterval(() => {
        if (gameView?.pixi?.renderer && containerRef.value) {
            const rect = containerRef.value.getBoundingClientRect();
            if (rect.width > 0 && rect.height > 0) {
                gameView.resize(rect.width, rect.height);
                clearInterval(initInterval);
            }
        }
    }, 100);

    onUnmounted(() => {
        resizeObserver.disconnect();
        clearInterval(initInterval);
    });
});

onUnmounted(() => {
    const gameName = props.params?.game ?? 'GameX';
    const game = games.game(gameName);
    game.off(gameEvents);

    if (gameView) {
        gameView.destroy();
        gameView = undefined;
    }
});


</script>

<template>
  <div ref="containerRef" class="docker-widget-game"></div>
</template>

<style scoped>
.docker-widget-game {
    width: 100%;
    height: 100%;
    overflow: hidden;
    background-color: var(--app-bg); /* Use theme background */
}
</style>
