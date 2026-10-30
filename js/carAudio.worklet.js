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
//  - The road: gravel under the tyres (a rolling hiss, and stones flung against the floor and the wheel arches: each a
//    burst of noise — a hard, toneless tick — through the floor pan's and the arch liners' own broad resonances, more
//    the faster, more still in a slide), the body's rumble over rough ground, tyre squeal on tarmac, the wind.
//  - Knocks (the suspension hitting a bump, the gear lever, the hydraulic handbrake): an impact — a short burst of noise
//    — ringing the struck part's few inharmonic modes (steel rings long and bright, a body panel dull and short), with
//    the thud it sends through the car.
//  - A crash (another car): a crumpling of panels — bursts of noise a few milliseconds apart through a body's many
//    inharmonic modes — a deep thud, and the tinkle of something brittle when it is hard.
// Each car has its own voice (car.js SPEC.voice): the cylinders and how often they fire, the exhaust's banks and pipes
// and resonances, the grit of the firing, anti-lag or only pops on the overrun, the turbo's pitch, the wastegate's
// flutter when the throttle is lifted on boost, the gearbox's whine. A flat-plane V8 sends alternate firings down its
// two banks' pipes: two four-cylinders a firing apart, which is its rasp.
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
const kOf = (fc, sr) => 1 - Math.exp(-TAU * fc / sr), smoothstep01 = x => x <= 0 ? 0 : x >= 1 ? 1 : x * x * (3 - 2 * x);

