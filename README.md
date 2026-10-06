# Beautiful Lyrics 🎵

<p align="center">
  <img src="public/icon.png" alt="Beautiful Lyrics Logo" width="128" height="128" onerror="this.style.display='none'"/>
</p>

<p align="center">
  <strong>An Apple Music & macOS-inspired floating lyrics and live animated artwork companion for desktop music playback.</strong>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/Platform-Windows%2010%20%2F%2011-0078D6?logo=windows&logoColor=white" alt="Platform: Windows" />
  <img src="https://img.shields.io/badge/Electron-40.x-47848F?logo=electron&logoColor=white" alt="Electron 40" />
  <img src="https://img.shields.io/badge/React-19.x-61DAFB?logo=react&logoColor=black" alt="React 19" />
  <img src="https://img.shields.io/badge/TypeScript-5.9-3178C6?logo=typescript&logoColor=white" alt="TypeScript" />
  <img src="https://img.shields.io/badge/Vite-7.x-646CFF?logo=vite&logoColor=white" alt="Vite 7" />
  <img src="https://img.shields.io/badge/License-MIT-green" alt="License: MIT" />
</p>

---

## ✨ Overview

**Beautiful Lyrics** is a lightweight, frameless floating desktop application that brings the signature Apple Music lyrics experience to your desktop. It provides real-time word-by-word karaoke synchronization, live motion album artwork (Spotify Canvases and Apple Music Motion videos), and instant music playback controls for both desktop music apps and browser web players.

---

## 🌟 Key Features

- **🎤 Syllable & Word-Synced Lyrics**:
  - Millisecond-accurate word-by-word and syllable-by-syllable karaoke highlighting powered by Spicy Lyrics.
  - Smooth vertical auto-scrolling with user-scroll override and automatic resume.
- **✨ Dynamic Instrumental Breaks**:
  - Apple Music-style dynamic 3-dot pulse animation (`♪`) during musical interludes and solos.
- **🎨 Live Dual-Source Motion Artwork**:
  - **Spotify Canvas**: Looping high-definition MP4 canvas videos fetched directly from Spotify's canvas cache.
  - **Apple Music Motion**: Official motion album artwork rendered via Apple HLS (`.m3u8`) streaming with automatic 2D Canvas compositing.
  - **Dynamic Theme Palette**: Automatically extracts dominant vibrant colors from album artwork and renders smooth mesh gradients.
- **🔄 Dual Playback Source Support**:
  - **Native Desktop Apps**: Native Windows System Media Transport Controls (SMTC / GSMTC) integration supporting Spotify Desktop, Apple Music for Windows, iTunes, Tidal, and Amazon Music.
  - **Web Players**: Real-time integration with **Spotify Web**, **YouTube Music**, and **Apple Music Web** via the included Chrome extension.
  - **Manual Platform Switcher**: Click the player logo in the header anytime to toggle data fetching between **Web Player** and **Desktop App**.
- **⚡ Instant Sub-100ms Controls**:
  - Play, Pause, Next Track, and Previous Track with instant 30ms burst scanning and optimistic seekbar progress reset.
- **🪟 macOS Liquid Glass Aesthetics**:
  - True glassmorphism with backdrop filters, custom traffic light controls, drag-to-move, and click-to-pin (Always on Top).
  - Built-in themes: **Dynamic** (matches album artwork), **Dark**, and **Light**.
- **⏱️ Real-Time Lyrics Calibration**:
  - Keyboard shortcuts to fine-tune lyrics timing offset on-the-fly (`-50ms` / `+50ms`).

---

## 🛠️ Tech Stack

