import { DEFAULT_EDIT, DEFAULT_MIX, resolveEdit, type AudioEdit, type MixSettings } from '../../shared/types.ts';
import { createEffectGraph } from './graph.ts';
import { crossfadeCurves, crossfadeDuration } from './crossfade.ts';
import { estimatedPcmBytes, pcmBytes, PRELOAD_BUDGET } from './memory.ts';

export interface PlayerState {
  playing: boolean; loading: boolean; position: number; duration: number; peak: number; ended: number;
  trackId: string | null; crossfading: boolean; preloadLimited: boolean;
}
type Voice = {
  id: string; buffer: AudioBuffer; edit: AudioEdit; loop: boolean;
  source: AudioBufferSourceNode; envelope: GainNode; blend: GainNode;
  offset: number; rateStart: number; rateTarget: number; rateTime: number;
};
type Prepared = { id: string; buffer: AudioBuffer; edit: AudioEdit; seconds: number };
type Transition = { from: Voice; to: Voice; start: number; end: number; angle: number; promoted: boolean };

export class AudioEngine {
  private context: AudioContext | null = null;
  private graph: ReturnType<typeof createEffectGraph> | null = null;
  private analyser: AnalyserNode | null = null;
  private volumeNode: GainNode | null = null;
  private voice: Voice | null = null;
  private transition: Transition | null = null;
  private transitionTimer: ReturnType<typeof setTimeout> | undefined;
  private prepared: Prepared | null = null;
  private preparation: { id: string; edit: AudioEdit; seconds: number; controller: AbortController; promise: Promise<void> } | null = null;
  private buffer: AudioBuffer | null = null;
  private settings = { ...DEFAULT_MIX };
  private edit: AudioEdit = { ...DEFAULT_EDIT };
  private loop = false;
  private playToken = 0;
  private playPending = false;
  private volume = 0.75;
  private offset = 0;
  private loadToken = 0;
  private loadController: AbortController | null = null;
  private animation = 0;
  private lastUpdate = 0;
  private meter = new Float32Array(512);
  private listeners = new Set<() => void>();
  private snapshot: PlayerState = { playing: false, loading: false, position: 0, duration: 0, peak: 0, ended: 0, trackId: null, crossfading: false, preloadLimited: false };

  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  getSnapshot = () => this.snapshot;
  getBuffer() { return this.buffer; }
  getEdit() { return { ...this.edit }; }
  isPlaying() { return this.snapshot.playing || this.playPending; }

  private publish(update: Partial<PlayerState>) {
    this.snapshot = { ...this.snapshot, ...update };
    this.listeners.forEach(listener => listener());
  }

  private ensureContext() {
    if (!this.context) {
      this.context = new AudioContext({ sampleRate: 44100, latencyHint: 'interactive' });
      this.graph = createEffectGraph(this.context, this.settings);
      this.analyser = this.context.createAnalyser(); this.analyser.fftSize = 512;
      this.volumeNode = this.context.createGain(); this.volumeNode.gain.value = this.volume;
      this.graph.output.connect(this.analyser); this.analyser.connect(this.volumeNode); this.volumeNode.connect(this.context.destination);
    }
    return this.context;
  }

  private async decode(id: string, signal?: AbortSignal) {
    const response = await fetch('/api/tracks/' + id + '/audio', { signal });
    if (!response.ok) throw new Error('This track is missing. Import it again.');
    const bytes = await response.arrayBuffer();
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
    try { return await this.ensureContext().decodeAudioData(bytes); }
    catch (error) {
      if (error instanceof DOMException && error.name === 'EncodingError') throw new Error('Your browser could not decode this track. Try converting it to WAV or MP3.');
      throw error;
    }
  }

