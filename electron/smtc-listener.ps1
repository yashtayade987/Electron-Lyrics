# Windows System Media Transport Controls (SMTC) Native Listener
# Captures playback from Spotify Desktop, Apple Music for Windows, iTunes, and other desktop media players
param(
    [switch]$IncludeAllApps = $true
)

$OutputEncoding = [System.Text.Encoding]::UTF8
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
[Console]::InputEncoding = [System.Text.Encoding]::UTF8

# Load WinRT and Windows Runtime types
try {
    [Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager, Windows.Media.Control, ContentType = WindowsRuntime] | Out-Null
    [Windows.Storage.Streams.DataReader, Windows.Storage.Streams, ContentType = WindowsRuntime] | Out-Null
    [System.Reflection.Assembly]::LoadWithPartialName('System.Runtime.WindowsRuntime') | Out-Null
    Add-Type -AssemblyName System.Core -ErrorAction SilentlyContinue
} catch {}

# Compile C# helper DesktopMediaBridge:
# 1) Non-blocking Stdin reading on a dedicated background thread (does NOT touch PowerShell Runspace)
# 2) Native Win32 keybd_event playback controls (VK_MEDIA_PLAY_PAUSE, VK_MEDIA_NEXT_TRACK, VK_MEDIA_PREV_TRACK)
# 3) Desktop window detection fallback (detects Spotify playback when GSMTC is delayed or unavailable)
Add-Type -TypeDefinition @"
using System;
using System.Text;
using System.Threading;
using System.Collections.Concurrent;
using System.Runtime.InteropServices;

public static class DesktopMediaBridge {
    [DllImport("user32.dll")]
    public static extern void keybd_event(byte bVk, byte bScan, uint dwFlags, UIntPtr dwExtraInfo);

    public static void SendKey(byte vk) {
        keybd_event(vk, 0, 0, UIntPtr.Zero);
        keybd_event(vk, 0, 2, UIntPtr.Zero);
    }

    private static ConcurrentQueue<string> _queue = new ConcurrentQueue<string>();
    private static Thread _thread;

    public static void StartStdinReader() {
        _thread = new Thread(() => {
            try {
                string line;
                while ((line = Console.ReadLine()) != null) {
                    if (!string.IsNullOrWhiteSpace(line)) {
                        _queue.Enqueue(line.Trim());
                    }
                }
            } catch {}
        });
        _thread.IsBackground = true;
        _thread.Start();
    }

    public static string ReadNextCommand() {
        string cmd;
        if (_queue.TryDequeue(out cmd)) {
            return cmd;
        }
        return null;
    }

    public delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);
    [DllImport("user32.dll")] public static extern bool EnumWindows(EnumWindowsProc lpEnumFunc, IntPtr lParam);
    [DllImport("user32.dll")] public static extern int GetWindowText(IntPtr hWnd, StringBuilder lpString, int nMaxCount);
    [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint lpdwProcessId);

    public static string DetectPlayingMediaFromWindows() {
        string found = null;
        EnumWindows((hWnd, lParam) => {
            StringBuilder sb = new StringBuilder(512);
            GetWindowText(hWnd, sb, 512);
            string title = sb.ToString();
            if (!string.IsNullOrWhiteSpace(title)) {
                uint pid;
                GetWindowThreadProcessId(hWnd, out pid);
                try {
                    var p = System.Diagnostics.Process.GetProcessById((int)pid);
                    string name = p.ProcessName.ToLower();
                    if (name.Contains("spotify")) {
                        if (!title.Equals("Spotify", StringComparison.OrdinalIgnoreCase) &&
                            !title.Equals("Spotify Premium", StringComparison.OrdinalIgnoreCase) &&
                            !title.Equals("Spotify Free", StringComparison.OrdinalIgnoreCase) &&
                            title.Contains(" - ")) {
                            found = "spotify::" + title;
                            return false;
                        }
                    }
                } catch {}
            }
            return true;
        }, IntPtr.Zero);
        return found;
    }
}
"@ -ErrorAction SilentlyContinue

[DesktopMediaBridge]::StartStdinReader()

