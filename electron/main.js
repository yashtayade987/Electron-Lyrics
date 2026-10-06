import { app, BrowserWindow, ipcMain, shell } from 'electron';
import path from 'path';
import http from 'http';
import fs from 'fs';
import crypto from 'crypto';
import { Server } from 'socket.io';
import { fileURLToPath } from 'url';
import { windowsMediaService } from './windowsMediaService.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Configure Chromium hardware acceleration for transparent window video rendering at 120+ FPS
app.commandLine.appendSwitch('enable-gpu-rasterization');
app.commandLine.appendSwitch('ignore-gpu-blocklist');
app.commandLine.appendSwitch('disable-background-timer-throttling');
app.commandLine.appendSwitch('disable-features', 'CalculateNativeWinOcclusion');

let mainWindow;
let io;
let currentSourceMode = 'web';
let lastSongData = null;
let lastDesktopSong = null;
let lastExtensionSong = null;

function handleSourceSwitch(mode) {
    console.log(`[Main Process] Source switch requested -> ${mode}`);
    currentSourceMode = mode;
    if (mode === 'desktop') {
        if (lastDesktopSong && io) {
            console.log(`[Main Process] Emitting cached desktop song: "${lastDesktopSong.title}"`);
            io.emit('song_update', lastDesktopSong);
        }
        windowsMediaService.sendCommand('force-update');
    } else if (mode === 'web') {
        if (lastExtensionSong && io) {
            console.log(`[Main Process] Emitting cached web extension song: "${lastExtensionSong.title}"`);
            io.emit('song_update', lastExtensionSong);
        }
        if (io) {
            io.emit('request_current_song');
        }
    }
}

const gotSingleInstanceLock = app.requestSingleInstanceLock();
if (!gotSingleInstanceLock) {
    console.log('[Main] Another instance is already running. Quitting.');
    app.quit();
} else {
    app.on('second-instance', () => {
        if (mainWindow) {
            if (mainWindow.isMinimized()) mainWindow.restore();
            mainWindow.focus();
        }
    });
}

