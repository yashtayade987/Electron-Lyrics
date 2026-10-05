// Content Script for Apple Music Web Player (Isolated World)
console.log("[Lyrics App Bridge] Apple Music Script Loaded");

let socket = io('http://localhost:4000', {
    reconnection: true,
    reconnectionDelay: 1000,
    transports: ['websocket']
});

let lastSongId = '';
let isCurrentActiveTab = false;
let latestMusicKitData = null;
let lastMusicKitTimestamp = 0;

// Deep selector that traverses both regular DOM and open Shadow DOMs
function findElementDeep(selector, root = document) {
    if (!root) return null;
    try {
        const found = root.querySelector(selector);
        if (found) return found;

        const all = root.querySelectorAll('*');
        for (const el of all) {
            if (el.shadowRoot) {
                const shadowFound = findElementDeep(selector, el.shadowRoot);
                if (shadowFound) return shadowFound;
            }
        }
    } catch {
        // Selector parsing error fallback
    }
    return null;
}

// Trigger click with full pointer & mouse event cycle
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
        console.error('[LyricsBridge: Apple] Error clicking element:', err);
        return false;
    }
}

function clickDeepButton(selectors) {
    for (const selector of selectors) {
        const btn = findElementDeep(selector);
        if (btn) {
            console.log('[LyricsBridge: Apple] Found and clicked button:', selector);
            return triggerClick(btn);
        }
    }
    console.warn('[LyricsBridge: Apple] No button found for selectors:', selectors);
    return false;
}

// Listen for updates from apple-inject.js (MusicKit main world script)
window.addEventListener('message', (event) => {
    if (event.source !== window || event.data?.sender !== 'lyrics-app-musickit') return;
    latestMusicKitData = event.data;
    lastMusicKitTimestamp = Date.now();
});

// Fallback script injection if main world script wasn't automatically injected by browser
setTimeout(() => {
    if (!latestMusicKitData) {
        try {
            const script = document.createElement('script');
            script.src = chrome.runtime.getURL('js/apple-inject.js');
            script.onload = () => script.remove();
            (document.head || document.documentElement).appendChild(script);
        } catch {
            // Ignore if blocked by CSP; MediaSession & DOM fallbacks will take over
        }
    }
}, 1500);

