/**
 * Animated Artwork Provider using https://artwork.m8tec.top/api/v1/artwork/search
 * Fetches Apple Music HLS (.m3u8) animated album art streams (standard square and tall formats).
 */

export interface AnimatedArtworkResult {
    url: string;        // Square animated artwork (1:1)
    url_tall?: string;   // Tall portrait animated artwork (9:16)
    artist?: string;
    album?: string;
}

const cache = new Map<string, AnimatedArtworkResult | null>();

/**
 * Clean artist, title, or album for better search matching
 */
function cleanText(text: string): string {
    return text
        .replace(/\(feat\..*?\)/gi, '')
        .replace(/\[feat\..*?\]/gi, '')
        .replace(/\(with.*?\)/gi, '')
        .replace(/\(Official.*?\)/gi, '')
        .replace(/\[Official.*?\]/gi, '')
        .replace(/\(Lyric.*?\)/gi, '')
        .replace(/\[Lyric.*?\]/gi, '')
        .replace(/\(Audio.*?\)/gi, '')
        .replace(/\[Audio.*?\]/gi, '')
        .replace(/\(Remastered.*?\)/gi, '')
        .replace(/\(Deluxe.*?\)/gi, '')
        .replace(/\(From.*?\)/gi, '')
        .replace(/- .*?(Mix|Remix|Edit)/gi, '')
        .replace(/\s+/g, ' ')
        .trim();
}

/**
 * Lookup album name via iTunes Search API if album is missing or empty
 */
async function resolveAlbumFromItunes(artist: string, title: string): Promise<string | null> {
    try {
        const query = encodeURIComponent(`${cleanText(artist)} ${cleanText(title)}`);
        const res = await fetch(`https://itunes.apple.com/search?term=${query}&entity=song&limit=1`, {
            signal: AbortSignal.timeout(4000)
        });
        if (!res.ok) return null;
        const data = await res.json();
        if (data.results && data.results.length > 0 && data.results[0].collectionName) {
            return data.results[0].collectionName;
        }
    } catch {
        // Fallback silently if iTunes lookup fails
    }
    return null;
}

export const animatedArtworkProvider = {
    /**
     * Fetch animated artwork for a track by artist, title, and optional album
     */
    async fetchAnimatedArtwork(artist: string, title?: string, album?: string, externalSignal?: AbortSignal): Promise<AnimatedArtworkResult | null> {
        if (!artist || artist === 'Waiting for music...' || artist === 'Waiting for connection...') {
            return null;
        }

        if (externalSignal?.aborted) {
            return null;
        }

        const cleanArtist = cleanText(artist);
        const cleanTitle = title ? cleanText(title) : '';
        let resolvedAlbum = album ? cleanText(album) : '';

        // If album is missing or too generic, attempt to resolve via iTunes Search
        if (!resolvedAlbum && cleanTitle) {
            const itunesAlbum = await resolveAlbumFromItunes(cleanArtist, cleanTitle);
            if (itunesAlbum) {
                resolvedAlbum = cleanText(itunesAlbum);
            }
        }

        // Cache key based on artist and resolved album or title
        const cacheKey = `${cleanArtist.toLowerCase()}::${(resolvedAlbum || cleanTitle).toLowerCase()}`;
        if (cache.has(cacheKey)) {
            return cache.get(cacheKey) || null;
        }

        // If we still don't have an album, fallback to using title as album
        const searchAlbum = resolvedAlbum || cleanTitle;
        if (!searchAlbum) {
            cache.set(cacheKey, null);
            return null;
        }

        try {
            const params = new URLSearchParams({
                artist: cleanArtist,
                album: searchAlbum
            });
            if (cleanTitle) {
                params.set('title', cleanTitle);
            }

            const url = `https://artwork.m8tec.top/api/v1/artwork/search?${params.toString()}`;
            console.log(`[AnimatedArtwork] Searching: ${url}`);

            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 6000);

            if (externalSignal) {
                externalSignal.addEventListener('abort', () => controller.abort(), { once: true });
            }

            const res = await fetch(url, { signal: controller.signal });
            clearTimeout(timeoutId);

            if (!res.ok) {
                console.log(`[AnimatedArtwork] Status ${res.status} for ${cleanArtist} - ${searchAlbum}`);
                cache.set(cacheKey, null);
                return null;
            }

            const data = await res.json();
            if (data && data.url) {
                const result: AnimatedArtworkResult = {
                    url: data.url,
                    url_tall: data.url_tall || data.url,
                    artist: data.artist || cleanArtist,
                    album: data.album || searchAlbum
                };
                console.log(`[AnimatedArtwork] Found animated artwork for: ${cleanArtist} - ${searchAlbum}`, result);
                cache.set(cacheKey, result);
                return result;
            }

            cache.set(cacheKey, null);
            return null;
        } catch (err: unknown) {
            const error = err as { name?: string };
            if (error.name !== 'AbortError') {
                console.warn('[AnimatedArtwork] Fetch error:', err);
            }
            cache.set(cacheKey, null);
            return null;
        }
    }
};
