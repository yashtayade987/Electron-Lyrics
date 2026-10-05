import React, { useEffect, useRef, useState } from 'react';
import Hls from 'hls.js';

interface AnimatedArtworkBackgroundProps {
    videoUrl: string;
    poster?: string;
    isPlaying: boolean;
    onError?: () => void;
}

export const AnimatedArtworkBackground: React.FC<AnimatedArtworkBackgroundProps> = ({
    videoUrl,
    poster,
    isPlaying,
    onError
}) => {
    const videoRef = useRef<HTMLVideoElement>(null);
    const [isVideoReady, setIsVideoReady] = useState(false);
    const errorCountRef = useRef(0);
    const onErrorRef = useRef(onError);

    useEffect(() => {
        onErrorRef.current = onError;
    }, [onError]);

    const isPlayingRef = useRef(isPlaying);
    useEffect(() => {
        isPlayingRef.current = isPlaying;
    }, [isPlaying]);

    useEffect(() => {
        const video = videoRef.current;
        if (!video || !videoUrl) return;

        // Permanent Audio Safety: ensure video is 100% muted and volume 0
        video.muted = true;
        video.volume = 0;

        let hls: Hls | null = null;
        const resetFrame = requestAnimationFrame(() => setIsVideoReady(false));
        errorCountRef.current = 0;

        const isHlsStream = videoUrl.includes('.m3u8') || videoUrl.includes('application/vnd.apple.mpegurl');

        if (isHlsStream && Hls.isSupported()) {
            hls = new Hls({
                enableWorker: true,
                lowLatencyMode: false,
                backBufferLength: 30,
                maxBufferLength: 15,
            });

            hls.loadSource(videoUrl);
            hls.attachMedia(video);

            hls.on(Hls.Events.MANIFEST_PARSED, () => {
                if (isPlayingRef.current) {
                    video.play().catch(() => {});
                }
            });

            hls.on(Hls.Events.ERROR, (_, data) => {
                if (data.fatal) {
                    errorCountRef.current++;
                    if (errorCountRef.current > 2) {
                        console.warn('[AnimatedArtworkBackground] Fatal error loading stream:', data);
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
            // Direct MP4 video (e.g. Spotify Canvas) or Safari native HLS
            video.src = videoUrl;
            if (isPlayingRef.current) {
                video.play().catch(() => {});
            }
        }

        return () => {
            cancelAnimationFrame(resetFrame);
            if (hls) {
                hls.destroy();
            }
            if (video) {
                video.pause();
                video.removeAttribute('src');
                video.load();
            }
        };
    }, [videoUrl]);

    // Synchronize play / pause with music playback state
    useEffect(() => {
        const video = videoRef.current;
        if (!video) return;

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
        <div className="animated-bg-root" aria-hidden="true">
            {/* Poster fallback image displayed while video loads */}
            {poster && (
                <img
                    src={poster}
                    alt=""
                    className="animated-bg-poster"
                    style={{
                        opacity: isVideoReady ? 0.35 : 1,
                        transition: 'opacity 0.6s cubic-bezier(0.16, 1, 0.3, 1)'
                    }}
                />
            )}

            {/* Fullscreen HLS / MP4 Animated Video Element */}
            <video
                ref={videoRef}
                muted
                loop
                playsInline
                autoPlay
                className="animated-bg-video"
                onLoadedData={() => setIsVideoReady(true)}
                onPlaying={() => setIsVideoReady(true)}
                onError={() => {
                    console.warn('[AnimatedArtworkBackground] Native video element error');
                    onError?.();
                }}
                style={{
                    opacity: isVideoReady ? 1 : 0,
                    transition: 'opacity 0.6s cubic-bezier(0.16, 1, 0.3, 1)'
                }}
            />

            {/* Readability Treatment Overlay: subtle blur & dark translucent gradient */}
            <div className="animated-bg-readability-overlay" />
        </div>
    );
};