  async load(id: string, signal?: AbortSignal) {
    const token = ++this.loadToken;
    this.loadController?.abort(); this.loadController = new AbortController();
    const loadSignal = signal ? AbortSignal.any([signal, this.loadController.signal]) : this.loadController.signal;
    this.cancelPreparation(); this.stopSources(); this.buffer = null; this.offset = 0;

    if (this.context && this.analyser) {
      this.graph?.dispose(); this.graph = createEffectGraph(this.context, this.settings);
      this.graph.output.connect(this.analyser); void this.context.suspend().catch(() => {});
    }
    this.publish({ trackId: id, playing: false, loading: true, duration: 0, position: 0, peak: 0, crossfading: false, preloadLimited: false });
    try {
      const buffer = await this.decode(id, loadSignal);
      if (loadSignal.aborted || token !== this.loadToken) return;
      this.buffer = buffer; this.offset = resolveEdit(this.edit, buffer.duration).start;
      this.publish({ loading: false, duration: buffer.duration, position: this.offset });
    } catch (error) {
      if (token !== this.loadToken || loadSignal.aborted) return;
      this.publish({ loading: false }); throw error;
    }
  }

  /** Decode one upcoming song without interrupting the current recording. */
  async prepareNext(id: string | null, edit: AudioEdit = DEFAULT_EDIT, seconds = 0, expectedDuration = 0) {
    this.promoteTransition();
    if (this.transition?.promoted) return;
    if (!id || seconds <= 0 || this.loop) { this.cancelPreparation(); this.cancelTransition(); this.setPreloadLimited(false); return; }
    const currentBytes = this.buffer ? pcmBytes(this.buffer.length, this.buffer.numberOfChannels) : 0;
    if (id !== this.snapshot.trackId && expectedDuration > 0 && currentBytes + estimatedPcmBytes(expectedDuration) > PRELOAD_BUDGET) {
      this.cancelPreparation(); this.cancelTransition(); this.setPreloadLimited(true); return;
    }
    this.setPreloadLimited(false);
    if (this.preparation?.id === id) {
      const request = this.preparation;
      if (request.seconds !== seconds || JSON.stringify(request.edit) !== JSON.stringify(edit)) {
        this.cancelTransition(); request.edit = { ...edit }; request.seconds = seconds;
        if (this.prepared) this.prepared = { ...this.prepared, edit: { ...edit }, seconds };
      }
      this.scheduleTransition(); return request.promise;
    }
    this.cancelPreparation(); this.cancelTransition();
    const controller = new AbortController();
    const request = { id, edit: { ...edit }, seconds, controller, promise: Promise.resolve() };
    this.preparation = request;
    request.promise = (async () => {
      try {
        const buffer = id === this.snapshot.trackId && this.buffer ? this.buffer : await this.decode(id, controller.signal);
        if (controller.signal.aborted) return;
        if (buffer !== this.buffer && currentBytes + pcmBytes(buffer.length, buffer.numberOfChannels) > PRELOAD_BUDGET) { this.setPreloadLimited(true); return; }
        this.prepared = { id, buffer, edit: { ...request.edit }, seconds: request.seconds };
        this.scheduleTransition();
      } catch { /* A failed preload falls back to the normal queue advance and its error feedback. */ }
    })();
    await request.promise;
  }

  private setPreloadLimited(value: boolean) {
    if (this.snapshot.preloadLimited !== value) this.publish({ preloadLimited: value });
  }

  async play() {
    if (!this.buffer || this.snapshot.loading) return;
    const token = ++this.playToken;
    this.playPending = true;
    const context = this.ensureContext();
    try { await context.resume(); }
    catch (error) { if (token === this.playToken) this.playPending = false; throw error; }
    if (!this.buffer || token !== this.playToken) return;
    this.stopSources();
    const range = resolveEdit(this.edit, this.buffer.duration, this.settings.speed);
    if (this.offset >= range.end - 0.01 || this.offset < range.start) this.offset = range.start;
    this.voice = this.createVoice(this.snapshot.trackId!, this.buffer, this.edit, this.offset, context.currentTime, this.loop);
    this.publish({ playing: true, crossfading: false });
    this.scheduleTransition(); this.tick();
  }

