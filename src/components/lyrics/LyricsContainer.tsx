import React, { useEffect, useRef, useState, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useAppStore } from '../../store/useAppStore';
import { LyricLineRenderer } from './LyricLineRenderer';
import { LyricsContextMenu } from './LyricsContextMenu';
import type { LyricLine } from '../../utils/lyricsProvider';
import { Spring } from '../../modules/Spring';
import {
    PROGRESS_POSITION_OFFSET,
    preHiddenDotLineMs,
    normalizeProgress,
    resetProgressPrediction,
    getElementState,
    getProgressPercentage,
    getScrollLineIndex,
    ScaleSpline,
    YOffsetSpline,
    GlowSpline,
    LetterScaleSpline,
    LetterYOffsetSpline,
    LetterGlowMultiplier_Opacity,
    DotScaleSpline,
    DotYOffsetSpline,
    DotGlowSpline,
    DotOpacitySpline,
    WordSpringConstants,
    DotAnimations,
} from '../../utils/lyrics/progressPredictor';

interface WordAnimatorStore {
    Scale: Spring;
    YOffset: Spring;
    Glow: Spring;
}

interface DotAnimatorStore {
    Scale: Spring;
    YOffset: Spring;
    Glow: Spring;
    Opacity: Spring;
}

const wordSpringsMap = new WeakMap<HTMLElement, WordAnimatorStore>();
const letterSpringsMap = new WeakMap<HTMLElement, WordAnimatorStore>();
const dotSpringsMap = new WeakMap<HTMLElement, DotAnimatorStore>();
const styleCache = new WeakMap<HTMLElement, Map<string, number | string>>();

function setStyleIfChanged(
    el: HTMLElement,
    prop: string,
    value: string,
    epsilon = 0,
    compareValue?: number
): void {
    let map = styleCache.get(el);
    if (!map) {
        map = new Map();
        styleCache.set(el, map);
    }
    let next: number | string = compareValue ?? parseFloat(value);
    if (Number.isNaN(next)) next = value;
    const prev = map.get(prop);
    if (prev !== undefined) {
        if (typeof prev === 'number' && typeof next === 'number') {
            if (Math.abs(prev - next) <= epsilon) return;
        } else if (prev === next) {
            return;
        }
    }
    el.style.setProperty(prop, value);
    map.set(prop, next);
}

function setClass(el: HTMLElement, cls: string, on: boolean): void {
    if (el.classList.contains(cls) !== on) {
        el.classList.toggle(cls, on);
    }
}

function getOrCreateWordSprings(el: HTMLElement): WordAnimatorStore {
    let store = wordSpringsMap.get(el);
    if (!store) {
        store = {
            Scale: new Spring(ScaleSpline.at(0), WordSpringConstants.ScaleFrequency, WordSpringConstants.ScaleDamping),
            YOffset: new Spring(YOffsetSpline.at(0), WordSpringConstants.YOffsetFrequency, WordSpringConstants.YOffsetDamping),
            Glow: new Spring(GlowSpline.at(0), WordSpringConstants.GlowFrequency, WordSpringConstants.GlowDamping),
        };
        wordSpringsMap.set(el, store);
    }
    return store;
}

function getOrCreateLetterSprings(el: HTMLElement): WordAnimatorStore {
    let store = letterSpringsMap.get(el);
    if (!store) {
        store = {
            Scale: new Spring(LetterScaleSpline.at(0), WordSpringConstants.ScaleFrequency, WordSpringConstants.ScaleDamping),
            YOffset: new Spring(LetterYOffsetSpline.at(0), WordSpringConstants.YOffsetFrequency, WordSpringConstants.YOffsetDamping),
            Glow: new Spring(GlowSpline.at(0), WordSpringConstants.GlowFrequency, WordSpringConstants.GlowDamping),
        };
        letterSpringsMap.set(el, store);
    }
    return store;
}

function getOrCreateDotSprings(el: HTMLElement): DotAnimatorStore {
    let store = dotSpringsMap.get(el);
    if (!store) {
        store = {
            Scale: new Spring(DotScaleSpline.at(0), DotAnimations.ScaleFrequency, DotAnimations.ScaleDamping),
            YOffset: new Spring(DotYOffsetSpline.at(0), DotAnimations.YOffsetFrequency, DotAnimations.YOffsetDamping),
            Glow: new Spring(DotGlowSpline.at(0), DotAnimations.GlowFrequency, DotAnimations.GlowDamping),
            Opacity: new Spring(DotOpacitySpline.at(0), DotAnimations.OpacityFrequency, DotAnimations.OpacityDamping),
        };
        dotSpringsMap.set(el, store);
    }
    return store;
}

