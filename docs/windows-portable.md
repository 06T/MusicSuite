# MusicSuite for Windows

## Open MusicSuite

1. [Download MusicSuite-0.4.1-Windows-x64.zip](https://github.com/06T/MusicSuite/releases/download/v0.4.1/MusicSuite-0.4.1-Windows-x64.zip).
2. Right-click the ZIP and choose **Extract All**.
3. Open the extracted folder and double-click **MusicSuite.exe**.

Your browser opens MusicSuite. Import files or folders, or paste a YouTube/SoundCloud song or playlist link. Node.js, yt-dlp, FFmpeg, and ffprobe are included. You do not need administrator access, an installer, Python, or terminal commands.

See the [release notes](https://github.com/06T/MusicSuite/releases/tag/v0.4.1) and [SHA-256 checksum](https://github.com/06T/MusicSuite/releases/download/v0.4.1/MusicSuite-0.4.1-Windows-x64.zip.sha256). If the repository is private, you must sign in to a GitHub account with access to download it.

Requires **Windows 10 22H2 or Windows 11, x64**, with a modern browser. This package does not target 32-bit Windows or ARM64. Saved music works offline; online imports need internet access.

## Reopen or quit

MusicSuite keeps running when you close its browser tab. Its record icon appears in the Windows notification area, sometimes under the hidden-icons arrow.

- **Open MusicSuite** reopens the browser interface. Double-clicking MusicSuite.exe again does this too.
- **Open library folder** shows your stored music and database.
- **Quit MusicSuite** stops downloads and closes the local server cleanly.

The app listens only on your computer at `http://127.0.0.1:3333`.

## Your music and updates

Your library is stored separately at **`%LOCALAPPDATA%\MusicSuite\Library`**. Paste that path into File Explorer's address bar to open it. Imported audio is copied there; the original files are preserved.

To update, **Quit MusicSuite**, extract the new ZIP into a new folder, and open its MusicSuite.exe. You can remove the old app folder after checking the new version. Keep all files in the new package together.

For a full backup, Quit MusicSuite and copy the entire library folder. Browser themes, drafts, and listening preferences are separate; see the [user guide](usage.md#backups-and-storage).

"Portable" means the app runs from an extracted folder without installation. The default library stays with your Windows user account. To carry the library on a USB drive too, launch with `MUSICSUITE_DATA_DIR` set to a folder on that drive.

## If it will not open

- Extract the ZIP first; opening the executable inside the ZIP is insufficient.
- Keep `app/`, `runtime/`, `tools/`, and MusicSuite.exe together.
- If port 3333 is occupied, quit the existing app using it. A source installation and the portable app have separate libraries and cannot share that port simultaneously.
- Check **launcher.log** inside the library folder for details.
- The executable is currently unsigned. Windows may show a publisher warning for a downloaded release.

## Building a release

On Windows x64 with Node.js 24 or newer, run from the repository root:

```powershell
npm ci
npm run package:windows
```

The build uses Windows PowerShell, `tar.exe`, and the Windows .NET Framework compiler. It installs only production dependencies into an isolated staging folder. No compiler or package manager is needed by recipients.

Outputs:

- `releases/MusicSuite-0.4.1-Windows-x64.zip`
- `releases/MusicSuite-0.4.1-Windows-x64.zip.sha256`

Upload these files to GitHub Releases when publishing. GitHub's **Code → Download ZIP** downloads the source, which still needs setup. No publishing happens as part of the build command.

Tool versions, upstream URLs, source references, and SHA-256 checksums are pinned in `scripts/windows/tools.lock.json`. Downloads are verified before extraction or execution. Verified archives are reused from `.cache/portable-downloads`; upstream rolling FFmpeg releases can expire, so preserve that cache or update the pins deliberately. The package includes third-party notices, source archives/references, replaceable FFmpeg DLLs, and a per-file release manifest.

The build copies an explicit list of application folders. It excludes your library, `.tools/`, environment files, browser tests, and development dependencies. Do not add private files to packaged source folders.

To compare a downloaded ZIP against its checksum:

```powershell
Get-FileHash .\MusicSuite-0.4.1-Windows-x64.zip -Algorithm SHA256
Get-Content .\MusicSuite-0.4.1-Windows-x64.zip.sha256
```
