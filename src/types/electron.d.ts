export {};

declare global {
    interface Window {
        electron?: {
            close: () => void;
            minimize: () => void;
            togglePin: (isPinned: boolean) => void;
            musicCommand: (command: string) => void;
            openExternal?: (url: string) => void;
            resize?: (params: { direction: string; deltaX: number; deltaY: number }) => void;
            triggerRepaint?: () => void;
            switchSource?: (source: 'web' | 'desktop') => void;
        };
    }
}
