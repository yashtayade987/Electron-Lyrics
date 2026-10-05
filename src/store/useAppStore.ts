import { create } from 'zustand';
import type { LyricsData } from '../utils/lyricsProvider';
import type { AnimatedArtworkData, ArtworkSource } from '../utils/artwork/types';

export type { AnimatedArtworkData, ArtworkSource };

interface SongDetails {
  id: string | null;
  title: string;
  artist: string;
  album: string;
  coverArt: string;
  duration: number;
  progress: number;
  isPlaying: boolean;
  source: 'youtube' | 'spotify' | 'apple' | null;
  isExplicit?: boolean;
  animatedArtwork?: AnimatedArtworkData;
  animatedArtworkUrl?: string | null;
  animatedArtworkTallUrl?: string | null;
  videoId?: string;
  canvasUrl?: string | null;
}

interface AppState {
  // Song Data
  currentSong: SongDetails;
  setSong: (song: Partial<SongDetails>) => void;
  setAnimatedArtwork: (artwork: Partial<AnimatedArtworkData> | null) => void;
  updateProgress: (progress: number) => void;
  setIsPlaying: (isPlaying: boolean) => void;

  // Animated Artwork Preference & Manual Overrides
  artworkPreference: 'auto' | 'always_normal';
  setArtworkPreference: (pref: 'auto' | 'always_normal') => void;
  manualArtworkOverride: { trackKey: string; override: 'animated' | 'normal' } | null;
  setManualArtworkOverride: (trackKey: string, override: 'animated' | 'normal') => void;
  clearManualArtworkOverride: () => void;

  // Lyrics shared state
  lyrics: LyricsData | null;
  lyricsLoading: boolean;
  setLyrics: (lyrics: LyricsData | null) => void;
  setLyricsLoading: (loading: boolean) => void;

  // UI State
  isRomanized: boolean;
  toggleRomanized: () => void;
  backgroundType: 'dynamic' | 'static' | 'color';
  setBackgroundType: (type: 'dynamic' | 'static' | 'color') => void;
  theme: 'dynamic' | 'dark' | 'light';
  setTheme: (theme: 'dynamic' | 'dark' | 'light') => void;

  // Connection state
  isConnected: boolean;
  setIsConnected: (connected: boolean) => void;

  lastPlayPauseTime: number;
  setManualPlayPause: (isPlaying: boolean) => void;

  // macOS Native UI States
  hudMessage: string | null;
  showHud: (msg: string) => void;

  // Lyric sync & display mode
  lyricMode: 'auto' | 'line' | 'word';
  setLyricMode: (mode: 'auto' | 'line' | 'word') => void;
  syncOffsetMs: number;
  setSyncOffsetMs: (offset: number) => void;
  adjustSyncOffsetMs: (delta: number) => number;
}

let hudTimeout: number | undefined;

/**
 * Normalizes and compares song metadata to detect if two updates represent the same track,
 * handling variations in feature artists, clean/explicit tags, casing, and localized names.
 */
export function isSameSong(
  prevTitle: string | null | undefined,
  prevArtist: string | null | undefined,
  nextTitle: string | null | undefined,
  nextArtist: string | null | undefined
): boolean {
  if (!prevTitle || !nextTitle) return false;
  if (prevTitle === 'No song playing' || nextTitle === 'No song playing') return false;

  const normalize = (s: string) =>
    s
      .toLowerCase()
      .replace(/\(feat\..*?\)/gi, '')
      .replace(/\[feat\..*?\]/gi, '')
      .replace(/\(with.*?\)/gi, '')
      .replace(/\[with.*?\]/gi, '')
      .replace(/\(official.*?video.*?\)/gi, '')
      .replace(/\[official.*?video.*?\]/gi, '')
      .replace(/\(official.*?audio.*?\)/gi, '')
      .replace(/\[official.*?audio.*?\]/gi, '')
      .replace(/\(clean.*?ver.*?\)/gi, '')
      .replace(/\[clean.*?ver.*?\]/gi, '')
      .replace(/\(explicit.*?\)/gi, '')
      .replace(/\[explicit.*?\]/gi, '')
      .replace(/\(.*?\)|\[.*?\]/g, '')
      .replace(/[^a-z0-9\u00C0-\u024F\u1100-\u11FF\u3130-\u318F\uAC00-\uD7AF\u3040-\u30FF\u4E00-\u9FFF]/gi, ' ')
      .replace(/\s+/g, ' ')
      .trim();

  const normPrevT = normalize(prevTitle);
  const normNextT = normalize(nextTitle);

  const titlesMatch = normPrevT === normNextT ||
    (normPrevT.length >= 3 && normNextT.length >= 3 && (normPrevT.includes(normNextT) || normNextT.includes(normPrevT)));

  if (!titlesMatch) return false;

  if (prevArtist && nextArtist) {
    const normPrevA = normalize(prevArtist);
    const normNextA = normalize(nextArtist);
    if (normPrevA === normNextA) return true;
    if (normPrevA.includes(normNextA) || normNextA.includes(normPrevA)) return true;

    const wordsA = normPrevA.split(' ').filter((w) => w.length > 2);
    const wordsB = normNextA.split(' ').filter((w) => w.length > 2);
    const commonWord = wordsA.some((w) => wordsB.includes(w));
    if (commonWord) return true;
  }

  return titlesMatch;
}