function settleLine(lineEl: HTMLElement | null, isPassed: boolean) {
    if (!lineEl) return;

    if (isPassed) {
        setClass(lineEl, 'Sung', true);
        setClass(lineEl, 'passed-line', true);
        setClass(lineEl, 'Active', false);
        setClass(lineEl, 'active-line', false);
        setClass(lineEl, 'NotSung', false);

        if (lineEl.classList.contains('instrumental')) {
            setClass(lineEl, 'pre-hidden', false);
            lineEl.querySelectorAll<HTMLElement>('.instrumental-dot').forEach((d) => {
                setClass(d, 'dot-passed', true);
                setClass(d, 'dot-active', true);
                setStyleIfChanged(d, 'scale', '1', 0.001);
                setStyleIfChanged(d, 'opacity', '1', 0.001);
                setStyleIfChanged(d, 'transform', 'translate3d(0, 0, 0)', 0.0001, 0);
                setStyleIfChanged(d, '--text-shadow-opacity', '0%', 1);
            });
            return;
        }

        lineEl.querySelectorAll<HTMLElement>('.word').forEach((w) => {
            setClass(w, 'passed-word', true);
            setClass(w, 'active-word', false);
            if (!w.classList.contains('letterGroup')) {
                setStyleIfChanged(w, '--gradient-position', '100%', 0.2);
                setStyleIfChanged(w, '--progress', '1', 0.005);
                setStyleIfChanged(w, 'scale', '1', 0.001);
                setStyleIfChanged(w, 'transform', 'translate3d(0, 0, 0)', 0.0001, 0);
                setStyleIfChanged(w, '--text-shadow-opacity', '0%', 1);
            }
        });

        lineEl.querySelectorAll<HTMLElement>('.letter').forEach((l) => {
            setClass(l, 'passed-letter', true);
            setClass(l, 'active-letter', false);
            setStyleIfChanged(l, '--gradient-position', '100%', 0.2);
            setStyleIfChanged(l, 'scale', '1', 0.001);
            setStyleIfChanged(l, 'transform', 'translate3d(0, 0, 0)', 0.0001, 0);
            setStyleIfChanged(l, '--text-shadow-opacity', '0%', 1);
        });
    } else {
        setClass(lineEl, 'NotSung', true);
        setClass(lineEl, 'Active', false);
        setClass(lineEl, 'active-line', false);
        setClass(lineEl, 'Sung', false);
        setClass(lineEl, 'passed-line', false);

        if (lineEl.classList.contains('instrumental')) {
            setClass(lineEl, 'pre-hidden', true);
            lineEl.querySelectorAll<HTMLElement>('.instrumental-dot').forEach((d) => {
                setClass(d, 'dot-active', false);
                setClass(d, 'dot-passed', false);
                setStyleIfChanged(d, 'scale', '0.75', 0.001);
                setStyleIfChanged(d, 'opacity', '0.35', 0.001);
                setStyleIfChanged(d, 'transform', 'translate3d(0, 0, 0)', 0.0001, 0);
                setStyleIfChanged(d, '--text-shadow-opacity', '0%', 1);
            });
            return;
        }

        lineEl.querySelectorAll<HTMLElement>('.word').forEach((w) => {
            setClass(w, 'active-word', false);
            setClass(w, 'passed-word', false);
            if (!w.classList.contains('letterGroup')) {
                setStyleIfChanged(w, '--gradient-position', '-20%', 0.2);
                setStyleIfChanged(w, '--progress', '0', 0.005);
                setStyleIfChanged(w, 'scale', '0.95', 0.001);
                setStyleIfChanged(w, 'transform', 'translate3d(0, 0, 0)', 0.0001, 0);
                setStyleIfChanged(w, '--text-shadow-opacity', '0%', 1);
            }
        });

        lineEl.querySelectorAll<HTMLElement>('.letter').forEach((l) => {
            setClass(l, 'active-letter', false);
            setClass(l, 'passed-letter', false);
            setStyleIfChanged(l, '--gradient-position', '-20%', 0.2);
            setStyleIfChanged(l, 'scale', '0.95', 0.001);
            setStyleIfChanged(l, 'transform', 'translate3d(0, 0, 0)', 0.0001, 0);
            setStyleIfChanged(l, '--text-shadow-opacity', '0%', 1);
        });
    }
}

