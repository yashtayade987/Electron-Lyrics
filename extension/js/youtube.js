// Content Script for YouTube Music
console.log("Lyrics App Bridge: YouTube Music Script Loaded");

let socket = io('http://localhost:4000', {
    reconnection: true,
    reconnectionDelay: 1000,
    transports: ['websocket']
});

let lastSongId = '';
let lastCommandTime = 0;
let lastCommandAction = '';

function triggerInstantBurstScan() {
    const prevKey = lastSongId;
    let scans = 0;
    const maxScans = 40; // 40 scans * 30ms = 1.2s max duration
    const timer = setInterval(() => {
        scans++;
        const data = getYouTubeMusicData();
        if (data && data.title) {
            const newKey = `${data.title}-${data.artist}`;
            if (newKey !== prevKey) {
                clearInterval(timer);
                console.log(`[ElectronLyrics: YouTube] Fast burst detected song change in ${scans * 30}ms:`, data.title);
                sendSongUpdate(data);
                return;
            }
        }
        if (scans >= maxScans) {
            clearInterval(timer);
        }
    }, 30);
}

// Listen for music commands from the Electron app
socket.on('music_command', (data) => {
    if (!data?.action) return;
    const now = Date.now();
    if (data.action === lastCommandAction && now - lastCommandTime < 150) {
        console.log('[ElectronLyrics] Debouncing duplicate music command:', data.action);
        return;
    }
    lastCommandTime = now;
    lastCommandAction = data.action;

    console.log('[ElectronLyrics] Music command received:', data.action);

    const clickButton = (selectors) => {
        for (const selector of selectors) {
            const btn = document.querySelector(selector);
            if (btn) {
                console.log('[ElectronLyrics] Found button:', selector);
                btn.focus?.();
                const eventOptions = { bubbles: true, cancelable: true, view: window };
                btn.dispatchEvent(new PointerEvent('pointerdown', eventOptions));
                btn.dispatchEvent(new MouseEvent('mousedown', eventOptions));
                btn.dispatchEvent(new PointerEvent('pointerup', eventOptions));
                btn.dispatchEvent(new MouseEvent('mouseup', eventOptions));
                if (typeof btn.click === 'function') {
                    btn.click();
                } else {
                    btn.dispatchEvent(new MouseEvent('click', eventOptions));
                }
                return true;
            }
        }
        console.warn('[ElectronLyrics] No button found for:', data.action);
        return false;
    };

    switch (data.action) {
        case 'previous':
            clickButton([
                'ytmusic-player-bar #previous-button',
                'ytmusic-player-bar .previous-button button',
                'tp-yt-paper-icon-button.previous-button',
                '.player-controls-top button[aria-label="Previous"]',
            ]);
            triggerInstantBurstScan();
            break;
        case 'play-pause':
            clickButton([
                'ytmusic-player-bar #play-pause-button',
                'ytmusic-player-bar tp-yt-paper-icon-button#play-pause-button',
                '.player-controls-top button[aria-label="Play"]',
                '.player-controls-top button[aria-label="Pause"]',
            ]);
            break;
        case 'next':
            clickButton([
                'ytmusic-player-bar #next-button',
                'ytmusic-player-bar .next-button button',
                'tp-yt-paper-icon-button.next-button',
                '.player-controls-top button[aria-label="Next"]',
            ]);
            triggerInstantBurstScan();
            break;
    }
});

