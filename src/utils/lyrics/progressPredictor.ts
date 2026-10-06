import { CubicSpline } from './spline';
import type { LyricLine } from '../lyricsProvider';

export type LyricElementState = 'NotSung' | 'Active' | 'Sung';

/**
 * Lead offset (ms) added to clock position to compensate for perceptual audio driver latency.
 * Exact value ported from Spicy Lyrics 6.3.153 (replaces legacy 600ms latency hack).
 */
export const PROGRESS_POSITION_OFFSET = 100;

/**
 * Deltas within this threshold are treated as jitter and smoothed gently;
 * larger deltas (seeks/track changes) snap immediately without lag.
 */
export const JITTER_RESYNC_THRESHOLD = 500;

/**
 * Low-pass time constant (ms) for the jitter filter:
 * alpha = 1 - Math.exp(-elapsed / TAU) ensuring frame-rate independent low-pass smoothing.
 */
export const JITTER_TIME_CONSTANT = 300;

/**
 * Milliseconds before the end of an instrumental dot line to apply pre-hidden styling.
 */
export const preHiddenDotLineMs = 500;

export interface PredictedProgressState {
    trackId: string | null;
    position: number;
    updatedAt: number;
}

let predictedProgress: PredictedProgressState | null = null;

export function clampToTrack(position: number, duration?: number): number {
    let clamped = Math.max(0, position);
    if (duration && duration > 0) {
        clamped = Math.min(clamped, duration);
    }
    return clamped;
}

/**
 * Smooths raw player position updates into a stable, jitter-free lyric clock.
 * Ported directly from Spicy Lyrics 6.3.153 GetProgress.ts normalizeProgress.
 */
export function normalizeProgress(
    measuredPosition: number,
    isPlaying: boolean,
    trackId: string | null = null,
    duration?: number
): number {
    const measured = clampToTrack(measuredPosition, duration);
    const now = performance.now();

    // Reset on first sample, track change, or while paused
    if (!predictedProgress || predictedProgress.trackId !== trackId || !isPlaying) {
        predictedProgress = {
            trackId,
            position: measured,
            updatedAt: now
        };
        return measured;
    }

    // Advance prediction by wall-clock time elapsed since the last tick
    const elapsed = Math.max(0, now - predictedProgress.updatedAt);
    let predicted = predictedProgress.position + elapsed;

    const error = measured - predicted;
    if (Math.abs(error) > JITTER_RESYNC_THRESHOLD) {
        // Discontinuity / seek / track skip -> snap immediately
        predicted = measured;
    } else {
        // Continuous playback jitter -> low-pass filter toward measured progress
        const alpha = 1 - Math.exp(-elapsed / JITTER_TIME_CONSTANT);
        predicted += error * alpha;
    }

    predicted = clampToTrack(predicted, duration);
    predictedProgress = {
        trackId,
        position: predicted,
        updatedAt: now
    };

    return predicted;
}

export function resetProgressPrediction(): void {
    predictedProgress = null;
}

/**
 * Computes exact state for a lyric line, word, or dot.
 * Ported from Spicy Lyrics 6.3.153 getElementState.
 */
export function getElementState(
    currentTime: number,
    startTime: number,
    endTime: number
): LyricElementState {
    if (currentTime < startTime) return 'NotSung';
    if (currentTime >= endTime) return 'Sung';
    return 'Active';
}

/**
 * Computes progress fraction [0, 1] for an active element.
 * Ported from Spicy Lyrics 6.3.153 getProgressPercentage.
 */
export function getProgressPercentage(
    currentTime: number,
    startTime: number,
    endTime: number
): number {
    if (currentTime <= startTime) return 0;
    if (currentTime >= endTime) return 1;
    const duration = endTime - startTime;
    return duration > 0 ? (currentTime - startTime) / duration : 1;
}

// ==========================================
// Spicy Lyrics 6.3.153 Animation Splines & Physics
// ==========================================

export const ScaleRange = [
    { Time: 0, Value: 0.95 },
    { Time: 0.7, Value: 1.0505 },
    { Time: 1, Value: 1 },
];

export const YOffsetRange = [
    { Time: 0, Value: 1 / 100 },
    { Time: 0.9, Value: -(1 / 60) },
    { Time: 1, Value: 0 },
];

export const GlowRange = [
    { Time: 0, Value: 0 },
    { Time: 0.15, Value: 1 },
    { Time: 0.6, Value: 1 },
    { Time: 1, Value: 0 },
];

export const DotAnimations = {
    YOffsetDamping: 0.4,
    YOffsetFrequency: 1.25,
    ScaleDamping: 0.6,
    ScaleFrequency: 0.7,
    GlowDamping: 0.5,
    GlowFrequency: 1.0,
    OpacityDamping: 0.5,
    OpacityFrequency: 1.0,

    ScaleRange: [
        { Time: 0, Value: 0.75 },
        { Time: 0.7, Value: 1.05 },
        { Time: 1, Value: 1 },
    ],
    YOffsetRange: [
        { Time: 0, Value: 0 },
        { Time: 0.9, Value: -0.12 },
        { Time: 1, Value: 0 },
    ],
    GlowRange: [
        { Time: 0, Value: 0 },
        { Time: 0.6, Value: 1 },
        { Time: 1, Value: 1 },
    ],
    OpacityRange: [
        { Time: 0, Value: 0.35 },
        { Time: 0.6, Value: 1 },
        { Time: 1, Value: 1 },
    ],
};

