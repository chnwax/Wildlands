// The rally car's sound, synthesised sample by sample (an AudioWorklet; car.js sends the car's state each frame and
// one-off events). Nothing is a recording: each part is a small model of what makes the noise.
//  - The engine: a four-cylinder four-stroke fires every half turn of the crank. Each firing is a pressure pulse (its
//    strength by the load, a little different cylinder to cylinder, a little jitter), sent down an exhaust: two pipe
//    lengths (delay lines that ring at their own pitch, the open end inverting the wave), body resonances, the silencer
//    a low-pass that opens with the load. Off the throttle the pulses go soft; at the rev limiter the ignition is cut in
//    a pattern; with the lever moving, the drive is let go.
//  - Anti-lag: off the throttle at high revs a rally engine burns fuel in the exhaust — bangs and crackle, at random.
//  - The turbo: boost that builds with load and revs after a lag; its whistle rises with it, an intake hiss with it.
//  - The straight-cut gearbox and the differentials whine: tones at the gear teeth's meshing rates (the gearbox's with
//    the engine, the diffs' with the wheels), loudest under load.
//  - The road: gravel under the tyres (a rolling hiss, and stones flung against the floor and the wheel arches: short
//    pings, more the faster, more still in a slide), the body's rumble over rough ground, tyre squeal on tarmac, the wind.
//  - Events: the suspension hitting a bump, the gear lever's clunk and click, the hydraulic handbrake.
// In the cockpit the engine is heard through the bulkhead (duller), the whine and the stones loud; outside, the exhaust.
const TAU = Math.PI * 2;
class Reso { // a two-pole resonator
  constructor(f, bw, sr) { this.set(f, bw, sr); this.y1 = 0; this.y2 = 0; }
  set(f, bw, sr) { const r = Math.exp(-Math.PI * bw / sr); this.a1 = 2 * r * Math.cos(TAU * f / sr); this.a2 = -r * r; this.g = (1 - r * r) * 0.5; }
  run(x) { const y = this.g * x + this.a1 * this.y1 + this.a2 * this.y2; this.y2 = this.y1; this.y1 = y; return y; }
}
class LP { constructor() { this.y = 0; } run(x, k) { this.y += (x - this.y) * k; return this.y; } } // one-pole
class Pipe { // a delay line ringing at its length, the open end inverting the wave, losing its highs on each pass
  constructor(n, fb) { this.b = new Float32Array(n + 2); this.n = n; this.i = 0; this.fb = fb; this.lp = 0; }
  run(x) { const o = this.b[this.i]; this.lp += (o - this.lp) * 0.45; const y = x + this.fb * this.lp; this.b[this.i] = y; this.i = (this.i + 1) % this.n; return y; }
}
const kOf = (fc, sr) => 1 - Math.exp(-TAU * fc / sr);