function getYouTubeMusicData() {
    // 1. MediaSession API (Universal)
    let title = '';
    let artist = '';
    let coverArt = '';

    if (navigator.mediaSession && navigator.mediaSession.metadata) {
        title = navigator.mediaSession.metadata.title;
        artist = navigator.mediaSession.metadata.artist;
        if (navigator.mediaSession.metadata.artwork?.length > 0) {
            coverArt = navigator.mediaSession.metadata.artwork[navigator.mediaSession.metadata.artwork.length - 1].src;
        }
    }

    const playerBar = document.querySelector('ytmusic-player-bar');
    if (!playerBar) return { title, artist, coverArt };

    if (!title) {
        const titleElement = playerBar.querySelector('yt-formatted-string.title.ytmusic-player-bar')
            || playerBar.querySelector('yt-formatted-string.title')
            || playerBar.querySelector('.title-column .title')
            || playerBar.querySelector('.content-info-wrapper .title');
        title = titleElement?.textContent?.trim() || '';
    }

    let album = '';
    if (navigator.mediaSession?.metadata?.album) {
        album = navigator.mediaSession.metadata.album;
    }

    if (!artist) {
        const subtitleSections = playerBar.querySelectorAll('.subtitle.ytmusic-player-bar a')
            || playerBar.querySelectorAll('.byline-column a');
        artist = subtitleSections.length > 0 ? subtitleSections[0].textContent?.trim() : '';
        if (!album && subtitleSections.length > 1) {
            const albumCandidate = subtitleSections[1].textContent?.trim() || '';
            if (albumCandidate && !/^\d{4}$/.test(albumCandidate)) {
                album = albumCandidate;
            }
        }
    }

    if (!coverArt) {
        const imgElement = playerBar.querySelector('img#img') || playerBar.querySelector('.image');
        coverArt = imgElement?.src || '';
    }

    const playPauseButton = playerBar.querySelector('#play-pause-button');
    let isPlaying = false;

    if (navigator.mediaSession && navigator.mediaSession.playbackState === 'playing') {
        isPlaying = true;
    } else if (navigator.mediaSession && navigator.mediaSession.playbackState === 'paused') {
        isPlaying = false;
    } else {
        isPlaying = playPauseButton?.getAttribute('aria-label') === 'Pause' || playPauseButton?.title === 'Pause';
    }

    // Better progress detection
    const progressSlider = document.querySelector('#progress-bar');
    const duration = progressSlider?.getAttribute('aria-valuemax') * 1000 || 0;
    const progress = progressSlider?.getAttribute('aria-valuenow') * 1000 || 0;

    const videoIdMatch = window.location.search.match(/v=([^&]+)/);
    const videoId = videoIdMatch ? videoIdMatch[1] : (playerBar.querySelector('a.ytmusic-player-bar')?.href?.match(/v=([^&]+)/)?.[1]);

    const explicitElement = playerBar.querySelector(
        '.badge-style-type-explicit, yt-icon.explicit, [aria-label="Explicit"], [title="Explicit"], .explicit'
    );
    const isExplicit = !!explicitElement || /\b(explicit|dirty)\b/i.test(title);

    return {
        source: 'youtube',
        title,
        artist,
        album,
        coverArt,
        videoId,
        progress: isNaN(progress) ? 0 : progress,
        duration: isNaN(duration) ? 0 : duration,
        isPlaying,
        isExplicit
    };
}

let lastEmittedAlbum = '';
let lastEmittedCover = '';
let lastEmittedDuration = 0;

function sendSongUpdate(data) {
    if (!data.title) return;
    lastSongId = `${data.title}-${data.artist}`;
    lastEmittedAlbum = data.album || '';
    lastEmittedCover = data.coverArt || '';
    lastEmittedDuration = data.duration || 0;
    console.log("[ElectronLyrics] New Song:", data.title, "by", data.artist);
    socket.emit('song_update', data);
}

function sendProgressUpdate(data) {
    if (!data.title) return;
    socket.emit('progress_update', {
        source: 'youtube',
        title: data.title,
        artist: data.artist,
        progress: data.progress,
        duration: data.duration,
        isPlaying: data.isPlaying
    });
}

function checkAndUpdate() {
    const data = getYouTubeMusicData();
    if (!data.title) return;
    const songId = `${data.title}-${data.artist}`;
    const isNewSong = songId !== lastSongId;
    const isNewAlbum = Boolean(data.album && !lastEmittedAlbum);
    const isNewCover = Boolean(data.coverArt && data.coverArt !== lastEmittedCover);
    const isNewDuration = Boolean(data.duration && !lastEmittedDuration);

    if (isNewSong || isNewAlbum || isNewCover || isNewDuration) {
        sendSongUpdate(data);
    } else {
        sendProgressUpdate(data);
    }
}

// Send current song immediately on connection/reconnection
socket.on('connect', () => {
    console.log('[ElectronLyrics] Connected to Electron app');
    const data = getYouTubeMusicData();
    if (data.title) {
        sendSongUpdate(data);
    }
});

socket.on('request_current_song', () => {
    const data = getYouTubeMusicData();
    if (data.title) {
        sendSongUpdate(data);
    }
});

// Periodic status poll (150ms for ultra-fast reaction)
setInterval(checkAndUpdate, 150);

// Fast reaction using MutationObserver on the player bar
const observer = new MutationObserver(() => {
    checkAndUpdate();
});

function initObserver() {
    const target = document.querySelector('ytmusic-player-bar, body');
    if (target) {
        observer.observe(target, { 
            childList: true, 
            subtree: true, 
            characterData: true,
            attributes: true, 
            attributeFilter: ['aria-valuenow', 'aria-label', 'title', 'src', 'href'] 
        });
        console.log('[ElectronLyrics] Fast MutationObserver attached to YouTube Music player');
    } else {
        setTimeout(initObserver, 1000);
    }
}
initObserver();