export const LetterScaleRange = [
    { Time: 0, Value: 0.95 },
    { Time: 0.7, Value: 1.175 },
    { Time: 1, Value: 1 },
];

export const LetterYOffsetRange = [
    { Time: 0, Value: 1 / 100 },
    { Time: 0.9, Value: -(1 / 56) },
    { Time: 1, Value: 0 },
];

export const LetterGlowMultiplier_Opacity = 185;

export const WordSpringConstants = {
    ScaleFrequency: 0.88,
    ScaleDamping: 0.64,
    YOffsetFrequency: 1.45,
    YOffsetDamping: 0.40,
    GlowFrequency: 1.18,
    GlowDamping: 0.56,
};

export const ScaleSpline = new CubicSpline(ScaleRange);
export const YOffsetSpline = new CubicSpline(YOffsetRange);
export const GlowSpline = new CubicSpline(GlowRange);

export const LetterScaleSpline = new CubicSpline(LetterScaleRange);
export const LetterYOffsetSpline = new CubicSpline(LetterYOffsetRange);

export const DotScaleSpline = new CubicSpline(DotAnimations.ScaleRange);
export const DotYOffsetSpline = new CubicSpline(DotAnimations.YOffsetRange);
export const DotGlowSpline = new CubicSpline(DotAnimations.GlowRange);
export const DotOpacitySpline = new CubicSpline(DotAnimations.OpacityRange);

// ==========================================
// Scroll Target Resolution (ScrollToActiveLine)
// ==========================================

const PIN_LOOKAHEAD = 2;

function isBGLine(line: LyricLine): boolean {
    return Boolean(line.isBackground);
}

function resolveToLeadIndex(lines: LyricLine[], index: number, position?: number): number {
    let i = index;
    while (i > 0 && isBGLine(lines[i])) {
        i--;
    }
    // If the lead line has already finished singing, focus on the background line itself
    if (position !== undefined && lines[i].endTimeMs < position) {
        return index;
    }
    return i;
}

function getGroupEndTime(lines: LyricLine[], leadIdx: number): number {
    let end = lines[leadIdx].endTimeMs;
    for (let i = leadIdx + 1; i < lines.length && isBGLine(lines[i]); i++) {
        if (lines[i].endTimeMs > end) end = lines[i].endTimeMs;
    }
    return end;
}

function getLookaheadLine(lines: LyricLine[], leadIdx: number): LyricLine | null {
    let remaining = PIN_LOOKAHEAD;
    for (let i = leadIdx + 1; i < lines.length; i++) {
        if (isBGLine(lines[i])) continue;
        if (--remaining === 0) return lines[i];
    }
    return null;
}

/**
 * Determines the primary scroll target line index for the current clock position.
 * Implements Spicy Lyrics 6.3.153 lead group resolving and lookahead pin logic.
 */
export function getScrollLineIndex(lines: LyricLine[], processedPosition: number): number {
    if (!lines || lines.length === 0) return -1;

    // 1. Gather all actively sung lines
    const activeIndices: number[] = [];
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (line.startTimeMs <= processedPosition && line.endTimeMs >= processedPosition) {
            activeIndices.push(i);
        }
    }

    // 2. If no lines currently active (interlude or gap between lines)
    if (activeIndices.length === 0) {
        if (processedPosition < lines[0].startTimeMs) {
            return lines[0].isInstrumental ? 0 : -1;
        }
        let lastStarted = -1;
        for (let i = 0; i < lines.length; i++) {
            if (lines[i].startTimeMs <= processedPosition) {
                lastStarted = i;
            } else {
                break;
            }
        }
        return lastStarted;
    }

    // 3. Resolve active lines to lead vocal groups
    let frontLead = -1;
    for (const index of activeIndices) {
        const lead = resolveToLeadIndex(lines, index, processedPosition);
        if (lead > frontLead) frontLead = lead;
    }

    const activeLeads: number[] = [];
    for (const index of activeIndices) {
        const lead = resolveToLeadIndex(lines, index, processedPosition);
        if (isBGLine(lines[index]) && lead < frontLead && lines[lead].endTimeMs >= processedPosition) continue;
        if (activeLeads[activeLeads.length - 1] !== lead) {
            activeLeads.push(lead);
        }
    }

    if (activeLeads.length === 0) return activeIndices[0];

    const anchorIdx = activeLeads[0];
    const lookahead = getLookaheadLine(lines, anchorIdx);
    if (lookahead === null || getGroupEndTime(lines, anchorIdx) <= lookahead.startTimeMs) {
        return anchorIdx;
    }

    const firstIdx = activeLeads[0];
    const lastIdx = activeLeads[activeLeads.length - 1];
    return lastIdx - firstIdx <= 1 ? firstIdx : lastIdx;
}
