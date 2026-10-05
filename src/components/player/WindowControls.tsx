import { Pin, Sparkles, Moon, Sun } from 'lucide-react';
import { useState } from 'react';
import { useAppStore } from '../../store/useAppStore';
import './WindowControls.css';

// Authentic Official Music Service SVG Logos
const YouTubeMusicLogo = ({ size = 20 }: { size?: number }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" className="service-logo yt-music-logo">
        <circle cx="12" cy="12" r="11" fill="#FF0000" />
        <circle cx="12" cy="12" r="6.8" stroke="white" strokeWidth="1.6" fill="none" />
        <polygon points="10.2,8.5 15.5,12 10.2,15.5" fill="white" />
    </svg>
);

const SpotifyLogo = ({ size = 20 }: { size?: number }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" className="service-logo spotify-logo">
        <circle cx="12" cy="12" r="11" fill="#1DB954" />
        <path
            d="M16.5 10.2c-2.9-1.7-7.7-1.9-10.5-1-.4.1-.9-.1-1-.5-.1-.4.1-.9.5-1 3.3-1 8.7-.8 12 1.2.4.2.5.8.3 1.2-.2.4-.7.5-1.3.1zm-.3 3.1c-.2.4-.7.5-1.1.2-2.4-1.5-6.2-2-9.1-1-.4.1-.8-.1-.9-.5-.1-.4.1-.8.5-1 3.3-1 7.5-.5 10.3 1.2.3.1.5.6.3 1.1zm-1.2 3c-.2.3-.6.4-.9.2-2.1-1.3-4.9-1.6-8.1-.9-.3.1-.7-.1-.8-.4-.1-.3.1-.7.4-.8 3.5-.8 6.6-.5 9 1 .3.2.4.6.4.9z"
            fill="#000000"
        />
    </svg>
);

const AppleMusicLogo = ({ size = 20 }: { size?: number }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" className="service-logo apple-music-logo">
        <defs>
            <linearGradient id="appleMusicGrad" x1="0%" y1="0%" x2="100%" y2="100%">
                <stop offset="0%" stopColor="#FA243C" />
                <stop offset="100%" stopColor="#FB5C74" />
            </linearGradient>
        </defs>
        <rect width="22" height="22" x="1" y="1" rx="6" fill="url(#appleMusicGrad)" />
        <path
            d="M15.5 6.5v8.2a2.3 2.3 0 1 1-2-2.3V8.8l-5 1.4v6.5a2.3 2.3 0 1 1-2-2.3V8.2c0-.7.5-1.2 1.2-1.4l6.5-1.8c.7-.2 1.3.3 1.3 1.5z"
            fill="white"
        />
    </svg>
);

