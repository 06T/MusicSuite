import { DEFAULT_EDIT, resolveEdit, type AudioEdit, type MixSettings } from '../../shared/types.ts';
import { createEffectGraph } from './graph.ts';

export interface ExportOptions { bitDepth: 16 | 24; tail: boolean; normalize: boolean; edit?: AudioEdit }

export async function exportAudio(buffer: AudioBuffer, settings: MixSettings, options: ExportOptions, onProgress: (phase: string) => void) {
  const sampleRate = 44100;
  const tail = options.tail && settings.reverb > 0 ? settings.decay + 0.15 : 0;
  const range = resolveEdit(options.edit ?? DEFAULT_EDIT, buffer.duration, settings.speed);
  const length = Math.ceil((range.length + tail) * sampleRate);
  if (length * 2 * 4 > 256 * 1024 * 1024) throw new Error('This export is too long to render safely in the browser. Use a faster speed or a shorter track.');
  onProgress('Rendering your mix…');
  const context = new OfflineAudioContext(2, length, sampleRate);
  const graph = createEffectGraph(context, settings);
  const source = context.createBufferSource(); source.buffer = buffer; source.playbackRate.value = settings.speed;
  const envelope = context.createGain();
  envelope.gain.setValueAtTime(range.fadeIn ? 0 : 1, 0);
  if (range.fadeIn) envelope.gain.linearRampToValueAtTime(1, range.fadeIn);
  if (range.fadeOut) { envelope.gain.setValueAtTime(1, range.length - range.fadeOut); envelope.gain.linearRampToValueAtTime(0, range.length); }
  source.connect(envelope); envelope.connect(graph.input); graph.output.connect(context.destination); source.start(0, range.start, range.end - range.start);
  const rendered = await context.startRendering();
  source.disconnect(); envelope.disconnect(); graph.dispose();
  onProgress('Encoding WAV…');
  const channels = [new Float32Array(rendered.length), new Float32Array(rendered.length)];
  channels.forEach((channel, index) => rendered.copyFromChannel(channel, index));
  return await new Promise<{ blob: Blob; clipped: number }>((resolve, reject) => {
    const worker = new Worker(new URL('./wav.worker.ts', import.meta.url), { type: 'module' });
    worker.onerror = () => { worker.terminate(); reject(new Error('WAV encoding failed. Try exporting again.')); };
    worker.onmessage = event => {
      const data = event.data;
      if (data.type === 'progress') onProgress(`Encoding WAV · ${data.value}%`);
      else if (data.type === 'error') { worker.terminate(); reject(new Error(data.message)); }
      else if (data.type === 'complete') {
        worker.terminate(); resolve({ blob: new Blob([data.buffer], { type: 'audio/wav' }), clipped: data.clipped });
      }
    };
    worker.postMessage({ channels, options: { sampleRate, bitDepth: options.bitDepth, normalize: options.normalize } }, channels.map(channel => channel.buffer));
  });
}
