// Content Script for Spotify Web Player
console.log("[Lyrics App Bridge] Spotify Web Player Script Loaded");

let socket = io('http://localhost:4000', {
    reconnection: true,
    reconnectionDelay: 1000,
    transports: ['websocket']
});

let lastSongId = '';
let isCurrentActiveTab = false;
let authenticatedSpotifyToken = null;
let fiberTrackData = null;
const canvasCache = new Map(); // trackId -> canvasUrl (string or null)

// Protobuf encoder for Spotify canvaz-cache request
function encodeCanvasProtobuf(trackId) {
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

// Protobuf decoder for Spotify canvaz-cache response
function parseCanvasProtobuf(buffer) {
    try {
        const text = new TextDecoder('utf-8', { fatal: false }).decode(buffer);
        const match = text.match(/https:\/\/canvaz\.scdn\.co\/[A-Za-z0-9_.~:/?#[\]@!$&'()*+,;=-]+/);
        if (match) return match[0];
        const anyMp4 = text.match(/https:\/\/[A-Za-z0-9_.~:/?#[\]@!$&'()*+,;=-]+\.mp4[A-Za-z0-9_.~:/?#[\]@!$&'()*+,;=-]*/);
        if (anyMp4) return anyMp4[0];
    } catch {}
    return null;
}

// Fetch authenticated token directly from Spotify Web Player session
async function fetchWebPlayerToken() {
    if (authenticatedSpotifyToken) return authenticatedSpotifyToken;
    try {
        const res = await fetch('https://open.spotify.com/get_access_token?reason=transport&productType=web_player', {
            credentials: 'include'
        });
        if (res.ok) {
            const data = await res.json();
            if (data?.accessToken) {
                authenticatedSpotifyToken = data.accessToken;
                console.log('[LyricsBridge: Spotify] Retrieved authenticated Web Player access token');
                return authenticatedSpotifyToken;
            }
        }
    } catch (e) {
        // fetch fallback
    }
    // Request from main world inject script
    window.postMessage({ sender: 'lyrics-app-spotify-request-token' }, '*');
    return null;
}

// Fetch Canvas from Spotify internal canvaz-cache endpoint
async function fetchSpotifyCanvas(trackId) {
    if (!trackId || !/^[A-Za-z0-9]{22}$/.test(trackId)) return null;
    if (canvasCache.has(trackId)) return canvasCache.get(trackId);

    const token = await fetchWebPlayerToken();
    if (!token) return null;

    // 1. Direct browser fetch to spclient
    try {
        const payload = encodeCanvasProtobuf(trackId);
        const res = await fetch('https://spclient.wg.spotify.com/canvaz-cache/v0/canvases', {
            method: 'POST',
            headers: {
                'accept': 'application/protobuf',
                'content-type': 'application/x-www-form-urlencoded',
                'authorization': `Bearer ${token}`
            },
            body: payload
        });

        if (res.ok) {
            const buf = await res.arrayBuffer();
            const canvasUrl = parseCanvasProtobuf(buf);
            console.log(`[LyricsBridge: Spotify] Canvas result for ${trackId}:`, canvasUrl ? 'FOUND' : 'NONE');
            if (canvasUrl) {
                canvasCache.set(trackId, canvasUrl);
                return canvasUrl;
            }
        } else if (res.status === 401) {
            authenticatedSpotifyToken = null; // Token expired, request fresh
            window.postMessage({ sender: 'lyrics-app-spotify-request-token' }, '*');
        }
    } catch (err) {
        console.warn('[LyricsBridge: Spotify] Error fetching canvas directly from spclient, trying local bridge server:', err);
    }

    // 2. Fallback: local bridge server on port 4000 (Node.js environment has no browser restrictions)
    try {
        const sRes = await fetch(`http://localhost:4000/api/canvas?trackId=${trackId}&token=${encodeURIComponent(token)}`);
        if (sRes.ok) {
            const json = await sRes.json();
            const canvasUrl = json?.data?.canvasesList?.[0]?.canvasUrl;
            if (canvasUrl) {
                console.log(`[LyricsBridge: Spotify] Canvas obtained via local bridge server for ${trackId}:`, canvasUrl);
                canvasCache.set(trackId, canvasUrl);
                return canvasUrl;
            }
        }
    } catch {}

    canvasCache.set(trackId, null);
    return null;
}

// Listen for messages from MAIN world script (spotify-inject.js)
window.addEventListener('message', (event) => {
    if (event.source !== window) return;
    if (event.data?.sender === 'lyrics-app-spotify-token' && event.data.token) {
        authenticatedSpotifyToken = event.data.token;
        console.log('[LyricsBridge: Spotify] Authenticated token synced from Main World');
    }
    if (event.data?.sender === 'lyrics-app-spotify-fiber-track' && event.data.id) {
        fiberTrackData = { id: event.data.id, name: event.data.name || '' };
    }
});

// Trigger initial token request
fetchWebPlayerToken();

// Trigger click with full pointer & mouse event cycle for React compatibility
function triggerClick(element) {
    if (!element) return false;
    try {
        element.focus?.();
        const eventOptions = { bubbles: true, cancelable: true, view: window };
        element.dispatchEvent(new PointerEvent('pointerdown', eventOptions));
        element.dispatchEvent(new MouseEvent('mousedown', eventOptions));
        element.dispatchEvent(new PointerEvent('pointerup', eventOptions));
        element.dispatchEvent(new MouseEvent('mouseup', eventOptions));
        element.dispatchEvent(new MouseEvent('click', eventOptions));
        if (typeof element.click === 'function') {
            element.click();
        }
        return true;
    } catch (err) {
        console.error('[LyricsBridge: Spotify] Error clicking element:', err);
        return false;
    }
}

function clickButton(selectors) {
    for (const selector of selectors) {
        const btn = document.querySelector(selector);
        if (btn) {
            console.log('[LyricsBridge: Spotify] Found and clicked button:', selector);
            return triggerClick(btn);
        }
    }
    console.warn('[LyricsBridge: Spotify] No button found for selectors:', selectors);
    return false;
}

// Listen for music commands from the Electron app
socket.on('music_command', (data) => {
    console.log('[LyricsBridge: Spotify] Music command received:', data.action);

    // Only process command if this tab has an active player or was playing
    const playerBar = document.querySelector('[data-testid="now-playing-bar"], [data-testid="now-playing-widget"], footer');
    if (!playerBar && !navigator.mediaSession?.metadata?.title) {
        return;
    }

    switch (data.action) {
        case 'previous':
            clickButton([
                'button[data-testid="control-button-skip-back"]',
                '[data-testid="now-playing-bar"] button[data-testid="control-button-skip-back"]',
                '[data-testid="player-controls"] button[data-testid="control-button-skip-back"]',
                'footer button[data-testid="control-button-skip-back"]',
                'button[aria-label="Previous"]',
                'button[aria-label="Skip back"]'
            ]);
            break;

        case 'play-pause':
            clickButton([
                'button[data-testid="control-button-playpause"]',
                '[data-testid="now-playing-bar"] button[data-testid="control-button-playpause"]',
                '[data-testid="player-controls"] button[data-testid="control-button-playpause"]',
                'footer button[data-testid="control-button-playpause"]',
                'button[aria-label="Play"]',
                'button[aria-label="Pause"]'
            ]);
            break;

        case 'next':
            clickButton([
                'button[data-testid="control-button-skip-forward"]',
                '[data-testid="now-playing-bar"] button[data-testid="control-button-skip-forward"]',
                '[data-testid="player-controls"] button[data-testid="control-button-skip-forward"]',
                'footer button[data-testid="control-button-skip-forward"]',
                'button[aria-label="Next"]',
                'button[aria-label="Skip forward"]'
            ]);
            break;
    }
});

// Convert mm:ss or hh:mm:ss to milliseconds
function parseTimeString(timeStr) {
    if (!timeStr) return 0;
    const parts = timeStr.trim().split(':').map(Number);
    if (parts.some(isNaN)) return 0;
    if (parts.length === 2) {
        return (parts[0] * 60 + parts[1]) * 1000;
    } else if (parts.length === 3) {
        return (parts[0] * 3600 + parts[1] * 60 + parts[2]) * 1000;
    }
    return 0;
}

// Helper to inspect React Fiber for Spotify track URI / ID
function getTrackIdFromFiber(el) {
    if (!el) return null;
    try {
        const key = Object.keys(el).find(k => k.startsWith('__reactFiber') || k.startsWith('__reactInternalInstance'));
        if (!key) return null;
        let fiber = el[key];
        let depth = 0;
        while (fiber && depth < 30) {
            const props = fiber.memoizedProps;
            if (props) {
                const uri = props.track?.uri || props.item?.uri || props.uri;
                if (uri && typeof uri === 'string' && uri.includes('track:')) {
                    const match = uri.match(/track:([a-zA-Z0-9]{22})/);
                    if (match) return match[1];
                }
                const track = props.track || props.item;
                if (track && track.id && typeof track.id === 'string' && track.id.length === 22) {
                    return track.id;
                }
            }
            fiber = fiber.return;
            depth++;
        }
    } catch {}
    return null;
}

function getSpotifyData() {
    let title = '';
    let artist = '';
    let album = '';
    let coverArt = '';
    let trackId = '';
    let isPlaying = false;
    let progress = 0;
    let duration = 0;
    let isExplicit = false;

    // 1. MediaSession API (Standard & reliable across modern browsers)
    if (navigator.mediaSession && navigator.mediaSession.metadata) {
        title = navigator.mediaSession.metadata.title || '';
        artist = navigator.mediaSession.metadata.artist || '';
        album = navigator.mediaSession.metadata.album || '';

        const artworkList = navigator.mediaSession.metadata.artwork;
        if (artworkList && artworkList.length > 0) {
            coverArt = artworkList[artworkList.length - 1].src;
        }
    }

    if (navigator.mediaSession && navigator.mediaSession.playbackState) {
        if (navigator.mediaSession.playbackState === 'playing') {
            isPlaying = true;
        } else if (navigator.mediaSession.playbackState === 'paused') {
            isPlaying = false;
        }
    }

    if (typeof navigator.mediaSession?.getPositionState === 'function') {
        try {
            const posState = navigator.mediaSession.getPositionState();
            if (posState) {
                if (posState.position != null) progress = Math.round(posState.position * 1000);
                if (posState.duration != null) duration = Math.round(posState.duration * 1000);
            }
        } catch {
            // getPositionState might throw if not ready
        }
    }

    // 2. DOM extraction (complements / fills in gaps)
    const playerBar = document.querySelector('[data-testid="now-playing-bar"], [data-testid="now-playing-widget"], footer');

    if (playerBar) {
        // Multi-level Track ID detection:
        // 0. Check fiberTrackData from Main World script, validating that track name matches current song
        if (fiberTrackData && /^[a-zA-Z0-9]{22}$/.test(fiberTrackData.id)) {
            if (!title || !fiberTrackData.name || fiberTrackData.name.toLowerCase() === title.toLowerCase()) {
                trackId = fiberTrackData.id;
            }
        }

        // 1. Check all candidate track link selectors STRICTLY within playerBar (never query full document)
        if (!trackId) {
            const trackLinkSelectors = [
                '[data-testid="now-playing-widget"] a[href*="/track/"]',
                '[data-testid="context-item-info-title"] a[href*="/track/"]',
                'a[data-testid="context-item-link"][href*="/track/"]',
                '[data-testid="now-playing-bar"] a[href*="/track/"]',
                '[data-testid="now-playing-view"] a[href*="/track/"]',
                'a[href*="/track/"]'
            ];
            for (const selector of trackLinkSelectors) {
                const linkEl = playerBar.querySelector(selector);
                if (linkEl && linkEl.href) {
                    const match = linkEl.href.match(/\/track\/([a-zA-Z0-9]{22})/);
                    if (match) {
                        trackId = match[1];
                        break;
                    }
                }
            }
        }

        // 2. Check data-uri attributes strictly within playerBar
        if (!trackId) {
            const uriEl = playerBar.querySelector('[data-uri*="spotify:track:"]');
            if (uriEl) {
                const uriAttr = uriEl.getAttribute('data-uri') || '';
                const m = uriAttr.match(/spotify:track:([a-zA-Z0-9]{22})/);
                if (m) {
                    trackId = m[1];
                }
            }
        }

        // 3. Check React Fiber from player bar if DOM link not found
        if (!trackId && playerBar) {
            trackId = getTrackIdFromFiber(playerBar) || '';
        }

        // Title fallback
        if (!title) {
            const titleEl = playerBar.querySelector(
                '[data-testid="context-item-info-title"] a, ' +
                '[data-testid="context-item-link"], ' +
                '[data-testid="track-info-name"], ' +
                '[data-testid="context-item-info-title"]'
            );
            title = titleEl?.textContent?.trim() || '';
        }

        // Artist fallback
        if (!artist) {
            const artistEls = playerBar.querySelectorAll(
                '[data-testid="context-item-info-artist"] a, ' +
                '[data-testid="context-item-info-subtitles"] a, ' +
                '[data-testid="track-info-artists"] a'
            );
            if (artistEls.length > 0) {
                artist = Array.from(artistEls).map(el => el.textContent.trim()).filter(Boolean).join(', ');
            } else {
                const subtitle = playerBar.querySelector('[data-testid="context-item-info-subtitles"], [data-testid="context-item-info-artist"]');
                artist = subtitle?.textContent?.trim() || '';
            }
        }

        // Album fallback
        if (!album) {
            const albumLink = playerBar.querySelector('a[href*="/album/"]');
            album = albumLink?.textContent?.trim() || '';
        }

        // Cover art fallback
        if (!coverArt) {
            const imgEl = playerBar.querySelector('img[data-testid="cover-art-image"], [data-testid="now-playing-widget"] img');
            coverArt = imgEl?.src || '';
        }

        // Play/Pause button detection
        const playPauseBtn = playerBar.querySelector('button[data-testid="control-button-playpause"]');
        if (playPauseBtn) {
            const ariaLabel = playPauseBtn.getAttribute('aria-label') || '';
            const svgTitle = playPauseBtn.querySelector('svg title')?.textContent || '';
            if (ariaLabel.toLowerCase() === 'pause' || svgTitle.toLowerCase() === 'pause') {
                isPlaying = true;
            } else if (ariaLabel.toLowerCase() === 'play' || svgTitle.toLowerCase() === 'play') {
                isPlaying = false;
            } else {
                // Spotify pause button renders 2 rects / paths (M2.7 1...)
                const hasPauseIcon = playPauseBtn.querySelector('path[d*="M2.7"], path[d*="M3 2h3v12H3zm8 0h3v12h-3z"], rect') !== null;
                if (hasPauseIcon) isPlaying = true;
            }
        }

        // Progress text: [data-testid="playback-position"]
        if (progress === 0) {
            const posEl = playerBar.querySelector('[data-testid="playback-position"]');
            if (posEl) progress = parseTimeString(posEl.textContent);
        }

        // Duration text: [data-testid="playback-duration"]
        if (duration === 0) {
            const durEl = playerBar.querySelector('[data-testid="playback-duration"]');
            if (durEl) duration = parseTimeString(durEl.textContent);
        }

        // Explicit badge
        const explicitEl = playerBar.querySelector(
            '[data-testid="explicit-badge"], [aria-label="Explicit"], [title="Explicit"]'
        );
        isExplicit = !!explicitEl || /\b(explicit|dirty)\b/i.test(title);
    }

    // Canvas video detection:
    // First check memory cache from API
    let canvasUrl = trackId && canvasCache.has(trackId) ? canvasCache.get(trackId) : null;

    // Fallback: check if any video element is mounted in DOM
    if (!canvasUrl) {
        const canvasVideoEl = document.querySelector(
            'video[src*="canvaz.scdn.co"], [data-testid="canvas-video"], .canvas-video, [data-testid="canvas-container"] video'
        );
        if (canvasVideoEl) {
            canvasUrl = canvasVideoEl.currentSrc || canvasVideoEl.src || null;
        }
    }

    return {
        source: 'spotify',
        id: trackId || null,
        title,
        artist,
        album,
        coverArt,
        canvasUrl,
        spotifyToken: authenticatedSpotifyToken,
        progress: isNaN(progress) ? 0 : progress,
        duration: isNaN(duration) ? 0 : duration,
        isPlaying,
        isExplicit
    };
}

function sendSongUpdate(data) {
    if (!data.title) return;
    lastSongId = `${data.title}-${data.artist}`;
    fiberTrackData = null; // Reset on song change to prevent ID bleed
    isCurrentActiveTab = true;
    console.log('[LyricsBridge: Spotify] New Song Update:', data.title, 'by', data.artist, '(Track ID:', data.id, ')');

    // Send immediate update
    socket.emit('song_update', data);

    // Asynchronously resolve Canvas via internal canvaz-cache if not yet in cache
    if (data.id && !data.canvasUrl) {
        fetchSpotifyCanvas(data.id).then((resolvedCanvas) => {
            if (resolvedCanvas) {
                console.log('[LyricsBridge: Spotify] Emitting async canvas_update for', data.id, resolvedCanvas);
                data.canvasUrl = resolvedCanvas;
                socket.emit('canvas_update', {
                    trackId: data.id,
                    canvasUrl: resolvedCanvas,
                    spotifyToken: authenticatedSpotifyToken
                });
            }
        });
    }
}

function sendProgressUpdate(data) {
    if (!data.title) return;
    socket.emit('progress_update', {
        source: 'spotify',
        title: data.title,
        artist: data.artist,
        progress: data.progress,
        duration: data.duration,
        isPlaying: data.isPlaying
    });
}

// Send current song immediately on connection/reconnection
socket.on('connect', () => {
    console.log('[LyricsBridge: Spotify] Connected to Lyrics Electron App');
    const data = getSpotifyData();
    if (data.title) {
        sendSongUpdate(data);
    }
});

// Periodic status poll
setInterval(() => {
    const data = getSpotifyData();
    if (!data.title) return;

    const songId = `${data.title}-${data.artist}`;
    if (songId !== lastSongId) {
        sendSongUpdate(data);
    } else {
        // Send progress updates when playing or when active
        if (data.isPlaying || isCurrentActiveTab) {
            sendProgressUpdate(data);
        }
    }
}, 1000);

// Fast reaction using MutationObserver on the player bar
const observer = new MutationObserver(() => {
    const data = getSpotifyData();
    if (!data.title) return;

    const songId = `${data.title}-${data.artist}`;
    if (songId !== lastSongId) {
        sendSongUpdate(data);
    }
});

function initObserver() {
    const target = document.querySelector('[data-testid="now-playing-bar"], footer, body');
    if (target) {
        observer.observe(target, { childList: true, subtree: true, attributes: true, attributeFilter: ['aria-label', 'src'] });
        console.log('[LyricsBridge: Spotify] MutationObserver attached to Spotify player');
    } else {
        setTimeout(initObserver, 1500);
    }
}
initObserver();
