const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

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

const app = express();
app.use(cors());
app.use(express.json());

let latestWebPlayerToken = null;
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
                console.log('[Server] Generated authenticated Spotify access token from SP_DC');
                return activeSpDcToken;
            }
        }
    } catch (err) {
        console.warn('[Server] Error generating token from SP_DC:', err);
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
                console.log(`[Server] Successfully fetched Canvas for ${trackId}:`, canvasUrl);
                return canvasUrl;
            }
        } else if (res.status === 401) {
            console.warn('[Server] Token rejected (401) by spclient');
            if (token === activeSpDcToken) activeSpDcToken = null;
            if (token === latestWebPlayerToken) latestWebPlayerToken = null;
        }
    } catch (err) {
        console.warn('[Server] Error fetching canvas from spclient:', err);
    }
    return null;
}

// REST endpoint matching Paxsenix0 / Spotify-Canvas-API specification
app.get('/api/canvas', async (req, res) => {
    const trackId = req.query.trackId;
    const token = req.query.token;
    if (!trackId) {
        return res.status(400).json({ error: 'Missing trackId query parameter' });
    }
    const canvasUrl = await resolveCanvasForTrack(trackId, token);
    if (canvasUrl) {
        return res.json({
            data: {
                canvasesList: [
                    {
                        id: trackId,
                        canvasUrl: canvasUrl,
                        trackUri: `spotify:track:${trackId}`
                    }
                ]
            }
        });
    }
    return res.status(404).json({ error: 'Canvas not found for track', data: { canvasesList: [] } });
});

const server = http.createServer(app);

const io = new Server(server, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    }
});

let currentClients = 0;
let lastSongData = null;

io.on('connection', (socket) => {
    currentClients++;
    console.log(`Client connected: ${socket.id}. Total: ${currentClients}`);

    if (activeSpDcToken) {
        socket.emit('canvas_update', { spotifyToken: activeSpDcToken });
    }

    if (lastSongData) {
        socket.emit('song_update', lastSongData);
    }

    // From Browser Extension
    socket.on('song_update', async (data) => {
        lastSongData = data;
        if (data.spotifyToken) {
            latestWebPlayerToken = data.spotifyToken;
        }
        console.log(`[Extension] Song Update received - Title: ${data.title}`);
        // Broadcast to the React Lyrics App
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

    socket.on('progress_update', (data) => {
        if (lastSongData) {
            if (!data.source || !lastSongData.source || data.source === lastSongData.source || data.isPlaying) {
                lastSongData.progress = data.progress;
                lastSongData.isPlaying = data.isPlaying;
            }
        }
        // Broadcast to the React Lyrics App
        socket.broadcast.emit('progress_update', data);
    });

    socket.on('canvas_update', (data) => {
        if (data.spotifyToken) {
            latestWebPlayerToken = data.spotifyToken;
        }
        if (lastSongData && data.trackId && (lastSongData.id === data.trackId || !lastSongData.canvasUrl)) {
            lastSongData.canvasUrl = data.canvasUrl;
        }
        console.log(`[Extension] Canvas Update received - TrackId: ${data?.trackId}`);
        socket.broadcast.emit('canvas_update', data);
    });

    socket.on('music_command', (data) => {
        // Broadcast music control command to connected music player tabs
        socket.broadcast.emit('music_command', data);
    });

    socket.on('disconnect', () => {
        currentClients--;
        console.log(`Client disconnected: ${socket.id}. Total: ${currentClients}`);
    });
});

const PORT = 4000;
server.listen(PORT, () => {
    console.log(`Lyrics WebSocket Server running on port ${PORT}`);
});
