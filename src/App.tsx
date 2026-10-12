import { FolderPlus, VinylRecord as Vinyl } from '@phosphor-icons/react';
import { ImportFeedback } from './components/ImportFeedback.tsx';
import { OnlineImportStatus } from './components/LinkImport.tsx';
import { Studio } from './components/Studio.tsx';
import { UpNext } from './components/UpNext.tsx';
import { readDroppedAudio } from './importAudio.ts';
import { useMusicSuite } from './useMusicSuite.ts';

import { AddPlaylistDialog, ExportMixDialog, KeyboardHelpDialog, LibrarySection, LinkImportDialog, ListeningDeck, PlaylistEditor, RemoveItemDialog, RemovePlaylistDialog, RestoreBackupDialog, SaveVersionDialog, TrackDetailsDialog, WorkspaceBackupDialog, WorkspaceHeader, WorkspaceNotices, WorkspaceSidebar } from './components/Workspace.tsx';

export default function App() {
  const workspace = useMusicSuite();
  const { player, settings, mixName, edit, loop, setLoop, repeat, view, queueOpen, setQueueOpen, importing, importProgress, importReport, setImportReport, inputMode, dragging, setDragging, setDialog, onlineJob, setVersionName, fileInput, folderInput, backupInput, dragDepth, importLock, selected, trackVersions, ready, activePlaylist, queueControl, queue, upcomingTracks, trackHistory, changeMix, changeEdit, restoreHistory, selectVersion, importAudio, chooseBackup, formatAccept } = workspace;
  return <div className="app-shell" data-input={inputMode} onDragEnter={event => { if (event.dataTransfer.types.includes('Files')) { event.preventDefault(); dragDepth.current++; setDragging(true); } }} onDragOver={event => { if (event.dataTransfer.types.includes('Files')) event.preventDefault(); }} onDragLeave={event => { event.preventDefault(); dragDepth.current--; if (dragDepth.current <= 0) { dragDepth.current = 0; setDragging(false); } }} onDrop={event => { event.preventDefault(); dragDepth.current = 0; setDragging(false); if (event.dataTransfer.types.includes('Files') && !importLock.current && !importing) void importAudio(readDroppedAudio(event.dataTransfer)); }}>
    <input ref={fileInput} type="file" accept={formatAccept} multiple className="hidden-input" aria-label="Import audio files" onChange={event => void importAudio(Array.from(event.target.files ?? []))} />
    <input ref={backupInput} type="file" accept=".json,application/json" className="hidden-input" aria-label="Restore workspace file" onChange={event => void chooseBackup(event.target.files?.[0])} />
    <input ref={folderInput} type="file" multiple {...{ webkitdirectory: '', directory: '' }} className="hidden-input" aria-label="Import a music folder" onChange={event => { if (event.target.files?.length) void importAudio(Array.from(event.target.files)); }} />
    <WorkspaceSidebar {...workspace} />
    <div className="main-shell">
      <WorkspaceHeader {...workspace} />
      <div className="workspace">
        <main className="library-main">
          <ImportFeedback importing={importing && importLock.current} progress={importProgress} report={importReport} onDismiss={() => setImportReport(null)} />
          {onlineJob && <OnlineImportStatus job={onlineJob} onOpen={() => setDialog('link-import')} />}
          <ListeningDeck {...workspace} />
          {selected && <UpNext tracks={upcomingTracks} current={selected} playing={player.playing} collection={view === 'playlist' ? activePlaylist?.name ?? 'this playlist' : view === 'favorites' ? 'Favorites' : 'your library'} expanded={queueOpen} modified={queueControl.custom || queueControl.excluded.length > 0} repeat={repeat && queue.length > 0} loop={loop} onExpandedChange={setQueueOpen} onMove={queueControl.move} onPlace={queueControl.place} onRemove={queueControl.remove} onReset={queueControl.reset} />}
          <LibrarySection {...workspace} />
          <footer className="workspace-footer"><Vinyl size={14} /><span>Made for listening a little differently.</span><span>Everything stays local.</span></footer>
        </main>
        <Studio track={selected} settings={settings} onChange={changeMix} onSave={() => { setVersionName(mixName === 'Original' || mixName === 'Custom mix' ? 'My mix' : mixName); setDialog('save'); }} versions={trackVersions} onVersion={selectVersion} mixName={mixName} peak={player.peak} edit={edit} duration={ready ? player.duration : 0} position={player.position} loop={loop} onEdit={changeEdit} onLoop={() => setLoop(!loop)} onUndo={() => restoreHistory()} onRedo={() => restoreHistory(true)} canUndo={!!trackHistory?.past.length} canRedo={!!trackHistory?.future.length} />
      </div>
    </div>
    {dragging && <div className="drop-overlay"><div><FolderPlus size={54} /><h2>Give your music a new home.</h2><p>Drop audio files or folders. We’ll find the music inside.</p></div></div>}
    <PlaylistEditor {...workspace} />
    <LinkImportDialog {...workspace} />
    <TrackDetailsDialog {...workspace} />
    <RemovePlaylistDialog {...workspace} />
    <AddPlaylistDialog {...workspace} />
    <WorkspaceBackupDialog {...workspace} />
    <RestoreBackupDialog {...workspace} />
    <WorkspaceNotices {...workspace} />
    <SaveVersionDialog {...workspace} />
    <ExportMixDialog {...workspace} />
    <RemoveItemDialog {...workspace} />
    <KeyboardHelpDialog {...workspace} />
  </div>;
}