// Load .env variables into process.env if available
function loadEnv() {
    try {
        const envPath = path.join(__dirname, '../.env');
        if (fs.existsSync(envPath)) {
            const content = fs.readFileSync(envPath, 'utf8');
            for (const line of content.split('\n')) {
                const trimmed = line.trim();
                if (trimmed && !trimmed.startsWith('#') && trimmed.includes('=')) {
                    const [k, ...v] = trimmed.split('=');
                    const key = k.trim();
                    const val = v.join('=').trim().replace(/^['"]|['"]$/g, '');
                    if (!process.env[key]) {
                        process.env[key] = val;
                    }
                }
            }
        }
    } catch {}
}
loadEnv();

let activeSpDcToken = null;
let activeSpDcTokenExpiresAt = 0;

function generateTOTP(secretHex, timeStep = 30) {
    const epoch = Math.floor(Date.now() / 1000);
    const counter = Math.floor(epoch / timeStep);
    const buf = Buffer.alloc(8);
    buf.writeBigInt64BE(BigInt(counter));
    const key = Buffer.from(secretHex, 'hex');
    const hmac = crypto.createHmac('sha1', key).update(buf).digest();
    const offset = hmac[hmac.length - 1] & 0xf;
    const code = ((hmac[offset] & 0x7f) << 24 | (hmac[offset + 1] & 0xff) << 16 | (hmac[offset + 2] & 0xff) << 8 | (hmac[offset + 3] & 0xff)) % 1000000;
    return code.toString().padStart(6, '0');
}

function createTotpSecretHex(data) {
    const mappedData = data.map((value, index) => value ^ ((index % 33) + 9));
    return Buffer.from(mappedData.join(""), "utf8").toString("hex");
}

async function getAccessTokenFromSpDc() {
    const spDc = process.env.SP_DC || process.env.VITE_SPOTIFY_SP_DC;
    if (!spDc) return null;
    const now = Date.now();
    if (activeSpDcToken && now < activeSpDcTokenExpiresAt - 60000) {
        return activeSpDcToken;
    }

    try {
        const secretsRes = await fetch("https://raw.githubusercontent.com/xyloflake/spot-secrets-go/refs/heads/main/secrets/secretDict.json", {
            signal: AbortSignal.timeout(6000)
        });
        if (!secretsRes.ok) return null;
        const secrets = await secretsRes.json();
        const versions = Object.keys(secrets).map(Number);
        const newestVersion = Math.max(...versions).toString();
        const secretHex = createTotpSecretHex(secrets[newestVersion]);
        const totp = generateTOTP(secretHex);

        const url = new URL("https://open.spotify.com/api/token");
        url.searchParams.append("reason", "init");
        url.searchParams.append("productType", "mobile-web-player");
        url.searchParams.append("totp", totp);
        url.searchParams.append("totpVer", newestVersion);

        const tokenRes = await fetch(url.toString(), {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/127.0.0.0 Safari/537.36',
                'Origin': 'https://open.spotify.com/',
                'Referer': 'https://open.spotify.com/',
                'Cookie': `sp_dc=${spDc.trim()}`
            },
            signal: AbortSignal.timeout(6000)
        });

        if (tokenRes.ok) {
            const data = await tokenRes.json();
            if (data?.accessToken) {
                activeSpDcToken = data.accessToken;
                activeSpDcTokenExpiresAt = data.accessTokenExpirationTimestampMs || (Date.now() + 3600000);
                console.log('[Main Process] Generated authenticated Spotify access token from SP_DC');
                return activeSpDcToken;
            }
        }
    } catch (err) {
        console.warn('[Main Process] Error generating token from SP_DC:', err);
    }
    return null;
}

function encodeCanvasProtobuf(trackId) {
    const uri = `spotify:track:${trackId}`;
    const uriBytes = Buffer.from(uri, 'utf8');
    const trackMsg = Buffer.concat([Buffer.from([0x0a, uriBytes.length]), uriBytes]);
    const reqMsg = Buffer.concat([Buffer.from([0x0a, trackMsg.length]), trackMsg]);
    return reqMsg;
}

function parseCanvasProtobuf(buf) {
    try {
        const text = buf.toString('utf8');
        const match = text.match(/https:\/\/canvaz\.scdn\.co\/[A-Za-z0-9_.~:/?#[\]@!$&'()*+,;=-]+/);
        if (match) return match[0];
        const anyMp4 = text.match(/https:\/\/[A-Za-z0-9_.~:/?#[\]@!$&'()*+,;=-]+\.mp4[A-Za-z0-9_.~:/?#[\]@!$&'()*+,;=-]*/);
        if (anyMp4) return anyMp4[0];
    } catch {}
    return null;
}

let latestWebPlayerToken = null;
let cachedClientToken = null;
let clientTokenExpires = 0;

async function getClientToken() {
    if (cachedClientToken && Date.now() < clientTokenExpires) {
        return cachedClientToken;
    }
    try {
        const deviceId = crypto.randomBytes(16).toString('hex');
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
            })
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
    } catch (err) {
        console.warn('[Main Process] Failed to get Spotify client token:', err);
    }
    return null;
}

const CANVAS_GRAPHQL_HASH = "575138ab27cd5c1b3e54da54d0a7cc8d85485402de26340c2145f0f6bb5e7a9f";

async function resolveCanvasForTrack(trackId, explicitToken) {
    if (!trackId || !/^[A-Za-z0-9]{22}$/.test(trackId)) return null;
    const token = explicitToken || latestWebPlayerToken || await getAccessTokenFromSpDc();
    if (!token) return null;

    // 1. Try Spotify Web Player GraphQL Pathfinder endpoint
    try {
        const clientToken = await getClientToken();
        const headers = {
            "Authorization": `Bearer ${token}`,
            "Content-Type": "application/json",
            "Accept": "application/json"
        };
        if (clientToken) {
            headers["client-token"] = clientToken;
        }

        const res = await fetch("https://api-partner.spotify.com/pathfinder/v2/query", {
            method: "POST",
            headers,
            body: JSON.stringify({
                operationName: "canvas",
                variables: { trackUri: `spotify:track:${trackId}` },
                extensions: {
                    persistedQuery: {
                        version: 1,
                        sha256Hash: CANVAS_GRAPHQL_HASH
                    }
                }
            })
        });

        if (res.ok) {
            const json = await res.json();
            const canvas = json?.data?.trackUnion?.canvas;
            if (canvas && canvas.url) {
                console.log(`[Main Process] Successfully fetched Canvas for ${trackId} via Pathfinder:`, canvas.url);
                return canvas.url;
            }
        } else if (res.status === 401) {
            console.warn('[Main Process] Token rejected (401) by Spotify Pathfinder');
            if (token === activeSpDcToken) activeSpDcToken = null;
            if (token === latestWebPlayerToken) latestWebPlayerToken = null;
        }
    } catch (err) {
        console.warn('[Main Process] Error fetching canvas from Pathfinder:', err);
    }

    // 2. Fallback to legacy protobuf endpoint
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
            const buf = Buffer.from(await res.arrayBuffer());
            const canvasUrl = parseCanvasProtobuf(buf);
            if (canvasUrl) {
                console.log(`[Main Process] Successfully fetched Canvas for ${trackId} via Protobuf:`, canvasUrl);
                return canvasUrl;
            }
        }
    } catch (err) {
        console.warn('[Main Process] Error fetching canvas from spclient:', err);
    }
    return null;
}

const SEARCH_SHA256 = 'eff59fa0a3d026b88b56fddbcf4bdfa16a186b8175a5c1a358c072e053c2e5b0';

async function resolveTrackMetadataFromSpotify(title, artist, explicitToken) {
    if (!title || title === 'No song playing') return null;
    let token = explicitToken || latestWebPlayerToken || await getAccessTokenFromSpDc();
    if (!token) return null;

    try {
        const cleanTitle = (title || '')
            .replace(/\(feat\..*?\)/gi, '')
            .replace(/\[feat\..*?\]/gi, '')
            .replace(/\(with.*?\)/gi, '')
            .replace(/\[with.*?\]/gi, '')
            .replace(/\(Official.*?Video.*?\)/gi, '')
            .replace(/\[Official.*?Video.*?\]/gi, '')
            .replace(/\(.*?\)|\[.*?\]/g, '')
            .replace(/\s+/g, ' ')
            .trim();
        const primaryArtist = (artist || '').split(/[,&/]|feat\.|ft\./i)[0].trim();
        const queries = [`${cleanTitle} ${primaryArtist}`.trim()];
        if (cleanTitle && cleanTitle !== queries[0]) {
            queries.push(cleanTitle);
        }

        for (const query of queries) {
            const variables = JSON.stringify({
                searchTerm: query,
                offset: 0,
                limit: 5,
                numberOfTopResults: 3,
                includeAudiobooks: false,
                includePreReleases: true,
                includeAlbumPreReleases: false,
                includeAuthors: false,
                includeEpisodeContentRatingsV2: false,
            });
            const extensions = JSON.stringify({
                persistedQuery: {
                    version: 1,
                    sha256Hash: SEARCH_SHA256,
                }
            });
            const queryParams = `?operationName=searchDesktop&variables=${encodeURIComponent(variables)}&extensions=${encodeURIComponent(extensions)}`;
            let searchRes = await fetch(`https://api-partner.spotify.com/pathfinder/v1/query${queryParams}`, {
                headers: {
                    Authorization: `Bearer ${token}`,
                    'app-platform': 'WebPlayer'
                },
                signal: AbortSignal.timeout(5000)
            });

            if (searchRes.status === 401) {
                activeSpDcToken = null;
                token = await getAccessTokenFromSpDc();
                if (token) {
                    searchRes = await fetch(`https://api-partner.spotify.com/pathfinder/v1/query${queryParams}`, {
                        headers: {
                            Authorization: `Bearer ${token}`,
                            'app-platform': 'WebPlayer'
                        },
                        signal: AbortSignal.timeout(5000)
                    });
                }
            }

            if (searchRes.ok) {
                const data = await searchRes.json();
                const items = data?.data?.searchV2?.tracksV2?.items;
                if (items && items.length > 0) {
                    const trackData = items[0].item?.data;
                    const foundId = trackData?.id || null;
                    if (foundId) {
                        const albumName = trackData?.albumOfTrack?.name || '';
                        const sources = trackData?.albumOfTrack?.coverArt?.sources || [];
                        const coverArt = sources.length > 0
                            ? (sources.find(s => s.width >= 600)?.url || sources[0]?.url || '')
                            : '';
                        const duration = trackData?.duration?.totalMilliseconds || 0;
                        console.log(`[Main Process] Resolved "${cleanTitle}" by "${primaryArtist}" -> Spotify ID: ${foundId}, Album: "${albumName}", CoverArt: ${Boolean(coverArt)}`);
                        return {
                            id: foundId,
                            album: albumName,
                            coverArt: coverArt,
                            duration: duration
                        };
                    }
                }
            }
        }
    } catch (e) {
        console.warn('[Main Process] Error searching Spotify catalog:', e);
    }
    return null;
}

async function resolveMetadataFromITunes(title, artist) {
    if (!title || title === 'No song playing') return null;
    try {
        const cleanTitle = (title || '').replace(/\(.*?\)|\[.*?\]/g, '').trim();
        const cleanArtist = (artist || '').split(/[,&/]|feat\.|ft\./i)[0].trim();
        const queries = [`${cleanTitle} ${cleanArtist}`.trim()];
        if (cleanTitle && cleanTitle !== queries[0]) queries.push(cleanTitle);

        for (const query of queries) {
            const res = await fetch(`https://itunes.apple.com/search?term=${encodeURIComponent(query)}&entity=song&limit=1`, {
                signal: AbortSignal.timeout(4000)
            });
            if (res.ok) {
                const data = await res.json();
                if (data.results && data.results.length > 0) {
                    const item = data.results[0];
                    const cover = item.artworkUrl100 ? item.artworkUrl100.replace('100x100bb.jpg', '600x600bb.jpg') : '';
                    return {
                        album: item.collectionName || '',
                        coverArt: cover,
                        duration: item.trackTimeMillis || 0
                    };
                }
            }
        }
    } catch {}
    return null;
}

async function resolveTrackIdFromSpotify(title, artist, explicitToken) {
    const meta = await resolveTrackMetadataFromSpotify(title, artist, explicitToken);
    return meta?.id || null;
}

// Embed the WebSocket Bridge and Canvas API inside the Electron Main Process!
function startWebSocketServer() {
    // Immediately pre-warm SP_DC token on server start
    getAccessTokenFromSpDc().then((token) => {
        if (token) {
            console.log('[Main Process] Pre-warmed SP_DC token on server start');
            if (io) io.emit('canvas_update', { spotifyToken: token });
        }
    });

    const server = http.createServer(async (req, res) => {
        // Set CORS headers
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

        if (req.method === 'OPTIONS') {
            res.writeHead(200);
            res.end();
            return;
        }

        const reqUrl = new URL(req.url, 'http://localhost:4000');
        if (reqUrl.pathname === '/api/canvas') {
            let trackId = reqUrl.searchParams.get('trackId');
            const token = reqUrl.searchParams.get('token');
            const title = reqUrl.searchParams.get('title');
            const artist = reqUrl.searchParams.get('artist');

            // If trackId not provided directly, resolve via Spotify Search catalog
            if (!trackId && title) {
                trackId = await resolveTrackIdFromSpotify(title, artist, token);
            }

            if (!trackId) {
                res.writeHead(400, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: 'Missing trackId or title query parameter' }));
                return;
            }
            const canvasUrl = await resolveCanvasForTrack(trackId, token);
            if (canvasUrl) {
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({
                    data: {
                        canvasesList: [
                            {
                                id: trackId,
                                canvasUrl: canvasUrl,
                                trackUri: `spotify:track:${trackId}`
                            }
                        ]
                    }
                }));
                return;
            }
            res.writeHead(404, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Canvas not found', data: { canvasesList: [] } }));
            return;
        }

        if (reqUrl.pathname === '/api/resolve-track') {
            const title = reqUrl.searchParams.get('title') || '';
            const artist = reqUrl.searchParams.get('artist') || '';
            const token = reqUrl.searchParams.get('token') || undefined;

            let meta = await resolveTrackMetadataFromSpotify(title, artist, token);
            if (!meta || !meta.coverArt) {
                const itunesMeta = await resolveMetadataFromITunes(title, artist);
                if (itunesMeta) {
                    meta = {
                        id: meta?.id || null,
                        album: meta?.album || itunesMeta.album || '',
                        coverArt: itunesMeta.coverArt || meta?.coverArt || '',
                        duration: meta?.duration || itunesMeta.duration || 0
                    };
                }
            }
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ data: meta || {} }));
            return;
        }

        res.writeHead(404);
        res.end();
    });

    io = new Server(server, {
        cors: {
            origin: "*",
            methods: ["GET", "POST"]
        }
    });

    let currentClients = 0;
    let lastExtensionTimestamp = 0;

