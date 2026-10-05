import React, { forwardRef, useMemo } from 'react';
import type { LyricLine, Word } from '../../utils/lyricsProvider';

interface LyricLineProps {
    line: LyricLine;
    isActive?: boolean;
    isPast?: boolean;
    isRomanized?: boolean;
}

export const LyricLineRenderer = React.memo(forwardRef<HTMLDivElement, LyricLineProps>(({
    line,
    isActive = false,
    isPast = false,
    isRomanized = false
}, ref) => {
    const isInstrumental = line.isInstrumental || line.words === '♪' || line.words?.includes('Instrumental');

    // Group syllables into semantic words using isPartOfWord (memoized to prevent array allocations)
    const wordGroups: Word[][] = useMemo(() => {
        if (!line.syllables || line.syllables.length === 0) return [];
        const groups: Word[][] = [];
        let currentGroup: Word[] = [];
        for (let i = 0; i < line.syllables.length; i++) {
            const syl = line.syllables[i];
            currentGroup.push(syl);
            if (!syl.isPartOfWord || i === line.syllables.length - 1) {
                groups.push(currentGroup);
                currentGroup = [];
            }
        }
        return groups;
    }, [line.syllables]);

    if (isInstrumental) {
        return (
            <div
                className={`lyric-line instrumental ${isActive ? 'active-line' : ''} ${isPast ? 'passed-line' : ''}`}
                ref={ref}
                data-start={line.startTimeMs}
                data-end={line.endTimeMs}
                role="separator"
                aria-label="Instrumental Break"
            >
                <div className="instrumental-dots">
                    {line.instrumentalDots ? (
                        line.instrumentalDots.map((dot, idx) => (
                            <span
                                key={idx}
                                className={`instrumental-dot dot-${idx + 1}`}
                                data-start={dot.startTimeMs}
                                data-end={dot.endTimeMs}
                            />
                        ))
                    ) : (
                        <>
                            <span className="instrumental-dot dot-1" data-start={line.startTimeMs} data-end={line.startTimeMs + Math.round((line.endTimeMs - line.startTimeMs) / 3)} />
                            <span className="instrumental-dot dot-2" data-start={line.startTimeMs + Math.round((line.endTimeMs - line.startTimeMs) / 3)} data-end={line.startTimeMs + Math.round(2 * (line.endTimeMs - line.startTimeMs) / 3)} />
                            <span className="instrumental-dot dot-3" data-start={line.startTimeMs + Math.round(2 * (line.endTimeMs - line.startTimeMs) / 3)} data-end={line.endTimeMs} />
                        </>
                    )}
                </div>
            </div>
        );
    }

    const displayText = line.words || line.text || '';
    const hasExistingParens = /^\s*\(.*?\)\s*$/.test(displayText);
    const isBackgroundLine = Boolean(line.isBackground || hasExistingParens);

    const lineClasses = [
        'lyric-line',
        isActive ? 'active-line' : '',
        isPast ? 'passed-line' : '',
        line.isOppositeAligned ? 'opposite-aligned' : '',
        isBackgroundLine ? 'bg-line' : ''
    ].filter(Boolean).join(' ');

    const hasSyllableParens = Boolean(
        line.syllables && line.syllables.length > 0 && (
            line.syllables[0]?.word?.startsWith('(') ||
            line.syllables[line.syllables.length - 1]?.word?.endsWith(')')
        )
    );
    const shouldRenderParen = isBackgroundLine && !hasExistingParens && !hasSyllableParens;

    return (
        <div
            className={lineClasses}
            ref={ref}
            data-start={line.startTimeMs}
            data-end={line.endTimeMs}
        >
            <div className="words-container">
                {shouldRenderParen && <span className="bg-paren">(</span>}
                {line.syllables && line.syllables.length > 0 ? (
                    wordGroups.map((group, gIdx) => (
                        <span key={gIdx} className="word-group">
                            {group.map((s: Word, sIdx: number) => {
                                const isLastInWord = sIdx === group.length - 1;
                                const wordClass = `word${s.isPartOfWord ? ' part-of-word' : ''}${isLastInWord ? ' last-syllable-in-word' : ''}`;

                                return (
                                    <span
                                        key={sIdx}
                                        className={wordClass}
                                        data-start={s.startTimeMs}
                                        data-end={s.endTimeMs}
                                    >
                                        {s.word}
                                    </span>
                                );
                            })}
                        </span>
                    ))
                ) : (
                    <span
                        className="word line-text-fallback"
                        data-start={line.startTimeMs}
                        data-end={line.endTimeMs}
                        style={{ whiteSpace: 'normal', display: 'inline', wordBreak: 'break-word', overflowWrap: 'break-word', overflow: 'visible' }}
                    >
                        {displayText}
                    </span>
                )}
                {shouldRenderParen && <span className="bg-paren">)</span>}
            </div>

            {isRomanized && displayText !== '' && (
                <span className="romanized" style={{ opacity: 0.5, fontSize: '0.6em', display: 'block', marginTop: '4px' }}>
                    {/* Romanized fallback */}
                </span>
            )}
        </div>
    );
}));

LyricLineRenderer.displayName = 'LyricLineRenderer';
