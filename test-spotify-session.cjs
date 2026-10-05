async function checkSpotifyToken() {
    try {
        const res = await fetch('https://open.spotify.com/get_access_token?reason=transport&productType=web_player', {
            headers: {
                'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
            }
        });
        console.log('get_access_token status:', res.status);
        const data = await res.json();
        console.log('get_access_token data keys:', Object.keys(data));
        console.log('isAnonymous:', data.isAnonymous);
        console.log('accessToken:', data.accessToken ? data.accessToken.substring(0, 20) + '...' : null);
        return data.accessToken;
    } catch (e) {
        console.error('Error:', e);
        return null;
    }
}

async function test() {
    const token = await checkSpotifyToken();
    if (!token) return;

    // Test canvaz-cache with this token
    const trackId = '0VjIjW4GlULA732m94xIZ0'; // Blinding Lights
    const uri = 'spotify:track:' + trackId;
    const uriBytes = Buffer.from(uri, 'utf8');
    const trackMsg = Buffer.concat([Buffer.from([0x0a, uriBytes.length]), uriBytes]);
    const reqMsg = Buffer.concat([Buffer.from([0x0a, trackMsg.length]), trackMsg]);

    const res = await fetch('https://spclient.wg.spotify.com/canvaz-cache/v0/canvases', {
        method: 'POST',
        headers: {
            'accept': 'application/protobuf',
            'content-type': 'application/x-www-form-urlencoded',
            'authorization': 'Bearer ' + token,
            'user-agent': 'Spotify/8.5.49 iOS/Version 13.3.1 (Build 17D50)'
        },
        body: reqMsg
    });

    console.log('canvaz-cache status:', res.status);
    const buf = Buffer.from(await res.arrayBuffer());
    console.log('canvaz-cache bytes length:', buf.length);
    console.log('canvaz-cache hex:', buf.toString('hex'));
}

test();
