// Main World Script for Spotify Web Player (runs directly in page context)
console.log("[Lyrics App Bridge] Spotify Main World Script Injected");

(function() {
    let latestToken = null;
    let tokenExpiresAt = 0;

    async function fetchAccessToken() {
        try {
            const now = Date.now();
            if (latestToken && now < tokenExpiresAt - 60000) {
                broadcastToken(latestToken);
                return latestToken;
            }

            const res = await fetch('/get_access_token?reason=transport&productType=web_player', {
                credentials: 'include'
            });

            if (!res.ok) {
                console.warn('[LyricsBridge: Spotify Main] get_access_token HTTP status:', res.status);
                return null;
            }

            const data = await res.json();
            if (data?.accessToken) {
                latestToken = data.accessToken;
                tokenExpiresAt = data.accessTokenExpirationTimestampMs || (Date.now() + 3600000);
                console.log('[LyricsBridge: Spotify Main] Obtained authenticated Spotify access token');
                broadcastToken(latestToken);
                return latestToken;
            }
        } catch (err) {
            console.warn('[LyricsBridge: Spotify Main] Failed to fetch access token:', err);
        }
        return null;
    }

    function broadcastToken(token) {
        if (!token) return;
        window.postMessage({
            sender: 'lyrics-app-spotify-token',
            token: token
        }, '*');
    }

    // Inspect React Fiber on player elements to extract track URI
    function extractTrackFromReact() {
        try {
            const playerEl = document.querySelector('[data-testid="now-playing-bar"], [data-testid="now-playing-widget"], footer');
            if (!playerEl) return null;

            const fiberKey = Object.keys(playerEl).find(k => k.startsWith('__reactFiber$') || k.startsWith('__reactInternalInstance$'));
            if (!fiberKey) return null;

            let fiber = playerEl[fiberKey];
            let depth = 0;

            while (fiber && depth < 60) {
                const props = fiber.memoizedProps;
                if (props) {
                    // Check direct item/track
                    const item = props.item || props.track || props.currentTrack;
                    if (item) {
                        const uri = item.uri || (item.id ? `spotify:track:${item.id}` : null);
                        const id = item.id || (uri ? uri.split(':').pop() : null);
                        if (id && /^[A-Za-z0-9]{22}$/.test(id)) {
                            return { id, uri, name: item.name };
                        }
                    }

                    if (props.uri && typeof props.uri === 'string' && props.uri.includes('spotify:track:')) {
                        const id = props.uri.split('spotify:track:')[1].split('?')[0];
                        if (id && /^[A-Za-z0-9]{22}$/.test(id)) {
                            return { id, uri: props.uri };
                        }
                    }
                }
                fiber = fiber.return;
                depth++;
            }
        } catch {
            // fiber scan fallback
        }
        return null;
    }

    function broadcastTrackInfo() {
        const info = extractTrackFromReact();
        if (info && info.id) {
            window.postMessage({
                sender: 'lyrics-app-spotify-fiber-track',
                id: info.id,
                uri: info.uri,
                name: info.name || ''
            }, '*');
        }
    }

    // Listen for requests from isolated world
    window.addEventListener('message', (event) => {
        if (event.source !== window) return;
        if (event.data?.sender === 'lyrics-app-spotify-request-token') {
            fetchAccessToken();
        }
        if (event.data?.sender === 'lyrics-app-spotify-request-fiber') {
            broadcastTrackInfo();
        }
    });

    // Initial fetch
    fetchAccessToken();
    setTimeout(broadcastTrackInfo, 1000);

    // Periodic token refresh & fiber track sync
    setInterval(fetchAccessToken, 120000); // 2 minutes
    setInterval(broadcastTrackInfo, 1500);  // 1.5 seconds
})();
