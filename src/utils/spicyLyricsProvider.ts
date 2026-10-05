import type { LyricLine, LyricsData, Word, Letter, LyricsAttribution, Contributor } from './lyricsProvider';

// Spicy Lyrics API Key from .env (prefixed with VITE_ for Vite client-side access)
const SPICY_LYRICS_API_KEY = (
    import.meta.env.VITE_SPICY_LYRICS_KEY ||
    'sl_sk_K8rVy1yhQn-GK6BqYrdW1lI0qmlTe5QmYTMizemT6Ww'
).trim();

// Cache for resolved Spotify track IDs (artist::title -> spotifyTrackId)
const trackIdCache = new Map<string, string | null>();

// Cache for anonymous Spotify session token
let cachedSpotifyToken: string | null = null;
let spotifyTokenExpiresAt = 0;

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
 * Helper to get either Vite dev proxy URL or direct target URL
 */
function getEndpoint(proxyPath: string, directUrl: string): string {
    if (import.meta.env.DEV) {
        return proxyPath;
    }
    return directUrl;
}

/**
 * Obtains an anonymous Spotify Web Player access token from embed page
 */
async function getAnonymousSpotifyToken(): Promise<string | null> {
    const now = Date.now();
    if (cachedSpotifyToken && now < spotifyTokenExpiresAt - 60000) {
        return cachedSpotifyToken;
    }

    try {
        const bootstrapTrackId = '4uLU6hMCjMI75M1A2tKUQC'; // Universal anchor
        const primaryUrl = getEndpoint(
            `/api/spotify-embed/embed/track/${bootstrapTrackId}`,
            `https://open.spotify.com/embed/track/${bootstrapTrackId}`
        );

        let res = await fetch(primaryUrl);
        // Fallback to direct URL if proxy returned non-OK or failed
        if (!res.ok && import.meta.env.DEV) {
            res = await fetch(`https://open.spotify.com/embed/track/${bootstrapTrackId}`);
        }

        if (!res.ok) {
            console.warn(`[SpicyLyrics] Spotify embed token request failed with status: ${res.status}`);
            return null;
        }

        const html = await res.text();
        const match = html.match(/<script[^>]*id=["']__NEXT_DATA__["'][^>]*>(.*?)<\/script>/s);
        if (!match) {
            console.warn('[SpicyLyrics] Unable to parse Spotify __NEXT_DATA__ for anonymous session');
            return null;
        }

        const json = JSON.parse(match[1]);
        const session = json?.props?.pageProps?.state?.settings?.session;
        if (!session?.accessToken) {
            console.warn('[SpicyLyrics] Missing accessToken in Spotify session');
            return null;
        }

        cachedSpotifyToken = session.accessToken;
        spotifyTokenExpiresAt = session.accessTokenExpirationTimestampMs || (now + 3600 * 1000);
        return cachedSpotifyToken;
    } catch (err) {
        console.error('[SpicyLyrics] Failed to retrieve anonymous Spotify token:', err);
        return null;
    }
}

interface SpotifyGraphQLTrack {
    id: string;
    name: string;
    durationMs?: number;
}

/**
 * Executes a GraphQL search using Spotify's Pathfinder contract
 */
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
        const primaryUrl = getEndpoint(
            `/api/spotify-partner/pathfinder/v1/query${queryParams}`,
            `https://api-partner.spotify.com/pathfinder/v1/query${queryParams}`
        );

        let res = await fetch(primaryUrl, {
            headers: {
                Authorization: `Bearer ${token}`,
                'app-platform': 'WebPlayer'
            }
        });

        // Fallback to direct URL if needed
        if (!res.ok && import.meta.env.DEV) {
            res = await fetch(`https://api-partner.spotify.com/pathfinder/v1/query${queryParams}`, {
                headers: {
                    Authorization: `Bearer ${token}`,
                    'app-platform': 'WebPlayer'
                }
            });
        }

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
    } catch (err) {
        console.error('[SpicyLyrics] GraphQL search request error:', err);
        return { status: 500, tracks: [] };
    }
}

/**
 * Resolves a song title and artist to a Spotify track ID using Spotify's search catalog
 */
