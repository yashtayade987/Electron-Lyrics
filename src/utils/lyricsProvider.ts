export interface Contributor {
    id?: string;
    username?: string;
    avatar?: string;
    url?: string;
}

export interface LyricsAttribution {
    source: 'spicy_lyrics' | 'apple_music' | 'spotify';
    songwriters?: string[];
    maker?: Contributor;
    uploader?: Contributor;
}

export interface Letter {
    letter: string;
    startTimeMs: number;
    endTimeMs: number;
}

export interface Word {
    word: string;
    transliteratedWord?: string;
    startTimeMs: number;
    endTimeMs: number;
    isPartOfWord?: boolean;
    letters?: Letter[];
}

export interface InstrumentalDot {
    startTimeMs: number;
    endTimeMs: number;
}

export interface LyricLine {
    startTimeMs: number;
    endTimeMs: number;
    words: string;
    text?: string;
    isInstrumental?: boolean;
    isOppositeAligned?: boolean;
    isBackground?: boolean;
    isSyllable?: boolean;
    syllables?: Word[];
    instrumentalDots?: InstrumentalDot[];
}

export interface LyricsData {
    lines: LyricLine[];
    provider: 'spicy';
    syncType: 'LINE' | 'SYLLABLE';
    attribution?: LyricsAttribution;
}

// Spicy Lyrics API Key from .env (prefixed with VITE_ for Vite client-side access)
const SPICY_LYRICS_API_KEY = (
    import.meta.env.VITE_SPICY_LYRICS_KEY ||
    'sl_sk_K8rVy1yhQn-GK6BqYrdW1lI0qmlTe5QmYTMizemT6Ww'
).trim();

// Bounded cache for resolved Spotify track IDs (artist::title -> spotifyTrackId)
const MAX_TRACK_ID_CACHE = 200;
const trackIdCache = new Map<string, string | null>();

function setTrackIdCache(key: string, id: string | null): void {
    if (trackIdCache.size >= MAX_TRACK_ID_CACHE) {
        const oldestKey = trackIdCache.keys().next().value;
        if (oldestKey) trackIdCache.delete(oldestKey);
    }
    trackIdCache.set(key, id);
}

// Cache for anonymous Spotify session token
let cachedSpotifyToken: string | null = null;
let spotifyTokenExpiresAt = 0;
let sharedUserToken: string | null = null;

export function setLyricsUserToken(token: string | null): void {
    if (token && typeof token === 'string') {
        sharedUserToken = token;
    }
}

// Spotify Web Player search GraphQL constants
const SEARCH_OPERATION = 'searchDesktop';
const SEARCH_SHA256 = 'eff59fa0a3d026b88b56fddbcf4bdfa16a186b8175a5c1a358c072e053c2e5b0';

/**
 * Cleans song title and artist for accurate catalog matching
 */
export function cleanMetadata(text: string): string {
    if (!text) return '';
    return text
        .replace(/\(feat\..*?\)/gi, '')
        .replace(/\[feat\..*?\]/gi, '')
        .replace(/\(with.*?\)/gi, '')
        .replace(/\[with.*?\]/gi, '')
        .replace(/\(Official.*?Video.*?\)/gi, '')
        .replace(/\[Official.*?Video.*?\]/gi, '')
        .replace(/\(Official.*?Audio.*?\)/gi, '')
        .replace(/\[Official.*?Audio.*?\]/gi, '')
        .replace(/\(Official.*?\)/gi, '')
        .replace(/\[Official.*?\]/gi, '')
        .replace(/\(Lyric.*?Video.*?\)/gi, '')
        .replace(/\[Lyric.*?Video.*?\]/gi, '')
        .replace(/\(Lyrics.*?\)/gi, '')
        .replace(/\[Lyrics.*?\]/gi, '')
        .replace(/\(Visualizer.*?\)/gi, '')
        .replace(/\[Visualizer.*?\]/gi, '')
        .replace(/\(Audio.*?\)/gi, '')
        .replace(/\[Audio.*?\]/gi, '')
        .replace(/\(Remastered.*?\)/gi, '')
        .replace(/\(From.*?\)/gi, '')
        .replace(/\(Deluxe.*?\)/gi, '')
        .replace(/- .*?(Mix|Remix|Edit|Live)/gi, '')
        .replace(/\s+/g, ' ')
        .trim();
}