function applyLineBlur(
    lineElements: (HTMLDivElement | null)[],
    activeIndices: number[],
    scrollIndex: number
) {
    const maxBlur = 5;
    const blurMultiplier = 1.25;
    for (let i = 0; i < lineElements.length; i++) {
        const el = lineElements[i];
        if (!el || !el.isConnected) continue;
        if (activeIndices.includes(i)) {
            setStyleIfChanged(el, '--BlurAmount', '0px', 0.25);
            continue;
        }
        const distance = Math.abs(i - scrollIndex);
        const blurAmount = distance === 0 ? 0 : Math.min(blurMultiplier * distance, maxBlur);
        setStyleIfChanged(el, '--BlurAmount', `${blurAmount}px`, 0.25);
    }
}

function updateActiveLineAnimation(
    activeLineEl: HTMLElement | null,
    currentTimeMs: number,
    deltaTime: number,
    line: LyricLine | undefined
) {
    if (!activeLineEl || !line) return;

    // Instrumental break animation
    if (activeLineEl.classList.contains('instrumental')) {
        const isPreHidden = currentTimeMs > line.endTimeMs - preHiddenDotLineMs;
        setClass(activeLineEl, 'pre-hidden', isPreHidden);

        const dots = activeLineEl.querySelectorAll<HTMLElement>('.instrumental-dot');
        dots.forEach((dotEl) => {
            const dStart = parseInt(dotEl.getAttribute('data-start') || '0', 10);
            const dEnd = parseInt(dotEl.getAttribute('data-end') || '0', 10);
            const dotState = getElementState(currentTimeMs, dStart, dEnd);
            const dotPct = getProgressPercentage(currentTimeMs, dStart, dEnd);
            const store = getOrCreateDotSprings(dotEl);

            let targetScale: number;
            let targetYOffset: number;
            let targetGlow: number;
            let targetOpacity: number;

            if (dotState === 'Active') {
                targetScale = DotScaleSpline.at(dotPct);
                targetYOffset = DotYOffsetSpline.at(dotPct);
                targetGlow = DotGlowSpline.at(dotPct);
                targetOpacity = DotOpacitySpline.at(dotPct);
                setClass(dotEl, 'dot-active', true);
                setClass(dotEl, 'dot-passed', false);
            } else if (dotState === 'NotSung') {
                targetScale = DotScaleSpline.at(0);
                targetYOffset = DotYOffsetSpline.at(0);
                targetGlow = DotGlowSpline.at(0);
                targetOpacity = DotOpacitySpline.at(0);
                setClass(dotEl, 'dot-active', false);
                setClass(dotEl, 'dot-passed', false);
            } else {
                targetScale = DotScaleSpline.at(1);
                targetYOffset = DotYOffsetSpline.at(1);
                targetGlow = DotGlowSpline.at(1);
                targetOpacity = DotOpacitySpline.at(1);
                setClass(dotEl, 'dot-active', true);
                setClass(dotEl, 'dot-passed', true);
            }

            store.Scale.SetGoal(targetScale);
            store.YOffset.SetGoal(targetYOffset);
            store.Glow.SetGoal(targetGlow);
            store.Opacity.SetGoal(targetOpacity);

            const curScale = store.Scale.Step(deltaTime);
            const curYOffset = store.YOffset.Step(deltaTime);
            const curGlow = store.Glow.Step(deltaTime);
            const curOpacity = store.Opacity.Step(deltaTime);

            setStyleIfChanged(dotEl, 'scale', `${curScale}`, 0.001);
            setStyleIfChanged(dotEl, 'transform', `translate3d(0, calc(var(--DefaultLyricsSize, 31px) * ${curYOffset}), 0)`, 0.0001, curYOffset);
            setStyleIfChanged(dotEl, 'opacity', `${curOpacity}`, 0.001);
            setStyleIfChanged(dotEl, '--text-shadow-blur-radius', `${4 + 6 * curGlow}px`, 0.5);
            setStyleIfChanged(dotEl, '--text-shadow-opacity', `${curGlow * 90}%`, 1);
        });
        return;
    }

    // Words & Syllables spring animation
    const wordEls = activeLineEl.querySelectorAll<HTMLElement>('.word');
    wordEls.forEach((wordEl) => {
        const wStartStr = wordEl.getAttribute('data-start');
        const wEndStr = wordEl.getAttribute('data-end');
        const isLetterGroup = wordEl.classList.contains('letterGroup');

        if (!wStartStr || !wEndStr) {
            setStyleIfChanged(wordEl, '--gradient-position', '100%', 0.2);
            setStyleIfChanged(wordEl, '--progress', '1', 0.005);
            return;
        }

        const wStart = parseInt(wStartStr, 10);
        const wEnd = parseInt(wEndStr, 10);
        const wState = getElementState(currentTimeMs, wStart, wEnd);
        const wPct = getProgressPercentage(currentTimeMs, wStart, wEnd);

        if (isLetterGroup) {
            // Syllable with individual letter proximity wave effects
            const letters = wordEl.querySelectorAll<HTMLElement>('.letter');
            if (letters.length > 0) {
                // 1. Identify currently active letter in this syllable
                let activeLetterIndex = -1;
                let activeLetterPercentage = 0;
                if (wState === 'Active') {
                    for (let i = 0; i < letters.length; i++) {
                        const lStart = parseInt(letters[i].getAttribute('data-start') || '0', 10);
                        const lEnd = parseInt(letters[i].getAttribute('data-end') || '0', 10);
                        if (getElementState(currentTimeMs, lStart, lEnd) === 'Active') {
                            activeLetterIndex = i;
                            activeLetterPercentage = getProgressPercentage(currentTimeMs, lStart, lEnd);
                            break;
                        }
                    }
                }

                // 2. Animate each letter using Spicy Lyrics 6.3.153 proximity wave physics
                for (let k = 0; k < letters.length; k++) {
                    const letterEl = letters[k];
                    const lStart = parseInt(letterEl.getAttribute('data-start') || '0', 10);
                    const lEnd = parseInt(letterEl.getAttribute('data-end') || '0', 10);
                    const letterState = getElementState(currentTimeMs, lStart, lEnd);
                    const store = getOrCreateLetterSprings(letterEl);

                    const restingScale = LetterScaleSpline.at(0);
                    const restingYOffset = LetterYOffsetSpline.at(0);
                    const restingGlow = GlowSpline.at(0);

                    if (wState === 'Active') {
                        let targetScale = restingScale;
                        let targetYOffset = restingYOffset;
                        let targetGlow = restingGlow;

                        if (activeLetterIndex !== -1) {
                            const baseScale = LetterScaleSpline.at(activeLetterPercentage);
                            const baseYOffset = LetterYOffsetSpline.at(activeLetterPercentage);
                            const baseGlow = GlowSpline.at(activeLetterPercentage);

                            const distance = Math.abs(k - activeLetterIndex);
                            const falloff = Math.max(0, 1 / (1 + Math.pow(distance, 2.8)));
                            const glowFalloff = Math.max(0, 1 / (1 + distance * 0.9));

                            targetScale = restingScale + (baseScale - restingScale) * falloff;
                            targetYOffset = restingYOffset + (baseYOffset - restingYOffset) * falloff;
                            targetGlow = restingGlow + (baseGlow - restingGlow) * glowFalloff;
                        }

                        let targetGradient: number;
                        if (letterState === 'NotSung') {
                            targetScale = restingScale;
                            targetYOffset = restingYOffset;
                            targetGlow = restingGlow;
                            targetGradient = -20;
                            setClass(letterEl, 'active-letter', false);
                            setClass(letterEl, 'passed-letter', false);
                        } else if (letterState === 'Sung') {
                            targetGradient = 100;
                            setClass(letterEl, 'active-letter', false);
                            setClass(letterEl, 'passed-letter', true);
                        } else {
                            // Active
                            const eased = Math.sin((activeLetterPercentage * Math.PI) / 2);
                            targetGradient = k === activeLetterIndex ? -20 + 120 * eased : -20;
                            setClass(letterEl, 'active-letter', true);
                            setClass(letterEl, 'passed-letter', false);
                        }

                        store.Scale.SetGoal(targetScale);
                        store.YOffset.SetGoal(targetYOffset);
                        store.Glow.SetGoal(targetGlow);

                        const curScale = store.Scale.Step(deltaTime);
                        const curYOffset = store.YOffset.Step(deltaTime);
                        const curGlow = store.Glow.Step(deltaTime);

                        setStyleIfChanged(letterEl, '--gradient-position', `${targetGradient}%`, 0.2);
                        setStyleIfChanged(
                            letterEl,
                            'transform',
                            `translate3d(0, calc(var(--DefaultLyricsSize, 31px) * ${curYOffset * 2}), 0)`,
                            0.0001,
                            curYOffset * 2
                        );
                        setStyleIfChanged(letterEl, 'scale', `${curScale}`, 0.001);
                        setStyleIfChanged(letterEl, '--text-shadow-blur-radius', `${4 + 12 * curGlow}px`, 0.5);
                        setStyleIfChanged(letterEl, '--text-shadow-opacity', `${curGlow * LetterGlowMultiplier_Opacity}%`, 1);
                    } else if (wState === 'NotSung') {
                        store.Scale.SetGoal(restingScale);
                        store.YOffset.SetGoal(restingYOffset);
                        store.Glow.SetGoal(restingGlow);

                        const curScale = store.Scale.Step(deltaTime);
                        const curYOffset = store.YOffset.Step(deltaTime);
                        const curGlow = store.Glow.Step(deltaTime);

                        setClass(letterEl, 'active-letter', false);
                        setClass(letterEl, 'passed-letter', false);
                        setStyleIfChanged(letterEl, '--gradient-position', '-20%', 0.2);
                        setStyleIfChanged(
                            letterEl,
                            'transform',
                            `translate3d(0, calc(var(--DefaultLyricsSize, 31px) * ${curYOffset * 2}), 0)`,
                            0.0001,
                            curYOffset * 2
                        );
                        setStyleIfChanged(letterEl, 'scale', `${curScale}`, 0.001);
                        setStyleIfChanged(letterEl, '--text-shadow-blur-radius', `${4 + 12 * curGlow}px`, 0.5);
                        setStyleIfChanged(letterEl, '--text-shadow-opacity', `${curGlow * LetterGlowMultiplier_Opacity}%`, 1);
                    } else {
                        // Sung word
                        store.Scale.SetGoal(LetterScaleSpline.at(1));
                        store.YOffset.SetGoal(LetterYOffsetSpline.at(1));
                        store.Glow.SetGoal(GlowSpline.at(1));

                        const curScale = store.Scale.Step(deltaTime);
                        const curYOffset = store.YOffset.Step(deltaTime);
                        const curGlow = store.Glow.Step(deltaTime);

                        setClass(letterEl, 'active-letter', false);
                        setClass(letterEl, 'passed-letter', true);
                        setStyleIfChanged(letterEl, '--gradient-position', '100%', 0.2);
                        setStyleIfChanged(
                            letterEl,
                            'transform',
                            `translate3d(0, calc(var(--DefaultLyricsSize, 31px) * ${curYOffset * 2}), 0)`,
                            0.0001,
                            curYOffset * 2
                        );
                        setStyleIfChanged(letterEl, 'scale', `${curScale}`, 0.001);
                        setStyleIfChanged(letterEl, '--text-shadow-blur-radius', `${4 + 12 * curGlow}px`, 0.5);
                        setStyleIfChanged(letterEl, '--text-shadow-opacity', `${curGlow * LetterGlowMultiplier_Opacity}%`, 1);
                    }
                }
            }

            // Word container state
            if (wState === 'Active') {
                setClass(wordEl, 'active-word', true);
                setClass(wordEl, 'passed-word', false);
            } else if (wState === 'Sung') {
                setClass(wordEl, 'passed-word', true);
                setClass(wordEl, 'active-word', false);
            } else {
                setClass(wordEl, 'active-word', false);
                setClass(wordEl, 'passed-word', false);
            }
            return;
        }

        // Standard word/syllable spring animation (non-letterGroup)
        const store = getOrCreateWordSprings(wordEl);
        let targetScale: number;
        let targetYOffset: number;
        let targetGlow: number;
        let targetGradientPos: number;

        if (wState === 'Active') {
            targetScale = ScaleSpline.at(wPct);
            targetYOffset = YOffsetSpline.at(wPct);
            targetGlow = GlowSpline.at(wPct);
            targetGradientPos = -20 + 120 * wPct;
            setClass(wordEl, 'active-word', true);
            setClass(wordEl, 'passed-word', false);
        } else if (wState === 'NotSung') {
            targetScale = ScaleSpline.at(0);
            targetYOffset = YOffsetSpline.at(0);
            targetGlow = GlowSpline.at(0);
            targetGradientPos = -20;
            setClass(wordEl, 'active-word', false);
            setClass(wordEl, 'passed-word', false);
        } else {
            // Sung
            targetScale = ScaleSpline.at(1);
            targetYOffset = YOffsetSpline.at(1);
            targetGlow = GlowSpline.at(1);
            targetGradientPos = 100;
            setClass(wordEl, 'passed-word', true);
            setClass(wordEl, 'active-word', false);
        }

        store.Scale.SetGoal(targetScale);
        store.YOffset.SetGoal(targetYOffset);
        store.Glow.SetGoal(targetGlow);

        const curScale = store.Scale.Step(deltaTime);
        const curYOffset = store.YOffset.Step(deltaTime);
        const curGlow = store.Glow.Step(deltaTime);

        setStyleIfChanged(wordEl, 'scale', `${curScale}`, 0.001);
        setStyleIfChanged(
            wordEl,
            'transform',
            `translate3d(0, calc(var(--DefaultLyricsSize, 31px) * ${curYOffset}), 0)`,
            0.0001,
            curYOffset
        );
        setStyleIfChanged(wordEl, '--gradient-position', `${targetGradientPos}%`, 0.2);
        setStyleIfChanged(wordEl, '--progress', `${wPct}`, 0.005);
        setStyleIfChanged(wordEl, '--text-shadow-blur-radius', `${4 + 2 * curGlow}px`, 0.5);
        setStyleIfChanged(wordEl, '--text-shadow-opacity', `${Math.min(curGlow * 35, 100)}%`, 1);
    });
}

