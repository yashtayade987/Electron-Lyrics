# Windows System Media Transport Controls (SMTC) Native Listener
# Captures playback from Spotify Desktop, Apple Music for Windows, iTunes, and other desktop media players
param(
    [switch]$IncludeAllApps = $true
)

$OutputEncoding = [System.Text.Encoding]::UTF8
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
[Console]::InputEncoding = [System.Text.Encoding]::UTF8

# Load WinRT and Windows Runtime types
[Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager, Windows.Media.Control, ContentType = WindowsRuntime] | Out-Null
[Windows.Storage.Streams.DataReader, Windows.Storage.Streams, ContentType = WindowsRuntime] | Out-Null
Add-Type -AssemblyName System.Runtime.WindowsRuntime
Add-Type -AssemblyName System.Core

$asTaskGeneric = ([System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object { 
    $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation`1' 
})[0]

$asStreamMethod = ([System.IO.WindowsRuntimeStreamExtensions].GetMethods() | Where-Object { 
    $_.Name -eq 'AsStream' -and $_.GetParameters().Count -eq 1 
})[0]

function Await-WinRT($op, $type) { 
    if (-not $op) { return $null }
    try {
        $asTask = $asTaskGeneric.MakeGenericMethod($type)
        $netTask = $asTask.Invoke($null, @($op))
        return $netTask.Result 
    } catch {
        return $null
    }
}

function Get-ThumbnailBase64($streamRef) {
    if (-not $streamRef) { return "" }
    try {
        $stream = Await-WinRT ($streamRef.OpenReadAsync()) ([Windows.Storage.Streams.IRandomAccessStreamWithContentType])
        if (-not $stream -or $stream.Size -eq 0 -or $stream.Size -gt 1048576) { return "" }
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
    if ($lower -like "*applemusic*" -or $lower -like "*apple.music*" -or $lower -like "*itunes*") {
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

# Initialize GSMTC Manager
$mgr = $null
try {
    $mgr = Await-WinRT ([Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager]::RequestAsync()) ([Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager])
} catch {
    [Console]::Out.WriteLine('{"type":"error","message":"Failed to initialize GSMTC Manager"}')
    [Console]::Out.Flush()
    exit 1
}

if (-not $mgr) {
    [Console]::Out.WriteLine('{"type":"error","message":"GSMTC Manager is null"}')
    [Console]::Out.Flush()
    exit 1
}

[Console]::Out.WriteLine('{"type":"ready","message":"GSMTC Manager active"}')
[Console]::Out.Flush()

$lastSongKey = ""
$lastStatus = ""
$lastProgress = -1
$lastReportTick = 0
$lastCandidateSession = $null

# Dedicated background thread for non-blocking stdin command reading
# Avoids [Console]::In.ReadLineAsync() which synchronously blocks the main thread in PowerShell 5.1
$commandQueue = New-Object 'System.Collections.Concurrent.ConcurrentQueue[string]'
$stdinThread = New-Object System.Threading.Thread([System.Threading.ThreadStart]{
    try {
        while ($true) {
            $line = [Console]::In.ReadLine()
            if ($line -eq $null) { break }
            $commandQueue.Enqueue($line)
        }
    } catch {}
})
$stdinThread.IsBackground = $true
$stdinThread.Start()

while ($true) {
    try {
    # Check for incoming commands from queue
    $cmdLine = $null
    while ($commandQueue.TryDequeue([ref]$cmdLine)) {
        if ($cmdLine -and $cmdLine.Trim().Length -gt 0) {
            try {
                $cmd = ConvertFrom-Json $cmdLine
                $action = if ($cmd.action) { $cmd.action } else { $cmd.command }
                
                if ($lastCandidateSession) {
                    switch ($action) {
                        "play" {
                            [void](Await-WinRT ($lastCandidateSession.TryPlayAsync()) ([bool]))
                        }
                        "pause" {
                            [void](Await-WinRT ($lastCandidateSession.TryPauseAsync()) ([bool]))
                        }
                        { $_ -in @("togglePlay", "play-pause", "playPause") } {
                            [void](Await-WinRT ($lastCandidateSession.TryTogglePlayPauseAsync()) ([bool]))
                        }
                        { $_ -in @("next", "skipNext") } {
                            [void](Await-WinRT ($lastCandidateSession.TrySkipNextAsync()) ([bool]))
                        }
                        { $_ -in @("previous", "prev", "skipPrevious") } {
                            [void](Await-WinRT ($lastCandidateSession.TrySkipPreviousAsync()) ([bool]))
                        }
                        "seek" {
                            if ($cmd.position -ne $null) {
                                $targetTicks = [long]($cmd.position * 10000)
                                $timeSpan = [TimeSpan]::FromTicks($targetTicks)
                                [void](Await-WinRT ($lastCandidateSession.TryChangePlaybackPositionAsync($timeSpan)) ([bool]))
                            }
                        }
                    }
                }
            } catch {}
        }
    }

    # Find the most relevant active media session
    $candidateSession = $null
    $allSessions = @()
    try {
        $allSessions = $mgr.GetSessions()
    } catch {}

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
    if (-not $candidateSession) {
        try {
            $currentSession = $mgr.GetCurrentSession()
            if ($currentSession -and -not (Is-BrowserApp $currentSession.SourceAppUserModelId)) {
                $candidateSession = $currentSession
            }
        } catch {}
    }

    # Priority 3: Any non-browser session
    if (-not $candidateSession) {
        foreach ($s in $allSessions) {
            if (-not (Is-BrowserApp $s.SourceAppUserModelId)) {
                $candidateSession = $s
                break
            }
        }
    }

    # Priority 4: Fallback to any session if nothing else exists
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

        $media = Await-WinRT ($candidateSession.TryGetMediaPropertiesAsync()) ([Windows.Media.Control.GlobalSystemMediaTransportControlsSessionMediaProperties])
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

            $songKey = "$src::$rawTitle::$finalArtist::$finalAlbum::$durationMs"

            if ($songKey -ne $lastSongKey) {
                $lastSongKey = $songKey
                $lastStatus = $statusStr
                $lastProgress = $posMs
                $lastReportTick = [Environment]::TickCount

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
            elseif ($statusStr -ne $lastStatus -or [Math]::Abs($posMs - $lastProgress) -ge 1200 -or ([Environment]::TickCount - $lastReportTick) -ge 800) {
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
    } catch {
        # Catch any transient COM/WinRT exceptions and continue loop
    }

    $sleepMs = if ($lastStatus -eq "Playing") { 250 } else { 600 }
    Start-Sleep -Milliseconds $sleepMs
}