| Layer | Technologies |
| :--- | :--- |
| **Desktop Framework** | [Electron 40](https://www.electronjs.org/) |
| **Frontend Framework** | [React 19](https://react.dev/), [TypeScript](https://www.typescriptlang.org/) |
| **Bundler & Dev Server** | [Vite 7](https://vite.dev/) |
| **Animations** | [Framer Motion](https://www.framer.com/motion/) |
| **Video & Stream Player** | [HLS.js](https://github.com/video-dev/hls.js/) |
| **State Management** | [Zustand 5](https://github.com/pmndrs/zustand) |
| **Extension Bridge** | [Socket.io](https://socket.io/) (Local WebSocket Server on port `4000`) |
| **Desktop Media Bridge** | PowerShell WinRT GSMTC Listener + Win32 `keybd_event` P/Invoke |

---

## 🚀 Quick Start Guide

### 📋 Prerequisites

1. **Operating System**: Windows 10 or Windows 11 (64-bit).
2. **Node.js**: Node.js **v18.0.0** or higher ([Download Node.js](https://nodejs.org/)).
3. **Browser**: Google Chrome, Brave, Microsoft Edge, or any Chromium-based browser (if using Web Player mode).

---

### 1️⃣ Clone the Repository

```bash
git clone https://github.com/yashtayade987/Electron-Lyrics.git
cd Electron-Lyrics
```

---

### 2️⃣ Install Dependencies

```bash
npm install
```

---

### 3️⃣ Configure Environment Variables

Create a `.env` file in the root directory by copying the sample file:

```bash
cp .env.example .env
```

Open `.env` and configure your settings:

```env
# Spicy Lyrics API Key (Required for synced lyrics)
# Get a free key at: https://spicylyrics.org/developer
VITE_SPICY_LYRICS_KEY=your_spicy_lyrics_key_here

# Optional: Spotify SP_DC Cookie (For direct Canvas & high-res artwork resolution)
# Extract 'sp_dc' cookie value from https://open.spotify.com
SP_DC=
```

> [!NOTE]
> The app includes a default fallback key for initial testing, but using your own free key from [SpicyLyrics Developer](https://spicylyrics.org/developer) is recommended to prevent shared rate limits.

---

### 4️⃣ Install the Browser Extension (For Web Players)

To capture track information from **Spotify Web**, **YouTube Music**, or **Apple Music Web**, install the included extension:

1. Open your Chromium browser (Chrome, Edge, Brave).
2. Navigate to `chrome://extensions/` (or `edge://extensions/`).
3. Enable **Developer mode** using the toggle switch in the top-right corner.
4. Click the **Load unpacked** button in the top-left.
5. Select the **`extension`** folder located inside this project directory (`lyrics-app/extension`).
6. The **Lyrics App Bridge** icon will now appear in your browser extensions list.

---

### 5️⃣ Run the Application

#### Development Mode (Recommended)
Run the Vite development server and Electron desktop application concurrently:

```bash
npm run electron:dev
```

*Alternatively, on Windows you can simply double-click **`launch-lyrics.bat`**.*

---

## 📦 Building for Production

To compile TypeScript and produce a standalone Windows installer:

```bash
# 1. Build the production web bundle
npm run build

# 2. Package into a Windows installer (.exe)
npm run electron:build
```

The resulting installer (`.exe`) and portable build will be generated in the **`dist-electron/`** folder.

---

## 🎮 Controls & Keyboard Shortcuts

| Shortcut | Action | Description |
| :--- | :--- | :--- |
| <kbd>Space</kbd> | **Play / Pause** | Toggles playback on the active player |
| <kbd>Ctrl</kbd> + <kbd>←</kbd> | **Previous Track** | Skips to the previous track |
| <kbd>Ctrl</kbd> + <kbd>→</kbd> | **Next Track** | Skips to the next track |
| <kbd>Ctrl</kbd> + <kbd>P</kbd> | **Toggle Pin** | Pins window Always on Top |
| <kbd>Ctrl</kbd> + <kbd>T</kbd> | **Toggle Theme** | Cycles between Dynamic, Dark, and Light |
| <kbd>[</kbd> | **Delay Lyrics (-50ms)** | Calibrates lyrics timing backward |
| <kbd>]</kbd> | **Advance Lyrics (+50ms)** | Calibrates lyrics timing forward |
| <kbd>\</kbd> | **Reset Offset (0ms)** | Resets timing offset to default |
| <kbd>Ctrl</kbd> + <kbd>M</kbd> | **Minimize** | Minimizes the floating window |
| <kbd>Ctrl</kbd> + <kbd>W</kbd> | **Close** | Exits the application |

---

## 🎛️ Switching Playback Source

Beautiful Lyrics can seamlessly listen to both desktop software and web players:

1. Click on the **Playback Provider Logo** (Spotify, Apple Music, or YouTube Music icon) in the header.
2. A dropdown menu appears with two options:
   - **Web Player**: Captures playback directly from open tabs in your browser via the extension.
   - **Desktop App**: Captures playback directly from Windows SMTC (Spotify Desktop, iTunes, Apple Music app).
3. Select your desired mode. The app immediately updates its data stream and playback commands.

---

## 🏗️ Architecture & Communication Flow

```text
 ┌─────────────────────────────────────────────────────────┐
 │                   Beautiful Lyrics Desktop               │
 │                                                         │
 │  ┌───────────────────────┐   IPC   ┌─────────────────┐ │
 │  │   React 19 Renderer   │ ◄─────► │  Electron Main  │ │
 │  │ (Zustand, Glassmorphism)│        │   (Node.js)     │ │
 │  └───────────────────────┘         └────────┬────────┘ │
 └──────────────┬──────────────────────────────┼───────────┘
                │                              │
                │ Socket.io (Port 4000)        │ Spawns
                ▼                              ▼
 ┌───────────────────────────┐   ┌───────────────────────────┐
 │  Chromium Web Extension   │   │  PowerShell SMTC Listener │
 │  (Spotify/YouTube/Apple)  │   │  (Windows 10/11 WinRT)    │
 └───────────────────────────┘   └───────────────────────────┘
```

1. **Electron Main Process (`electron/main.js`)**:
   - Starts an internal HTTP and Socket.io server on `http://localhost:4000`.
   - Spawns a background PowerShell process running `smtc-listener.ps1` to poll Windows WinRT GSMTC.
   - Forwards media control commands via Win32 `keybd_event` or WinRT media session APIs.
2. **Browser Extension (`extension/`)**:
   - Injected into `open.spotify.com`, `music.youtube.com`, and `music.apple.com`.
   - Extracts real-time track metadata, playback progress, and authenticated tokens.
   - Streams updates directly to `localhost:4000` via WebSockets.
3. **React Renderer (`src/`)**:
   - Receives track updates, fetches syllable-level lyrics from Spicy Lyrics, and caches them in memory.
   - Renders dual-mode animated backgrounds (Spotify Canvas video or Apple Music HLS Motion stream).

---

## ❓ Troubleshooting & FAQ

<details>
<summary><strong>1. Why are lyrics not displaying for my song?</strong></summary>

- Verify that your internet connection is active.
- Verify that your `VITE_SPICY_LYRICS_KEY` in `.env` is valid.
- Some niche, unreleased, or instrumental tracks may not have synced lyrics in the community database.
- Try adjusting the lyrics offset using <kbd>[</kbd> and <kbd>]</kbd> if timing appears misaligned.
</details>

<details>
<summary><strong>2. The Web Player is playing, but the app says "No song playing"</strong></summary>

- Make sure you loaded the unpacked extension in your browser from the `extension` folder.
- Refresh the web player tab (`F5`) after launching Beautiful Lyrics so the extension can establish the WebSocket connection.
- Ensure no other application or firewall is blocking local port `4000`.
- In the app header, click the service logo and ensure **Web Player** is selected.
</details>

<details>
<summary><strong>3. Windows Desktop App is not updating tracks</strong></summary>

- Ensure Spotify Desktop or Apple Music is actually playing audio.
- Ensure Windows Media Keys / Volume overlay normally show the track information on your PC.
- In the app header, click the service logo and make sure **Desktop App** is selected.
</details>

<details>
<summary><strong>4. How do I get Spotify Canvas videos to display?</strong></summary>

- If using the **Web Player**, Spotify Canvases are automatically extracted from your browser session.
- If using the **Desktop App**, add your `SP_DC` cookie to `.env`. To find your cookie:
  1. Open [open.spotify.com](https://open.spotify.com) in your browser and log in.
  2. Press `F12` to open Developer Tools -> Go to **Application** (or **Storage**) -> **Cookies**.
  3. Find the cookie named `sp_dc` and copy its value into `.env`.
</details>

---

## 📄 License

This project is licensed under the [MIT License](LICENSE).

---

<p align="center">
  Crafted with ❤️ for music enthusiasts.
</p>
