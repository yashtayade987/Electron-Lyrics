/**
 * Isolated Spotify Artwork Provider
 * Resolves Spotify Canvas / animated artwork for a track.
 */

import type { AnimatedArtworkData, ArtworkTrackInfo } from './types';
import { cleanSpotifyId, resolveSpotifyTrackId } from '../spicyLyricsProvider';

let cachedUserToken: string | null = null;

/**
 * Builds Spotify protobuf Canvas request payload for track ID:
 * Message CanvasRequest {
 *   repeated Track tracks = 1; // field 1: sub-message
 * }
 * Message Track {
 *   string track_uri = 1;     // field 1: string "spotify:track:<id>"
 * }
 */
function encodeCanvasProtobuf(trackId: string): Uint8Array {
    const uri = `spotify:track:${trackId}`;
    const uriBytes = new TextEncoder().encode(uri);

    // Track submessage: 0x0a (field 1, length-delimited), length, uriBytes
    const trackMsg = new Uint8Array(2 + uriBytes.length);
    trackMsg[0] = 0x0a;
    trackMsg[1] = uriBytes.length;
    trackMsg.set(uriBytes, 2);

    // CanvasRequest message: 0x0a (field 1, length-delimited), length, trackMsg
    const reqMsg = new Uint8Array(2 + trackMsg.length);
    reqMsg[0] = 0x0a;
    reqMsg[1] = trackMsg.length;
    reqMsg.set(trackMsg, 2);

    return reqMsg;
}

/**
 * Parses canvas video URL from Spotify protobuf response buffer
 */
