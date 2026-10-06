# Beautiful Lyrics 🎵

An Apple Music & macOS-inspired floating synchronized lyrics and live animated artwork desktop companion.

## Features

- **Real-Time Word-Synced Lyrics**: Syllable-by-syllable and word-by-word karaoke highlighting powered by Spicy Lyrics.
- **Instrumental Break Visualization**: Apple Music-style dynamic 3-dot interlude animations (`♪`).
- **Dual-Source Animated Artwork**:
  - **Spotify Canvas**: High-definition looping video canvases direct from Spotify.
  - **Apple Music Motion**: Official motion album artwork via Apple HLS (`.m3u8`) streaming.
  - Hardware-accelerated 2D Skia Canvas compositing eliminating transparent window occlusions.
- **System-Wide Desktop Music Detection**:
  - Native Windows SMTC / GSMTC background listener supporting Spotify Desktop, Apple Music for Windows, iTunes, Tidal, and Amazon Music.
  - Dual-source fallback with the included Chromium browser extension for web players (Spotify Web, YouTube Music, Apple Music Web).
- **macOS Liquid Glass UI**:
  - Glassmorphic translucency, SF Pro typography, dynamic/dark/light themes, custom traffic lights, and on-screen HUD notifications.

## Tech Stack

- **Desktop Framework**: Electron 40
- **Frontend**: React 19, TypeScript, Vite 7
- **Styling**: Apple HIG Glassmorphic CSS Design System
- **State Management**: Zustand
- **Real-Time Bridge**: Socket.io / Native Windows SMTC (PowerShell + C# P/Invoke)

## Getting Started

### Prerequisites

- Node.js (v18+ recommended)
- Windows 10/11 (for native SMTC listener)

### Development

```bash
# Install dependencies
npm install

# Start Vite dev server and Electron desktop app concurrently
npm run electron:dev
```

Alternatively, double-click `launch-lyrics.bat` to launch the app.

### Keyboard Shortcuts

- `Space`: Play / Pause
- `⌘` / `Ctrl` + `←`: Previous Track
- `⌘` / `Ctrl` + `→`: Next Track
- `⌘` / `Ctrl` + `P`: Toggle Pin (Always on Top)
- `⌘` / `Ctrl` + `T`: Toggle Theme (Dynamic / Dark / Light)
- `[`: Delay lyrics (-50ms offset)
- `]`: Advance lyrics (+50ms offset)
- `\`: Reset lyrics offset (0ms)
- `⌘` / `Ctrl` + `M`: Minimize Window
- `⌘` / `Ctrl` + `W`: Close Window
