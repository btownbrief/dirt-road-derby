/* Dirt Road Derby — race simulation: car physics, drifting, items, hazards, AI, laps.
   DOM-free and deterministic for a given seed, so whole races can run headlessly (Node or __T). */
(function (G) {
  'use strict';
  const DRD = G.DRD;
  const S = DRD.SURF;
  const DT = 1 / 120;
  const TAU = Math.PI * 2;
  DRD.DT = DT;

  const clamp = (v, a, b) => v < a ? a : v > b ? b : v;
  const wrapA = (a) => { while (a > Math.PI) a -= TAU; while (a < -Math.PI) a += TAU; return a; };

  // ------------------------------------------------------------ tuning
  const TURN = 2.55;           // base yaw rate (rad/s)
  const ACC = 340;             // launch acceleration
  const CAR_R = 10;            // collision circle radius (two circles per car)
  const CAR_OFF = 8;           // circle offset from centre along heading
  const DRIFT_T1 = 0.5, DRIFT_T2 = 1.2; // seconds of sliding for the gold / red mini-boost
  DRD.DRIFT_T2 = DRIFT_T2;
  const TUNE = DRD.TUNE = { assist: 1, yawK: 13, shoulder: 0.7, tapLock: 0.3, tapRamp: 5.5 };

  DRD.CLASSES = [
    { id: 'sunday', name: 'Sunday Driver', vmax: 292, ai: { speed: 0.865, spread: 0.08, look: 0.95, drift: 0.25, avoid: 0.3, items: 0.45, mistake: 0.09, short: 0.15, line: 0.55, rbAhead: 1, rbBehind: 0.7 } },
    { id: 'commuter', name: 'Commuter', vmax: 318, ai: { speed: 0.93, spread: 0.06, look: 1.0, drift: 0.65, avoid: 0.62, items: 0.75, mistake: 0.06, short: 0.45, line: 0.8, rbAhead: 0.9, rbBehind: 0.9 } },
    { id: 'rally', name: 'Rally Pro', vmax: 344, ai: { speed: 0.985, spread: 0.02, look: 1.06, drift: 0.95, avoid: 0.92, items: 1, mistake: 0.015, short: 0.8, line: 0.95, rbAhead: 0.55, rbBehind: 1 } }
  ];
  DRD.AUTOPILOT = { speed: 1.0, look: 1.06, drift: 0.95, avoid: 0.95, items: 1, mistake: 0, short: 0.5, line: 0.95, rbAhead: 0, rbBehind: 0 };

  DRD.RIGS = [
    { id: 0, name: 'Woody Wagon', type: 'wagon', body: '#2f7d50', dark: '#1d5234', roof: '#3d9463', trim: '#b07a45', extra: 'canoe' },
    { id: 1, name: 'Barn Red Pickup', type: 'pickup', body: '#c0392b', dark: '#7d2219', roof: '#d6503f', bed: 'hay' },
    { id: 2, name: 'Mustard Wagon', type: 'wagon', body: '#dca42a', dark: '#94681a', roof: '#ecbd4a', trim: '#6b4a24', extra: 'roofbox' },
    { id: 3, name: 'Lake Blue Pickup', type: 'pickup', body: '#3a78b5', dark: '#22507d', roof: '#5592cc', bed: 'buckets' },
    { id: 4, name: 'Plum Wagon', type: 'wagon', body: '#7b3a62', dark: '#4d2140', roof: '#955079', trim: '#c9b9a0', extra: 'bikes' },
    { id: 5, name: 'Cream Pickup', type: 'pickup', body: '#ece0c0', dark: '#a89670', roof: '#f8f0da', bed: 'wood' }
  ];
  // paint jobs you earn by winning (cosmetic). need = race wins required.
  DRD.PAINTS = [
    { name: 'Factory', need: 0 },
    { name: 'Maple Leaf', need: 1, body: '#d9621e', dark: '#8e3a10', roof: '#ef8a3a', stripe: '#f4e8cc' },
    { name: 'Sugar Snow', need: 3, body: '#eef2f5', dark: '#a9b4bd', roof: '#ffffff', stripe: '#c0392b' },
    { name: 'Midnight', need: 6, body: '#24305a', dark: '#121a36', roof: '#34447a', stripe: '#ffd34d' },
    { name: 'Hunting Plaid', need: 10, body: '#b02a22', dark: '#5e130f', roof: '#c8382e', plaid: '#1b1b1b' },
    { name: 'Gold Rush', need: 15, body: '#d8a923', dark: '#8a6510', roof: '#f2cf55', stripe: '#2b1d12' }
  ];
  DRD.DRIVERS = ['Hazel', 'Otis', 'Birdie', 'Gus', 'Dot', 'Juniper', 'Earl', 'Mabel'];
  DRD.ITEMS = ['syrup', 'donut', 'pine', 'snow', 'hay'];
  DRD.POINTS = [10, 8, 6, 4, 2, 1];

  function surfTable(season) {
    const t = [];
    t[S.OUT] = { v: 0.5, g: 6 };
    t[S.SHOULDER] = { v: TUNE.shoulder, g: 7 };
    t[S.ROAD] = { v: 1, g: 13 };
    t[S.DIRT] = { v: 0.93, g: 10 };
    t[S.MUD] = { v: 0.5, g: 3.6 };
    t[S.ICE] = { v: 1.0, g: 1.5 };
    t[S.LEAVES] = { v: 0.78, g: 7 };
    t[S.HEAVE] = t[S.ROAD];
    t[S.BRIDGE] = { v: 1, g: 13.5 };
    if (season === 'winter') { t[S.ROAD] = { v: 1, g: 9.5 }; t[S.HEAVE] = t[S.ROAD]; t[S.SHOULDER] = { v: 0.56, g: 5 }; t[S.BRIDGE] = { v: 1, g: 11 }; }
    if (season === 'autumn') t[S.SHOULDER] = { v: 0.66, g: 7 };
    return t;
  }

  // ------------------------------------------------------------ race
  function Race(T, o) {
    o = o || {};
    const R = this;
    R.T = T; R.o = o;
    R.cls = DRD.CLASSES[o.cls != null ? o.cls : 1];
    R.laps = o.laps || 3;
    R.mode = o.mode || 'race';
    R.items = R.mode !== 'tt' && o.items !== false;
    R.rand = DRD.rng(o.seed != null ? o.seed : 7);
    R.surf = surfTable(T.season);
    R.t = 0; R.raceT = 0; R.phase = 'countdown'; R.countdown = o.countdown != null ? o.countdown : 3.0;
    R.ev = []; R.objs = []; R.proj = [];
    R.crates = T.crates.map((c) => ({ x: c.x, y: c.y, alive: true, respawn: 0, bonus: !!c.bonus, spin: R.rand() * 6 }));
    R.tractor = T.tractor ? { x: T.tractor.x, y: T.tractor.y, u: -T.tractor.reach, dir: 1, h: 0, moving: false, warn: 0, t: T.tractor.phase || 0 } : null;
    R.cars = [];
    const nCars = R.mode === 'tt' ? 1 : (o.nCars || 6);
    const playerSlot = o.player == null || o.player < 0 ? -1 : (R.mode === 'tt' ? 0 : (o.playerSlot != null ? o.playerSlot : [1, 3, 4][o.cls != null ? o.cls : 1]));
    const rigs = DRD.RIGS.map((r) => r.id);
    const pr = o.player != null && o.player >= 0 ? o.player : 0;
    const others = rigs.filter((r) => r !== pr);
    const names = DRD.DRIVERS.slice();
    // deterministic shuffle of AI names (nameSeed keeps the same rivals through a Grand Prix)
    const NR = o.nameSeed != null ? DRD.rng(o.nameSeed) : R.rand;
    for (let i = names.length - 1; i > 0; i--) { const j = Math.floor(NR() * (i + 1)); const tmp = names[i]; names[i] = names[j]; names[j] = tmp; }
    let oi = 0;
    for (let g = 0; g < nCars; g++) {
      const isP = g === playerSlot;
      const rig = DRD.RIGS[isP ? pr : (playerSlot < 0 && g === 0 ? pr : others[oi++ % others.length])];
      const gp = T.grid[g];
      const c = {
        i: g, rig, name: isP ? 'You' : names[g % names.length], isPlayer: isP,
        x: gp.x, y: gp.y, h: gp.h, vx: 0, vy: 0, yaw: 0, steer: 0, z: 0, hop: 0,
        inp: { steer: 0, analog: false, drift: false, brake: false, use: false },
        drifting: false, driftDir: 0, driftT: 0, driftTier: 0,
        boostT: 0, boostDur: 0, spinT: 0, spinDur: 0, spinFrom: 0, spinTot: 0, spinKind: '', invT: 0, airT: 0, airDur: 0,
        surf: S.ROAD, lastSurf: S.ROAD, mudT: 0, k: -1,
        s: ((gp.s % T.L) + T.L) % T.L, dist: gp.s, lapIdx: -1, lapStart: 0, lapTimes: [], finished: false, finishT: 0, place: g + 1,
        item: null, itemN: 0, roulette: 0, mass: rig.type === 'pickup' ? 1.25 : 1, gripMul: rig.type === 'pickup' ? 0.97 : 1.04,
        progBest: gp.s, progT: 0, respawns: 0, walls: 0, hits: 0, bumpT: 0, speed: 0, slip: 0, vf: 0,
        ai: null, auto: !isP
      };
      c.ai = makeAI(R, c, isP ? DRD.AUTOPILOT : R.cls.ai);
      R.cars.push(c);
    }
    // spread the field: each AI gets its own pace (a few are clearly slower on easy classes)
    { const ai = R.cars.filter((c) => !c.isPlayer), sp = R.cls.ai.spread || 0, ord = ai.map((c, i) => i);
      for (let i = ord.length - 1; i > 0; i--) { const j = Math.floor(R.rand() * (i + 1)); const t = ord[i]; ord[i] = ord[j]; ord[j] = t; }
      ai.forEach((c, i) => { c.ai.speedMul *= 1 - sp * ord[i] / Math.max(1, ai.length - 1);
        const k = c.ai.sk; c.ai.sk = Object.assign({}, k, { mistake: k.mistake * (0.4 + R.rand() * 1.5), line: clamp(k.line + (R.rand() - 0.5) * 0.25, 0.3, 1), drift: clamp(k.drift + (R.rand() - 0.5) * 0.3, 0, 1), items: clamp(k.items + (R.rand() - 0.5) * 0.3, 0.2, 1) }); }); }
    R.player = R.cars.find((c) => c.isPlayer) || null;
    if (R.mode === 'tt' && R.player) { R.player.item = 'donut'; R.player.itemN = 3; }
    R.order = R.cars.slice();
    R.finishedCount = 0;
    R.done = false;
  }
  DRD.Race = Race;

  function makeAI(R, c, sk) {
    const r = R.rand;
    const jitter = 1 + (r() - 0.5) * 0.05;
    return {
      sk, speedMul: sk.speed * jitter, rb: 1, lane: (r() - 0.5) * 30, laneT: 0, laneGoal: 0, avoid: 0, avoidGoal: 0, thinkT: r() * 0.1,
      route: -1, onSc: false, scj: 0, decidedLap: -9, mistake: '', mistT: 0, reverseT: 0, holdT: 0, wantDrift: false,
      driftCommit: 0, brakeT: 0, tractorBrake: 0, tractorDecided: false, lookMul: sk.look * (0.97 + r() * 0.06)
    };
  }

  // ------------------------------------------------------------ helpers
  Race.prototype.emit = function (t, c, extra) { const e = extra || {}; e.t = t; e.c = c ? c.i : -1; this.ev.push(e); };

  // nearest combined sample for a point (refined), returns index or -1
  Race.prototype.nearest = function (x, y) {
    const T = this.T, cell = DRD.cellOf(T, x, y);
    if (cell < 0) return -1;
    let k = T.nearB[cell]; if (k < 0) return -1;
    const C = T.C;
    const kind = C.KIND[k];
    let lo, hi, wrap = false;
    if (kind < 0) { lo = 0; hi = T.N - 1; wrap = true; } else { const o = T.shorts[kind]; lo = o.base; hi = o.base + o.M - 1; }
    let best = Math.hypot(x - C.X[k], y - C.Y[k]) - C.CR[k], bk = k;
    for (let j = -3; j <= 3; j++) {
      if (!j) continue;
      let q = k + j;
      if (wrap) q = (q + T.N) % T.N; else if (q < lo || q > hi) continue;
      const v = Math.hypot(x - C.X[q], y - C.Y[q]) - C.CR[q];
      if (v < best) { best = v; bk = q; }
    }
    return bk;
  };

  Race.prototype.lineAt = function (s, mix, lane) { // racing line point at s (main track)
    const T = this.T, L = T.L; s = ((s % L) + L) % L;
    const f = s / T.ds, i = Math.floor(f) % T.N, j = (i + 1) % T.N, u = f - Math.floor(f);
    const off0 = T.lineOff[i] * mix, off1 = T.lineOff[j] * mix;
    let off = off0 + (off1 - off0) * u + lane;
    const lim = T.HW[i] - 18; off = clamp(off, -lim, lim);
    const x = T.X[i] + (T.X[j] - T.X[i]) * u, y = T.Y[i] + (T.Y[j] - T.Y[i]) * u;
    const tx = T.TX[i], ty = T.TY[i];
    return { x: x - ty * off, y: y + tx * off, tx, ty, i, off };
  };

  // ------------------------------------------------------------ step
  Race.prototype.step = function () {
    const R = this, dt = DT;
    R.t += dt;
    if (R.phase === 'countdown') {
      const before = Math.ceil(R.countdown);
      R.countdown -= dt;
      const after = Math.ceil(R.countdown);
      if (after !== before && after > 0) R.emit('count', null, { n: after });
      // engines rev on the grid; drift held at GO = no penalty, just fun
      for (const c of R.cars) {
        c.steer += (c.inp.steer - c.steer) * 0.1;
        // rocket start: hold DRIFT once the "1" shows. Held through "2" as well = wheelspin.
        if (c.auto && c.ai && R.countdown < 0.9 && !c.ai.revDecided) { c.ai.revDecided = true; c.ai.rocket = R.rand() < c.ai.sk.drift * 0.75; }
        const rev = c.auto ? (c.ai && c.ai.rocket) : c.inp.drift;
        c.revT = rev ? (c.revT || 0) + dt : 0;
      }
      if (R.countdown <= 0) {
        R.phase = 'race'; R.raceT = 0; R.emit('go', null);
        for (const c of R.cars) {
          if (c.revT > 0.12 && c.revT < 1.2) { c.boostT = 0.9; c.boostDur = 0.9; c.vx += Math.cos(c.h) * 90; c.vy += Math.sin(c.h) * 90; R.emit('rocket', c); }
          else if (c.revT >= 1.2) { c.bogT = 0.7; R.emit('bog', c); }
          c.revT = 0;
        }
      }
      return;
    }
    R.raceT += dt;
    if (R.tractor) stepTractor(R, dt);
    for (const c of R.cars) {
      if (c.auto || c.finished) aiThink(R, c, dt);
      stepCar(R, c, dt);
    }
    collideCars(R);
    draft(R, dt);
    stepObjects(R, dt);
    for (const c of R.cars) progress(R, c, dt);
    rank(R);
    // race end
    if (!R.done) {
      const p = R.player;
      const allDone = R.cars.every((c) => c.finished);
      if (allDone || (p && p.finished && R.raceT > p.finishT + 14) || R.raceT > 600) finalize(R);
    }
  };

  function finalize(R) {
    R.done = true;
    // estimate finish times for cars still running
    for (const c of R.cars) {
      if (c.finished) continue;
      const remain = R.laps * R.T.L - c.dist;
      c.finishT = R.raceT + Math.max(0.5, remain / (R.cls.vmax * 0.8));
      c.finished = true; c.estimated = true;
    }
    rank(R);
    R.emit('done', null);
  }

  // ------------------------------------------------------------ tractor
  function stepTractor(R, dt) {
    const tr = R.tractor, TT = R.T.tractor, P = TT.period;
    tr.t += dt;
    const ph = (tr.t % P) / P;
    const reach = TT.reach;
    // 0..0.42 cross +, 0.42..0.5 wait, 0.5..0.92 cross -, 0.92..1 wait
    let u, moving = true, dir;
    if (ph < 0.42) { u = -reach + 2 * reach * (ph / 0.42); dir = 1; }
    else if (ph < 0.5) { u = reach; moving = false; dir = 1; }
    else if (ph < 0.92) { u = reach - 2 * reach * ((ph - 0.5) / 0.42); dir = -1; }
    else { u = -reach; moving = false; dir = -1; }
    tr.u = u; tr.dir = dir; tr.moving = moving;
    tr.x = TT.x + TT.nx * u; tr.y = TT.y + TT.ny * u;
    tr.h = Math.atan2(TT.ny * dir, TT.nx * dir);
    tr.onRoad = Math.abs(u) < R.T.point(TT.s).cr + 30;
    // warning lights when it is about to enter or is on the road
    const cr = R.T.point(TT.s).cr;
    tr.warn = moving && Math.abs(u) < cr + 140 ? 1 : 0;
  }
  function tractorCircles(tr) {
    const ca = Math.cos(tr.h), sa = Math.sin(tr.h);
    return [-19, 0, 19].map((o) => ({ x: tr.x + ca * o, y: tr.y + sa * o, r: 18 }));
  }
  DRD.tractorCircles = tractorCircles;

  // ------------------------------------------------------------ car physics
  function stepCar(R, c, dt) {
    const T = R.T, inp = c.inp;
    const cell = DRD.cellOf(T, c.x, c.y);
    const sf = cell < 0 ? S.OUT : T.surf[cell];
    c.lastSurf = c.surf; c.surf = sf;
    const sp = R.surf[sf] || R.surf[S.ROAD];
    const vmaxBase = R.cls.vmax * (c.auto && !c.finished && !c.isPlayer ? c.ai.speedMul * c.ai.rb : 1) * (c.ai && c.ai.mistake === 'dozy' ? 0.9 : 1);
    const fx = Math.cos(c.h), fy = Math.sin(c.h), rx = -fy, ry = fx;
    let vf = c.vx * fx + c.vy * fy, vr = c.vx * rx + c.vy * ry;
    const spd = Math.abs(vf);
    let yawT = 0;
    if (c.invT > 0) c.invT -= dt;
    if (c.boostT > 0) c.boostT -= dt;
    if (c.hop > 0) c.hop = Math.max(0, c.hop - dt);
    if (c.bumpT > 0) c.bumpT -= dt;
    if (sf === S.MUD) c.mudT = 2.2; else if (c.mudT > 0) c.mudT -= dt;

    if (c.spinT > 0) {
      c.spinT -= dt;
      const k = 1 - Math.max(0, c.spinT) / c.spinDur, e = 1 - (1 - k) * (1 - k) * (1 - k);
      let hNew;
      if (c.spinKind === 'wobble') hNew = c.spinFrom + Math.sin(k * Math.PI * 3) * 0.55 * (1 - k) + c.spinTot * e;
      else hNew = c.spinFrom + c.spinTot * e;
      c.yaw = (hNew - c.h) / dt; c.h = hNew;
      vf *= Math.exp(-(c.spinKind === 'wobble' ? 1.6 : 2.4) * dt);
      vr *= Math.exp(-4 * dt);
      c.drifting = false; c.driftT = 0;
      if (c.spinT <= 0) { c.spinT = 0; c.yaw = 0; }
      // rebuild velocity in the new heading frame so it keeps sliding along the old direction
      const nfx = Math.cos(c.h), nfy = Math.sin(c.h);
      const vx = fx * vf + rx * vr, vy = fy * vf + ry * vr;
      c.vx = vx; c.vy = vy;
      void nfx; void nfy;
      move(R, c, dt);
      return;
    }

    // steering input smoothing (digital steering ramps for weight)
    // tap (digital) steering for the player: a little less lock at speed so a held side doesn't overshoot
    const tapP = c.isPlayer && !c.auto && !inp.analog;
    const tgt = clamp(inp.steer, -1, 1) * (tapP ? 1 - TUNE.tapLock * clamp((spd - 120) / 200, 0, 1) : 1);
    const rate = inp.analog ? 14 : (Math.abs(tgt) < Math.abs(c.steer) || Math.sign(tgt) !== Math.sign(c.steer) ? 9 : (tapP ? TUNE.tapRamp : 5.5));
    c.steer += clamp(tgt - c.steer, -rate * dt, rate * dt);

    if (c.airT > 0) {
      c.airT -= dt;
      c.z = Math.sin(Math.PI * (1 - Math.max(0, c.airT) / c.airDur));
      if (c.airT <= 0) {
        c.airT = 0; c.z = 0;
        const rough = Math.abs(vr) > 110; // only a sideways landing wobbles
        if (rough && c.invT <= 0) startSpin(R, c, 'wobble', 0.6, T);
        else { vf *= 0.96; }
        R.emit('land', c, { rough });
      }
      // ballistic: keep velocity, slight drag
      c.vx = (fx * vf + rx * vr) * (1 - 0.15 * dt); c.vy = (fy * vf + ry * vr) * (1 - 0.15 * dt);
      move(R, c, dt);
      return;
    }

    // frost heave
    if (sf === S.HEAVE && c.lastSurf !== S.HEAVE) {
      if (spd > R.cls.vmax * 0.8) { c.airDur = c.airT = 0.42; c.drifting = false; R.emit('heave', c, { big: true }); }
      else { vf *= 0.9; R.emit('heave', c, { big: false }); }
    }

    // drift state
    const sgn = Math.sign(c.steer) || 0;
    if (inp.drift && !c.drifting) {
      if (!c.driftHeld) { c.hop = 0.14; c.driftHeld = true; R.emit('hop', c); }
      const dsd = Math.abs(inp.steer) > 0.25 ? Math.sign(inp.steer) : (R.raceT > 0.6 ? inp.driftSide || 0 : 0);
      if (dsd && spd > 150 && vf > 0) {
        c.drifting = true; c.driftDir = dsd; c.driftT = 0; c.driftTier = 0; R.emit('driftStart', c);
      }
    }
    if (!inp.drift) c.driftHeld = false;
    if (c.drifting) {
      if (spd < 105 || vf < 0) { c.drifting = false; c.driftT = 0; c.driftTier = 0; }
      else if (!inp.drift) {
        const tier = c.driftTier;
        c.drifting = false; c.driftT = 0; c.driftTier = 0;
        if (tier > 0) { const d = tier === 2 ? 1.15 : 0.6; c.boostT = Math.max(c.boostT, d); c.boostDur = Math.max(c.boostDur > 0 && c.boostT > d ? c.boostDur : 0, d); R.emit('miniBoost', c, { tier }); }
      } else {
        const into = clamp(c.steer * c.driftDir, -1, 1);
        c.driftT += dt * (1 + 0.6 * Math.max(0, into)) * (spd > 160 ? 1 : 0.4);
        const tier = c.driftT > DRIFT_T2 ? 2 : c.driftT > DRIFT_T1 ? 1 : 0;
        if (tier > c.driftTier) { c.driftTier = tier; R.emit('driftTier', c, { tier }); }
      }
    }

    // throttle / brake
    const boosting = c.boostT > 0;
    if (c.bogT > 0) c.bogT -= dt;
    let vmax = vmaxBase * sp.v * (c.draftT > 0.45 ? 1.06 : 1);
    if (boosting) vmax = vmaxBase * 1.32 * Math.max(sp.v, 0.92);
    if (inp.hold) {
      vf -= clamp(vf, -400 * dt, 400 * dt);
    } else if (inp.brake) {
      if (vf > 15) vf -= 620 * dt;
      else vf = Math.max(-125, vf - 260 * dt);
    } else if (inp.coast) {
      vf -= vf * 0.5 * dt;
    } else if (vf < vmax) {
      const a = (boosting ? ACC * 2.2 : ACC) * (1 - 0.72 * clamp(vf / vmax, 0, 1)) * (c.bogT > 0 ? 0.25 : 1);
      vf = Math.min(vmax, vf + (vf < 0 ? 520 : a) * dt);
    } else {
      vf -= (vf - vmax) * Math.min(1, (boosting ? 3 : 1.7) * dt) + 18 * dt;
    }

    // yaw
    const gain = clamp(spd / 95, 0, 1) * (1 - 0.2 * clamp(spd / R.cls.vmax, 0, 1.3));
    if (c.drifting) {
      const into = clamp(c.steer * c.driftDir, -1, 1);
      yawT = c.driftDir * TURN * (0.7 + (into >= 0 ? 0.6 * into : 0.66 * into)) * clamp(spd / 170, 0.5, 1); // full counter-steer ≈ straight
    } else {
      yawT = c.steer * TURN * gain * (vf < 0 ? -1 : 1);
      if (sf === S.ICE) yawT *= 0.8;
    }
    // steering assist for tap-steering players: when no steer is held, gently line the car up with
    // the road, and ease it away from the road edge. Never fights a held steer, never during drifts.
    if (c.isPlayer && !c.auto && !inp.analog && TUNE.assist > 0 && !c.drifting && Math.abs(inp.steer) < 0.1 && spd > 80 && c.k >= 0 && c.k < T.N) {
      const k = c.k, tx = T.TX[k], ty = T.TY[k];
      const lat = (c.x - T.X[k]) * -ty + (c.y - T.Y[k]) * tx, hw = T.HW[k];
      let d = wrapA(Math.atan2(ty, tx) - c.h);
      if (Math.abs(d) < 1.2) {
        let want = clamp(d * 1.6, -0.9, 0.9);
        const edge = Math.abs(lat) - (hw - 22);
        if (edge > 0) want += -Math.sign(lat) * clamp(edge / 30, 0, 1) * 0.8;
        yawT += want * TUNE.assist;
      }
    }
    c.yaw += (yawT - c.yaw) * Math.min(1, TUNE.yawK * dt);
    c.h += c.yaw * dt;

    // lateral grip
    let grip = sp.g * c.gripMul * (c.drifting ? 0.28 : 1);
    if (boosting && !c.drifting) grip *= 1.1;
    vr *= Math.exp(-grip * dt);
    c.slip = vr; c.vf = vf;

    c.vx = fx * vf + rx * vr; c.vy = fy * vf + ry * vr;
    move(R, c, dt);
  }

  function move(R, c, dt) {
    c.x += c.vx * dt; c.y += c.vy * dt;
    c.speed = Math.hypot(c.vx, c.vy);
    wallCheck(R, c);
  }

  function wallCheck(R, c) {
    const k = R.nearest(c.x, c.y);
    if (k < 0) { respawn(R, c); return; }
    c.k = k;
    const C = R.T.C, dx = c.x - C.X[k], dy = c.y - C.Y[k], d = Math.hypot(dx, dy) || 1;
    const lim = C.CR[k] - 9;
    if (d > lim) {
      const nx = dx / d, ny = dy / d;
      c.x = C.X[k] + nx * lim; c.y = C.Y[k] + ny * lim;
      const vn = c.vx * nx + c.vy * ny;
      if (vn > 0) {
        c.vx -= nx * vn * 1.35; c.vy -= ny * vn * 1.35;
        const keep = R.T.season === 'winter' ? 0.975 : 0.965; // snowbanks are softer
        c.vx *= keep; c.vy *= keep;
        if (vn > 50) { c.walls++; R.emit('wall', c, { v: vn, x: c.x + nx * 10, y: c.y + ny * 10 }); }
        // nudge the nose away from the wall so you never grind along it
        const fx = Math.cos(c.h), fy = Math.sin(c.h);
        const into = fx * nx + fy * ny;
        if (into > 0.2 && c.spinT <= 0) { const side = (fx * -ny + fy * nx) > 0 ? 1 : -1; c.h += side * Math.min(0.06, into * 0.05); }
      }
    }
  }

  function startSpin(R, c, kind, dur, T) {
    if (c.invT > 0 || c.spinT > 0) return false;
    T = T || R.T;
    const p = T.point(c.s);
    const ta = Math.atan2(p.ty, p.tx);
    c.spinKind = kind; c.spinDur = c.spinT = dur; c.spinFrom = c.h;
    if (kind === 'spin') { const dir = R.rand() < 0.5 ? 1 : -1; let d = wrapA(ta - c.h); if (dir > 0 && d < 0) d += TAU; if (dir < 0 && d > 0) d -= TAU; c.spinTot = d + dir * TAU * 2; }
    else c.spinTot = wrapA(ta - c.h) * 0.5;
    c.drifting = false; c.driftT = 0; c.driftTier = 0; c.boostT = 0;
    c.invT = dur + 0.9; c.hits++;
    R.emit('spin', c, { kind });
    return true;
  }
  DRD.startSpin = startSpin;

  function respawn(R, c) {
    const T = R.T, p = T.point(c.s);
    c.x = p.x; c.y = p.y; c.h = Math.atan2(p.ty, p.tx); c.vx = p.tx * 60; c.vy = p.ty * 60; c.yaw = 0;
    c.spinT = 0; c.airT = 0; c.z = 0; c.drifting = false; c.boostT = 0; c.invT = 1.6;
    c.progT = 0; c.progBest = c.dist; c.respawns++;
    if (c.ai) { c.ai.route = -1; c.ai.onSc = false; c.ai.reverseT = 0; }
    R.emit('tow', c);
  }
  DRD.respawn = respawn;

  // ------------------------------------------------------------ collisions
  function circles(c) { const fx = Math.cos(c.h), fy = Math.sin(c.h); return [[c.x + fx * CAR_OFF, c.y + fy * CAR_OFF], [c.x - fx * CAR_OFF, c.y - fy * CAR_OFF]]; }
  function collideCars(R) {
    const cs = R.cars, n = cs.length;
    for (let a = 0; a < n; a++) {
      const A = cs[a]; if (A.airT > 0) continue;
      for (let b = a + 1; b < n; b++) {
        const B = cs[b]; if (B.airT > 0) continue;
        if (Math.abs(A.x - B.x) > 40 || Math.abs(A.y - B.y) > 40) continue;
        const ca = circles(A), cb = circles(B);
        let best = null;
        for (const p of ca) for (const q of cb) {
          const dx = q[0] - p[0], dy = q[1] - p[1], d2 = dx * dx + dy * dy;
          if (d2 < (2 * CAR_R) * (2 * CAR_R) && (!best || d2 < best.d2)) best = { dx, dy, d2 };
        }
        if (!best) continue;
        const d = Math.sqrt(best.d2) || 0.01, nx = best.dx / d, ny = best.dy / d, ov = 2 * CAR_R - d;
        const ma = A.mass * (A.boostT > 0 ? 2 : 1), mb = B.mass * (B.boostT > 0 ? 2 : 1), im = 1 / ma + 1 / mb;
        // positional correction (no sticking)
        A.x -= nx * ov * (1 / ma) / im; A.y -= ny * ov * (1 / ma) / im;
        B.x += nx * ov * (1 / mb) / im; B.y += ny * ov * (1 / mb) / im;
        const rv = (B.vx - A.vx) * nx + (B.vy - A.vy) * ny;
        if (rv < 0) {
          const j = -(1 + 0.45) * rv / im;
          A.vx -= nx * j / ma; A.vy -= ny * j / ma; B.vx += nx * j / mb; B.vy += ny * j / mb;
          // small separation kick so they never ride together
          A.vx -= nx * 14; A.vy -= ny * 14; B.vx += nx * 14; B.vy += ny * 14;
          if (-rv > 40 && A.bumpT <= 0 && B.bumpT <= 0) { R.emit('bump', A, { other: B.i, v: -rv, x: (A.x + B.x) / 2, y: (A.y + B.y) / 2 }); A.bumpT = B.bumpT = 0.25; }
        }
      }
    }
  }

  // ------------------------------------------------------------ slipstream
  function draft(R, dt) {
    for (const c of R.cars) {
      let behind = false;
      if (c.speed > 180 && c.airT <= 0) {
        const fx = Math.cos(c.h), fy = Math.sin(c.h);
        for (const q of R.cars) {
          if (q === c) continue;
          const dx = q.x - c.x, dy = q.y - c.y, along = dx * fx + dy * fy;
          if (along > 26 && along < 110 && Math.abs(dx * -fy + dy * fx) < 18 && q.speed > 150) { behind = true; break; }
        }
      }
      const was = c.draftT > 0.45;
      c.draftT = behind ? Math.min(2, (c.draftT || 0) + dt) : Math.max(0, (c.draftT || 0) - dt * 2.5);
      if (!was && c.draftT > 0.45) R.emit('draft', c);
    }
  }

  // ------------------------------------------------------------ items
  function rollItem(R, c) {
    const n = R.cars.length;
    const p = n > 1 ? (c.place - 1) / (n - 1) : 0.5; // 0 leader .. 1 last
    const lead = { syrup: 34, hay: 28, pine: 26, snow: 6, donut: 6 };
    const mid = { syrup: 20, hay: 14, pine: 24, snow: 20, donut: 22 };
    const last = { syrup: 8, hay: 5, pine: 20, snow: 30, donut: 37 };
    const w = {};
    for (const k of DRD.ITEMS) w[k] = p < 0.5 ? lead[k] + (mid[k] - lead[k]) * (p / 0.5) : mid[k] + (last[k] - mid[k]) * ((p - 0.5) / 0.5);
    let tot = 0; for (const k in w) tot += w[k];
    let r = R.rand() * tot, pick = 'donut';
    for (const k of DRD.ITEMS) { r -= w[k]; if (r <= 0) { pick = k; break; } }
    if (R.o.itemOnly) pick = R.o.itemOnly; // Daily Derby twist: every crate holds the same thing
    let count = 1;
    if (pick === 'donut') { if (p > 0.85 && R.rand() < 0.3) count = 3; else if (p > 0.55 && R.rand() < 0.4) count = 2; }
    c.item = pick; c.itemN = count;
    R.emit('gotItem', c, { item: pick, n: count });
  }

  function useItem(R, c) {
    if (!c.item || c.roulette > 0 || c.spinT > 0) return false;
    const fx = Math.cos(c.h), fy = Math.sin(c.h), it = c.item;
    const vfw = Math.max(0, c.vx * fx + c.vy * fy);
    if (it === 'donut') { c.boostT = Math.max(c.boostT, 1.3); c.boostDur = 1.3; const vf = vfw; if (vf < R.cls.vmax) { c.vx += fx * 60; c.vy += fy * 60; } }
    else if (it === 'syrup') R.objs.push({ type: 'syrup', x: c.x - fx * 30, y: c.y - fy * 30, r: 20, life: 30, owner: c.i, age: 0, a: R.rand() * TAU });
    else if (it === 'hay') R.objs.push({ type: 'hay', x: c.x - fx * 32, y: c.y - fy * 32, r: 15, life: 25, owner: c.i, age: 0, a: c.h });
    else if (it === 'pine') R.proj.push({ type: 'pine', x: c.x + fx * 24, y: c.y + fy * 24, vx: fx * (vfw + 430), vy: fy * (vfw + 430), r: 8, life: 1.6, owner: c.i, age: 0, bounces: 1, a: 0 });
    else if (it === 'snow') { const v = Math.min(470, vfw + 260); R.proj.push({ type: 'snow', x: c.x + fx * 26, y: c.y + fy * 26, vx: fx * v, vy: fy * v, sp: v, r: 7, life: 4.5, owner: c.i, age: 0, a: 0 }); }
    R.emit('useItem', c, { item: it });
    c.itemN--; if (c.itemN <= 0) { c.item = null; c.itemN = 0; }
    return true;
  }
  Race.prototype.useItem = function (c) { return useItem(this, c); };

  function stepObjects(R, dt) {
    const T = R.T;
    // crates
    for (const cr of R.crates) {
      cr.spin += dt;
      if (!cr.alive) { cr.respawn -= dt; if (cr.respawn <= 0) cr.alive = true; continue; }
      for (const c of R.cars) {
        if (c.airT > 0.05 || (R.items && (c.item || c.roulette > 0))) continue; // full hands: drive through, leave it for others
        if ((c.x - cr.x) ** 2 + (c.y - cr.y) ** 2 < 26 * 26) {
          cr.alive = false; cr.respawn = 1.6;
          R.emit('crate', c, { x: cr.x, y: cr.y });
          if (R.items && !c.item && c.roulette <= 0) { c.roulette = 0.9; R.emit('roulette', c); }
          break;
        }
      }
    }
    for (const c of R.cars) {
      if (c.roulette > 0) { c.roulette -= dt; if (c.roulette <= 0) { c.roulette = 0; rollItem(R, c); } }
      if (c.inp.use) { c.useBuf = (c.useBuf || 0) + dt; if (useItem(R, c) || (!c.item && c.roulette <= 0) || c.useBuf > 1.3) { c.inp.use = false; c.useBuf = 0; } } // a tap during a spin/roulette fires as soon as it can
    }
    // ground objects
    for (const o of R.objs) {
      o.age += dt; o.life -= dt;
      if (o.life <= 0) { o.dead = true; continue; }
      for (const c of R.cars) {
        if (c.airT > 0.05) continue;
        if (o.owner === c.i && o.age < 0.6) continue;
        const dx = c.x - o.x, dy = c.y - o.y, d = Math.hypot(dx, dy);
        if (o.type === 'syrup' && d < o.r + 8) {
          if (startSpin(R, c, 'spin', 1.0)) { o.dead = true; R.emit('hit', c, { item: 'syrup', x: o.x, y: o.y, by: o.owner }); }
        } else if (o.type === 'hay' && d < o.r + 12) {
          const nx = dx / (d || 1), ny = dy / (d || 1);
          const vn = c.vx * nx + c.vy * ny;
          if (vn < 0) { c.vx -= nx * vn * 1.25; c.vy -= ny * vn * 1.25; }
          c.vx *= 0.55; c.vy *= 0.55; c.x = o.x + nx * (o.r + 12); c.y = o.y + ny * (o.r + 12);
          c.drifting = false; c.driftT = 0;
          o.dead = true; R.emit('hit', c, { item: 'hay', x: o.x, y: o.y, by: o.owner });
        }
      }
    }
    // projectiles
    for (const p of R.proj) {
      p.age += dt; p.life -= dt; p.a += dt * (p.type === 'pine' ? 18 : 9);
      if (p.life <= 0) { p.dead = true; R.emit('poof', null, { x: p.x, y: p.y, item: p.type }); continue; }
      if (p.type === 'snow') {
        p.r = Math.min(24, 7 + p.age * 5.5);
        const k = R.nearest(p.x, p.y);
        if (k >= 0) {
          const C = T.C; let tx = C.TX[k], ty = C.TY[k];
          const lat = (p.x - C.X[k]) * -ty + (p.y - C.Y[k]) * tx;
          // follow the road, drifting back toward the middle
          let dx = tx - (-ty) * lat / 140, dy = ty - tx * lat / 140; const l = Math.hypot(dx, dy); dx /= l; dy /= l;
          const cur = Math.atan2(p.vy, p.vx), want = Math.atan2(dy, dx);
          const na = cur + clamp(wrapA(want - cur), -3.2 * dt, 3.2 * dt);
          p.vx = Math.cos(na) * p.sp; p.vy = Math.sin(na) * p.sp;
        }
      }
      p.x += p.vx * dt; p.y += p.vy * dt;
      const cell = DRD.cellOf(T, p.x, p.y);
      const k = R.nearest(p.x, p.y);
      if (cell < 0 || k < 0) { p.dead = true; continue; }
      const C = T.C, dx = p.x - C.X[k], dy = p.y - C.Y[k], d = Math.hypot(dx, dy);
      if (d > C.CR[k] - 4) {
        if (p.type === 'pine' && p.bounces > 0) {
          const nx = dx / d, ny = dy / d, vn = p.vx * nx + p.vy * ny; p.vx -= 2 * vn * nx; p.vy -= 2 * vn * ny; p.bounces--; p.x = C.X[k] + nx * (C.CR[k] - 5); p.y = C.Y[k] + ny * (C.CR[k] - 5);
          R.emit('pineBounce', null, { x: p.x, y: p.y });
        } else { p.dead = true; R.emit('poof', null, { x: p.x, y: p.y, item: p.type }); continue; }
      }
      for (const c of R.cars) {
        if (c.i === p.owner && p.age < 0.4) continue;
        if (c.airT > 0.1) continue;
        if ((c.x - p.x) ** 2 + (c.y - p.y) ** 2 < (p.r + 12) ** 2) {
          if (c.invT > 0) { p.dead = true; R.emit('poof', null, { x: p.x, y: p.y, item: p.type }); break; }
          if (p.type === 'pine') { startSpin(R, c, 'wobble', 0.6); c.vx *= 0.6; c.vy *= 0.6; }
          else startSpin(R, c, 'spin', 1.05);
          p.dead = true; R.emit('hit', c, { item: p.type, x: p.x, y: p.y, by: p.owner }); break;
        }
      }
      if (p.dead) continue;
      for (const o of R.objs) {
        if (o.dead) continue;
        if ((o.x - p.x) ** 2 + (o.y - p.y) ** 2 < (o.r + p.r) ** 2) { o.dead = true; if (p.type === 'pine' || o.type === 'hay') p.dead = true; R.emit('poof', null, { x: o.x, y: o.y, item: o.type }); break; }
      }
    }
    // tractor vs cars
    if (R.tractor) {
      const circ = tractorCircles(R.tractor);
      for (const c of R.cars) {
        if (c.airT > 0.1) continue;
        for (const q of circ) {
          const dx = c.x - q.x, dy = c.y - q.y, d = Math.hypot(dx, dy), m = q.r + 12;
          if (d < m) {
            const nx = dx / (d || 1), ny = dy / (d || 1);
            c.x = q.x + nx * m; c.y = q.y + ny * m;
            const vn = c.vx * nx + c.vy * ny;
            if (vn < 0) { c.vx -= nx * vn * 1.5; c.vy -= ny * vn * 1.5; }
            const tvx = Math.cos(R.tractor.h) * (R.tractor.moving ? 110 : 0), tvy = Math.sin(R.tractor.h) * (R.tractor.moving ? 110 : 0);
            c.vx = c.vx * 0.6 + tvx * 0.5; c.vy = c.vy * 0.6 + tvy * 0.5;
            if (-vn > 80 && c.bumpT <= 0) { c.bumpT = 0.4; R.emit('tractorHit', c, { v: -vn, x: q.x + nx * q.r, y: q.y + ny * q.r }); if (-vn > 170) startSpin(R, c, 'wobble', 0.55); }
          }
        }
      }
    }
    if (R.objs.some((o) => o.dead)) R.objs = R.objs.filter((o) => !o.dead);
    if (R.proj.some((o) => o.dead)) R.proj = R.proj.filter((o) => !o.dead);
  }

  // ------------------------------------------------------------ progress, laps
  function progress(R, c, dt) {
    const T = R.T, L = T.L, k = c.k >= 0 ? c.k : R.nearest(c.x, c.y);
    if (k >= 0) {
      const C = T.C;
      const along = (c.x - C.X[k]) * C.TX[k] + (c.y - C.Y[k]) * C.TY[k];
      let s = C.S[k] + along * (C.KIND[k] < 0 ? 1 : C.SC[k]);
      s = ((s % L) + L) % L;
      let d = s - c.s; if (d > L / 2) d -= L; if (d < -L / 2) d += L;
      if (Math.abs(d) < 300) { c.s = s; c.dist += d; }
    }
    // laps
    const li = Math.floor(c.dist / L);
    if (li > c.lapIdx && !c.finished) {
      const spd = Math.max(30, c.speed);
      const tCross = R.raceT - (c.dist - li * L) / spd;
      if (c.lapIdx >= 0) {
        const lt = tCross - c.lapStart; c.lapTimes.push(lt); c.lapStart = tCross;
        if (li >= R.laps) { c.finished = true; c.finishT = tCross; R.finishedCount++; c.finishPlace = R.finishedCount; R.emit('finish', c, { place: R.finishedCount, time: tCross }); }
        else R.emit('lap', c, { lap: li + 1, time: lt, final: li + 1 === R.laps });
      } else c.lapStart = 0;
      c.lapIdx = li;
    }
    // stuck detection
    if (c.dist > c.progBest + 30) { c.progBest = c.dist; c.progT = 0; } else c.progT += dt;
    if (c.finished) return;
    if (c.auto) {
      if (c.ai.waitT > 0) c.progT = Math.min(c.progT, 1);
      if (c.progT < 0.5) c.ai.unstick = 0;
      if (c.progT > 1.6 && c.ai.reverseT <= 0 && !(c.ai.fwdT > 0) && c.spinT <= 0 && c.speed < 60) {
        // alternate: back up, then try forward on full lock, then back up the other way
        c.ai.unstick = (c.ai.unstick || 0) + 1;
        if (c.ai.unstick % 2) { c.ai.reverseT = 0.9; c.ai.revSteer = -Math.sign(c.ai.lastDiff || 1) * (c.ai.unstick % 4 === 3 ? -1 : 1); }
        else c.ai.fwdT = 0.9;
      }
      if (c.progT > 6) respawn(R, c);
    } else if (c.progT > 5.5) respawn(R, c);
  }

  function rank(R) {
    const arr = R.cars.slice();
    arr.sort((a, b) => {
      if (a.finished && b.finished) return a.finishT - b.finishT;
      if (a.finished) return -1; if (b.finished) return 1;
      return b.dist - a.dist;
    });
    arr.forEach((c, i) => { if (c.place !== i + 1 && R.phase === 'race' && c.isPlayer) R.emit('place', c, { from: c.place, to: i + 1 }); c.place = i + 1; });
    R.order = arr;
  }

  // ------------------------------------------------------------ AI
  function aiThink(R, c, dt) {
    const A = c.ai, sk = A.sk, T = R.T, L = T.L, inp = c.inp;
    inp.analog = true;
    const spd = c.speed;
    // timers
    if (A.mistT > 0) { A.mistT -= dt; if (A.mistT <= 0) A.mistake = ''; }
    else if (!c.finished && R.rand() < sk.mistake * dt) { const r = R.rand(); A.mistake = r < 0.4 ? 'wide' : r < 0.75 ? 'late' : 'dozy'; A.mistT = 0.8 + R.rand() * 0.9; if (A.mistake === 'wide') A.wideOff = (R.rand() < 0.5 ? -1 : 1) * 45; }
    A.thinkT -= dt;

    // reverse out of trouble
    if (A.reverseT > 0) {
      A.reverseT -= dt; inp.brake = true; inp.hold = false; inp.drift = false; inp.steer = A.revSteer || 1; return;
    }
    if (A.fwdT > 0) {
      A.fwdT -= dt; inp.brake = false; inp.hold = false; inp.drift = false;
      const tp = R.lineAt(c.s + 120, 0, 0); inp.steer = clamp(wrapA(Math.atan2(tp.y - c.y, tp.x - c.x) - c.h) * 3, -1, 1); return;
    }

    // rubber band (gentle)
    if (A.thinkT <= 0) {
      A.thinkT = 0.12;
      const ref = R.player || R.cars[0];
      if (ref && ref !== c && !c.finished && !c.isPlayer) {
        const gap = c.dist - ref.dist;
        A.rb = gap > 0 ? 1 - Math.min(0.05, Math.max(0, gap - 150) / 22000) * sk.rbAhead : 1 + Math.min(0.04, Math.max(0, -gap - 150) / 25000) * sk.rbBehind;
      } else A.rb = 1;
      // lane wander
      A.laneT -= 0.12; if (A.laneT <= 0) { A.laneT = 1.5 + R.rand() * 2.5; A.laneGoal = (R.rand() - 0.5) * 50 * (1.2 - sk.line); }
      // defend: the player is right on our bumper -> drift across to cover their line for a moment
      const P = R.player;
      if (P && P !== c && !c.finished && R.phase === 'race' && A.route < 0) {
        const gap = c.dist - P.dist;
        if (gap > 12 && gap < 85 && P.k >= 0 && P.k < T.N) {
          if (!(A.defT > 0) && !(A.defCool > 0) && R.rand() < sk.avoid * 0.35) A.defT = 1.4 + R.rand();
          if (A.defT > 0) {
            const k = P.k, pOff = (P.x - T.X[k]) * -T.TY[k] + (P.y - T.Y[k]) * T.TX[k];
            const ck = T.idx(c.s), lo = T.lineOff[ck] * sk.line;
            A.laneGoal = clamp(pOff - lo, -60, 60) * 0.8; A.laneT = Math.max(A.laneT, 0.3);
          }
        }
      }
      if (A.defT > 0) { A.defT -= 0.12; if (A.defT <= 0) A.defCool = 3 + R.rand() * 3; } else if (A.defCool > 0) A.defCool -= 0.12;
      aiAvoid(R, c);
      aiShortcutDecision(R, c);
      aiItems(R, c);
    }
    A.lane += (A.laneGoal + (A.mistake === 'wide' ? A.wideOff : 0) - A.lane) * Math.min(1, 1.5 * dt);
    A.avoid += (A.avoidGoal - A.avoid) * Math.min(1, 6.5 * dt);

    const look = (60 + spd * 0.36) * A.lookMul * (A.mistake === 'late' ? 0.55 : 1);
    const tp = routeTarget(R, c, look);
    const des = Math.atan2(tp.y - c.y, tp.x - c.x);
    const diff = wrapA(des - c.h);
    A.lastDiff = diff;
    let steer = clamp(diff * 2.7 - c.yaw * 0.12, -1, 1);

    // curvature ahead (main racing line)
    const k0 = T.idx(c.s);
    const nA = Math.ceil((spd * 0.8 + 50) / T.ds);
    let maxK = 0, sgnK = 0;
    if (!A.onSc) for (let j = 3; j <= nA; j += 2) { const kk = T.LK[(k0 + j) % T.N]; if (Math.abs(kk) > maxK) { maxK = Math.abs(kk); sgnK = Math.sign(kk); } }
    const needYaw = spd * maxK;
    const gain = clamp(spd / 95, 0, 1) * (1 - 0.2 * clamp(spd / R.cls.vmax, 0, 1.3));
    const allowed = TURN * gain;

    // heave ahead? (don't drift into it, straighten up)
    let heaveAhead = 1e9;
    for (const hv of T.heaves) { let a = hv.s - c.s; if (a < -L / 2) a += L; if (a > L / 2) a -= L; if (a > -20 && a < heaveAhead) heaveAhead = a; }
    // drifting
    let drift = false;
    if (!A.onSc && R.phase === 'race') {
      if (!c.drifting) {
        if (A.driftCommit === 0 && needYaw > allowed * 0.86 && spd > 175 && heaveAhead > 160) A.driftCommit = R.rand() < sk.drift ? 1 : -1; // decide once per corner
        if (A.driftCommit > 0 && needYaw > allowed * 0.8 && heaveAhead > 160) { drift = true; steer = sgnK * Math.max(0.6, Math.abs(steer)); A.driftHold = 0; }
        if (needYaw < allowed * 0.45) A.driftCommit = 0;
      } else {
        A.driftHold = (A.driftHold || 0) + dt;
        const nNear = Math.ceil((spd * 0.35 + 30) / T.ds);
        let near = 0; for (let j = 2; j <= nNear; j++) near += T.LK[(k0 + j) % T.N];
        near /= Math.max(1, nNear - 1);
        const cont = near * c.driftDir * spd > allowed * 0.3;
        drift = cont || A.driftHold < 0.45;
        if (Math.abs(diff) > 0.9 || heaveAhead < 70) drift = false; // losing it, or a heave: bail
        if (!drift) A.driftCommit = -1; // no re-drift until this corner ends
      }
    }
    if (heaveAhead < 90 && R.rand() < sk.avoid) steer *= 0.35;
    if (c.airT > 0 && R.rand() < 0.5 + sk.avoid * 0.5) steer = 0;
    inp.drift = drift;

    // braking
    let brake = false;
    const allowedMax = c.drifting ? TURN * 1.3 : allowed * (sk.drift > 0.5 ? 1.25 : 1.05);
    if (needYaw > allowedMax * 1.08 && spd > 170) brake = R.rand() < 0.6;
    if (Math.abs(diff) > 0.55 && spd > 190) brake = true;
    if (Math.abs(diff) > 1.6) { brake = false; } // way off: just steer hard at speed
    // tractor
    if (R.tractor) {
      const TT = T.tractor; let ahead = TT.s - c.s; if (ahead < -L / 2) ahead += L; if (ahead > L / 2) ahead -= L;
      if (ahead > 0 && ahead < 140 + spd * 0.9) {
        if (!A.tractorDecided) { A.tractorDecided = true; A.tractorCare = R.rand() < sk.avoid + 0.1; }
        const tr = R.tractor; const cr = T.point(TT.s).cr;
        const eta = ahead / Math.max(60, spd);
        // where will the tractor be when we arrive?
        const tu = tr.u + (tr.moving ? tr.dir * 95 * eta : 0);
        if (A.tractorCare && Math.abs(tu) < cr + 20 && Math.abs(tr.u) < cr + 160 && tr.moving) { brake = true; A.waitT = 0.3; }
      } else A.tractorDecided = false;
    }
    if (A.waitT > 0) A.waitT -= dt;
    inp.hold = brake && A.waitT > 0 && c.vf < 40; // stop and wait, never reverse for the tractor
    inp.brake = brake && R.phase === 'race' && !inp.hold;
    inp.coast = false;
    inp.steer = c.finished && !c.isPlayer ? steer * 0.9 : steer;
    if (A.mistake === 'late') inp.steer *= 0.7;
    if (A.driftCommit < 0 && needYaw < allowed * 0.5) A.driftCommit = 0;
  }

  function routeTarget(R, c, look) {
    const A = c.ai, T = R.T, L = T.L;
    if (A.route >= 0) {
      const o = T.shorts[A.route];
      if (!A.onSc) {
        let rem = o.sA - c.s; if (rem < -L / 2) rem += L; if (rem > L / 2) rem -= L;
        if (rem < -40) { A.route = -1; } // missed it
        else if (rem < 30) { A.onSc = true; A.scj = 0; }
        else if (look < rem) return R.lineAt(c.s + look, A.sk.line * 0.3, A.lane * 0.3);
        else { const j = Math.min(o.M - 1, Math.floor((look - rem) / DRD.SP)); return { x: o.X[j], y: o.Y[j] }; }
      }
      if (A.onSc) {
        // local search for nearest shortcut sample
        let j = A.scj, bd = (c.x - o.X[j]) ** 2 + (c.y - o.Y[j]) ** 2;
        for (let q = Math.max(0, j - 4); q < Math.min(o.M, j + 12); q++) { const d = (c.x - o.X[q]) ** 2 + (c.y - o.Y[q]) ** 2; if (d < bd) { bd = d; j = q; } }
        A.scj = j;
        if (bd > 140 * 140) { A.route = -1; A.onSc = false; }
        else {
          const tj = j + Math.floor(look / DRD.SP);
          if (j >= o.M - 3) { A.route = -1; A.onSc = false; }
          else if (tj < o.M) return { x: o.X[tj], y: o.Y[tj] };
          else return R.lineAt(o.sB + (tj - o.M) * DRD.SP, A.sk.line * 0.5, 0);
        }
      }
    }
    return R.lineAt(c.s + look, A.sk.line, A.lane + A.avoid);
  }

  function aiShortcutDecision(R, c) {
    const A = c.ai, T = R.T, L = T.L;
    if (A.route >= 0 || !T.shorts.length || c.finished && !c.isPlayer) return;
    for (const o of T.shorts) {
      let rem = o.sA - c.s; if (rem < 0) rem += L;
      if (rem > 150 && rem < 650 && A.decidedLap !== c.lapIdx * 10 + o.id) {
        A.decidedLap = c.lapIdx * 10 + o.id;
        let p = A.sk.short;
        if (o.surf === S.MUD) p = (c.item === 'donut' || c.boostT > 0) ? A.sk.short : A.sk.short * 0.15;
        if (o.surf === S.ICE) p *= 0.55;
        if (R.rand() < p) { A.route = o.id; A.onSc = false; A.useDonutAtSc = o.surf === S.MUD && c.item === 'donut'; }
      }
    }
  }

  function aiAvoid(R, c) {
    const A = c.ai, T = R.T;
    if (A.onSc || A.route >= 0) { A.avoidGoal = 0; return; }
    const spd = c.speed, look = 50 + spd * 0.5;
    const base = R.lineAt(c.s + look, A.sk.line, A.lane);
    const careSurf = R.rand() < A.sk.avoid;
    let best = 0, bestP = 1e9;
    for (const cand of [0, -22, 22, -44, 44, -66, 66]) {
      let pen = Math.abs(cand + A.lane) * 0.012 + Math.abs(cand - A.avoidGoal) * 0.004;
      for (const f of [0.12, 0.5, 1]) { // the near sample keeps a car off a patch it is passing alongside
        const p = R.lineAt(c.s + look * f, A.sk.line, A.lane + cand);
        const sf = DRD.surfAt(T, p.x, p.y);
        const mudOk = c.boostT > 0 || c.item === 'donut';
        if (careSurf) pen += sf === S.MUD ? (mudOk ? 0.5 : 3) : sf === S.ICE ? 2 : sf === S.LEAVES ? 0.8 : sf === S.SHOULDER ? 2.5 : sf === S.OUT ? 9 : 0;
        else if (sf === S.MUD && !mudOk) pen += 1.6;
        // ground hazards + cars
        for (const o of R.objs) { const d2 = (o.x - p.x) ** 2 + (o.y - p.y) ** 2; if (d2 < 34 * 34) pen += (A.sk.avoid > 0.5 ? 6 : 2.5); }
        for (const q of R.cars) { if (q === c) continue; const d2 = (q.x - p.x) ** 2 + (q.y - p.y) ** 2; if (d2 < 30 * 30 && q.speed < spd) pen += 1.2; }
      }
      if (R.tractor && R.tractor.onRoad) { const p = R.lineAt(c.s + look, A.sk.line, A.lane + cand); const d2 = (R.tractor.x - p.x) ** 2 + (R.tractor.y - p.y) ** 2; if (d2 < 60 * 60) pen += 4; }
      if (pen < bestP) { bestP = pen; best = cand; }
    }
    A.avoidGoal = best;
    void base;
  }

  function aiItems(R, c) {
    const A = c.ai, sk = A.sk;
    if (!c.item || c.roulette > 0 || R.phase !== 'race' || c.spinT > 0) { A.holdT = 0; return; }
    A.holdT += 0.12;
    const fx = Math.cos(c.h), fy = Math.sin(c.h);
    let use = false;
    const smart = R.rand() < sk.items;
    const it = c.item;
    if (it === 'donut') {
      if (A.useDonutAtSc && A.onSc) use = true;
      else if (!A.useDonutAtSc) {
        // straight road ahead?
        const k0 = R.T.idx(c.s); let mk = 0; for (let j = 4; j < 40; j += 3) mk = Math.max(mk, Math.abs(R.T.LK[(k0 + j) % R.T.N]));
        if ((mk < 0.0025 && A.holdT > 0.6) || A.holdT > 7) use = true;
      }
      if (A.useDonutAtSc && A.holdT > 9) use = true;
    } else if (it === 'syrup' || it === 'hay') {
      for (const q of R.cars) { if (q === c) continue; const dx = q.x - c.x, dy = q.y - c.y; const d = Math.hypot(dx, dy); if (d < 170 && dx * fx + dy * fy < -10) use = smart || R.rand() < 0.3; }
      if (A.holdT > 9) use = true;
    } else if (it === 'pine') {
      for (const q of R.cars) { if (q === c) continue; const dx = q.x - c.x, dy = q.y - c.y; const d = Math.hypot(dx, dy); if (d < 420 && d > 40 && (dx * fx + dy * fy) / d > 0.97) use = smart || R.rand() < 0.25; }
      if (A.holdT > 8) use = true;
    } else if (it === 'snow') {
      for (const q of R.cars) { if (q === c) continue; const ahead = q.dist - c.dist; if (ahead > 60 && ahead < 900) use = smart || R.rand() < 0.3; }
      if (A.holdT > 6) use = true;
    }
    if (use && R.rand() < 0.5 + 0.5 * sk.items) { c.inp.use = true; A.holdT = 0; }
  }

  // ------------------------------------------------------------ headless helpers
  DRD.simRace = function (trackIndex, opts) {
    opts = opts || {};
    const T = DRD.buildTrack((DRD.ALL_DEFS || DRD.TRACK_DEFS)[trackIndex]);
    const R = new Race(T, Object.assign({ cls: 1, seed: 1, player: -1 }, opts));
    let steps = 0;
    while (!R.done && steps < 120 * 700) { R.step(); steps++; R.ev.length = 0; }
    return {
      track: T.name, L: Math.round(T.L), cls: R.cls.name, time: R.raceT,
      cars: R.order.map((c) => ({ name: c.name, rig: c.rig.name, place: c.place, finish: +c.finishT.toFixed(2), est: !!c.estimated, laps: c.lapTimes.map((t) => +t.toFixed(2)), respawns: c.respawns, walls: c.walls, hits: c.hits }))
    };
  };
})(typeof window !== 'undefined' ? window : globalThis);
