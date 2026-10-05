import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export interface EffectsState {
    lyricMode: 'auto' | 'line' | 'word';
    setLyricMode: (mode: 'auto' | 'line' | 'word') => void;
    syncOffsetMs: number;
    setSyncOffsetMs: (offset: number) => void;
    adjustSyncOffsetMs: (delta: number) => number;
}

export const useEffectsStore = create<EffectsState>()(
    persist(
        (set, get) => ({
            lyricMode: 'auto',
            setLyricMode: (mode) => set({ lyricMode: mode }),
            syncOffsetMs: 0,
            setSyncOffsetMs: (syncOffsetMs) => set({ syncOffsetMs }),
            adjustSyncOffsetMs: (delta) => {
                const newOffset = Math.max(-5000, Math.min(5000, get().syncOffsetMs + delta));
                set({ syncOffsetMs: newOffset });
                return newOffset;
            },
        }),
        {
            name: 'lyric-engine-prefs',
        }
    )
);
