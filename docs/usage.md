# MusicSuite usage guide

[Back to the README](../README.md)

## Local imports and the library

Use **Import music**, **Import folder**, or drag files/folders into the workspace. Folder imports include nested folders and upload in batches of ten. The summary reports added tracks, duplicates, ignored non-audio files, and unreadable items. A folder selection has no 50-file cap; the per-track size and duration limits still apply.

Duplicates are matched by SHA-256. Imported files are copied into the library, and embedded JPEG, PNG, or WebP covers are extracted when available. Generated artwork fills in otherwise. Track details let you edit the title, artist, and album, upload a cover, or return to generated artwork.

Search, favorites, sorting, and grid/list views help navigate the library. Playlists have their own track order; deleting a playlist leaves its tracks in the library.

## Listening and Up Next

Playback remembers the selected track, position, temporary mixes, listening volume, collection, shuffle/repeat settings, and queue preferences in this browser. Unmute restores the previous listening level. Media keys and browser media controls expose playback, next/previous, stop, and seeking where supported by the browser and operating system.

Expand **Up Next** below the player to see upcoming songs and the pinned current track. Drag upcoming songs, use the arrow buttons, or remove a song from this queue. These changes preserve the library, saved playlists, playback position, and effects. Crossfade follows the newly arranged next song.

Queue edits and the panel's open/closed state survive refresh. **Reset queue** restores the collection's songs and order. Choosing another collection starts a fresh queue. With repeat on, Up Next shows one upcoming cycle, excluding the current song. Selection loops take priority over queue advance.

### Crossfade

Choose Off or 1–12 seconds; the remembered default is 3 seconds. The next track loads ahead of time and blends through the same effects graph. Speed, reverb, EQ, and output gain carry across automatic advance and Next/Previous. Each track retains its own trims and fades. Explicitly selecting a saved version recalls that version's full mix.

Short or trimmed tracks cap the blend at half of either selection. Pause or seek cancels an active overlap and keeps the incoming track selected. Selecting a track explicitly stops the overlapping sources; queue changes cancel a pending blend. Selection loops disable automatic transitions.

Preloading has a **256 MiB combined decoded-audio budget**. Larger track pairs advance normally without overlap and show an explanation near the crossfade control. This limits preloading, not total browser memory. If preloading fails, playback falls back to normal advance. Crossfade affects listening; individual saved versions and WAV exports contain one track's mix.

## Effects, edits, and saved versions

The sound studio offers four presets—Original, Slow & spacious, Warm vinyl, and After hours—plus live controls:

| Control | Range |
| --- | --- |
| Tape-style speed | 0.5×–1.5×; pitch changes with speed |
| Reverb / Space | 0–100% |
| Room decay | 0.3–6 seconds |
| Bass, mids, treble | −12 to +12 dB each |
| Output gain | −24 to +6 dB |

For **slowed + reverb**, set Speed below 1.0× and add reverb. For **nightcore**, set Speed above 1.0×—try 1.2× to start, or go up to 1.5×. Pitch rises with speed. Both styles work with live EQ and reverb and can be saved as versions or exported as WAV.

Adjustments are non-destructive. **Save version** stores a named mix and its trim/fade settings beside the original track. Temporary drafts are browser-specific; saved versions live in SQLite.

Trim points use seconds in the original recording. Fade durations use seconds in the resulting mix and are capped at half its duration so they do not overlap. The waveform supports seeking across its full height, and selection looping previews the trimmed range.

Undo/redo covers effects, presets, trims, fades, and saved-version recalls. Repeated changes to a single control are grouped. History belongs to the current session and is kept per track.

### Export

Choose **Export mix**, select 16 or 24 bits, and optionally enable the reverb tail or normalization. The result is a stereo 44.1 kHz WAV using a snapshot of your current effects, selected range, and fades. Listening volume is independent of export output gain.

Normalization targets a sample peak of −1 dB. It is not a certified true-peak or loudness measurement. Peak protection uses a compressor; export reports clipping if it occurs. WAV output does not recover detail lost in a compressed source and currently contains audio without embedded artwork or tags.

## Appearance

**Appearance** offers Mono (default), Studio, Midnight, Ivory (light), and Forest. Theme changes apply across the app and preserve playback, the current mix, and the queue. Saved preferences apply before the first paint and sync across this browser's open MusicSuite tabs.