$asTaskGeneric = $null
$asStreamMethod = $null
try {
    if (-not ([System.Management.Automation.PSTypeName]'System.WindowsRuntimeSystemExtensions').Type) {
        [System.Reflection.Assembly]::LoadWithPartialName('System.Runtime.WindowsRuntime') | Out-Null
    }
    $asTaskGeneric = ([System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object { 
        $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation`1' 
    })[0]

    $asStreamMethod = ([System.IO.WindowsRuntimeStreamExtensions].GetMethods() | Where-Object { 
        $_.Name -eq 'AsStream' -and $_.GetParameters().Count -eq 1 
    })[0]
} catch {}

function Await-WinRT($op, $type, $timeoutMs = 2000) { 
    if (-not $op -or -not $asTaskGeneric) { return $null }
    try {
        $asTask = $asTaskGeneric.MakeGenericMethod($type)
        $netTask = $asTask.Invoke($null, @($op))
        if ($netTask.Wait($timeoutMs)) {
            return $netTask.Result 
        }
        return $null
    } catch {
        return $null
    }
}

function Get-ThumbnailBase64($streamRef) {
    if (-not $streamRef -or -not $asStreamMethod) { return "" }
    try {
        $stream = Await-WinRT ($streamRef.OpenReadAsync()) ([Windows.Storage.Streams.IRandomAccessStreamWithContentType]) 2500
        if (-not $stream -or $stream.Size -eq 0 -or $stream.Size -gt 2097152) { return "" }
        $netStream = $asStreamMethod.Invoke($null, @($stream))
        $memStream = New-Object System.IO.MemoryStream
        try {
            $netStream.CopyTo($memStream)
            $bytes = $memStream.ToArray()
            if ($bytes.Length -gt 0) {
                $b64 = [Convert]::ToBase64String($bytes)
                return "data:image/jpeg;base64,$b64"
            }
        } finally {
            if ($memStream) { $memStream.Dispose() }
            if ($netStream) { $netStream.Dispose() }
            if ($stream) { $stream.Dispose() }
        }
    } catch {
        # ignore thumbnail read errors
    }
    return ""
}

function Detect-Source($appId) {
    if (-not $appId) { return "unknown" }
    $lower = $appId.ToLowerInvariant()
    if ($lower -like "*spotify*") {
        return "spotify"
    }
    if ($lower -like "*apple*music*" -or $lower -like "*applemusic*" -or $lower -like "*itunes*") {
        return "apple"
    }
    if ($lower -like "*youtube*") {
        return "youtube"
    }
    if ($lower -like "*tidal*") {
        return "tidal"
    }
    if ($lower -like "*amazon*") {
        return "amazon"
    }
    return "other"
}

function Is-BrowserApp($appId) {
    if (-not $appId) { return $false }
    $lower = $appId.ToLowerInvariant()
    return ($lower -like "*chrome*" -or $lower -like "*msedge*" -or $lower -like "*brave*" -or $lower -like "*firefox*" -or $lower -like "*opera*" -or $lower -like "*vivaldi*")
}

# Attempt initial GSMTC Manager connect (non-blocking, fast timeout)
$mgr = $null
try {
    $mgr = Await-WinRT ([Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager]::RequestAsync()) ([Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager]) 1500
} catch {}

# ALWAYS emit ready and NEVER exit with 1! The desktop listener stays active continuously!
[Console]::Out.WriteLine('{"type":"ready","message":"Desktop Media Listener active"}')
[Console]::Out.Flush()

$lastSongKey = ""
$lastStatus = ""
$lastProgress = -1
$lastReportTick = 0
$lastCandidateSession = $null
$lastMgrAttemptTick = [Environment]::TickCount
$cachedMedia = $null
$lastMediaCheckTick = 0
$lastAppId = ""

while ($true) {
    try {
        # Check for incoming commands from DesktopMediaBridge queue
        $cmdLine = [DesktopMediaBridge]::ReadNextCommand()
        while ($cmdLine) {
            try {
                $cmd = ConvertFrom-Json $cmdLine
                $action = if ($cmd.action) { $cmd.action } else { $cmd.command }
                
                # Dynamically determine target session
                $targetSession = $candidateSession
                if (-not $targetSession) { $targetSession = $lastCandidateSession }
                if (-not $targetSession -and $mgr) {
                    try { $targetSession = $mgr.GetCurrentSession() } catch {}
                }
                if (-not $targetSession -and $mgr) {
                    try {
                        foreach ($s in $mgr.GetSessions()) {
                            if ((Detect-Source $s.SourceAppUserModelId) -in @("spotify", "apple")) {
                                $targetSession = $s
                                break
                            }
                        }
                    } catch {}
                }

                $handled = $false
                if ($targetSession) {
                    switch ($action) {
                        "play" {
                            $res = Await-WinRT ($targetSession.TryPlayAsync()) ([bool]) 1500
                            $handled = ($res -eq $true)
                        }
                        "pause" {
                            $res = Await-WinRT ($targetSession.TryPauseAsync()) ([bool]) 1500
                            $handled = ($res -eq $true)
                        }
                        { $_ -in @("togglePlay", "play-pause", "playPause") } {
                            $res = Await-WinRT ($targetSession.TryTogglePlayPauseAsync()) ([bool]) 1500
                            $handled = ($res -eq $true)
                        }
                        { $_ -in @("next", "skipNext") } {
                            $res = Await-WinRT ($targetSession.TrySkipNextAsync()) ([bool]) 1500
                            $handled = ($res -eq $true)
                        }
                        { $_ -in @("previous", "prev", "skipPrevious") } {
                            $res = Await-WinRT ($targetSession.TrySkipPreviousAsync()) ([bool]) 1500
                            $handled = ($res -eq $true)
                        }
                        "seek" {
                            if ($cmd.position -ne $null) {
                                $targetTicks = [long]($cmd.position * 10000)
                                $timeSpan = [TimeSpan]::FromTicks($targetTicks)
                                [void](Await-WinRT ($targetSession.TryChangePlaybackPositionAsync($timeSpan)) ([bool]) 1500)
                                $handled = $true
                            }
                        }
                    }
                }

                # Direct hardware media key fallback if SMTC was not handled or session was not available
                if (-not $handled) {
                    switch ($action) {
                        { $_ -in @("togglePlay", "play-pause", "playPause", "play", "pause") } {
                            [DesktopMediaBridge]::SendKey(0xB3) # VK_MEDIA_PLAY_PAUSE
                        }
                        { $_ -in @("next", "skipNext") } {
                            [DesktopMediaBridge]::SendKey(0xB0) # VK_MEDIA_NEXT_TRACK
                        }
                        { $_ -in @("previous", "prev", "skipPrevious") } {
                            [DesktopMediaBridge]::SendKey(0xB1) # VK_MEDIA_PREV_TRACK
                        }
                    }
                }
            } catch {}
            $cmdLine = [DesktopMediaBridge]::ReadNextCommand()
        }

        # Periodic non-blocking retry to obtain GSMTC Manager if not yet acquired
        if (-not $mgr -and ([Environment]::TickCount - $lastMgrAttemptTick) -gt 8000) {
            $lastMgrAttemptTick = [Environment]::TickCount
            try {
                $mgr = Await-WinRT ([Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager]::RequestAsync()) ([Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager]) 1000
            } catch {}
        }

        # Find the most relevant active media session
        $candidateSession = $null
        $allSessions = @()
        if ($mgr) {
            try {
                $allSessions = $mgr.GetSessions()
            } catch {}
        }

        # Priority 1: Dedicated desktop music players actively "Playing" (prefer native Spotify or Apple Music)
        foreach ($s in $allSessions) {
            $appId = $s.SourceAppUserModelId
            if (Is-BrowserApp $appId) { continue }
            $info = $s.GetPlaybackInfo()
            if ($info -and $info.PlaybackStatus.ToString() -eq "Playing") {
                $src = Detect-Source $appId
                if ($src -in @("spotify", "apple")) {
                    $candidateSession = $s
                    break
                }
                if (-not $candidateSession) {
                    $candidateSession = $s
                }
            }
        }

        # Priority 2: System current focused session if not a browser
        if (-not $candidateSession -and $mgr) {
            try {
                $currentSession = $mgr.GetCurrentSession()
                if ($currentSession -and -not (Is-BrowserApp $currentSession.SourceAppUserModelId)) {
                    $candidateSession = $currentSession
                }
            } catch {}
        }

        # Priority 3: Spotify or Apple Music desktop even if currently Paused
        if (-not $candidateSession) {
            foreach ($s in $allSessions) {
                $src = Detect-Source $s.SourceAppUserModelId
                if ($src -in @("spotify", "apple")) {
                    $candidateSession = $s
                    break
                }
            }
        }

        # Priority 4: Any non-browser session
        if (-not $candidateSession) {
            foreach ($s in $allSessions) {
                if (-not (Is-BrowserApp $s.SourceAppUserModelId)) {
                    $candidateSession = $s
                    break
                }
            }
        }

        # Priority 5: Fallback to any session if nothing else exists
        if (-not $candidateSession -and $allSessions.Count -gt 0) {
            $candidateSession = $allSessions[0]
        }

        $lastCandidateSession = $candidateSession

        if ($candidateSession) {
            $src = Detect-Source $candidateSession.SourceAppUserModelId

            $info = $candidateSession.GetPlaybackInfo()
            $statusStr = if ($info) { $info.PlaybackStatus.ToString() } else { "Unknown" }
            $isPlaying = ($statusStr -eq "Playing")

            $timeline = $candidateSession.GetTimelineProperties()
            $durationMs = if ($timeline -and $timeline.EndTime.TotalMilliseconds -gt 0) { 
                [Math]::Round($timeline.EndTime.TotalMilliseconds) 
            } else { 0 }

            $posMs = if ($timeline -and $timeline.Position.TotalMilliseconds -ge 0) { 
                $basePos = $timeline.Position.TotalMilliseconds
                if ($isPlaying -and $timeline.LastUpdatedTime) {
                    try {
                        $elapsedSinceUpdate = ([DateTimeOffset]::UtcNow - $timeline.LastUpdatedTime).TotalMilliseconds
                        if ($elapsedSinceUpdate -gt 0 -and $elapsedSinceUpdate -lt 3600000) {
                            $basePos += $elapsedSinceUpdate
                        }
                    } catch {}
                }
                if ($durationMs -gt 0 -and $basePos -gt $durationMs) {
                    $basePos = $durationMs
                }
                [Math]::Round($basePos)
            } else { 0 }

            $needsMediaCheck = (-not $cachedMedia) -or ($candidateSession.SourceAppUserModelId -ne $lastAppId) -or ($statusStr -ne $lastStatus) -or ([Environment]::TickCount - $lastMediaCheckTick -gt 2500)
            if ($needsMediaCheck) {
                $lastMediaCheckTick = [Environment]::TickCount
                $lastAppId = $candidateSession.SourceAppUserModelId
                $freshMedia = Await-WinRT ($candidateSession.TryGetMediaPropertiesAsync()) ([Windows.Media.Control.GlobalSystemMediaTransportControlsSessionMediaProperties]) 1000
                if ($freshMedia -and $freshMedia.Title) {
                    $cachedMedia = $freshMedia
                }
            }
            $media = $cachedMedia
            $rawTitle = if ($media -and $media.Title) { $media.Title.Trim() } else { "" }
            $rawArtist = if ($media -and $media.Artist) { $media.Artist.Trim() } else { "" }
            $rawAlbum = if ($media -and $media.AlbumTitle) { $media.AlbumTitle.Trim() } else { "" }

            if ($rawTitle.Length -gt 0) {
                # Normalize Apple Music Windows artist formatting safely using ASCII / Char codes
                # Apple Music sets Artist to: "Artist — Album" or "Artist — Title - Album"
                $finalArtist = $rawArtist
                $finalAlbum = $rawAlbum
                $dashPattern = "\s+[\u2014\u2013\-]\s+"
                if ($rawArtist -match "^(.*?)$dashPattern(.*)$") {
                    $finalArtist = $Matches[1].Trim()
                    if (-not $finalAlbum) {
                        $remainder = $Matches[2].Trim()
                        if ($rawTitle -and $remainder.StartsWith($rawTitle)) {
                            $remainder = $remainder.Substring($rawTitle.Length).Trim()
                            while ($remainder.StartsWith("-") -or $remainder.StartsWith([char]0x2014) -or $remainder.StartsWith([char]0x2013)) {
                                $remainder = $remainder.Substring(1).Trim()
                            }
                        }
                        if ($remainder) {
                            $finalAlbum = $remainder
                        }
                    }
                }

                $songKey = "$src::$rawTitle::$finalArtist"

                if ($songKey -ne $lastSongKey) {
                    $isNewSong = ($lastSongKey -ne "")
                    $lastSongKey = $songKey
                    $lastStatus = $statusStr
                    $lastReportTick = [Environment]::TickCount

                    # When a track transitions, Windows SMTC timeline properties often lag behind by 500ms-1500ms
                    # retaining the previous song's end-of-track position (e.g. 200,000ms+).
                    # Force progress to 0 on new song detection so lyrics never jump to the end of the song!
                    if ($isNewSong -and $posMs -gt 3000) {
                        $posMs = 0
                    }
                    $lastProgress = $posMs

                    $thumb = Get-ThumbnailBase64 $media.Thumbnail

                    $data = @{
                        type = "song_update"
                        source = $src
                        title = $rawTitle
                        artist = $finalArtist
                        album = $finalAlbum
                        duration = $durationMs
                        progress = $posMs
                        isPlaying = $isPlaying
                        coverArt = $thumb
                        appId = $candidateSession.SourceAppUserModelId
                    }
                    [Console]::Out.WriteLine((ConvertTo-Json -Compress $data))
                    [Console]::Out.Flush()
                }
                elseif ($statusStr -ne $lastStatus -or [Math]::Abs($posMs - $lastProgress) -ge 500 -or ([Environment]::TickCount - $lastReportTick) -ge 300) {
                    $lastStatus = $statusStr
                    $lastProgress = $posMs
                    $lastReportTick = [Environment]::TickCount

                    $data = @{
                        type = "progress_update"
                        source = $src
                        title = $rawTitle
                        duration = $durationMs
                        progress = $posMs
                        isPlaying = $isPlaying
                    }
                    [Console]::Out.WriteLine((ConvertTo-Json -Compress $data))
                    [Console]::Out.Flush()
                }
            }
        } else {
            # Window Title Fallback for Desktop Spotify when SMTC is delayed/inactive
            $winMedia = [DesktopMediaBridge]::DetectPlayingMediaFromWindows()
            if ($winMedia -and $winMedia.StartsWith("spotify::")) {
                $raw = $winMedia.Substring(9)
                $dashIdx = $raw.IndexOf(" - ")
                if ($dashIdx -gt 0) {
                    $winArtist = $raw.Substring(0, $dashIdx).Trim()
                    $winTitle = $raw.Substring($dashIdx + 3).Trim()
                    $songKey = "spotify::$winTitle::$winArtist"

                    if ($songKey -ne $lastSongKey) {
                        $lastSongKey = $songKey
                        $lastStatus = "Playing"
                        $lastProgress = 0
                        $lastReportTick = [Environment]::TickCount

                        $data = @{
                            type = "song_update"
                            source = "spotify"
                            title = $winTitle
                            artist = $winArtist
                            album = ""
                            duration = 0
                            progress = 0
                            isPlaying = $true
                            coverArt = ""
                            appId = "Spotify.exe"
                        }
                        [Console]::Out.WriteLine((ConvertTo-Json -Compress $data))
                        [Console]::Out.Flush()
                    }
                }
            } else {
                if ($lastSongKey -ne "") {
                    if ($lastStatus -ne "Closed") {
                        $lastStatus = "Closed"
                        $data = @{
                            type = "progress_update"
                            isPlaying = $false
                            progress = $lastProgress
                        }
                        [Console]::Out.WriteLine((ConvertTo-Json -Compress $data))
                        [Console]::Out.Flush()
                    }
                }
            }
        }
    } catch {
        # Catch any transient COM/WinRT exceptions and continue loop smoothly
    }

    $sleepMs = if ($lastStatus -eq "Playing") { 150 } else { 600 }
    Start-Sleep -Milliseconds $sleepMs
}
