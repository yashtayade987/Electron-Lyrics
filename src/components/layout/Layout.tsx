import { useState } from 'react';
import { useAppStore } from '../../store/useAppStore';
import { motion, AnimatePresence } from 'framer-motion';
import { Header } from '../player/Header';
import { WindowControls } from '../player/WindowControls';
import { HudToast } from '../player/HudToast';
import { ResizeHandles } from './ResizeHandles';
import { LyricsContextMenu } from '../lyrics/LyricsContextMenu';
import { AnimatedArtworkBackground } from '../animated/AnimatedArtworkBackground';
import { AnimatedArtworkLyrics } from '../animated/AnimatedArtworkLyrics';

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
            <AnimatePresence mode="wait">
                {isAnimated && videoSrc ? (
                    <motion.div
                        key={`video-${videoSrc}`}
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
                        style={{ position: 'absolute', inset: 0, zIndex: 1, overflow: 'hidden' }}
                    >
                        <AnimatedArtworkBackground
                            videoUrl={videoSrc}
                            poster={coverArt}
                            isPlaying={isPlaying}
                            onError={handleVideoError}
                        />
                    </motion.div>
                ) : coverArt ? (
                    <motion.div
                        key={`art-${coverArt}`}
                        initial={{ opacity: 0, scale: 1.05 }}
                        animate={{ opacity: 1, scale: 1 }}
                        exit={{ opacity: 0, scale: 1.05 }}
                        transition={{ duration: 0.8, ease: [0.16, 1, 0.3, 1] }}
                        className="dynamic-bg"
                        style={{ backgroundImage: `url(${coverArt})` }}
                    />
                ) : null}
            </AnimatePresence>

            {/* Ambient vignette and specular sheen */}
            <div className="ambient-overlay" aria-hidden="true" />

            {/* macOS Titlebar Chrome (Restored to 40px Height) */}
            <WindowControls />

            {/* Functional Main Layer */}
            <div className={`main-content-layer ${isAnimated ? 'animated-layout' : ''}`}>
                {/* When animated artwork is active, only show the current line above the song metadata and controls */}
                {isAnimated ? (
                    <div className="animated-current-line-container" role="region" aria-label="Current Lyric">
                        <AnimatedArtworkLyrics />
                    </div>
                ) : (
                    <main className="scrollable-content-section" role="region" aria-label="Lyrics Display">
                        {children}
                    </main>
                )}

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
                    hasWordSync={Boolean(
                        lyrics?.lines?.some((l) => (l.syllables && l.syllables.length > 0) || l.isSyllable)
                    )}
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