function isBrowserAppId(appId) {
    if (!appId || typeof appId !== 'string') return false;
    const lower = appId.toLowerCase();
    return lower.includes('chrome') ||
           lower.includes('msedge') ||
           lower.includes('edge') ||
           lower.includes('brave') ||
           lower.includes('firefox') ||
           lower.includes('opera') ||
           lower.includes('vivaldi') ||
           lower.includes('arc') ||
           lower.includes('browser');
}

    // Listen for native Windows desktop playback events (Spotify Desktop, Apple Music for Windows, iTunes)
    windowsMediaService.on('song_update', async (data) => {
        if (isBrowserAppId(data.appId)) {
            console.log(`[WindowsMedia] Skipped browser SMTC session (${data.appId}) for "${data.title}" - Web Extension handles browser playback.`);
            return;
        }
        console.log(`[WindowsMedia] Song: "${data.title}" by "${data.artist}" (${data.source}, playing: ${data.isPlaying})`);
        const isNewTrack = !lastDesktopSong || (lastDesktopSong.title !== data.title || lastDesktopSong.artist !== data.artist);
        let cleanProgress = data.progress || 0;
        if (isNewTrack && cleanProgress > 3000) {
            cleanProgress = 0;
        }

        const token = await getAccessTokenFromSpDc();

        // Sanitize incoming coverArt to strictly string
        let safeCoverArt = '';
        if (typeof data.coverArt === 'string') {
            safeCoverArt = data.coverArt;
        } else if (Array.isArray(data.coverArt)) {
            safeCoverArt = data.coverArt.find(item => typeof item === 'string' && item.length > 0) || '';
        }

        const songPayload = {
            id: isNewTrack ? null : (lastDesktopSong?.id || lastSongData?.id || null),
            title: data.title,
            artist: data.artist,
            album: data.album || (!isNewTrack ? (lastDesktopSong?.album || lastSongData?.album || '') : ''),
            coverArt: safeCoverArt || (!isNewTrack && typeof lastDesktopSong?.coverArt === 'string' ? lastDesktopSong.coverArt : ''),
            duration: data.duration || (!isNewTrack ? (lastDesktopSong?.duration || 0) : 0),
            progress: cleanProgress,
            isPlaying: data.isPlaying,
            source: data.source,
            spotifyToken: token || latestWebPlayerToken || activeSpDcToken || undefined,
            canvasUrl: isNewTrack ? null : (lastDesktopSong?.canvasUrl || lastSongData?.canvasUrl || null),
            _origin: 'windows_media',
            appId: data.appId
        };
        lastDesktopSong = songPayload;
        lastSongData = songPayload;
        io.emit('song_update', songPayload);

        // Proactively resolve rich metadata (Spotify ID, Cover Art, Album, Canvas) in background
        if (data.title && data.title !== 'No song playing') {
            (async () => {
                try {
                    let meta = await resolveTrackMetadataFromSpotify(data.title, data.artist, token);

                    // Fallback to iTunes API if coverArt or album is missing (e.g. Apple Music or unindexed track)
                    if (!meta || !meta.coverArt) {
                        const itunesMeta = await resolveMetadataFromITunes(data.title, data.artist);
                        if (itunesMeta) {
                            meta = {
                                id: meta?.id || null,
                                album: meta?.album || itunesMeta.album || data.album,
                                coverArt: itunesMeta.coverArt || meta?.coverArt || '',
                                duration: meta?.duration || itunesMeta.duration || data.duration
                            };
                        }
                    }

                    if (meta && lastDesktopSong && lastDesktopSong.title === data.title) {
                        let hasUpdates = false;
                        if (meta.id && lastDesktopSong.id !== meta.id) {
                            lastDesktopSong.id = meta.id;
                            hasUpdates = true;
                        }
                        const curCover = typeof lastDesktopSong.coverArt === 'string' ? lastDesktopSong.coverArt : '';
                        if (meta.coverArt && (!curCover || curCover.startsWith('data:image/jpeg;base64,'))) {
                            // Replace empty or low-res SMTC thumbnail with crisp 640x640 album artwork
                            lastDesktopSong.coverArt = meta.coverArt;
                            hasUpdates = true;
                        }
                        if (meta.album && !lastDesktopSong.album) {
                            lastDesktopSong.album = meta.album;
                            hasUpdates = true;
                        }
                        if (meta.duration && (!lastDesktopSong.duration || lastDesktopSong.duration === 0)) {
                            lastDesktopSong.duration = meta.duration;
                            hasUpdates = true;
                        }

                        if (hasUpdates) {
                            console.log(`[Main Process] Enriched desktop track metadata for "${data.title}": ID=${meta.id}, CoverArt=${Boolean(meta.coverArt)}`);
                            io.emit('song_update', {
                                ...lastDesktopSong,
                                spotifyToken: token || activeSpDcToken || undefined
                            });
                        }

                        // Also resolve Spotify Canvas if track ID exists
                        if (meta.id) {
                            const canvasUrl = await resolveCanvasForTrack(meta.id, token);
                            if (canvasUrl && lastDesktopSong && lastDesktopSong.title === data.title) {
                                lastDesktopSong.canvasUrl = canvasUrl;
                                io.emit('canvas_update', {
                                    trackId: meta.id,
                                    canvasUrl: canvasUrl,
                                    spotifyToken: token || activeSpDcToken || undefined,
                                    _origin: 'windows_media'
                                });
                            }
                        }
                    }
                } catch (err) {
                    console.warn('[Main Process] Proactive SMTC metadata resolution error:', err);
                }
            })();
        }
    });

    windowsMediaService.on('progress_update', (data) => {
        if (isBrowserAppId(data.appId)) {
            return;
        }
        if (lastDesktopSong) {
            lastDesktopSong.progress = data.progress;
            lastDesktopSong.isPlaying = data.isPlaying;
            if (data.duration) lastDesktopSong.duration = data.duration;
        }

        io.emit('progress_update', {
            source: data.source,
            title: data.title,
            duration: data.duration,
            progress: data.progress,
            isPlaying: data.isPlaying,
            _origin: 'windows_media'
        });
    });

    io.on('connection', (socket) => {
        currentClients++;
        console.log(`[Bridge Server] Client connected: ${socket.id}. Total: ${currentClients}`);

        // If we have an active SP_DC token, push it to client immediately
        if (activeSpDcToken) {
            socket.emit('canvas_update', { spotifyToken: activeSpDcToken });
        } else {
            getAccessTokenFromSpDc().then((token) => {
                if (token && socket.connected) {
                    socket.emit('canvas_update', { spotifyToken: token });
                }
            });
        }

        // If we have a cached song for current sourceMode, send it
        const currentCached = currentSourceMode === 'desktop' ? lastDesktopSong : lastExtensionSong;
        if (currentCached) {
            socket.emit('song_update', currentCached);
        } else if (lastSongData) {
            socket.emit('song_update', lastSongData);
        }

        socket.on('switch_source_mode', (mode) => {
            handleSourceSwitch(mode);
        });

        socket.on('request_source_playback', (mode) => {
            handleSourceSwitch(mode);
        });

        socket.on('music_command', (data) => {
            const action = typeof data === 'string' ? data : data?.action;
            if (action) {
                handleMusicCommand(action);
            }
        });

        // Receive from Browser Extension...
        socket.on('song_update', async (data) => {
            lastExtensionTimestamp = Date.now();
            data._origin = 'extension';
            lastExtensionSong = data;
            lastSongData = data;
            if (data.spotifyToken) {
                latestWebPlayerToken = data.spotifyToken;
            }
            // Always emit song_update tagged with _origin = 'extension' to all clients
            io.emit('song_update', data);

            // Proactively resolve canvas if not already present
            const activeToken = data.spotifyToken || latestWebPlayerToken || activeSpDcToken;
            if (data.id && !data.canvasUrl && activeToken) {
                resolveCanvasForTrack(data.id, activeToken).then((canvasUrl) => {
                    if (canvasUrl && lastExtensionSong && lastExtensionSong.id === data.id) {
                        lastExtensionSong.canvasUrl = canvasUrl;
                        io.emit('canvas_update', {
                            trackId: data.id,
                            canvasUrl: canvasUrl,
                            spotifyToken: activeToken,
                            _origin: 'extension'
                        });
                    }
                });
            } else if (!data.id && data.title && data.artist && activeToken) {
                // If browser extension didn't capture track ID, resolve in background via Spotify catalog
                resolveTrackIdFromSpotify(data.title, data.artist, activeToken).then((resolvedId) => {
                    if (resolvedId && lastExtensionSong && lastExtensionSong.title === data.title) {
                        lastExtensionSong.id = resolvedId;
                        resolveCanvasForTrack(resolvedId, activeToken).then((canvasUrl) => {
                            if (canvasUrl && lastExtensionSong && lastExtensionSong.title === data.title) {
                                lastExtensionSong.canvasUrl = canvasUrl;
                            }
                            io.emit('canvas_update', {
                                trackId: resolvedId,
                                canvasUrl: canvasUrl || null,
                                spotifyToken: activeToken,
                                _origin: 'extension'
                            });
                        });
                    }
                });
            }
        });

        socket.on('canvas_update', (data) => {
            data._origin = 'extension';
            if (data.spotifyToken) {
                latestWebPlayerToken = data.spotifyToken;
            }
            if (lastSongData && data.trackId && (lastSongData.id === data.trackId || !lastSongData.canvasUrl)) {
                lastSongData.canvasUrl = data.canvasUrl;
            }
            if (lastExtensionSong && data.trackId && (lastExtensionSong.id === data.trackId || !lastExtensionSong.canvasUrl)) {
                lastExtensionSong.canvasUrl = data.canvasUrl;
            }
            io.emit('canvas_update', data);
        });

        socket.on('progress_update', (data) => {
            lastExtensionTimestamp = Date.now();
            data._origin = 'extension';
            if (lastExtensionSong) {
                lastExtensionSong.progress = data.progress;
                lastExtensionSong.isPlaying = data.isPlaying;
            }
            io.emit('progress_update', data);
        });

        socket.on('disconnect', () => {
            currentClients--;
        });
    });

    const PORT = 4000;
    server.on('error', (err) => {
        if (err.code === 'EADDRINUSE') {
            console.warn(`[Bridge Server] Port ${PORT} is already in use by another instance. Connecting as client.`);
        } else {
            console.error('[Bridge Server] Server error:', err);
        }
    });

    server.listen(PORT, () => {
        console.log(`[Bridge Server] Running natively on port ${PORT}`);
    });
}

