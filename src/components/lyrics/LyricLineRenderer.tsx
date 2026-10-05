import React, { forwardRef, useMemo } from 'react';
import type { LyricLine, Word, Letter } from '../../utils/lyricsProvider';

interface LyricLineProps {
    line: LyricLine;
    isRomanized: boolean;
    isActive?: boolean;
}

export const LyricLineRenderer = React.memo(forwardRef<HTMLDivElement, LyricLineProps>(({
    line,
    isRomanized,
    isActive = false
}, ref) => {

    // Apple Music / Spicy Lyrics 3 dots for instrumental gaps
    const isInstrumental = line.isInstrumental || line.words === '♪' || line.words.includes('Instrumental');

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
                className={`lyric-line instrumental ${isActive ? 'active-line' : ''}`}
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

    const lineClasses = [
        'lyric-line',
        isActive ? 'active-line' : '',
        line.isOppositeAligned ? 'opposite-aligned' : '',
        line.isBackground ? 'bg-line' : ''
    ].filter(Boolean).join(' ');

    return (
        <div
            className={lineClasses}
            ref={ref}
            data-start={line.startTimeMs}
            data-end={line.endTimeMs}
        >
            <div className="words-container">
                {line.isBackground && line.syllables && <span className="bg-paren">(</span>}
                {line.syllables ? (
                    wordGroups.map((group, gIdx) => (
                        <span key={gIdx} className="word-group">
                            {group.map((s: Word, sIdx: number) => {
                                const isLastInWord = sIdx === group.length - 1;
                                const wordClass = `word${s.letters && s.letters.length > 0 ? ' letterGroup' : ''}${s.isPartOfWord ? ' part-of-word' : ''}${isLastInWord ? ' last-syllable-in-word' : ''}`;

                                if (s.letters && s.letters.length > 0) {
                                    return (
                                        <span
                                            key={sIdx}
                                            className={wordClass}
                                            data-start={s.startTimeMs}
                                            data-end={s.endTimeMs}
                                        >
                                            {s.letters.map((l: Letter, lIdx: number) => (
                                                <span
                                                    key={lIdx}
                                                    className={`letter${l.letter.trim().length === 0 ? ' space-letter' : ''}`}
                                                    data-start={l.startTimeMs}
                                                    data-end={l.endTimeMs}
                                                >
                                                    {l.letter}
                                                </span>
                                            ))}
                                        </span>
                                    );
                                }

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
                        className="word"
                        data-start={line.startTimeMs}
                        data-end={line.endTimeMs}
                    >
                        {line.words}
                    </span>
                )}
                {line.isBackground && line.syllables && <span className="bg-paren">)</span>}
            </div>

            {isRomanized && line.words !== "" && (
                <span className="romanized" style={{ opacity: 0.5, fontSize: '0.6em', display: 'block', marginTop: '4px' }}>
                    {/* Romanized fallback placeholder */}
                </span>
            )}
        </div>
    );
}));

LyricLineRenderer.displayName = 'LyricLineRenderer';
