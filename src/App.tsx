import { useEffect, useRef } from 'react';
import { Layout } from './components/layout/Layout';
import { LyricsContainer } from './components/lyrics/LyricsContainer';
import { useAppStore } from './store/useAppStore';
import { useEffectsStore } from './store/useEffectsStore';
import { artworkResolver } from './utils/artwork/ArtworkResolver';
import { spotifyArtworkProvider } from './utils/artwork/SpotifyArtworkProvider';
import type { ArtworkTrackInfo } from './utils/artwork/types';
import { lyricsProvider } from './utils/lyricsProvider';
import { cleanMetadata } from './utils/spicyLyricsProvider';
import { io } from 'socket.io-client';

const socket = io('http://localhost:4000', {
  autoConnect: false
});

// Cache for fetched lyrics to prevent reloading across re-renders or repeat songs
const lyricsCache = new Map<string, any>();

function App() {
  const theme = useAppStore((s) => s.theme);
  const setIsConnected = useAppStore((s) => s.setIsConnected);
  const setSong = useAppStore((s) => s.setSong);
  const setIsPlaying = useAppStore((s) => s.setIsPlaying);
  const updateProgress = useAppStore((s) => s.updateProgress);
  const setLyrics = useAppStore((s) => s.setLyrics);
  const setLyricsLoading = useAppStore((s) => s.setLyricsLoading);
  const setAnimatedArtwork = useAppStore((s) => s.setAnimatedArtwork);
  const artworkPreference = useAppStore((s) => s.artworkPreference);
  const manualArtworkOverride = useAppStore((s) => s.manualArtworkOverride);

  // Fine-grained metadata selectors (never re-renders on playback progress ticks)
  const songTitle = useAppStore((s) => s.currentSong.title);
  const songArtist = useAppStore((s) => s.currentSong.artist);
  const songAlbum = useAppStore((s) => s.currentSong.album);
  const songDuration = useAppStore((s) => s.currentSong.duration);
  const songSource = useAppStore((s) => s.currentSong.source);
  const songId = useAppStore((s) => s.currentSong.id);
  const songCanvasUrl = useAppStore((s) => s.currentSong.canvasUrl);
  const songCoverArt = useAppStore((s) => s.currentSong.coverArt);
  const songVideoId = useAppStore((s) => s.currentSong.videoId);
  const animatedArtwork = useAppStore((s) => s.currentSong.animatedArtwork);

  const currentSongKeyRef = useRef<string>('');

  useEffect(() => {
    document.body.classList.remove('theme-dynamic', 'theme-dark', 'theme-light');
    document.body.classList.add(`theme-${theme}`);
    localStorage.setItem('theme', theme);
  }, [theme]);

  useEffect(() => {
    // Connect to local websocket server that extension talks to
    socket.connect();

    socket.on('connect', () => {
      setIsConnected(true);
      console.log("[App] Connected to browser extension bridge");
    });

    socket.on('disconnect', () => {
      setIsConnected(false);
      console.log("[App] Disconnected from browser extension bridge");
    });

    socket.on('song_update', (songData) => {
      console.log("[App] Received song_update:", songData.title, "by", songData.artist, "(Source:", songData.source, ")");
      if (songData.spotifyToken) {
        spotifyArtworkProvider.setCachedUserToken(songData.spotifyToken);
      }
      setSong({
        id: songData.id,
        title: songData.title,
        artist: songData.artist,
        album: songData.album,
        coverArt: songData.coverArt,
        duration: songData.duration,
        source: songData.source,
        videoId: songData.videoId,
        canvasUrl: songData.canvasUrl || null,
        isExplicit: songData.isExplicit ?? (
          /\b(explicit|dirty)\b/i.test(songData.title || '') ||
          /\b(explicit|dirty)\b/i.test(songData.album || '')
        ),
      });
      setIsPlaying(songData.isPlaying);
      updateProgress(songData.progress);
    });

    socket.on('canvas_update', (canvasData) => {
      console.log("[App] Received async canvas_update:", canvasData);
      if (canvasData.spotifyToken) {
        spotifyArtworkProvider.setCachedUserToken(canvasData.spotifyToken);
      }
      if (canvasData.canvasUrl) {
        const current = useAppStore.getState().currentSong;

        // If Apple Music is playing and already has its Priority 1 active Apple Music artwork, do not overwrite
        if (current.source === 'apple' && current.animatedArtwork?.available && current.animatedArtwork?.source === 'apple_music') {
          return;
        }

        // Check if trackId matches (if both specified)
        if (canvasData.trackId && current.id && current.id !== canvasData.trackId) {
          return;
        }

        console.log('[App] Applying Spotify Canvas:', canvasData.canvasUrl);
        setSong({ canvasUrl: canvasData.canvasUrl, id: current.id || canvasData.trackId || null });
        const artworkData = {
          available: true,
          source: 'spotify' as const,
          videoUrl: canvasData.canvasUrl,
          videoTallUrl: canvasData.canvasUrl,
          previewUrl: current.coverArt,
          artworkId: canvasData.trackId || current.id
        };
        artworkResolver.setCachedArtwork(
          {
            id: canvasData.trackId || current.id,
            title: current.title,
            artist: current.artist,
            album: current.album,
            duration: current.duration,
            coverArt: current.coverArt,
            source: current.source,
            canvasUrl: canvasData.canvasUrl
          },
          current.source,
          artworkData
        );
        setAnimatedArtwork(artworkData);
      }
    });

    socket.on('progress_update', (progressData) => {
      const current = useAppStore.getState().currentSong;
      if (!current.title || current.title === 'No song playing') {
        setIsPlaying(progressData.isPlaying);
        updateProgress(progressData.progress);
        return;
      }

      // If incoming update specifies a title, verify it matches current song
      if (progressData.title && current.title) {
        const normIncoming = progressData.title.trim().toLowerCase();
        const normCurrent = current.title.trim().toLowerCase();
        if (normIncoming !== normCurrent && !normIncoming.includes(normCurrent) && !normCurrent.includes(normIncoming)) {
          return;
        }
      }

      // If incoming update is from a different source while current song is active, ignore
      if (progressData.source && current.source && progressData.source !== current.source) {
        if (current.isPlaying && !progressData.isPlaying) {
          return;
        }
      }

      setIsPlaying(progressData.isPlaying);
      updateProgress(progressData.progress);
    });

    const handleReconnect = () => {
      console.log("[App] Manual socket reconnection triggered");
      if (!socket.connected) {
        socket.connect();
      }
    };
    window.addEventListener('app:reconnect-socket', handleReconnect);

    return () => {
      socket.disconnect();
      socket.off('connect');
      socket.off('disconnect');
      socket.off('song_update');
      socket.off('canvas_update');
      socket.off('progress_update');
      window.removeEventListener('app:reconnect-socket', handleReconnect);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Fetch lyrics when song changes (shared between normal & animated artwork modes)
  useEffect(() => {
    if (!songTitle || songTitle === 'No song playing') {
      currentSongKeyRef.current = '';
      setLyrics(null);
      setLyricsLoading(false);
      return;
    }

    const songKey = `${cleanMetadata(songTitle)}::${cleanMetadata(songArtist)}`.toLowerCase();

    // If the song hasn't changed, never reload or wipe lyrics!
    if (songKey === currentSongKeyRef.current) {
      return;
    }

    currentSongKeyRef.current = songKey;

    // Check memory cache first for instant zero-flicker display
    if (lyricsCache.has(songKey)) {
      const cached = lyricsCache.get(songKey) || null;
      setLyrics(cached);
      setLyricsLoading(false);
      return;
    }

    let isCurrent = true;
    // Clear out previous song lyrics immediately so they don't linger while loading
    setLyrics(null);
    setLyricsLoading(true);

    const explicitSpotifyId = (songSource === 'spotify' && songId && /^[A-Za-z0-9]{22}$/.test(songId))
      ? songId
      : undefined;

    lyricsProvider
      .fetchLyrics(songTitle, songArtist, songAlbum, songDuration, explicitSpotifyId)
      .then((fetchedLyrics) => {
        lyricsCache.set(songKey, fetchedLyrics);
        if (isCurrent && currentSongKeyRef.current === songKey) {
          setLyrics(fetchedLyrics);
          setLyricsLoading(false);
        }
      })
      .catch((err) => {
        console.error('[App] Lyrics fetch error:', err);
        lyricsCache.set(songKey, null);
        if (isCurrent && currentSongKeyRef.current === songKey) {
          setLyrics(null);
          setLyricsLoading(false);
        }
      });

    return () => {
      isCurrent = false;
    };
  }, [
    songTitle,
    songArtist,
    setLyrics,
    setLyricsLoading
  ]);

  // Resolve dual-source animated artwork following exact playback provider priority
  useEffect(() => {
    if (!songTitle || songTitle === 'No song playing') {
      setAnimatedArtwork(null);
      return;
    }

    const controller = new AbortController();
    let isCurrent = true;

    const trackInfo: ArtworkTrackInfo = {
      id: songId,
      title: songTitle,
      artist: songArtist,
      album: songAlbum,
      duration: songDuration,
      coverArt: songCoverArt,
      source: songSource,
      canvasUrl: songCanvasUrl,
      videoId: songVideoId
    };

    artworkResolver
      .resolveAnimatedArtwork(trackInfo, songSource, controller.signal)
      .then((artwork) => {
        if (!isCurrent) return;

        const currentSongState = useAppStore.getState().currentSong;
        const activeArtwork = currentSongState.animatedArtwork;

        if (artwork && artwork.available && artwork.videoUrl) {
          // Priority enforcement when applying resolved artwork:
          // 1. Spotify playback: Priority 1 is Spotify Canvas. If Spotify Canvas is already active (e.g. from async socket), do not overwrite with Apple Music fallback.
          if (songSource === 'spotify' && activeArtwork?.available && activeArtwork.source === 'spotify' && artwork.source === 'apple_music') {
            console.log('[App] Keeping Priority 1 Spotify Canvas over Apple Music fallback');
            return;
          }

          // 2. Apple Music playback: Priority 1 is Apple Music animated artwork. If Apple Music artwork is already active, do not overwrite with Spotify fallback.
          if (songSource === 'apple' && activeArtwork?.available && activeArtwork.source === 'apple_music' && artwork.source === 'spotify') {
            console.log('[App] Keeping Priority 1 Apple Music animated artwork over Spotify fallback');
            return;
          }

          // 3. YouTube Music playback: Whichever loaded first should be displayed. If an animated artwork is already active, keep it.
          if (songSource === 'youtube' && activeArtwork?.available && activeArtwork.videoUrl) {
            console.log('[App] YouTube Music: keeping first-loaded artwork (' + activeArtwork.source + ')');
            return;
          }

          console.log(`[App] Applied animated artwork mode from ${artwork.source}:`, artwork.videoUrl);
          setAnimatedArtwork(artwork);
        } else {
          // Only clear if no active valid artwork is already displaying
          if (!activeArtwork?.available || !activeArtwork.videoUrl) {
            setAnimatedArtwork(null);
          }
        }
      })
      .catch((err) => {
        if (err.name !== 'AbortError') {
          console.warn('[App] Animated artwork resolver error:', err);
        }
        if (isCurrent) {
          const activeArtwork = useAppStore.getState().currentSong.animatedArtwork;
          if (!activeArtwork?.available || !activeArtwork.videoUrl) {
            setAnimatedArtwork(null);
          }
        }
      });

    return () => {
      isCurrent = false;
      controller.abort();
    };
  }, [
    songTitle,
    songArtist,
    songAlbum,
    songDuration,
    songSource,
    songId,
    songCanvasUrl,
    songCoverArt,
    songVideoId,
    setAnimatedArtwork
  ]);

  // Global macOS Keyboard Shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Ignore if user is inside an input field
      if (['INPUT', 'TEXTAREA'].includes((e.target as HTMLElement)?.tagName)) {
        return;
      }

      const isCmdOrCtrl = e.metaKey || e.ctrlKey;
      const key = e.key.toLowerCase();

      // Space: Play / Pause
      if (e.code === 'Space') {
        e.preventDefault();
        const currentSong = useAppStore.getState().currentSong;
        if (!currentSong.title || currentSong.title === 'No song playing') {
          useAppStore.getState().showHud('No song playing');
        } else {
          const nextPlaying = !currentSong.isPlaying;
          useAppStore.getState().setManualPlayPause(nextPlaying);
          useAppStore.getState().showHud(nextPlaying ? 'Playing' : 'Paused');
        }
        window.electron?.musicCommand('play-pause');
        return;
      }

      // ⌘ + ArrowLeft: Previous Track
      if (isCmdOrCtrl && e.key === 'ArrowLeft') {
        e.preventDefault();
        const currentSong = useAppStore.getState().currentSong;
        if (!currentSong.title || currentSong.title === 'No song playing') {
          useAppStore.getState().showHud('No song playing');
        } else {
          useAppStore.getState().showHud('Previous Track');
        }
        window.electron?.musicCommand('previous');
        return;
      }

      // ⌘ + ArrowRight: Next Track
      if (isCmdOrCtrl && e.key === 'ArrowRight') {
        e.preventDefault();
        const currentSong = useAppStore.getState().currentSong;
        if (!currentSong.title || currentSong.title === 'No song playing') {
          useAppStore.getState().showHud('No song playing');
        } else {
          useAppStore.getState().showHud('Next Track');
        }
        window.electron?.musicCommand('next');
        return;
      }

      // ⌘ + P: Toggle Pin
      if (isCmdOrCtrl && key === 'p') {
        e.preventDefault();
        const win = window as Window & { __isPinned?: boolean };
        const currentPinned = win.__isPinned ?? true;
        const nextPin = !currentPinned;
        win.__isPinned = nextPin;
        window.electron?.togglePin(nextPin);
        useAppStore.getState().showHud(nextPin ? 'Window Pinned' : 'Window Unpinned');
        return;
      }

      // ⌘ + T: Toggle Theme
      if (isCmdOrCtrl && key === 't') {
        e.preventDefault();
        const currentTheme = useAppStore.getState().theme;
        let nextTheme: 'dynamic' | 'dark' | 'light';
        if (currentTheme === 'dynamic') nextTheme = 'dark';
        else if (currentTheme === 'dark') nextTheme = 'light';
        else nextTheme = 'dynamic';
        useAppStore.getState().setTheme(nextTheme);
        useAppStore.getState().showHud(`${nextTheme.charAt(0).toUpperCase() + nextTheme.slice(1)} Mode`);
        return;
      }

      // ⌘ + W: Close window
      if (isCmdOrCtrl && key === 'w') {
        e.preventDefault();
        if (window.electron?.close) {
          window.electron.close();
        } else {
          useAppStore.getState().showHud('Close Window');
        }
        return;
      }

      // ⌘ + M: Minimize window
      if (isCmdOrCtrl && key === 'm') {
        e.preventDefault();
        if (window.electron?.minimize) {
          window.electron.minimize();
        } else {
          useAppStore.getState().showHud('Minimize Window');
        }
        return;
      }

      // [ : Delay lyrics / shift backwards (-50ms)
      if (e.key === '[' || (isCmdOrCtrl && e.key === '[')) {
        e.preventDefault();
        const next = useEffectsStore.getState().adjustSyncOffsetMs(-50);
        useAppStore.getState().showHud(`Sync Offset: ${next > 0 ? '+' : ''}${next}ms`);
        return;
      }

      // ] : Advance lyrics / shift forward (+50ms)
      if (e.key === ']' || (isCmdOrCtrl && e.key === ']')) {
        e.preventDefault();
        const next = useEffectsStore.getState().adjustSyncOffsetMs(50);
        useAppStore.getState().showHud(`Sync Offset: ${next > 0 ? '+' : ''}${next}ms`);
        return;
      }

      // \ : Reset sync offset (0ms)
      if (e.key === '\\' || (isCmdOrCtrl && e.key === '\\')) {
        e.preventDefault();
        useEffectsStore.getState().setSyncOffsetMs(0);
        useAppStore.getState().showHud('Sync Offset: 0ms (Reset)');
        return;
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  // Determine whether Animated Artwork Mode is active:
  // Evaluates available artwork, user's global preference, and per-track manual override
  const hasAnimatedArtwork = Boolean(
    animatedArtwork?.available && animatedArtwork?.videoUrl
  );

  const currentTrackKey = `${songTitle}::${songArtist}`;
  const override = manualArtworkOverride?.trackKey === currentTrackKey
    ? manualArtworkOverride.override
    : null;

  let isAnimatedArtworkMode = false;
  if (artworkPreference === 'always_normal') {
    isAnimatedArtworkMode = false;
  } else if (override === 'normal') {
    isAnimatedArtworkMode = false;
  } else if (override === 'animated') {
    isAnimatedArtworkMode = hasAnimatedArtwork;
  } else {
    // Default: Automatic mode
    isAnimatedArtworkMode = hasAnimatedArtwork;
  }

  return (
    <div
      className="app-viewport-root"
      style={{
        position: 'relative',
        width: '100vw',
        height: '100vh',
        overflow: 'hidden',
        borderRadius: '28px',
        background: 'transparent'
      }}
    >
      <Layout isAnimatedArtworkActive={isAnimatedArtworkMode}>
        <LyricsContainer />
      </Layout>
    </div>
  );
}

export default App;
