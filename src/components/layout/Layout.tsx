import { useState } from 'react';
import { useAppStore } from '../../store/useAppStore';
import { Header } from '../player/Header';
import { WindowControls } from '../player/WindowControls';
import { HudToast } from '../player/HudToast';
import { ResizeHandles } from './ResizeHandles';
import { LyricsContextMenu } from '../lyrics/LyricsContextMenu';
import { AnimatedBackground } from '../animated/AnimatedBackground';

interface LayoutProps {
    children: React.ReactNode;
    isAnimatedArtworkActive?: boolean;
}

export const Layout: React.FC<LayoutProps> = ({ children, isAnimatedArtworkActive }) => {
    const songTitle = useAppStore((s) => s.currentSong.title);
    const songArtist = useAppStore((s) => s.currentSong.artist);
    const coverArt = useAppStore((s) => s.currentSong.coverArt);
    const isPlaying = useAppStore((s) => s.currentSong.isPlaying);
    const animatedArtwork = useAppStore((s) => s.currentSong.animatedArtwork);
    const lyrics = useAppStore((s) => s.lyrics);
    const artworkPreference = useAppStore((s) => s.artworkPreference);
    const manualArtworkOverride = useAppStore((s) => s.manualArtworkOverride);
    const setAnimatedArtwork = useAppStore((s) => s.setAnimatedArtwork);

    const [contextMenu, setContextMenu] = useState<{ x: number; y: number } | null>(null);

    const hasAnimatedArtwork = Boolean(
        animatedArtwork?.available && animatedArtwork?.videoUrl
    );
    const currentTrackKey = `${songTitle}::${songArtist}`;
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

    const isAnimated = isAnimatedArtworkActive !== undefined ? isAnimatedArtworkActive : computedAnimatedMode;
    const videoSrc = animatedArtwork?.videoTallUrl || animatedArtwork?.videoUrl;

    const handleVideoError = () => {
        console.warn('[Layout] Video playback failed, reverting to normal lyrics UI');
        setAnimatedArtwork({
            available: false,
            videoUrl: null,
            videoTallUrl: null,
            source: null
        });
    };

    const handleContextMenu = (e: React.MouseEvent) => {
        // Do not intercept if clicked on input
        if (['INPUT', 'TEXTAREA'].includes((e.target as HTMLElement)?.tagName)) return;
        e.preventDefault();
        setContextMenu({ x: e.clientX, y: e.clientY });
    };

    return (
        <div
            className={`app-container mini-player glass-panel ${isAnimated ? 'animated-artwork-mode-container' : ''}`}
            onContextMenu={handleContextMenu}
        >
            {/* Background Layer: Animated video when active, or dynamic ambient album art */}
            <div
                className="background-layer-root"
                style={{
                    position: 'absolute',
                    top: 0,
                    left: 0,
                    right: 0,
                    bottom: 0,
                    width: '100%',
                    height: '100%',
                    zIndex: 1,
                    overflow: 'hidden',
                    pointerEvents: 'none'
                }}
            >
                {/* Dynamic ambient album art for normal mode */}
                {coverArt && (
                    <div
                        className="dynamic-bg"
                        style={{
                            backgroundImage: `url(${coverArt})`,
                            opacity: (isAnimated && videoSrc) ? 0 : 1,
                            transition: 'opacity 0.6s cubic-bezier(0.16, 1, 0.3, 1)'
                        }}
                    />
                )}

                {/* Animated video background with immediate mount & visibility */}
                {isAnimated && videoSrc && (
                    <div
                        style={{
                            position: 'absolute',
                            top: 0,
                            left: 0,
                            right: 0,
                            bottom: 0,
                            width: '100%',
                            height: '100%',
                            zIndex: 2,
                            overflow: 'hidden',
                            pointerEvents: 'none'
                        }}
                    >
                        <AnimatedBackground
                            videoUrl={videoSrc}
                            poster={coverArt}
                            isPlaying={isPlaying}
                            onError={handleVideoError}
                        />
                    </div>
                )}
            </div>

            {/* Ambient vignette and specular sheen for static album art; hidden for pristine video clarity */}
            {!isAnimated && <div className="ambient-overlay" aria-hidden="true" />}

            {/* macOS Titlebar Chrome (Restored to 40px Height) */}
            <WindowControls isAnimatedArtworkActive={isAnimated} />

            {/* Functional Main Layer */}
            <div className={`main-content-layer ${isAnimated ? 'animated-layout' : ''}`}>
                <main className="scrollable-content-section" role="region" aria-label="Lyrics Display">
                    {children}
                </main>

                {/* Bottom Player Component (Song Metadata & Music Controls) */}
                <div className="bottom-player-section">
                    <Header />
                </div>
            </div>

            {/* Context Menu for right click anywhere across the entire application */}
            {contextMenu && (
                <LyricsContextMenu
                    x={contextMenu.x}
                    y={contextMenu.y}
                    hasWordSync={lyrics?.syncType === 'SYLLABLE'}
                    isAnimatedArtworkActive={isAnimated}
                    onClose={() => setContextMenu(null)}
                />
            )}

            {/* macOS HUD Toast */}
            <HudToast />

            <ResizeHandles />
        </div>
    );
};