export async function resolveSpotifyTrackId(title: string, artist: string, album?: string, duration?: number): Promise<string | null> {
    const cleanTitle = cleanMetadata(title);
    const cleanArtist = cleanMetadata(artist);
    const cleanAlbum = album ? cleanMetadata(album) : '';
    if (!cleanTitle && !cleanArtist) return null;

    const cacheKey = `${cleanArtist.toLowerCase()}::${cleanTitle.toLowerCase()}`;
    if (trackIdCache.has(cacheKey)) {
        return trackIdCache.get(cacheKey) || null;
    }

    let token = await getAnonymousSpotifyToken();
    if (!token) return null;

    try {
        const query = `${cleanArtist} ${cleanTitle}`.trim();
        let searchResult = await executeSpotifyGraphQLSearch(token, query);

        // If token expired (401), invalidate and retry once with fresh token
        if (searchResult.status === 401) {
            console.log('[SpicyLyrics] Anonymous Spotify token expired. Refreshing session...');
            cachedSpotifyToken = null;
            token = await getAnonymousSpotifyToken();
            if (token) {
                searchResult = await executeSpotifyGraphQLSearch(token, query);
            }
        }

        if (!token) return null;

        let tracks = searchResult.tracks;

        // If no items found and cleanAlbum is available, try title + album
        if (tracks.length === 0 && cleanAlbum) {
            const albumQuery = `${cleanTitle} ${cleanAlbum}`.trim();
            const albumResult = await executeSpotifyGraphQLSearch(token, albumQuery);
            if (albumResult.tracks.length > 0) {
                tracks = albumResult.tracks;
            }
        }

        // If still no items found, try title alone
        if (tracks.length === 0) {
            const titleResult = await executeSpotifyGraphQLSearch(token, cleanTitle);
            if (titleResult.tracks.length > 0) {
                tracks = titleResult.tracks;
            }
        }

        if (tracks.length === 0) {
            console.warn(`[SpicyLyrics] No tracks found for "${cleanTitle}" by "${cleanArtist}"`);
            trackIdCache.set(cacheKey, null);
            return null;
        }

        // Candidate matching: prioritize closest duration if duration provided
        let bestMatch = tracks[0];
        if (duration && duration > 0) {
            const durationMatch = tracks.find(
                (item) => Math.abs((item.durationMs || 0) - duration) < 6000
            );
            if (durationMatch) {
                bestMatch = durationMatch;
            }
        }

        const resolvedId = bestMatch.id;
        console.log(`[SpicyLyrics] Resolved "${cleanTitle}" by "${cleanArtist}" -> Spotify ID: ${resolvedId} (${bestMatch.name})`);
        trackIdCache.set(cacheKey, resolvedId);
        return resolvedId;
    } catch (err) {
        console.error('[SpicyLyrics] Error during Spotify track resolution:', err);
        return null;
    }
}

/**
 * Ensures line end times are populated and injects 3-dot instrumental interludes for gaps >= 3s
 */