// Listen for music commands from Electron app
socket.on('music_command', (data) => {
    console.log('[LyricsBridge: Apple] Music command received:', data.action);

    // 1. Send command to MusicKit in the Main World
    window.postMessage({
        sender: 'lyrics-app-apple-command',
        action: data.action
    }, '*');

    // 2. Also attempt deep DOM click fallback
    switch (data.action) {
        case 'previous':
            clickDeepButton([
                'button[aria-label="Previous"]',
                'button[aria-label="Previous Track"]',
                'button[aria-label="Backward"]',
                '[data-testid="previous-button"]',
                'amp-playback-controls-bar button.playback-button--previous',
                'button.playback-button--previous',
                '.web-chrome-playback-controls__previous-btn'
            ]);
            break;

        case 'play-pause':
            clickDeepButton([
                'button[aria-label="Pause"]',
                'button[aria-label="Play"]',
                '[data-testid="play-pause-button"]',
                'amp-playback-controls-bar button.playback-button--play',
                'amp-playback-controls-bar button.playback-button--pause',
                'button.playback-button--play',
                'button.playback-button--pause',
                '.web-chrome-playback-controls__play-pause-btn'
            ]);
            break;

        case 'next':
            clickDeepButton([
                'button[aria-label="Next"]',
                'button[aria-label="Next Track"]',
                'button[aria-label="Forward"]',
                '[data-testid="next-button"]',
                'amp-playback-controls-bar button.playback-button--next',
                'button.playback-button--next',
                '.web-chrome-playback-controls__next-btn'
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

function getAppleMusicData() {
    let title = '';
    let artist = '';
    let album = '';
    let coverArt = '';
    let trackId = '';
    let isPlaying = false;
    let progress = 0;
    let duration = 0;
    let isExplicit = false;

    // 1. MusicKit state from main world script (highest precision)
    if (latestMusicKitData && Date.now() - lastMusicKitTimestamp < 3000 && latestMusicKitData.title) {
        title = latestMusicKitData.title;
        artist = latestMusicKitData.artist;
        album = latestMusicKitData.album || '';
        coverArt = latestMusicKitData.coverArt || '';
        trackId = latestMusicKitData.id || '';
        progress = latestMusicKitData.progress || 0;
        duration = latestMusicKitData.duration || 0;
        isPlaying = Boolean(latestMusicKitData.isPlaying);
        isExplicit = Boolean(latestMusicKitData.isExplicit);
    }

    // 2. MediaSession API (Universal browser fallback)
    if (navigator.mediaSession && navigator.mediaSession.metadata) {
        if (!title) title = navigator.mediaSession.metadata.title || '';
        if (!artist) artist = navigator.mediaSession.metadata.artist || '';
        if (!album) album = navigator.mediaSession.metadata.album || '';

        if (!coverArt) {
            const artworkList = navigator.mediaSession.metadata.artwork;
            if (artworkList && artworkList.length > 0) {
                coverArt = artworkList[artworkList.length - 1].src;
            }
        }
    }

    if (navigator.mediaSession && navigator.mediaSession.playbackState) {
        if (navigator.mediaSession.playbackState === 'playing') {
            isPlaying = true;
        } else if (navigator.mediaSession.playbackState === 'paused' && !latestMusicKitData) {
            isPlaying = false;
        }
    }

    if (progress === 0 && typeof navigator.mediaSession?.getPositionState === 'function') {
        try {
            const posState = navigator.mediaSession.getPositionState();
            if (posState) {
                if (posState.position != null) progress = Math.round(posState.position * 1000);
                if (posState.duration != null) duration = Math.round(posState.duration * 1000);
            }
        } catch {
            // ignore
        }
    }

    // 3. DOM & Shadow DOM extraction fallback
    if (!title) {
        const titleEl = findElementDeep(
            '.lcd__title, [data-testid="lcd-title"], .web-chrome-playback-lcd__song-name, amp-lcd .song-name, .song-name'
        );
        title = titleEl?.textContent?.trim() || '';
    }

    if (!artist) {
        const artistEl = findElementDeep(
            '.lcd__sub-title, [data-testid="lcd-subtitle"], .web-chrome-playback-lcd__sub-copy, amp-lcd .artist-name, .artist-name'
        );
        artist = artistEl?.textContent?.trim() || '';
    }

    if (!coverArt) {
        const imgEl = findElementDeep(
            'amp-lcd img, .lcd__artwork img, .web-chrome-playback-lcd__artwork img, picture.artwork img, img.artwork'
        );
        coverArt = imgEl?.src || '';
    }

    // Check HTML5 audio element for playback and progress
    const audioEl = document.querySelector('audio');
    if (audioEl) {
        if (!isNaN(audioEl.currentTime) && progress === 0) {
            progress = Math.round(audioEl.currentTime * 1000);
        }
        if (!isNaN(audioEl.duration) && duration === 0) {
            duration = Math.round(audioEl.duration * 1000);
        }
        if (!latestMusicKitData && !navigator.mediaSession?.playbackState) {
            isPlaying = !audioEl.paused;
        }
    }

    // Check Play/Pause button in DOM
    const playPauseBtn = findElementDeep(
        'amp-playback-controls-bar button.playback-button--play, ' +
        'amp-playback-controls-bar button.playback-button--pause, ' +
        'button[aria-label="Pause"], button[aria-label="Play"], ' +
        '[data-testid="play-pause-button"]'
    );
    if (playPauseBtn && !latestMusicKitData) {
        const label = playPauseBtn.getAttribute('aria-label') || '';
        if (label.toLowerCase() === 'pause') {
            isPlaying = true;
        } else if (label.toLowerCase() === 'play') {
            isPlaying = false;
        }
    }

    // Explicit badge check
    if (!isExplicit) {
        const explicitEl = findElementDeep('.badge--explicit, [aria-label="Explicit"], .explicit-badge');
        isExplicit = !!explicitEl || /\b(explicit|dirty)\b/i.test(title);
    }

    return {
        source: 'apple',
        id: trackId || null,
        title,
        artist,
        album,
        coverArt,
        progress: isNaN(progress) ? 0 : progress,
        duration: isNaN(duration) ? 0 : duration,
        isPlaying,
        isExplicit
    };
}

function sendSongUpdate(data) {
    if (!data.title) return;
    lastSongId = `${data.title}-${data.artist}`;
    isCurrentActiveTab = true;
    console.log('[LyricsBridge: Apple] New Song Update:', data.title, 'by', data.artist);
    socket.emit('song_update', data);
}

function sendProgressUpdate(data) {
    if (!data.title) return;
    socket.emit('progress_update', {
        source: 'apple',
        title: data.title,
        artist: data.artist,
        progress: data.progress,
        duration: data.duration,
        isPlaying: data.isPlaying
    });
}

// Send current song immediately on connection/reconnection
socket.on('connect', () => {
    console.log('[LyricsBridge: Apple] Connected to Lyrics Electron App');
    const data = getAppleMusicData();
    if (data.title) {
        sendSongUpdate(data);
    }
});

// Periodic status poll
setInterval(() => {
    const data = getAppleMusicData();
    if (!data.title) return;

    const songId = `${data.title}-${data.artist}`;
    if (songId !== lastSongId) {
        sendSongUpdate(data);
    } else {
        if (data.isPlaying || isCurrentActiveTab) {
            sendProgressUpdate(data);
        }
    }
}, 1000);