export const WindowControls = () => {
    const [isPinned, setIsPinned] = useState(true);
    const { theme, setTheme, isConnected, showHud, currentSong } = useAppStore();

    const handleClose = (e: React.MouseEvent | React.PointerEvent) => {
        e.preventDefault();
        e.stopPropagation();
        console.log('[WindowControls] Close clicked');
        if (window.electron?.close) {
            window.electron.close();
        } else {
            showHud("Close Window (Electron App)");
            try {
                window.close();
            } catch {
                // browser security fallback
            }
        }
    };

    const handleMinimize = (e: React.MouseEvent | React.PointerEvent) => {
        e.preventDefault();
        e.stopPropagation();
        console.log('[WindowControls] Minimize clicked');
        if (window.electron?.minimize) {
            window.electron.minimize();
        } else {
            showHud("Minimize Window (Electron App)");
        }
    };

    const handleTogglePin = (e: React.MouseEvent | React.PointerEvent) => {
        e.preventDefault();
        e.stopPropagation();
        const nextPin = !isPinned;
        console.log(`[WindowControls] Pin clicked, next: ${nextPin}`);
        setIsPinned(nextPin);
        window.electron?.togglePin(nextPin);
        showHud(nextPin ? "Window Pinned (Always on Top)" : "Window Unpinned");
    };

    const handleThemeToggle = (e: React.MouseEvent | React.PointerEvent) => {
        e.preventDefault();
        e.stopPropagation();
        console.log('[WindowControls] Theme clicked');
        let nextTheme: 'dynamic' | 'dark' | 'light';
        if (theme === 'dynamic') nextTheme = 'dark';
        else if (theme === 'dark') nextTheme = 'light';
        else nextTheme = 'dynamic';
        setTheme(nextTheme);
        showHud(`${nextTheme.charAt(0).toUpperCase() + nextTheme.slice(1)} Mode`);
    };

    const handleServiceClick = (e: React.MouseEvent | React.PointerEvent) => {
        e.preventDefault();
        e.stopPropagation();
        console.log('[WindowControls] Music Service logo clicked');
        window.dispatchEvent(new CustomEvent('app:reconnect-socket'));

        const serviceName = currentSong.source === 'spotify'
            ? 'Spotify'
            : currentSong.source === 'apple'
            ? 'Apple Music'
            : 'YouTube Music';

        if (isConnected) {
            showHud(`Connected: ${serviceName}`);
        } else {
            showHud(`Waiting for ${serviceName} / Reconnecting Bridge...`);
        }
    };

    const ThemeIcon = theme === 'dynamic' ? Sparkles : theme === 'dark' ? Moon : Sun;
    const themeTitle = `Theme: ${theme.charAt(0).toUpperCase() + theme.slice(1)} (⌘T)`;

    // Select logo based on active song source
    const activeSource = currentSong.source || 'youtube';
    const serviceName = activeSource === 'spotify'
        ? 'Spotify'
        : activeSource === 'apple'
        ? 'Apple Music'
        : 'YouTube Music';

    const serviceTitle = isConnected
        ? `${serviceName} Connected`
        : `${serviceName} Offline (Click to reconnect)`;

    return (
        <header className="mac-titlebar" role="toolbar" aria-label="Window Controls">
            {/* LEFT SIDE: Service Logo and Theme Button (clean, no surrounding pill) */}
            <div
                className="titlebar-actions-group titlebar-left-controls"
                role="group"
                aria-label="Quick Actions"
                onPointerDown={(e) => e.stopPropagation()}
            >
                <button
                    className={`titlebar-icon-btn service-logo-btn ${isConnected ? 'connected' : 'disconnected'}`}
                    onClick={handleServiceClick}
                    onPointerDown={(e) => e.stopPropagation()}
                    title={serviceTitle}
                    aria-label={serviceTitle}
                >
                    {activeSource === 'spotify' ? (
                        <SpotifyLogo size={20} />
                    ) : activeSource === 'apple' ? (
                        <AppleMusicLogo size={20} />
                    ) : (
                        <YouTubeMusicLogo size={20} />
                    )}
                    {!isConnected && <span className="service-offline-badge" title="Offline" />}
                </button>

                <button
                    className="titlebar-icon-btn theme-btn"
                    onClick={handleThemeToggle}
                    onPointerDown={(e) => e.stopPropagation()}
                    title={themeTitle}
                    aria-label={themeTitle}
                >
                    <ThemeIcon size={16} />
                </button>
            </div>

            {/* Draggable Titlebar Region in Middle */}
            <div className="titlebar-drag-region" />

            {/* RIGHT SIDE: macOS Authentic Traffic Light Buttons */}
            <div
                className="traffic-lights-group titlebar-right-traffic-lights"
                role="group"
                aria-label="Window Management"
                onPointerDown={(e) => e.stopPropagation()}
            >
                <button
                    className="traffic-light close"
                    onClick={handleClose}
                    onPointerDown={(e) => e.stopPropagation()}
                    title="Close Window (⌘W)"
                    aria-label="Close Window (⌘W)"
                >
                    <span className="traffic-light-glyph" aria-hidden="true">✕</span>
                </button>
                <button
                    className="traffic-light minimize"
                    onClick={handleMinimize}
                    onPointerDown={(e) => e.stopPropagation()}
                    title="Minimize Window (⌘M)"
                    aria-label="Minimize Window (⌘M)"
                >
                    <span className="traffic-light-glyph" aria-hidden="true">−</span>
                </button>
                <button
                    className={`traffic-light pin ${isPinned ? 'pinned' : ''}`}
                    onClick={handleTogglePin}
                    onPointerDown={(e) => e.stopPropagation()}
                    title={isPinned ? "Unpin Window (⌘P)" : "Pin Window on Top (⌘P)"}
                    aria-label={isPinned ? "Unpin Window" : "Pin Window on Top"}
                >
                    <span className="traffic-light-glyph" aria-hidden="true">
                        <Pin size={8} strokeWidth={3} />
                    </span>
                </button>
            </div>
        </header>
    );
};