/**
 * Validates and extracts a 22-character Spotify track ID
 */
export function cleanSpotifyId(id?: string | null): string | null {
    if (!id || typeof id !== 'string') return null;
    const trimmed = id.trim();
    if (/^[A-Za-z0-9]{22}$/.test(trimmed)) {
        return trimmed;
    }
    const uriMatch = trimmed.match(/spotify:track:([A-Za-z0-9]{22})/);
    if (uriMatch) return uriMatch[1];

    const urlMatch = trimmed.match(/\/track\/([A-Za-z0-9]{22})/);
    if (urlMatch) return urlMatch[1];

    const wordMatch = trimmed.match(/\b([A-Za-z0-9]{22})\b/);
    if (wordMatch) return wordMatch[1];

    const match = trimmed.match(/[A-Za-z0-9]{22}/);
    return match ? match[0] : null;
}

/**
 * Safe fetch helper that handles Electron and browser dev environments:
 * In Electron (webSecurity: false), direct HTTPS requests work with zero CORS restrictions.
 * In external web browsers, proxy paths may be used if needed.
 * Crucially, if one endpoint throws an error or fails, fallback is safely caught and tried.
 */
async function fetchSafe(directUrl: string, proxyPath: string, init?: RequestInit): Promise<Response> {
    const isElectronEnv = typeof window !== 'undefined' && (
        Boolean((window as unknown as { electron?: unknown }).electron) ||
        window.location.protocol === 'file:' ||
        (typeof navigator !== 'undefined' && navigator.userAgent.toLowerCase().includes('electron'))
    );

    // Direct HTTPS is primary in Electron and production; proxy is fallback.
    const firstUrl = isElectronEnv ? directUrl : (import.meta.env.DEV ? proxyPath : directUrl);
    const fallbackUrl = firstUrl === directUrl ? proxyPath : directUrl;

    try {
        const res = await fetch(firstUrl, init);
        if (res.ok) return res;
        if (fallbackUrl && fallbackUrl !== firstUrl) {
            try {
                const fbRes = await fetch(fallbackUrl, init);
                if (fbRes.ok) return fbRes;
            } catch {
                // Ignore fallback exception, return original response
            }
        }
        return res;
    } catch {
        // Network error / exception on firstUrl (e.g. file:/// protocol or proxy down)
        if (fallbackUrl && fallbackUrl !== firstUrl) {
            return await fetch(fallbackUrl, init);
        }
        throw new Error(`Failed to fetch ${firstUrl}`);
    }
}

/**
 * Obtains an anonymous Spotify Web Player access token from embed page
 */