interface LyricsContainerProps {
    isAnimatedMode?: boolean;
}

export const LyricsContainer: React.FC<LyricsContainerProps> = ({ isAnimatedMode }) => {
    const songTitle = useAppStore((s) => s.currentSong.title);
    const songArtist = useAppStore((s) => s.currentSong.artist);
    const songId = useAppStore((s) => s.currentSong.id);
    const songDuration = useAppStore((s) => s.currentSong.duration);
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
    const currentTrackKey = songId || `${songTitle}::${songArtist}`;
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
    const activeAnimated = isAnimatedMode ?? computedAnimatedMode;

    const hasSyllables = Boolean(
        lyrics?.syncType === 'SYLLABLE' ||
        lyrics?.lines?.some((l) => l.syllables && l.syllables.length > 0)
    );
    const isWordMode = hasSyllables && lyricMode !== 'line';

    const containerRef = useRef<HTMLDivElement>(null);
    const lineRefs = useRef<(HTMLDivElement | null)[]>([]);
    const [contextMenu, setContextMenu] = useState<{ x: number; y: number } | null>(null);
    const [activeLineIndex, setActiveLineIndex] = useState<number>(-1);

    const activeLineRef = useRef(-1);
    const isUserScrollingRef = useRef(false);
    const userScrollTimeoutRef = useRef<number | null>(null);

    const lastProgressRef = useRef(useAppStore.getState().currentSong.progress);
    const lastSampleTimeRef = useRef(performance.now());
    const lastFrameTimeRef = useRef(performance.now());
    const animationFrameRef = useRef<number | null>(null);
    const lineStateMapRef = useRef<Map<number, 'active' | 'passed' | 'notsung'>>(new Map());

    // Reset line refs, active index, progress anchor and scroll position to top when lyrics change
    useEffect(() => {
        resetProgressPrediction();
        activeLineRef.current = -1;
        setActiveLineIndex(-1);
        lineRefs.current = [];
        lineStateMapRef.current.clear();
        lastProgressRef.current = useAppStore.getState().currentSong.progress;
        lastSampleTimeRef.current = performance.now();
        lastFrameTimeRef.current = performance.now();
        if (containerRef.current) {
            containerRef.current.scrollTop = 0;
        }
    }, [lyrics, currentTrackKey]);

    // Keep progress anchor synchronized without forcing re-renders
    useEffect(() => {
        lastProgressRef.current = useAppStore.getState().currentSong.progress;
        lastSampleTimeRef.current = performance.now();

        const unsub = useAppStore.subscribe((state) => {
            if (state.currentSong.progress !== lastProgressRef.current) {
                lastProgressRef.current = state.currentSong.progress;
                lastSampleTimeRef.current = performance.now();

                // If paused, recompute active line index and update line styles immediately
                if (!state.currentSong.isPlaying && lyrics && lyrics.lines.length > 0) {
                    const pausedPosition = lastProgressRef.current - state.syncOffsetMs;
                    const clockMs = normalizeProgress(
                        pausedPosition,
                        false,
                        state.currentSong.id || `${state.currentSong.title}::${state.currentSong.artist}`,
                        state.currentSong.duration
                    );
                    const scrollIdx = getScrollLineIndex(lyrics.lines, clockMs);
                    if (scrollIdx !== activeLineRef.current) {
                        activeLineRef.current = scrollIdx;
                        setActiveLineIndex(scrollIdx);
                    }

                    const pausedActiveIndices: number[] = [];
                    for (let i = 0; i < lyrics.lines.length; i++) {
                        const line = lyrics.lines[i];
                        if (clockMs >= line.startTimeMs && clockMs <= line.endTimeMs) {
                            pausedActiveIndices.push(i);
                        }
                    }
                    if (pausedActiveIndices.length === 0 && scrollIdx >= 0) {
                        const line = lyrics.lines[scrollIdx];
                        if (clockMs >= line.startTimeMs && clockMs <= line.endTimeMs) {
                            pausedActiveIndices.push(scrollIdx);
                        }
                    }

                    lineStateMapRef.current.clear();
                    for (let i = 0; i < lineRefs.current.length; i++) {
                        const el = lineRefs.current[i];
                        if (!el) continue;
                        const line = lyrics.lines[i];
                        if (!line) continue;

                        if (pausedActiveIndices.includes(i)) {
                            lineStateMapRef.current.set(i, 'active');
                            setClass(el, 'Active', true);
                            setClass(el, 'active-line', true);
                            setClass(el, 'NotSung', false);
                            setClass(el, 'Sung', false);
                            setClass(el, 'passed-line', false);
                            if (isWordMode || el.classList.contains('instrumental')) {
                                updateActiveLineAnimation(el, clockMs, 0.016, line);
                            }
                        } else if (clockMs > line.endTimeMs) {
                            lineStateMapRef.current.set(i, 'passed');
                            settleLine(el, true);
                        } else {
                            lineStateMapRef.current.set(i, 'notsung');
                            settleLine(el, false);
                        }
                    }

                    applyLineBlur(lineRefs.current, pausedActiveIndices, scrollIdx);
                }
            }
        });
        return () => unsub();
    }, [lyrics]);

    // Real-time animation loop: frame-rate independent jitter filtering & analytical Fraktality physics
    useEffect(() => {
        if (!lyrics || lyrics.lines.length === 0) {
            return;
        }

        const updateFrame = () => {
            const now = performance.now();
            const deltaTime = Math.min(Math.max(0.001, (now - lastFrameTimeRef.current) / 1000), 0.1);
            lastFrameTimeRef.current = now;

            const currentStore = useAppStore.getState();
            const isPlayingNow = currentStore.currentSong.isPlaying;
            const elapsed = isPlayingNow ? Math.max(0, now - lastSampleTimeRef.current) : 0;
            const rawPosition = lastProgressRef.current + elapsed;

            // Forward lead offset (PROGRESS_POSITION_OFFSET = 100) compensates for audio driver output latency
            const measuredWithLead = rawPosition + PROGRESS_POSITION_OFFSET - currentStore.syncOffsetMs;
            const trackKey = currentStore.currentSong.id || `${currentStore.currentSong.title}::${currentStore.currentSong.artist}`;

            // Predictor smooths minor IPC jitter via low-pass filter (300ms TAU) while snapping on seeks (>500ms)
            const currentTimeMs = normalizeProgress(
                isPlayingNow ? measuredWithLead : (lastProgressRef.current - currentStore.syncOffsetMs),
                isPlayingNow,
                trackKey,
                currentStore.currentSong.duration
            );

            const scrollIndex = getScrollLineIndex(lyrics.lines, currentTimeMs);
            const prevIndex = activeLineRef.current;

            if (scrollIndex !== prevIndex) {
                activeLineRef.current = scrollIndex;
                setActiveLineIndex(scrollIndex);
            }

            // Gather all actively singing lines (handles concurrent and overlapping background vocals)
            const activeIndices: number[] = [];
            for (let i = 0; i < lyrics.lines.length; i++) {
                const line = lyrics.lines[i];
                if (currentTimeMs >= line.startTimeMs && currentTimeMs <= line.endTimeMs) {
                    activeIndices.push(i);
                }
            }
            if (activeIndices.length === 0 && scrollIndex >= 0) {
                const line = lyrics.lines[scrollIndex];
                if (currentTimeMs >= line.startTimeMs && currentTimeMs <= line.endTimeMs) {
                    activeIndices.push(scrollIndex);
                }
            }

            // Update each line concurrently so background vocals are animated in real-time
            for (let i = 0; i < lineRefs.current.length; i++) {
                const el = lineRefs.current[i];
                if (!el) continue;
                const line = lyrics.lines[i];
                if (!line) continue;

                const prevState = lineStateMapRef.current.get(i);

                if (activeIndices.includes(i)) {
                    if (prevState !== 'active') {
                        lineStateMapRef.current.set(i, 'active');
                        setClass(el, 'Active', true);
                        setClass(el, 'active-line', true);
                        setClass(el, 'NotSung', false);
                        setClass(el, 'Sung', false);
                        setClass(el, 'passed-line', false);
                    }

                    if (isWordMode || el.classList.contains('instrumental')) {
                        updateActiveLineAnimation(el, currentTimeMs, deltaTime, line);
                    } else {
                        // Line-mode only: smooth line wash
                        const linePct = getProgressPercentage(currentTimeMs, line.startTimeMs, line.endTimeMs);
                        const gradPos = -20 + 120 * linePct;
                        const wordFallback = el.querySelector<HTMLElement>('.word');
                        if (wordFallback) {
                            setStyleIfChanged(wordFallback, '--gradient-position', `${gradPos}%`, 0.2);
                            setStyleIfChanged(wordFallback, '--progress', `${linePct}`, 0.005);
                        }
                    }
                } else if (currentTimeMs > line.endTimeMs) {
                    if (prevState !== 'passed') {
                        lineStateMapRef.current.set(i, 'passed');
                        settleLine(el, true);
                    }
                } else {
                    if (prevState !== 'notsung') {
                        lineStateMapRef.current.set(i, 'notsung');
                        settleLine(el, false);
                    }
                }
            }

            applyLineBlur(lineRefs.current, activeIndices, scrollIndex);

            if (isPlaying) {
                animationFrameRef.current = requestAnimationFrame(updateFrame);
            }
        };

        // Initial update kicks off the animation loop
        updateFrame();

        return () => {
            if (animationFrameRef.current !== null) {
                cancelAnimationFrame(animationFrameRef.current);
                animationFrameRef.current = null;
            }
        };
    }, [lyrics, isPlaying, syncOffsetMs, isWordMode, songDuration, currentTrackKey]);

    // Smooth scroll into view when active line index changes
    useEffect(() => {
        if (activeAnimated) return;

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
    }, [activeLineIndex, activeAnimated]);

    const handleScrollInteraction = useCallback(() => {
        isUserScrollingRef.current = true;
        if (userScrollTimeoutRef.current) {
            window.clearTimeout(userScrollTimeoutRef.current);
        }
        userScrollTimeoutRef.current = window.setTimeout(() => {
            isUserScrollingRef.current = false;
        }, 3500);
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

    // In Animated Artwork mode, display current verse and any accompanying background vocals
    let primaryLeadIndex = activeLineIndex;
    if (primaryLeadIndex >= 0 && Boolean(lyrics.lines[primaryLeadIndex]?.isBackground)) {
        let p = primaryLeadIndex;
        while (p > 0 && Boolean(lyrics.lines[p]?.isBackground)) {
            p--;
        }
        if (!lyrics.lines[p]?.isBackground) {
            primaryLeadIndex = p;
        }
    }

    const primaryLine = (primaryLeadIndex >= 0 && primaryLeadIndex < lyrics.lines.length)
        ? lyrics.lines[primaryLeadIndex]
        : null;
    const isPrimaryBg = Boolean(primaryLine?.isBackground);
    const currentLeadLine = (!isPrimaryBg && primaryLine) ? primaryLine : null;
    const currentBgLines: { line: LyricLine; index: number }[] = [];

    if (isPrimaryBg && primaryLine) {
        currentBgLines.push({ line: primaryLine, index: primaryLeadIndex });
    } else if (primaryLeadIndex >= 0) {
        for (let i = primaryLeadIndex + 1; i < lyrics.lines.length && Boolean(lyrics.lines[i]?.isBackground); i++) {
            currentBgLines.push({ line: lyrics.lines[i], index: i });
        }
    }

    const hasAnyActiveVerse = Boolean(currentLeadLine || currentBgLines.length > 0);

    // In Animated Artwork mode, display current verse docked above metadata & controls
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
                            {hasAnyActiveVerse ? (
                                <motion.div
                                    key={`verse-group-${primaryLeadIndex}-${primaryLine?.startTimeMs ?? primaryLeadIndex}`}
                                    initial={{ opacity: 0, y: 12, filter: 'blur(6px)' }}
                                    animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
                                    exit={{ opacity: 0, y: -10, filter: 'blur(6px)' }}
                                    transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
                                    style={{ width: '100%' }}
                                >
                                    {currentLeadLine && (
                                        <LyricLineRenderer
                                            ref={(el) => { lineRefs.current[primaryLeadIndex] = el; }}
                                            line={currentLeadLine}
                                            isActive={activeLineIndex === primaryLeadIndex}
                                            isPast={activeLineIndex > primaryLeadIndex}
                                            isRomanized={isRomanized}
                                        />
                                    )}
                                    {currentBgLines.map((bg) => (
                                        <LyricLineRenderer
                                            key={`bg-${bg.index}-${bg.line.startTimeMs}`}
                                            ref={(el) => { lineRefs.current[bg.index] = el; }}
                                            line={bg.line}
                                            isActive={activeLineIndex === bg.index}
                                            isPast={activeLineIndex > bg.index}
                                            isRomanized={isRomanized}
                                        />
                                    ))}
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
