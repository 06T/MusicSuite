import { mapConcurrent } from '../shared/async.ts';

export const MAX_AUDIO_BYTES = 100 * 1024 * 1024;
export const IMPORT_BATCH_SIZE = 10;

export function isAudioFile(file: Pick<File, 'name'>) {
  return /\.(mp3|wav|flac|m4a|ogg|aac|opus|aiff?)$/i.test(file.name);
}

export type DroppedAudio = { files: File[]; errors: string[] };


export async function readDroppedAudio(transfer: DataTransfer): Promise<DroppedAudio> {
  const fallback = Array.from(transfer.files);
  const roots = Array.from(transfer.items).filter(item => item.kind === 'file').map(item => ({
    entry: item.webkitGetAsEntry?.() ?? null,
    file: item.getAsFile(),
  }));
  const combine = (results: DroppedAudio[]): DroppedAudio => ({ files: results.flatMap(result => result.files), errors: results.flatMap(result => result.errors) });
  async function visit(entry: FileSystemEntry): Promise<DroppedAudio> {
    const results: DroppedAudio[] = [];
    try {
      if (entry.isFile) {
        const file = await new Promise<File>((resolve, reject) => (entry as FileSystemFileEntry).file(resolve, reject));
        return { files: [file], errors: [] };
      }
      if (entry.isDirectory) {
        const reader = (entry as FileSystemDirectoryEntry).createReader();


        while (true) {
          const entries = await new Promise<FileSystemEntry[]>((resolve, reject) => reader.readEntries(resolve, reject));
          if (!entries.length) break;
          const concurrency = entries.some(child => child.isDirectory) ? 1 : 4;
          results.push(...await mapConcurrent(entries, concurrency, visit));
        }
        return combine(results);
      }
      return { files: [], errors: [] };
    } catch {
      const completed = combine(results);
      return { files: completed.files, errors: [...completed.errors, `${entry.fullPath || entry.name}: could not read this item. Try choosing the folder instead.`] };
    }
  }
  if (!roots.length) return { files: fallback, errors: [] };
  const concurrency = roots.some(root => root.entry?.isDirectory) ? 1 : 4;
  return combine(await mapConcurrent(roots, concurrency, async root => root.entry ? visit(root.entry) : { files: root.file ? [root.file] : [], errors: [] }));
}
