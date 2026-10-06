import { useEffect, useRef } from 'react';
import { Layout } from './components/layout/Layout';
import { LyricsContainer } from './components/lyrics/LyricsContainer';
import { useAppStore, isSameSong } from './store/useAppStore';
import { artworkResolver } from './utils/artwork/ArtworkResolver';
import { spotifyArtworkProvider } from './utils/artwork/SpotifyArtworkProvider';
import type { ArtworkTrackInfo } from './utils/artwork/types';
import { lyricsProvider, cleanMetadata, cleanSpotifyId, setLyricsUserToken, type LyricsData } from './utils/lyricsProvider';
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
  const sourceMode = useAppStore((s) => s.sourceMode);

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
  const lastFetchedSongIdRef = useRef<string | null>(null);
  const lyricsRequestIdRef = useRef<number>(0);
  const lastResolvedTrackKeyRef = useRef<string>('');
  const lyricsAbortControllerRef = useRef<AbortController | null>(null);
  const artworkAbortControllerRef = useRef<AbortController | null>(null);

  useEffect(() => {
    return () => {
      lyricsAbortControllerRef.current?.abort();
      artworkAbortControllerRef.current?.abort();
    };
  }, []);

  useEffect(() => {
    document.body.classList.remove('theme-dynamic', 'theme-dark', 'theme-light');
    document.body.classList.add(`theme-${theme}`);
    localStorage.setItem('theme', theme);
  }, [theme]);

  useEffect(() => {
    // When sourceMode changes, inform backend and request playback from selected source
    if (socket.connected) {
      socket.emit('switch_source_mode', sourceMode);
      socket.emit('request_source_playback', sourceMode);
    }
    window.electron?.switchSource?.(sourceMode);
  }, [sourceMode]);

  useEffect(() => {
    // Connect to local websocket server that extension talks to
    socket.connect();

    socket.on('connect', () => {
      setIsConnected(true);
      console.log("[App] Connected to browser extension bridge");
      const currentMode = useAppStore.getState().sourceMode;
      socket.emit('switch_source_mode', currentMode);
      socket.emit('request_source_playback', currentMode);
    });

    socket.on('disconnect', () => {
      setIsConnected(false);
      console.log("[App] Disconnected from browser extension bridge");
    });

    socket.on('song_update', (songData) => {
      console.log("[App] Received song_update:", songData.title, "by", songData.artist, "(Source:", songData.source, "Origin:", songData._origin, ")");
      const activeSourceMode = useAppStore.getState().sourceMode;
      const isMatchesCurrentSource =
        (activeSourceMode === 'desktop' && songData._origin === 'windows_media') ||
        (activeSourceMode === 'web' && songData._origin === 'extension') ||
        !songData._origin;

      if (songData.spotifyToken) {
        spotifyArtworkProvider.setCachedUserToken(songData.spotifyToken);
        setLyricsUserToken(songData.spotifyToken);
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

      let incomingCoverArt = '';
      if (typeof songData.coverArt === 'string') {
        incomingCoverArt = songData.coverArt;
      } else if (Array.isArray(songData.coverArt)) {
        incomingCoverArt = (songData.coverArt.find((c: unknown) => typeof c === 'string' && c.length > 0) as string) || '';
      }

      setSong({
        id: songData.id || (isSame ? currentStoreSong.id : null),
        title: songData.title,
        artist: songData.artist,
        album: songData.album || (isSame ? currentStoreSong.album : ''),
        coverArt: incomingCoverArt || (isSame ? currentStoreSong.coverArt : ''),
        duration: songData.duration || (isSame ? currentStoreSong.duration : 0),
        source: songData.source,
        videoId: songData.videoId || (isSame ? currentStoreSong.videoId : undefined),
        canvasUrl: effectiveCanvasUrl,
        animatedArtwork: effectiveAnimatedArtwork,
        progress: initialProgress,
        _origin: songData._origin,
        isExplicit: songData.isExplicit ?? (
          /\b(explicit|dirty)\b/i.test(songData.title || '') ||
          /\b(explicit|dirty)\b/i.test(songData.album || '')
        ),
      });

      if (isMatchesCurrentSource) {
        setIsPlaying(songData.isPlaying);
        updateProgress(initialProgress);
      }
    });

    socket.on('canvas_update', (canvasData) => {
      console.log("[App] Received async canvas_update:", canvasData);
      if (canvasData.spotifyToken) {
        spotifyArtworkProvider.setCachedUserToken(canvasData.spotifyToken);
        setLyricsUserToken(canvasData.spotifyToken);
      }

      const activeSourceMode = useAppStore.getState().sourceMode;
      const isMatchesCurrentSource =
        (activeSourceMode === 'desktop' && canvasData._origin === 'windows_media') ||
        (activeSourceMode === 'web' && canvasData._origin === 'extension') ||
        !canvasData._origin;

      if (!isMatchesCurrentSource) {
        return;
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

        // If already playing this exact canvas URL, do nothing to prevent unnecessary state ripples
        if (current.animatedArtwork?.available && current.animatedArtwork.videoUrl === canvasData.canvasUrl) {
          return;
        }

        console.log('[App] Applying Spotify Canvas:', canvasData.canvasUrl);
        setSong({ canvasUrl: canvasData.canvasUrl, id: current.id || canvasData.trackId || null, _origin: canvasData._origin });
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
      const activeSourceMode = useAppStore.getState().sourceMode;
      const origin = progressData._origin || 'extension';

      // Update source progress cache in store
      useAppStore.getState().updateSourceProgress(origin, progressData.progress, progressData.isPlaying, progressData.duration);

      const isMatchesCurrentSource =
        (activeSourceMode === 'desktop' && origin === 'windows_media') ||
        (activeSourceMode === 'web' && origin === 'extension');

      if (!isMatchesCurrentSource) {
        return;
      }

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

    const handleSwitchSourceEvent = (e: Event) => {
      const customEvt = e as CustomEvent<'web' | 'desktop'>;
      const targetMode = customEvt.detail;
      console.log("[App] Manual switch source event:", targetMode);
      if (socket.connected) {
        socket.emit('switch_source_mode', targetMode);
        socket.emit('request_source_playback', targetMode);
      }
      window.electron?.switchSource?.(targetMode);
    };
    window.addEventListener('app:switch-source', handleSwitchSourceEvent);

    const handleMusicCommandEvent = (e: Event) => {
      const customEvt = e as CustomEvent<string>;
      const command = customEvt.detail;
      if (socket.connected) {
        socket.emit('music_command', { action: command });
      }
    };
    window.addEventListener('app:music-command', handleMusicCommandEvent);

    return () => {
      socket.disconnect();
      socket.off('connect');
      socket.off('disconnect');
      socket.off('song_update');
      socket.off('canvas_update');
      socket.off('progress_update');
      window.removeEventListener('app:reconnect-socket', handleReconnect);
      window.removeEventListener('app:switch-source', handleSwitchSourceEvent);
      window.removeEventListener('app:music-command', handleMusicCommandEvent);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Fetch lyrics when song changes (shared between normal & animated artwork modes)
  useEffect(() => {
    if (!songTitle || songTitle === 'No song playing') {
      lyricsAbortControllerRef.current?.abort();
      lyricsAbortControllerRef.current = null;
      currentSongKeyRef.current = '';
      lastFetchedSongIdRef.current = null;
      lyricsRequestIdRef.current++;
      setLyrics(null);
      setLyricsLoading(false);
      return;
    }

    const cleanT = cleanMetadata(songTitle) || songTitle.trim();
    const cleanA = cleanMetadata(songArtist) || songArtist.trim();
    const songKey = `${cleanT}::${cleanA}`.toLowerCase();
    const explicitSpotifyId = cleanSpotifyId(songId) || undefined;

    // Check memory cache first for instant zero-flicker display
    const cached = lyricsCache.get(songKey);
    if (cached && cached.lines && cached.lines.length > 0) {
      lyricsAbortControllerRef.current?.abort();
      lyricsAbortControllerRef.current = null;
      currentSongKeyRef.current = songKey;
      lastFetchedSongIdRef.current = explicitSpotifyId || null;
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

    const isNewSong = songKey !== currentSongKeyRef.current;
    const hasNewExplicitId = Boolean(explicitSpotifyId && explicitSpotifyId !== lastFetchedSongIdRef.current);

    // If same song and already loading, do NOT abort unless we have a newly resolved explicit Spotify ID
    if (!isNewSong && isCurrentlyLoading && !hasNewExplicitId) {
      return;
    }

    // Abort previous in-flight request only when song actually changes or when upgrading ID
    lyricsAbortControllerRef.current?.abort();
    const controller = new AbortController();
    lyricsAbortControllerRef.current = controller;

    currentSongKeyRef.current = songKey;
    lastFetchedSongIdRef.current = explicitSpotifyId || null;
    const requestId = ++lyricsRequestIdRef.current;

    // Clear out previous song lyrics immediately on genuine track change so they don't linger
    if (isNewSong) {
      setLyrics(null);
    }
    setLyricsLoading(true);

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

  // Proactive cover art fallback: If desktop playback emits without artwork, fetch 600x600 artwork from iTunes instantly
  useEffect(() => {
    if (!songTitle || songTitle === 'No song playing') return;
    const coverStr = typeof songCoverArt === 'string' ? songCoverArt : '';
    if (coverStr && coverStr.trim().length > 0 && !coverStr.startsWith('data:image/jpeg;base64,')) {
      return;
    }

    const cleanT = cleanMetadata(songTitle) || songTitle.trim();
    const cleanA = cleanMetadata(songArtist) || songArtist.trim();
    if (!cleanT && !cleanA) return;

    let isCurrent = true;
    const query = `${cleanT} ${cleanA}`.trim();

    fetch(`https://itunes.apple.com/search?term=${encodeURIComponent(query)}&entity=song&limit=1`, {
      signal: AbortSignal.timeout(4000)
    })
      .then((r) => r.json())
      .then((data) => {
        if (!isCurrent) return;
        const item = data?.results?.[0];
        if (item && item.artworkUrl100) {
          const highResCover = item.artworkUrl100.replace('100x100bb.jpg', '600x600bb.jpg');
          const currentStore = useAppStore.getState().currentSong;
          if (currentStore.title === songTitle) {
            console.log(`[App] Resolved client-side cover art for "${songTitle}":`, highResCover);
            setSong({
              coverArt: highResCover,
              album: currentStore.album || item.collectionName || ''
            });
          }
        }
      })
      .catch(() => {});

    return () => {
      isCurrent = false;
    };
  }, [songTitle, songArtist, songCoverArt, setSong]);

  // Resolve dual-source animated artwork following exact playback provider priority
  useEffect(() => {
    if (!songTitle || songTitle === 'No song playing') {
      artworkAbortControllerRef.current?.abort();
      artworkAbortControllerRef.current = null;
      lastResolvedTrackKeyRef.current = '';
      setAnimatedArtwork(null);
      return;
    }

    const currentKey = `${songTitle}::${songArtist}`.toLowerCase();
    const currentSongState = useAppStore.getState().currentSong;
    const activeArtwork = currentSongState.animatedArtwork;

    // IF an animated artwork is ALREADY ACTIVE and playing for this same track:
    // Preserve it unless Spotify now has a direct canvasUrl to upgrade Apple Music fallback
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
      if (songSource === 'spotify' && activeArtwork.source !== 'spotify' && songCanvasUrl) {
        // proceed to upgrade to Priority 1 Spotify Canvas
      } else {
        return;
      }
    }

    const isNewTrack = currentKey !== lastResolvedTrackKeyRef.current;
    const isDirectCanvasAvailable = Boolean(songCanvasUrl && typeof songCanvasUrl === 'string' && songCanvasUrl.startsWith('http'));

    // If same track, and resolution is already in flight, and no direct canvasUrl newly arrived, do NOT abort the active lookup!
    if (!isNewTrack && artworkAbortControllerRef.current && !isDirectCanvasAvailable) {
      return;
    }

    artworkAbortControllerRef.current?.abort();
    const controller = new AbortController();
    artworkAbortControllerRef.current = controller;
    lastResolvedTrackKeyRef.current = currentKey;

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
        if (controller.signal.aborted) return;

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
        if (err.name !== 'AbortError') {
          console.warn('[App] Animated artwork resolver error:', err);
        }
        if (!controller.signal.aborted) {
          const currentActive = useAppStore.getState().currentSong.animatedArtwork;
          if (!currentActive?.available || !currentActive.videoUrl) {
            setAnimatedArtwork(null);
          }
        }
      });
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
        if (e.repeat) return;
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
        window.dispatchEvent(new CustomEvent('app:music-command', { detail: 'play-pause' }));
        return;
      }

      // ⌘ + ArrowLeft: Previous Track
      if (isCmdOrCtrl && e.key === 'ArrowLeft') {
        if (e.repeat) return;
        e.preventDefault();
        const currentSong = useAppStore.getState().currentSong;
        if (!currentSong.title || currentSong.title === 'No song playing') {
          useAppStore.getState().showHud('No song playing');
        } else {
          useAppStore.getState().showHud('Previous Track');
          useAppStore.getState().updateProgress(0);
        }
        window.electron?.musicCommand('previous');
        window.dispatchEvent(new CustomEvent('app:music-command', { detail: 'previous' }));
        return;
      }

      // ⌘ + ArrowRight: Next Track
      if (isCmdOrCtrl && e.key === 'ArrowRight') {
        if (e.repeat) return;
        e.preventDefault();
        const currentSong = useAppStore.getState().currentSong;
        if (!currentSong.title || currentSong.title === 'No song playing') {
          useAppStore.getState().showHud('No song playing');
        } else {
          useAppStore.getState().showHud('Next Track');
          useAppStore.getState().updateProgress(0);
        }
        window.electron?.musicCommand('next');
        window.dispatchEvent(new CustomEvent('app:music-command', { detail: 'next' }));
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

      // \ : Reset sync offset (0ms)
      if (e.key === '\\' || (isCmdOrCtrl && e.key === '\\')) {
        e.preventDefault();
        useAppStore.getState().setSyncOffsetMs(0);
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
        <LyricsContainer isAnimatedMode={isAnimatedArtworkMode} />
      </Layout>
    </div>
  );
}

export default App;
