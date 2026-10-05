import React, { useLayoutEffect, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { useAppStore } from '../../store/useAppStore';
import { artworkResolver } from '../../utils/artwork/ArtworkResolver';
import type { ArtworkTrackInfo } from '../../utils/artwork/types';
import { Type, AlignLeft, Check, Film, Image, Languages } from 'lucide-react';

interface LyricsContextMenuProps {
    x: number;
    y: number;
    hasWordSync?: boolean;
    isAnimatedArtworkActive?: boolean;
    onClose: () => void;
}

const AppleMusicIcon: React.FC<{ size?: number }> = ({ size = 12 }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor">
        <path d="M12 3v10.55c-.59-.34-1.27-.55-2-.55-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4V7h4V3h-6z" />
    </svg>
);

const SpotifyIcon: React.FC<{ size?: number }> = ({ size = 12 }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor">
        <path d="M12 2C6.477 2 2 6.477 2 12s4.477 10 10 10 10-4.477 10-10S17.523 2 12 2zm4.586 14.424c-.18.295-.563.387-.857.208-2.35-1.436-5.308-1.76-8.793-.963-.336.077-.67-.134-.746-.47-.077-.336.134-.67.47-.747 3.808-.87 7.076-.502 9.718 1.115.294.18.387.563.208.857zm1.225-2.724c-.226.368-.71.482-1.077.256-2.69-1.654-6.79-2.133-9.97-1.168-.413.125-.85-.107-.975-.52-.125-.413.107-.85.52-.975 3.633-1.102 8.147-.568 11.246 1.33.368.226.482.71.256 1.077zm.105-2.835C14.692 8.95 9.375 8.775 6.297 9.71c-.494.15-1.018-.128-1.168-.622-.15-.494.128-1.018.622-1.168 3.532-1.072 9.404-.866 13.115 1.338.445.264.59.838.327 1.282-.264.444-.838.59-1.282.327z" />
    </svg>
);

export const LyricsContextMenu: React.FC<LyricsContextMenuProps> = ({
    x,
    y,
    hasWordSync,
    isAnimatedArtworkActive = false,
    onClose
}) => {
    const {
        lyricMode,
        setLyricMode,
        currentSong,
        artworkPreference,
        manualArtworkOverride,
        setManualArtworkOverride,
        setAnimatedArtwork,
        isRomanized,
        toggleRomanized,
        showHud
    } = useAppStore();

    const menuRef = useRef<HTMLDivElement>(null);
    const hasAnimatedArtwork = Boolean(
        currentSong.animatedArtwork?.available && currentSong.animatedArtwork?.videoUrl
    );
    const currentTrackKey = `${currentSong.title}::${currentSong.artist}`;
    const override = manualArtworkOverride?.trackKey === currentTrackKey
        ? manualArtworkOverride.override
        : null;

    let computedAnimatedMode = false;
    if (artworkPreference === 'always_normal') {
        computedAnimatedMode = false;
    } else if (override === 'normal') {
        computedAnimatedMode = false;
    } else if (override === 'animated') {
        computedAnimatedMode = hasAnimatedArtwork;
    } else {
        computedAnimatedMode = hasAnimatedArtwork;
    }

    const isCurrentActive = isAnimatedArtworkActive !== undefined ? isAnimatedArtworkActive : computedAnimatedMode;
    const currentArtworkSource = currentSong.animatedArtwork?.source;

    // Handle switching artwork source between Apple Music and Spotify
    const handleSwitchArtworkSource = async (targetSource: 'apple_music' | 'spotify', e: React.MouseEvent) => {
        e.stopPropagation();
        if (currentArtworkSource === targetSource && isCurrentActive) {
            showHud(`${targetSource === 'apple_music' ? 'Apple Music' : 'Spotify'} already active`);
            return;
        }

        showHud(`Switching to ${targetSource === 'apple_music' ? 'Apple Music' : 'Spotify'}...`);

        const trackInfo: ArtworkTrackInfo = {
            id: currentSong.id,
            title: currentSong.title,
            artist: currentSong.artist,
            album: currentSong.album,
            duration: currentSong.duration,
            coverArt: currentSong.coverArt,
            source: currentSong.source,
            canvasUrl: currentSong.canvasUrl,
            videoId: currentSong.videoId
        };

        try {
            const result = await artworkResolver.resolveSpecificSource(trackInfo, targetSource);
            if (result && result.available && result.videoUrl) {
                setAnimatedArtwork(result);
                setManualArtworkOverride(currentTrackKey, 'animated');
                showHud(`Artwork: ${targetSource === 'apple_music' ? 'Apple Music' : 'Spotify'}`);
                onClose();
            } else {
                showHud(`${targetSource === 'apple_music' ? 'Apple Music' : 'Spotify'} artwork unavailable for this track`);
            }
        } catch {
            showHud(`Could not load ${targetSource === 'apple_music' ? 'Apple Music' : 'Spotify'} artwork`);
        }
    };

    // Close on Escape key
    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.key === 'Escape') {
                onClose();
            }
        };
        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [onClose]);

    useLayoutEffect(() => {
        const handleClickOutside = (e: MouseEvent) => {
            if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
                onClose();
            }
        };
        window.addEventListener('pointerdown', handleClickOutside, true);
        return () => window.removeEventListener('pointerdown', handleClickOutside, true);
    }, [onClose]);

    useLayoutEffect(() => {
        if (!menuRef.current) return;
        const rect = menuRef.current.getBoundingClientRect();
        let finalX = x;
        let finalY = y;
        if (x + rect.width > window.innerWidth) finalX = window.innerWidth - rect.width - 12;
        if (y + rect.height > window.innerHeight) finalY = window.innerHeight - rect.height - 12;
        if (finalX < 12) finalX = 12;
        if (finalY < 12) finalY = 12;

        menuRef.current.style.left = `${finalX}px`;
        menuRef.current.style.top = `${finalY}px`;
        menuRef.current.style.opacity = '1';
        menuRef.current.style.transform = 'scale(1)';
    }, [x, y]);

    const handlePropagation = (e: React.PointerEvent) => e.stopPropagation();

    return createPortal(
        <div
            ref={menuRef}
            className="apple-context-menu"
            role="menu"
            aria-label="Display Options"
            onPointerDown={handlePropagation}
        >
            {/* Animated Artwork Toggle Section */}
            <div className="context-menu-header" role="presentation">
                Artwork Presentation
            </div>

            <button
                type="button"
                role="menuitemradio"
                aria-checked={isCurrentActive}
                disabled={!hasAnimatedArtwork}
                className={`context-menu-item ${isCurrentActive ? 'selected' : ''} ${!hasAnimatedArtwork ? 'disabled' : ''}`}
                style={!hasAnimatedArtwork ? { opacity: 0.5, cursor: 'not-allowed' } : undefined}
                onClick={() => {
                    if (!hasAnimatedArtwork) return;
                    setManualArtworkOverride(currentTrackKey, 'animated');
                    showHud('Animated Artwork');
                    onClose();
                }}
            >
                <Film size={15} className="menu-item-icon" />
                <span className="menu-item-label">
                    Use Animated Artwork
                    {!hasAnimatedArtwork && (
                        <span style={{ opacity: 0.65, fontSize: '0.82em', marginLeft: '6px' }}>
                            (Unavailable)
                        </span>
                    )}
                </span>
                {isCurrentActive && <Check size={14} className="menu-item-check" />}
            </button>

            {/* Small Apple Music and Spotify source buttons below Use Animated Artwork */}
            {hasAnimatedArtwork && (
                <div
                    className="artwork-source-container"
                    style={{
                        display: 'flex',
                        gap: '6px',
                        padding: '3px 10px 6px 30px',
                    }}
                >
                    <button
                        type="button"
                        className={`source-chip ${currentArtworkSource === 'apple_music' ? 'selected' : ''}`}
                        title="Switch to Apple Music animated artwork"
                        onClick={(e) => handleSwitchArtworkSource('apple_music', e)}
                        style={{
                            flex: 1,
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            gap: '5px',
                            padding: '4px 6px',
                            fontSize: '0.72rem',
                            fontWeight: currentArtworkSource === 'apple_music' ? 600 : 400,
                            borderRadius: '6px',
                            border: currentArtworkSource === 'apple_music'
                                ? '1px solid rgba(250, 45, 72, 0.7)'
                                : '1px solid rgba(255, 255, 255, 0.1)',
                            background: currentArtworkSource === 'apple_music'
                                ? 'rgba(250, 45, 72, 0.2)'
                                : 'rgba(255, 255, 255, 0.05)',
                            color: currentArtworkSource === 'apple_music'
                                ? '#fa2d48'
                                : 'var(--label-secondary, rgba(255, 255, 255, 0.65))',
                            cursor: 'pointer',
                            transition: 'all 0.15s ease',
                        }}
                    >
                        <AppleMusicIcon size={12} />
                        <span>Apple Music</span>
                        {currentArtworkSource === 'apple_music' && <Check size={11} style={{ marginLeft: '2px' }} />}
                    </button>

                    <button
                        type="button"
                        className={`source-chip ${currentArtworkSource === 'spotify' ? 'selected' : ''}`}
                        title="Switch to Spotify Canvas"
                        onClick={(e) => handleSwitchArtworkSource('spotify', e)}
                        style={{
                            flex: 1,
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            gap: '5px',
                            padding: '4px 6px',
                            fontSize: '0.72rem',
                            fontWeight: currentArtworkSource === 'spotify' ? 600 : 400,
                            borderRadius: '6px',
                            border: currentArtworkSource === 'spotify'
                                ? '1px solid rgba(30, 215, 96, 0.7)'
                                : '1px solid rgba(255, 255, 255, 0.1)',
                            background: currentArtworkSource === 'spotify'
                                ? 'rgba(30, 215, 96, 0.2)'
                                : 'rgba(255, 255, 255, 0.05)',
                            color: currentArtworkSource === 'spotify'
                                ? '#1ed760'
                                : 'var(--label-secondary, rgba(255, 255, 255, 0.65))',
                            cursor: 'pointer',
                            transition: 'all 0.15s ease',
                        }}
                    >
                        <SpotifyIcon size={12} />
                        <span>Spotify</span>
                        {currentArtworkSource === 'spotify' && <Check size={11} style={{ marginLeft: '2px' }} />}
                    </button>
                </div>
            )}

            <button
                type="button"
                role="menuitemradio"
                aria-checked={!isCurrentActive}
                className={`context-menu-item ${!isCurrentActive ? 'selected' : ''}`}
                onClick={() => {
                    setManualArtworkOverride(currentTrackKey, 'normal');
                    showHud('Normal Artwork');
                    onClose();
                }}
            >
                <Image size={15} className="menu-item-icon" />
                <span className="menu-item-label">Use Normal Artwork</span>
                {!isCurrentActive && <Check size={14} className="menu-item-check" />}
            </button>

            {/* Lyrics Presentation Section */}
            <div className="context-menu-divider" role="separator" />

            <div className="context-menu-header" role="presentation">
                Lyrics Presentation
            </div>

            <button
                type="button"
                role="menuitemradio"
                aria-checked={lyricMode === 'line'}
                className={`context-menu-item ${lyricMode === 'line' ? 'selected' : ''}`}
                onClick={() => { setLyricMode('line'); showHud('Lyrics: Line by Line'); onClose(); }}
            >
                <AlignLeft size={15} className="menu-item-icon" />
                <span className="menu-item-label">Line by Line</span>
                {lyricMode === 'line' && <Check size={14} className="menu-item-check" />}
            </button>

            <button
                type="button"
                role="menuitemradio"
                aria-checked={lyricMode === 'word' || lyricMode === 'auto'}
                className={`context-menu-item ${(lyricMode === 'word' || lyricMode === 'auto') ? 'selected' : ''}`}
                onClick={() => { setLyricMode('word'); showHud('Lyrics: Word Synced'); onClose(); }}
            >
                <Type size={15} className="menu-item-icon" />
                <span className="menu-item-label">
                    Word Synced
                    {hasWordSync === false && <span style={{ opacity: 0.55, fontSize: '0.82em', marginLeft: '6px' }}>(API has line sync)</span>}
                </span>
                {(lyricMode === 'word' || lyricMode === 'auto') && <Check size={14} className="menu-item-check" />}
            </button>

            {/* Display Options */}
            <div className="context-menu-divider" role="separator" />

            <div className="context-menu-header" role="presentation">
                Display Options
            </div>

            <button
                type="button"
                role="menuitemcheckbox"
                aria-checked={isRomanized}
                className={`context-menu-item ${isRomanized ? 'selected' : ''}`}
                onClick={() => {
                    toggleRomanized();
                    showHud(!isRomanized ? 'Romanized Lyrics: On' : 'Romanized Lyrics: Off');
                    onClose();
                }}
            >
                <Languages size={15} className="menu-item-icon" />
                <span className="menu-item-label">Romanized Lyrics</span>
                {isRomanized && <Check size={14} className="menu-item-check" />}
            </button>

        </div>,
        document.body
    );
};
