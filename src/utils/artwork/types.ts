export type PlaybackProvider = 'spotify' | 'apple' | 'youtube' | null;

export type ArtworkSource = 'spotify' | 'apple_music' | null;

export interface AnimatedArtworkData {
    available: boolean;
    source: ArtworkSource;
    videoUrl: string | null;
    videoTallUrl?: string | null;
    previewUrl: string | null;
    artworkId: string | null;
}

export interface ArtworkTrackInfo {
    id?: string | null;
    title: string;
    artist: string;
    album?: string;
    duration?: number;
    coverArt?: string;
    isrc?: string | null;
    source: PlaybackProvider;
    canvasUrl?: string | null;
    videoId?: string | null;
}