function createWindow() {
    mainWindow = new BrowserWindow({
        width: 450,
        height: 350,
        frame: false,
        transparent: true,
        backgroundColor: '#00000000',
        hasShadow: false,
        thickFrame: false,
        roundedCorners: true,
        resizable: false, // Disabling native resizable removes Windows DWM rectangular frame artifacts. Custom resize is handled via IPC.
        alwaysOnTop: true,
        show: false,
        webPreferences: {
            nodeIntegration: false,
            contextIsolation: true,
            preload: path.join(__dirname, 'preload.cjs'),
            webSecurity: false,
            // Enable devTools to help debugging if needed
            devTools: true
        }
    });

    // In development, load from Vite dev server.
    // In production, load the built index.html
    const startUrl = process.env.ELECTRON_START_URL || `file://${path.join(__dirname, '../dist/index.html')}`;
    mainWindow.loadURL(startUrl);

    mainWindow.once('ready-to-show', () => {
        if (mainWindow) {
            mainWindow.show();
        }
    });

    mainWindow.webContents.on('console-message', (event, level, message, line, sourceId) => {
        // Forward warnings and errors from renderer console to terminal
        if (level >= 2 || message.includes('Error') || message.includes('[App]') || message.includes('uncaught')) {
            console.log(`[Renderer] ${message}`);
        }
    });

    mainWindow.webContents.on('render-process-gone', (event, details) => {
        console.error('[Main Process] Renderer process crashed / gone:', details);
    });

    // Handle links opened from the renderer in external default browser
    mainWindow.webContents.setWindowOpenHandler(({ url }) => {
        if (url.startsWith('https://') || url.startsWith('http://')) {
            shell.openExternal(url);
        }
        return { action: 'deny' };
    });

    mainWindow.on('closed', function () {
        mainWindow = null;
    });
}

