import React, { useEffect, useRef, useState } from 'react';
import Hls from 'hls.js';

interface AnimatedBackgroundProps {
    videoUrl?: string | null;
    poster?: string;
    isPlaying: boolean;
    onError?: () => void;
}

type VideoWithFrameCallback = HTMLVideoElement & {
    requestVideoFrameCallback?: (callback: (now: DOMHighResTimeStamp, metadata: unknown) => void) => number;
    cancelVideoFrameCallback?: (id: number) => void;
};

export const AnimatedBackground: React.FC<AnimatedBackgroundProps> = ({
    videoUrl,
    poster,
    isPlaying,
    onError
}) => {
    const videoRef = useRef<HTMLVideoElement>(null);
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const [loadedUrl, setLoadedUrl] = useState<string | null>(null);
    const isVideoLoaded = Boolean(videoUrl && loadedUrl === videoUrl);
    const errorCountRef = useRef(0);
    const onErrorRef = useRef(onError);
    const isDisposedRef = useRef(false);

    useEffect(() => {
        onErrorRef.current = onError;
    }, [onError]);

    const isPlayingRef = useRef(isPlaying);
    useEffect(() => {
        isPlayingRef.current = isPlaying;
    }, [isPlaying]);

    const isHlsStream = Boolean(videoUrl && (videoUrl.includes('.m3u8') || videoUrl.includes('application/vnd.apple.mpegurl')));

    // Hardware-accelerated Canvas Compositor:
    // Paints video frames directly onto the window's Skia 2D surface via requestVideoFrameCallback.
    // This completely eliminates the Chromium transparent-window DirectComposition bug
    // where hardware <video> overlays remain invisible until the window is resized.
    useEffect(() => {
        const video = videoRef.current as VideoWithFrameCallback | null;
        const canvas = canvasRef.current;
        if (!video || !canvas || !videoUrl) return;

        let frameCallbackId: number | null = null;
        let animFrameId: number | null = null;
        let isLoopActive = true;

        const ctx = canvas.getContext('2d', { alpha: false });

        const drawFrame = () => {
            if (!isLoopActive || !video || !canvas) return;

            if (video.readyState >= 2 && video.videoWidth > 0 && video.videoHeight > 0) {
                if (canvas.width !== video.videoWidth || canvas.height !== video.videoHeight) {
                    canvas.width = video.videoWidth;
                    canvas.height = video.videoHeight;
                }
                if (ctx) {
                    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
                }
                if (!isVideoLoaded) {
                    setLoadedUrl(videoUrl);
                    window.electron?.triggerRepaint?.();
                }
            }

            if (typeof video.requestVideoFrameCallback === 'function') {
                frameCallbackId = video.requestVideoFrameCallback(drawFrame);
            } else {
                animFrameId = requestAnimationFrame(drawFrame);
            }
        };

        if (typeof video.requestVideoFrameCallback === 'function') {
            frameCallbackId = video.requestVideoFrameCallback(drawFrame);
        } else {
            animFrameId = requestAnimationFrame(drawFrame);
        }

        return () => {
            isLoopActive = false;
            if (frameCallbackId !== null && typeof video.cancelVideoFrameCallback === 'function') {
                video.cancelVideoFrameCallback(frameCallbackId);
            }
            if (animFrameId !== null) {
                cancelAnimationFrame(animFrameId);
            }
            if (canvas) {
                canvas.width = 0;
                canvas.height = 0;
            }
        };
    }, [videoUrl, isVideoLoaded]);

    useEffect(() => {
        const video = videoRef.current;
        if (!video || !videoUrl) return;

        isDisposedRef.current = false;
        errorCountRef.current = 0;

        // Permanent Audio Safety: ensure video is 100% muted and volume 0
        video.muted = true;
        video.volume = 0;

        let hls: Hls | null = null;

        const handleEnded = () => {
            if (videoRef.current && !isDisposedRef.current && isPlayingRef.current) {
                videoRef.current.currentTime = 0;
                videoRef.current.play().catch(() => {});
            }
        };

        const handleTimeUpdate = () => {
            const v = videoRef.current;
            // Seamless near-end loop to prevent MediaSource freeze or stall on short Apple Music clips
            if (v && !isDisposedRef.current && isPlayingRef.current && v.duration > 0 && v.currentTime >= v.duration - 0.12) {
                v.currentTime = 0;
                v.play().catch(() => {});
            }
        };

        video.addEventListener('ended', handleEnded);
        video.addEventListener('timeupdate', handleTimeUpdate);

        if (isHlsStream && Hls.isSupported()) {
            hls = new Hls({
                enableWorker: true,
                lowLatencyMode: false,
                backBufferLength: 30,
                maxBufferLength: 30,
                capLevelToPlayerSize: false, // Ensure full resolution regardless of player or window dimensions
            });

            hls.loadSource(videoUrl);
            hls.attachMedia(video);

            hls.on(Hls.Events.MANIFEST_PARSED, () => {
                if (isDisposedRef.current) return;
                // Lock stream to highest available Full HD resolution level
                if (hls && hls.levels && hls.levels.length > 0) {
                    let highestIdx = 0;
                    let maxRes = 0;
                    let maxBitrate = 0;
                    hls.levels.forEach((lvl, idx) => {
                        const res = (lvl.height || 0) * (lvl.width || 0);
                        if (res > maxRes || (res === maxRes && (lvl.bitrate || 0) > maxBitrate)) {
                            maxRes = res;
                            maxBitrate = lvl.bitrate || 0;
                            highestIdx = idx;
                        }
                    });
                    hls.currentLevel = highestIdx;
                    hls.loadLevel = highestIdx;
                }
                video.play().catch(() => {});
                window.electron?.triggerRepaint?.();
            });

            // Apple Music HLS loop: seamlessly rewind when buffer ends
            hls.on(Hls.Events.BUFFER_EOS, () => {
                if (video && !isDisposedRef.current && isPlayingRef.current) {
                    video.currentTime = 0;
                    video.play().catch(() => {});
                }
            });

            hls.on(Hls.Events.ERROR, (_, data) => {
                if (isDisposedRef.current) return;
                if (data.fatal) {
                    errorCountRef.current++;
                    if (errorCountRef.current > 3) {
                        console.warn('[AnimatedBackground] Fatal error loading stream:', data);
                        hls?.destroy();
                        onErrorRef.current?.();
                        return;
                    }
                    switch (data.type) {
                        case Hls.ErrorTypes.NETWORK_ERROR:
                            hls?.startLoad();
                            break;
                        case Hls.ErrorTypes.MEDIA_ERROR:
                            hls?.recoverMediaError();
                            break;
                        default:
                            hls?.destroy();
                            onErrorRef.current?.();
                            break;
                    }
                }
            });
        } else {
            // Direct MP4 (Spotify Canvas) or Safari native HLS
            video.src = videoUrl;
            video.play().catch(() => {});
            window.electron?.triggerRepaint?.();
        }

        // Clean Memory Teardown without generating false-positive browser error events
        return () => {
            isDisposedRef.current = true;
            video.removeEventListener('ended', handleEnded);
            video.removeEventListener('timeupdate', handleTimeUpdate);
            if (hls) {
                hls.destroy();
                hls = null;
            }
            if (video) {
                video.pause();
                video.removeAttribute('src');
                video.load();
            }
        };
    }, [videoUrl, isHlsStream]);

    // Synchronize play / pause with music playback state
    useEffect(() => {
        const video = videoRef.current;
        if (!video || isDisposedRef.current) return;

        if (isPlaying) {
            if (video.paused) {
                video.play().catch(() => {});
            }
        } else {
            if (!video.paused) {
                video.pause();
            }
        }
    }, [isPlaying]);

    return (
        <div
            className="animated-bg-root"
            style={{
                position: 'absolute',
                top: 0,
                left: 0,
                right: 0,
                bottom: 0,
                width: '100%',
                height: '100%',
                overflow: 'hidden',
                pointerEvents: 'none'
            }}
            aria-hidden="true"
        >
            {/* Poster fallback image displayed while video loads or as backdrop */}
            {poster && (
                <img
                    src={poster}
                    alt=""
                    className="animated-bg-poster"
                    style={{
                        position: 'absolute',
                        top: 0,
                        left: 0,
                        width: '100%',
                        height: '100%',
                        objectFit: 'cover',
                        objectPosition: 'center',
                        pointerEvents: 'none',
                        zIndex: 1,
                        opacity: isVideoLoaded ? 0 : 1,
                        transition: 'opacity 0.5s ease'
                    }}
                />
            )}

            {/* Hardware-accelerated Canvas Compositor: Guaranteed visible immediately at all window sizes */}
            <canvas
                ref={canvasRef}
                className="animated-bg-canvas"
                style={{
                    position: 'absolute',
                    top: 0,
                    left: 0,
                    width: '100%',
                    height: '100%',
                    objectFit: 'cover',
                    objectPosition: 'center',
                    pointerEvents: 'none',
                    zIndex: 2,
                    opacity: isVideoLoaded ? 1 : 0,
                    transition: 'opacity 0.4s ease'
                }}
            />

            {/* Fullscreen HLS / MP4 Animated Video Element (decodes frames at full hardware capability) */}
            <video
                ref={videoRef}
                autoPlay
                loop={!isHlsStream}
                muted
                playsInline
                disablePictureInPicture
                className="animated-bg-video"
                style={{
                    position: 'absolute',
                    top: 0,
                    left: 0,
                    width: '100%',
                    height: '100%',
                    objectFit: 'cover',
                    objectPosition: 'center',
                    pointerEvents: 'none',
                    zIndex: 0,
                    opacity: 0.001
                }}
                onLoadedData={() => {
                    if (!isDisposedRef.current && videoUrl) {
                        setLoadedUrl(videoUrl);
                        window.electron?.triggerRepaint?.();
                    }
                }}
                onPlaying={() => {
                    if (!isDisposedRef.current && videoUrl) {
                        setLoadedUrl(videoUrl);
                        window.electron?.triggerRepaint?.();
                    }
                }}
                onError={() => {
                    if (isDisposedRef.current) return;
                    const mediaErr = videoRef.current?.error;
                    // Code 1 = MEDIA_ERR_ABORTED (transient, e.g. aborted fetch or normal re-sync)
                    if (!mediaErr || mediaErr.code === 1) return;
                    if (!videoRef.current?.currentSrc && !videoRef.current?.src) return;

                    errorCountRef.current++;
                    console.warn('[AnimatedBackground] Native video element error:', mediaErr.code, mediaErr.message);
                    if (errorCountRef.current > 3) {
                        onErrorRef.current?.();
                    }
                }}
            />
        </div>
    );
};