class RallyCar extends AudioWorkletProcessor {
  constructor() {
    super();
    const sr = this.sr = sampleRate;
    this.p = { boost: -1, rpm: 1000, thr: 0, load: 0, speed: 0, wheel: 0, slip: 0, gravel: 1, tarmac: 0, rough: 0, cut: 0, limiter: 8200, cockpit: 1, on: 0, gear: 2, vol: 1 };
    this.s = { rpm: 1000, thr: 0, load: 0, speed: 0, wheel: 0, slip: 0, gravel: 1, tarmac: 0, rough: 0, cut: 0, cockpit: 1, on: 0 };
    this.port.onmessage = e => { const d = e.data; if (d.voice) this.setVoice(d.voice); else if (d.ev) this.event(d); else Object.assign(this.p, d); };
    this.th = 0; this.fire = 0; this.cyl = 0;
    this.pulse = [0, 0]; this.pulseN = 0; this.cutPat = 0; this.excDC2 = 0;
    this.setVoice({});
    this.flut = 0; this.flutT = 0; this.flutPh = 0; this.lastThr = 0; this.flutR = new Reso(1100, 900, sr); this.flutR2 = new Reso(2700, 1600, sr);
    this.muff = new LP(); this.muff2 = new LP(); this.dc = 0; this.hp = new LP(); this.excDC = 0; this.exDC = 0; this.kDC = kOf(18, sr); this.env = 0; this.kEnv = kOf(5, sr);
    this.boost = 0; this.tph = 0; this.tph2 = 0; this.hiss = new Reso(3200, 1800, sr);
    this.als = 0; this.alsT = 0.1; this.bang = 0; this.bangLP = new LP(); this.bangLP2 = new LP(); this.kBang = kOf(1000, sr); this.thump = 0; this.thumpPh = 0; this.thumpF = 70; this.offT = 0;
    this.wph1 = 0; this.wph2 = 0; this.wph3 = 0; this.whineLP = new LP();
    this.roll = new Reso(1400, 1600, sr); this.roll2 = new Reso(380, 300, sr); this.rumble = new LP(); this.rumble2 = new LP(); this.windLP = new LP(); this.windLP2 = new LP();
    this.squealPh = 0; this.sq = new LP();
    this.stones = []; for (let i = 0; i < 12; i++) this.stones.push({ a: 0, d: 0, pan: 0, mix: 0 });
    this.panL = new Reso(2300, 1700, sr); this.panR = new Reso(2300, 1700, sr); this.archL = new Reso(850, 900, sr); this.archR = new Reso(850, 900, sr); // (the floor pan, the arch liners)
    this.evs = []; // knocks: { t, len, a, exc, res: [[Reso, gain]], thud }
    this.n1 = 0; this.n2 = 0; this.seed = 12345;
  }
  setVoice(v) { const sr = this.sr, V = this.V = Object.assign({ cyl: 4, fires: 2, banks: 1, pipes: [0.0108, 0.0037, 0.0061], res: [[92, 60], [330, 120], [1250, 500], [2900, 900]], rasp: 0.35, als: 1, pops: 0, flutter: 0, whine: 1, muffle: 1, gain: 1, bulkhead: 1, twin: 0.2 }, v);
    V.turbo = Object.assign({ f0: 1900, f1: 5200, k: 1, hiss: 1 }, v.turbo || {});
    this.cylAmp = Array.from({ length: V.cyl }, (_, i) => 1 + 0.13 * Math.sin(i * 2.39 + 0.7)); // (each cylinder a little its own)
    const [a, b, c] = V.pipes; this.pipeA = new Pipe(Math.round(sr * a), -0.62); this.pipeA2 = new Pipe(Math.round(sr * a * 1.13), -0.6); this.pipeB = new Pipe(Math.round(sr * b), -0.5); this.pipeC = new Pipe(Math.round(sr * c), -0.55);
    [this.rA, this.rB, this.rC, this.rD] = V.res.map(([f, bw]) => new Reso(f, bw, sr)); }
  rnd() { this.seed = (this.seed * 1664525 + 1013904223) >>> 0; return this.seed / 4294967296; }
  nz() { return this.rnd() * 2 - 1; }
  // a knock: an impact (noise, exc s long) ringing modes [Hz, bandwidth Hz, gain], and the thud through the car
  knock(a, exc, modes, thud, len, delay = 0) { const sr = this.sr, v = 0.92 + this.rnd() * 0.16;
    this.evs.push({ t: -delay, len, a, exc, res: modes.map(([f, bw, g]) => [new Reso(f * v, bw, sr), g]), thud, lp: new LP(), lp2: new LP() }); }
  event(d) {
    if (d.ev === 'bump') { const k = Math.min(1.5, d.k || 1) * 0.6; this.knock(k, 0.012, [[95, 60, 3.0], [240, 160, 1.6], [620, 500, 0.9], [1500, 1200, 0.35]], 0.9 * k, 0.28); } // (the body over a bump: a dull, heavy thud, a panel's rattle)
    else if (d.ev === 'gear') this.knock(1, 0.0016, [[690, 35, 1.6], [1730, 60, 1.1], [2960, 90, 0.8], [4150, 140, 0.5], [180, 90, 1.0]], 0.35, 0.12); // (the dogs going in: steel on steel)
    else if (d.ev === 'lever') this.knock(0.45, 0.012, [[1300, 900, 0.9], [2600, 1500, 0.6], [520, 300, 0.5]], 0.05, 0.05); // (the lever leaving its slot: a short, gritty scrape)
    else if (d.ev === 'crash') { const k = Math.min(2, d.k || 1), body = [[115, 70, 3.0], [290, 130, 2.2], [690, 240, 1.6], [1240, 400, 1.2], [2150, 650, 0.9], [3700, 1100, 0.55], [5400, 1600, 0.3]];
      this.knock(0.95 * k, 0.018, body, 1.5 * k, 0.7); // (the hit: panels, a thud through the car)
      for (let j = 1; j < 3 + k * 2; j++) this.knock((0.5 - 0.08 * j) * k, 0.006, body.slice(2), 0.2 * k, 0.4, j * (0.018 + this.rnd() * 0.03)); // (crumpling)
      if (k > 0.9) this.knock(0.3 * k, 0.003, [[4300, 260, 0.9], [6200, 420, 0.7], [8100, 600, 0.5]], 0, 0.45, 0.03); } // (glass, plastic)
    else if (d.ev === 'hb') this.knock(d.on ? 1 : 0.55, 0.003, [[430, 70, 1.6], [1150, 140, 1.1], [2350, 220, 0.6], [120, 80, 0.8]], d.on ? 0.45 : 0.2, 0.14); // (the handbrake lever against its stop, the hydraulics taking up)
  }
  process(_, outputs) {
    const out = outputs[0], L = out[0], R = out[1] || out[0], n = L.length, sr = this.sr, p = this.p, s = this.s, dt = 1 / sr;
    const ks = 1 - Math.exp(-dt / 0.03), kf = 1 - Math.exp(-dt / 0.008);
    if (this.V.flutter && p.thr < 0.25 && this.lastThr >= 0.5 && this.boost > 0.3) { this.flut = this.boost; this.flutT = 0; } this.lastThr = p.thr; // (a lift on boost)
    for (let i = 0; i < n; i++) {
      // (the state, eased: the revs quickly, the rest a touch slower)
      s.rpm += (p.rpm - s.rpm) * kf; s.thr += (p.thr - s.thr) * ks; s.load += (p.load - s.load) * ks; s.speed += (p.speed - s.speed) * ks; s.wheel += (p.wheel - s.wheel) * ks;
      s.slip += (p.slip - s.slip) * ks; s.gravel += (p.gravel - s.gravel) * ks; s.tarmac += (p.tarmac - s.tarmac) * ks; s.rough += (p.rough - s.rough) * ks; s.cut += (p.cut - s.cut) * ks; s.cockpit += (p.cockpit - s.cockpit) * ks; s.on += (p.on - s.on) * ks;
      const rpm = s.rpm, load = s.load * (1 - s.cut), on = s.on;
      // ---- the engine: its firings (a four-cylinder two a turn, a V8 four), each down its bank's pipe
      const V = this.V; this.th += rpm / 60 * V.fires * dt;
      if (this.th >= 1) { this.th -= 1; this.cyl = (this.cyl + 1) % V.cyl;
        let a = this.cylAmp[this.cyl] * (1 + this.nz() * 0.04);
        const limit = rpm > p.limiter - 60 && p.thr > 0.5; if (limit) { this.cutPat = (this.cutPat + 1) % 5; if (this.cutPat < 2) a = 0; } // (the limiter's ignition cut)
        const amp = (0.22 + 0.78 * load) * a * on;
        this.pulse[V.banks > 1 ? this.cyl & 1 : 0] += amp; this.pulseN = amp; }
      // the pulse: a sharp rise and a quick fall (a few milliseconds), with combustion grit
      const decay = Math.exp(-dt / (0.0011 + 0.0012 * (1 - load))), grit = 1 + V.rasp * this.nz() * Math.min(1, this.pulseN);
      const exc = this.pulse[0] * grit, exc2 = this.pulse[1] * grit; this.pulse[0] *= decay; this.pulse[1] *= decay;
      this.excDC += (exc - this.excDC) * this.kDC; this.excDC2 += (exc2 - this.excDC2) * this.kDC; const xa = exc - this.excDC, xb = exc2 - this.excDC2; // (pressure about its mean: the pulses' own DC would only push the silencer's saturation off its curve)
      let ex = this.pipeA.run(xa * 0.6) * 0.7 + (V.banks > 1 ? this.pipeA2.run(xb * 0.6) * 0.7 : 0) + this.pipeB.run((xa + xb) * 0.5) * 0.4;
      ex = this.rA.run(ex) * 1.3 + this.rB.run(ex) * 1.8 + this.rC.run(ex) * (0.5 + 0.9 * load) + this.rD.run(ex) * 0.35 * load + ex * 0.25;
      this.exDC += (ex - this.exDC) * this.kDC; ex -= this.exDC;
      // the silencer: darker off load and from inside the car
      const fc = (900 + 3800 * load + rpm * 0.25) * (1 - 0.45 * s.cockpit) / V.muffle;
      ex = this.muff2.run(this.muff.run(ex, kOf(fc, sr)), kOf(fc * 1.4, sr));
      // (its loudness held to the engine's own: rising with the revs and with the load — the pipe's resonances alone would
      // make a slow engine loudest — then driven a little into saturation, as a loud exhaust is)
      this.env += (ex * ex - this.env) * this.kEnv; const rpmN = Math.min(1, Math.max(0, (rpm - 800) / 7400)), want = (0.07 + 0.2 * rpmN) * (0.45 + 0.55 * load) * on;
      ex = Math.tanh(ex * Math.min(6, want / Math.max(Math.sqrt(this.env), 1e-3)) * 1.6) * 0.62;
      // ---- anti-lag: bangs and crackle off the throttle at high revs (and at the limiter, and while the lever moves)
      const offTh = p.thr < 0.2 || p.cut > 0.5; this.offT = offTh ? this.offT + dt : 0;
      const alsOn = on > 0.5 && rpm > 3600 && offTh && this.offT < 1.6 && V.als, popsOn = on > 0.5 && rpm > 3000 && offTh && this.offT < 1.1 && V.pops > 0 && !V.als;
      this.alsT -= dt;
      if (alsOn && this.alsT <= 0) { this.alsT = 0.04 + this.rnd() * (0.26 - 0.12 * Math.min(1, (rpm - 3600) / 3500)); if (this.rnd() < 0.5 * Math.max(0.3, 1 - this.offT / 1.6)) { this.bang = 0.35 + this.rnd() * 0.75; if (this.rnd() < 0.55) { this.thump = this.bang * 0.9; this.thumpF = 55 + this.rnd() * 35; } } }
      if (popsOn && this.alsT <= 0) { this.alsT = 0.05 + this.rnd() * 0.22; if (this.rnd() < V.pops * (1 - this.offT / 1.1)) this.bang = 0.12 + this.rnd() * 0.3; } // (a road engine: pops and a crackle on the overrun, no bangs)
      const bn = this.bang > 0.001 ? this.bangLP2.run(this.bangLP.run(this.nz() * this.bang, this.kBang), this.kBang) : this.bangLP2.run(0, this.kBang); let als = this.pipeC.run(bn * 0.9) * 0.8 + bn * 3.2; if (this.bang > 0.001) this.bang *= Math.exp(-dt / 0.02); // (a deep bang, ringing in the pipe)
      if (this.thump > 0.001) { this.thumpPh += this.thumpF * dt; als += Math.sin(TAU * this.thumpPh) * this.thump * 0.9; this.thump *= Math.exp(-dt / 0.05); }
      // ---- the turbo: boost after a lag; its whistle and the intake's hiss
      const bt = on * Math.min(1, Math.max(0, (rpm - 2600) / 3400)) * Math.min(1, s.thr * 1.3) * (1 - s.cut);
      if (p.boost >= 0) this.boost += (p.boost * on - this.boost) * kf; else this.boost += (bt - this.boost) * dt / (bt > this.boost ? 0.45 : 0.18); // (the car's own boost, when its physics has one)
      const TV = V.turbo, tf = TV.f0 + (TV.f1 - TV.f0) * this.boost + rpm * 0.12; this.tph += tf * dt; this.tph2 += tf * (V.banks > 1 ? 1.027 : 1.51) * dt; // (two turbos a hair apart: they beat — V.twin how loud the second)
      let turbo = (Math.sin(TAU * this.tph) * 0.7 + Math.sin(TAU * this.tph2) * V.twin) * this.boost * this.boost * 0.05 * TV.k * (1 + 0.6 * s.cockpit) + this.hiss.run(this.nz()) * this.boost * 0.09 * TV.hiss;
      // the wastegates' flutter: the throttle lifted on boost, the compressor surging — a chatter of puffs, then a sigh
      if (this.flut > 0.002) { this.flutT += dt; this.flutPh += (17 + 9 * this.flutT) * dt; const ch = (this.flutPh % 1) < 0.42 ? 1 : 0.12, e = this.flut * Math.exp(-this.flutT / 0.32);
        turbo += (this.flutR.run(this.nz()) * 1.3 * ch + this.flutR2.run(this.nz()) * 0.8 * Math.exp(-this.flutT / 0.12)) * e * (0.5 + 0.3 * s.cockpit); if (e < 0.002) this.flut = 0; }
      // ---- the straight-cut gearbox and the diffs: whine at the teeth's meshing rates
      const gearOn = p.gear >= 2 && s.cut < 0.5 ? 1 : 0.3;
      this.wph1 += rpm / 60 * 19 * dt; this.wph2 += s.wheel / TAU * 37 * dt; this.wph3 += s.wheel / TAU * 37 * 2.03 * dt;
      const wl = this.whineLP.run((0.25 + 0.75 * Math.abs(load - 0.15)) * Math.min(1, s.speed / 8), kOf(6, sr));
      const whine = (Math.sin(TAU * this.wph1) * 0.45 * gearOn + Math.sin(TAU * this.wph2) * 0.6 + Math.sin(TAU * this.wph3) * 0.18) * wl * on * 0.045 * (0.35 + 0.65 * s.cockpit) * V.whine;
      // ---- the road
      const v = s.speed, vk = Math.min(1.4, v / 30);
      const nz1 = this.nz(), nz2 = this.nz();
      const gk = p.gravelRec ? 0.35 : 1; // (the recorded gravel carries the hiss when it plays)
      let road = this.roll.run(nz1) * (0.05 * s.gravel * gk + 0.012 * s.tarmac) * vk * (1 + 1.6 * s.slip) + this.roll2.run(nz2) * 0.05 * vk * (s.gravel * gk + 0.4 * s.slip);
      road += this.rumble2.run(this.rumble.run(this.nz(), kOf(90, sr)), kOf(60, sr)) * (0.9 + 2.5 * s.rough) * vk * (0.4 + 0.6 * s.cockpit);
      // stones: flung against the floor and the arches — each a burst of noise (no pitch of its own) through the struck
      // panel's broad resonance, at random
      const rate = v * (1.6 * s.gravel + 0.1) * (1 + 2 * s.slip) * (p.gravelRec ? 0.3 : 1); // (fewer when the recorded gravel plays)
      if (this.rnd() < rate * dt) { const st = this.stones.find(q => q.a < 0.002); if (st) { st.a = (0.15 + this.rnd() * this.rnd() * 1.1) * (0.6 + 0.6 * s.cockpit); st.d = Math.exp(-dt / (0.0006 + this.rnd() * 0.0018)); st.pan = this.nz() * 0.85; st.mix = this.rnd(); } }
      let eL = 0, eR = 0, aL = 0, aR = 0; for (const st of this.stones) if (st.a > 0.002) { const x = this.nz() * st.a, l = (1 - st.pan) * 0.5, r = (1 + st.pan) * 0.5; eL += x * l * st.mix; eR += x * r * st.mix; aL += x * l * (1 - st.mix); aR += x * r * (1 - st.mix); st.a *= st.d; }
      const stL = (this.panL.run(eL) * 1.6 + this.archL.run(aL) * 1.4 + eL * 0.15) * 0.22, stR = (this.panR.run(eR) * 1.6 + this.archR.run(aR) * 1.4 + eR * 0.15) * 0.22;
      // tyre squeal on tarmac when sliding
      this.squealPh += (950 + 140 * Math.sin(this.squealPh * 0.004)) * dt; const sq = this.sq.run(Math.max(0, s.slip - 0.25) * s.tarmac, kOf(8, sr));
      road += Math.sin(TAU * this.squealPh) * sq * 0.05;
      // the wind
      const wind = this.windLP2.run(this.windLP.run(this.nz(), kOf(500 + v * 22, sr)), kOf(900 + v * 30, sr)) * Math.min(1.5, (v / 35) * (v / 35)) * 0.25;
      // ---- one-off sounds
      let evo = 0;
      for (let k = this.evs.length - 1; k >= 0; k--) { const e = this.evs[k]; e.t += dt; if (e.t < 0) continue; if (e.t > e.len) { this.evs.splice(k, 1); continue; }
        const x = this.nz() * e.a * Math.exp(-e.t / e.exc) * (e.t < e.exc * 4 ? 1 : 0); let y = 0; for (const [rs, g] of e.res) y += rs.run(x) * g;
        const th = e.lp2.run(e.lp.run(x * 6, 0.004), 0.004) * e.thud; // (the thud: what reaches the seat through the floor)
        evo += (y * 0.5 + th) * (1 - smoothstep01(e.t / e.len)); }
      // ---- mixed: the exhaust a touch to the back, the stones round the car
      // (the exhaust as loud as the car's own (V.gain); through the bulkhead in the cockpit — less of a wall for an engine
      // right behind the driver's head, V.bulkhead)
      const eng = (ex + als) * V.gain * (0.8 - 0.25 * s.cockpit * V.bulkhead) + turbo, mid = eng + whine + road + wind * 0.6 + evo;
      let l = mid + stL, r = mid + stR;
      this.dc += ((l + r) * 0.5 - this.dc) * 0.0005; l -= this.dc; r -= this.dc; // (no DC drift)
      L[i] = Math.tanh(l * 1.4) * 0.6 * p.vol; R[i] = Math.tanh(r * 1.4) * 0.6 * p.vol;
    }
    return true;
  }
}
registerProcessor('rally-car', RallyCar);
