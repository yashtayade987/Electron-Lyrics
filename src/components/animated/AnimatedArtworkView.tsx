import React, { useState } from 'react';
import { useAppStore } from '../../store/useAppStore';
import { AnimatedArtworkBackground } from './AnimatedArtworkBackground';
import { Header } from '../player/Header';
import { WindowControls } from '../player/WindowControls';
import { HudToast } from '../player/HudToast';
import { ResizeHandles } from '../layout/ResizeHandles';
import { LyricsContextMenu } from '../lyrics/LyricsContextMenu';
import { LyricsContainer } from '../lyrics/LyricsContainer';

export const AnimatedArtworkView: React.FC = () => {
    const { currentSong, setAnimatedArtwork } = useAppStore();
    const artwork = currentSong.animatedArtwork;
    const [contextMenu, setContextMenu] = useState<{ x: number; y: number } | null>(null);

    const handleVideoError = () => {
        console.warn('[AnimatedArtworkView] Video playback failed, reverting to normal lyrics UI');
        setAnimatedArtwork({
            available: false,
            videoUrl: null,
            videoTallUrl: null,
            source: null
        });
    };

    const handleContextMenu = (e: React.MouseEvent) => {
        if (['INPUT', 'TEXTAREA'].includes((e.target as HTMLElement)?.tagName)) return;
        e.preventDefault();
        setContextMenu({ x: e.clientX, y: e.clientY });
    };

    if (!artwork || !artwork.available || !artwork.videoUrl) {
        return null;
    }

    const videoSrc = artwork.videoTallUrl || artwork.videoUrl;

    return (
        <div
            className="app-container mini-player glass-panel animated-artwork-mode-container"
            role="main"
            aria-label="Animated Artwork Mode"
            onContextMenu={handleContextMenu}
        >
            {/* Fullscreen Looping Video Background */}
            <AnimatedArtworkBackground
                videoUrl={videoSrc}
                poster={currentSong.coverArt}
                isPlaying={currentSong.isPlaying}
                onError={handleVideoError}
            />

            {/* Ambient vignette and specular sheen */}
            <div className="ambient-overlay" aria-hidden="true" />

            {/* macOS Window Titlebar Chrome & Drag Region */}
            <WindowControls />

            {/* Functional Main Layer - identical to image music player */}
            <div className="main-content-layer">
                {/* Scrollable Lyrics Content */}
                <main className="scrollable-content-section" role="region" aria-label="Lyrics Display">
                    <LyricsContainer />
                </main>

                {/* Bottom Player Component (Song Metadata & Music Controls) */}
                <div className="bottom-player-section">
                    <Header />
                </div>
            </div>

            {/* Right-click Context Menu */}
            {contextMenu && (
                <LyricsContextMenu
                    x={contextMenu.x}
                    y={contextMenu.y}
                    isAnimatedArtworkActive={true}
                    onClose={() => setContextMenu(null)}
                />
            )}

            {/* Native HUD Toast */}
            <HudToast />

            {/* Window Resizing Handles */}
            <ResizeHandles />
        </div>
    );
};

