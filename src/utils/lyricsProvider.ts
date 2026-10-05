export interface Letter {
    letter: string;
    startTimeMs: number;
    endTimeMs: number;
}

export interface Word {
    word: string;
    startTimeMs: number;
    endTimeMs: number;
    isPartOfWord?: boolean;
    progressRange?: [number, number];
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
    isSyllable?: boolean;
    syllables?: Word[];
    isOppositeAligned?: boolean;
    isBackground?: boolean;
    isInstrumental?: boolean;
    instrumentalDots?: InstrumentalDot[];
}

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

import { spicyLyricsProvider } from './spicyLyricsProvider';

export interface LyricsData {
    lines: LyricLine[];
    provider: 'spicy';
    syncType: 'LINE' | 'SYLLABLE';
    attribution?: LyricsAttribution;
}

export const lyricsProvider = {
    /**
     * Fetches synced lyrics exclusively from Spicy Lyrics API
     */
    fetchLyrics: async (
        title: string,
        artist: string,
        album?: string,
        duration?: number,
        explicitSpotifyId?: string
    ): Promise<LyricsData | null> => {
        try {
            console.log(`[LyricsProvider] Querying Spicy Lyrics exclusively for: "${title}" by "${artist}"`);
            const spicyLyrics = await spicyLyricsProvider.fetchLyrics(title, artist, album, duration, explicitSpotifyId);
            if (spicyLyrics && spicyLyrics.lines && spicyLyrics.lines.length > 0) {
                console.log(`[LyricsProvider] Successfully retrieved ${spicyLyrics.lines.length} lines from Spicy Lyrics (${spicyLyrics.syncType}, Source: ${spicyLyrics.attribution?.source})`);
                return spicyLyrics;
            }
            console.warn(`[LyricsProvider] No lyrics found on Spicy Lyrics for "${title}" by "${artist}".`);
            return null;
        } catch (err) {
            console.error('[LyricsProvider] Spicy Lyrics request failed:', err);
            return null;
        }
    }
};