ipcMain.on('force-repaint', () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.invalidate();
    }
});

// IPC Handlers for Custom Title Bar & Links
ipcMain.on('open-external', (event, url) => {
    if (url && (url.startsWith('https://') || url.startsWith('http://'))) {
        shell.openExternal(url);
    }
});

ipcMain.on('window-close', () => {
    console.log('[Main] Received window-close IPC');
    if (mainWindow) {
        mainWindow.close();
    } else {
        app.quit();
    }
});

ipcMain.on('window-minimize', () => {
    console.log('[Main] Received window-minimize IPC');
    if (mainWindow) mainWindow.minimize();
});

ipcMain.on('window-pin', (event, isPinned) => {
    console.log(`[Main] Received window-pin IPC: ${isPinned}`);
    if (mainWindow) mainWindow.setAlwaysOnTop(Boolean(isPinned), 'screen-saver');
});

ipcMain.on('switch-source', (event, mode) => {
    handleSourceSwitch(mode);
});

let lastMusicCommandTime = 0;
let lastMusicCommandName = '';

function handleMusicCommand(command) {
    const now = Date.now();
    if (command === lastMusicCommandName && now - lastMusicCommandTime < 150) {
        console.log(`[Main] Debounced rapid duplicate music command: ${command}`);
        return;
    }
    lastMusicCommandTime = now;
    lastMusicCommandName = command;

    console.log(`[Main] Music command received: ${command} (Source: ${currentSourceMode})`);
    if (currentSourceMode === 'desktop') {
        windowsMediaService.sendCommand(command);
    } else if (currentSourceMode === 'web') {
        if (io) io.emit('music_command', { action: command });
    } else {
        windowsMediaService.sendCommand(command);
        if (io) io.emit('music_command', { action: command });
    }
}

