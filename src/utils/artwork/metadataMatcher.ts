/**
 * Strict Metadata Matcher
 * Prevents incorrect artwork matching for remixes, live versions, acoustic versions,
 * sped-up/slowed versions, alternate recordings, and songs with identical titles.
 */

import type { ArtworkTrackInfo } from './types';

const MODIFIER_PATTERNS = [
    { key: 'remix', regex: /\b(remix|rmx|club mix|extended mix|vip mix)\b/i },
    { key: 'live', regex: /\b(live|concert|in concert|live at|live from)\b/i },
    { key: 'acoustic', regex: /\b(acoustic|unplugged|stripped)\b/i },
    { key: 'sped_up', regex: /\b(sped\s*up|speed\s*up|nightcore)\b/i },
    { key: 'slowed', regex: /\b(slowed|reverb|daycore)\b/i },
    { key: 'instrumental', regex: /\b(instrumental|karaoke|backing track)\b/i },
    { key: 'demo', regex: /\b(demo|voice memo)\b/i },
    { key: 'radio_edit', regex: /\b(radio\s*edit)\b/i },
    { key: 'deluxe', regex: /\b(deluxe|expanded|anniversary|special edition)\b/i }
];

/**
 * Normalizes text for comparison (lowercasing, collapsing whitespace, removing standard noise)
 */
export function normalizeString(text: string): string {
    if (!text) return '';
    return text
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '') // strip diacritics
        .replace(/[’'"]/g, '')
        .replace(/&/g, 'and')
        .replace(/[^\w\s]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

/**
 * Strips common feature annotations for core title comparison
 */
export function cleanCoreTitle(title: string): string {
    if (!title) return '';
    return title
        .replace(/\(feat\..*?\)/gi, '')
        .replace(/\[feat\..*?\]/gi, '')
        .replace(/\(with.*?\)/gi, '')
        .replace(/\[with.*?\]/gi, '')
        .replace(/\(official.*?video.*?\)/gi, '')
        .replace(/\[official.*?video.*?\]/gi, '')
        .replace(/\(official.*?audio.*?\)/gi, '')
        .replace(/\[official.*?audio.*?\]/gi, '')
        .replace(/\(lyric.*?video.*?\)/gi, '')
        .replace(/\[lyric.*?video.*?\]/gi, '')
        .replace(/\(visualizer.*?\)/gi, '')
        .replace(/\[visualizer.*?\]/gi, '')
        .replace(/\s+/g, ' ')
        .trim();
}

/**
 * Detects special modifier tags in a title or album string
 */
export function getModifiers(text: string): Set<string> {
    const found = new Set<string>();
    for (const { key, regex } of MODIFIER_PATTERNS) {
        if (regex.test(text)) {
            found.add(key);
        }
    }
    return found;
}

/**
 * Checks whether version modifiers between source track and candidate match exactly.
 * For example, if source is not a remix, candidate must NOT be a remix.
 * If source is an acoustic version, candidate must also be an acoustic version.
 */
export function areModifiersCompatible(sourceText: string, candidateText: string): boolean {
    const sourceMods = getModifiers(sourceText);
    const candidateMods = getModifiers(candidateText);

    // If source has modifiers that candidate lacks, or candidate has modifiers that source lacks
    for (const mod of candidateMods) {
        // Allow deluxe/expanded if the source was standard, but strictly reject acoustic/remix/live/sped_up
        if (mod === 'deluxe') continue;
        if (!sourceMods.has(mod)) {
            return false;
        }
    }

    for (const mod of sourceMods) {
        if (mod === 'deluxe') continue;
        if (!candidateMods.has(mod)) {
            return false;
        }
    }

    return true;
}

/**
 * Verifies if durations match within tolerance
 */
export function areDurationsCompatible(dur1?: number, dur2?: number, toleranceMs = 7000): boolean {
    if (!dur1 || !dur2 || dur1 <= 0 || dur2 <= 0) {
        return true; // Not enough duration info to reject
    }
    return Math.abs(dur1 - dur2) <= toleranceMs;
}

/**
 * Validates whether the primary artist of track matches candidate artist
 */
export function areArtistsCompatible(artist1: string, artist2: string): boolean {
    const norm1 = normalizeString(artist1);
    const norm2 = normalizeString(artist2);
    if (!norm1 || !norm2) return false;

    if (norm1 === norm2) return true;

    // Check primary artist (before comma, &, 'feat', 'and')
    const primary1 = norm1.split(/\b(and|feat|featuring)\b|,|\//)[0].trim();
    const primary2 = norm2.split(/\b(and|feat|featuring)\b|,|\//)[0].trim();

    if (primary1 && primary2 && (primary1.includes(primary2) || primary2.includes(primary1))) {
        return true;
    }

    return false;
}

/**
 * Evaluates full match reliability between source track and candidate.
 * Returns true only if match is confident.
 */
export function isReliableTrackMatch(
    source: ArtworkTrackInfo,
    candidate: { title: string; artist: string; album?: string; duration?: number }
): boolean {
    if (!source.title || !candidate.title || !source.artist || !candidate.artist) {
        return false;
    }

    // 1. Version modifier compatibility (reject remix/acoustic/live mismatches)
    const sourceFull = `${source.title} ${source.album || ''}`;
    const candidateFull = `${candidate.title} ${candidate.album || ''}`;
    if (!areModifiersCompatible(sourceFull, candidateFull)) {
        console.log(`[MetadataMatcher] Rejected due to modifier mismatch: "${sourceFull}" vs "${candidateFull}"`);
        return false;
    }

    // 2. Artist compatibility
    if (!areArtistsCompatible(source.artist, candidate.artist)) {
        console.log(`[MetadataMatcher] Rejected due to artist mismatch: "${source.artist}" vs "${candidate.artist}"`);
        return false;
    }

    // 3. Duration check
    if (!areDurationsCompatible(source.duration, candidate.duration)) {
        console.log(`[MetadataMatcher] Rejected due to duration mismatch: ${source.duration}ms vs ${candidate.duration}ms`);
        return false;
    }

    // 4. Core title similarity
    const cleanSourceTitle = normalizeString(cleanCoreTitle(source.title));
    const cleanCandidateTitle = normalizeString(cleanCoreTitle(candidate.title));

    if (cleanSourceTitle === cleanCandidateTitle) {
        return true;
    }

    // Check if one contains the other as full phrase
    if (cleanSourceTitle.includes(cleanCandidateTitle) || cleanCandidateTitle.includes(cleanSourceTitle)) {
        // Disallow matching if the length difference is drastic (e.g. "Run" vs "Run this town")
        const lenDiff = Math.abs(cleanSourceTitle.length - cleanCandidateTitle.length);
        if (lenDiff <= 8) {
            return true;
        }
    }

    // If album was provided and matches, increase confidence
    if (source.album && candidate.album) {
        const cleanSourceAlbum = normalizeString(source.album);
        const cleanCandidateAlbum = normalizeString(candidate.album);
        if (cleanSourceAlbum && cleanCandidateAlbum && (cleanSourceAlbum === cleanCandidateAlbum || cleanSourceAlbum.includes(cleanCandidateAlbum))) {
            return true;
        }
    }

    return false;
}