**Create theme** accepts a name and background/accent colors through color pickers or three-/six-digit hex codes, with or without `#`. Custom themes inherit Mono's typography and geometry. Your chosen background and accent fills stay exact; related surfaces, text, and button colors are generated for readability.

Save up to 24 custom themes per browser, select them under **Your themes**, or edit them later. Preview changes are temporary until saved. Cancel, Escape, or closing the editor restores the selected theme. Deleting offers Undo. If storage fails, the editor retains your unsaved draft and reports the problem.

Theme preferences live in browser local storage. They are not part of the workspace JSON backup or the server's data directory. **Reset to Mono** restores the default selection.

## Link imports

**Windows portable ZIP:** the downloader, Node.js, FFmpeg, and ffprobe are included. Open MusicSuite.exe and use **Import link**; no setup is needed. Replace the app with a newer portable release to update the bundled tools.

**Running from source:** install FFmpeg and ffprobe on PATH, then run `npm run setup:imports` to install the downloader. The script downloads an official [yt-dlp release](https://github.com/yt-dlp/yt-dlp) into `.tools/`, checks its published SHA-256 checksum, and leaves other installations alone. Run it again to update. Setup supports Windows, macOS, and Linux binaries; this release has been exercised on Windows.

Open **Import link** and paste one of these public URLs:

| Service | Supported links |
| --- | --- |
| YouTube | Video/watch, Shorts, `youtu.be`, `music.youtube.com`, and playlists |
| SoundCloud | Full track/set URLs and `on.soundcloud.com` share links |

A YouTube video URL containing a playlist offers **Import the entire playlist**. Leave it off to import only the video. Tracking parameters are removed and SoundCloud share redirects are validated before downloading.

Imports use yt-dlp, Node as the YouTube JavaScript runtime, and FFmpeg to convert audio to MP3. Available artwork is stored locally, with generated covers as fallback. Downloaded tracks work with normal library, effect, version, and export features. Reimporting a source reuses its track and preserves your edits and versions.

### Playlists and interrupted downloads

Collections support up to **100 entries** and **100 MB / 20 minutes per track**. Oversized collections are rejected before downloading. Tracks process sequentially in source order and join a named local playlist as they finish. Existing tracks are reused; repeated entries appear once. Unavailable or protected entries appear in **Track details**, while remaining entries continue.

You can close the dialog and keep listening. Progress reconnects after a browser refresh while the server stays running. Completed tracks are immediately available. Cancelling retains completed audio and the partial playlist. Paste the same link again to retry missing entries without downloading existing ones again; your local playlist name/order is preserved and missing tracks are appended.

If the server restarts, completed audio and the partial playlist remain saved, but the job does not resume automatically. Import the link again to continue.

Live streams, account-only or protected sources, preview-only audio, channel/profile feeds, and YouTube radio mixes are excluded. MusicSuite does not read browser cookies or request service credentials. Use content you own or have permission to use. Service availability and regional restrictions can affect imports.

## Formats and audio behavior

MP3, WAV, FLAC, M4A, OGG, AAC, Opus, and AIFF can be imported when metadata is readable. Playback depends on browser decoding; AIFF and some AAC/Opus containers may need conversion to WAV. Each track is limited to **100 MB / 20 minutes**.

Very long slowed exports are limited to **256 MiB of rendered floating-point audio** to protect browser memory. This is separate from the crossfade preloading budget. Reducing the selected range, increasing speed, or disabling the export reverb tail can reduce rendering size.

Live playback and offline export share [`src/audio/graph.ts`](../src/audio/graph.ts): three EQ filters, parallel dry/convolution reverb, output gain, and a dynamics compressor. The seeded stereo impulse is identical for the same decay and sample rate. Live changes are smoothed; offline rendering uses a static settings snapshot and precise fade ramps. WAV encoding runs in a web worker.

Crossfade schedules the incoming source and equal-power gain curves on the Web Audio clock. Live speed changes retime a pending blend or both sources during overlap. The deck switches to the incoming track when the blend starts. Changing blend duration reuses the prepared decoded recording.

Disc rotation follows playback and speed. Reduced-motion preferences are respected. The responsive layout keeps desktop playback/studio controls available while the library scrolls; narrow screens use page scrolling.

## Backups and storage

MusicSuite binds to `127.0.0.1` only. Local-file listening needs no external requests. Requested online imports contact the source service and its media/artwork hosts, and downloader setup contacts GitHub. Fonts, icons, and demo audio are local.

| Location | Stored data |
| --- | --- |
| `data/library.sqlite` | Library records, favorites, playlists, source records, and named versions with effects/trims/fades |
| `data/audio/` | Copies of imported audio |
| `data/artwork/` | Embedded, downloaded, or custom covers |
| `data/incoming/online-*` | Temporary downloads, removed after completion, failure, or cancellation |
| Browser local storage | Drafts, listening session, view/queue settings, and built-in/custom themes |

These `data/` paths describe source installations. The portable launcher stores the same files under **`%LOCALAPPDATA%\MusicSuite\Library`**, separate from the extracted app. Use **Open library folder** from its notification-area icon to find them. Updating or moving the portable app folder preserves this library.

For a full library backup, **Quit MusicSuite and copy the entire library directory**. Restore that directory before starting MusicSuite. Browser preferences are stored separately and do not travel with the server's data. Existing v0.1 databases migrate automatically, preserving tracks and saved versions.

The in-app workspace JSON backup contains track details, favorites, playlists, and named versions. It **does not contain audio, artwork, browser drafts/themes, or undo history**. On another installation, import the original audio first, then restore the JSON. Tracks are matched by audio hash, and repeating a restore avoids identical duplicates. Use a full data-directory copy when you need the actual media too.

## Configuration

Set environment variables before starting MusicSuite:

| Variable | Default / purpose |
| --- | --- |
| `PORT` | `3333`; local server port |
| `MUSICSUITE_DATA_DIR` | `data/` for source; `%LOCALAPPDATA%\MusicSuite\Library` for portable; alternative library directory |
| `MUSICSUITE_YTDLP` | Bundled `.tools/yt-dlp` executable, otherwise `yt-dlp` on PATH; alternative downloader path |
| `MUSICSUITE_FFMPEG` | `ffmpeg` on PATH; alternative FFmpeg path |
| `MUSICSUITE_FFPROBE` | `ffprobe` on PATH; alternative ffprobe path |

For example, in PowerShell:

```powershell
$env:PORT = '3335'
$env:MUSICSUITE_DATA_DIR = 'D:\MusicSuite-data'
npm start
```

If using a custom FFmpeg installation, set the ffprobe path too when it is not on PATH. Browser preferences belong to the browser and URL; changing the port or browser creates a separate set of preferences.

The portable launcher sets its bundled tool paths automatically. It accepts `PORT` and `MUSICSUITE_DATA_DIR`; source installations also accept the tool overrides listed above. To keep a portable library on another drive, set `MUSICSUITE_DATA_DIR` to a directory there before opening MusicSuite.exe.

### Troubleshooting

| Symptom | Try this |
| --- | --- |
| The portable app will not start | Extract the whole ZIP first. See `launcher.log` in the library folder and the [portable guide](windows-portable.md). |
| A source installation will not start | Check `node --version` is 24 or newer. Run `npm ci`, then `npm run build` before `npm start`. |
| The port is already in use | Open the existing MusicSuite instance or choose another `PORT`. |
| Link importing reports missing tools | Portable: re-extract the complete ZIP, including `tools/`. Source: run `npm run setup:imports` and check FFmpeg/ffprobe on PATH. |
| A service link stops importing | Update the portable release, or run `npm run setup:imports` for source. Retry a supported public URL and check the job's reported error. |
| A local track imports but cannot play | Convert it to a browser-supported format such as WAV, then import it again. |
| Crossfade is skipped for long tracks | Check the explanation near the control; large decoded track pairs advance without overlapping. |
| A restored JSON backup reports missing tracks | Import the matching original audio first, or restore a complete data-directory backup. |

### Keyboard shortcuts

| Key | Action |
| --- | --- |
| Space | Play / pause |
| Left / Right | Seek 5 seconds |
| `/` | Search the library |
| M | Mute / unmute |
| Ctrl+Z | Undo mix change |
| Ctrl+Shift+Z | Redo mix change |
| Escape | Close a dialog |

## For developers

```sh
npm ci
npm run dev
npm run build
```

Build a ready-to-run Windows ZIP with `npm run package:windows`. See [Windows packaging](windows-portable.md#building-a-release) for requirements and outputs.