export async function getAnonymousSpotifyToken(signal?: AbortSignal): Promise<string | null> {
    const now = Date.now();
    if (cachedSpotifyToken && now < spotifyTokenExpiresAt - 60000) {
        return cachedSpotifyToken;
    }

    try {
        const bootstrapTrackId = '4uLU6hMCjMI75M1A2tKUQC';
        const res = await fetchSafe(
            `https://open.spotify.com/embed/track/${bootstrapTrackId}`,
            `/api/spotify-embed/embed/track/${bootstrapTrackId}`,
            { signal: signal || AbortSignal.timeout(5000) }
        );

        if (!res.ok) {
            console.warn(`[SpicyLyrics] Spotify embed token request failed: ${res.status}`);
            return null;
        }

        const html = await res.text();
        const match = html.match(/<script[^>]*id=["']__NEXT_DATA__["'][^>]*>(.*?)<\/script>/s);
        if (!match) return null;

        const json = JSON.parse(match[1]);
        const session = json?.props?.pageProps?.state?.settings?.session;
        if (!session?.accessToken) return null;

        cachedSpotifyToken = session.accessToken;
        spotifyTokenExpiresAt = session.accessTokenExpirationTimestampMs || (now + 3600 * 1000);
        return cachedSpotifyToken;
    } catch (err) {
        if ((err as Error)?.name !== 'AbortError') {
            console.error('[SpicyLyrics] Failed to retrieve anonymous Spotify token:', err);
        }
        return null;
    }
}

interface SpotifyGraphQLTrack {
    id: string;
    name: string;
    durationMs?: number;
}

async function executeSpotifyGraphQLSearch(token: string, queryStr: string): Promise<{ status: number; tracks: SpotifyGraphQLTrack[] }> {
    try {
        const variables = JSON.stringify({
            searchTerm: queryStr,
            offset: 0,
            limit: 10,
            numberOfTopResults: 5,
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

        const queryParams = `?operationName=${SEARCH_OPERATION}&variables=${encodeURIComponent(variables)}&extensions=${encodeURIComponent(extensions)}`;
        const res = await fetchSafe(
            `https://api-partner.spotify.com/pathfinder/v1/query${queryParams}`,
            `/api/spotify-partner/pathfinder/v1/query${queryParams}`,
            {
                headers: {
                    Authorization: `Bearer ${token}`,
                    'app-platform': 'WebPlayer'
                }
            }
        );

        if (res.status === 401) {
            return { status: 401, tracks: [] };
        }

        if (!res.ok) {
            return { status: res.status, tracks: [] };
        }

        const data = await res.json();
        const rawItems = data?.data?.searchV2?.tracksV2?.items || [];
        const parsedTracks: SpotifyGraphQLTrack[] = [];

        for (const item of rawItems) {
            const trackData = item?.item?.data;
            if (!trackData) continue;
            const id = trackData.id || (trackData.uri ? trackData.uri.split(':').pop() : null);
            if (id && /^[A-Za-z0-9]{22}$/.test(id)) {
                parsedTracks.push({
                    id,
                    name: trackData.name || '',
                    durationMs: trackData.duration?.totalMilliseconds
                });
            }
        }

        return { status: 200, tracks: parsedTracks };
    } catch {
        return { status: 500, tracks: [] };
    }
}

/**
 * Resolves a song title and artist to a Spotify track ID using Spotify's search catalog
 */
export async function resolveSpotifyTrackId(
    title: string,
    artist: string,
    album?: string,
    duration?: number,
    signal?: AbortSignal
): Promise<string | null> {
    const cleanTitle = cleanMetadata(title) || title.trim();
    const cleanArtist = cleanMetadata(artist) || artist.trim();
    const cleanAlbum = album ? cleanMetadata(album) : '';
    if (!cleanTitle && !cleanArtist) return null;

    const cacheKey = `${cleanArtist.toLowerCase()}::${cleanTitle.toLowerCase()}`;
    if (trackIdCache.has(cacheKey)) {
        return trackIdCache.get(cacheKey) || null;
    }

    // 1. Try local bridge server first (direct SP_DC / iTunes authenticated resolution in Node main process)
    try {
        const bridgeUrl = `http://localhost:4000/api/resolve-track?title=${encodeURIComponent(cleanTitle)}&artist=${encodeURIComponent(cleanArtist)}`;
        const bridgeRes = await fetch(bridgeUrl, { signal: signal ? signal : AbortSignal.timeout(3000) });
        if (bridgeRes.ok) {
            const bridgeJson = await bridgeRes.json();
            if (bridgeJson?.data?.id) {
                setTrackIdCache(cacheKey, bridgeJson.data.id);
                return bridgeJson.data.id;
            }
        }
    } catch {
        // Bridge service not available or timed out, continue to token search
    }

    // 2. Try shared user token or anonymous token
    let token = sharedUserToken || await getAnonymousSpotifyToken(signal);
    if (!token) return null;

    try {
        const query = `${cleanArtist} ${cleanTitle}`.trim();
        let searchResult = await executeSpotifyGraphQLSearch(token, query);

        if (searchResult.status === 401) {
            cachedSpotifyToken = null;
            sharedUserToken = null;
            token = await getAnonymousSpotifyToken(signal);
            if (token) {
                searchResult = await executeSpotifyGraphQLSearch(token, query);
            }
        }

        if (!token) return null;
        let tracks = searchResult.tracks;

        // Try primary artist if multiple artists present
        if (tracks.length === 0) {
            const primaryArtist = cleanArtist.split(/[,&/]|feat\.|ft\./i)[0].trim();
            if (primaryArtist && primaryArtist !== cleanArtist) {
                const primaryResult = await executeSpotifyGraphQLSearch(token, `${primaryArtist} ${cleanTitle}`.trim());
                if (primaryResult.tracks.length > 0) tracks = primaryResult.tracks;
            }
        }

        if (tracks.length === 0 && cleanAlbum) {
            const albumResult = await executeSpotifyGraphQLSearch(token, `${cleanTitle} ${cleanAlbum}`.trim());
            if (albumResult.tracks.length > 0) tracks = albumResult.tracks;
        }

        if (tracks.length === 0) {
            const titleResult = await executeSpotifyGraphQLSearch(token, cleanTitle);
            if (titleResult.tracks.length > 0) tracks = titleResult.tracks;
        }

        if (tracks.length === 0 && (title.trim() !== cleanTitle || artist.trim() !== cleanArtist)) {
            const rawResult = await executeSpotifyGraphQLSearch(token, `${artist.trim()} ${title.trim()}`.trim());
            if (rawResult.tracks.length > 0) tracks = rawResult.tracks;
        }

        if (tracks.length === 0) {
            return null;
        }

        let bestMatch = tracks[0];
        if (duration && duration > 0) {
            const durationMatch = tracks.find(
                (item) => Math.abs((item.durationMs || 0) - duration) < 6000
            );
            if (durationMatch) bestMatch = durationMatch;
        }

        const resolvedId = bestMatch.id;
        setTrackIdCache(cacheKey, resolvedId);
        return resolvedId;
    } catch (err) {
        console.error('[SpicyLyrics] Error during Spotify track resolution:', err);
        return null;
    }
}

interface RawSyllable {
    StartTime: number;
    EndTime: number;
    Text?: string;
    TransliteratedText?: string;
    IsPartOfWord?: boolean;
}

/**
 * Reusable helper to parse syllable groups into timed words and letters
 * Follows Spicy Lyrics 6.3.153 IsLetterCapable (duration >= 1000ms) and Emphasize (-250ms compensation)
 */
function parseSyllableGroup(rawSyllables: RawSyllable[]): { syllables: Word[]; lineText: string } {
    const syllables: Word[] = rawSyllables.map((s) => {
        const sStart = Math.round(s.StartTime * 1000);
        const sEnd = Math.round(s.EndTime * 1000);
        const text = s.Text || '';
        const totalDuration = sEnd - sStart;

        let letters: Letter[] | undefined;
        // In Spicy Lyrics 6.3.153:
        // IsLetterCapable: totalDuration >= 1000ms and letterLength > 0
        // Emphasize: EndTime lead subtraction is 250ms (yielding effective vocal sustain)
        const chars = Array.from(text);
        if (totalDuration >= 1000 && chars.length > 0) {
            const effectiveEnd = Math.max(sStart + 200, sEnd - 250);
            const effectiveDuration = effectiveEnd - sStart;
            const letterDuration = effectiveDuration / chars.length;
            letters = chars.map((ch: string, idx: number) => ({
                letter: ch,
                startTimeMs: Math.round(sStart + idx * letterDuration),
                endTimeMs: Math.round(sStart + (idx + 1) * letterDuration)
            }));
        }

        return {
            word: text,
            transliteratedWord: s.TransliteratedText,
            startTimeMs: sStart,
            endTimeMs: sEnd,
            isPartOfWord: s.IsPartOfWord === true,
            letters
        };
    });

    let fullLineWords = '';
    for (let sIdx = 0; sIdx < syllables.length; sIdx++) {
        fullLineWords += syllables[sIdx].word;
        if (!syllables[sIdx].isPartOfWord && sIdx < syllables.length - 1) {
            fullLineWords += ' ';
        }
    }

    return { syllables, lineText: fullLineWords.trim() };
}

/**
 * Streamlined helper to post-process flat lyric lines:
 * Sort chronologically, ensure end times, and insert 3-dot instrumental pauses
 */
function processFlatLines(lines: LyricLine[]): LyricLine[] {
    // Sort chronologically, prioritizing lead vocals over background vocals when timestamps tie
    lines.sort((a, b) => {
        if (a.startTimeMs !== b.startTimeMs) {
            return a.startTimeMs - b.startTimeMs;
        }
        if (a.isBackground && !b.isBackground) return 1;
        if (!a.isBackground && b.isBackground) return -1;
        return 0;
    });

    for (let i = 0; i < lines.length; i++) {
        if (!lines[i].endTimeMs || lines[i].endTimeMs <= lines[i].startTimeMs) {
            lines[i].endTimeMs = (i < lines.length - 1 && lines[i + 1].startTimeMs > lines[i].startTimeMs)
                ? lines[i + 1].startTimeMs
                : lines[i].startTimeMs + 4000;
        }
    }

    const processed: LyricLine[] = [];
    for (let i = 0; i < lines.length; i++) {
        processed.push(lines[i]);
        if (i < lines.length - 1) {
            const currentEnd = lines[i].endTimeMs;
            const nextStart = lines[i + 1].startTimeMs;
            const gap = nextStart - currentEnd;
            if (gap >= 3000 && !lines[i].isInstrumental && !lines[i + 1].isInstrumental) {
                const dotDuration = gap / 3;
                processed.push({
                    startTimeMs: currentEnd,
                    endTimeMs: nextStart,
                    words: '♪',
                    text: '♪',
                    isInstrumental: true,
                    instrumentalDots: [
                        { startTimeMs: currentEnd, endTimeMs: Math.round(currentEnd + dotDuration) },
                        { startTimeMs: Math.round(currentEnd + dotDuration), endTimeMs: Math.round(currentEnd + dotDuration * 2) },
                        { startTimeMs: Math.round(currentEnd + dotDuration * 2), endTimeMs: nextStart }
                    ]
                });
            }
        }
    }

    return processed;
}

export const lyricsProvider = {
    /**
     * Fetches synced lyrics exclusively from Spicy Lyrics API
     */
    async fetchLyrics(
        title: string,
        artist: string,
        album?: string,
        duration?: number,
        explicitSpotifyId?: string,
        signal?: AbortSignal
    ): Promise<LyricsData | null> {
        if (!SPICY_LYRICS_API_KEY) {
            console.warn('[LyricsProvider] No VITE_SPICY_LYRICS_KEY found in environment');
            return null;
        }

        if (signal?.aborted) return null;

        try {
            let spotifyId: string | null = null;
            if (explicitSpotifyId) {
                spotifyId = cleanSpotifyId(explicitSpotifyId);
            }

            if (!spotifyId) {
                const resolved = await resolveSpotifyTrackId(title, artist, album, duration, signal);
                if (resolved) {
                    spotifyId = cleanSpotifyId(resolved);
                }
            }

            if (!spotifyId || signal?.aborted) {
                if (!spotifyId) {
                    console.warn(`[LyricsProvider] Could not resolve Spotify ID for "${title}" by "${artist}"`);
                }
                return null;
            }

            const path = `/v1/lyrics/${spotifyId}`;
            let res = await fetchSafe(
                `https://api.spicylyrics.org${path}`,
                `/api/spicylyrics${path}`,
                { headers: { Authorization: `Bearer ${SPICY_LYRICS_API_KEY}` }, signal }
            );

            // Handle upstream processing / 503 (SpicyLyrics triggers upstream fetch and caches)
            if (res.status === 503) {
                if (signal?.aborted) return null;
                console.log(`[LyricsProvider] Upstream fetching for ${spotifyId}, retrying in 1.5s...`);
                await new Promise((r) => setTimeout(r, 1500));
                if (signal?.aborted) return null;
                res = await fetchSafe(
                    `https://api.spicylyrics.org${path}`,
                    `/api/spicylyrics${path}`,
                    { headers: { Authorization: `Bearer ${SPICY_LYRICS_API_KEY}` }, signal }
                );
                if (res.status === 503) {
                    if (signal?.aborted) return null;
                    await new Promise((r) => setTimeout(r, 2000));
                    if (signal?.aborted) return null;
                    res = await fetchSafe(
                        `https://api.spicylyrics.org${path}`,
                        `/api/spicylyrics${path}`,
                        { headers: { Authorization: `Bearer ${SPICY_LYRICS_API_KEY}` }, signal }
                    );
                }
            }

            if (!res.ok) {
                console.warn(`[LyricsProvider] SpicyLyrics returned HTTP ${res.status} for ${spotifyId}`);
                return null;
            }

            const data = await res.json();
            if (data.Status !== 200 || !data.Body) {
                console.warn(`[LyricsProvider] SpicyLyrics body status ${data?.Status} for ${spotifyId}`);
                return null;
            }

            const body = data.Body;
            const content = body.Content;
            const rawLines: LyricLine[] = [];
            let hasSyllables = false;

            // Intro Instrumental Break if song starts after delay (>= 3s)
            if (typeof body.StartTime === 'number' && body.StartTime >= 3) {
                const introDuration = Math.round(body.StartTime * 1000);
                const dotDuration = introDuration / 3;
                rawLines.push({
                    startTimeMs: 0,
                    endTimeMs: introDuration,
                    words: '♪',
                    text: '♪',
                    isInstrumental: true,
                    instrumentalDots: [
                        { startTimeMs: 0, endTimeMs: Math.round(dotDuration) },
                        { startTimeMs: Math.round(dotDuration), endTimeMs: Math.round(dotDuration * 2) },
                        { startTimeMs: Math.round(dotDuration * 2), endTimeMs: introDuration }
                    ]
                });
            }

            if (Array.isArray(content) && content.length > 0) {
                for (const item of content) {
                    const isOpposite = item.OppositeAligned === true;

                    if (item.Type === 'Interlude') {
                        const startMs = Math.round((item.StartTime ?? 0) * 1000);
                        const endMs = Math.round((item.EndTime ?? (item.StartTime + 4)) * 1000);
                        const gap = endMs - startMs;
                        const dotDuration = gap / 3;
                        rawLines.push({
                            startTimeMs: startMs,
                            endTimeMs: endMs,
                            words: '♪',
                            text: '♪',
                            isInstrumental: true,
                            isOppositeAligned: isOpposite,
                            instrumentalDots: [
                                { startTimeMs: startMs, endTimeMs: Math.round(startMs + dotDuration) },
                                { startTimeMs: Math.round(startMs + dotDuration), endTimeMs: Math.round(startMs + dotDuration * 2) },
                                { startTimeMs: Math.round(startMs + dotDuration * 2), endTimeMs: endMs }
                            ]
                        });
                        continue;
                    }

                    const lead = item.Lead;
                    if (lead && Array.isArray(lead.Syllables) && lead.Syllables.length > 0) {
                        hasSyllables = true;
                        const lineStartMs = Math.round((lead.StartTime ?? item.StartTime ?? lead.Syllables[0]?.StartTime ?? 0) * 1000);
                        const lineEndMs = Math.round((lead.EndTime ?? item.EndTime ?? lead.Syllables[lead.Syllables.length - 1]?.EndTime ?? 0) * 1000);
                        const { syllables, lineText } = parseSyllableGroup(lead.Syllables);

                        if (lineText) {
                            rawLines.push({
                                startTimeMs: lineStartMs,
                                endTimeMs: lineEndMs,
                                words: lineText,
                                text: lineText,
                                isSyllable: true,
                                syllables,
                                isOppositeAligned: isOpposite
                            });
                        }
                    } else if (item.Text && item.Text.trim()) {
                        const lineText = item.Text.trim();
                        rawLines.push({
                            startTimeMs: Math.round((item.StartTime ?? 0) * 1000),
                            endTimeMs: Math.round((item.EndTime ?? 0) * 1000),
                            words: lineText,
                            text: lineText,
                            isSyllable: false,
                            isOppositeAligned: isOpposite
                        });
                    }

                    // Background vocals
                    if (Array.isArray(item.Background) && item.Background.length > 0) {
                        for (const bg of item.Background) {
                            if (Array.isArray(bg.Syllables) && bg.Syllables.length > 0) {
                                hasSyllables = true;
                                const bgStartMs = Math.round((bg.StartTime ?? item.StartTime ?? bg.Syllables[0]?.StartTime ?? 0) * 1000);
                                const bgEndMs = Math.round((bg.EndTime ?? item.EndTime ?? bg.Syllables[bg.Syllables.length - 1]?.EndTime ?? 0) * 1000);
                                const { syllables, lineText: cleanBgText } = parseSyllableGroup(bg.Syllables);

                                if (cleanBgText) {
                                    const stripped = cleanBgText.replace(/[()]/g, '').trim();
                                    const cleanSyllables = syllables.map((s) => ({
                                        ...s,
                                        word: s.word.replace(/[()]/g, ''),
                                        letters: s.letters ? s.letters.filter((l) => l.letter !== '(' && l.letter !== ')') : undefined
                                    }));
                                    rawLines.push({
                                        startTimeMs: bgStartMs,
                                        endTimeMs: bgEndMs,
                                        words: stripped,
                                        text: stripped,
                                        isSyllable: true,
                                        syllables: cleanSyllables,
                                        isBackground: true,
                                        isOppositeAligned: isOpposite
                                    });
                                }
                            } else if (bg.Text && bg.Text.trim()) {
                                const cleanBgText = bg.Text.trim();
                                const stripped = cleanBgText.replace(/[()]/g, '').trim();
                                const bgStartMs = Math.round((bg.StartTime ?? item.StartTime ?? 0) * 1000);
                                const bgEndMs = Math.round((bg.EndTime ?? item.EndTime ?? 0) * 1000);
                                rawLines.push({
                                    startTimeMs: bgStartMs,
                                    endTimeMs: bgEndMs,
                                    words: stripped,
                                    text: stripped,
                                    isSyllable: false,
                                    isBackground: true,
                                    isOppositeAligned: isOpposite
                                });
                            }
                        }
                    }
                }
            } else if (Array.isArray(body.Lines) && body.Lines.length > 0) {
                body.Lines.forEach((lineItem: { Text?: string } | string) => {
                    const lineText = (typeof lineItem === 'object' && lineItem ? (lineItem.Text || '') : String(lineItem)).trim();
                    if (lineText) {
                        rawLines.push({
                            startTimeMs: 0,
                            endTimeMs: 0,
                            words: lineText,
                            text: lineText
                        });
                    }
                });
            }

            if (rawLines.length === 0) return null;

            const flatLines = processFlatLines(rawLines);

            const songwriters = Array.isArray(body.SongWriters)
                ? body.SongWriters.filter((w: unknown): w is string => typeof w === 'string' && w.trim().length > 0)
                : undefined;

            let maker: Contributor | undefined;
            if (body.UploadAttribution?.Maker) {
                const m = body.UploadAttribution.Maker;
                maker = {
                    id: m.id,
                    username: m.username || 'Contributor',
                    avatar: m.avatar,
                    url: m.url || (m.id ? `https://spicylyrics.org/uid/${m.id}` : undefined)
                };
            }

            let uploader: Contributor | undefined;
            if (body.UploadAttribution?.Uploader) {
                const u = body.UploadAttribution.Uploader;
                uploader = {
                    id: u.id,
                    username: u.username || 'Contributor',
                    avatar: u.avatar,
                    url: u.url || (u.id ? `https://spicylyrics.org/uid/${u.id}` : undefined)
                };
            }

            const rawSource = body.source;
            const validSource: LyricsAttribution['source'] =
                rawSource === 'apple_music' || rawSource === 'spotify' || rawSource === 'spicy_lyrics'
                    ? rawSource
                    : 'spicy_lyrics';

            return {
                lines: flatLines,
                provider: 'spicy',
                syncType: (body.Type === 'Syllable' || hasSyllables) ? 'SYLLABLE' : 'LINE',
                attribution: {
                    source: validSource,
                    songwriters: songwriters && songwriters.length > 0 ? songwriters : undefined,
                    maker,
                    uploader
                }
            };
        } catch (err) {
            console.error('[LyricsProvider] Fetch error:', err);
            return null;
        }
    }
};
