import React, { useCallback, useRef, useEffect } from 'react';

type ResizeDirection = 'left' | 'right' | 'bottom' | 'bottom-right' | 'bottom-left';

export const ResizeHandles: React.FC = () => {
    const isResizing = useRef(false);
    const directionRef = useRef<ResizeDirection | null>(null);
    const startScreenPos = useRef({ x: 0, y: 0 });
    const animFrameId = useRef<number>(0);

    const getCursor = (dir: ResizeDirection) => {
        switch (dir) {
            case 'left': return 'ew-resize';
            case 'right': return 'ew-resize';
            case 'bottom': return 'ns-resize';
            case 'bottom-right': return 'nwse-resize';
            case 'bottom-left': return 'nesw-resize';
            default: return 'default';
        }
    };

    const sendResize = useCallback((e: MouseEvent) => {
        if (!isResizing.current || !directionRef.current) return;

        const deltaX = e.screenX - startScreenPos.current.x;
        const deltaY = e.screenY - startScreenPos.current.y;
        startScreenPos.current = { x: e.screenX, y: e.screenY };

        if (deltaX !== 0 || deltaY !== 0) {
            try {
                // @ts-expect-error Electron IPC is injected on window
                window.electron?.resize({
                    direction: directionRef.current,
                    deltaX,
                    deltaY
                });
            } catch (err) {
                console.error('[ResizeHandles] IPC error:', err);
            }
        }
    }, []);

    const handleMouseMove = useCallback((e: MouseEvent) => {
        e.preventDefault();
        if (animFrameId.current) cancelAnimationFrame(animFrameId.current);
        animFrameId.current = requestAnimationFrame(() => sendResize(e));
    }, [sendResize]);

    const stopResizeRef = useRef<() => void>(() => {});
    const stopResize = useCallback(() => {
        isResizing.current = false;
        directionRef.current = null;
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
        document.removeEventListener('mousemove', handleMouseMove, true);
        document.removeEventListener('mouseup', stopResizeRef.current, true);
        if (animFrameId.current) cancelAnimationFrame(animFrameId.current);
    }, [handleMouseMove]);

    useEffect(() => {
        stopResizeRef.current = stopResize;
    }, [stopResize]);

    const startResize = useCallback((e: React.MouseEvent, dir: ResizeDirection) => {
        e.preventDefault();
        e.stopPropagation();

        isResizing.current = true;
        directionRef.current = dir;
        startScreenPos.current = { x: e.screenX, y: e.screenY };

        document.body.style.cursor = getCursor(dir);
        document.body.style.userSelect = 'none';

        // Use capture phase to intercept events before anything else
        document.addEventListener('mousemove', handleMouseMove, true);
        document.addEventListener('mouseup', stopResize, true);
    }, [handleMouseMove, stopResize]);

    return (
        <>
            <div
                className="resize-handle resize-left"
                onMouseDown={(e) => startResize(e, 'left')}
            />
            <div
                className="resize-handle resize-right"
                onMouseDown={(e) => startResize(e, 'right')}
            />
            <div
                className="resize-handle resize-bottom"
                onMouseDown={(e) => startResize(e, 'bottom')}
            />
            <div
                className="resize-handle resize-bottom-right"
                onMouseDown={(e) => startResize(e, 'bottom-right')}
            />
            <div
                className="resize-handle resize-bottom-left"
                onMouseDown={(e) => startResize(e, 'bottom-left')}
            />
        </>
    );
};