  private createVoice(id: string, buffer: AudioBuffer, edit: AudioEdit, offset: number, when: number, loop = false): Voice {
    const context = this.ensureContext();
    const range = resolveEdit(edit, buffer.duration, this.settings.speed);
    const source = context.createBufferSource(); source.buffer = buffer; source.playbackRate.value = this.settings.speed;
    source.loop = loop; source.loopStart = range.start; source.loopEnd = range.end;
    const envelope = context.createGain(); const blend = context.createGain();
    const voice = { id, buffer, edit: { ...edit }, loop, source, envelope, blend, offset, rateStart: this.settings.speed, rateTarget: this.settings.speed, rateTime: when };
    envelope.gain.value = this.fadeLevel(voice, offset);
    source.connect(envelope); envelope.connect(blend); blend.connect(this.graph!.input);
    source.onended = () => this.voiceEnded(voice);
    this.scheduleEnvelope(voice);
    if (loop) source.start(when, offset); else source.start(when, offset, range.end - offset);
    return voice;
  }

  private instantRate(voice: Voice, now: number) {
    return voice.rateTarget + (voice.rateStart - voice.rateTarget) * Math.exp(-Math.max(0, now - voice.rateTime) / 0.025);
  }

  private voicePosition(voice: Voice, now = this.context!.currentTime) {
    const elapsed = Math.max(0, now - voice.rateTime);
    const traveled = voice.rateTarget * elapsed + (voice.rateStart - voice.rateTarget) * 0.025 * (1 - Math.exp(-elapsed / 0.025));
    const range = resolveEdit(voice.edit, voice.buffer.duration);
    return voice.loop && range.end > range.start ? range.start + ((voice.offset - range.start + traveled) % (range.end - range.start)) : Math.min(range.end, voice.offset + traveled);
  }

  private remainingTime(voice: Voice) {
    const now = this.context!.currentTime;
    const remaining = resolveEdit(voice.edit, voice.buffer.duration).end - this.voicePosition(voice, now);
    const rate = this.instantRate(voice, now); let time = remaining / voice.rateTarget;

    for (let i = 0; i < 5; i++) {
      const exp = Math.exp(-time / 0.025);
      time = Math.max(0, time - (voice.rateTarget * time + (rate - voice.rateTarget) * 0.025 * (1 - exp) - remaining) / (voice.rateTarget + (rate - voice.rateTarget) * exp));
    }
    return time;
  }

  position() { this.promoteTransition(); return this.voice && this.snapshot.playing ? this.voicePosition(this.voice) : this.offset; }

  private scheduleTransition() {
    if (!this.prepared || !this.voice || !this.snapshot.playing || this.loop || this.transition) return;
    const next = this.prepared; const now = this.context!.currentTime;
    const remaining = this.remainingTime(this.voice);
    const duration = crossfadeDuration(next.seconds, resolveEdit(this.edit, this.buffer!.duration, this.settings.speed).length, resolveEdit(next.edit, next.buffer.duration, this.settings.speed).length, remaining);
    if (duration < 0.05) return;
    const start = now + remaining - duration;
    const range = resolveEdit(next.edit, next.buffer.duration, this.settings.speed);
    const incoming = this.createVoice(next.id, next.buffer, next.edit, range.start, start);
    this.transition = { from: this.voice, to: incoming, start, end: now + remaining, angle: 0, promoted: false };
    this.scheduleGains(this.transition); this.armTransitionTimer();
  }

  private scheduleGains(transition: Transition) {
    const curves = crossfadeCurves(transition.angle);
    const now = this.context!.currentTime;
    for (const [parameter, curve] of [[transition.from.blend.gain, curves.outgoing], [transition.to.blend.gain, curves.incoming]] as const) {
      parameter.cancelScheduledValues(0);
      parameter.setValueAtTime(curve[0], now);
      parameter.setValueCurveAtTime(curve, transition.start, Math.max(0.005, transition.end - transition.start));
    }
  }

