/**
 * Isolated Apple Music Animated Artwork Provider
 * Resolves Apple Music HLS (.m3u8) animated album artwork streams.
 */

import type { AnimatedArtworkData, ArtworkTrackInfo } from './types';
import { cleanCoreTitle } from './metadataMatcher';

/**
 * Extracts official Apple Music motion HLS (.m3u8) streams from Apple Music album page
 */
async function extractMotionFromAlbumPage(
    albumUrl: string,
    signal?: AbortSignal
): Promise<{ videoUrl: string; videoTallUrl: string } | null> {
    try {
        const pageRes = await fetch(albumUrl, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
            },
            signal: signal ? signal : AbortSignal.timeout(4500)
        });
        if (!pageRes.ok) return null;

        const html = await pageRes.text();
        const matches = html.match(/https:\/\/mvod\.itunes\.apple\.com\/[^\s"']+\.m3u8[^\s"']*/g) || [];
        const unique = [...new Set(matches)];
        if (unique.length > 0) {
            const square = unique[0];
            const tall = unique.length > 1 ? unique[1] : unique[0];
            return { videoUrl: square, videoTallUrl: tall };
        }
    } catch {
        // Fetch failed or timed out
    }
    return null;
}

/**
 * Directly extracts official Apple Music animated artwork (.m3u8)
 * by discovering candidate albums via iTunes API and scraping the official Apple Music page
 */
async function fetchDirectAppleMusicMotion(
    track: ArtworkTrackInfo,
    signal?: AbortSignal
): Promise<{ videoUrl: string; videoTallUrl: string } | null> {
    try {
        const cleanTitle = cleanCoreTitle(track.title);
        const cleanArtist = track.artist.split(/,|&|\bfeat\b|\bwith\b/i)[0].trim();
        const candidateUrls = new Set<string>();

        // 1. If album name is present, search entity=album
        if (track.album && track.album.trim()) {
            try {
                const cleanAlbum = track.album.replace(/\s*-\s*Single/i, '').replace(/\(.*?\)|\[.*?\]|\{.*?\}/g, '').trim();
                const albumQ = `${cleanArtist} ${cleanAlbum}`;
                const aRes = await fetch(`https://itunes.apple.com/search?term=${encodeURIComponent(albumQ)}&entity=album&limit=3`, {
                    signal: signal ? signal : AbortSignal.timeout(3000)
                });
                if (aRes.ok) {
                    const aData = await aRes.json();
                    for (const item of aData.results || []) {
                        if (item.collectionViewUrl) candidateUrls.add(item.collectionViewUrl);
                    }
                }
            } catch (err) {
                void err;
            }
        }

        // 2. Search entity=song to find exact track match and its associated album URL
        try {
            const songQ = `${cleanArtist} ${cleanTitle}`;
            const sRes = await fetch(`https://itunes.apple.com/search?term=${encodeURIComponent(songQ)}&entity=song&limit=5`, {
                signal: signal ? signal : AbortSignal.timeout(3000)
            });
            if (sRes.ok) {
                const sData = await sRes.json();
                for (const item of sData.results || []) {
                    if (item.collectionViewUrl) candidateUrls.add(item.collectionViewUrl);
                }
            }
        } catch (err) {
            void err;
        }

        if (signal?.aborted) return null;

        // 3. Inspect candidate album pages for motion artwork
        for (const albumUrl of candidateUrls) {
            if (signal?.aborted) return null;
            const motion = await extractMotionFromAlbumPage(albumUrl, signal);
            if (motion) {
                console.log(`[AppleMusicArtworkProvider] Found direct Apple Music motion HLS stream from ${albumUrl} for: ${track.artist} - ${track.title}`);
                return motion;
            }
        }
    } catch {
        // Fallback silently
    }
    return null;
}

export const appleMusicArtworkProvider = {
    /**
     * Resolves Apple Music animated artwork
     */
    async fetchArtwork(track: ArtworkTrackInfo, signal?: AbortSignal): Promise<AnimatedArtworkData> {
        const fallback: AnimatedArtworkData = {
            source: 'apple_music',
            available: false,
            videoUrl: null,
            videoTallUrl: null,
            previewUrl: null,
            artworkId: null
        };

        if (!track || !track.title || track.title === 'No song playing' || !track.artist) {
            return fallback;
        }

        if (signal?.aborted) {
            return fallback;
        }

        try {
            // 1. Direct extraction from Apple Music official album page
            const direct = await fetchDirectAppleMusicMotion(track, signal);
            if (direct) {
                return {
                    source: 'apple_music',
                    available: true,
                    videoUrl: direct.videoUrl,
                    videoTallUrl: direct.videoTallUrl,
                    previewUrl: track.coverArt || null,
                    artworkId: `${track.artist}::${track.title}`
                };
            }

            // 2. Secondary proxy query with fast timeout
            const cleanTitle = cleanCoreTitle(track.title);
            const cleanArtist = track.artist.split(/,|&|\bfeat\b|\bwith\b/i)[0].trim();
            const searchAlbum = (track.album?.trim() || cleanTitle).replace(/\s*-\s*Single/i, '').trim();

            const params = new URLSearchParams({
                artist: cleanArtist,
                album: searchAlbum
            });
            if (cleanTitle) {
                params.set('title', cleanTitle);
            }

            const url = `https://artwork.m8tec.top/api/v1/artwork/search?${params.toString()}`;
            const res = await fetch(url, {
                signal: signal ? signal : AbortSignal.timeout(2500)
            });

            if (!res.ok) {
                return fallback;
            }

            const data = await res.json();
            if (data && data.url) {
                const videoUrl = data.url;
                const videoTallUrl = data.url_tall || data.url;
                const artworkId = data.id || `${cleanArtist}::${searchAlbum}`;

                console.log(`[AppleMusicArtworkProvider] Found animated artwork via proxy for: ${cleanArtist} - ${searchAlbum}`);
                return {
                    source: 'apple_music',
                    available: true,
                    videoUrl,
                    videoTallUrl,
                    previewUrl: track.coverArt || null,
                    artworkId: String(artworkId)
                };
            }

            return fallback;
        } catch (err: unknown) {
            const error = err as { name?: string };
            if (error.name !== 'AbortError') {
                console.warn('[AppleMusicArtworkProvider] Apple artwork fetch error:', err);
            }
            return fallback;
        }
    }
};
