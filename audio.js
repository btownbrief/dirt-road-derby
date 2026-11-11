/* Dirt Road Derby — WebAudio: engine hum tied to speed, drift hiss, sfx, light fiddle-and-banjo loop. */
(function () {
  'use strict';
  const DRD = window.DRD;
  const A = (DRD.audio = {});
  let ctx = null, master = null, sfxG = null, musG = null, engG = null, noiseBuf = null;
  let eng = null, hiss = null, mudN = null;
  A.sound = true; A.music = true; A.quiet = false;

  A.unlock = function () {
    try {
      if (!ctx) {
        try { if (navigator.audioSession) navigator.audioSession.type = 'playback'; } catch (e) {}
        const AC = window.AudioContext || window.webkitAudioContext; if (!AC) return;
        ctx = new AC();
        master = ctx.createGain(); master.gain.value = 0.85; master.connect(ctx.destination);
        const comp = ctx.createDynamicsCompressor(); comp.threshold.value = -14; comp.ratio.value = 4; comp.connect(master);
        sfxG = ctx.createGain(); sfxG.connect(comp);
        musG = ctx.createGain(); musG.gain.value = 0.32; musG.connect(comp);
        engG = ctx.createGain(); engG.gain.value = 0; engG.connect(comp);
        noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 1, ctx.sampleRate);
        const d = noiseBuf.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
        buildEngine();
      }
      if (ctx.state !== 'running') { const r = ctx.resume(); if (r && r.catch) r.catch(() => {}); }
      if (A.wantMusic && !mTimer) A.applyMusic(true); // music asked for before the first tap starts now
    } catch (e) {}
  };
  A.suspend = function () { try { if (ctx && ctx.state === 'running') ctx.suspend(); } catch (e) {} };
  A.resume = function () { try { if (ctx && ctx.state !== 'running') { const r = ctx.resume(); if (r && r.catch) r.catch(() => {}); } } catch (e) {} };
  const ok = () => ctx && A.sound && !A.quiet;

  function osc(type, f0, f1, t0, dur, vol, dest, attack) {
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.type = type; o.frequency.setValueAtTime(f0, t0);
    if (f1 && f1 !== f0) o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t0 + dur);
    const at = attack || 0.005;
    g.gain.setValueAtTime(0.0001, t0); g.gain.linearRampToValueAtTime(vol, t0 + at); g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    o.connect(g); g.connect(dest || sfxG); o.start(t0); o.stop(t0 + dur + 0.05);
  }
  function noise(t0, dur, vol, type, freq, q, f1, dest) {
    const s = ctx.createBufferSource(); s.buffer = noiseBuf; s.loop = true;
    const f = ctx.createBiquadFilter(), g = ctx.createGain();
    f.type = type; f.frequency.setValueAtTime(freq, t0); if (f1) f.frequency.exponentialRampToValueAtTime(f1, t0 + dur); f.Q.value = q || 1;
    g.gain.setValueAtTime(vol, t0); g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    s.connect(f); f.connect(g); g.connect(dest || sfxG); s.start(t0, Math.random() * 0.5); s.stop(t0 + dur + 0.02);
  }

  // ---------------------------------------------------------- engine (continuous)
  function buildEngine() {
    const o1 = ctx.createOscillator(), o2 = ctx.createOscillator(), lp = ctx.createBiquadFilter(), g = ctx.createGain();
    o1.type = 'sawtooth'; o2.type = 'square'; o1.frequency.value = 50; o2.frequency.value = 25.3;
    const g2 = ctx.createGain(); g2.gain.value = 0.5;
    lp.type = 'lowpass'; lp.frequency.value = 600; lp.Q.value = 3;
    // an octave-up voice so the engine still reads on small phone speakers (they barely play below ~200 Hz)
    const o3 = ctx.createOscillator(), g3 = ctx.createGain(); o3.type = 'square'; o3.frequency.value = 100; g3.gain.value = 0.28; o3.connect(g3); g3.connect(lp);
    o1.connect(lp); o2.connect(g2); g2.connect(lp); lp.connect(g); g.gain.value = 0.07; g.connect(engG);
    o1.start(); o2.start(); o3.start();
    eng = { o1, o2, o3, lp, g };
    // drift hiss / tire noise
    const s = ctx.createBufferSource(); s.buffer = noiseBuf; s.loop = true;
    const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 2200; bp.Q.value = 0.9;
    const hg = ctx.createGain(); hg.gain.value = 0; s.connect(bp); bp.connect(hg); hg.connect(engG); s.start();
    hiss = { s, bp, g: hg };
    // mud / gravel rumble
    const s2 = ctx.createBufferSource(); s2.buffer = noiseBuf; s2.loop = true;
    const lp2 = ctx.createBiquadFilter(); lp2.type = 'lowpass'; lp2.frequency.value = 380;
    const mg = ctx.createGain(); mg.gain.value = 0; s2.connect(lp2); lp2.connect(mg); mg.connect(engG); s2.start(0.3);
    mudN = { g: mg, f: lp2 };
  }
  // speed01 0..1.3, slip 0..1, rough 0..1 (mud/grass), on = racing
  A.engine = function (on, speed01, slip, rough, boost) {
    if (!ctx || !eng) return;
    const t = ctx.currentTime, k = 0.06;
    const vol = on && A.sound && !A.quiet ? 1 : 0;
    engG.gain.setTargetAtTime(vol, t, 0.08);
    // fake gears: pitch climbs, drops a little at each shift
    const s = Math.max(0, speed01);
    const gear = Math.min(3, Math.floor(s * 3.2)), inG = s * 3.2 - gear;
    const f = 42 + gear * 16 + inG * 46 + (boost ? 18 : 0);
    eng.o1.frequency.setTargetAtTime(f, t, k); eng.o2.frequency.setTargetAtTime(f * 0.503, t, k); eng.o3.frequency.setTargetAtTime(f * 2.01, t, k);
    eng.lp.frequency.setTargetAtTime(560 + s * 1100 + (boost ? 600 : 0), t, k);
    eng.g.gain.setTargetAtTime(0.05 + s * 0.05, t, k);
    hiss.g.gain.setTargetAtTime(Math.min(0.13, slip * 0.16), t, 0.05);
    hiss.bp.frequency.setTargetAtTime(1600 + slip * 1400, t, 0.05);
    mudN.g.gain.setTargetAtTime(Math.min(0.22, rough * s * 0.3), t, 0.06);
  };

  // ---------------------------------------------------------- sfx
  A.click = () => { if (!ok()) return; const t = ctx.currentTime; osc('triangle', 660, 520, t, 0.06, 0.12); };
  A.count = (n) => { if (!ok()) return; const t = ctx.currentTime; osc('square', 440, 440, t, 0.22, 0.12); osc('sine', 880, 880, t, 0.2, 0.08); };
  A.go = () => { if (!ok()) return; const t = ctx.currentTime; osc('square', 880, 880, t, 0.5, 0.14); osc('sine', 1320, 1320, t, 0.45, 0.08); };
  A.crate = () => { if (!ok()) return; const t = ctx.currentTime; noise(t, 0.14, 0.5, 'bandpass', 1300, 1.2); osc('triangle', 180, 90, t, 0.12, 0.25); for (let i = 0; i < 3; i++) noise(t + 0.03 + i * 0.03, 0.04, 0.25, 'highpass', 3000, 1); };
  A.tick = (i) => { if (!ok()) return; const t = ctx.currentTime; osc('square', 900 + (i % 3) * 140, 0, t, 0.03, 0.05); };
  A.gotItem = () => { if (!ok()) return; const t = ctx.currentTime; [784, 988, 1175].forEach((f, i) => osc('triangle', f, f, t + i * 0.06, 0.16, 0.13)); };
  A.boost = (lvl) => { if (!ok()) return; const t = ctx.currentTime; noise(t, 0.6, 0.35, 'bandpass', 600, 1.4, 3000); osc('sawtooth', 160, 420 + lvl * 120, t, 0.45, 0.1); };
  A.driftTier = (tier) => { if (!ok()) return; const t = ctx.currentTime; osc('sine', tier === 2 ? 1320 : 990, tier === 2 ? 1760 : 1320, t, 0.12, 0.1); };
  A.hop = () => { if (!ok()) return; const t = ctx.currentTime; osc('sine', 220, 330, t, 0.07, 0.07); };
  A.spin = () => { if (!ok()) return; const t = ctx.currentTime; osc('triangle', 600, 140, t, 0.7, 0.2); noise(t, 0.6, 0.25, 'bandpass', 2400, 1.5, 900); };
  A.splat = () => { if (!ok()) return; const t = ctx.currentTime; osc('sine', 160, 60, t, 0.25, 0.35); noise(t, 0.18, 0.3, 'lowpass', 700, 1); };
  A.throw = () => { if (!ok()) return; const t = ctx.currentTime; noise(t, 0.18, 0.3, 'bandpass', 900, 2, 2600); };
  A.knock = () => { if (!ok()) return; const t = ctx.currentTime; osc('square', 300, 120, t, 0.08, 0.2); noise(t, 0.05, 0.3, 'highpass', 2000, 1); };
  A.puff = () => { if (!ok()) return; const t = ctx.currentTime; noise(t, 0.3, 0.35, 'lowpass', 1200, 0.7, 200); };
  A.thump = () => { if (!ok()) return; const t = ctx.currentTime; osc('sine', 110, 50, t, 0.22, 0.4); noise(t, 0.2, 0.25, 'bandpass', 900, 0.8); };
  A.wall = (v) => { if (!ok()) return; const t = ctx.currentTime, s = Math.min(1, v / 300); osc('sine', 120 + s * 60, 50, t, 0.14, 0.15 + s * 0.3); noise(t, 0.08, 0.1 + s * 0.25, 'lowpass', 900, 0.8); };
  A.bump = (v) => { if (!ok()) return; const t = ctx.currentTime, s = Math.min(1, v / 300); osc('square', 180 + s * 80, 90, t, 0.09, 0.1 + s * 0.15); noise(t, 0.06, 0.15 + s * 0.2, 'bandpass', 1500, 1); };
  A.heave = (big) => { if (!ok()) return; const t = ctx.currentTime; osc('sine', 90, 45, t, 0.2, big ? 0.45 : 0.25); if (big) noise(t, 0.4, 0.2, 'bandpass', 500, 1, 1500); };
  A.land = () => { if (!ok()) return; const t = ctx.currentTime; osc('sine', 80, 40, t, 0.18, 0.4); noise(t, 0.12, 0.3, 'lowpass', 600, 1); };
  A.lap = (final) => { if (!ok()) return; const t = ctx.currentTime; (final ? [659, 784, 988, 1319] : [784, 1047]).forEach((f, i) => osc('triangle', f, f, t + i * 0.09, 0.22, 0.14)); };
  A.finish = (place) => { if (!ok()) return; const t = ctx.currentTime; const notes = place <= 3 ? [523, 659, 784, 1047, 784, 1047] : [392, 349, 330, 262]; notes.forEach((f, i) => { osc('triangle', f, f, t + i * 0.12, 0.3, 0.16); osc('sine', f / 2, f / 2, t + i * 0.12, 0.3, 0.08); }); };
  A.shutter = () => { if (!ok()) return; const t = ctx.currentTime; noise(t, 0.04, 0.5, 'highpass', 3000, 1); noise(t + 0.07, 0.05, 0.4, 'highpass', 2500, 1); };
  A.tow = () => { if (!ok()) return; const t = ctx.currentTime; osc('triangle', 520, 780, t, 0.25, 0.12); };
  A.bog = () => { if (!ok()) return; const t = ctx.currentTime; noise(t, 0.6, 0.3, 'bandpass', 1400, 1.2, 500); osc('sawtooth', 90, 60, t, 0.5, 0.1); };
  A.draft = () => { if (!ok()) return; const t = ctx.currentTime; noise(t, 0.5, 0.12, 'bandpass', 900, 3, 1800); };
  // roadside crowd: a swell of cheering plus scattered claps and a cowbell (Vermont fair style)
  A.cheer = (big) => {
    if (!ok()) return; const t = ctx.currentTime, d = big ? 2.4 : 1.5;
    const s = ctx.createBufferSource(); s.buffer = noiseBuf; s.loop = true; const f = ctx.createBiquadFilter(), g = ctx.createGain();
    f.type = 'bandpass'; f.frequency.value = 1100; f.Q.value = 0.7; g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(big ? 0.28 : 0.18, t + 0.25); g.gain.exponentialRampToValueAtTime(0.0001, t + d);
    s.connect(f); f.connect(g); g.connect(sfxG); s.start(t); s.stop(t + d + 0.05);
    for (let i = 0; i < (big ? 26 : 14); i++) noise(t + 0.1 + Math.random() * d * 0.8, 0.03, 0.12 + Math.random() * 0.1, 'bandpass', 1600 + Math.random() * 1400, 2);
    if (big) for (let i = 0; i < 6; i++) { osc('square', 560, 540, t + 0.2 + i * 0.22, 0.09, 0.05); osc('square', 845, 830, t + 0.2 + i * 0.22, 0.09, 0.035); }
  };
  A.whoosh = (up) => { if (!ok()) return; const t = ctx.currentTime; noise(t, 0.45, 0.22, 'bandpass', up ? 700 : 2200, 2.2, up ? 2600 : 600); };
  A.pass = (up) => { if (!ok()) return; const t = ctx.currentTime; osc('sine', up ? 700 : 500, up ? 1000 : 350, t, 0.12, 0.07); };
  A.tractor = (vol) => { // putt putt, called each beat by game when near
    if (!ok()) return; const t = ctx.currentTime; osc('square', 70, 50, t, 0.07, 0.12 * vol); };

  // ---------------------------------------------------------- music: an original bluegrass breakdown
  // Four parts (banjo roll, walking upright bass, mandolin chop + brush kit, fiddle tune with an A and a B part).
  // Moods: 'title' = laid back (no kit, slower), 'race' = full band, 'final' = final lap (faster, up a whole step, busier fiddle).
  let mTimer = null, nextT = 0, stepN = 0, mood = 'race';
  const MOODS = { title: { bpm: 118, key: 1, kit: false, fiddle: 0.8 }, race: { bpm: 140, key: 1, kit: true, fiddle: 1 }, final: { bpm: 154, key: 1.1225, kit: true, fiddle: 1.15 } };
  const N = (m) => 196 * Math.pow(2, m / 12); // semitones above G3
  // 16-bar form: A (8 bars) then B (8 bars). Chord roots in semitones from G: G C G D | G C D G || C G C G | Em C D D
  const CH = [[0, 4, 7], [5, 9, 12], [0, 4, 7], [7, 11, 14], [0, 4, 7], [5, 9, 12], [7, 11, 14], [0, 4, 7],
    [5, 9, 12], [0, 4, 7], [5, 9, 12], [0, 4, 7], [4, 7, 11], [5, 9, 12], [7, 11, 14], [7, 11, 14]];
  const ROLL = [0, 1, 2, 0, 1, 2, 0, 2]; // forward roll over the chord, an octave up
  // fiddle: one entry per eighth note, semitones above G4 (null = rest, '-' = hold)
  const FA = [12, '-', 11, 9, 7, '-', 4, 7, 9, '-', 7, 4, 2, '-', 0, 2, 4, 7, 4, 2, 0, '-', null, 2, 4, '-', 2, 4, 7, '-', 9, 11,
    12, '-', 11, 9, 7, 9, 11, 12, 14, '-', 12, 11, 9, '-', 7, '-', 4, 5, 7, 4, 2, '-', 0, 2, 7, '-', '-', '-', null, null, 7, 9];
  const FB = [9, '-', 12, '-', 9, 7, 5, 4, 7, '-', 4, 2, 0, '-', 2, 4, 5, '-', 9, '-', 12, 14, 12, 9, 7, '-', 4, 7, 12, '-', 11, 9,
    7, '-', 11, '-', 7, 4, 2, 4, 9, '-', 12, '-', 9, 7, 5, 4, 2, 4, 7, 9, 11, 12, 14, '-', 12, '-', 11, 9, 7, '-', null, 11];
  function pluck(f, t, vol, dur, bright) {
    const o = ctx.createOscillator(), o2 = ctx.createOscillator(), g = ctx.createGain(), f2 = ctx.createBiquadFilter();
    o.type = 'triangle'; o.frequency.value = f; o2.type = 'square'; o2.frequency.value = f * 2.003;
    const g2 = ctx.createGain(); g2.gain.value = 0.18;
    f2.type = 'lowpass'; f2.frequency.setValueAtTime(bright || 3800, t); f2.frequency.exponentialRampToValueAtTime(420, t + dur);
    g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(vol, t + 0.003); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(f2); o2.connect(g2); g2.connect(f2); f2.connect(g); g.connect(musG); o.start(t); o2.start(t); o.stop(t + dur + 0.02); o2.stop(t + dur + 0.02);
  }
  function bass(f, t, dur) {
    const o = ctx.createOscillator(), g = ctx.createGain(), lp = ctx.createBiquadFilter();
    o.type = 'triangle'; o.frequency.value = f; lp.type = 'lowpass'; lp.frequency.value = 520;
    g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(0.2, t + 0.012); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(lp); lp.connect(g); g.connect(musG); o.start(t); o.stop(t + dur + 0.02);
  }
  function fiddle(f, t, dur, vol) {
    const o = ctx.createOscillator(), g = ctx.createGain(), lp = ctx.createBiquadFilter(), lfo = ctx.createOscillator(), lg = ctx.createGain();
    o.type = 'sawtooth'; o.frequency.value = f; lfo.frequency.value = 5.6; lg.gain.value = f * 0.012; lfo.connect(lg); lg.connect(o.frequency);
    lp.type = 'lowpass'; lp.frequency.value = 2100; lp.Q.value = 1.4;
    g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(vol, t + 0.035); g.gain.setValueAtTime(vol * 0.85, t + Math.max(0.04, dur - 0.05)); g.gain.exponentialRampToValueAtTime(0.0001, t + dur + 0.04);
    o.connect(lp); lp.connect(g); g.connect(musG); o.start(t); lfo.start(t); o.stop(t + dur + 0.06); lfo.stop(t + dur + 0.06);
  }
  function hit(t, kind) {
    if (kind === 'kick') { const o = ctx.createOscillator(), g = ctx.createGain(); o.frequency.setValueAtTime(110, t); o.frequency.exponentialRampToValueAtTime(42, t + 0.12); g.gain.setValueAtTime(0.28, t); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.16); o.connect(g); g.connect(musG); o.start(t); o.stop(t + 0.18); }
    else if (kind === 'snare') noise(t, 0.13, 0.11, 'bandpass', 2600, 0.8, 1500, musG);
    else if (kind === 'chop') noise(t, 0.05, 0.06, 'bandpass', 1800, 2.5, null, musG);
    else noise(t, 0.03, 0.035, 'highpass', 7000, 1, null, musG);
  }
  function schedule() {
    if (!ctx) return;
    const M = MOODS[mood] || MOODS.race, SPB = 60 / M.bpm / 2, K = M.key;
    while (nextT < ctx.currentTime + 0.3) {
      const bar = Math.floor(stepN / 8) % 16, st = stepN % 8, ch = CH[bar], t = nextT;
      const swing = st % 2 ? SPB * 0.08 : 0, tt = t + swing;
      // banjo roll
      pluck(N(ch[ROLL[st]] + 12) * K, tt, mood === 'title' ? 0.045 : 0.05, 0.24);
      // walking bass: root on 1, fifth on 3, walk toward the next chord on 4
      if (st % 2 === 0) {
        const nxt = CH[(bar + 1) % 16][0];
        const b = st === 0 ? ch[0] : st === 2 ? ch[1] : st === 4 ? ch[2] : nxt + (nxt > ch[2] ? -1 : nxt < ch[0] ? 1 : -2);
        bass(N(b - 12) * K, t, SPB * 1.8);
      }
      if (M.kit) {
        if (st === 0 || st === 4) hit(t, 'kick');
        if (st === 2 || st === 6) { hit(t, 'snare'); hit(t, 'chop'); }
        if (st % 2) hit(tt, 'hat');
        if (mood === 'final' && (st === 7) && bar % 2 === 1) hit(tt, 'snare');
      } else if (st === 2 || st === 6) hit(t, 'chop');
      // fiddle tune (rests through the first 4 bars of each pass on the title screen)
      const pass = Math.floor(stepN / 128);
      const tune = bar < 8 ? FA : FB, ix = (bar % 8) * 8 + st, n = tune[ix];
      if (typeof n === 'number' && !(mood === 'title' && pass % 2 === 0 && bar < 4)) {
        let len = 1; while (tune[ix + len] === '-' && ix + len < tune.length) len++;
        fiddle(N(n + 12) * K, tt, SPB * len * 0.95, 0.03 * M.fiddle);
        if (mood === 'final' && len === 1 && st % 2 === 0) fiddle(N(n + 12 + 7) * K, tt, SPB * 0.9, 0.012); // double stop
      }
      nextT += SPB; stepN++;
    }
  }
  A.musicMood = function (m) { if (MOODS[m]) mood = m; };
  A.applyMusic = function (want, m) {
    A.wantMusic = want !== false;
    if (m) A.musicMood(m);
    if (!ctx) return;
    const on = A.music && A.sound && want !== false;
    if (on && !mTimer) { nextT = ctx.currentTime + 0.05; stepN = 0; mTimer = setInterval(schedule, 90); }
    else if (!on && mTimer) { clearInterval(mTimer); mTimer = null; }
  };
})();