class RallyCar extends AudioWorkletProcessor {
  constructor() {
    super();
    const sr = this.sr = sampleRate;
    this.p = { rpm: 1000, thr: 0, load: 0, speed: 0, wheel: 0, slip: 0, gravel: 1, tarmac: 0, rough: 0, cut: 0, limiter: 8200, cockpit: 1, on: 0, gear: 2, vol: 1 };
    this.s = { rpm: 1000, thr: 0, load: 0, speed: 0, wheel: 0, slip: 0, gravel: 1, tarmac: 0, rough: 0, cut: 0, cockpit: 1, on: 0 };
    this.port.onmessage = e => { const d = e.data; if (d.ev) this.event(d); else Object.assign(this.p, d); };
    this.th = 0; this.fire = 0; this.cyl = 0; this.cylAmp = [1.0, 0.84, 1.1, 0.92]; this.cylPh = [0, 0.02, -0.015, 0.01];
    this.pulse = 0; this.pulseN = 0; this.cutPat = 0;
    this.pipeA = new Pipe(Math.round(sr * 0.0108), -0.62); this.pipeB = new Pipe(Math.round(sr * 0.0037), -0.5); this.pipeC = new Pipe(Math.round(sr * 0.0061), -0.55);
    this.rA = new Reso(92, 60, sr); this.rB = new Reso(330, 120, sr); this.rC = new Reso(1250, 500, sr); this.rD = new Reso(2900, 900, sr);
    this.muff = new LP(); this.muff2 = new LP(); this.dc = 0; this.hp = new LP(); this.excDC = 0; this.exDC = 0; this.kDC = kOf(18, sr); this.env = 0; this.kEnv = kOf(5, sr);
    this.boost = 0; this.tph = 0; this.tph2 = 0; this.hiss = new Reso(3200, 1800, sr);
    this.als = 0; this.alsT = 0.1; this.bang = 0; this.bangLP = new LP(); this.bangLP2 = new LP(); this.kBang = kOf(1000, sr); this.thump = 0; this.thumpPh = 0; this.thumpF = 70; this.offT = 0;
    this.wph1 = 0; this.wph2 = 0; this.wph3 = 0; this.whineLP = new LP();
    this.roll = new Reso(1400, 1600, sr); this.roll2 = new Reso(380, 300, sr); this.rumble = new LP(); this.rumble2 = new LP(); this.windLP = new LP(); this.windLP2 = new LP();
    this.squealPh = 0; this.sq = new LP();
    this.stones = []; for (let i = 0; i < 16; i++) this.stones.push({ a: 0, ph: 0, f: 0, d: 0, pan: 0 });
    this.evs = []; // one-off sounds: { t, len, kind, a }
    this.n1 = 0; this.n2 = 0; this.seed = 12345;
  }
  rnd() { this.seed = (this.seed * 1664525 + 1013904223) >>> 0; return this.seed / 4294967296; }
  nz() { return this.rnd() * 2 - 1; }
  event(d) { // one-off sounds
    if (d.ev === 'bump') this.evs.push({ t: 0, len: 0.22, kind: 0, a: Math.min(1.5, d.k || 1), f: 50 + this.rnd() * 25, ph: 0 });
    else if (d.ev === 'gear') this.evs.push({ t: 0, len: 0.09, kind: 1, a: 1, f: 170 + this.rnd() * 40, ph: 0 });
    else if (d.ev === 'lever') this.evs.push({ t: 0, len: 0.03, kind: 2, a: 0.6, f: 2400, ph: 0 });
    else if (d.ev === 'hb') this.evs.push({ t: 0, len: 0.12, kind: 3, a: d.on ? 1 : 0.6, f: 900, ph: 0 });
  }
  process(_, outputs) {
    const out = outputs[0], L = out[0], R = out[1] || out[0], n = L.length, sr = this.sr, p = this.p, s = this.s, dt = 1 / sr;
    const ks = 1 - Math.exp(-dt / 0.03), kf = 1 - Math.exp(-dt / 0.008);
    for (let i = 0; i < n; i++) {
      // (the state, eased: the revs quickly, the rest a touch slower)
      s.rpm += (p.rpm - s.rpm) * kf; s.thr += (p.thr - s.thr) * ks; s.load += (p.load - s.load) * ks; s.speed += (p.speed - s.speed) * ks; s.wheel += (p.wheel - s.wheel) * ks;
      s.slip += (p.slip - s.slip) * ks; s.gravel += (p.gravel - s.gravel) * ks; s.tarmac += (p.tarmac - s.tarmac) * ks; s.rough += (p.rough - s.rough) * ks; s.cut += (p.cut - s.cut) * ks; s.cockpit += (p.cockpit - s.cockpit) * ks; s.on += (p.on - s.on) * ks;
      const rpm = s.rpm, load = s.load * (1 - s.cut), on = s.on;
      // ---- the engine: a firing every half turn
      this.th += rpm / 60 * 2 * dt; // (firings: two per turn)
      if (this.th >= 1) { this.th -= 1; this.cyl = (this.cyl + 1) & 3;
        let a = this.cylAmp[this.cyl] * (1 + this.nz() * 0.04);
        const limit = rpm > p.limiter - 60 && p.thr > 0.5; if (limit) { this.cutPat = (this.cutPat + 1) % 5; if (this.cutPat < 2) a = 0; } // (the limiter's ignition cut)
        const amp = (0.22 + 0.78 * load) * a * on;
        this.pulse += amp; this.pulseN = amp; }
      // the pulse: a sharp rise and a quick fall (a few milliseconds), with combustion grit
      const exc = this.pulse * (1 + 0.35 * this.nz() * Math.min(1, this.pulseN)); this.pulse *= Math.exp(-dt / (0.0011 + 0.0012 * (1 - load)));
      this.excDC += (exc - this.excDC) * this.kDC; const xa = exc - this.excDC; // (pressure about its mean: the pulses' own DC would only push the silencer's saturation off its curve)
      let ex = this.pipeA.run(xa * 0.6) * 0.7 + this.pipeB.run(xa * 0.5) * 0.4;
      ex = this.rA.run(ex) * 1.3 + this.rB.run(ex) * 1.8 + this.rC.run(ex) * (0.5 + 0.9 * load) + this.rD.run(ex) * 0.35 * load + ex * 0.25;
      this.exDC += (ex - this.exDC) * this.kDC; ex -= this.exDC;
      // the silencer: darker off load and from inside the car
      const fc = (900 + 3800 * load + rpm * 0.25) * (1 - 0.45 * s.cockpit);
      ex = this.muff2.run(this.muff.run(ex, kOf(fc, sr)), kOf(fc * 1.4, sr));
      // (its loudness held to the engine's own: rising with the revs and with the load — the pipe's resonances alone would
      // make a slow engine loudest — then driven a little into saturation, as a loud exhaust is)
      this.env += (ex * ex - this.env) * this.kEnv; const rpmN = Math.min(1, Math.max(0, (rpm - 800) / 7400)), want = (0.07 + 0.2 * rpmN) * (0.45 + 0.55 * load) * on;
      ex = Math.tanh(ex * Math.min(6, want / Math.max(Math.sqrt(this.env), 1e-3)) * 1.6) * 0.62;
      // ---- anti-lag: bangs and crackle off the throttle at high revs (and at the limiter, and while the lever moves)
      const offTh = p.thr < 0.2 || p.cut > 0.5; this.offT = offTh ? this.offT + dt : 0;
      const alsOn = on > 0.5 && rpm > 3600 && offTh && this.offT < 1.6;
      this.alsT -= dt;
      if (alsOn && this.alsT <= 0) { this.alsT = 0.04 + this.rnd() * (0.26 - 0.12 * Math.min(1, (rpm - 3600) / 3500)); if (this.rnd() < 0.5 * Math.max(0.3, 1 - this.offT / 1.6)) { this.bang = 0.35 + this.rnd() * 0.75; if (this.rnd() < 0.55) { this.thump = this.bang * 0.9; this.thumpF = 55 + this.rnd() * 35; } } }
      const bn = this.bang > 0.001 ? this.bangLP2.run(this.bangLP.run(this.nz() * this.bang, this.kBang), this.kBang) : this.bangLP2.run(0, this.kBang); let als = this.pipeC.run(bn * 0.9) * 0.8 + bn * 3.2; if (this.bang > 0.001) this.bang *= Math.exp(-dt / 0.02); // (a deep bang, ringing in the pipe)
      if (this.thump > 0.001) { this.thumpPh += this.thumpF * dt; als += Math.sin(TAU * this.thumpPh) * this.thump * 0.9; this.thump *= Math.exp(-dt / 0.05); }
      // ---- the turbo: boost after a lag; its whistle and the intake's hiss
      const bt = on * Math.min(1, Math.max(0, (rpm - 2600) / 3400)) * Math.min(1, s.thr * 1.3) * (1 - s.cut);
      this.boost += (bt - this.boost) * dt / (bt > this.boost ? 0.45 : 0.18);
      const tf = 1900 + 5200 * this.boost + rpm * 0.12; this.tph += tf * dt; this.tph2 += tf * 1.51 * dt;
      const turbo = (Math.sin(TAU * this.tph) * 0.7 + Math.sin(TAU * this.tph2) * 0.2) * this.boost * this.boost * 0.05 * (1 + 0.6 * s.cockpit) + this.hiss.run(this.nz()) * this.boost * 0.09;
      // ---- the straight-cut gearbox and the diffs: whine at the teeth's meshing rates
      const gearOn = p.gear >= 2 && s.cut < 0.5 ? 1 : 0.3;
      this.wph1 += rpm / 60 * 19 * dt; this.wph2 += s.wheel / TAU * 37 * dt; this.wph3 += s.wheel / TAU * 37 * 2.03 * dt;
      const wl = this.whineLP.run((0.25 + 0.75 * Math.abs(load - 0.15)) * Math.min(1, s.speed / 8), kOf(6, sr));
      const whine = (Math.sin(TAU * this.wph1) * 0.45 * gearOn + Math.sin(TAU * this.wph2) * 0.6 + Math.sin(TAU * this.wph3) * 0.18) * wl * on * 0.045 * (0.35 + 0.65 * s.cockpit);
      // ---- the road
      const v = s.speed, vk = Math.min(1.4, v / 30);
      const nz1 = this.nz(), nz2 = this.nz();
      let road = this.roll.run(nz1) * (0.05 * s.gravel + 0.012 * s.tarmac) * vk * (1 + 1.6 * s.slip) + this.roll2.run(nz2) * 0.05 * vk * (s.gravel + 0.4 * s.slip);
      road += this.rumble2.run(this.rumble.run(this.nz(), kOf(90, sr)), kOf(60, sr)) * (0.9 + 2.5 * s.rough) * vk * (0.4 + 0.6 * s.cockpit);
      // stones: flung against the floor and the arches — a short ring each, at random
      const rate = v * (2.2 * s.gravel + 0.15) * (1 + 2.5 * s.slip);
      if (this.rnd() < rate * dt) { const st = this.stones.find(q => q.a < 0.002); if (st) { st.a = (0.2 + this.rnd() * this.rnd() * 1.2) * (0.6 + 0.6 * s.cockpit); st.f = 1300 + this.rnd() * 4200; st.d = Math.exp(-dt / (0.002 + this.rnd() * 0.009)); st.ph = 0; st.pan = this.nz() * 0.8; } }
      let stL = 0, stR = 0; for (const st of this.stones) if (st.a > 0.002) { st.ph += st.f * dt; const y = Math.sin(TAU * st.ph) * st.a * 0.06; stL += y * (1 - st.pan) * 0.5; stR += y * (1 + st.pan) * 0.5; st.a *= st.d; }
      // tyre squeal on tarmac when sliding
      this.squealPh += (950 + 140 * Math.sin(this.squealPh * 0.004)) * dt; const sq = this.sq.run(Math.max(0, s.slip - 0.25) * s.tarmac, kOf(8, sr));
      road += Math.sin(TAU * this.squealPh) * sq * 0.05;
      // the wind
      const wind = this.windLP2.run(this.windLP.run(this.nz(), kOf(500 + v * 22, sr)), kOf(900 + v * 30, sr)) * Math.min(1.5, (v / 35) * (v / 35)) * 0.25;
      // ---- one-off sounds
      let evo = 0;
      for (let k = this.evs.length - 1; k >= 0; k--) { const e = this.evs[k]; e.t += dt; if (e.t > e.len) { this.evs.splice(k, 1); continue; }
        const x = e.t / e.len, env = Math.exp(-e.t / (e.len * 0.28)); e.ph += e.f * dt;
        if (e.kind === 0) evo += (Math.sin(TAU * e.ph) * 0.9 + this.nz() * 0.35 * Math.exp(-e.t / 0.03)) * env * e.a * 0.32; // (a bump: the body's thud, a rattle)
        else if (e.kind === 1) evo += (Math.sin(TAU * e.ph) * 0.7 + this.nz() * (x < 0.06 ? 1 : 0.2)) * env * 0.16; // (the gear going in: a clunk and a click)
        else if (e.kind === 2) evo += this.nz() * env * 0.05; // (the lever leaving its slot)
        else evo += (this.nz() * 0.6 + Math.sin(TAU * e.ph) * 0.4) * env * e.a * 0.12; // (the hydraulic handbrake)
      }
      // ---- mixed: the exhaust a touch to the back, the stones round the car
      const eng = (ex + als) * (0.8 - 0.25 * s.cockpit) + turbo, mid = eng + whine + road + wind * 0.6 + evo;
      let l = mid + stL, r = mid + stR;
      this.dc += ((l + r) * 0.5 - this.dc) * 0.0005; l -= this.dc; r -= this.dc; // (no DC drift)
      L[i] = Math.tanh(l * 1.4) * 0.6 * p.vol; R[i] = Math.tanh(r * 1.4) * 0.6 * p.vol;
    }
    return true;
  }
}
registerProcessor('rally-car', RallyCar);