  private armTransitionTimer() {
    clearTimeout(this.transitionTimer);
    const transition = this.transition; if (!transition || transition.promoted) return;

    this.transitionTimer = setTimeout(() => { this.promoteTransition(); this.armTransitionTimer(); }, Math.max(20, (transition.start - this.context!.currentTime) * 1000));
  }

  private promoteTransition() {
    const transition = this.transition;
    if (!transition || transition.promoted || this.context!.currentTime < transition.start) return;
    transition.promoted = true; this.voice = transition.to;
    this.buffer = transition.to.buffer; this.edit = { ...transition.to.edit }; this.offset = this.voicePosition(transition.to);
    this.cancelPreparation(); clearTimeout(this.transitionTimer);
    this.publish({ trackId: transition.to.id, duration: this.buffer.duration, position: this.offset, crossfading: true });
  }

  private voiceEnded(voice: Voice) {
    const transition = this.transition;
    if (transition?.from === voice) {
      this.promoteTransition(); this.disconnectVoice(voice); this.transition = null;
      this.publish({ crossfading: false }); return;
    }
    if (this.voice !== voice) { this.disconnectVoice(voice); return; }
    this.offset = resolveEdit(voice.edit, voice.buffer.duration).end;
    this.disconnectVoice(voice); this.voice = null;
    this.publish({ playing: false, position: this.offset, peak: 0, ended: this.snapshot.ended + 1 });
    cancelAnimationFrame(this.animation);
  }

  pause() {
    this.offset = this.position(); this.stopSources();
    this.publish({ playing: false, crossfading: false, position: this.offset, peak: 0 });
    void this.context?.suspend().catch(() => {});
  }

  async seek(position: number) {
    const playing = this.isPlaying(); this.promoteTransition(); this.stopSources();
    const range = resolveEdit(this.edit, this.buffer?.duration ?? 0);
    this.offset = Math.max(range.start, Math.min(range.end, position));
    this.publish({ position: this.offset, playing: false, crossfading: false });
    if (playing) await this.play();
  }

  setMix(settings: MixSettings) {
    this.promoteTransition();
    const transition = this.transition;
    const now = this.context?.currentTime ?? 0;
    const speedChanged = settings.speed !== this.settings.speed;
    let angle = 0;
    if (speedChanged && transition?.promoted) angle = transition.angle + (Math.PI / 2 - transition.angle) * Math.min(1, Math.max(0, (now - transition.start) / (transition.end - transition.start)));
    if (speedChanged && transition && !transition.promoted) this.cancelTransition();
    for (const voice of new Set([this.voice, this.transition?.from])) {
      if (!voice || !speedChanged) continue;
      const position = this.voicePosition(voice, now);
      voice.rateStart = this.instantRate(voice, now); voice.rateTarget = settings.speed;
      voice.offset = position; voice.rateTime = now;
      voice.source.playbackRate.cancelScheduledValues(now);
      voice.source.playbackRate.setValueAtTime(voice.rateStart, now);
      voice.source.playbackRate.setTargetAtTime(settings.speed, now, 0.025);
    }
    this.settings = { ...settings }; this.graph?.update(settings);
    if (speedChanged) for (const voice of new Set([this.voice, this.transition?.from])) if (voice) this.scheduleEnvelope(voice);
    if (speedChanged && this.transition?.promoted) {
      this.transition.angle = angle; this.transition.start = now; this.transition.end = now + this.remainingTime(this.transition.from);
      this.scheduleGains(this.transition);
    }
    this.scheduleTransition();
  }

  async setEdit(edit: AudioEdit, loop = false) {
    if (JSON.stringify(edit) === JSON.stringify(this.edit) && loop === this.loop) return;
    const position = this.position(); const playing = this.isPlaying();
    this.edit = { ...edit }; this.loop = loop;
    if (!this.buffer) return;
    this.stopSources();
    const range = resolveEdit(edit, this.buffer.duration);
    this.offset = Math.max(range.start, Math.min(range.end, position));
    this.publish({ position: this.offset, playing: false, crossfading: false });
    if (playing) await this.play();
  }

