// Procedural audio: ambience beds, birds/insects, footsteps, and 3D positional emitters (bells, trains, engines).
import { toastMsg } from './ui.js';

export const audio = {
  ctx: null, master: null, muted: false, vol: 0.8, emitters: new Set(), lp: { x: 0, y: 0, z: 0 },
  init() {
    if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
    const ctx = this.ctx = new (window.AudioContext || window.webkitAudioContext)();
    this.master = ctx.createGain(); this.master.gain.value = this.muted ? 0 : this.vol; this.master.connect(ctx.destination);
    const len = ctx.sampleRate * 4;
    const white = ctx.createBuffer(1, len, ctx.sampleRate), wd = white.getChannelData(0);
    for (let i = 0; i < len; i++) wd[i] = Math.random() * 2 - 1;
    const brown = ctx.createBuffer(1, len, ctx.sampleRate), bd = brown.getChannelData(0); let last = 0;
    for (let i = 0; i < len; i++) { last = (last + 0.02 * (Math.random() * 2 - 1)) / 1.02; bd[i] = last * 3.5; }
    this.white = white; this.brown = brown;
    const bed = (buf, type, f, q) => {
      const s = ctx.createBufferSource(); s.buffer = buf; s.loop = true; s.start(0, Math.random() * 3);
      const fl = ctx.createBiquadFilter(); fl.type = type; fl.frequency.value = f; if (q) fl.Q.value = q;
      const g = ctx.createGain(); g.gain.value = 0; s.connect(fl).connect(g).connect(this.master); return { f: fl, g };
    };
    this.wind = bed(brown, 'lowpass', 500);
    this.rustle = bed(white, 'bandpass', 3200, 0.6);
    this.water = bed(brown, 'bandpass', 700, 0.7);
    this.traffic = bed(brown, 'lowpass', 180);
    this.nextBird = 1; this.nextCricket = 0; this.nextCicada = 2;
    for (const e of this.emitters) e._build();
  },
  setVolume(v) { this.vol = v; if (this.master) this.master.gain.value = this.muted ? 0 : v; },
  toggleMute() { this.muted = !this.muted; this.setVolume(this.vol); toastMsg(this.muted ? 'Audio muted' : 'Audio on'); },
  listen(cam) {
    if (!this.ctx) return;
    const L = this.ctx.listener, p = cam.position, t = this.ctx.currentTime;
    this.lp.x = p.x; this.lp.y = p.y; this.lp.z = p.z;
    const f = { x: -Math.sin(cam.rotation.y), z: -Math.cos(cam.rotation.y) };
    if (L.positionX) {
      L.positionX.setTargetAtTime(p.x, t, 0.02); L.positionY.setTargetAtTime(p.y, t, 0.02); L.positionZ.setTargetAtTime(p.z, t, 0.02);
      L.forwardX.setTargetAtTime(f.x, t, 0.02); L.forwardY.setTargetAtTime(0, t, 0.02); L.forwardZ.setTargetAtTime(f.z, t, 0.02);
      L.upX.value = 0; L.upY.value = 1; L.upZ.value = 0;
    } else { L.setPosition(p.x, p.y, p.z); L.setOrientation(f.x, 0, f.z, 0, 1, 0); }
  },
  // st: {wind, forest, water, day, night, fly, under, town, insects}
  update(dt, st) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime, k = 0.4, u = st.under ? 0.15 : 1;
    this.wind.g.gain.setTargetAtTime((0.05 + st.wind * 0.2) * (st.fly ? 1.8 : 1) * u * (1 - 0.5 * (st.town || 0)), t, k);
    this.wind.f.frequency.setTargetAtTime(250 + st.wind * 700 + (st.fly ? 600 : 0), t, k);
    this.rustle.g.gain.setTargetAtTime((st.forest || 0) * st.wind * 0.05 * (st.under ? 0 : 1), t, k);
    this.water.g.gain.setTargetAtTime((st.water || 0) * (0.25 + 0.15 * Math.sin(t * 0.9) * Math.sin(t * 0.37)) * u, t, 0.08);
    this.water.f.frequency.setTargetAtTime(st.under ? 250 : 600 + 200 * Math.sin(t * 0.5), t, 0.08);
    this.traffic.g.gain.setTargetAtTime((st.town || 0) * (0.05 + 0.04 * st.day) * u, t, k);
    this.nextBird -= dt;
    if (this.nextBird < 0) { this.nextBird = 0.8 + Math.random() * 5 / (0.3 + (st.forest || 0) + (st.town || 0) * 0.3); if (st.day > 0.5 && !st.under) this.bird((st.forest || 0) + 0.3); }
    this.nextCricket -= dt;
    if (this.nextCricket < 0) { this.nextCricket = 0.5 + Math.random() * 1.2; if (st.night > 0.5 && !st.under && Math.random() < 1 - 0.75 * (st.town || 0)) this.cricket(); }
    this.nextCicada -= dt;
    if (this.nextCicada < 0) { this.nextCicada = 6 + Math.random() * 14; if (st.insects && st.day > 0.7 && !st.under) this.cicada(st.insects); }
  },
  voice(pan) {
    const ctx = this.ctx, p = ctx.createStereoPanner(); p.pan.value = pan ?? Math.random() * 2 - 1;
    const g = ctx.createGain(); g.gain.value = 0; g.connect(p).connect(this.master); return g;
  },
  bird(forest) {
    const ctx = this.ctx, t0 = ctx.currentTime + 0.02, g = this.voice(), vol = (0.02 + Math.random() * 0.05) * Math.min(1.3, 0.5 + forest);
    const kind = Math.floor(Math.random() * 3), notes = 2 + Math.floor(Math.random() * 6), base = 2200 + Math.random() * 2600;
    const o = ctx.createOscillator(); o.type = 'sine'; o.connect(g);
    let t = t0;
    for (let i = 0; i < notes; i++) {
      const dur = kind === 0 ? 0.06 + Math.random() * 0.05 : kind === 1 ? 0.14 : 0.03;
      const f0 = base * (kind === 1 ? 1.25 : 1 + Math.random() * 0.25), f1 = kind === 1 ? base * 0.8 : base * (1.3 + Math.random() * 0.4);
      o.frequency.setValueAtTime(f0, t); o.frequency.exponentialRampToValueAtTime(f1, t + dur);
      g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(vol, t + 0.01); g.gain.linearRampToValueAtTime(0, t + dur);
      t += dur + (kind === 2 ? 0.04 : 0.05 + Math.random() * 0.08);
    }
    o.start(t0); o.stop(t + 0.1);
  },
  cricket() { // a short trill (ringing-cricket style): a band-limited tone pulsed ~30 times a second, soft edges
    const ctx = this.ctx, t0 = ctx.currentTime + 0.01, g = this.voice();
    const o = ctx.createOscillator(); o.type = 'triangle'; o.frequency.value = 3300 + Math.random() * 500;
    const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = o.frequency.value; bp.Q.value = 4;
    o.connect(bp).connect(g);
    const vol = 0.004 + Math.random() * 0.007, n = 3 + Math.floor(Math.random() * 4);
    for (let i = 0; i < n; i++) { const t = t0 + i * 0.034; g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(vol, t + 0.01); g.gain.linearRampToValueAtTime(0, t + 0.026); }
    o.start(t0); o.stop(t0 + n * 0.034 + 0.05);
  },
  // Japanese summer cicada (minmin-zemi style): pulsed buzzy tone with a slow swell and fade
  cicada(level) {
    const ctx = this.ctx, t0 = ctx.currentTime + 0.05, dur = 4 + Math.random() * 5, g = this.voice(Math.random() * 1.6 - 0.8);
    const o = ctx.createOscillator(); o.type = 'triangle'; o.frequency.value = 3600 + Math.random() * 700;
    const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = o.frequency.value; bp.Q.value = 2;
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 6000;
    const am = ctx.createGain(); am.gain.value = 0.5;                                  // 0.5 ± 0.5: a real 0..1 swell
    const lfo = ctx.createOscillator(); lfo.type = 'sine'; lfo.frequency.value = 2.2 + Math.random() * 1.2;
    const lg = ctx.createGain(); lg.gain.value = 0.5; lfo.connect(lg).connect(am.gain);
    const buzz = ctx.createGain(); buzz.gain.value = 0.7;                              // wing-buzz texture
    const bz = ctx.createOscillator(); bz.frequency.value = 90 + Math.random() * 40; const bzg = ctx.createGain(); bzg.gain.value = 0.3; bz.connect(bzg).connect(buzz.gain);
    o.connect(bp).connect(lp).connect(buzz).connect(am).connect(g);
    const v = 0.016 * level;
    g.gain.setValueAtTime(0, t0); g.gain.linearRampToValueAtTime(v, t0 + 1.2); g.gain.setValueAtTime(v, t0 + dur - 1.5); g.gain.linearRampToValueAtTime(0, t0 + dur);
    o.start(t0); lfo.start(t0); bz.start(t0); o.stop(t0 + dur + 0.1); lfo.stop(t0 + dur + 0.1); bz.stop(t0 + dur + 0.1);
  },
  step(surface, intensity) {
    if (!this.ctx) return;
    const ctx = this.ctx, t0 = ctx.currentTime;
    const s = ctx.createBufferSource(); s.buffer = this.white; s.playbackRate.value = 0.7 + Math.random() * 0.5;
    const f = ctx.createBiquadFilter(); const g = ctx.createGain();
    const cfg = { grass: [2400, 0.8, 0.12, 0.09], forest: [1500, 1.2, 0.16, 0.08], sand: [900, 0.7, 0.12, 0.11], rock: [700, 2.5, 0.14, 0.05],
      water: [500, 0.6, 0.25, 0.22], asphalt: [1100, 1.6, 0.13, 0.045], gravel: [2800, 0.9, 0.2, 0.1], wood: [420, 3.0, 0.18, 0.06] }[surface] || [1500, 1, 0.12, 0.07];
    f.type = 'bandpass'; f.frequency.value = cfg[0] * (0.85 + Math.random() * 0.3); f.Q.value = cfg[1];
    const v = cfg[2] * intensity;
    g.gain.setValueAtTime(0, t0); g.gain.linearRampToValueAtTime(v, t0 + 0.012); g.gain.exponentialRampToValueAtTime(0.0005, t0 + cfg[3] + 0.05);
    s.connect(f).connect(g).connect(this.master);
    s.start(t0, Math.random() * 3); s.stop(t0 + cfg[3] + 0.08);
  },
};

