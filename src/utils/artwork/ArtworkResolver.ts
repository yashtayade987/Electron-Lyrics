/**
 * ArtworkResolver
 * Single abstraction orchestrating animated artwork lookup from Spotify and Apple Music
 * based on the current music playback provider priority.
 */

import type { AnimatedArtworkData, ArtworkTrackInfo, PlaybackProvider } from './types';
import { spotifyArtworkProvider } from './SpotifyArtworkProvider';
import { appleMusicArtworkProvider } from './AppleMusicArtworkProvider';

const EMPTY_ARTWORK: AnimatedArtworkData = {
    available: false,
    source: null,
    videoUrl: null,
    videoTallUrl: null,
    previewUrl: null,
    artworkId: null
};

interface CacheEntry {
    data: AnimatedArtworkData;
    expiresAt: number;
}

const artworkCache = new Map<string, CacheEntry>();
const inflightRequests = new Map<string, Promise<AnimatedArtworkData>>();

// TTL: 30 minutes for valid artwork, 15 seconds for temporary absence of artwork
const TTL_VALID_MS = 30 * 60 * 1000;
const TTL_EMPTY_MS = 15 * 1000;

function getCacheKey(track: ArtworkTrackInfo, playbackProvider: PlaybackProvider): string {
    const prov = playbackProvider || 'unknown';
    const trackIdentity = track.id || track.isrc || track.videoId || `${track.artist}::${track.title}`;
    return `${prov}:${trackIdentity}`.toLowerCase().trim();
}

/**
 * Race helper for YouTube Music:
 * Resolves with whichever valid source finishes first.
 * If one fails, waits for the other.
 * If both fail, resolves with EMPTY_ARTWORK.
 */
async function raceYouTubeSources(
    spotifyPromise: Promise<AnimatedArtworkData>,
    applePromise: Promise<AnimatedArtworkData>
): Promise<AnimatedArtworkData> {
    return new Promise((resolve) => {
        let settledCount = 0;
        let isResolved = false;

        const checkBothSettled = () => {
            if (settledCount === 2 && !isResolved) {
                isResolved = true;
                resolve(EMPTY_ARTWORK);
            }
        };

        spotifyPromise
            .then((res) => {
                settledCount++;
                if (res && res.available && res.videoUrl && !isResolved) {
                    isResolved = true;
                    resolve(res);
                } else {
                    checkBothSettled();
                }
            })
            .catch(() => {
                settledCount++;
                checkBothSettled();
            });

        applePromise
            .then((res) => {
                settledCount++;
                if (res && res.available && res.videoUrl && !isResolved) {
                    isResolved = true;
                    resolve(res);
                } else {
                    checkBothSettled();
                }
            })
            .catch(() => {
                settledCount++;
                checkBothSettled();
            });
    });
}

