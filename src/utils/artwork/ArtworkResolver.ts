/**
 * ArtworkResolver
 * Single abstraction orchestrating animated artwork lookup from Spotify and Apple Music
 * based on the current music playback provider priority with strict LRU caching (max 10).
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

const MAX_CACHE_SIZE = 10;
const artworkCache = new Map<string, CacheEntry>();
const inflightRequests = new Map<string, Promise<AnimatedArtworkData>>();

// TTL: 30 minutes for valid artwork, 15 seconds for temporary absence of artwork
const TTL_VALID_MS = 30 * 60 * 1000;
const TTL_EMPTY_MS = 15 * 1000;

function getLruCache(key: string): CacheEntry | undefined {
    const entry = artworkCache.get(key);
    if (!entry) return undefined;
    // Move to most recent position
    artworkCache.delete(key);
    artworkCache.set(key, entry);
    return entry;
}

function setLruCache(key: string, entry: CacheEntry): void {
    if (artworkCache.has(key)) {
        artworkCache.delete(key);
    } else if (artworkCache.size >= MAX_CACHE_SIZE) {
        const oldestKey = artworkCache.keys().next().value;
        if (oldestKey) artworkCache.delete(oldestKey);
    }
    artworkCache.set(key, entry);
}

function getCacheKey(track: ArtworkTrackInfo, playbackProvider: PlaybackProvider): string {
    const prov = playbackProvider || 'unknown';
    const trackIdentity = track.id || track.isrc || track.videoId || `${track.artist}::${track.title}`;
    return `${prov}:${trackIdentity}`.toLowerCase().trim();
}

export const artworkResolver = {
    /**
     * Resolves animated artwork following the exact playback provider priority:
     * - Spotify: Spotify Canvas (P1) -> Apple Music animated artwork (P2)
     * - Apple Music: Apple Music animated artwork (P1) -> Spotify Canvas (P2)
     * - YouTube Music: Direct canvas or Spotify Canvas -> Apple Music fallback
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

        // Fast-path: If direct canvasUrl is already attached from socket
        if (playbackProvider === 'spotify' && track.canvasUrl && typeof track.canvasUrl === 'string' && track.canvasUrl.startsWith('http')) {
            const directCanvas: AnimatedArtworkData = {
                source: 'spotify',
                available: true,
                videoUrl: track.canvasUrl,
                videoTallUrl: track.canvasUrl,
                previewUrl: track.coverArt || null,
                artworkId: track.id || `${track.artist}::${track.title}`
            };
            setLruCache(cacheKey, {
                data: directCanvas,
                expiresAt: Date.now() + TTL_VALID_MS
            });
            return directCanvas;
        }

        // 1. Check in-memory LRU Cache (capped at 10 items)
        const cached = getLruCache(cacheKey);
        if (cached && Date.now() < cached.expiresAt) {
            const isSpotifyUpgradeAvailable = playbackProvider === 'spotify' && cached.data.source === 'apple_music' && track.canvasUrl;
            if (!isSpotifyUpgradeAvailable && (cached.data.available || !track.canvasUrl)) {
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
                        const spotifyResult = await spotifyArtworkProvider.fetchArtwork(track, signal);
                        if (signal?.aborted) return EMPTY_ARTWORK;

                        if (spotifyResult && spotifyResult.available) {
                            result = spotifyResult;
                        } else {
                            // Priority 2: Apple Music animated artwork
                            const appleResult = await appleMusicArtworkProvider.fetchArtwork(track, signal);
                            if (signal?.aborted) return EMPTY_ARTWORK;
                            if (appleResult && appleResult.available) {
                                result = appleResult;
                            }
                        }
                    }
                } else if (playbackProvider === 'apple') {
                    // Priority 1: Apple Music animated artwork
                    const appleResult = await appleMusicArtworkProvider.fetchArtwork(track, signal);
                    if (signal?.aborted) return EMPTY_ARTWORK;

                    if (appleResult && appleResult.available) {
                        result = appleResult;
                    } else {
                        // Priority 2: Spotify Canvas
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
                            if (spotifyResult && spotifyResult.available) {
                                result = spotifyResult;
                            }
                        }
                    }
                } else {
                    // YouTube Music or unknown: Check direct canvas first, then sequential cascade
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

                        if (spotifyResult && spotifyResult.available) {
                            result = spotifyResult;
                        } else {
                            const appleResult = await appleMusicArtworkProvider.fetchArtwork(track, signal);
                            if (signal?.aborted) return EMPTY_ARTWORK;
                            if (appleResult && appleResult.available) {
                                result = appleResult;
                            }
                        }
                    }
                }

                // Cache resolution outcome into 10-item LRU
                const ttl = result.available ? TTL_VALID_MS : TTL_EMPTY_MS;
                setLruCache(cacheKey, {
                    data: result,
                    expiresAt: Date.now() + ttl
                });

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

        const cached = getLruCache(specificCacheKey);
        if (cached && Date.now() < cached.expiresAt && cached.data.available) {
            return cached.data;
        }

        if (inflightRequests.has(specificCacheKey)) {
            return inflightRequests.get(specificCacheKey)!;
        }

        const executeSpecificResolution = async (): Promise<AnimatedArtworkData> => {
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
                    setLruCache(specificCacheKey, {
                        data: result,
                        expiresAt: Date.now() + TTL_VALID_MS
                    });
                }

                return result;
            } catch (err) {
                console.warn(`[ArtworkResolver] Failed to resolve specific source ${targetSource}:`, err);
                return EMPTY_ARTWORK;
            } finally {
                inflightRequests.delete(specificCacheKey);
            }
        };

        const resPromise = executeSpecificResolution();
        inflightRequests.set(specificCacheKey, resPromise);
        return resPromise;
    },

    /**
     * Injects or updates artwork cache directly
     */
    setCachedArtwork(track: ArtworkTrackInfo, playbackProvider: PlaybackProvider, artwork: AnimatedArtworkData): void {
        const cacheKey = getCacheKey(track, playbackProvider);
        const ttl = artwork.available ? TTL_VALID_MS : TTL_EMPTY_MS;
        setLruCache(cacheKey, {
            data: artwork,
            expiresAt: Date.now() + ttl
        });
        if (artwork.available && artwork.source) {
            const trackIdentity = track.id || track.isrc || track.videoId || `${track.artist}::${track.title}`;
            setLruCache(`specific:${artwork.source}:${trackIdentity}`.toLowerCase().trim(), {
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
