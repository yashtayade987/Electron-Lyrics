/**
 * Isolated Spotify Artwork Provider
 * Resolves Spotify Canvas / animated artwork for a track.
 */

import type { AnimatedArtworkData, ArtworkTrackInfo } from './types';
import { cleanSpotifyId, resolveSpotifyTrackId, getAnonymousSpotifyToken } from '../lyricsProvider';

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

function mergeSignalWithTimeout(signal: AbortSignal | undefined, timeoutMs: number): AbortSignal {
    const timeoutSignal = AbortSignal.timeout(timeoutMs);
    if (!signal) return timeoutSignal;
    if (typeof AbortSignal.any === 'function') {
        return AbortSignal.any([signal, timeoutSignal]);
    }
    const controller = new AbortController();
    const onAbort = () => controller.abort();
    if (signal.aborted) {
        controller.abort();
        return controller.signal;
    }
    signal.addEventListener('abort', onAbort, { once: true });
    timeoutSignal.addEventListener('abort', onAbort, { once: true });
    return controller.signal;
}

let cachedClientToken: string | null = null;
let clientTokenExpires = 0;

async function getClientToken(signal?: AbortSignal): Promise<string | null> {
    if (cachedClientToken && Date.now() < clientTokenExpires) {
        return cachedClientToken;
    }
    try {
        const rand = new Uint8Array(16);
        crypto.getRandomValues(rand);
        const deviceId = Array.from(rand).map((b) => b.toString(16).padStart(2, '0')).join('');
        const res = await fetch("https://clienttoken.spotify.com/v1/clienttoken", {
            method: "POST",
            headers: { "Accept": "application/json", "Content-Type": "application/json" },
            body: JSON.stringify({
                client_data: {
                    client_version: "1.2.50.335.g866e4099",
                    client_id: "d8a5ed958d274c2e8ee717e6a4b0971d",
                    js_sdk_data: {
                        device_brand: "unknown",
                        device_model: "unknown",
                        os: "windows",
                        os_version: "NT 10.0",
                        device_id: deviceId,
                        device_type: "computer"
                    }
                }
            }),
            signal: mergeSignalWithTimeout(signal, 4000)
        });
        if (res.ok) {
            const data = await res.json();
            const token = data?.granted_token?.token;
            if (token) {
                cachedClientToken = token;
                clientTokenExpires = Date.now() + 3600 * 1000;
                return token;
            }
        }
    } catch {
        // ignore
    }
    return null;
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
                spotifyTrackId = await resolveSpotifyTrackId(track.title, track.artist, track.album, track.duration, signal);
            }

            if (signal?.aborted) {
                return fallback;
            }

            const canvasApiUrl = (import.meta.env.VITE_SPOTIFY_CANVAS_API as string) || 'http://localhost:4000';
            const tokenParam = cachedUserToken ? `&token=${encodeURIComponent(cachedUserToken)}` : '';

            // If track ID is known, query by trackId
            if (spotifyTrackId) {
                try {
                    const apiRes = await fetch(`${canvasApiUrl.replace(/\/$/, '')}/api/canvas?trackId=${spotifyTrackId}${tokenParam}`, {
                        signal: mergeSignalWithTimeout(signal, 6000)
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

            if (signal?.aborted) {
                return fallback;
            }

            // Fallback: If track ID was not resolved or returned no canvas, query canvas API by song title and artist
            try {
                const apiRes = await fetch(
                    `${canvasApiUrl.replace(/\/$/, '')}/api/canvas?title=${encodeURIComponent(track.title)}&artist=${encodeURIComponent(track.artist)}${tokenParam}`,
                    { signal: mergeSignalWithTimeout(signal, 6000) }
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

            if (!spotifyTrackId || signal?.aborted) {
                return fallback;
            }

            // 3. Query Spotify's modern GraphQL Pathfinder endpoint with client-token
            const token = cachedUserToken || await getAnonymousSpotifyToken(signal);
            if (token && !signal?.aborted) {
                try {
                    const clientToken = await getClientToken(signal);
                    const headers: Record<string, string> = {
                        "Authorization": `Bearer ${token}`,
                        "Content-Type": "application/json",
                        "Accept": "application/json"
                    };
                    if (clientToken) {
                        headers["client-token"] = clientToken;
                    }
                    const canvasRes = await fetch("https://api-partner.spotify.com/pathfinder/v2/query", {
                        method: "POST",
                        headers,
                        body: JSON.stringify({
                            operationName: "canvas",
                            variables: { trackUri: `spotify:track:${spotifyTrackId}` },
                            extensions: {
                                persistedQuery: {
                                    version: 1,
                                    sha256Hash: "575138ab27cd5c1b3e54da54d0a7cc8d85485402de26340c2145f0f6bb5e7a9f"
                                }
                            }
                        }),
                        signal: mergeSignalWithTimeout(signal, 5000)
                    });
                    if (canvasRes.ok) {
                        const cJson = await canvasRes.json();
                        const canvasUrl = cJson?.data?.trackUnion?.canvas?.url;
                        if (canvasUrl) {
                            console.log(`[SpotifyArtworkProvider] Found Canvas for ${spotifyTrackId} via Pathfinder:`, canvasUrl);
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
                } catch {
                    // proceed to legacy protobuf fallback
                }

                if (signal?.aborted) return fallback;

                // Legacy protobuf fallback
                try {
                    const payload = encodeCanvasProtobuf(spotifyTrackId);
                    const canvasRes = await fetch('https://spclient.wg.spotify.com/canvaz-cache/v0/canvases', {
                        method: 'POST',
                        headers: {
                            'accept': 'application/protobuf',
                            'content-type': 'application/x-www-form-urlencoded',
                            'authorization': `Bearer ${token}`
                        },
                        body: payload as unknown as BodyInit,
                        signal: mergeSignalWithTimeout(signal, 4000)
                    });

                    if (canvasRes.ok) {
                        const buf = await canvasRes.arrayBuffer();
                        const canvasUrl = parseCanvasProtobuf(buf);
                        if (canvasUrl) {
                            console.log(`[SpotifyArtworkProvider] Found Canvas for ${spotifyTrackId} via Protobuf:`, canvasUrl);
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
                } catch {
                    // ignore
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
