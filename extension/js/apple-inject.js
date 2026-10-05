// Main World Script for Apple Music Web Player (accesses window.MusicKit directly)
console.log("[Lyrics App Bridge] Apple Music Main World Script Injected");

(function() {
    let lastBroadcastId = '';

    // Listen for playback commands from the isolated content script
    window.addEventListener('message', (event) => {
        if (event.source !== window || event.data?.sender !== 'lyrics-app-apple-command') return;

        const action = event.data.action;
        console.log('[LyricsBridge: Apple Main] Received music command:', action);

        try {
            const mk = window.MusicKit?.getInstance?.();
            const player = mk?.player || mk;
            if (!player) {
                console.warn('[LyricsBridge: Apple Main] MusicKit player instance not ready');
                return;
            }

            switch (action) {
                case 'play-pause':
                    if (player.isPlaying) {
                        player.pause?.();
                    } else {
                        player.play?.();
                    }
                    break;
                case 'next':
                    if (typeof player.skipToNextItem === 'function') {
                        player.skipToNextItem();
                    } else if (typeof player.next === 'function') {
                        player.next();
                    }
                    break;
                case 'previous':
                    if (typeof player.skipToPreviousItem === 'function') {
                        player.skipToPreviousItem();
                    } else if (typeof player.previous === 'function') {
                        player.previous();
                    }
                    break;
            }
            // Trigger state broadcast after action
            setTimeout(broadcastState, 200);
        } catch (err) {
            console.error('[LyricsBridge: Apple Main] Error executing MusicKit command:', err);
        }
    });

    function broadcastState() {
        try {
            const mk = window.MusicKit?.getInstance?.();
            const player = mk?.player || mk;
            if (!player) return;

            const item = player.nowPlayingItem;
            if (!item) return;

            const isPlaying = Boolean(player.isPlaying);
            const progress = Math.round((player.currentPlaybackTime || 0) * 1000);
            const duration = Math.round((player.currentPlaybackDuration || 0) * 1000);

            let coverArt = item.artworkURL || '';
            if (coverArt) {
                coverArt = coverArt.replace('{w}x{h}bb', '600x600bb').replace('{w}x{h}cc', '600x600cc');
            }

            window.postMessage({
                sender: 'lyrics-app-musickit',
                title: item.title || '',
                artist: item.artistName || '',
                album: item.albumName || '',
                coverArt: coverArt,
                duration: duration,
                progress: progress,
                isPlaying: isPlaying,
                id: item.id ? String(item.id) : '',
                isExplicit: Boolean(item.contentRating === 'explicit' || item.isExplicitItem)
            }, '*');
        } catch (err) {
            // Ignore temporary MusicKit read errors during track transitions
        }
    }

    // Attach listeners to MusicKit events once available
    let attempts = 0;
    const pollInterval = setInterval(() => {
        attempts++;
        const mk = window.MusicKit?.getInstance?.();
        const player = mk?.player || mk;

        if (player) {
            clearInterval(pollInterval);
            console.log('[LyricsBridge: Apple Main] MusicKit player instance detected');

            const Events = window.MusicKit?.Events;
            if (Events) {
                if (Events.metadataDidChange) player.addEventListener?.(Events.metadataDidChange, broadcastState);
                if (Events.playbackStateDidChange) player.addEventListener?.(Events.playbackStateDidChange, broadcastState);
                if (Events.nowPlayingItemDidChange) player.addEventListener?.(Events.nowPlayingItemDidChange, broadcastState);
                if (Events.playbackTimeDidChange) player.addEventListener?.(Events.playbackTimeDidChange, broadcastState);
            }

            broadcastState();
        } else if (attempts > 60) {
            // After 30s stop aggressive polling
            clearInterval(pollInterval);
        }
    }, 500);

    // Periodic heartbeat sync
    setInterval(broadcastState, 1000);
})();