function parseCanvasProtobuf(buffer: ArrayBuffer): string | null {
    try {
        const text = new TextDecoder('utf-8', { fatal: false }).decode(buffer);
        // Look for canvaz.scdn.co or direct mp4 url
        const match = text.match(/https:\/\/canvaz\.scdn\.co\/[A-Za-z0-9_.~:/?#[\]@!$&'()*+,;=-]+/);
        if (match) {
            return match[0];
        }
        const anyMp4 = text.match(/https:\/\/[A-Za-z0-9_.~:/?#[\]@!$&'()*+,;=-]+\.mp4[A-Za-z0-9_.~:/?#[\]@!$&'()*+,;=-]*/);
        if (anyMp4) {
            return anyMp4[0];
        }
    } catch {
        // parsing failed
    }
    return null;
}

/**
 * Fetches anonymous Spotify token if available
 */
async function getAnonymousToken(signal?: AbortSignal): Promise<string | null> {
    try {
        const res = await fetch('https://open.spotify.com/embed/track/4uLU6hMCjMI75M1A2tKUQC', {
            signal: signal ? signal : AbortSignal.timeout(4000)
        });
        if (!res.ok) return null;
        const html = await res.text();
        const match = html.match(/<script[^>]*id=["']__NEXT_DATA__["'][^>]*>(.*?)<\/script>/s);
        if (!match) return null;
        const json = JSON.parse(match[1]);
        return json?.props?.pageProps?.state?.settings?.session?.accessToken || null;
    } catch {
        return null;
    }
}

export const spotifyArtworkProvider = {
    setCachedUserToken(token: string | null) {
        if (token && typeof token === 'string') {
            cachedUserToken = token;
            console.log('[SpotifyArtworkProvider] Cached authenticated user token from Web Player');
        }
    },

    /**
     * Resolves Spotify Canvas animated artwork
     */
    async fetchArtwork(track: ArtworkTrackInfo, signal?: AbortSignal): Promise<AnimatedArtworkData> {
        const fallback: AnimatedArtworkData = {
            source: 'spotify',
            available: false,
            videoUrl: null,
            videoTallUrl: null,
            previewUrl: null,
            artworkId: null
        };

        if (!track || !track.title || track.title === 'No song playing') {
            return fallback;
        }

        if (signal?.aborted) {
            return fallback;
        }

        try {
            // 1. Direct canvasUrl supplied by the Spotify Web Player extension bridge
            if (track.canvasUrl && typeof track.canvasUrl === 'string' && track.canvasUrl.startsWith('http')) {
                console.log('[SpotifyArtworkProvider] Using direct Canvas URL from Spotify Web Player bridge');
                return {
                    source: 'spotify',
                    available: true,
                    videoUrl: track.canvasUrl,
                    videoTallUrl: track.canvasUrl,
                    previewUrl: track.coverArt || null,
                    artworkId: track.id || null
                };
            }

            // 2. Resolve clean Spotify Track ID
            let spotifyTrackId: string | null = null;
            if (track.source === 'spotify' && track.id) {
                spotifyTrackId = cleanSpotifyId(track.id);
            }

            // If track is from YouTube Music or has no valid Spotify ID, resolve via Spotify Search catalog
            if (!spotifyTrackId) {
                spotifyTrackId = await resolveSpotifyTrackId(track.title, track.artist, track.album, track.duration);
            }

            const canvasApiUrl = (import.meta.env.VITE_SPOTIFY_CANVAS_API as string) || 'http://localhost:4000';
            const tokenParam = cachedUserToken ? `&token=${encodeURIComponent(cachedUserToken)}` : '';

            // If track ID is known, query by trackId
            if (spotifyTrackId) {
                try {
                    const apiRes = await fetch(`${canvasApiUrl.replace(/\/$/, '')}/api/canvas?trackId=${spotifyTrackId}${tokenParam}`, {
                        signal: AbortSignal.timeout(6000)
                    });
                    if (apiRes.ok) {
                        const json = await apiRes.json();
                        const item = json?.data?.canvasesList?.[0];
                        if (item?.canvasUrl) {
                            console.log(`[SpotifyArtworkProvider] Found Canvas via Canvas API service for ${spotifyTrackId}:`, item.canvasUrl);
                            return {
                                source: 'spotify',
                                available: true,
                                videoUrl: item.canvasUrl,
                                videoTallUrl: item.canvasUrl,
                                previewUrl: track.coverArt || null,
                                artworkId: spotifyTrackId
                            };
                        }
                    }
                } catch {
                    // service not running or timed out; proceed
                }
            }

            // Fallback: If track ID was not resolved or returned no canvas, query canvas API by song title and artist
            try {
                const apiRes = await fetch(
                    `${canvasApiUrl.replace(/\/$/, '')}/api/canvas?title=${encodeURIComponent(track.title)}&artist=${encodeURIComponent(track.artist)}${tokenParam}`,
                    { signal: AbortSignal.timeout(6000) }
                );
                if (apiRes.ok) {
                    const json = await apiRes.json();
                    const item = json?.data?.canvasesList?.[0];
                    if (item?.canvasUrl) {
                        console.log(`[SpotifyArtworkProvider] Found Canvas via title/artist search for "${track.title}":`, item.canvasUrl);
                        return {
                            source: 'spotify',
                            available: true,
                            videoUrl: item.canvasUrl,
                            videoTallUrl: item.canvasUrl,
                            previewUrl: track.coverArt || null,
                            artworkId: item.id || spotifyTrackId || null
                        };
                    }
                }
            } catch {
                // proceed to direct lookup
            }

            if (!spotifyTrackId) {
                return fallback;
            }

            // 3. Query Spotify's internal canvaz-cache endpoint using user token or anonymous token
            const token = cachedUserToken || await getAnonymousToken(signal);
            if (token) {
                const payload = encodeCanvasProtobuf(spotifyTrackId);
                const canvasRes = await fetch('https://spclient.wg.spotify.com/canvaz-cache/v0/canvases', {
                    method: 'POST',
                    headers: {
                        'accept': 'application/protobuf',
                        'content-type': 'application/x-www-form-urlencoded',
                        'authorization': `Bearer ${token}`
                    },
                    body: payload as unknown as BodyInit,
                    signal: signal ? signal : AbortSignal.timeout(5000)
                });

                if (canvasRes.ok) {
                    const buf = await canvasRes.arrayBuffer();
                    const canvasUrl = parseCanvasProtobuf(buf);
                    if (canvasUrl) {
                        console.log(`[SpotifyArtworkProvider] Found Canvas for ${spotifyTrackId}:`, canvasUrl);
                        return {
                            source: 'spotify',
                            available: true,
                            videoUrl: canvasUrl,
                            videoTallUrl: canvasUrl,
                            previewUrl: track.coverArt || null,
                            artworkId: spotifyTrackId
                        };
                    }
                }
            }

            return fallback;
        } catch (err: unknown) {
            const error = err as { name?: string };
            if (error.name !== 'AbortError') {
                console.warn('[SpotifyArtworkProvider] Canvas resolution error (gracefully falling back):', err);
            }
            return fallback;
        }
    }
};
