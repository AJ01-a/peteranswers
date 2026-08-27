/**
 * AudioManager.js — procedural ambience and interface cues.
 *
 * Everything is synthesised with the Web Audio API: no files, no network,
 * no autoplay. The context is not even created until the first real user
 * gesture, which keeps every browser's autoplay policy happy.
 */

const MODE_TONE = {
  general: 52, love: 46, future: 58, mind: 62,
  spirit: 44, yesno: 55, secrets: 41, tarot: 49, dark: 38,
};

export class AudioManager {
  constructor() {
    this.ctx = null;
    this.enabled = false;
    this.ready = false;
    this.supported = typeof window !== 'undefined' &&
      Boolean(window.AudioContext || window.webkitAudioContext);
    this.nodes = {};
    this.mode = 'general';
    this.volume = 0.5;
  }

  /** Must be called from inside a user gesture the first time. */
  _ensure() {
    if (this.ctx || !this.supported) return this.ctx;
    try {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      this.ctx = new Ctx();
      this._build();
      this.ready = true;
    } catch (err) {
      console.warn('[audio] unavailable:', err);
      this.supported = false;
    }
    return this.ctx;
  }

  _build() {
    const ctx = this.ctx;

    const master = ctx.createGain();
    master.gain.value = 0;
    master.connect(ctx.destination);

    // --- drone: two detuned oscillators through a soft lowpass ------------
    const droneGain = ctx.createGain();
    droneGain.gain.value = 0.22;

    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 340;
    lp.Q.value = 0.6;

    const base = MODE_TONE[this.mode] ?? 52;
    const oscA = ctx.createOscillator();
    oscA.type = 'sine';
    oscA.frequency.value = base;
    const oscB = ctx.createOscillator();
    oscB.type = 'triangle';
    oscB.frequency.value = base * 1.503;
    const oscC = ctx.createOscillator();
    oscC.type = 'sine';
    oscC.frequency.value = base * 0.5;

    const gA = ctx.createGain(); gA.gain.value = 0.5;
    const gB = ctx.createGain(); gB.gain.value = 0.12;
    const gC = ctx.createGain(); gC.gain.value = 0.32;

    oscA.connect(gA).connect(lp);
    oscB.connect(gB).connect(lp);
    oscC.connect(gC).connect(lp);
    lp.connect(droneGain).connect(master);

    // slow breathing LFO on the drone
    const lfo = ctx.createOscillator();
    lfo.type = 'sine';
    lfo.frequency.value = 0.055;
    const lfoGain = ctx.createGain();
    lfoGain.gain.value = 0.09;
    lfo.connect(lfoGain).connect(droneGain.gain);

    // --- static: looped noise, heavily filtered --------------------------
    const seconds = 2;
    const buffer = ctx.createBuffer(1, ctx.sampleRate * seconds, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    let b0 = 0, b1 = 0, b2 = 0;
    for (let i = 0; i < data.length; i++) {
      const white = Math.random() * 2 - 1;
      b0 = 0.99765 * b0 + white * 0.0990460;
      b1 = 0.96300 * b1 + white * 0.2965164;
      b2 = 0.57000 * b2 + white * 1.0526913;
      data[i] = (b0 + b1 + b2 + white * 0.1848) * 0.06;
    }
    const noise = ctx.createBufferSource();
    noise.buffer = buffer;
    noise.loop = true;

    const noiseBand = ctx.createBiquadFilter();
    noiseBand.type = 'bandpass';
    noiseBand.frequency.value = 900;
    noiseBand.Q.value = 0.35;
    const noiseGain = ctx.createGain();
    noiseGain.gain.value = 0.055;

    noise.connect(noiseBand).connect(noiseGain).connect(master);

    [oscA, oscB, oscC, lfo, noise].forEach((n) => { try { n.start(); } catch { /* already started */ } });

    this.nodes = { master, droneGain, lp, oscA, oscB, oscC, noiseGain, noiseBand };
  }

  _ramp(param, value, time = 0.6) {
    const now = this.ctx.currentTime;
    try {
      param.cancelScheduledValues(now);
      param.setValueAtTime(param.value, now);
      param.linearRampToValueAtTime(value, now + time);
    } catch {
      param.value = value;
    }
  }

  async resume() {
    if (!this._ensure()) return false;
    if (this.ctx.state === 'suspended') {
      try { await this.ctx.resume(); } catch { /* ignore */ }
    }
    return this.ctx.state === 'running';
  }

  async setEnabled(flag) {
    this.enabled = Boolean(flag);
    if (!this.supported) return false;
    if (this.enabled) {
      const ok = await this.resume();
      if (!ok) return false;
      this._ramp(this.nodes.master.gain, 0.16 * this.volume * 2, 1.6);
      return true;
    }
    if (this.ctx && this.nodes.master) this._ramp(this.nodes.master.gain, 0, 0.7);
    return true;
  }

  setMode(mode) {
    this.mode = mode;
    if (!this.ctx || !this.nodes.oscA) return;
    const base = MODE_TONE[mode] ?? 52;
    this._ramp(this.nodes.oscA.frequency, base, 1.4);
    this._ramp(this.nodes.oscB.frequency, base * 1.503, 1.4);
    this._ramp(this.nodes.oscC.frequency, base * 0.5, 1.4);
  }

  /** Raise the tension while Peter is thinking. */
  setTension(amount) {
    if (!this.ctx || !this.nodes.lp) return;
    const a = Math.max(0, Math.min(1, amount));
    this._ramp(this.nodes.lp.frequency, 320 + a * 900, 1.2);
    this._ramp(this.nodes.noiseGain.gain, 0.05 + a * 0.10, 1.2);
    this._ramp(this.nodes.droneGain.gain, 0.22 + a * 0.16, 1.2);
  }

  /** One-shot interface cues. Silent unless ambient audio is on. */
  cue(name) {
    if (!this.enabled || !this.ctx || this.ctx.state !== 'running') return;
    const ctx = this.ctx;
    const now = ctx.currentTime;

    const shot = ({ type = 'sine', freq = 440, to = null, dur = 0.3, peak = 0.05, filter = null }) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = type;
      osc.frequency.setValueAtTime(freq, now);
      if (to) osc.frequency.exponentialRampToValueAtTime(Math.max(20, to), now + dur);
      gain.gain.setValueAtTime(0.0001, now);
      gain.gain.exponentialRampToValueAtTime(peak * this.volume * 2, now + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + dur);
      let tail = osc;
      if (filter) {
        const f = ctx.createBiquadFilter();
        f.type = filter.type || 'lowpass';
        f.frequency.value = filter.freq || 1200;
        tail = osc.connect(f);
      }
      tail.connect(gain).connect(this.nodes.master);
      osc.start(now);
      osc.stop(now + dur + 0.05);
    };

    switch (name) {
      case 'submit': shot({ type: 'sine', freq: 220, to: 440, dur: 0.35, peak: 0.06 }); break;
      case 'step':   shot({ type: 'sine', freq: 880, dur: 0.10, peak: 0.022 }); break;
      case 'reveal':
        shot({ type: 'sine', freq: 392, to: 588, dur: 1.1, peak: 0.07 });
        shot({ type: 'triangle', freq: 196, dur: 1.6, peak: 0.045 });
        break;
      case 'type':   shot({ type: 'square', freq: 1600 + Math.random() * 500, dur: 0.02, peak: 0.006, filter: { type: 'lowpass', freq: 2600 } }); break;
      case 'refuse': shot({ type: 'sawtooth', freq: 180, to: 70, dur: 0.7, peak: 0.05, filter: { type: 'lowpass', freq: 700 } }); break;
      case 'glitch': shot({ type: 'square', freq: 90 + Math.random() * 600, to: 60, dur: 0.16, peak: 0.04, filter: { type: 'bandpass', freq: 1400 } }); break;
      case 'open':   shot({ type: 'sine', freq: 660, to: 880, dur: 0.16, peak: 0.03 }); break;
      case 'close':  shot({ type: 'sine', freq: 660, to: 330, dur: 0.16, peak: 0.03 }); break;
      default: break;
    }
  }
}
