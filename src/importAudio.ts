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
  const files: File[] = [];
  const errors: string[] = [];
  async function visit(entry: FileSystemEntry): Promise<void> {
    try {
      if (entry.isFile) {
        files.push(await new Promise<File>((resolve, reject) => (entry as FileSystemFileEntry).file(resolve, reject)));
      } else if (entry.isDirectory) {
        const reader = (entry as FileSystemDirectoryEntry).createReader();

        for (;;) {
          const entries = await new Promise<FileSystemEntry[]>((resolve, reject) => reader.readEntries(resolve, reject));
          if (!entries.length) break;
          for (const child of entries) await visit(child);
        }
      }
    } catch { errors.push(`${entry.fullPath || entry.name}: could not read this item. Try choosing the folder instead.`); }
  }
  if (!roots.length) return { files: fallback, errors };
  for (const root of roots) {
    if (root.entry) await visit(root.entry);
    else if (root.file) files.push(root.file);
  }
  return { files, errors };
}
