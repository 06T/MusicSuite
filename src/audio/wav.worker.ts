import { encodeWav, type WavOptions } from './wav.ts';

const scope = globalThis as unknown as {
  onmessage: (event: MessageEvent<{ channels: Float32Array[]; options: WavOptions }>) => void;
  postMessage: (message: unknown, transfer?: Transferable[]) => void;
};
scope.onmessage = event => {
  try {
    const result = encodeWav(event.data.channels, event.data.options, value => scope.postMessage({ type: 'progress', value }));
    scope.postMessage({ type: 'complete', ...result }, [result.buffer]);
  } catch (error) { scope.postMessage({ type: 'error', message: error instanceof Error ? error.message : 'Could not encode the audio.' }); }
};
