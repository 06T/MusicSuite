export interface WavOptions { sampleRate: number; bitDepth: 16 | 24; normalize: boolean }

export function encodeWav(channels: Float32Array[], options: WavOptions, progress?: (value: number) => void) {
  const frames = channels[0]?.length ?? 0;
  if (!frames || channels.some(channel => channel.length !== frames)) throw new Error('Audio channels are empty or have different lengths.');
  const bytesPerSample = options.bitDepth / 8;
  const dataLength = frames * channels.length * bytesPerSample;
  if (dataLength > 0xffffffff - 36) throw new Error('This recording is too large for a WAV file.');
  const output = new ArrayBuffer(44 + dataLength);
  const view = new DataView(output);
  const text = (offset: number, value: string) => { for (let i = 0; i < value.length; i++) view.setUint8(offset + i, value.charCodeAt(i)); };
  text(0, 'RIFF'); view.setUint32(4, 36 + dataLength, true); text(8, 'WAVE'); text(12, 'fmt ');
  view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, channels.length, true);
  view.setUint32(24, options.sampleRate, true); view.setUint32(28, options.sampleRate * channels.length * bytesPerSample, true);
  view.setUint16(32, channels.length * bytesPerSample, true); view.setUint16(34, options.bitDepth, true);
  text(36, 'data'); view.setUint32(40, dataLength, true);
  let peak = 0;
  for (const channel of channels) for (const sample of channel) peak = Math.max(peak, Math.abs(sample));
  const gain = options.normalize && peak > 0 ? 10 ** (-1 / 20) / peak : 1;
  let clipped = 0;
  let offset = 44;
  const interval = Math.max(1, Math.floor(frames / 20));
  for (let i = 0; i < frames; i++) {
    for (const channel of channels) {
      const raw = channel[i] * gain;
      if (Math.abs(raw) > 1) clipped++;
      const sample = Math.max(-1, Math.min(1, raw));
      if (options.bitDepth === 16) {
        view.setInt16(offset, Math.round(sample < 0 ? sample * 32768 : sample * 32767), true);
      } else {
        const value = Math.round(sample < 0 ? sample * 8388608 : sample * 8388607);
        view.setUint8(offset, value & 0xff); view.setUint8(offset + 1, (value >> 8) & 0xff); view.setUint8(offset + 2, (value >> 16) & 0xff);
      }
      offset += bytesPerSample;
    }
    if (i % interval === 0) progress?.(Math.round(i / frames * 100));
  }
  progress?.(100);
  return { buffer: output, clipped, peak };
}
