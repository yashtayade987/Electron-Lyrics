import React, { useEffect, useRef, useState, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useAppStore } from '../../store/useAppStore';
import { LyricLineRenderer } from './LyricLineRenderer';
import { LyricsContextMenu } from './LyricsContextMenu';
import type { LyricLine } from '../../utils/lyricsProvider';

function findActiveLineIndex(lines: LyricLine[], timeMs: number): number {
    if (!lines || lines.length === 0) return -1;
    if (timeMs < lines[0].startTimeMs) {
        return lines[0].isInstrumental ? 0 : -1;
    }
    let low = 0;
    let high = lines.length - 1;
    let result = -1;
    while (low <= high) {
        const mid = (low + high) >> 1;
        if (lines[mid].startTimeMs <= timeMs) {
            result = mid;
            low = mid + 1;
        } else {
            high = mid - 1;
        }
    }
    return result;
}

function settleLine(lineEl: HTMLElement | null, isPassed: boolean) {
    if (!lineEl) return;
    if (isPassed) {
        lineEl.querySelectorAll<HTMLElement>('.word').forEach((w) => {
            w.classList.add('passed-word');
            w.classList.remove('active-word');
            w.style.setProperty('--gradient-position', '100%');
            w.style.setProperty('--progress', '1');
        });
    } else {
        lineEl.querySelectorAll<HTMLElement>('.word').forEach((w) => {
            w.classList.remove('active-word', 'passed-word');
            w.style.setProperty('--gradient-position', '-25%');
            w.style.setProperty('--progress', '0');
        });
    }
}

function applyWordStyles(activeLineEl: HTMLElement | null, currentTimeMs: number) {
    if (!activeLineEl) return;

    // Instrumental break
    if (activeLineEl.classList.contains('instrumental')) {
        const dots = activeLineEl.querySelectorAll<HTMLElement>('.instrumental-dot');
        dots.forEach((dotEl) => {
            const dStart = parseInt(dotEl.getAttribute('data-start') || '0', 10);
            const dEnd = parseInt(dotEl.getAttribute('data-end') || '0', 10);
            if (currentTimeMs >= dEnd) {
                dotEl.classList.add('dot-active', 'dot-passed');
            } else if (currentTimeMs >= dStart) {
                dotEl.classList.add('dot-active');
                dotEl.classList.remove('dot-passed');
            } else {
                dotEl.classList.remove('dot-active', 'dot-passed');
            }
        });
        return;
    }

    // Words / syllables directly timed from API
    const wordEls = activeLineEl.querySelectorAll<HTMLElement>('.word');
    wordEls.forEach((wordEl) => {
        const wStartStr = wordEl.getAttribute('data-start');
        const wEndStr = wordEl.getAttribute('data-end');

        if (wStartStr && wEndStr) {
            const wStart = parseInt(wStartStr, 10);
            const wEnd = parseInt(wEndStr, 10);
            const duration = wEnd - wStart;

            if (currentTimeMs >= wEnd) {
                wordEl.classList.add('passed-word');
                wordEl.classList.remove('active-word');
                wordEl.style.setProperty('--gradient-position', '100%');
                wordEl.style.setProperty('--progress', '1');
            } else if (currentTimeMs >= wStart) {
                wordEl.classList.add('active-word');
                wordEl.classList.remove('passed-word');
                const progress = duration > 0 ? Math.max(0, Math.min(1, (currentTimeMs - wStart) / duration)) : 1;
                const gradientPos = progress * 100;
                wordEl.style.setProperty('--gradient-position', `${gradientPos}%`);
                wordEl.style.setProperty('--progress', progress.toString());
            } else {
                wordEl.classList.remove('active-word', 'passed-word');
                wordEl.style.setProperty('--gradient-position', '-25%');
                wordEl.style.setProperty('--progress', '0');
            }
        } else {
            wordEl.style.setProperty('--gradient-position', '100%');
            wordEl.style.setProperty('--progress', '1');
        }
    });
}

interface LyricsContainerProps {
    isAnimatedMode?: boolean;
}

