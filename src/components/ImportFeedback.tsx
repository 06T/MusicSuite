import { CheckCircle, FolderOpen, Info, SpinnerGap, X } from '@phosphor-icons/react';

export type ImportProgress = { complete: number; total: number; percent: number; reading: boolean };
export type ImportReport = { added: number; duplicates: number; ignored: number; errors: string[] };

export function ImportFeedback({ importing, progress, report, onDismiss }: {
  importing: boolean; progress: ImportProgress; report: ImportReport | null; onDismiss: () => void;
}) {
  if (!importing && !report) return null;
  return <section className={`import-feedback ${report?.errors.length ? 'has-errors' : ''}`} aria-label="Import status">
    <div className="import-feedback-main">
      <span className="import-feedback-icon">{importing ? <FolderOpen size={21} /> : report?.errors.length ? <Info size={21} /> : <CheckCircle size={21} />}</span>
      <div className="import-feedback-copy"><strong role="status">{importing ? progress.total ? 'Bringing your music in' : 'Finding audio in your folder…' : report?.added ? `${report.added} ${report.added === 1 ? 'track' : 'tracks'} added` : report?.duplicates ? 'Already in your library' : 'Import finished'}</strong>
        <p>{importing ? progress.total ? `${progress.complete} of ${progress.total} processed · ${progress.reading ? 'Reading track details' : 'Copying audio'}` : 'Including music in subfolders.' : [report?.duplicates ? `${report.duplicates} already in your library` : '', report?.ignored ? `${report.ignored} non-audio ${report.ignored === 1 ? 'file' : 'files'} skipped` : '', report?.errors.length ? `${report.errors.length} ${report.errors.length === 1 ? 'item needs' : 'items need'} attention` : ''].filter(Boolean).join(' · ') || 'Your collection is ready to listen.'}</p>
      </div>
      {importing ? <SpinnerGap size={18} className="spin" /> : <button className="icon-button" aria-label="Dismiss import summary" onClick={onDismiss}><X size={17} /></button>}
    </div>
    {importing && progress.total > 0 && <div className="import-progress" role="progressbar" aria-label="Audio import progress" aria-valuemin={0} aria-valuemax={100} aria-valuenow={progress.percent}><span style={{ transform: `scaleX(${progress.percent / 100})` }} /></div>}
    {!importing && !!report?.errors.length && <details className="import-issues"><summary>Review skipped items</summary><ul>{report.errors.map((error, index) => <li key={index}>{error}</li>)}</ul></details>}
  </section>;
}
