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
  videoId?: string;
  canvasUrl?: string | null;
  _origin?: 'windows_media' | 'extension';
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
  // Audio source selection: 'web' | 'desktop'
  sourceMode: 'web' | 'desktop';
  lastDesktopSong: SongDetails | null;
  lastWebSong: SongDetails | null;
  setSourceMode: (mode: 'web' | 'desktop') => void;
  updateSourceProgress: (origin: 'windows_media' | 'extension', progress: number, isPlaying: boolean, duration?: number) => void;
}

const emptySongDetails: SongDetails = {
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
  videoId: undefined,
  canvasUrl: null
};

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
    ...emptySongDetails
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
      const origin = song._origin;
      const isFromDesktop = origin === 'windows_media';
      const isFromWeb = origin === 'extension';

      // Pick previous track of the same source origin to cleanly merge updates
      const prevSourceSong = isFromDesktop
        ? state.lastDesktopSong
        : isFromWeb
        ? state.lastWebSong
        : state.currentSong;

      const baseSong = prevSourceSong || emptySongDetails;

      const isSame = isSameSong(
        baseSong.title,
        baseSong.artist,
        song.title,
        song.artist
      );

      // Only mark as a genuinely new track if titles and artists do NOT match
      const isNewTrack = !isSame && Boolean(
        song.title &&
        song.title !== baseSong.title &&
        baseSong.title !== 'No song playing'
      );

      // Preserve existing animated artwork and canvasUrl when updates arrive for the same playing track
      const preservedAnimatedArtwork = isSame ? baseSong.animatedArtwork : {
        available: false,
        source: null,
        videoUrl: null,
        videoTallUrl: null,
        previewUrl: null,
        artworkId: null
      };

      const effectiveCanvasUrl = (song.canvasUrl && typeof song.canvasUrl === 'string' && song.canvasUrl.startsWith('http'))
        ? song.canvasUrl
        : (isSame ? baseSong.canvasUrl : null);

      const nextArtwork = song.animatedArtwork ?? (
        (isSame && baseSong.animatedArtwork?.available && baseSong.animatedArtwork?.videoUrl)
          ? baseSong.animatedArtwork
          : preservedAnimatedArtwork
      );

      let safeCoverArt = baseSong.coverArt;
      const rawCover: unknown = song.coverArt;
      if (rawCover !== undefined) {
        if (typeof rawCover === 'string') {
          safeCoverArt = rawCover;
        } else if (Array.isArray(rawCover)) {
          safeCoverArt = (rawCover.find((c: unknown) => typeof c === 'string' && c.length > 0) as string) || '';
        } else {
          safeCoverArt = '';
        }
      }

      const updatedSong: SongDetails = {
        ...baseSong,
        ...song,
        coverArt: safeCoverArt,
        progress: isNewTrack
          ? (song.progress !== undefined ? song.progress : 0)
          : (song.progress !== undefined ? song.progress : baseSong.progress),
        id: (song.id !== undefined && song.id !== null)
          ? song.id
          : (isSame ? baseSong.id : null),
        canvasUrl: effectiveCanvasUrl,
        videoId: (song.videoId !== undefined)
          ? song.videoId
          : (isSame ? baseSong.videoId : undefined),
        animatedArtwork: nextArtwork,
        _origin: origin || baseSong._origin
      };

      const nextDesktop = isFromDesktop ? updatedSong : state.lastDesktopSong;
      const nextWeb = isFromWeb ? updatedSong : state.lastWebSong;

      // Only update currentSong if incoming update matches current sourceMode or if no origin specified
      const shouldApplyToCurrent = (state.sourceMode === 'desktop' && isFromDesktop) ||
                                  (state.sourceMode === 'web' && isFromWeb) ||
                                  (!origin);

      return {
        currentSong: shouldApplyToCurrent ? updatedSong : state.currentSong,
        lastDesktopSong: nextDesktop,
        lastWebSong: nextWeb,
        // Clear manual override ONLY on a genuine track change on active track
        manualArtworkOverride: (shouldApplyToCurrent && isNewTrack) ? null : state.manualArtworkOverride
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
            }
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
          }
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

  lyricMode: (localStorage.getItem('lyric-engine-mode') as 'auto' | 'line' | 'word') || 'word',
  setLyricMode: (lyricMode) => {
    localStorage.setItem('lyric-engine-mode', lyricMode);
    set({ lyricMode });
  },
  syncOffsetMs: (() => {
    const saved = localStorage.getItem('lyric-sync-offset-ms');
    return saved !== null ? (parseInt(saved, 10) || 0) : 0;
  })(),
  setSyncOffsetMs: (syncOffsetMs) => {
    localStorage.setItem('lyric-sync-offset-ms', String(syncOffsetMs));
    set({ syncOffsetMs });
  },
  adjustSyncOffsetMs: (delta) => {
    let newOffset = 0;
    set((state) => {
      newOffset = Math.max(-5000, Math.min(5000, state.syncOffsetMs + delta));
      localStorage.setItem('lyric-sync-offset-ms', String(newOffset));
      return { syncOffsetMs: newOffset };
    });
    return newOffset;
  },
  sourceMode: (localStorage.getItem('preferred-source-mode') as 'web' | 'desktop') || 'web',
  lastDesktopSong: null,
  lastWebSong: null,
  setSourceMode: (mode) => {
    localStorage.setItem('preferred-source-mode', mode);
    set((state) => {
      const targetSong = mode === 'desktop' ? state.lastDesktopSong : state.lastWebSong;
      if (targetSong && targetSong.title && targetSong.title !== 'No song playing') {
        return {
          sourceMode: mode,
          currentSong: targetSong
        };
      }
      return {
        sourceMode: mode,
        currentSong: {
          ...emptySongDetails,
          title: 'No song playing',
          artist: mode === 'desktop' ? 'Waiting for Desktop App...' : 'Waiting for Web Player...',
          isPlaying: false,
          coverArt: '',
          duration: 0,
          progress: 0,
          source: null,
          _origin: mode === 'desktop' ? 'windows_media' : 'extension'
        }
      };
    });
  },
  updateSourceProgress: (origin, progress, isPlaying, duration) =>
    set((state) => {
      const isDesktop = origin === 'windows_media';
      const targetProp = isDesktop ? 'lastDesktopSong' : 'lastWebSong';
      const targetSong = state[targetProp];
      const updatedTarget = targetSong ? {
        ...targetSong,
        progress,
        isPlaying,
        ...(duration && duration > 0 ? { duration } : {})
      } : null;

      const shouldApplyToCurrent = (state.sourceMode === 'desktop' && isDesktop) ||
                                  (state.sourceMode === 'web' && !isDesktop);

      if (shouldApplyToCurrent && state.currentSong) {
        return {
          [targetProp]: updatedTarget,
          currentSong: {
            ...state.currentSong,
            progress,
            isPlaying,
            ...(duration && duration > 0 && (!state.currentSong.duration || state.currentSong.duration === 0) ? { duration } : {})
          }
        };
      }

      return {
        [targetProp]: updatedTarget
      };
    })
}));


