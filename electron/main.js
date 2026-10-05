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

// Configure Chromium hardware acceleration for 120+ FPS high refresh rate displays with minimal RAM
app.commandLine.appendSwitch('enable-gpu-rasterization');
app.commandLine.appendSwitch('enable-zero-copy');
app.commandLine.appendSwitch('ignore-gpu-blocklist');
app.commandLine.appendSwitch('disable-background-timer-throttling');

let mainWindow;
let io;

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

async function resolveCanvasForTrack(trackId, explicitToken) {
    if (!trackId || !/^[A-Za-z0-9]{22}$/.test(trackId)) return null;
    const token = explicitToken || latestWebPlayerToken || await getAccessTokenFromSpDc();
    if (!token) return null;

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
                console.log(`[Main Process] Successfully fetched Canvas for ${trackId}:`, canvasUrl);
                return canvasUrl;
            }
        } else if (res.status === 401) {
            console.warn('[Main Process] Token rejected (401) by spclient');
            if (token === activeSpDcToken) activeSpDcToken = null;
            if (token === latestWebPlayerToken) latestWebPlayerToken = null;
        }
    } catch (err) {
        console.warn('[Main Process] Error fetching canvas from spclient:', err);
    }
    return null;
}

const SEARCH_SHA256 = 'eff59fa0a3d026b88b56fddbcf4bdfa16a186b8175a5c1a358c072e053c2e5b0';

