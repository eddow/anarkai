import type { Plugin } from 'vite';

/**
 * Get common path aliases for Vite config.
 * @param projectRootDir - The root directory of the project
 */
export function getCommonAliases(projectRootDir: string): Record<string, string>;

export const commonOptimizeDeps: {
    exclude: string[];
    include: string[];
};

export const commonEsbuild: {
    target: string;
    tsconfigRaw: {
        compilerOptions: {
            experimentalDecorators: boolean;
        };
    };
};