// Music control commands: forward to active playback source
ipcMain.on('music-command', (event, command) => {
    handleMusicCommand(command);
});

ipcMain.on('window-resize', (event, { direction, deltaX, deltaY }) => {
    if (!mainWindow) return;
    const bounds = mainWindow.getBounds();
    let { x, y, width, height } = bounds;

    switch (direction) {
        case 'right':
            width += deltaX;
            break;
        case 'left':
            x += deltaX;
            width -= deltaX;
            break;
        case 'bottom':
            height += deltaY;
            break;
        case 'bottom-right':
            width += deltaX;
            height += deltaY;
            break;
        case 'bottom-left':
            x += deltaX;
            width -= deltaX;
            height += deltaY;
            break;
    }

    // Min boundaries
    const minWidth = 300;
    const minHeight = 200;

    // Validate width and height separately
    if (width < minWidth) {
        if (direction === 'left' || direction === 'bottom-left') {
            x = bounds.x + (bounds.width - minWidth);
        }
        width = minWidth;
    }
    if (height < minHeight) height = minHeight;

    mainWindow.setBounds({ x, y, width, height });
});

app.whenReady().then(() => {
    if (!gotSingleInstanceLock) return;
    startWebSocketServer();
    windowsMediaService.start();
    createWindow();

    app.on('activate', function () {
        if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
});

app.on('before-quit', () => {
    windowsMediaService.stop();
});

app.on('window-all-closed', function () {
    windowsMediaService.stop();
    if (process.platform !== 'darwin') app.quit();
});
