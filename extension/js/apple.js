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

// Trigger click with clean single click event
function triggerClick(element) {
    if (!element) return false;
    try {
        element.focus?.();
        const eventOptions = { bubbles: true, cancelable: true, view: window };
        element.dispatchEvent(new PointerEvent('pointerdown', eventOptions));
        element.dispatchEvent(new MouseEvent('mousedown', eventOptions));
        element.dispatchEvent(new PointerEvent('pointerup', eventOptions));
        element.dispatchEvent(new MouseEvent('mouseup', eventOptions));
        if (typeof element.click === 'function') {
            element.click();
        } else {
            element.dispatchEvent(new MouseEvent('click', eventOptions));
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

let lastCommandTime = 0;
let lastCommandAction = '';

function triggerInstantBurstScan() {
    const prevKey = lastSongId;
    let scans = 0;
    const maxScans = 40; // 40 scans * 30ms = 1.2s max duration
    const timer = setInterval(() => {
        scans++;
        const data = getAppleMusicData();
        if (data && data.title) {
            const newKey = `${data.title}-${data.artist}`;
            if (newKey !== prevKey) {
                clearInterval(timer);
                console.log(`[LyricsBridge: Apple] Instant track change detected on scan #${scans} (${scans * 30}ms):`, data.title);
                sendSongUpdate(data);
                return;
            }
        }
        if (scans >= maxScans) {
            clearInterval(timer);
        }
    }, 30);
}

// Listen for music commands from Electron app
socket.on('music_command', (data) => {
    if (!data?.action) return;
    const now = Date.now();
    if (data.action === lastCommandAction && now - lastCommandTime < 150) {
        console.log('[LyricsBridge: Apple] Debouncing duplicate music command:', data.action);
        return;
    }
    lastCommandTime = now;
    lastCommandAction = data.action;

    console.log('[LyricsBridge: Apple] Music command received:', data.action);

    // If MusicKit is active in the Main World, forward exclusively to MusicKit to prevent duplicate actions
    const isMusicKitActive = latestMusicKitData && (Date.now() - lastMusicKitTimestamp < 10000);
    if (isMusicKitActive) {
        window.postMessage({
            sender: 'lyrics-app-apple-command',
            action: data.action
        }, '*');
        if (data.action === 'next' || data.action === 'previous') {
            triggerInstantBurstScan();
        }
        return;
    }

    // Fallback to DOM button click only when MusicKit API is not active
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
            triggerInstantBurstScan();
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
            triggerInstantBurstScan();
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

let lastEmittedTrackId = '';
let lastEmittedAlbum = '';
let lastEmittedCover = '';
let lastEmittedDuration = 0;

function sendSongUpdate(data) {
    if (!data.title) return;
    lastSongId = `${data.title}-${data.artist}`;
    lastEmittedTrackId = data.id || '';
    lastEmittedAlbum = data.album || '';
    lastEmittedCover = data.coverArt || '';
    lastEmittedDuration = data.duration || 0;
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

function checkAndUpdateApple() {
    const data = getAppleMusicData();
    if (!data.title) return;

    const songId = `${data.title}-${data.artist}`;
    const isNewSong = songId !== lastSongId;
    const isNewTrackId = Boolean(data.id && data.id !== lastEmittedTrackId);
    const isNewAlbum = Boolean(data.album && !lastEmittedAlbum);
    const isNewCover = Boolean(data.coverArt && data.coverArt !== lastEmittedCover);
    const isNewDuration = Boolean(data.duration && !lastEmittedDuration);

    if (isNewSong || isNewTrackId || isNewAlbum || isNewCover || isNewDuration) {
        sendSongUpdate(data);
    } else {
        if (data.isPlaying || isCurrentActiveTab) {
            sendProgressUpdate(data);
        }
    }
}

// Send current song immediately on connection/reconnection
socket.on('connect', () => {
    console.log('[LyricsBridge: Apple] Connected to Lyrics Electron App');
    const data = getAppleMusicData();
    if (data.title) {
        sendSongUpdate(data);
    }
});

socket.on('request_current_song', () => {
    const data = getAppleMusicData();
    if (data.title) {
        sendSongUpdate(data);
    }
});

// Periodic status poll
setInterval(checkAndUpdateApple, 150);
