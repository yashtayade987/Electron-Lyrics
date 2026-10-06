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

    const rawText = line.words || line.text || '';
    const hasExistingParens = /[()]/.test(rawText);
    const isBackgroundLine = Boolean(line.isBackground || hasExistingParens);
    const displayText = isBackgroundLine ? rawText.replace(/[()]/g, '').trim() : rawText;

    const lineClasses = [
        'lyric-line',
        isActive ? 'active-line Active' : 'NotSung',
        isPast ? 'passed-line Sung' : '',
        line.isOppositeAligned ? 'opposite-aligned' : '',
        isBackgroundLine ? 'bg-line' : ''
    ].filter(Boolean).join(' ');

    return (
        <div
            className={lineClasses}
            ref={ref}
            data-start={line.startTimeMs}
            data-end={line.endTimeMs}
        >
            <div className="words-container">
                {line.syllables && line.syllables.length > 0 ? (
                    wordGroups.map((group, gIdx) => (
                        <span key={gIdx} className="word-group">
                            {group.map((s: Word, sIdx: number) => {
                                const isLastInWord = sIdx === group.length - 1;
                                const isLetterGroup = Boolean(s.letters && s.letters.length > 0);
                                const wordClass = `word${s.isPartOfWord ? ' part-of-word' : ''}${isLastInWord ? ' last-syllable-in-word' : ''}${isLetterGroup ? ' letterGroup' : ''}`;
                                const displayWord = isBackgroundLine ? s.word.replace(/[()]/g, '').trim() : s.word;
                                const lettersToRender = isLetterGroup && isBackgroundLine
                                    ? s.letters!.filter((l) => l.letter !== '(' && l.letter !== ')')
                                    : (s.letters || []);

                                return (
                                    <span
                                        key={sIdx}
                                        className={wordClass}
                                        data-start={s.startTimeMs}
                                        data-end={s.endTimeMs}
                                    >
                                        {isLetterGroup ? (
                                            lettersToRender.map((letObj, letIdx) => {
                                                const isSpace = letObj.letter.trim().length === 0;
                                                const isLastLetter = letIdx === lettersToRender.length - 1;
                                                const letterClass = `letter${isSpace ? ' SpaceLetter' : ''}${isLastLetter ? ' LastLetterInWord' : ''}`;
                                                return (
                                                    <span
                                                        key={letIdx}
                                                        className={letterClass}
                                                        data-start={letObj.startTimeMs}
                                                        data-end={letObj.endTimeMs}
                                                    >
                                                        {letObj.letter}
                                                    </span>
                                                );
                                            })
                                        ) : (
                                            displayWord
                                        )}
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