export const useAppStore = create<AppState>((set) => ({
  currentSong: {
    id: null,
    title: 'No song playing',
    artist: 'Waiting for connection...',
    album: '',
    coverArt: '',
    duration: 0,
    progress: 0,
    isPlaying: false,
    source: null,
    isExplicit: false,
    animatedArtwork: {
      available: false,
      source: null,
      videoUrl: null,
      videoTallUrl: null,
      previewUrl: null,
      artworkId: null
    },
    animatedArtworkUrl: null,
    animatedArtworkTallUrl: null,
    videoId: undefined,
    canvasUrl: null
  },
  lyrics: null,
  lyricsLoading: false,
  setLyrics: (lyrics) => set({ lyrics }),
  setLyricsLoading: (lyricsLoading) => set({ lyricsLoading }),

  artworkPreference: (localStorage.getItem('artworkPreference') as 'auto' | 'always_normal') || 'auto',
  setArtworkPreference: (artworkPreference) => {
    localStorage.setItem('artworkPreference', artworkPreference);
    set({ artworkPreference });
  },

  manualArtworkOverride: null,
  setManualArtworkOverride: (trackKey, override) =>
    set({ manualArtworkOverride: { trackKey, override } }),
  clearManualArtworkOverride: () => set({ manualArtworkOverride: null }),

  setSong: (song) =>
    set((state) => {
      const isSame = isSameSong(
        state.currentSong.title,
        state.currentSong.artist,
        song.title,
        song.artist
      );

      // Only mark as a genuinely new track if titles and artists do NOT match the current song
      const isNewTrack = !isSame && Boolean(
        song.title &&
        song.title !== state.currentSong.title &&
        state.currentSong.title !== 'No song playing'
      );

      // Preserve existing animated artwork and canvasUrl when updates arrive for the same playing track
      const preservedAnimatedArtwork = isSame ? state.currentSong.animatedArtwork : {
        available: false,
        source: null,
        videoUrl: null,
        videoTallUrl: null,
        previewUrl: null,
        artworkId: null
      };

      const preservedAnimatedArtworkUrl = isSame ? state.currentSong.animatedArtworkUrl : null;
      const preservedAnimatedArtworkTallUrl = isSame ? state.currentSong.animatedArtworkTallUrl : null;

      const effectiveCanvasUrl = (song.canvasUrl && typeof song.canvasUrl === 'string' && song.canvasUrl.startsWith('http'))
        ? song.canvasUrl
        : (isSame ? state.currentSong.canvasUrl : null);

      const nextArtwork = song.animatedArtwork ?? (
        (isSame && state.currentSong.animatedArtwork?.available && state.currentSong.animatedArtwork?.videoUrl)
          ? state.currentSong.animatedArtwork
          : preservedAnimatedArtwork
      );

      const nextVideoUrl = song.animatedArtworkUrl ?? (
        song.animatedArtwork ? song.animatedArtwork.videoUrl : preservedAnimatedArtworkUrl
      );

      const nextVideoTallUrl = song.animatedArtworkTallUrl ?? (
        song.animatedArtwork ? (song.animatedArtwork.videoTallUrl || song.animatedArtwork.videoUrl) : preservedAnimatedArtworkTallUrl
      );

      const updatedSong: SongDetails = {
        ...state.currentSong,
        ...song,
        progress: isNewTrack
          ? (song.progress !== undefined ? song.progress : 0)
          : (song.progress !== undefined ? song.progress : state.currentSong.progress),
        id: (song.id !== undefined && song.id !== null)
          ? song.id
          : (isSame ? state.currentSong.id : null),
        canvasUrl: effectiveCanvasUrl,
        videoId: (song.videoId !== undefined)
          ? song.videoId
          : (isSame ? state.currentSong.videoId : undefined),
        animatedArtwork: nextArtwork,
        animatedArtworkUrl: nextVideoUrl,
        animatedArtworkTallUrl: nextVideoTallUrl
      };

      return {
        currentSong: updatedSong,
        // Clear manual override ONLY on a genuine track change, never on same-song metadata updates
        manualArtworkOverride: isNewTrack ? null : state.manualArtworkOverride
      };
    }),
  setAnimatedArtwork: (artwork) =>
    set((state) => {
      if (!artwork || !artwork.videoUrl) {
        return {
          currentSong: {
            ...state.currentSong,
            animatedArtwork: {
              available: false,
              source: null,
              videoUrl: null,
              videoTallUrl: null,
              previewUrl: null,
              artworkId: null
            },
            animatedArtworkUrl: null,
            animatedArtworkTallUrl: null
          }
        };
      }
      const videoTall = artwork.videoTallUrl || artwork.videoUrl;
      return {
        currentSong: {
          ...state.currentSong,
          animatedArtwork: {
            available: artwork.available ?? true,
            source: artwork.source ?? 'apple_music',
            videoUrl: artwork.videoUrl,
            videoTallUrl: videoTall,
            previewUrl: artwork.previewUrl ?? state.currentSong.coverArt,
            artworkId: artwork.artworkId ?? null
          },
          animatedArtworkUrl: artwork.videoUrl,
          animatedArtworkTallUrl: videoTall
        }
      };
    }),
  updateProgress: (progress) =>
    set((state) => ({ currentSong: { ...state.currentSong, progress } })),
  setIsPlaying: (isPlaying) =>
    set((state) => {
      // Ignore automated websocket updates if a local user click happened in the last 2 seconds
      if (Date.now() - state.lastPlayPauseTime < 2000) {
        return state;
      }
      return { currentSong: { ...state.currentSong, isPlaying } };
    }),

  lastPlayPauseTime: 0,
  setManualPlayPause: (isPlaying) =>
    set((state) => ({
      currentSong: { ...state.currentSong, isPlaying },
      lastPlayPauseTime: Date.now()
    })),

  isRomanized: false,
  toggleRomanized: () => set((state) => ({ isRomanized: !state.isRomanized })),
  backgroundType: 'dynamic',
  setBackgroundType: (type) => set({ backgroundType: type }),
  theme: (localStorage.getItem('theme') as 'dynamic' | 'dark' | 'light') || 'dynamic',
  setTheme: (theme) => set({ theme }),

  isConnected: false,
  setIsConnected: (connected) => set({ isConnected: connected }),

  hudMessage: null,
  showHud: (msg: string) => {
    if (hudTimeout) clearTimeout(hudTimeout);
    set({ hudMessage: msg });
    hudTimeout = window.setTimeout(() => {
      set({ hudMessage: null });
    }, 1500);
  },

  lyricMode: (localStorage.getItem('lyric-engine-mode') as 'auto' | 'line' | 'word') || 'auto',
  setLyricMode: (lyricMode) => {
    localStorage.setItem('lyric-engine-mode', lyricMode);
    set({ lyricMode });
  },
  syncOffsetMs: 600,
  setSyncOffsetMs: (syncOffsetMs) => set({ syncOffsetMs }),
  adjustSyncOffsetMs: (delta) => {
    let newOffset = 600;
    set((state) => {
      newOffset = Math.max(-5000, Math.min(5000, state.syncOffsetMs + delta));
      return { syncOffsetMs: newOffset };
    });
    return newOffset;
  }
}));


