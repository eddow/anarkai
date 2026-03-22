declare module 'pure-glyf/icons' {
    export function mount(): void;
    export const sheet: string;
    export function onInject(callback: (css: string) => void): void;
}