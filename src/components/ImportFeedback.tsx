import { CheckCircle, FolderOpen, Info, SpinnerGap, X } from '@phosphor-icons/react';

export type ImportProgress = { complete: number; total: number; percent: number; reading: boolean };
export type ImportReport = { added: number; duplicates: number; ignored: number; errors: string[] };

function reportTitle(report: ImportReport) {
  if (report.added) return `${report.added} ${report.added === 1 ? 'track' : 'tracks'} added`;
  return report.duplicates ? 'Already in your library' : 'Import finished';
}

function reportSummary(report: ImportReport) {
  const parts = [];
  if (report.duplicates) parts.push(`${report.duplicates} already in your library`);
  if (report.ignored) parts.push(`${report.ignored} non-audio ${report.ignored === 1 ? 'file' : 'files'} skipped`);
  if (report.errors.length) parts.push(`${report.errors.length} ${report.errors.length === 1 ? 'item needs' : 'items need'} attention`);
  return parts.join(' · ') || 'Your collection is ready to listen.';
}

function ImportIssues({ errors }: { errors: string[] }) {

  const counts = new Map<string, number>();
  for (const error of errors) counts.set(error, (counts.get(error) ?? 0) + 1);
  return <details className="import-issues"><summary>Review skipped items</summary><ul>{Array.from(counts, ([error, count]) => <li key={error}>{error}{count > 1 && ` (${count} items)`}</li>)}</ul></details>;
}

function ImportInProgress({ progress }: { progress: ImportProgress }) {
  return <section className="import-feedback" aria-label="Import status">
    <div className="import-feedback-main"><span className="import-feedback-icon"><FolderOpen size={21} /></span>
      <div className="import-feedback-copy"><strong role="status">{progress.total ? 'Bringing your music in' : 'Finding audio in your folder…'}</strong><p>{progress.total ? `${progress.complete} of ${progress.total} processed · ${progress.reading ? 'Reading track details' : 'Copying audio'}` : 'Including music in subfolders.'}</p></div><SpinnerGap size={18} className="spin" />
    </div>
    {progress.total > 0 && <div className="import-progress" role="progressbar" aria-label="Audio import progress" aria-valuemin={0} aria-valuemax={100} aria-valuenow={progress.percent}><span style={{ transform: `scaleX(${progress.percent / 100})` }} /></div>}
  </section>;
}

export function ImportFeedback({ importing, progress, report, onDismiss }: {
  importing: boolean; progress: ImportProgress; report: ImportReport | null; onDismiss: () => void;
}) {
  if (importing) return <ImportInProgress progress={progress} />;
  if (!report) return null;
  const hasErrors = report.errors.length > 0;
  return <section className={`import-feedback ${hasErrors ? 'has-errors' : ''}`} aria-label="Import status">
    <div className="import-feedback-main"><span className="import-feedback-icon">{hasErrors ? <Info size={21} /> : <CheckCircle size={21} />}</span><div className="import-feedback-copy"><strong role="status">{reportTitle(report)}</strong><p>{reportSummary(report)}</p></div><button type="button" className="icon-button" aria-label="Dismiss import summary" onClick={onDismiss}><X size={17} /></button></div>
    {hasErrors && <ImportIssues errors={report.errors} />}
  </section>;
}