async function resolveTrackIdFromSpotify(title, artist, explicitToken) {
    if (!title || title === 'No song playing') return null;
    const token = explicitToken || latestWebPlayerToken || await getAccessTokenFromSpDc();
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
        const query = `${cleanTitle} ${primaryArtist}`.trim();

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
        const searchRes = await fetch(`https://api-partner.spotify.com/pathfinder/v1/query${queryParams}`, {
            headers: {
                Authorization: `Bearer ${token}`,
                'app-platform': 'WebPlayer'
            },
            signal: AbortSignal.timeout(5000)
        });
        if (!searchRes.ok) return null;
        const data = await searchRes.json();
        const items = data?.data?.searchV2?.tracksV2?.items;
        if (items && items.length > 0) {
            const foundId = items[0].item?.data?.id || null;
            if (foundId) {
                console.log(`[Main Process] Resolved "${cleanTitle}" by "${primaryArtist}" -> Spotify ID: ${foundId}`);
                return foundId;
            }
        }
    } catch (e) {
        console.warn('[Main Process] Error searching Spotify catalog:', e);
    }
    return null;
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
    let lastSongData = null;
    let lastExtensionTimestamp = 0;

    // Listen for native Windows desktop playback events (Spotify Desktop, Apple Music for Windows, iTunes)
    windowsMediaService.on('song_update', (data) => {
        // If extension is actively playing or updated recently, don't let desktop SMTC hijack
        const isExtActive = lastSongData && lastSongData._origin === 'extension' && (Date.now() - lastExtensionTimestamp < 3500);
        if (isExtActive) {
            if (lastSongData.isPlaying || !data.isPlaying) {
                return;
            }
        }

        console.log(`[WindowsMedia] Song: "${data.title}" by "${data.artist}" (${data.source}, playing: ${data.isPlaying})`);
        const songPayload = {
            id: null,
            title: data.title,
            artist: data.artist,
            album: data.album,
            coverArt: data.coverArt || '',
            duration: data.duration,
            progress: data.progress,
            isPlaying: data.isPlaying,
            source: data.source,
            _origin: 'windows_media',
            appId: data.appId
        };
        lastSongData = songPayload;
        io.emit('song_update', songPayload);

        // Proactively resolve Spotify Canvas for SMTC tracks in the background
        if (data.title && data.title !== 'No song playing') {
            (async () => {
                try {
                    const token = await getAccessTokenFromSpDc();
                    const trackId = await resolveTrackIdFromSpotify(data.title, data.artist, token);
                    if (trackId) {
                        const canvasUrl = await resolveCanvasForTrack(trackId, token);
                        if (canvasUrl && lastSongData && lastSongData.title === data.title) {
                            lastSongData.canvasUrl = canvasUrl;
                            lastSongData.id = trackId;
                            io.emit('canvas_update', {
                                trackId: trackId,
                                canvasUrl: canvasUrl,
                                spotifyToken: token || activeSpDcToken
                            });
                        }
                    }
                } catch (err) {
                    console.warn('[Main Process] Proactive SMTC canvas resolution error:', err);
                }
            })();
        }
    });

    windowsMediaService.on('progress_update', (data) => {
        // If extension is active, SMTC must NEVER emit competing progress updates
        const isExtActive = lastSongData && lastSongData._origin === 'extension' && (Date.now() - lastExtensionTimestamp < 3500);
        if (isExtActive) {
            return;
        }

        if (lastSongData && (!lastSongData.source || lastSongData.source === data.source || lastSongData._origin === 'windows_media' || data.isPlaying)) {
            lastSongData.progress = data.progress;
            lastSongData.isPlaying = data.isPlaying;
            if (data.duration) lastSongData.duration = data.duration;
        }
        io.emit('progress_update', {
            source: data.source,
            title: data.title,
            duration: data.duration,
            progress: data.progress,
            isPlaying: data.isPlaying
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

        // If we have a cached song, send it to the new client immediately
        if (lastSongData) {
            socket.emit('song_update', lastSongData);
        }

        // Receive from Browser Extension...
        socket.on('song_update', async (data) => {
            lastExtensionTimestamp = Date.now();
            data._origin = 'extension';
            lastSongData = data;
            if (data.spotifyToken) {
                latestWebPlayerToken = data.spotifyToken;
            }
            // Broadcast to the React App (which is also connected to this socket server)
            socket.broadcast.emit('song_update', data);

            // Proactively resolve canvas if not already present
            if (data.id && !data.canvasUrl && (data.spotifyToken || latestWebPlayerToken || process.env.SP_DC || process.env.VITE_SPOTIFY_SP_DC)) {
                resolveCanvasForTrack(data.id, data.spotifyToken).then((canvasUrl) => {
                    if (canvasUrl && lastSongData && lastSongData.id === data.id) {
                        lastSongData.canvasUrl = canvasUrl;
                        io.emit('canvas_update', {
                            trackId: data.id,
                            canvasUrl: canvasUrl,
                            spotifyToken: data.spotifyToken || latestWebPlayerToken || activeSpDcToken
                        });
                    }
                });
            }
        });

        socket.on('canvas_update', (data) => {
            if (data.spotifyToken) {
                latestWebPlayerToken = data.spotifyToken;
            }
            if (lastSongData && data.trackId && (lastSongData.id === data.trackId || !lastSongData.canvasUrl)) {
                lastSongData.canvasUrl = data.canvasUrl;
            }
            socket.broadcast.emit('canvas_update', data);
        });

        socket.on('progress_update', (data) => {
            lastExtensionTimestamp = Date.now();
            data._origin = 'extension';
            if (lastSongData) {
                if (!data.source || !lastSongData.source || data.source === lastSongData.source || data.isPlaying) {
                    lastSongData.progress = data.progress;
                    lastSongData.isPlaying = data.isPlaying;
                    lastSongData._origin = 'extension';
                }
            }
            socket.broadcast.emit('progress_update', data);
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

    // mainWindow.webContents.openDevTools();

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

// Music control commands: forward to connected browser extensions and native Windows SMTC
ipcMain.on('music-command', (event, command) => {
    console.log(`[Main] Music command received: ${command}`);
    // Forward command to Windows native SMTC (controls Spotify desktop, Apple Music for Windows, iTunes)
    windowsMediaService.sendCommand(command);

    if (io) {
        io.emit('music_command', { action: command });
        console.log(`[Main] Command broadcasted via WebSocket: ${command}`);
    }
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