// A positioned sound source. kind: 'bell' (level-crossing alarm), 'train', 'engine'
export class Emitter {
  constructor(kind) { this.kind = kind; this.on = false; this.x = 0; this.y = 0; this.z = 0; this.p = {}; audio.emitters.add(this); if (audio.ctx) this._build(); }
  _build() {
    const ctx = audio.ctx;
    this.pan = ctx.createPanner(); this.pan.panningModel = 'equalpower'; this.pan.distanceModel = 'inverse';
    this.pan.refDistance = this.kind === 'engine' ? 4 : this.kind === 'bell' ? 8 : 12; this.pan.rolloffFactor = this.kind === 'bell' ? 1.6 : 1.1; this.pan.maxDistance = 2000;
    this.range = { bell: [120, 320], train: [500, 900], engine: [60, 95] }[this.kind] || [300, 600];
    this.out = ctx.createGain(); this.out.gain.value = 0; this.out.connect(this.pan).connect(audio.master);
    if (this.kind === 'bell') { this.lpf = ctx.createBiquadFilter(); this.lpf.type = 'lowpass'; this.lpf.frequency.value = 2600; this.lpf.connect(this.out); }
    if (this.kind === 'train') {
      const rum = ctx.createBufferSource(); rum.buffer = audio.brown; rum.loop = true; rum.start();
      this.rumF = ctx.createBiquadFilter(); this.rumF.type = 'lowpass'; this.rumF.frequency.value = 220;
      this.rumG = ctx.createGain(); this.rumG.gain.value = 0; rum.connect(this.rumF).connect(this.rumG).connect(this.out);
      const hiss = ctx.createBufferSource(); hiss.buffer = audio.white; hiss.loop = true; hiss.start();
      this.hisF = ctx.createBiquadFilter(); this.hisF.type = 'bandpass'; this.hisF.frequency.value = 2500; this.hisF.Q.value = 0.5;
      this.hisG = ctx.createGain(); this.hisG.gain.value = 0; hiss.connect(this.hisF).connect(this.hisG).connect(this.out);
      // VVVF traction inverter whine: two tones that track speed
      this.mot = [ctx.createOscillator(), ctx.createOscillator()]; this.motG = ctx.createGain(); this.motG.gain.value = 0;
      this.mot.forEach((o, i) => { o.type = i ? 'triangle' : 'sawtooth'; const f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 900; f.Q.value = 1.5; const l = ctx.createBiquadFilter(); l.type = 'lowpass'; l.frequency.value = 1600; o.connect(f).connect(l).connect(this.motG); o.start(); });
      this.motG.connect(this.out);
      this.nextJoint = 0;
    } else if (this.kind === 'engine') {
      this.osc = ctx.createOscillator(); this.osc.type = 'sawtooth'; this.osc.frequency.value = 40;
      const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 260; this.lp = lp;
      this.oscG = ctx.createGain(); this.oscG.gain.value = 0.35; this.osc.connect(lp).connect(this.oscG).connect(this.out); this.osc.start();
      const tyre = ctx.createBufferSource(); tyre.buffer = audio.brown; tyre.loop = true; tyre.start(0, Math.random() * 3);
      const tf = ctx.createBiquadFilter(); tf.type = 'bandpass'; tf.frequency.value = 600; tf.Q.value = 0.5;
      this.tyreG = ctx.createGain(); this.tyreG.gain.value = 0; tyre.connect(tf).connect(this.tyreG).connect(this.out);
    }
    this.nextStrike = 0;
  }
  set(x, y, z, params) {
    this.x = x; this.y = y; this.z = z; Object.assign(this.p, params);
    if (!audio.ctx || !this.pan) return;
    const ctx = audio.ctx, t = ctx.currentTime, P = this.pan;
    if (P.positionX) { P.positionX.setTargetAtTime(x, t, 0.03); P.positionY.setTargetAtTime(y, t, 0.03); P.positionZ.setTargetAtTime(z, t, 0.03); }
    else P.setPosition(x, y, z);
  }
  update(dt) {
    if (!audio.ctx || !this.pan) return;
    const ctx = audio.ctx, t = ctx.currentTime, p = this.p;
    const d = Math.hypot(this.x - audio.lp.x, this.y - audio.lp.y, this.z - audio.lp.z), fade = 1 - Math.min(1, Math.max(0, (d - this.range[0]) / (this.range[1] - this.range[0])));
    if (this.kind === 'bell') {
      // level-crossing alarm (警報音): an electronic "kan-kan" alternating between two pitches ~2.6 times a second.
      // Harmonic partials, lowpassed, short decay — the old inharmonic bell partials (x2.76, x5.4, x8.9 up to 6.6 kHz)
      // rang like clinking glasses. Out of earshot the strikes stop altogether instead of queueing up.
      const audible = this.on && fade > 0.001;
      this.out.gain.setTargetAtTime(audible ? 0.5 * fade : 0, t, 0.05);
      if (audible) {
        this.nextStrike -= dt;
        if (this.nextStrike < -0.4) this.nextStrike = 0; // after a stall: resume the rhythm, never a burst of strikes
        if (this.nextStrike <= 0) {
          this.nextStrike += 0.38; this.alt = !this.alt;
          const f0 = this.alt ? 750 : 700;
          for (const [m, a, type] of [[1, 1, 'square'], [2, 0.3, 'sine'], [3, 0.12, 'sine']]) {
            const o = ctx.createOscillator(); o.type = type; o.frequency.value = f0 * m; const g = ctx.createGain();
            g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.16 * a, t + 0.006); g.gain.setValueAtTime(0.16 * a, t + 0.05); g.gain.exponentialRampToValueAtTime(0.0005, t + 0.3);
            o.connect(g).connect(this.lpf); o.start(t); o.stop(t + 0.32);
          }
        }
      } else this.nextStrike = 0;
    } else if (this.kind === 'train') {
      const v = p.speed || 0, on = this.on ? fade : 0;
      this.out.gain.setTargetAtTime(on, t, 0.2);
      this.rumG.gain.setTargetAtTime(Math.min(1, v / 12) * 0.9, t, 0.2);
      this.rumF.frequency.setTargetAtTime(120 + v * 9, t, 0.2);
      this.hisG.gain.setTargetAtTime(Math.min(1, v / 20) * 0.12, t, 0.2);
      const acc = Math.abs(p.accel || 0);
      this.motG.gain.setTargetAtTime(acc > 0.05 && v > 0.3 && v < 22 ? 0.03 * Math.min(1, acc) : 0, t, 0.25);
      const band = v < 7 ? v * 95 : v < 14 ? 420 + (v - 7) * 60 : 300 + (v - 14) * 40;
      this.mot[0].frequency.setTargetAtTime(Math.max(40, band), t, 0.1); this.mot[1].frequency.setTargetAtTime(Math.max(40, band * 1.5), t, 0.1);
      // rail-joint "ta-tan" clacks: one per bogie passing each joint
      if (this.on && v > 0.5 && fade > 0.01) {
        this.nextJoint -= dt * v; if (this.nextJoint < -30) this.nextJoint = 0;
        if (this.nextJoint <= 0) {
          this.nextJoint += 25 / (p.cars || 4) * (0.8 + Math.random() * 0.4);
          for (const d of [0, 2.1 / Math.max(v, 1)]) this.clack(t + d, Math.min(1, v / 15));
        }
      }
    } else if (this.kind === 'engine') {
      const v = p.speed || 0;
      this.out.gain.setTargetAtTime(this.on ? fade : 0, t, 0.3);
      this.osc.frequency.setTargetAtTime(32 + v * 4.5 + (p.accel > 0 ? 12 : 0), t, 0.2);
      this.lp.frequency.setTargetAtTime(180 + v * 20, t, 0.2);
      this.oscG.gain.setTargetAtTime(0.12 + (p.accel > 0 ? 0.12 : 0), t, 0.2);
      this.tyreG.gain.setTargetAtTime(Math.min(1, v / 14) * 0.5, t, 0.2);
    }
  }
  clack(t, amp) {
    const ctx = audio.ctx, s = ctx.createBufferSource(); s.buffer = audio.white;
    const f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 900; f.Q.value = 1.2;
    const g = ctx.createGain(); g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(0.9 * amp, t + 0.004); g.gain.exponentialRampToValueAtTime(0.001, t + 0.09);
    s.connect(f).connect(g).connect(this.out); s.start(t, Math.random() * 3); s.stop(t + 0.12);
  }
}
