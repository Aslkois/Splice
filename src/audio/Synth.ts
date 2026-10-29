/**
 * Procedural sound design. Everything is synthesised with WebAudio — no asset files — and routed
 * through master / sfx / ui buses so the settings sliders control real gain nodes.
 */
export interface Volumes {
  master: number;
  sfx: number;
  ui: number;
}

type Bus = 'sfx' | 'ui';

export class Synth {
  private ctx: AudioContext | null = null;
  private master!: GainNode;
  private buses!: Record<Bus, GainNode>;
  private noiseBuf!: AudioBuffer;
  private comp!: DynamicsCompressorNode;
  private vols: Volumes = { master: 0.8, sfx: 0.9, ui: 0.6 };
  private loops = new Map<number, { osc: OscillatorNode; gain: GainNode }>();
  private lastPlayed = new Map<string, number>();

  /** Must be called from a user gesture at least once (browser autoplay rules). */
  ensure(): void {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') void this.ctx.resume();
      return;
    }
    const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!AC) return;
    const ctx = new AC();
    this.ctx = ctx;
    this.comp = ctx.createDynamicsCompressor();
    this.comp.threshold.value = -14;
    this.comp.ratio.value = 4;
    this.master = ctx.createGain();
    this.comp.connect(this.master);
    this.master.connect(ctx.destination);
    this.buses = { sfx: ctx.createGain(), ui: ctx.createGain() };
    this.buses.sfx.connect(this.comp);
    this.buses.ui.connect(this.comp);
    const len = ctx.sampleRate * 1.5;
    this.noiseBuf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = this.noiseBuf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    this.setVolumes(this.vols);
  }

  setVolumes(v: Volumes): void {
    this.vols = { ...v };
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.master.gain.setTargetAtTime(v.master, t, 0.02);
    this.buses.sfx.gain.setTargetAtTime(v.sfx, t, 0.02);
    this.buses.ui.gain.setTargetAtTime(v.ui, t, 0.02);
  }

  get ready(): boolean {
    return !!this.ctx && this.ctx.state === 'running';
  }

  /** Rate-limits a named sound so a flurry of events doesn't turn into noise. */
  private gate(name: string, minGap: number): boolean {
    if (!this.ctx) return false;
    const now = this.ctx.currentTime;
    const last = this.lastPlayed.get(name) ?? -1;
    if (now - last < minGap) return false;
    this.lastPlayed.set(name, now);
    return true;
  }

  private tone(f0: number, f1: number, dur: number, type: OscillatorType, gain: number, bus: Bus = 'sfx', delay = 0, attack = 0.004): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const t = ctx.currentTime + delay;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(Math.max(20, f0), t);
    o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, gain), t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(this.buses[bus]);
    o.start(t);
    o.stop(t + dur + 0.05);
  }

  private noise(dur: number, type: BiquadFilterType, f0: number, f1: number, q: number, gain: number, bus: Bus = 'sfx', delay = 0): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const t = ctx.currentTime + delay;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.Q.value = q;
    f.frequency.setValueAtTime(Math.max(20, f0), t);
    f.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(Math.max(0.0002, gain), t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f).connect(g).connect(this.buses[bus]);
    src.start(t, Math.random() * 0.5);
    src.stop(t + dur + 0.05);
  }

  /** Inharmonic partials with exponential decay: the metallic ring. */
  private bell(f0: number, decay: number, gain: number, ratios = [1, 2.76, 5.4, 8.93, 13.34], delay = 0): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const t = ctx.currentTime + delay;
    ratios.forEach((r, i) => {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.type = 'sine';
      o.frequency.value = f0 * r;
      const amp = gain / (i + 1);
      const d = decay / (1 + i * 0.45);
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(amp, t + 0.002);
      g.gain.exponentialRampToValueAtTime(0.0001, t + d);
      o.connect(g).connect(this.buses.sfx);
      o.start(t);
      o.stop(t + d + 0.05);
    });
  }

  // ---------------------------------------------------------------- game sounds

  jump(): void {
    if (!this.gate('jump', 0.05)) return;
    this.tone(330, 560, 0.09, 'square', 0.05);
  }

  land(speed: number): void {
    if (!this.gate('land', 0.06)) return;
    const k = Math.min(1, speed / 1200);
    this.noise(0.09 + k * 0.08, 'lowpass', 500 + k * 400, 120, 0.7, 0.12 + k * 0.25);
    this.tone(120, 50, 0.1, 'sine', 0.1 + k * 0.2);
  }

  dash(): void {
    this.noise(0.17, 'bandpass', 900, 3200, 1.2, 0.2);
  }

  thrust(amount: number): void {
    if (!this.gate('thrust', 0.06)) return;
    this.noise(0.08, 'bandpass', 500, 900, 0.9, Math.min(0.18, 0.04 + amount * 0.01));
  }

  shot(mass: number, team: string): void {
    if (!this.gate('shot' + team, 0.03)) return;
    if (mass >= 3) {
      this.tone(110, 38, 0.5, 'sine', 0.5);
      this.noise(0.35, 'lowpass', 1200, 80, 0.8, 0.45);
      return;
    }
    if (team === 'enemy') this.tone(980, 240, 0.12, 'sawtooth', 0.07);
    else this.tone(1400, 520, 0.1, 'triangle', 0.09);
  }

  impact(energy: number, material: string): void {
    if (!this.gate('impact' + material, 0.035)) return;
    const k = Math.min(1, Math.sqrt(energy) / 20);
    switch (material) {
      case 'wood':
        this.noise(0.12 + k * 0.1, 'bandpass', 520, 260, 1.4, 0.25 + k * 0.3);
        this.tone(180, 90, 0.08, 'triangle', 0.12);
        break;
      case 'glass':
        this.bell(1900, 0.35, 0.05 + k * 0.08, [1, 1.5, 2.3, 3.7]);
        this.noise(0.1, 'highpass', 4000, 6000, 0.7, 0.12);
        break;
      case 'metal':
        this.bell(780 - k * 300, 0.18 + k * 0.25, 0.05 + k * 0.1);
        this.noise(0.05, 'highpass', 2500, 2500, 0.7, 0.1 + k * 0.1);
        break;
      case 'flesh':
        this.noise(0.12, 'lowpass', 700, 200, 0.8, 0.25 + k * 0.2);
        break;
      default:
        this.noise(0.1 + k * 0.1, 'lowpass', 900, 200, 0.9, 0.2 + k * 0.3);
    }
  }

  guard(energy: number): void {
    const k = Math.min(1, Math.sqrt(energy) / 20);
    this.tone(240 - k * 80, 120, 0.14, 'triangle', 0.25);
    this.noise(0.08, 'bandpass', 1400, 600, 1.5, 0.2 + k * 0.2);
    this.bell(420, 0.15, 0.04);
  }

  /** The signature sound: a bright, ringing, heavy clang that grows with the energy turned around. */
  parry(energy: number, amplify: number): void {
    const k = Math.min(1, Math.sqrt(energy) / 22);
    const f0 = 760 - k * 360;
    this.noise(0.03, 'highpass', 5000, 5000, 0.7, 0.5);
    this.bell(f0, 0.7 + k * 1.1, 0.16 + k * 0.08);
    this.bell(f0 * 1.503, 0.5 + k * 0.6, 0.06);
    this.noise(0.16, 'bandpass', 4200, 9000, 4, 0.18);
    this.tone(130 - k * 50, 46, 0.22 + k * 0.2, 'sine', 0.35 + k * 0.25);
    if (amplify > 1) this.tone(f0 * 2, f0 * 4, 0.25, 'sawtooth', 0.05, 'sfx', 0.03);
  }

  absorb(energy: number): void {
    const k = Math.min(1, energy / 60);
    this.tone(260, 900 + k * 500, 0.25 + k * 0.2, 'sine', 0.16);
    this.tone(390, 1350, 0.25, 'triangle', 0.05, 'sfx', 0.03);
  }

  negate(): void {
    this.tone(190, 55, 0.28, 'sine', 0.3);
    this.noise(0.22, 'lowpass', 600, 90, 0.7, 0.16);
  }

  guardBreak(): void {
    this.bell(300, 0.3, 0.1, [1, 1.9, 3.1]);
    this.noise(0.25, 'bandpass', 1800, 300, 1, 0.3);
  }

  hurt(amount: number): void {
    if (!this.gate('hurt', 0.06)) return;
    const k = Math.min(1, amount / 50);
    this.tone(260, 90, 0.14 + k * 0.1, 'square', 0.08 + k * 0.08);
    this.noise(0.1, 'lowpass', 1200, 300, 0.9, 0.15 + k * 0.15);
  }

  death(): void {
    this.tone(420, 45, 0.7, 'sawtooth', 0.12);
    this.noise(0.6, 'lowpass', 2000, 80, 0.7, 0.3);
  }

  spawn(): void {
    this.tone(300, 900, 0.18, 'triangle', 0.08);
    this.tone(450, 1350, 0.18, 'sine', 0.05, 'sfx', 0.05);
  }

  pickup(): void {
    this.tone(880, 880, 0.09, 'triangle', 0.12);
    this.tone(1320, 1320, 0.16, 'triangle', 0.12, 'sfx', 0.07);
  }

  spend(energy: number): void {
    if (!this.gate('spend', 0.05) || energy < 0.5) return;
    const k = Math.min(1, Math.log10(1 + energy) / 2);
    this.tone(1500 - k * 700, 500 - k * 200, 0.07 + k * 0.08, 'sawtooth', 0.025 + k * 0.035);
  }

  fizzle(): void {
    if (!this.gate('fizzle', 0.12)) return;
    this.tone(320, 110, 0.18, 'sawtooth', 0.06);
    this.noise(0.12, 'bandpass', 900, 300, 2, 0.08);
  }

  interrupt(): void {
    this.tone(700, 160, 0.2, 'square', 0.06);
    this.noise(0.18, 'highpass', 3000, 1200, 0.8, 0.12);
  }

  chargeTick(amount: number): void {
    if (!this.gate('charge', 0.09)) return;
    const f = 300 + Math.min(1200, Math.sqrt(amount) * 60);
    this.tone(f, f * 1.05, 0.06, 'sine', 0.03);
  }

  telegraph(id: number, duration: number): void {
    if (!this.ctx) return;
    if (duration < 1) {
      this.tone(1200, 1200, 0.05, 'square', 0.035);
      this.tone(1200, 1200, 0.05, 'square', 0.035, 'sfx', 0.12);
      return;
    }
    this.stopTelegraph(id);
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = 'sawtooth';
    o.frequency.setValueAtTime(90, t);
    o.frequency.exponentialRampToValueAtTime(620, t + duration);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.05, t + duration * 0.8);
    g.gain.exponentialRampToValueAtTime(0.0001, t + duration + 0.05);
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.setValueAtTime(300, t);
    f.frequency.exponentialRampToValueAtTime(2400, t + duration);
    o.connect(f).connect(g).connect(this.buses.sfx);
    o.start(t);
    o.stop(t + duration + 0.1);
    this.loops.set(id, { osc: o, gain: g });
    o.onended = () => this.loops.delete(id);
  }

  stopTelegraph(id: number): void {
    const l = this.loops.get(id);
    if (!l || !this.ctx) return;
    const t = this.ctx.currentTime;
    l.gain.gain.cancelScheduledValues(t);
    l.gain.gain.setTargetAtTime(0.0001, t, 0.02);
    try {
      l.osc.stop(t + 0.1);
    } catch {
      /* already stopped */
    }
    this.loops.delete(id);
  }

  stopAllLoops(): void {
    for (const id of [...this.loops.keys()]) this.stopTelegraph(id);
  }

  breakage(size: number): void {
    const k = Math.min(1, size / 90);
    this.noise(0.3 + k * 0.3, 'lowpass', 2400, 140, 0.8, 0.4);
    this.tone(150, 40, 0.3 + k * 0.2, 'sine', 0.3 + k * 0.2);
  }

  gateOpen(): void {
    this.noise(1.1, 'lowpass', 300, 900, 0.7, 0.35);
    this.tone(70, 110, 1.0, 'sawtooth', 0.08);
  }

  objective(): void {
    [523, 659, 784, 1047].forEach((f, i) => this.tone(f, f, 0.22, 'triangle', 0.1, 'sfx', i * 0.09));
  }

  cosmetic(sound: string, pitch: number): void {
    switch (sound) {
      case 'blip':
        this.tone(660 * pitch, 990 * pitch, 0.08, 'square', 0.06);
        break;
      case 'clang':
        this.bell(520 * pitch, 0.6, 0.12);
        break;
      case 'boom':
        this.tone(120 * pitch, 40, 0.5, 'sine', 0.4);
        this.noise(0.4, 'lowpass', 900, 80, 0.8, 0.3);
        break;
      default:
        this.tone(880 * pitch, 880 * pitch, 0.12, 'triangle', 0.1);
        this.tone(1320 * pitch, 1320 * pitch, 0.18, 'triangle', 0.08, 'sfx', 0.06);
    }
  }

  // ---------------------------------------------------------------- workshop / ui

  uiClick(): void {
    this.tone(1800, 1400, 0.03, 'square', 0.03, 'ui');
  }

  /** A jack being plugged in. */
  uiPlug(): void {
    this.noise(0.03, 'highpass', 3000, 3000, 0.7, 0.18, 'ui');
    this.tone(240, 160, 0.06, 'triangle', 0.1, 'ui');
  }

  uiUnplug(): void {
    this.tone(160, 260, 0.06, 'triangle', 0.08, 'ui');
  }

  uiDrop(): void {
    this.noise(0.05, 'lowpass', 900, 300, 0.8, 0.2, 'ui');
    this.tone(200, 120, 0.06, 'sine', 0.12, 'ui');
  }

  uiError(): void {
    this.tone(200, 150, 0.12, 'square', 0.05, 'ui');
    this.tone(150, 110, 0.12, 'square', 0.05, 'ui', 0.1);
  }

  uiOpen(): void {
    this.noise(0.12, 'bandpass', 600, 1800, 1, 0.12, 'ui');
  }
}

export const synth = new Synth();
