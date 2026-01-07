<script setup lang="ts">
import { ref, watchEffect, toRefs } from 'vue';
import type { Game } from '@ssh/lib/game';
import { computeStyleFromTexture } from '@ssh/lib/utils/images';

const props = defineProps<{
    game: Game;
    sprite?: any; // Ssh.Sprite
    width?: number;
    height?: number;
    alt?: string;
    class?: string;
}>();

const style = ref('');

watchEffect(() => {
    const { game, sprite, width, height } = props;
    if (!game || !sprite) {
        style.value = '';
        return;
    }

    void (async () => {
        await game.loaded
        const texture = game.getTexture(sprite)
        let targetWidth = width
        let targetHeight = height
        const frame = texture?.frame ?? { width: texture?.width ?? 0, height: texture?.height ?? 0 }
        const realWidth = frame?.width ?? texture?.width ?? 0
        const realHeight = frame?.height ?? texture?.height ?? 0

        if (targetHeight !== undefined && targetWidth === undefined) {
            targetWidth = (targetHeight * realWidth) / Math.max(realHeight, 1)
        } else if (targetWidth !== undefined && targetHeight === undefined) {
            targetHeight = (targetWidth * realHeight) / Math.max(realWidth, 1)
        }

        const backgroundStyle = computeStyleFromTexture(texture, {
            width: targetWidth,
            height: targetHeight,
        })
        const dimensions =
            targetWidth !== undefined && targetHeight !== undefined
                ? `width: ${targetWidth}px; height: ${targetHeight}px;`
                : ''
        style.value = `${dimensions}${backgroundStyle}`
    })();
});
</script>

<template>
  <div 
    class="ssh-resource-image" 
    :class="props.class" 
    :style="style"
    :title="alt"
    :aria-label="alt"
  ></div>
</template>

<style scoped>
.ssh-resource-image {
    display: inline-block;
    background-repeat: no-repeat;
}
</style>
