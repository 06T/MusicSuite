
export function createDemoWav(seconds = 32): Buffer {
  const sampleRate = 44100;
  const frames = Math.round(sampleRate * seconds);
  const buffer = Buffer.alloc(44 + frames * 4);
  buffer.write('RIFF', 0); buffer.writeUInt32LE(buffer.length - 8, 4); buffer.write('WAVEfmt ', 8);
  buffer.writeUInt32LE(16, 16); buffer.writeUInt16LE(1, 20); buffer.writeUInt16LE(2, 22);
  buffer.writeUInt32LE(sampleRate, 24); buffer.writeUInt32LE(sampleRate * 4, 28);
  buffer.writeUInt16LE(4, 32); buffer.writeUInt16LE(16, 34); buffer.write('data', 36); buffer.writeUInt32LE(frames * 4, 40);
  const chords = [[130.81, 164.81, 196, 246.94], [110, 130.81, 164.81, 196], [87.31, 110, 130.81, 164.81], [98, 123.47, 146.83, 196]];
  let seed = 719;
  for (let i = 0; i < frames; i++) {
    const t = i / sampleRate;
    const chord = chords[Math.floor(t / 8) % chords.length];
    const beat = t % 0.75;
    const kick = Math.sin(2 * Math.PI * (45 * beat + 13 * (1 - Math.exp(-beat * 30)))) * Math.exp(-beat * 20) * 0.13;
    seed = (Math.imul(seed, 1664525) + 1013904223) | 0;
    const noise = (seed >>> 0) / 2147483648 - 1;
    const hat = noise * Math.exp(-(t % 0.375) * 90) * 0.018;
    const fade = Math.min(1, t / 1.5, (seconds - t) / 2);
    for (let channel = 0; channel < 2; channel++) {
      let pad = 0;
      chord.forEach((frequency, j) => {
        const drift = channel ? 1.001 : 0.999;
        pad += Math.sin(2 * Math.PI * frequency * drift * t + j) * 0.042;
        pad += Math.sin(2 * Math.PI * frequency * 2 * drift * t) * 0.008;
      });
      const shimmer = Math.sin(2 * Math.PI * chord[Math.floor(t / 0.75) % 4] * 4 * t) * Math.exp(-beat * 4) * 0.024;
      const sample = (pad + kick + hat + shimmer) * fade;
      buffer.writeInt16LE(Math.round(Math.max(-1, Math.min(1, sample)) * 32767), 44 + (i * 2 + channel) * 2);
    }
  }
  return buffer;
}