  private fadeLevel(voice: Voice, position: number) {
    const range = resolveEdit(voice.edit, voice.buffer.duration, this.settings.speed);
    const elapsed = (position - range.start) / this.settings.speed;
    const remaining = (range.end - position) / this.settings.speed;
    return Math.max(0, Math.min(1, range.fadeIn ? elapsed / range.fadeIn : 1, range.fadeOut ? remaining / range.fadeOut : 1));
  }

  private scheduleEnvelope(voice: Voice) {
    if (voice.loop) return;
    const now = this.context!.currentTime; const start = Math.max(now, voice.rateTime);
    const position = this.voicePosition(voice, start);
    const range = resolveEdit(voice.edit, voice.buffer.duration, this.settings.speed);
    const remaining = voice.rateTime > now ? (range.end - position) / this.settings.speed : this.remainingTime(voice);
    const elapsed = (position - range.start) / this.settings.speed;
    const gain = voice.envelope.gain;
    gain.cancelScheduledValues(0); gain.setValueAtTime(this.fadeLevel(voice, position), start);
    if (range.fadeIn > elapsed) gain.linearRampToValueAtTime(1, start + range.fadeIn - elapsed);
    if (range.fadeOut) {
      if (remaining > range.fadeOut) gain.setValueAtTime(1, start + remaining - range.fadeOut);
      gain.linearRampToValueAtTime(0, start + remaining);
    }
  }

  setVolume(volume: number) {
    this.volume = volume;
    this.volumeNode?.gain.setTargetAtTime(volume, this.context!.currentTime, 0.025);
  }

  private cancelPreparation() { this.preparation?.controller.abort(); this.preparation = null; this.prepared = null; }

  private disconnectVoice(voice: Voice, stop = false) {
    voice.source.onended = null;
    if (stop) { try { voice.source.stop(); } catch { /* Source already ended. */ } }
    voice.source.disconnect(); voice.envelope.disconnect(); voice.blend.disconnect();
  }

  private cancelTransition() {
    clearTimeout(this.transitionTimer);
    const transition = this.transition; this.transition = null;
    if (!transition) return;
    this.disconnectVoice(transition.promoted ? transition.from : transition.to, true);
    if (this.voice) { this.voice.blend.gain.cancelScheduledValues(0); this.voice.blend.gain.setValueAtTime(1, this.context!.currentTime); }
  }

  private stopSources() {
    ++this.playToken; this.playPending = false; cancelAnimationFrame(this.animation); this.cancelTransition();
    if (this.voice) this.disconnectVoice(this.voice, true);
    this.voice = null;
  }

  clear() {
    ++this.loadToken; this.loadController?.abort(); this.loadController = null;
    this.cancelPreparation(); this.stopSources(); this.buffer = null; this.offset = 0;
    void this.context?.suspend().catch(() => {});
    this.publish({ playing: false, loading: false, trackId: null, crossfading: false, position: 0, duration: 0, peak: 0, preloadLimited: false });
  }

  private tick = () => {
    this.promoteTransition();
    const now = performance.now();
    if (now - this.lastUpdate > 65) {
      this.lastUpdate = now;
      let peak = 0; this.analyser?.getFloatTimeDomainData(this.meter);
      for (const sample of this.meter) peak = Math.max(peak, Math.abs(sample));
      this.publish({ position: this.position(), peak });
      for (const voice of new Set([this.voice, this.transition?.from])) {
        if (voice?.loop) voice.envelope.gain.setTargetAtTime(this.fadeLevel(voice, this.voicePosition(voice)), this.context!.currentTime, 0.015);
      }
    }
    if (this.snapshot.playing) this.animation = requestAnimationFrame(this.tick);
  };

  dispose() {
    this.clear(); this.graph?.dispose(); void this.context?.close().catch(() => {});
    this.context = null; this.graph = null; this.analyser = null; this.volumeNode = null;
    this.listeners.clear();
  }
}