export const LyricsContainer: React.FC<LyricsContainerProps> = ({ isAnimatedMode }) => {
    const songTitle = useAppStore((s) => s.currentSong.title);
    const songArtist = useAppStore((s) => s.currentSong.artist);
    const isPlaying = useAppStore((s) => s.currentSong.isPlaying);
    const isRomanized = useAppStore((s) => s.isRomanized);
    const lyrics = useAppStore((s) => s.lyrics);
    const lyricsLoading = useAppStore((s) => s.lyricsLoading);
    const syncOffsetMs = useAppStore((s) => s.syncOffsetMs);
    const lyricMode = useAppStore((s) => s.lyricMode);
    const animatedArtwork = useAppStore((s) => s.currentSong.animatedArtwork);
    const artworkPreference = useAppStore((s) => s.artworkPreference);
    const manualArtworkOverride = useAppStore((s) => s.manualArtworkOverride);

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

    const activeAnimated = isAnimatedMode !== undefined ? isAnimatedMode : computedAnimatedMode;
    const isWordMode = lyrics?.syncType === 'SYLLABLE' && lyricMode !== 'line';

    const containerRef = useRef<HTMLDivElement>(null);
    const lineRefs = useRef<(HTMLDivElement | null)[]>([]);
    const [contextMenu, setContextMenu] = useState<{ x: number; y: number } | null>(null);
    const [activeLineIndex, setActiveLineIndex] = useState<number>(-1);

    const activeLineRef = useRef(-1);
    const isUserScrollingRef = useRef(false);
    const userScrollTimeoutRef = useRef<number | null>(null);

    const lastProgressRef = useRef(useAppStore.getState().currentSong.progress);
    const lastTimeRef = useRef(performance.now());
    const animationFrameRef = useRef<number | null>(null);

    // Reset line refs, active index, progress anchor and scroll position to top when lyrics load
    useEffect(() => {
        activeLineRef.current = -1;
        setActiveLineIndex(-1);
        lineRefs.current = [];
        lastProgressRef.current = useAppStore.getState().currentSong.progress;
        lastTimeRef.current = performance.now();
        if (containerRef.current) {
            containerRef.current.scrollTop = 0;
        }
    }, [lyrics]);

    // Keep progress anchor synchronized without forcing re-renders
    useEffect(() => {
        lastProgressRef.current = useAppStore.getState().currentSong.progress;
        lastTimeRef.current = performance.now();

        const unsub = useAppStore.subscribe((state) => {
            if (state.currentSong.progress !== lastProgressRef.current) {
                lastProgressRef.current = state.currentSong.progress;
                lastTimeRef.current = performance.now();

                // If paused, recompute active line index and update line styles immediately
                if (!state.currentSong.isPlaying && lyrics && lyrics.lines.length > 0) {
                    const timeMs = state.currentSong.progress + state.syncOffsetMs;
                    const idx = findActiveLineIndex(lyrics.lines, timeMs);
                    if (idx !== activeLineRef.current) {
                        activeLineRef.current = idx;
                        setActiveLineIndex(idx);
                    }
                    lineRefs.current.forEach((el, i) => {
                        if (!el) return;
                        if (i < idx) settleLine(el, true);
                        else if (i > idx) settleLine(el, false);
                    });
                    if (idx >= 0 && lineRefs.current[idx]) {
                        applyWordStyles(lineRefs.current[idx], timeMs);
                    }
                }
            }
        });
        return () => unsub();
    }, [lyrics]);

    // Real-time animation loop: updates active line index and word-by-word karaoke gradient
    useEffect(() => {
        if (!lyrics || lyrics.lines.length === 0) {
            return;
        }

        const updateFrame = () => {
            const currentStore = useAppStore.getState();
            const elapsed = currentStore.currentSong.isPlaying ? (performance.now() - lastTimeRef.current) : 0;
            const currentTimeMs = lastProgressRef.current + elapsed + currentStore.syncOffsetMs;

            const nextIndex = findActiveLineIndex(lyrics.lines, currentTimeMs);
            const prevIndex = activeLineRef.current;

            if (nextIndex !== prevIndex) {
                activeLineRef.current = nextIndex;
                setActiveLineIndex(nextIndex);

                // Line transition: settle previous line words
                if (prevIndex >= 0 && lineRefs.current[prevIndex]) {
                    settleLine(lineRefs.current[prevIndex], prevIndex < nextIndex);
                }
            }

            // Word-mode: animate word & letter progress on the currently active line
            if (isWordMode && nextIndex >= 0 && lineRefs.current[nextIndex]) {
                applyWordStyles(lineRefs.current[nextIndex], currentTimeMs);
            }

            if (isPlaying) {
                animationFrameRef.current = requestAnimationFrame(updateFrame);
            }
        };

        if (isPlaying) {
            animationFrameRef.current = requestAnimationFrame(updateFrame);
        } else {
            updateFrame();
        }

        return () => {
            if (animationFrameRef.current !== null) {
                cancelAnimationFrame(animationFrameRef.current);
                animationFrameRef.current = null;
            }
        };
    }, [lyrics, isPlaying, syncOffsetMs, isWordMode]);

    // Smooth scroll into view when active line index changes
    useEffect(() => {
        if (activeLineIndex <= 0) {
            containerRef.current?.scrollTo({
                top: 0,
                behavior: 'smooth'
            });
            return;
        }
        if (activeLineIndex > 0 && lineRefs.current[activeLineIndex] && !isUserScrollingRef.current) {
            lineRefs.current[activeLineIndex]?.scrollIntoView({
                behavior: 'smooth',
                block: 'center'
            });
        }
    }, [activeLineIndex]);

    const handleScrollInteraction = useCallback(() => {
        isUserScrollingRef.current = true;
        if (userScrollTimeoutRef.current) {
            window.clearTimeout(userScrollTimeoutRef.current);
        }
        userScrollTimeoutRef.current = window.setTimeout(() => {
            isUserScrollingRef.current = false;
        }, 3500);
    }, []);

    useEffect(() => {
        return () => {
            if (userScrollTimeoutRef.current) {
                window.clearTimeout(userScrollTimeoutRef.current);
                userScrollTimeoutRef.current = null;
            }
        };
    }, []);

    const handleContextMenu = (e: React.MouseEvent) => {
        e.preventDefault();
        setContextMenu({ x: e.clientX, y: e.clientY });
    };

    const handleExternalLink = (e: React.MouseEvent, url?: string) => {
        e.preventDefault();
        e.stopPropagation();
        if (!url) return;
        if (window.electron?.openExternal) {
            window.electron.openExternal(url);
        } else {
            window.open(url, '_blank', 'noopener,noreferrer');
        }
    };

    if (!songTitle || songTitle === 'No song playing') {
        return (
            <div className="apple-empty-state" role="status">
                <div className="empty-state-symbol">
                    <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M9 18V5l12-2v13" />
                        <circle cx="6" cy="18" r="3" />
                        <circle cx="18" cy="16" r="3" />
                    </svg>
                </div>
                <h2 className="empty-state-title">Ready for Music</h2>
                <p className="empty-state-subtitle">Play any song on YouTube Music, Spotify, or Apple Music to display real-time synchronized lyrics.</p>
            </div>
        );
    }

    if (lyricsLoading) {
        if (activeAnimated) {
            return (
                <div className="animated-current-line-container" onContextMenu={handleContextMenu}>
                    <div className="animated-lyric-area">
                        <div className="animated-lyric-placeholder pulse">
                            Finding Synced Lyrics…
                        </div>
                    </div>
                </div>
            );
        }
        return (
            <div className="apple-empty-state" role="status" aria-live="polite">
                <div className="empty-state-symbol pulse">
                    <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                        <circle cx="11" cy="11" r="8" />
                        <path d="m21 21-4.3-4.3" />
                    </svg>
                </div>
                <h2 className="empty-state-title">Finding Synced Lyrics</h2>
                <p className="empty-state-subtitle">{songTitle}{songArtist ? ` • ${songArtist}` : ''}</p>
            </div>
        );
    }

    if (!lyrics || lyrics.lines.length === 0) {
        if (activeAnimated) {
            return (
                <div className="animated-current-line-container" onContextMenu={handleContextMenu}>
                    <div className="animated-lyric-area">
                        <div className="animated-lyric-placeholder" style={{ opacity: 0.6 }}>
                            Lyrics Not Available
                        </div>
                    </div>
                </div>
            );
        }
        return (
            <div className="apple-empty-state" role="status">
                <div className="empty-state-symbol">
                    <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                        <circle cx="12" cy="12" r="10" />
                        <path d="m4.93 4.93 14.14 14.14" />
                    </svg>
                </div>
                <h2 className="empty-state-title">Lyrics Not Available</h2>
                <p className="empty-state-subtitle">Synced lyrics couldn't be found for this track. Right-click anywhere for display options.</p>
            </div>
        );
    }

    const activeLine = (activeLineIndex >= 0 && activeLineIndex < lyrics.lines.length)
        ? lyrics.lines[activeLineIndex]
        : null;

    // In Animated Artwork mode, display strictly one verse at a time docked above metadata & controls
    if (activeAnimated) {
        return (
            <div
                className="animated-current-line-container"
                onContextMenu={handleContextMenu}
            >
                {contextMenu && (
                    <LyricsContextMenu
                        x={contextMenu.x}
                        y={contextMenu.y}
                        hasWordSync={lyrics.syncType === 'SYLLABLE'}
                        isAnimatedArtworkActive={true}
                        onClose={() => setContextMenu(null)}
                    />
                )}

                <div className="animated-lyric-area" role="region" aria-label="Current Lyric">
                    <div
                        ref={containerRef}
                        className={`lyrics-container animated-single-line-container ${isWordMode ? 'word-mode' : 'line-mode-only'}`}
                    >
                        <AnimatePresence mode="popLayout" initial={false}>
                            {activeLine ? (
                                <motion.div
                                    key={`line-${activeLineIndex}-${activeLine.startTimeMs}`}
                                    initial={{ opacity: 0, y: 12, filter: 'blur(6px)' }}
                                    animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
                                    exit={{ opacity: 0, y: -10, filter: 'blur(6px)' }}
                                    transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
                                    style={{ width: '100%' }}
                                >
                                    <LyricLineRenderer
                                        ref={(el) => { lineRefs.current[activeLineIndex] = el; }}
                                        line={activeLine}
                                        isActive={true}
                                        isPast={false}
                                        isRomanized={isRomanized}
                                    />
                                </motion.div>
                            ) : (
                                <motion.div
                                    key="placeholder"
                                    initial={{ opacity: 0 }}
                                    animate={{ opacity: 0.7 }}
                                    exit={{ opacity: 0 }}
                                    className="animated-lyric-placeholder"
                                >
                                    {songTitle && songTitle !== 'No song playing' ? songTitle : ''}
                                </motion.div>
                            )}
                        </AnimatePresence>
                    </div>
                </div>
            </div>
        );
    }

    return (
        <div
            className={`lyrics-container ${isWordMode ? 'word-mode' : 'line-mode-only'}`}
            ref={containerRef}
            onContextMenu={handleContextMenu}
            onWheel={handleScrollInteraction}
            onTouchStart={handleScrollInteraction}
            onPointerDown={handleScrollInteraction}
        >
            {contextMenu && (
                <LyricsContextMenu
                    x={contextMenu.x}
                    y={contextMenu.y}
                    hasWordSync={lyrics.syncType === 'SYLLABLE'}
                    onClose={() => setContextMenu(null)}
                />
            )}

            {lyrics.lines.map((line, index) => (
                <LyricLineRenderer
                    key={index}
                    ref={(el) => { lineRefs.current[index] = el; }}
                    line={line}
                    isActive={index === activeLineIndex}
                    isPast={activeLineIndex >= 0 && index < activeLineIndex}
                    isRomanized={isRomanized}
                />
            ))}

            {/* Apple Music Style Attribution & Credits Footer */}
            {lyrics.attribution && (
                <div className="lyrics-attribution-footer">
                    {lyrics.attribution.songwriters && lyrics.attribution.songwriters.length > 0 && (
                        <div className="lyrics-songwriters">
                            <span className="attribution-label">Written by: </span>
                            <span className="attribution-value">{lyrics.attribution.songwriters.join(', ')}</span>
                        </div>
                    )}
                    <div className="lyrics-provider-attribution">
                        <span className="provider-name">Lyrics provided by Spicy Lyrics</span>
                        {lyrics.attribution.maker && (
                            <>
                                <span className="attribution-sep">•</span>
                                <span className="attribution-contributor">
                                    Synced by{' '}
                                    <a
                                        href={lyrics.attribution.maker.url || '#'}
                                        onClick={(e) => handleExternalLink(e, lyrics.attribution?.maker?.url)}
                                        className="contributor-link"
                                        title={`View ${lyrics.attribution.maker.username} on Spicy Lyrics`}
                                    >
                                        {lyrics.attribution.maker.username}
                                    </a>
                                </span>
                            </>
                        )}
                        {lyrics.attribution.uploader &&
                            (!lyrics.attribution.maker || lyrics.attribution.uploader.id !== lyrics.attribution.maker.id) && (
                            <>
                                <span className="attribution-sep">•</span>
                                <span className="attribution-contributor">
                                    Uploaded by{' '}
                                    <a
                                        href={lyrics.attribution.uploader.url || '#'}
                                        onClick={(e) => handleExternalLink(e, lyrics.attribution?.uploader?.url)}
                                        className="contributor-link"
                                        title={`View ${lyrics.attribution.uploader.username} on Spicy Lyrics`}
                                    >
                                        {lyrics.attribution.uploader.username}
                                    </a>
                                </span>
                            </>
                        )}
                    </div>
                </div>
            )}

            {/* Bottom padding for scrolling past last line */}
            <div style={{ height: '35vh' }} />
        </div>
    );
};
