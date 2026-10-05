import { useEffect, useRef, useState, useCallback } from 'react';
import { useAppStore } from '../../store/useAppStore';
import { LyricLineRenderer } from './LyricLineRenderer';
import { useEffectsStore } from '../../store/useEffectsStore';
import { LyricsContextMenu } from './LyricsContextMenu';

export const LyricsContainer = () => {
    const songTitle = useAppStore((s) => s.currentSong.title);
    const songArtist = useAppStore((s) => s.currentSong.artist);
    const isPlaying = useAppStore((s) => s.currentSong.isPlaying);
    const isRomanized = useAppStore((s) => s.isRomanized);
    const lyrics = useAppStore((s) => s.lyrics);
    const lyricsLoading = useAppStore((s) => s.lyricsLoading);

    const containerRef = useRef<HTMLDivElement>(null);
    const [contextMenu, setContextMenu] = useState<{ x: number, y: number } | null>(null);
    const { lyricMode } = useEffectsStore();
    const loading = lyricsLoading;

    const lineRefs = useRef<(HTMLDivElement | null)[]>([]);
    const animationRef = useRef<number>(0);
    const lastProgressRef = useRef(useAppStore.getState().currentSong.progress);
    const lastTimeRef = useRef(performance.now());

    const syncOffsetRef = useRef(useEffectsStore.getState().syncOffsetMs);

    // Keep syncOffsetRef synchronized with store changes (manual user +/- offset)
    useEffect(() => {
        syncOffsetRef.current = useEffectsStore.getState().syncOffsetMs;
        const unsub = useEffectsStore.subscribe((state) => {
            syncOffsetRef.current = state.syncOffsetMs;
        });
        return () => unsub();
    }, []);

    // Keep track of the latest song progress securely without causing component re-renders
    useEffect(() => {
        lastProgressRef.current = useAppStore.getState().currentSong.progress;
        lastTimeRef.current = performance.now();

        const unsub = useAppStore.subscribe((state) => {
            if (state.currentSong.progress !== lastProgressRef.current) {
                lastProgressRef.current = state.currentSong.progress;
                lastTimeRef.current = performance.now();
                if (!state.currentSong.isPlaying && lyrics) {
                    applyLineStyles(currentLineRef.current, state.currentSong.progress + syncOffsetRef.current);
                }
            }
        });
        return () => unsub();
    }, [lyrics]);

    // Forward-moving line pointer
    const currentLineRef = useRef(0);

    // Reset pointer and line refs when lyrics change (new song)
    useEffect(() => {
        currentLineRef.current = 0;
        lineRefs.current = [];
    }, [lyrics]);

    const isUserScrollingRef = useRef(false);
    const userScrollTimeoutRef = useRef<number | null>(null);

    const handleScrollInteraction = useCallback(() => {
        isUserScrollingRef.current = true;
        if (userScrollTimeoutRef.current) {
            window.clearTimeout(userScrollTimeoutRef.current);
        }
        userScrollTimeoutRef.current = window.setTimeout(() => {
            isUserScrollingRef.current = false;
        }, 3500);
    }, []);

    const applyLineStyles = (lineIndex: number, currentTimeMs: number) => {
        const { lyricMode } = useEffectsStore.getState();

        lineRefs.current.forEach((lineEl, index) => {
            if (!lineEl) return;

            const lineStartStr = lineEl.getAttribute('data-start');
            const lineEndStr = lineEl.getAttribute('data-end');
            const lStart = lineStartStr ? parseInt(lineStartStr, 10) : 0;
            const lEnd = lineEndStr ? parseInt(lineEndStr, 10) : 0;

            const isCurrentLine = index === lineIndex;
            const isSinging = currentTimeMs >= lStart && currentTimeMs < lEnd;
            const isPast = currentTimeMs >= lEnd;
            const isLineActive = isCurrentLine || isSinging;

            // Handle Instrumental Break
            const isInstrumental = lineEl.classList.contains('instrumental');
            if (isInstrumental) {
                if (isLineActive) {
                    lineEl.classList.add('active-line');
                    const dots = lineEl.querySelectorAll<HTMLElement>('.instrumental-dot');
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
                } else {
                    lineEl.classList.remove('active-line');
                    const dots = lineEl.querySelectorAll<HTMLElement>('.instrumental-dot');
                    dots.forEach((dotEl) => dotEl.classList.remove('dot-active', 'dot-passed'));
                }
            } else if (isLineActive) {
                lineEl.classList.add('active-line');
                lineEl.classList.remove('passed-line');

                // Letter syncing: individual letters inside held syllables
                const letterEls = lineEl.querySelectorAll<HTMLElement>('.letter');
                if (letterEls.length > 0) {
                    letterEls.forEach((letterEl) => {
                        const lStart = parseInt(letterEl.getAttribute('data-start') || '0', 10);
                        const lEnd = parseInt(letterEl.getAttribute('data-end') || '0', 10);
                        if (currentTimeMs >= lEnd) {
                            letterEl.classList.add('passed-letter');
                            letterEl.classList.remove('active-letter');
                        } else if (currentTimeMs >= lStart) {
                            letterEl.classList.add('active-letter');
                            letterEl.classList.remove('passed-letter');
                        } else {
                            letterEl.classList.remove('active-letter', 'passed-letter');
                        }
                    });
                }

                // Word styling: Line mode remains simultaneous; Word mode strictly uses API timestamps & wash
                const wordEls = lineEl.querySelectorAll<HTMLElement>('.word');
                wordEls.forEach((wordEl) => {
                    if (lyricMode === 'line') {
                        // Line-by-line mode: keep all words fully active simultaneously
                        wordEl.classList.add('active-word');
                        wordEl.classList.remove('passed-word');
                        wordEl.style.setProperty('--gradient-position', '100%');
                        wordEl.style.setProperty('--progress', '1');
                    } else {
                        // Word-by-word mode: get timing directly from the API only!
                        const wStartStr = wordEl.getAttribute('data-start');
                        const wEndStr = wordEl.getAttribute('data-end');
                        const hasLetters = wordEl.classList.contains('letterGroup');

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
                                if (!hasLetters) {
                                    const progress = duration > 0 ? Math.max(0, Math.min(1, (currentTimeMs - wStart) / duration)) : 1;
                                    const gradientPos = -20 + (120 * progress);
                                    wordEl.style.setProperty('--gradient-position', `${gradientPos}%`);
                                    wordEl.style.setProperty('--progress', progress.toString());
                                }
                            } else {
                                wordEl.classList.remove('active-word', 'passed-word');
                                wordEl.style.setProperty('--gradient-position', '-20%');
                                wordEl.style.setProperty('--progress', '0');
                            }
                        } else {
                            wordEl.style.setProperty('--gradient-position', '100%');
                            wordEl.style.setProperty('--progress', '1');
                        }
                    }
                });
            } else {
                lineEl.classList.remove('active-line');
                const isLinePast = isPast || index < lineIndex;
                if (isLinePast) {
                    lineEl.classList.add('passed-line');
                } else {
                    lineEl.classList.remove('passed-line');
                }

                const letterEls = lineEl.querySelectorAll<HTMLElement>('.letter');
                letterEls.forEach((letterEl) => {
                    letterEl.classList.remove('active-letter');
                    if (isLinePast) {
                        letterEl.classList.add('passed-letter');
                    } else {
                        letterEl.classList.remove('passed-letter');
                    }
                });

                const wordEls = lineEl.querySelectorAll<HTMLElement>('.word');
                wordEls.forEach((wordEl) => {
                    wordEl.classList.remove('active-word');
                    if (isLinePast) {
                        wordEl.classList.add('passed-word');
                        wordEl.style.setProperty('--gradient-position', '100%');
                        wordEl.style.setProperty('--progress', '1');
                    } else {
                        wordEl.classList.remove('passed-word');
                        wordEl.style.setProperty('--gradient-position', '-20%');
                        wordEl.style.setProperty('--progress', '0');
                    }
                });
            }

            // Spicy Lyrics Dynamic Depth Blur Effect based on line distance
            const distance = Math.abs(index - lineIndex);
            const blur = isLineActive ? 0 : Math.min(4.5, distance * 1.25);
            lineEl.style.setProperty('--dynamic-blur', `${blur}px`);
        });
    };

    // Run DOM updates when static (paused) or newly loaded
    useEffect(() => {
        if (!isPlaying && lyrics) {
            applyLineStyles(currentLineRef.current, useAppStore.getState().currentSong.progress + syncOffsetRef.current);
        }
    }, [isPlaying, lyrics]);

    // Main Animation Loop — smoothed clock + API-accurate syllable progression
    useEffect(() => {
        if (!lyrics || lyrics.lines.length === 0 || !isPlaying) {
            if (animationRef.current) cancelAnimationFrame(animationRef.current);
            return;
        }

        let currentScrollY = containerRef.current ? containerRef.current.scrollTop : 0;

        const loop = (now: number) => {
            const elapsed = isPlaying ? (now - lastTimeRef.current) : 0;
            const currentTimeMs = lastProgressRef.current + elapsed + syncOffsetRef.current;

            // Find current active line index directly from API timestamps
            let activeIdx = -1;
            for (let i = 0; i < lyrics.lines.length; i++) {
                const l = lyrics.lines[i];
                if (currentTimeMs >= l.startTimeMs && currentTimeMs < l.endTimeMs) {
                    activeIdx = i;
                    break;
                }
            }
            if (activeIdx === -1) {
                if (lyrics.lines.length > 0 && currentTimeMs < lyrics.lines[0].startTimeMs) {
                    // Before line 0 starts (intro)
                    activeIdx = lyrics.lines[0].isInstrumental ? 0 : -1;
                } else {
                    for (let i = 0; i < lyrics.lines.length; i++) {
                        if (currentTimeMs < lyrics.lines[i].startTimeMs) {
                            activeIdx = Math.max(0, i - 1);
                            break;
                        }
                    }
                    if (activeIdx === -1 && lyrics.lines.length > 0) {
                        activeIdx = lyrics.lines.length - 1;
                    }
                }
            }

            currentLineRef.current = Math.max(0, activeIdx);
            applyLineStyles(currentLineRef.current, currentTimeMs);

            // Smooth scrolling
            if (activeIdx >= 0 && activeIdx < lineRefs.current.length && containerRef.current && !isUserScrollingRef.current) {
                const activeElement = lineRefs.current[activeIdx];
                if (activeElement) {
                    const elementTop = activeElement.offsetTop;
                    const elementHeight = activeElement.offsetHeight;
                    const containerHeight = containerRef.current.clientHeight;
                    const targetScrollTop = elementTop - (containerHeight / 2) + (elementHeight / 2);

                    currentScrollY += (targetScrollTop - currentScrollY) * 0.08;
                    if (Math.abs(targetScrollTop - currentScrollY) > 0.5) {
                        containerRef.current.scrollTop = currentScrollY;
                    }
                }
            } else if (containerRef.current && isUserScrollingRef.current) {
                currentScrollY = containerRef.current.scrollTop;
            }

            animationRef.current = requestAnimationFrame(loop);
        };

        animationRef.current = requestAnimationFrame(loop);

        return () => {
            if (animationRef.current) {
                cancelAnimationFrame(animationRef.current);
            }
        };
    }, [lyrics, isPlaying]);

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

    if (loading) {
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

    // Check if track has syllable/word-level sync from Spicy Lyrics API
    const hasSyllables = lyrics.lines.some(l => l.syllables && l.syllables.length > 0);

    // Word by word gets how lyrics work from API only:
    // If lyricMode is 'line', remain strictly line-by-line (no changes).
    // If lyricMode is 'word' or 'auto', enable word-mode ONLY if API provides syllable-level sync!
    const isWordMode = hasSyllables && (lyricMode === 'word' || lyricMode === 'auto');
    const classes = `lyrics-container ${isWordMode ? "word-mode" : "line-mode-only"}`;

    const handleContextMenu = (e: React.MouseEvent) => {
        e.preventDefault();
        setContextMenu({ x: e.clientX, y: e.clientY });
    };

    const handleExternalLink = (e: React.MouseEvent, url?: string) => {
        e.preventDefault();
        e.stopPropagation();
        if (!url) return;
        if ((window as any).electron?.openExternal) {
            (window as any).electron.openExternal(url);
        } else {
            window.open(url, '_blank', 'noopener,noreferrer');
        }
    };

    return (
        <div
            className={classes}
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
                    hasWordSync={hasSyllables}
                    onClose={() => setContextMenu(null)}
                />
            )}
            {lyrics.lines.map((line, index) => (
                <LyricLineRenderer
                    key={index}
                    ref={(el) => { lineRefs.current[index] = el; }}
                    line={line}
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
                        {lyrics.attribution.source === 'spicy_lyrics' ? (
                            <>
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
                            </>
                        ) : lyrics.attribution.source === 'apple_music' ? (
                            <span className="provider-name">Lyrics provided by Apple Music</span>
                        ) : (
                            <span className="provider-name">Lyrics provided by Spotify</span>
                        )}
                    </div>
                </div>
            )}

            {/* Padding at the bottom for scrolling past the last line */}
            <div style={{ height: '35vh' }}></div>
        </div>
    );
};