export const artworkResolver = {
    /**
     * Resolves animated artwork following the exact playback provider priority:
     * - Spotify: Spotify Canvas (P1) -> Apple Music animated artwork (P2) -> Normal artwork (P3)
     * - Apple Music: Apple Music animated artwork (P1) -> Spotify Canvas (P2) -> Normal artwork (P3)
     * - YouTube Music: Whichever valid source loads first wins (first to load is displayed)
     */
    async resolveAnimatedArtwork(
        track: ArtworkTrackInfo,
        playbackProvider: PlaybackProvider,
        signal?: AbortSignal
    ): Promise<AnimatedArtworkData> {
        if (!track || !track.title || track.title === 'No song playing') {
            return EMPTY_ARTWORK;
        }

        if (signal?.aborted) {
            return EMPTY_ARTWORK;
        }

        const cacheKey = getCacheKey(track, playbackProvider);

        // Fast-path: Only for Spotify playback (where Spotify Canvas is Priority 1)
        // If playing from Spotify, direct canvasUrl can be returned immediately.
        // For Apple Music, Apple Music animated artwork is P1, so we must never short-circuit before checking Apple Music!
        if (playbackProvider === 'spotify' && track.canvasUrl && typeof track.canvasUrl === 'string' && track.canvasUrl.startsWith('http')) {
            const directCanvas: AnimatedArtworkData = {
                source: 'spotify',
                available: true,
                videoUrl: track.canvasUrl,
                videoTallUrl: track.canvasUrl,
                previewUrl: track.coverArt || null,
                artworkId: track.id || `${track.artist}::${track.title}`
            };
            artworkCache.set(cacheKey, {
                data: directCanvas,
                expiresAt: Date.now() + TTL_VALID_MS
            });
            return directCanvas;
        }

        // 1. Check in-memory Cache
        const cached = artworkCache.get(cacheKey);
        if (cached && Date.now() < cached.expiresAt) {
            // For Spotify playback: if cached artwork was Apple Music fallback, but Spotify Canvas is now available in track, bypass cache
            const isSpotifyUpgradeAvailable = playbackProvider === 'spotify' && cached.data.source === 'apple_music' && track.canvasUrl;
            if (!isSpotifyUpgradeAvailable && (cached.data.available || !track.canvasUrl)) {
                console.log(`[ArtworkResolver] Cache hit for key: ${cacheKey} (available: ${cached.data.available}, source: ${cached.data.source})`);
                return cached.data;
            }
        }

        // 2. In-flight request deduplication
        if (inflightRequests.has(cacheKey)) {
            return inflightRequests.get(cacheKey)!;
        }

        const executeResolution = async (): Promise<AnimatedArtworkData> => {
            try {
                let result: AnimatedArtworkData = EMPTY_ARTWORK;

                if (playbackProvider === 'spotify') {
                    // When song from Spotify is played:
                    // Priority 1: Spotify Canvas / animated artwork
                    if (track.canvasUrl && typeof track.canvasUrl === 'string' && track.canvasUrl.startsWith('http')) {
                        result = {
                            source: 'spotify',
                            available: true,
                            videoUrl: track.canvasUrl,
                            videoTallUrl: track.canvasUrl,
                            previewUrl: track.coverArt || null,
                            artworkId: track.id || `${track.artist}::${track.title}`
                        };
                    } else {
                        console.log(`[ArtworkResolver] [Spotify Playback] Trying Priority 1: Spotify Canvas...`);
                        const spotifyResult = await spotifyArtworkProvider.fetchArtwork(track, signal);

                        if (signal?.aborted) return EMPTY_ARTWORK;

                        if (spotifyResult.available) {
                            result = spotifyResult;
                        } else {
                            // Priority 2: Apple Music animated artwork
                            console.log(`[ArtworkResolver] [Spotify Playback] Spotify Canvas unavailable, trying Priority 2: Apple Music...`);
                            const appleResult = await appleMusicArtworkProvider.fetchArtwork(track, signal);
                            if (signal?.aborted) return EMPTY_ARTWORK;

                            if (appleResult.available) {
                                result = appleResult;
                            }
                        }
                    }
                } else if (playbackProvider === 'apple') {
                    // When song from Apple Music is played:
                    // Priority 1: Apple Music animated artwork
                    console.log(`[ArtworkResolver] [Apple Music Playback] Trying Priority 1: Apple Music...`);
                    const appleResult = await appleMusicArtworkProvider.fetchArtwork(track, signal);

                    if (signal?.aborted) return EMPTY_ARTWORK;

                    if (appleResult.available) {
                        result = appleResult;
                    } else {
                        // Priority 2: Spotify Canvas
                        console.log(`[ArtworkResolver] [Apple Music Playback] Apple Music unavailable, trying Priority 2: Spotify...`);
                        if (track.canvasUrl && typeof track.canvasUrl === 'string' && track.canvasUrl.startsWith('http')) {
                            result = {
                                source: 'spotify',
                                available: true,
                                videoUrl: track.canvasUrl,
                                videoTallUrl: track.canvasUrl,
                                previewUrl: track.coverArt || null,
                                artworkId: track.id || `${track.artist}::${track.title}`
                            };
                        } else {
                            const spotifyResult = await spotifyArtworkProvider.fetchArtwork(track, signal);
                            if (signal?.aborted) return EMPTY_ARTWORK;

                            if (spotifyResult.available) {
                                result = spotifyResult;
                            }
                        }
                    }
                } else if (playbackProvider === 'youtube') {
                    // When song from YouTube Music is played:
                    // Whichever is loaded first should be displayed
                    console.log(`[ArtworkResolver] [YouTube Music Playback] Racing Spotify & Apple Music in parallel (first to load wins)...`);
                    const spotifyPromise = (track.canvasUrl && typeof track.canvasUrl === 'string' && track.canvasUrl.startsWith('http'))
                        ? Promise.resolve<AnimatedArtworkData>({
                            source: 'spotify',
                            available: true,
                            videoUrl: track.canvasUrl,
                            videoTallUrl: track.canvasUrl,
                            previewUrl: track.coverArt || null,
                            artworkId: track.id || `${track.artist}::${track.title}`
                        })
                        : spotifyArtworkProvider.fetchArtwork(track, signal);

                    const applePromise = appleMusicArtworkProvider.fetchArtwork(track, signal);

                    result = await raceYouTubeSources(spotifyPromise, applePromise);
                    if (signal?.aborted) return EMPTY_ARTWORK;
                } else {
                    // Default fallback: parallel race (whichever loads first)
                    const spotifyPromise = spotifyArtworkProvider.fetchArtwork(track, signal);
                    const applePromise = appleMusicArtworkProvider.fetchArtwork(track, signal);
                    result = await raceYouTubeSources(spotifyPromise, applePromise);
                    if (signal?.aborted) return EMPTY_ARTWORK;
                }

                // Cache resolution outcome
                const ttl = result.available ? TTL_VALID_MS : TTL_EMPTY_MS;
                artworkCache.set(cacheKey, {
                    data: result,
                    expiresAt: Date.now() + ttl
                });

                if (result.available && result.source) {
                    const trackIdentity = track.id || track.isrc || track.videoId || `${track.artist}::${track.title}`;
                    artworkCache.set(`specific:${result.source}:${trackIdentity}`.toLowerCase().trim(), {
                        data: result,
                        expiresAt: Date.now() + TTL_VALID_MS
                    });
                }

                return result;
            } finally {
                inflightRequests.delete(cacheKey);
            }
        };

        const resolutionPromise = executeResolution();
        inflightRequests.set(cacheKey, resolutionPromise);
        return resolutionPromise;
    },

    /**
     * Resolves animated artwork specifically from either 'spotify' or 'apple_music'.
     * Used when the user manually switches the artwork source in the context menu.
     */
    async resolveSpecificSource(
        track: ArtworkTrackInfo,
        targetSource: 'spotify' | 'apple_music',
        signal?: AbortSignal
    ): Promise<AnimatedArtworkData> {
        if (!track || !track.title || track.title === 'No song playing') {
            return EMPTY_ARTWORK;
        }

        const trackIdentity = track.id || track.isrc || track.videoId || `${track.artist}::${track.title}`;
        const specificCacheKey = `specific:${targetSource}:${trackIdentity}`.toLowerCase().trim();

        const cached = artworkCache.get(specificCacheKey);
        if (cached && Date.now() < cached.expiresAt && cached.data.available) {
            return cached.data;
        }

        try {
            let result: AnimatedArtworkData = EMPTY_ARTWORK;
            if (targetSource === 'spotify') {
                if (track.canvasUrl && typeof track.canvasUrl === 'string' && track.canvasUrl.startsWith('http')) {
                    result = {
                        source: 'spotify',
                        available: true,
                        videoUrl: track.canvasUrl,
                        videoTallUrl: track.canvasUrl,
                        previewUrl: track.coverArt || null,
                        artworkId: track.id || `${track.artist}::${track.title}`
                    };
                } else {
                    result = await spotifyArtworkProvider.fetchArtwork(track, signal);
                }
            } else if (targetSource === 'apple_music') {
                result = await appleMusicArtworkProvider.fetchArtwork(track, signal);
            }

            if (result && result.available) {
                artworkCache.set(specificCacheKey, {
                    data: result,
                    expiresAt: Date.now() + TTL_VALID_MS
                });
            }

            return result;
        } catch (err) {
            console.warn(`[ArtworkResolver] Failed to resolve specific source ${targetSource}:`, err);
            return EMPTY_ARTWORK;
        }
    },

    /**
     * Injects or updates artwork cache directly
     */
    setCachedArtwork(track: ArtworkTrackInfo, playbackProvider: PlaybackProvider, artwork: AnimatedArtworkData): void {
        const cacheKey = getCacheKey(track, playbackProvider);
        const ttl = artwork.available ? TTL_VALID_MS : TTL_EMPTY_MS;
        artworkCache.set(cacheKey, {
            data: artwork,
            expiresAt: Date.now() + ttl
        });
        if (artwork.available && artwork.source) {
            const trackIdentity = track.id || track.isrc || track.videoId || `${track.artist}::${track.title}`;
            artworkCache.set(`specific:${artwork.source}:${trackIdentity}`.toLowerCase().trim(), {
                data: artwork,
                expiresAt: Date.now() + ttl
            });
        }
    },

    /**
     * Invalidates cache for a specific track
     */
    invalidate(track: ArtworkTrackInfo, playbackProvider: PlaybackProvider): void {
        const cacheKey = getCacheKey(track, playbackProvider);
        artworkCache.delete(cacheKey);
        inflightRequests.delete(cacheKey);
    },

    /**
     * Clears all cached artwork
     */
    clearCache(): void {
        artworkCache.clear();
        inflightRequests.clear();
    }
};
