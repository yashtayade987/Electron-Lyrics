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
}

let hudTimeout: number | undefined;

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
      const prevKey = `${state.currentSong.title}::${state.currentSong.artist}`;
      const nextKey = `${song.title ?? state.currentSong.title}::${song.artist ?? state.currentSong.artist}`;
      const isNewTrack = Boolean(
        (song.title && song.title !== state.currentSong.title) ||
        (song.artist && song.artist !== state.currentSong.artist) ||
        prevKey !== nextKey
      );

      // When a new track starts, wipe previous track ID and artwork so stale IDs/media never leak across songs
      const updatedSong: SongDetails = {
        ...state.currentSong,
        ...song,
        id: isNewTrack ? (song.id !== undefined ? song.id : null) : (song.id !== undefined ? song.id : state.currentSong.id),
        canvasUrl: isNewTrack ? (song.canvasUrl || null) : (song.canvasUrl !== undefined ? song.canvasUrl : state.currentSong.canvasUrl),
        videoId: isNewTrack ? song.videoId : (song.videoId !== undefined ? song.videoId : state.currentSong.videoId),
        animatedArtwork: isNewTrack && !song.animatedArtwork ? {
          available: false,
          source: null,
          videoUrl: null,
          videoTallUrl: null,
          previewUrl: null,
          artworkId: null
        } : (song.animatedArtwork ?? state.currentSong.animatedArtwork),
        animatedArtworkUrl: isNewTrack && !song.animatedArtworkUrl ? null : (song.animatedArtworkUrl ?? state.currentSong.animatedArtworkUrl),
        animatedArtworkTallUrl: isNewTrack && !song.animatedArtworkTallUrl ? null : (song.animatedArtworkTallUrl ?? state.currentSong.animatedArtworkTallUrl)
      };

      return {
        currentSong: updatedSong,
        // Clear manual override when the song changes, returning to Automatic mode
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
  }
}));


