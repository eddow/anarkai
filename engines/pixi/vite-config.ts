import { resolve as resolvePath } from 'node:path'

export function getCommonAliases(projectRootDir: string) {
    return {
        '@ssh': resolvePath(projectRootDir, '../../engines/ssh/src'),
        'engine-pixi': resolvePath(projectRootDir, '../../engines/pixi'),
        'ssh': resolvePath(projectRootDir, '../../engines/ssh'),
        '$lib': resolvePath(projectRootDir, '../../engines/ssh/src/lib'),
        '$assets': resolvePath(projectRootDir, '../../engines/ssh/assets'),
    }
}

export const commonOptimizeDeps = {
    exclude: ['ssh', 'engine-pixi', 'mutts', 'npc-script', 'omni18n', 'pounce-ts', 'pounce-ui'],
    include: [
        'pixi.js',
        'arktype',
        '@ark/schema',
        '@ark/util',
        'earcut',
        'tiny-lru',
        '@pixi/colord',
        '@pixi/colord/plugins/names',
        'parse-svg-path',
        'ismobilejs',
        '@xmldom/xmldom',
        'eventemitter3'
    ]
}

export const commonEsbuild = {
    target: 'es2022',
    tsconfigRaw: {
        compilerOptions: {
            experimentalDecorators: true,
        },
    },
}
