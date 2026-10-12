import type { MixSettings } from '../../shared/types.ts';

export function createImpulse(context: BaseAudioContext, decay: number): AudioBuffer {
  const length = Math.ceil(context.sampleRate * decay);
  const impulse = context.createBuffer(2, length, context.sampleRate);
  for (let channel = 0; channel < 2; channel++) {
    let seed = 739 + channel * 8191;
    const samples = impulse.getChannelData(channel);
    for (let i = 0; i < length; i++) {
      seed = (Math.imul(seed, 1664525) + 1013904223) | 0;
      const noise = (seed >>> 0) / 2147483648 - 1;
      samples[i] = noise * Math.exp(-6 * i / length) * Math.min(1, i / (context.sampleRate * 0.01));
    }
  }
  return impulse;
}

/** The same graph is used for real-time listening and offline export. */
export function createEffectGraph(context: BaseAudioContext, settings: MixSettings) {
  const input = context.createGain();
  const bass = context.createBiquadFilter(); bass.type = 'lowshelf'; bass.frequency.value = 180;
  const mid = context.createBiquadFilter(); mid.type = 'peaking'; mid.frequency.value = 1000; mid.Q.value = 0.7;
  const treble = context.createBiquadFilter(); treble.type = 'highshelf'; treble.frequency.value = 4500;
  const dry = context.createGain();
  const wet = context.createGain();
  const outputGain = context.createGain();
  const limiter = context.createDynamicsCompressor();
  limiter.threshold.value = -1; limiter.knee.value = 0; limiter.ratio.value = 20;
  limiter.attack.value = 0.003; limiter.release.value = 0.08;
  input.connect(bass); bass.connect(mid); mid.connect(treble);
  treble.connect(dry); dry.connect(outputGain); wet.connect(outputGain); outputGain.connect(limiter);

  let currentDecay = settings.decay;
  let convolver = context.createConvolver();
  convolver.buffer = createImpulse(context, currentDecay);
  let convolutionGain = context.createGain();
  treble.connect(convolver); convolver.connect(convolutionGain); convolutionGain.connect(wet);
  const retiring: { convolver: ConvolverNode; gain: GainNode; timer: ReturnType<typeof setTimeout> }[] = [];

  function set(parameter: AudioParam, value: number, smooth: boolean) {
    const now = context.currentTime;
    parameter.cancelScheduledValues(now);
    if (smooth) parameter.setTargetAtTime(value, now, 0.025);
    else parameter.setValueAtTime(value, now);
  }

  function update(next: MixSettings, smooth = true) {
    set(bass.gain, next.bass, smooth); set(mid.gain, next.mid, smooth); set(treble.gain, next.treble, smooth);
    set(dry.gain, Math.cos(next.reverb * Math.PI / 2), smooth);
    set(wet.gain, Math.sin(next.reverb * Math.PI / 2), smooth);
    set(outputGain.gain, 10 ** (next.output / 20), smooth);
    if (next.decay !== currentDecay) {
      currentDecay = next.decay;
      const oldConvolver = convolver;
      const oldGain = convolutionGain;
      convolver = context.createConvolver(); convolver.buffer = createImpulse(context, currentDecay);
      convolutionGain = context.createGain();
      treble.connect(convolver); convolver.connect(convolutionGain); convolutionGain.connect(wet);
      if (smooth) {
        convolutionGain.gain.setValueAtTime(0, context.currentTime);
        convolutionGain.gain.linearRampToValueAtTime(1, context.currentTime + 0.12);
        oldGain.gain.cancelScheduledValues(context.currentTime);
        oldGain.gain.linearRampToValueAtTime(0, context.currentTime + 0.12);
      }
      const entry = { convolver: oldConvolver, gain: oldGain, timer: setTimeout(() => {
        try { treble.disconnect(oldConvolver); } catch { /* Already disposed. */ }
        oldConvolver.disconnect(); oldGain.disconnect();
        const index = retiring.indexOf(entry); if (index >= 0) retiring.splice(index, 1);
      }, 200) };
      retiring.push(entry);
    }
  }
  update(settings, false);
  return {
    input, output: limiter, update,
    dispose() {
      retiring.forEach(entry => { clearTimeout(entry.timer); entry.convolver.disconnect(); entry.gain.disconnect(); });
      [input, bass, mid, treble, dry, wet, outputGain, limiter, convolver, convolutionGain].forEach(node => node.disconnect());
    },
  };
}
