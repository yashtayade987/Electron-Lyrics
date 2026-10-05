import { useEffect, useRef } from 'react';
import { Layout } from './components/layout/Layout';
import { LyricsContainer } from './components/lyrics/LyricsContainer';
import { useAppStore, isSameSong } from './store/useAppStore';
import { artworkResolver } from './utils/artwork/ArtworkResolver';
import { spotifyArtworkProvider } from './utils/artwork/SpotifyArtworkProvider';
import type { ArtworkTrackInfo } from './utils/artwork/types';
import { lyricsProvider, cleanMetadata, cleanSpotifyId, type LyricsData } from './utils/lyricsProvider';
import { io } from 'socket.io-client';

const socket = io('http://localhost:4000', {
  autoConnect: false
});

// Bounded cache for fetched lyrics (max 50 tracks) to prevent memory bloat over long sessions
const MAX_LYRICS_CACHE = 50;
const lyricsCache = new Map<string, LyricsData>();

function cacheLyrics(key: string, data: LyricsData): void {
  if (lyricsCache.size >= MAX_LYRICS_CACHE) {
    const oldestKey = lyricsCache.keys().next().value;
    if (oldestKey) lyricsCache.delete(oldestKey);
  }
  lyricsCache.set(key, data);
}

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
  const lyricsRequestIdRef = useRef<number>(0);
  const artworkRequestIdRef = useRef<number>(0);
  const lastResolvedTrackKeyRef = useRef<string>('');

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
      const currentStoreSong = useAppStore.getState().currentSong;
      const isSame = isSameSong(currentStoreSong.title, currentStoreSong.artist, songData.title, songData.artist);
      const isNewSong = !isSame && Boolean(songData.title && songData.title !== currentStoreSong.title && currentStoreSong.title !== 'No song playing');

      // On new track transition, prevent any stale progress from previous track from poisoning initial state
      const initialProgress = isNewSong
        ? (songData.progress !== undefined && songData.progress < 3000 ? songData.progress : 0)
        : (songData.progress ?? 0);

      // Preserve existing valid canvasUrl and animated artwork across same-song updates
      const effectiveCanvasUrl = (songData.canvasUrl && typeof songData.canvasUrl === 'string' && songData.canvasUrl.startsWith('http'))
        ? songData.canvasUrl
        : (isSame ? currentStoreSong.canvasUrl : null);

      const effectiveAnimatedArtwork = (isSame && currentStoreSong.animatedArtwork?.available && currentStoreSong.animatedArtwork?.videoUrl)
        ? currentStoreSong.animatedArtwork
        : songData.animatedArtwork;

      setSong({
        id: songData.id || (isSame ? currentStoreSong.id : null),
        title: songData.title,
        artist: songData.artist,
        album: songData.album || (isSame ? currentStoreSong.album : ''),
        coverArt: songData.coverArt || (isSame ? currentStoreSong.coverArt : ''),
        duration: songData.duration || (isSame ? currentStoreSong.duration : 0),
        source: songData.source,
        videoId: songData.videoId || (isSame ? currentStoreSong.videoId : undefined),
        canvasUrl: effectiveCanvasUrl,
        animatedArtwork: effectiveAnimatedArtwork,
        progress: initialProgress,
        isExplicit: songData.isExplicit ?? (
          /\b(explicit|dirty)\b/i.test(songData.title || '') ||
          /\b(explicit|dirty)\b/i.test(songData.album || '')
        ),
      });
      setIsPlaying(songData.isPlaying);
      updateProgress(initialProgress);
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

        // If canvasData carries song title/artist metadata, verify it matches current song
        if (canvasData.title && current.title && !isSameSong(canvasData.title, canvasData.artist, current.title, current.artist)) {
          return;
        }

        // If already playing this exact canvas URL, do nothing to prevent unnecessary state ripples
        if (current.animatedArtwork?.available && current.animatedArtwork.videoUrl === canvasData.canvasUrl) {
          return;
        }

        const effectiveCoverArt = current.coverArt || canvasData.coverArt || '';
        console.log('[App] Applying Spotify Canvas:', canvasData.canvasUrl);
        setSong({
          canvasUrl: canvasData.canvasUrl,
          id: current.id || canvasData.trackId || null,
          coverArt: effectiveCoverArt
        });
        const artworkData = {
          available: true,
          source: 'spotify' as const,
          videoUrl: canvasData.canvasUrl,
          videoTallUrl: canvasData.canvasUrl,
          previewUrl: effectiveCoverArt,
          artworkId: canvasData.trackId || current.id
        };
        artworkResolver.setCachedArtwork(
          {
            id: canvasData.trackId || current.id,
            title: current.title,
            artist: current.artist,
            album: current.album,
            duration: current.duration,
            coverArt: effectiveCoverArt,
            source: current.source,
            canvasUrl: canvasData.canvasUrl
          },
          current.source,
          artworkData
        );
        setAnimatedArtwork(artworkData);
      }
    });

    socket.on('animated_artwork_update', (data: {
      source?: 'apple_music' | 'spotify';
      videoUrl: string | null;
      videoTallUrl?: string | null;
      previewUrl?: string | null;
      title?: string;
      artist?: string;
    }) => {
      console.log("[App] Received async animated_artwork_update:", data);
      if (!data || !data.videoUrl) return;
      const current = useAppStore.getState().currentSong;

      // If data carries song title/artist metadata, verify it matches current song
      if (data.title && current.title && !isSameSong(data.title, data.artist, current.title, current.artist)) {
        return;
      }

      // If Spotify is playing and already has Priority 1 Spotify Canvas active, do not overwrite
      if (current.source === 'spotify' && current.animatedArtwork?.available && current.animatedArtwork?.source === 'spotify') {
        return;
      }

      // If already playing this exact video URL, do nothing
      if (current.animatedArtwork?.available && current.animatedArtwork.videoUrl === data.videoUrl) {
        return;
      }

      const effectiveCoverArt = current.coverArt || data.previewUrl || '';
      if (!current.coverArt && data.previewUrl) {
        setSong({ coverArt: data.previewUrl });
      }

      console.log(`[App] Applying async animated artwork from ${data.source || 'apple_music'}:`, data.videoUrl);
      const artworkData = {
        available: true,
        source: (data.source || 'apple_music') as 'apple_music' | 'spotify',
        videoUrl: data.videoUrl,
        videoTallUrl: data.videoTallUrl || data.videoUrl,
        previewUrl: effectiveCoverArt || null,
        artworkId: `${data.artist || current.artist}::${data.title || current.title}`
      };
      artworkResolver.setCachedArtwork(current, current.source, artworkData);
      setAnimatedArtwork(artworkData);
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
      socket.off('animated_artwork_update');
      socket.off('progress_update');
      window.removeEventListener('app:reconnect-socket', handleReconnect);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Fetch lyrics when song changes (shared between normal & animated artwork modes)
  useEffect(() => {
    if (!songTitle || songTitle === 'No song playing') {
      currentSongKeyRef.current = '';
      lyricsRequestIdRef.current++;
      setLyrics(null);
      setLyricsLoading(false);
      return;
    }

    const cleanT = cleanMetadata(songTitle) || songTitle.trim();
    const cleanA = cleanMetadata(songArtist) || songArtist.trim();
    const songKey = `${cleanT}::${cleanA}`.toLowerCase();

    // Check memory cache first for instant zero-flicker display
    const cached = lyricsCache.get(songKey);
    if (cached && cached.lines && cached.lines.length > 0) {
      currentSongKeyRef.current = songKey;
      setLyrics(cached);
      setLyricsLoading(false);
      return;
    }

    const currentLyrics = useAppStore.getState().lyrics;
    const isCurrentlyLoading = useAppStore.getState().lyricsLoading;

    // If lyrics are already loaded for this song, do not wipe or reload
    if (songKey === currentSongKeyRef.current && currentLyrics !== null && currentLyrics.lines.length > 0) {
      return;
    }

    // If an active fetch is already in flight for this exact songKey, do not duplicate
    if (songKey === currentSongKeyRef.current && isCurrentlyLoading) {
      return;
    }

    currentSongKeyRef.current = songKey;
    const requestId = ++lyricsRequestIdRef.current;
    const controller = new AbortController();

    // Clear out previous song lyrics immediately so they don't linger while loading
    setLyrics(null);
    setLyricsLoading(true);

    const explicitSpotifyId = cleanSpotifyId(songId) || undefined;

    lyricsProvider
      .fetchLyrics(songTitle, songArtist, songAlbum, songDuration, explicitSpotifyId, controller.signal)
      .then((fetchedLyrics) => {
        if (lyricsRequestIdRef.current !== requestId || controller.signal.aborted) return;
        if (fetchedLyrics && fetchedLyrics.lines && fetchedLyrics.lines.length > 0) {
          cacheLyrics(songKey, fetchedLyrics);
          setLyrics(fetchedLyrics);
        } else {
          setLyrics(null);
        }
        setLyricsLoading(false);
      })
      .catch((err) => {
        if (lyricsRequestIdRef.current !== requestId || controller.signal.aborted) return;
        if (err?.name !== 'AbortError') {
          console.error('[App] Lyrics fetch error:', err);
        }
        setLyrics(null);
        setLyricsLoading(false);
      });

    return () => {
      controller.abort();
    };
  }, [
    songTitle,
    songArtist,
    songAlbum,
    songDuration,
    songId,
    songSource,
    setLyrics,
    setLyricsLoading
  ]);

  // Resolve dual-source animated artwork following exact playback provider priority
  useEffect(() => {
    if (!songTitle || songTitle === 'No song playing') {
      artworkRequestIdRef.current++;
      lastResolvedTrackKeyRef.current = '';
      setAnimatedArtwork(null);
      return;
    }

    const currentKey = `${songTitle}::${songArtist}`.toLowerCase();
    const currentSongState = useAppStore.getState().currentSong;
    const activeArtwork = currentSongState.animatedArtwork;

    // IF an animated artwork is ALREADY ACTIVE and playing for this same track:
    // DO NOT re-resolve or tear down! Preserve it!
    if (
      activeArtwork?.available &&
      activeArtwork.videoUrl &&
      lastResolvedTrackKeyRef.current &&
      isSameSong(
        lastResolvedTrackKeyRef.current.split('::')[0],
        lastResolvedTrackKeyRef.current.split('::')[1],
        songTitle,
        songArtist
      )
    ) {
      return;
    }

    lastResolvedTrackKeyRef.current = currentKey;
    const artworkRequestId = ++artworkRequestIdRef.current;
    const controller = new AbortController();

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
        if (artworkRequestIdRef.current !== artworkRequestId || controller.signal.aborted) return;

        const currentActive = useAppStore.getState().currentSong.animatedArtwork;

        if (artwork && artwork.available && artwork.videoUrl) {
          // Priority enforcement when applying resolved artwork:
          // 1. Spotify playback: Priority 1 is Spotify Canvas. If Spotify Canvas is already active (e.g. from async socket), do not overwrite with Apple Music fallback.
          if (songSource === 'spotify' && currentActive?.available && currentActive.source === 'spotify' && artwork.source === 'apple_music') {
            console.log('[App] Keeping Priority 1 Spotify Canvas over Apple Music fallback');
            return;
          }

          // 2. Apple Music playback: Priority 1 is Apple Music animated artwork. If Apple Music artwork is already active, do not overwrite with Spotify fallback.
          if (songSource === 'apple' && currentActive?.available && currentActive.source === 'apple_music' && artwork.source === 'spotify') {
            console.log('[App] Keeping Priority 1 Apple Music animated artwork over Spotify fallback');
            return;
          }

          // 3. YouTube Music playback: Whichever loaded first should be displayed. If an animated artwork is already active, keep it.
          if (songSource === 'youtube' && currentActive?.available && currentActive.videoUrl) {
            console.log('[App] YouTube Music: keeping first-loaded artwork (' + currentActive.source + ')');
            return;
          }

          console.log(`[App] Applied animated artwork mode from ${artwork.source}:`, artwork.videoUrl);
          setAnimatedArtwork(artwork);
        } else {
          // Only clear if no valid active artwork is already displaying
          if (!currentActive?.available || !currentActive.videoUrl) {
            setAnimatedArtwork(null);
          }
        }
      })
      .catch((err) => {
        if (artworkRequestIdRef.current !== artworkRequestId || controller.signal.aborted) return;
        if (err?.name !== 'AbortError') {
          console.warn('[App] Animated artwork resolver error:', err);
        }
        const currentActive = useAppStore.getState().currentSong.animatedArtwork;
        if (!currentActive?.available || !currentActive.videoUrl) {
          setAnimatedArtwork(null);
        }
      });

    return () => {
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

  // Automatic fallback thumbnail resolver: guarantees coverArt is never blank regardless of player source
  useEffect(() => {
    if (!songTitle || songTitle === 'No song playing' || songCoverArt) {
      return;
    }

    const controller = new AbortController();
    const cleanT = cleanMetadata(songTitle) || songTitle.trim();
    const cleanA = cleanMetadata(songArtist) || songArtist.trim();

    (async () => {
      try {
        const q = `${cleanA} ${cleanT}`.trim();
        const res = await fetch(`https://itunes.apple.com/search?term=${encodeURIComponent(q)}&entity=song&limit=3`, {
          signal: controller.signal
        });
        if (res.ok) {
          const data = await res.json();
          const first = data?.results?.[0];
          if (first?.artworkUrl100) {
            const highRes = first.artworkUrl100.replace('100x100bb.jpg', '1000x1000bb.jpg');
            const cur = useAppStore.getState().currentSong;
            if (isSameSong(cleanT, cleanA, cur.title, cur.artist) && !cur.coverArt) {
              console.log('[App] Fallback thumbnail resolved from iTunes:', highRes);
              setSong({ coverArt: highRes });
            }
          }
        }
      } catch {
        // Ignore fallback errors
      }
    })();

    return () => {
      controller.abort();
    };
  }, [songTitle, songArtist, songCoverArt, setSong]);

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
        const state = useAppStore.getState();
        const hasAnimated = Boolean(state.currentSong.animatedArtwork?.available && state.currentSong.animatedArtwork?.videoUrl);
        const currentKey = `${state.currentSong.title}::${state.currentSong.artist}`;
        const userOverride = state.manualArtworkOverride?.trackKey === currentKey ? state.manualArtworkOverride.override : null;
        const isAnimatedActive = state.artworkPreference === 'always_normal' || userOverride === 'normal'
          ? false
          : (userOverride === 'animated' || hasAnimated);
        if (isAnimatedActive) {
          state.showHud('Theme is automatic with animated artwork');
          return;
        }
        const currentTheme = state.theme;
        let nextTheme: 'dynamic' | 'dark' | 'light';
        if (currentTheme === 'dynamic') nextTheme = 'dark';
        else if (currentTheme === 'dark') nextTheme = 'light';
        else nextTheme = 'dynamic';
        state.setTheme(nextTheme);
        state.showHud(`${nextTheme.charAt(0).toUpperCase() + nextTheme.slice(1)} Mode`);
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
        const next = useAppStore.getState().adjustSyncOffsetMs(-50);
        useAppStore.getState().showHud(`Sync Offset: ${next > 0 ? '+' : ''}${next}ms`);
        return;
      }

      // ] : Advance lyrics / shift forward (+50ms)
      if (e.key === ']' || (isCmdOrCtrl && e.key === ']')) {
        e.preventDefault();
        const next = useAppStore.getState().adjustSyncOffsetMs(50);
        useAppStore.getState().showHud(`Sync Offset: ${next > 0 ? '+' : ''}${next}ms`);
        return;
      }

      // \ : Reset sync offset (600ms calibrated default)
      if (e.key === '\\' || (isCmdOrCtrl && e.key === '\\')) {
        e.preventDefault();
        useAppStore.getState().setSyncOffsetMs(600);
        useAppStore.getState().showHud('Sync Offset: 600ms (Default)');
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
        <LyricsContainer isAnimatedMode={isAnimatedArtworkMode} />
      </Layout>
    </div>
  );
}

export default App;
