import React, { useEffect, useState, useRef, useLayoutEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useAppStore } from '../../store/useAppStore';
import { useEffectsStore } from '../../store/useEffectsStore';
import { LyricLineRenderer } from '../lyrics/LyricLineRenderer';
import type { LyricLine } from '../../utils/lyricsProvider';


export const AnimatedArtworkLyrics: React.FC = () => {
    const lyrics = useAppStore((s) => s.lyrics);
    const lyricsLoading = useAppStore((s) => s.lyricsLoading);
    const isRomanized = useAppStore((s) => s.isRomanized);
    const songTitle = useAppStore((s) => s.currentSong.title);
    const isPlaying = useAppStore((s) => s.currentSong.isPlaying);

    const { lyricMode } = useEffectsStore();
    const [activeLineIdx, setActiveLineIdx] = useState<number>(-1);

    const containerRef = useRef<HTMLDivElement | null>(null);
    const activeLineRef = useRef<HTMLDivElement | null>(null);
    const currentLineIdxRef = useRef<number>(-1);
    const animationFrameRef = useRef<number>(0);

    const lastProgressRef = useRef<number>(useAppStore.getState().currentSong.progress);
    const lastTimeRef = useRef<number>(performance.now());

    const syncOffsetRef = useRef<number>(useEffectsStore.getState().syncOffsetMs);

    // Keep syncOffsetRef synchronized with store changes (manual user +/- offset)
    useEffect(() => {
        syncOffsetRef.current = useEffectsStore.getState().syncOffsetMs;
        const unsub = useEffectsStore.subscribe((state) => {
            syncOffsetRef.current = state.syncOffsetMs;
        });
        return () => unsub();
    }, []);

    // Subscribe to store progress changes without causing React re-renders
    useEffect(() => {
        lastProgressRef.current = useAppStore.getState().currentSong.progress;
        lastTimeRef.current = performance.now();

        const unsubscribe = useAppStore.subscribe((state) => {
            if (state.currentSong.progress !== lastProgressRef.current) {
                lastProgressRef.current = state.currentSong.progress;
                lastTimeRef.current = performance.now();
            }
        });

        return () => unsubscribe();
    }, []);

    // Reset line index when lyrics change
    useEffect(() => {
        currentLineIdxRef.current = -1;
        activeLineRef.current = null;
        setActiveLineIdx(-1);
    }, [lyrics]);

    // Check if lyrics are static (no timestamps)
    const isStaticLyrics = Boolean(
        lyrics?.lines &&
        lyrics.lines.length > 0 &&
        lyrics.lines.every((l) => l.startTimeMs === 0 && l.endTimeMs === 0)
    );

    const lines = lyrics?.lines || [];
    const activeLine: LyricLine | null = (activeLineIdx >= 0 && activeLineIdx < lines.length)
        ? lines[activeLineIdx]
        : null;

    // Determine presentation mode: word-by-word karaoke vs line-by-line
    const hasSyllableSync = Boolean(
        activeLine?.isSyllable ||
        (activeLine?.syllables && activeLine.syllables.length > 0) ||
        lines.some((l) => (l.syllables && l.syllables.length > 0) || l.isSyllable)
    );
    const isWordMode = lyricMode === 'line'
        ? false
        : (lyricMode === 'word' || (lyricMode === 'auto' && hasSyllableSync));

    // Callback ref invoked when active line DOM mounts (ignores unmounting nulls from exiting lines)
    const setLineElement = useCallback((lineEl: HTMLDivElement | null) => {
        if (lineEl) {
            activeLineRef.current = lineEl;
        }
    }, []);

    // Guaranteed lookup for the active line DOM element (resilient across Framer Motion transitions)
    const getActiveLineElement = useCallback((): HTMLElement | null => {
        if (activeLineRef.current && activeLineRef.current.isConnected) {
            return activeLineRef.current;
        }
        if (activeLine && containerRef.current) {
            const found = containerRef.current.querySelector<HTMLElement>(
                `.lyric-line[data-start="${activeLine.startTimeMs}"]`
            );
            if (found) {
                activeLineRef.current = found as HTMLDivElement;
                return found;
            }
        }
        return null;
    }, [activeLine]);

    // Direct DOM syllable and word wash matching LyricsContainer with 100% parity
    const applyActiveLineStyles = useCallback((currentTimeMs: number, isWordWash: boolean) => {
        const lineEl = getActiveLineElement();
        if (!lineEl) return;

        const isInstrumental = lineEl.classList.contains('instrumental');
        if (isInstrumental) {
            const dotEls = lineEl.querySelectorAll<HTMLElement>('.instrumental-dot');
            dotEls.forEach((dotEl) => {
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

        const letterEls = lineEl.querySelectorAll<HTMLElement>('.letter');
        if (letterEls.length > 0) {
            letterEls.forEach((letterEl) => {
                const lStartStr = letterEl.getAttribute('data-start');
                const lEndStr = letterEl.getAttribute('data-end');
                if (lStartStr && lEndStr) {
                    const lStart = parseInt(lStartStr, 10);
                    const lEnd = parseInt(lEndStr, 10);
                    if (currentTimeMs >= lEnd) {
                        letterEl.classList.add('passed-letter');
                        letterEl.classList.remove('active-letter');
                    } else if (currentTimeMs >= lStart) {
                        letterEl.classList.add('active-letter');
                        letterEl.classList.remove('passed-letter');
                    } else {
                        letterEl.classList.remove('active-letter', 'passed-letter');
                    }
                }
            });
        }

        const wordEls = lineEl.querySelectorAll<HTMLElement>('.word');
        wordEls.forEach((wordEl) => {
            if (!isWordWash) {
                // Line mode: keep all words fully active simultaneously
                wordEl.classList.add('active-word');
                wordEl.classList.remove('passed-word');
                wordEl.style.setProperty('--gradient-position', '100%');
                wordEl.style.setProperty('--progress', '1');
            } else {
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
    }, [getActiveLineElement]);

    // Safety update whenever activeLineIdx or presentation mode changes
    useLayoutEffect(() => {
        const elapsed = isPlaying ? (performance.now() - lastTimeRef.current) : 0;
        const currentTimeMs = lastProgressRef.current + elapsed + syncOffsetRef.current;
        applyActiveLineStyles(currentTimeMs, isWordMode);
    }, [activeLineIdx, isWordMode, isPlaying, applyActiveLineStyles]);

    // High-performance 120 FPS animation loop with direct DOM updates (Zero GC, Zero Re-renders)
    useEffect(() => {
        if (!lyrics || lines.length === 0) {
            currentLineIdxRef.current = -1;
            const frameId = requestAnimationFrame(() => setActiveLineIdx(-1));
            return () => cancelAnimationFrame(frameId);
        }

        if (isStaticLyrics) {
            currentLineIdxRef.current = 0;
            const frameId = requestAnimationFrame(() => setActiveLineIdx(0));
            return () => cancelAnimationFrame(frameId);
        }

        if (!isPlaying) {
            const frameId = requestAnimationFrame(() => {
                const currentTimeMs = useAppStore.getState().currentSong.progress + syncOffsetRef.current;
                let foundIdx = -1;
                for (let i = 0; i < lines.length; i++) {
                    const line = lines[i];
                    if (currentTimeMs >= line.startTimeMs && currentTimeMs < line.endTimeMs) {
                        foundIdx = i;
                        break;
                    }
                }
                if (foundIdx === -1 && lines.length > 0) {
                    if (currentTimeMs < lines[0].startTimeMs) {
                        foundIdx = lines[0].isInstrumental ? 0 : -1;
                    } else {
                        for (let i = lines.length - 1; i >= 0; i--) {
                            if (currentTimeMs >= lines[i].startTimeMs) {
                                foundIdx = i;
                                break;
                            }
                        }
                    }
                }
                currentLineIdxRef.current = foundIdx;
                setActiveLineIdx(foundIdx);
                applyActiveLineStyles(currentTimeMs, isWordMode);
            });
            return () => cancelAnimationFrame(frameId);
        }

        const loop = (now: number) => {
            const elapsed = isPlaying ? (now - lastTimeRef.current) : 0;
            const currentTimeMs = lastProgressRef.current + elapsed + syncOffsetRef.current;
            const totalLines = lines.length;

            // 1. Detect current active line index
            let targetIdx = -1;
            const curIdx = currentLineIdxRef.current;

            // Fast path check
            if (curIdx >= 0 && curIdx < totalLines) {
                const cur = lines[curIdx];
                if (currentTimeMs >= cur.startTimeMs && currentTimeMs < cur.endTimeMs) {
                    targetIdx = curIdx;
                } else if (curIdx + 1 < totalLines && currentTimeMs >= lines[curIdx + 1].startTimeMs && currentTimeMs < lines[curIdx + 1].endTimeMs) {
                    targetIdx = curIdx + 1;
                }
            }

            if (targetIdx === -1) {
                for (let i = 0; i < totalLines; i++) {
                    if (currentTimeMs >= lines[i].startTimeMs && currentTimeMs < lines[i].endTimeMs) {
                        targetIdx = i;
                        break;
                    }
                }

                if (targetIdx === -1) {
                    if (totalLines > 0 && currentTimeMs < lines[0].startTimeMs) {
                        targetIdx = lines[0].isInstrumental ? 0 : -1;
                    } else {
                        // Between lines: retain previous line cleanly until the next line starts
                        for (let i = totalLines - 1; i >= 0; i--) {
                            if (currentTimeMs >= lines[i].startTimeMs) {
                                targetIdx = i;
                                break;
                            }
                        }
                    }
                }
            }

            // Only trigger React state reconciliation when the line changes (every few seconds)
            if (targetIdx !== currentLineIdxRef.current) {
                currentLineIdxRef.current = targetIdx;
                setActiveLineIdx(targetIdx);
            }

            // 2. Direct DOM Syllable Wash / Line updates on the active line at 120 FPS
            const currentLyricMode = useEffectsStore.getState().lyricMode;
            const activeLineData = (targetIdx >= 0 && targetIdx < totalLines) ? lines[targetIdx] : null;
            const lineHasSyllables = Boolean(
                activeLineData?.isSyllable ||
                (activeLineData?.syllables && activeLineData.syllables.length > 0) ||
                lines.some((l) => (l.syllables && l.syllables.length > 0) || l.isSyllable)
            );
            const isWordWashActive = currentLyricMode === 'line'
                ? false
                : (currentLyricMode === 'word' || (currentLyricMode === 'auto' && lineHasSyllables));

            applyActiveLineStyles(currentTimeMs, isWordWashActive);

            animationFrameRef.current = requestAnimationFrame(loop);
        };

        animationFrameRef.current = requestAnimationFrame(loop);

        return () => {
            if (animationFrameRef.current) {
                cancelAnimationFrame(animationFrameRef.current);
            }
        };
    }, [lyrics, isPlaying, lines, isStaticLyrics, isWordMode, applyActiveLineStyles]);

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

    return (
        <div className="animated-lyric-area" role="region" aria-label="Current Lyric">
            <div
                ref={containerRef}
                className={`lyrics-container animated-single-line-container ${isWordMode ? 'word-mode' : 'line-mode-only'}`}
            >
                <AnimatePresence initial={false}>
                    {activeLine ? (
                        <motion.div
                            key={`line-${activeLineIdx}-${activeLine.startTimeMs}`}
                            initial={{ opacity: 0, y: 10, filter: 'blur(4px)' }}
                            animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
                            exit={{ opacity: 0, y: -10, filter: 'blur(4px)', position: 'absolute', pointerEvents: 'none' }}
                            transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
                            style={{ width: '100%' }}
                        >
                            <LyricLineRenderer
                                ref={setLineElement}
                                line={activeLine}
                                isRomanized={isRomanized}
                                isActive={true}
                            />
                        </motion.div>
                    ) : lyricsLoading ? (
                        <motion.div
                            key="loading-lyrics"
                            initial={{ opacity: 0 }}
                            animate={{ opacity: 0.75 }}
                            exit={{ opacity: 0 }}
                            className="animated-lyric-placeholder"
                        >
                            Finding Synced Lyrics…
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

            {/* Subtle Attribution footer in animated mode */}
            {lyrics?.attribution && activeLine && (
                <div className="animated-lyrics-attribution" aria-label="Lyrics attribution">
                    {lyrics.attribution.source === 'spicy_lyrics' ? (
                        <>
                            <span>Lyrics provided by Spicy Lyrics</span>
                            {lyrics.attribution.maker && (
                                <>
                                    <span> • </span>
                                    <a
                                        href={lyrics.attribution.maker.url || '#'}
                                        onClick={(e) => handleExternalLink(e, lyrics.attribution?.maker?.url)}
                                        className="attribution-link"
                                    >
                                        Synced by {lyrics.attribution.maker.username}
                                    </a>
                                </>
                            )}
                        </>
                    ) : lyrics.attribution.source === 'apple_music' ? (
                        <span>Lyrics provided by Apple Music</span>
                    ) : (
                        <span>Lyrics provided by Spotify</span>
                    )}
                </div>
            )}
        </div>
    );
};
