import { useAppStore } from '../../store/useAppStore';
import { useState, useRef, useEffect, useCallback } from 'react';

// Exact SVG playback icons matching user's reference image (soft rounded corners, solid fill)
const RewindIcon = ({ size = 20 }: { size?: number }) => (
    <svg
        width={size}
        height={size}
        viewBox="0 0 24 24"
        fill="currentColor"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinejoin="round"
        strokeLinecap="round"
    >
        <polygon points="11 19 2 12 11 5" />
        <polygon points="21 19 12 12 21 5" />
    </svg>
);

const FastForwardIcon = ({ size = 20 }: { size?: number }) => (
    <svg
        width={size}
        height={size}
        viewBox="0 0 24 24"
        fill="currentColor"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinejoin="round"
        strokeLinecap="round"
    >
        <polygon points="12 19 21 12 12 5" />
        <polygon points="3 19 12 12 3 5" />
    </svg>
);

const PlayIcon = ({ size = 23 }: { size?: number }) => (
    <svg
        width={size}
        height={size}
        viewBox="0 0 24 24"
        fill="currentColor"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinejoin="round"
        strokeLinecap="round"
    >
        <polygon points="7 4 19 12 7 20" />
    </svg>
);

const PauseIcon = ({ size = 22 }: { size?: number }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor">
        <rect x="6" y="4" width="4.5" height="16" rx="2" />
        <rect x="13.5" y="4" width="4.5" height="16" rx="2" />
    </svg>
);

export const Header = () => {
    const { currentSong, setManualPlayPause, showHud } = useAppStore();
    const [shouldScroll, setShouldScroll] = useState(false);
    const titleContainerRef = useRef<HTMLDivElement>(null);
    const titleTextRef = useRef<HTMLSpanElement>(null);
    const lastCommandRef = useRef<{ name: string; time: number }>({ name: '', time: 0 });

    const handleMusicCommand = (command: string) => {
        const now = Date.now();
        if (lastCommandRef.current.name === command && now - lastCommandRef.current.time < 150) {
            console.log(`[Header] Debounced rapid music command: ${command}`);
            return;
        }
        lastCommandRef.current = { name: command, time: now };

        console.log(`[Header] Music command: ${command}`);

        if (command === 'play-pause') {
            if (!currentSong.title || currentSong.title === 'No song playing') {
                showHud('No song playing');
            } else {
                const nextPlaying = !currentSong.isPlaying;
                setManualPlayPause(nextPlaying);
                showHud(nextPlaying ? 'Playing' : 'Paused');
            }
        } else if (command === 'next') {
            if (!currentSong.title || currentSong.title === 'No song playing') {
                showHud('No song playing');
            } else {
                showHud('Next Track');
                useAppStore.getState().updateProgress(0);
            }
        } else if (command === 'previous') {
            if (!currentSong.title || currentSong.title === 'No song playing') {
                showHud('No song playing');
            } else {
                showHud('Previous Track');
                useAppStore.getState().updateProgress(0);
            }
        }

        window.electron?.musicCommand(command);
        window.dispatchEvent(new CustomEvent('app:music-command', { detail: command }));
    };

    const checkOverflow = useCallback(() => {
        const container = titleContainerRef.current;
        const text = titleTextRef.current;
        if (container && text) {
            const isOverflowing = text.scrollWidth > container.clientWidth;
            setShouldScroll(isOverflowing);
        }
    }, []);

    // Check overflow on mount, song change, and window resize
    useEffect(() => {
        checkOverflow();

        const observer = new ResizeObserver(() => {
            checkOverflow();
        });

        if (titleContainerRef.current) {
            observer.observe(titleContainerRef.current);
        }

        return () => observer.disconnect();
    }, [currentSong.title, checkOverflow]);

    return (
        <div className="player-header apple-music-header">
            {/* Left: Album Artwork Squircle + Title & Artist */}
            <div className="header-main-content">
                <div className="album-art-container">
                    {currentSong.coverArt ? (
                        <img
                            src={currentSong.coverArt}
                            alt={`${currentSong.title} album cover`}
                            className="album-art"
                        />
                    ) : (
                        <div className="album-placeholder" aria-label="No album artwork" />
                    )}
                </div>
                <div className="song-meta">
                    <div className="song-title-container" ref={titleContainerRef}>
                        <h1 className={`song-title ${shouldScroll ? 'scrolling' : ''}`} title={currentSong.title || "Not Playing"}>
                            <span ref={titleTextRef} className="song-title-text">
                                {currentSong.title || "Not Playing"}
                            </span>
                            {shouldScroll && (
                                <span className="song-title-text song-title-copy" aria-hidden="true">
                                    {currentSong.title || "Not Playing"}
                                </span>
                            )}
                        </h1>
                        {Boolean(currentSong.isExplicit) && (
                            <span className="explicit-tag" title="Explicit">E</span>
                        )}
                    </div>
                    <p className="song-artist" title={currentSong.artist ? `${currentSong.artist}${currentSong.album ? ` — ${currentSong.album}` : ''}` : "Unknown Artist"}>
                        {currentSong.artist || "Waiting for music..."}
                        {currentSong.album ? ` • ${currentSong.album}` : ''}
                    </p>
                </div>
            </div>

            {/* Right: Placed exactly where star and 3 dots were in Apple Music */}
            <div className="header-controls-column">
                <div
                    className="apple-music-controls-group"
                    role="group"
                    aria-label="Playback controls"
                    onPointerDown={(e) => e.stopPropagation()}
                >
                    <button
                        className="apple-media-btn"
                        title="Previous Track (⌘←)"
                        aria-label="Previous Track (⌘←)"
                        aria-keyshortcuts="Meta+ArrowLeft Control+ArrowLeft"
                        onClick={() => handleMusicCommand('previous')}
                        onPointerDown={(e) => e.stopPropagation()}
                    >
                        <RewindIcon size={20} />
                    </button>
                    <button
                        className="apple-media-btn play-pause-btn"
                        title={currentSong.isPlaying ? "Pause (Space)" : "Play (Space)"}
                        aria-label={currentSong.isPlaying ? "Pause (Space)" : "Play (Space)"}
                        aria-keyshortcuts="Space"
                        onClick={() => handleMusicCommand('play-pause')}
                        onPointerDown={(e) => e.stopPropagation()}
                    >
                        {currentSong.isPlaying ? <PauseIcon size={22} /> : <PlayIcon size={23} />}
                    </button>
                    <button
                        className="apple-media-btn"
                        title="Next Track (⌘→)"
                        aria-label="Next Track (⌘→)"
                        aria-keyshortcuts="Meta+ArrowRight Control+ArrowRight"
                        onClick={() => handleMusicCommand('next')}
                        onPointerDown={(e) => e.stopPropagation()}
                    >
                        <FastForwardIcon size={20} />
                    </button>
                </div>
            </div>
        </div>
    );
};