function processLyricsLines(lines: LyricLine[]): LyricLine[] {
    // Sort lines chronologically so lead, background, and intro lines appear in natural order
    lines.sort((a, b) => a.startTimeMs - b.startTimeMs);

    for (let i = 0; i < lines.length; i++) {
        // Ensure line end times if missing
        if (!lines[i].endTimeMs || lines[i].endTimeMs === 0) {
            if (i < lines.length - 1 && lines[i + 1].startTimeMs > lines[i].startTimeMs) {
                lines[i].endTimeMs = lines[i + 1].startTimeMs;
            } else {
                lines[i].endTimeMs = lines[i].startTimeMs + 4000;
            }
        }
    }

    // Automatically inject instrumental interlude dots for gaps >= 3 seconds (matching Spicetify Spicy Lyrics getLyricsBetweenShow)
    const linesWithInterludes: LyricLine[] = [];
    for (let i = 0; i < lines.length; i++) {
        linesWithInterludes.push(lines[i]);
        if (i < lines.length - 1) {
            const currentEnd = lines[i].endTimeMs;
            const nextStart = lines[i + 1].startTimeMs;
            const gap = nextStart - currentEnd;
            if (gap >= 3000 && !lines[i].isInstrumental && !lines[i + 1].isInstrumental) {
                const dotDuration = gap / 3;
                linesWithInterludes.push({
                    startTimeMs: currentEnd,
                    endTimeMs: nextStart,
                    words: '♪',
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

    return linesWithInterludes;
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

export const spicyLyricsProvider = {
    /**
     * Checks if a Spicy Lyrics API key is configured
     */
    hasApiKey(): boolean {
        return Boolean(SPICY_LYRICS_API_KEY && SPICY_LYRICS_API_KEY.length > 0);
    },

    /**
     * Fetches word/syllable-level synced lyrics from the Spicy Lyrics API
     */
    async fetchLyrics(
        title: string,
        artist: string,
        album?: string,
        duration?: number,
        explicitSpotifyId?: string
    ): Promise<LyricsData | null> {
        if (!SPICY_LYRICS_API_KEY) {
            console.warn('[SpicyLyrics] No VITE_SPICY_LYRICS_KEY found in environment variables. Falling back to secondary provider.');
            return null;
        }

        // 1. Resolve Spotify Track ID for the current track's title & artist
        // We prioritize catalog resolution using title & artist to guarantee that each song
        // fetches its own unique lyrics and never inherits a stale track ID from a previously played song.
        let spotifyId: string | null = null;
        const resolved = await resolveSpotifyTrackId(title, artist, album, duration);
        if (resolved) {
            spotifyId = cleanSpotifyId(resolved);
        }

        // Fallback to explicitSpotifyId only if catalog search returned no results
        if (!spotifyId && explicitSpotifyId) {
            spotifyId = cleanSpotifyId(explicitSpotifyId);
        }

        if (!spotifyId) {
            console.warn(`[SpicyLyrics] Could not resolve Spotify Track ID for "${title}" by "${artist}".`);
            return null;
        }

        console.log(`[SpicyLyrics] Fetching lyrics for track ${spotifyId}...`);

        try {
            const path = `/v1/lyrics/${spotifyId}`;
            const primaryUrl = getEndpoint(
                `/api/spicylyrics${path}`,
                `https://api.spicylyrics.org${path}`
            );

            let res = await fetch(primaryUrl, {
                headers: { Authorization: `Bearer ${SPICY_LYRICS_API_KEY}` }
            });

            // If 503 (upstream unavailable or generating cache), retry once after a short wait
            if (res.status === 503) {
                console.log('[SpicyLyrics] Upstream returned 503 (preparing cache). Retrying in 1.2s...');
                await new Promise((r) => setTimeout(r, 1200));
                res = await fetch(primaryUrl, {
                    headers: { Authorization: `Bearer ${SPICY_LYRICS_API_KEY}` }
                });
            }

            // Fallback to direct URL if proxy had issues
            if (!res.ok && import.meta.env.DEV) {
                res = await fetch(`https://api.spicylyrics.org${path}`, {
                    headers: { Authorization: `Bearer ${SPICY_LYRICS_API_KEY}` }
                });
            }

            if (!res.ok) {
                console.warn(`[SpicyLyrics] Request returned HTTP status ${res.status}`);
                return null;
            }

            const data = await res.json();
            if (data.Status !== 200 || !data.Body) {
                console.warn(`[SpicyLyrics] API returned response status: ${data.Status}`);
                return null;
            }

            const body = data.Body;
            const content = body.Content;
            const lines: LyricLine[] = [];
            let hasSyllables = false;

            // 1. Intro Instrumental Break if song starts after a delay (>= 3s)
            if (typeof body.StartTime === 'number' && body.StartTime >= 3) {
                const introEndMs = Math.round(body.StartTime * 1000);
                const dotDuration = introEndMs / 3;
                lines.push({
                    startTimeMs: 0,
                    endTimeMs: introEndMs,
                    words: '♪',
                    isInstrumental: true,
                    instrumentalDots: [
                        { startTimeMs: 0, endTimeMs: Math.round(dotDuration) },
                        { startTimeMs: Math.round(dotDuration), endTimeMs: Math.round(dotDuration * 2) },
                        { startTimeMs: Math.round(dotDuration * 2), endTimeMs: introEndMs }
                    ]
                });
            }

            // 2. Parse Content (Word-synced / Line-synced / Instrumental)
            if (Array.isArray(content) && content.length > 0) {
                for (let i = 0; i < content.length; i++) {
                    const item = content[i];
                    const isOpposite = item.OppositeAligned === true;

                    // Check for Instrumental Break / Interlude
                    if (item.Type === 'Interlude') {
                        const startMs = Math.round((item.StartTime ?? 0) * 1000);
                        const endMs = Math.round((item.EndTime ?? (item.StartTime + 5)) * 1000);
                        const totalDuration = endMs - startMs;
                        const dotDuration = totalDuration / 3;
                        lines.push({
                            startTimeMs: startMs,
                            endTimeMs: endMs,
                            words: '♪',
                            isInstrumental: true,
                            instrumentalDots: [
                                { startTimeMs: startMs, endTimeMs: Math.round(startMs + dotDuration) },
                                { startTimeMs: Math.round(startMs + dotDuration), endTimeMs: Math.round(startMs + dotDuration * 2) },
                                { startTimeMs: Math.round(startMs + dotDuration * 2), endTimeMs: endMs }
                            ]
                        });
                        continue;
                    }

                    // Lead vocals with syllables (Word/Syllable-level sync from API)
                    const lead = item.Lead;
                    interface RawSyllable {
                        StartTime: number;
                        EndTime: number;
                        Text?: string;
                        IsPartOfWord?: boolean;
                    }

                    if (lead && Array.isArray(lead.Syllables) && lead.Syllables.length > 0) {
                        hasSyllables = true;
                        const lineStartMs = Math.round(lead.StartTime * 1000);
                        const lineEndMs = Math.round(lead.EndTime * 1000);

                        const syllables: Word[] = lead.Syllables.map((s: RawSyllable) => {
                            const sStart = Math.round(s.StartTime * 1000);
                            const sEnd = Math.round(s.EndTime * 1000);
                            const text = s.Text || '';
                            const totalDuration = sEnd - sStart;

                            // True letter syncing for sustained syllables (>= 800ms)
                            let letters: Letter[] | undefined;
                            if (totalDuration >= 800 && text.trim().length > 1) {
                                const chars = text.split('');
                                const letterDuration = totalDuration / chars.length;
                                letters = chars.map((ch: string, idx: number) => ({
                                    letter: ch,
                                    startTimeMs: Math.round(sStart + idx * letterDuration),
                                    endTimeMs: Math.round(sStart + (idx + 1) * letterDuration)
                                }));
                            }

                            return {
                                word: text,
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

                        lines.push({
                            startTimeMs: lineStartMs,
                            endTimeMs: lineEndMs,
                            words: fullLineWords.trim(),
                            isSyllable: true,
                            syllables,
                            isOppositeAligned: isOpposite
                        });
                    } else if (item.Text) {
                        // Standard line-synced item (Line-level sync from API)
                        lines.push({
                            startTimeMs: Math.round((item.StartTime ?? 0) * 1000),
                            endTimeMs: Math.round((item.EndTime ?? 0) * 1000),
                            words: item.Text.trim(),
                            isSyllable: false,
                            isOppositeAligned: isOpposite
                        });
                    }

                    // Background vocals (can accompany lead vocals or appear independently)
                    if (Array.isArray(item.Background) && item.Background.length > 0) {
                        for (const bg of item.Background) {
                            if (Array.isArray(bg.Syllables) && bg.Syllables.length > 0) {
                                hasSyllables = true;
                                const bgStartMs = Math.round(bg.StartTime * 1000);
                                const bgEndMs = Math.round(bg.EndTime * 1000);

                                const syllables: Word[] = bg.Syllables.map((s: RawSyllable) => {
                                    const sStart = Math.round(s.StartTime * 1000);
                                    const sEnd = Math.round(s.EndTime * 1000);
                                    const text = s.Text || '';
                                    const totalDuration = sEnd - sStart;

                                    // True letter syncing for sustained syllables (>= 800ms)
                                    let letters: Letter[] | undefined;
                                    if (totalDuration >= 800 && text.trim().length > 1) {
                                        const chars = text.split('');
                                        const letterDuration = totalDuration / chars.length;
                                        letters = chars.map((ch: string, idx: number) => ({
                                            letter: ch,
                                            startTimeMs: Math.round(sStart + idx * letterDuration),
                                            endTimeMs: Math.round(sStart + (idx + 1) * letterDuration)
                                        }));
                                    }

                                    return {
                                        word: text,
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

                                lines.push({
                                    startTimeMs: bgStartMs,
                                    endTimeMs: bgEndMs,
                                    words: `(${fullLineWords.trim()})`,
                                    isSyllable: true,
                                    syllables,
                                    isOppositeAligned: isOpposite,
                                    isBackground: true
                                });
                            }
                        }
                    }
                }
            } else if (Array.isArray(body.Lines) && body.Lines.length > 0) {
                // Static / unsynced lines
                body.Lines.forEach((lineItem: { Text?: string } | string) => {
                    const text = typeof lineItem === 'object' && lineItem ? (lineItem.Text || '') : String(lineItem);
                    if (text.trim()) {
                        lines.push({
                            startTimeMs: 0,
                            endTimeMs: 0,
                            words: text.trim(),
                            isSyllable: false
                        });
                    }
                });
            }

            if (lines.length === 0) {
                console.warn('[SpicyLyrics] No valid lyric lines parsed from response');
                return null;
            }

            // 3. Normalize timings and syllable ranges
            const processedLines = processLyricsLines(lines);

            // 4. Extract official attribution & contributors
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

            const attribution: LyricsAttribution = {
                source: validSource,
                songwriters: songwriters && songwriters.length > 0 ? songwriters : undefined,
                maker,
                uploader
            };

            console.log(`[SpicyLyrics] Successfully parsed ${processedLines.length} lines (Sync: ${hasSyllables ? 'SYLLABLE' : 'LINE'}, Source: ${validSource})`);

            return {
                lines: processedLines,
                provider: 'spicy',
                syncType: hasSyllables ? 'SYLLABLE' : 'LINE',
                attribution
            };
        } catch (err) {
            console.error('[SpicyLyrics] Fetch error:', err);
            return null;
        }
    }
};
