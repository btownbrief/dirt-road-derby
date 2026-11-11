/* Dirt Road Derby — track geometry + track definitions. DOM-free (runs in Node for headless sims). */
(function (G) {
  'use strict';
  const DRD = G.DRD || (G.DRD = {});

  const SP = 8;      // centerline sample spacing (world units)
  const CELL = 8;    // surface field cell size

  // surface codes
  const S = { OUT: 0, SHOULDER: 1, ROAD: 2, DIRT: 3, MUD: 4, ICE: 5, LEAVES: 6, HEAVE: 7, BRIDGE: 8 };
  DRD.SURF = S;

  function rng(seed) { let a = seed >>> 0; return function () { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
  DRD.rng = rng;

  // ---------------------------------------------------------------- splines
  function cr(p0, p1, p2, p3, t) {
    const t2 = t * t, t3 = t2 * t;
    return [
      0.5 * (2 * p1[0] + (-p0[0] + p2[0]) * t + (2 * p0[0] - 5 * p1[0] + 4 * p2[0] - p3[0]) * t2 + (-p0[0] + 3 * p1[0] - 3 * p2[0] + p3[0]) * t3),
      0.5 * (2 * p1[1] + (-p0[1] + p2[1]) * t + (2 * p0[1] - 5 * p1[1] + 4 * p2[1] - p3[1]) * t2 + (-p0[1] + 3 * p1[1] - 3 * p2[1] + p3[1]) * t3)
    ];
  }
  function splineDense(pts, closed, per) {
    const out = [], n = pts.length;
    const P = (i) => closed ? pts[(i + n) % n] : pts[Math.max(0, Math.min(n - 1, i))];
    const segs = closed ? n : n - 1;
    for (let i = 0; i < segs; i++) {
      for (let j = 0; j < per; j++) out.push(cr(P(i - 1), P(i), P(i + 1), P(i + 2), j / per));
    }
    if (!closed) out.push(pts[n - 1].slice());
    return out;
  }
  function resample(dense, closed, sp) {
    const m = dense.length, cum = [0];
    const segN = closed ? m : m - 1;
    for (let i = 0; i < segN; i++) { const a = dense[i], b = dense[(i + 1) % m]; cum.push(cum[i] + Math.hypot(b[0] - a[0], b[1] - a[1])); }
    const total = cum[segN];
    const N = Math.max(4, Math.round(total / sp));
    const ds = total / N, out = [];
    let k = 0;
    const count = closed ? N : N + 1;
    for (let i = 0; i < count; i++) {
      const d = Math.min(total, i * ds);
      while (k < segN - 1 && cum[k + 1] < d) k++;
      const a = dense[k], b = dense[(k + 1) % m], f = (d - cum[k]) / Math.max(1e-6, cum[k + 1] - cum[k]);
      out.push([a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f]);
    }
    return { pts: out, total, ds };
  }
  const smooth01 = (t) => t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t);

  // ---------------------------------------------------------------- build
  function build(def) {
    const T = { def, id: def.id, name: def.name, season: def.season };
    const margin = def.margin != null ? def.margin : 46;
    const rs = resample(splineDense(def.pts, true, 30), true, SP);
    const N = rs.pts.length, ds = rs.ds, L = rs.total;
    T.N = N; T.ds = ds; T.L = L;
    const X = new Float32Array(N), Y = new Float32Array(N), TX = new Float32Array(N), TY = new Float32Array(N);
    const HW = new Float32Array(N), CR = new Float32Array(N), K = new Float32Array(N);
    for (let i = 0; i < N; i++) { X[i] = rs.pts[i][0]; Y[i] = rs.pts[i][1]; }
    for (let i = 0; i < N; i++) {
      const a = (i - 1 + N) % N, b = (i + 1) % N;
      let tx = X[b] - X[a], ty = Y[b] - Y[a]; const l = Math.hypot(tx, ty) || 1; TX[i] = tx / l; TY[i] = ty / l;
    }
    for (let i = 0; i < N; i++) {
      const a = (i - 2 + N) % N, b = (i + 2) % N;
      let da = Math.atan2(TY[b], TX[b]) - Math.atan2(TY[a], TX[a]);
      while (da > Math.PI) da -= 2 * Math.PI; while (da < -Math.PI) da += 2 * Math.PI;
      K[i] = da / (4 * ds);
    }
    const hw0 = (def.w || 124) / 2;
    for (let i = 0; i < N; i++) { HW[i] = hw0; CR[i] = hw0 + margin; }
    // bridge: narrow deck, walls right at the deck edge, funnel in/out
    const wrapD = (a, b) => { let d = a - b; while (d > L / 2) d -= L; while (d < -L / 2) d += L; return d; };
    T.wrapD = wrapD;
    T.X = X; T.Y = Y; T.TX = TX; T.TY = TY; T.HW = HW; T.CR = CR; T.K = K;
    T.point = function (s) { // interpolated centerline
      s = ((s % L) + L) % L; const f = s / ds, i = Math.floor(f) % N, j = (i + 1) % N, u = f - Math.floor(f);
      return { x: X[i] + (X[j] - X[i]) * u, y: Y[i] + (Y[j] - Y[i]) * u, tx: TX[i] + (TX[j] - TX[i]) * u, ty: TY[i] + (TY[j] - TY[i]) * u, hw: HW[i], cr: CR[i], i };
    };
    T.idx = (s) => ((Math.floor((((s % L) + L) % L) / ds)) % N + N) % N;
    // s resolver: number = fraction of lap, [ptIndex, offsetUnits] = relative to a control point
    const ptS = def.pts.map((p) => { let b = 1e18, bi = 0; for (let i = 0; i < N; i++) { const d = (X[i] - p[0]) ** 2 + (Y[i] - p[1]) ** 2; if (d < b) { b = d; bi = i; } } return bi * ds; });
    const RS = T.RS = (v) => Array.isArray(v) ? (((ptS[v[0]] + (v[1] || 0)) % L) + L) % L : v * L;
    if (def.bridge) {
      const bs = RS(def.bridge.s), half = def.bridge.len / 2, bhw = def.bridge.w / 2;
      T.bridge = { s: bs, half, hw: bhw };
      for (let i = 0; i < N; i++) {
        const d = Math.abs(wrapD(i * ds, bs));
        const fHW = 1 - smooth01((d - half) / 70), fCR = 1 - smooth01((d - half) / 150);
        HW[i] = hw0 + (bhw - hw0) * fHW;
        CR[i] = Math.max(HW[i], (hw0 + margin) + (bhw - (hw0 + margin)) * fCR);
      }
    }

    // shortcuts
    T.shorts = [];
    (def.shortcuts || []).forEach((sc, si) => {
      const sA = RS(sc.from), sB = RS(sc.to);
      const pA = T.point(sA), pB = T.point(sB);
      const ctrl = [[pA.x - pA.tx * 90, pA.y - pA.ty * 90], [pA.x, pA.y]].concat(sc.via, [[pB.x, pB.y], [pB.x + pB.tx * 90, pB.y + pB.ty * 90]]);
      const dense = splineDense(ctrl, false, 24);
      // trim phantom ends: keep points from pA to pB
      let i0 = 0, i1 = dense.length - 1, b0 = 1e9, b1 = 1e9;
      dense.forEach((p, i) => { const d0 = Math.hypot(p[0] - pA.x, p[1] - pA.y), d1 = Math.hypot(p[0] - pB.x, p[1] - pB.y); if (d0 < b0) { b0 = d0; i0 = i; } if (d1 < b1) { b1 = d1; i1 = i; } });
      const r2 = resample(dense.slice(i0, i1 + 1), false, SP);
      const M = r2.pts.length, span = ((sB - sA) % L + L) % L;
      const o = { id: si, sA, sB, span, len: r2.total, M, surf: sc.surf || S.DIRT, hw: sc.w / 2, cr: sc.w / 2 + (sc.margin != null ? sc.margin : 14),
        X: new Float32Array(M), Y: new Float32Array(M), TX: new Float32Array(M), TY: new Float32Array(M), def: sc };
      for (let j = 0; j < M; j++) { o.X[j] = r2.pts[j][0]; o.Y[j] = r2.pts[j][1]; }
      for (let j = 0; j < M; j++) {
        const a = Math.max(0, j - 1), b = Math.min(M - 1, j + 1); let tx = o.X[b] - o.X[a], ty = o.Y[b] - o.Y[a]; const l = Math.hypot(tx, ty) || 1; o.TX[j] = tx / l; o.TY[j] = ty / l;
      }
      T.shorts.push(o);
    });

    // combined sample arrays (main 0..N-1, then shortcuts)
    let total = N; T.shorts.forEach((o) => { o.base = total; total += o.M; });
    const CX = new Float32Array(total), CY = new Float32Array(total), CTX = new Float32Array(total), CTY = new Float32Array(total);
    const CHW = new Float32Array(total), CCR = new Float32Array(total), CS = new Float32Array(total), CSC = new Float32Array(total), KIND = new Int8Array(total);
    for (let i = 0; i < N; i++) { CX[i] = X[i]; CY[i] = Y[i]; CTX[i] = TX[i]; CTY[i] = TY[i]; CHW[i] = HW[i]; CCR[i] = CR[i]; CS[i] = i * ds; CSC[i] = 1; KIND[i] = -1; }
    T.shorts.forEach((o) => {
      for (let j = 0; j < o.M; j++) {
        const k = o.base + j; CX[k] = o.X[j]; CY[k] = o.Y[j]; CTX[k] = o.TX[j]; CTY[k] = o.TY[j];
        // taper corridor at the ends so the junction blends into the main road
        const e = Math.min(j, o.M - 1 - j) * SP;
        const f = smooth01(e / 60);
        CHW[k] = o.hw; CCR[k] = o.cr;
        CS[k] = (o.sA + (j / (o.M - 1)) * o.span) % L; CSC[k] = o.span / o.len; KIND[k] = o.id;
      }
    });
    T.C = { X: CX, Y: CY, TX: CTX, TY: CTY, HW: CHW, CR: CCR, S: CS, SC: CSC, KIND, n: total };

    // ------------------------------------------------ surface field
    let minX = 1e9, minY = 1e9, maxX = -1e9, maxY = -1e9;
    for (let k = 0; k < total; k++) { minX = Math.min(minX, CX[k]); maxX = Math.max(maxX, CX[k]); minY = Math.min(minY, CY[k]); maxY = Math.max(maxY, CY[k]); }
    const PAD = 420;
    const ox = Math.floor((minX - PAD) / CELL) * CELL, oy = Math.floor((minY - PAD) / CELL) * CELL;
    const fw = Math.ceil((maxX + PAD - ox) / CELL), fh = Math.ceil((maxY + PAD - oy) / CELL);
    T.ox = ox; T.oy = oy; T.fw = fw; T.fh = fh; T.W = fw * CELL; T.H = fh * CELL; T.CELL = CELL;
    const nc = fw * fh;
    const nearB = new Int32Array(nc).fill(-1), bD = new Float32Array(nc).fill(1e9);
    const roadM = new Float32Array(nc).fill(1e9), roadS = new Float32Array(nc).fill(1e9), roadSk = new Int16Array(nc).fill(-1);
    const nearM = new Int32Array(nc).fill(-1), mD = new Float32Array(nc).fill(1e9);
    const conflict = new Uint8Array(nc); let conflicts = 0;
    for (let k = 0; k < total; k++) {
      const r = CCR[k] + CELL * 2, x = CX[k], y = CY[k];
      const c0 = Math.max(0, Math.floor((x - r - ox) / CELL)), c1 = Math.min(fw - 1, Math.floor((x + r - ox) / CELL));
      const r0 = Math.max(0, Math.floor((y - r - oy) / CELL)), r1 = Math.min(fh - 1, Math.floor((y + r - oy) / CELL));
      const isMain = KIND[k] < 0;
      for (let cy = r0; cy <= r1; cy++) {
        const py = oy + (cy + 0.5) * CELL, dy = py - y;
        for (let cx = c0; cx <= c1; cx++) {
          const px = ox + (cx + 0.5) * CELL, dx = px - x, d = Math.sqrt(dx * dx + dy * dy);
          if (d > r) continue;
          const c = cy * fw + cx;
          const b = d - CCR[k];
          if (b < bD[c]) { bD[c] = b; nearB[c] = k; }
          if (isMain) {
            if (d - HW[k] < roadM[c]) roadM[c] = d - HW[k];
            if (d < mD[c]) {
              // conflict detection: two far-apart sections of main road covering the same cell
              if (nearM[c] >= 0 && d < CCR[k]) { let gap = Math.abs(nearM[c] - k); gap = Math.min(gap, N - gap); if (gap * ds > 2 * CCR[k] + 140 && mD[c] < CR[nearM[c]]) { if (!conflict[c]) conflicts++; conflict[c] = 1; } }
              mD[c] = d; nearM[c] = k;
            } else if (d < CCR[k] && nearM[c] >= 0) {
              let gap = Math.abs(nearM[c] - k); gap = Math.min(gap, N - gap); if (gap * ds > 2 * CCR[k] + 140) { if (!conflict[c]) conflicts++; conflict[c] = 1; }
            }
          } else if (d - CHW[k] < roadS[c]) { roadS[c] = d - CHW[k]; roadSk[c] = KIND[k]; }
        }
      }
    }
    const surf = new Uint8Array(nc);
    for (let c = 0; c < nc; c++) {
      if (roadM[c] <= 0) surf[c] = S.ROAD;
      else if (roadS[c] <= 0) surf[c] = T.shorts[roadSk[c]].surf;
      else if (bD[c] <= 0) surf[c] = S.SHOULDER;
      else surf[c] = S.OUT;
    }
    if (T.bridge) { // bridge deck
      for (let c = 0; c < nc; c++) {
        if (surf[c] !== S.ROAD) continue; const k = nearB[c]; if (k < 0 || KIND[k] >= 0) continue;
        if (Math.abs(wrapD(k * ds, T.bridge.s)) <= T.bridge.half) surf[c] = S.BRIDGE;
      }
    }
    T.surf = surf; T.nearB = nearB; T.bD = bD; T.conflicts = conflicts; T.conflict = conflict;

    // zone overlays (ellipses aligned with the road)
    T.zones = [];
    const addZone = (z, p, tx, ty) => {
      const zz = { type: z.type, x: p.x + (-ty) * (z.d || 0), y: p.y + tx * (z.d || 0), a: Math.atan2(ty, tx), rl: (z.len || 120) / 2, rw: (z.wid || 60) / 2, seed: (T.zones.length + 1) * 977 };
      T.zones.push(zz);
      const code = z.type === 'mud' ? S.MUD : z.type === 'ice' ? S.ICE : S.LEAVES;
      const R = Math.max(zz.rl, zz.rw) + CELL, ca = Math.cos(zz.a), sa = Math.sin(zz.a);
      for (let cy = Math.floor((zz.y - R - oy) / CELL); cy <= Math.floor((zz.y + R - oy) / CELL); cy++) {
        for (let cx = Math.floor((zz.x - R - ox) / CELL); cx <= Math.floor((zz.x + R - ox) / CELL); cx++) {
          if (cx < 0 || cy < 0 || cx >= fw || cy >= fh) continue;
          const c = cy * fw + cx; if (surf[c] === S.OUT || surf[c] === S.BRIDGE) continue;
          const px = ox + (cx + 0.5) * CELL - zz.x, py = oy + (cy + 0.5) * CELL - zz.y;
          const u = (px * ca + py * sa) / zz.rl, v = (-px * sa + py * ca) / zz.rw;
          // wobbly edge
          const ang = Math.atan2(v, u), wob = 1 + 0.12 * Math.sin(ang * 3 + zz.seed) + 0.07 * Math.sin(ang * 5 + zz.seed * 0.3);
          if (u * u + v * v <= wob * wob) surf[c] = code;
        }
      }
    };
    (def.zones || []).forEach((z) => {
      if (z.sc != null) {
        const o = T.shorts[z.sc], j = Math.max(0, Math.min(o.M - 1, Math.round(z.t * (o.M - 1))));
        addZone(z, { x: o.X[j], y: o.Y[j] }, o.TX[j], o.TY[j]);
      } else { const p = T.point(RS(z.s)); addZone(z, p, p.tx, p.ty); }
    });
    // frost heaves: bands across the road
    T.heaves = (def.heaves || []).map((hs) => {
      const hsS = RS(hs), p = T.point(hsS), hw = p.hw + 6, ca = p.tx, sa = p.ty;
      for (let cy = Math.floor((p.y - hw - 20 - oy) / CELL); cy <= Math.floor((p.y + hw + 20 - oy) / CELL); cy++) {
        for (let cx = Math.floor((p.x - hw - 20 - ox) / CELL); cx <= Math.floor((p.x + hw + 20 - ox) / CELL); cx++) {
          if (cx < 0 || cy < 0 || cx >= fw || cy >= fh) continue;
          const c = cy * fw + cx; if (surf[c] !== S.ROAD && surf[c] !== S.SHOULDER) continue;
          const px = ox + (cx + 0.5) * CELL - p.x, py = oy + (cy + 0.5) * CELL - p.y;
          const along = px * ca + py * sa, lat = -px * sa + py * ca;
          if (Math.abs(along) <= 9 && Math.abs(lat) <= p.hw) surf[c] = S.HEAVE;
        }
      }
      return { s: hsS, x: p.x, y: p.y, a: Math.atan2(p.ty, p.tx), hw: p.hw };
    });

    // ------------------------------------------------ racing line (elastic band)
    const off = new Float32Array(N);
    const pass = (Kn, iters) => {
      for (let it = 0; it < iters; it++) {
        for (let i = 0; i < N; i++) {
          const a = (i - Kn + N) % N, b = (i + Kn) % N;
          const ax = X[a] - TY[a] * 0 + (-TY[a]) * off[a], ay = Y[a] + TX[a] * off[a];
          const bx = X[b] + (-TY[b]) * off[b], by = Y[b] + TX[b] * off[b];
          const mx = (ax + bx) / 2 - X[i], my = (ay + by) / 2 - Y[i];
          const want = mx * (-TY[i]) + my * TX[i];
          const lim = Math.max(0, HW[i] - 26);
          off[i] = Math.max(-lim, Math.min(lim, off[i] + (want - off[i]) * 0.55));
        }
      }
    };
    pass(14, 60); pass(8, 60); pass(4, 30);
    // keep the line out of mud patches on the main road: pin it to the nearest clear side there, then re-smooth
    {
      const force = new Float32Array(N).fill(NaN);
      const mudAt = (i, o) => { const x = X[i] - TY[i] * o, y = Y[i] + TX[i] * o; const c = cellOf(T, x, y); return c >= 0 && T.surf[c] === S.MUD; };
      for (let i = 0; i < N; i++) {
        if (!mudAt(i, off[i]) && !mudAt(i, off[i] - 12) && !mudAt(i, off[i] + 12)) continue;
        const lim = Math.max(0, HW[i] - 26); let best = null;
        for (let o = -lim; o <= lim; o += 3) if (!mudAt(i, o - 14) && !mudAt(i, o) && !mudAt(i, o + 14) && (best === null || Math.abs(o - off[i]) < Math.abs(best - off[i]))) best = o;
        if (best !== null) for (let j = -6; j <= 6; j++) { const q = (i + j + N) % N; if (isNaN(force[q]) || Math.abs(best) > Math.abs(force[q])) force[q] = best; }
      }
      for (let it = 0; it < 40; it++) { for (let i = 0; i < N; i++) if (!isNaN(force[i])) off[i] = force[i]; pass(4, 1); }
      for (let i = 0; i < N; i++) if (!isNaN(force[i])) off[i] = force[i];
      pass(3, 6);
    }
    T.lineOff = off;
    const LX = new Float32Array(N), LY = new Float32Array(N), LK = new Float32Array(N);
    for (let i = 0; i < N; i++) { LX[i] = X[i] - TY[i] * off[i]; LY[i] = Y[i] + TX[i] * off[i]; }
    for (let i = 0; i < N; i++) {
      const a = (i - 3 + N) % N, b = (i + 3) % N, c0 = (i - 1 + N) % N, c1 = (i + 1) % N;
      const h0 = Math.atan2(LY[i] - LY[a], LX[i] - LX[a]), h1 = Math.atan2(LY[b] - LY[i], LX[b] - LX[i]);
      let d = h1 - h0; while (d > Math.PI) d -= 2 * Math.PI; while (d < -Math.PI) d += 2 * Math.PI;
      const len = Math.hypot(LX[i] - LX[a], LY[i] - LY[a]) + Math.hypot(LX[b] - LX[i], LY[b] - LY[i]);
      LK[i] = d / Math.max(1, len / 2) * 0.5 + 0 * (c0 + c1);
    }
    // smooth curvature
    const LK2 = new Float32Array(N);
    for (let i = 0; i < N; i++) { let s = 0; for (let j = -3; j <= 3; j++) s += LK[(i + j + N) % N]; LK2[i] = s / 7; }
    T.LX = LX; T.LY = LY; T.LK = LK2;

    // ------------------------------------------------ crates, start grid, tractor
    T.crates = [];
    (def.crates || []).forEach((cs) => {
      const p = T.point(RS(cs)), hw = p.hw;
      [-0.62, -0.21, 0.21, 0.62].forEach((f) => T.crates.push({ x: p.x - p.ty * hw * f, y: p.y + p.tx * hw * f }));
    });
    (def.scCrates || []).forEach((c) => { const o = T.shorts[c.sc], j = Math.round(c.t * (o.M - 1)); T.crates.push({ x: o.X[j], y: o.Y[j], bonus: true }); });
    T.grid = [];
    for (let g = 0; g < 6; g++) {
      const row = Math.floor(g / 2), side = g % 2 ? 1 : -1;
      const p = T.point(-46 - row * 52 - (g % 2) * 22);
      T.grid.push({ x: p.x - p.ty * side * 28, y: p.y + p.tx * side * 28, h: Math.atan2(p.ty, p.tx), s: -46 - row * 52 - (g % 2) * 22 });
    }
    if (def.tractor) {
      const p = T.point(RS(def.tractor.s));
      T.tractor = { s: RS(def.tractor.s), x: p.x, y: p.y, nx: -p.ty, ny: p.tx, reach: p.cr + 150, period: def.tractor.period || 11, phase: def.tractor.phase || 0 };
    }

    // ------------------------------------------------ decor (deterministic)
    buildDecor(T);
    return T;
  }

  // field queries
  function cellOf(T, x, y) { const cx = Math.floor((x - T.ox) / CELL), cy = Math.floor((y - T.oy) / CELL); if (cx < 0 || cy < 0 || cx >= T.fw || cy >= T.fh) return -1; return cy * T.fw + cx; }
  DRD.cellOf = cellOf;
  DRD.surfAt = function (T, x, y) { const c = cellOf(T, x, y); return c < 0 ? S.OUT : T.surf[c]; };

  // ---------------------------------------------------------------- decor
  function buildDecor(T) {
    const def = T.def, R = rng(def.seed || 1234), D = [];
    const dec = def.decor || {};
    const keepOut = []; // circles where trees must not grow
    const C = T.C;
    // buildings / props placed relative to the road
    (dec.props || []).forEach((b) => {
      let x, y, a;
      if (b.at) { x = b.at[0]; y = b.at[1]; a = b.rot || 0; }
      else {
        const p = T.point(T.RS(b.s)); const side = b.side || 1, off = p.cr + (b.off || 60);
        x = p.x - p.ty * side * off; y = p.y + p.tx * side * off; a = Math.atan2(p.ty, p.tx) + (b.rot || 0);
      }
      D.push({ k: b.type, x, y, a, sc: b.sc || 1, v: b.v || 0 });
      keepOut.push({ x, y, r: b.clear || 90 });
    });
    if (T.bridge) {
      const p = T.point(T.bridge.s), rv = def.river || { a: 500, b: 500 };
      const nx = -p.ty, ny = p.tx, pts = [];
      for (let t = -rv.b; t <= rv.a; t += 30) {
        const w = Math.sin(t * 0.009 + 1.3) * 60 * Math.min(1, Math.abs(t) / 200) + Math.sin(t * 0.021) * 18 * Math.min(1, Math.abs(t) / 120);
        pts.push([p.x + nx * t + p.tx * w, p.y + ny * t + p.ty * w]);
      }
      T.river = { pts, w: 74, pond: rv.pond ? { x: pts[0][0], y: pts[0][1], r: 120 } : null };
      D.push({ k: 'bridge', x: p.x, y: p.y, a: Math.atan2(p.ty, p.tx), len: T.bridge.half * 2, w: T.bridge.hw * 2 });
      keepOut.push({ x: p.x, y: p.y, r: T.bridge.half + 40 });
      pts.forEach((q) => keepOut.push({ x: q[0], y: q[1], r: 64 }));
      if (T.river.pond) keepOut.push({ x: T.river.pond.x, y: T.river.pond.y, r: 170 });
    }
    // special props that spawn groups
    D.slice().forEach((d) => {
      const ca = Math.cos(d.a), sa = Math.sin(d.a);
      if (d.k === 'orchard') {
        for (let i = -3; i <= 3; i++) for (let j = 0; j < 3; j++) {
          const u = i * 58, v = 30 + j * 58; const side = 1;
          D.push({ k: 'tree', v: 'apple', x: d.x + ca * u - sa * v * side, y: d.y + sa * u + ca * v * side, r: 22 + R() * 5, a: R() * 6.28, seed: Math.floor(R() * 1e6) });
        }
        keepOut.push({ x: d.x - sa * 90, y: d.y + ca * 90, r: 230 });
      } else if (d.k === 'cows') {
        for (let i = 0; i < 4; i++) D.push({ k: 'cow', x: d.x + (R() - 0.5) * 160, y: d.y + (R() - 0.5) * 120, a: R() * 6.28, v: Math.floor(R() * 3) });
        keepOut.push({ x: d.x, y: d.y, r: 140 });
      } else if (d.k === 'pumpkins') {
        for (let i = 0; i < 14; i++) D.push({ k: 'pumpkin', x: d.x + (R() - 0.5) * 170, y: d.y + (R() - 0.5) * 110, a: R() * 6.28, r: 6 + R() * 5 });
      }
    });
    // shortcut specials
    T.shorts.forEach((o) => {
      const j = Math.floor(o.M / 2);
      if (o.def.barn) { D.push({ k: 'barnroof', x: o.X[j], y: o.Y[j], a: Math.atan2(o.TY[j], o.TX[j]), len: 190, w: o.hw * 2 + 40, sc: o.id }); keepOut.push({ x: o.X[j], y: o.Y[j], r: 150 }); }
      if (o.def.pond) { keepOut.push({ x: o.X[j], y: o.Y[j], r: 200 }); }
      for (let q = 0; q < o.M; q += 6) keepOut.push({ x: o.X[q], y: o.Y[q], r: o.cr + 20 });
    });
    if (T.tractor) {
      const tr = T.tractor;
      for (let t = -tr.reach - 100; t <= tr.reach + 100; t += 30) keepOut.push({ x: tr.x + tr.nx * t, y: tr.y + tr.ny * t, r: 52 });
      [-1, 1].forEach((sd) => { const p = T.point(tr.s - 260); D.push({ k: 'sign', v: 'tractor', x: p.x - p.ty * sd * (p.cr + 8), y: p.y + p.tx * sd * (p.cr + 8), a: Math.atan2(p.ty, p.tx) }); });
    }
    // chevron boards on the outside of tight corners, so a small screen shows the turn before you're in it
    {
      const TX = T.TX, TY = T.TY, ds = T.ds, look = 6, thr = 1 / 200; let run = null; const runs = [];
      for (let i = 0; i <= T.N; i++) {
        const a = i % T.N, b = (i + look) % T.N;
        const cr = (TX[a] * TY[b] - TY[a] * TX[b]) / (look * ds);
        if (Math.abs(cr) > thr && i < T.N) { if (!run || Math.sign(cr) !== run.sg) { if (run) runs.push(run); run = { i0: i, i1: i, sg: Math.sign(cr) }; } else run.i1 = i; }
        else if (run) { runs.push(run); run = null; }
      }
      runs.forEach((r) => {
        const len = (r.i1 - r.i0 + look) * ds; if (len < 60) return;
        const n = Math.min(4, Math.max(2, Math.round(len / 90)));
        for (let q = 0; q < n; q++) {
          const sAt = (r.i0 + look / 2) * ds + (q + 0.5) * len / n;
          const p = T.point(sAt), off = -r.sg * (p.cr + 10);
          const x = p.x - p.ty * off, y = p.y + p.tx * off;
          if (DRD.surfAt(T, x, y) !== S.OUT) continue;
          D.push({ k: 'sign', v: r.sg > 0 ? 'chevR' : 'chevL', x, y, a: Math.atan2(p.ty, p.tx) });
        }
      });
    }
    T.heaves.forEach((h) => { const p = T.point(h.s - 230); D.push({ k: 'sign', v: 'heave', x: p.x - p.ty * (p.cr + 8), y: p.y + p.tx * (p.cr + 8), a: Math.atan2(p.ty, p.tx) }); });
    // trees in the band outside the corridors
    const kinds = dec.trees || ['maple'];
    const area = T.W * T.H, count = Math.round(area / 4200 * (dec.density || 1));
    for (let i = 0; i < count; i++) {
      const x = T.ox + R() * T.W, y = T.oy + R() * T.H;
      const c = cellOf(T, x, y); if (c < 0) continue;
      if (T.surf[c] !== S.OUT) continue;
      const b = T.bD[c];
      if (b < 22 || (b > 330 && T.nearB[c] >= 0)) continue;
      if (T.nearB[c] < 0 && R() < 0.75) continue;
      let bad = false; for (const k of keepOut) if ((x - k.x) ** 2 + (y - k.y) ** 2 < k.r * k.r) { bad = true; break; } if (bad) continue;
      const kind = kinds[Math.floor(R() * kinds.length)];
      const r = (kind === 'pine' ? 26 : 30) + R() * 22 + Math.min(18, b * 0.05);
      D.push({ k: 'tree', v: kind, x, y, r, a: R() * Math.PI * 2, seed: Math.floor(R() * 1e6) });
    }
    // sort big trees after small ones so canopies overlap nicely
    D.sort((a, b) => (a.k === 'tree' ? 1 : 0) - (b.k === 'tree' ? 1 : 0) || (a.r || 0) - (b.r || 0));
    T.decor = D;
    // spatial buckets for culling
    const B = 320, bw = Math.ceil(T.W / B) + 1, bh = Math.ceil(T.H / B) + 1, buckets = [];
    for (let i = 0; i < bw * bh; i++) buckets.push([]);
    D.forEach((d, i) => { const bx = Math.max(0, Math.min(bw - 1, Math.floor((d.x - T.ox) / B))), by = Math.max(0, Math.min(bh - 1, Math.floor((d.y - T.oy) / B))); buckets[by * bw + bx].push(i); });
    T.dB = { B, bw, bh, buckets };
  }

  // ---------------------------------------------------------------- defs
  // Coordinates are world units; race direction follows point order.
  DRD.TRACK_DEFS = [
    {
      id: 'sugarbush', name: 'Sugarbush Sludge', season: 'spring', seed: 11,
      blurb: 'Mud season back roads. Slick ruts, frost heaves and a tractor that will not wait.',
      pts: [[700, 1900], [1250, 1950], [1800, 1900], [2250, 1740], [2420, 1400], [2380, 1020], [2190, 790], [2320, 540], [2160, 250], [1820, 190], [1560, 380], [1500, 720], [1300, 930], [1060, 800], [1000, 460], [800, 260], [470, 300], [270, 600], [360, 950], [560, 1220], [400, 1560]],
      w: 124,
      shortcuts: [{ from: [9, 40], to: [15, -40], via: [[1500, 130], [1150, 140]], w: 64, surf: 4 }],
      zones: [
        { type: 'mud', s: [1, 0], d: -30, len: 150, wid: 56 }, { type: 'mud', s: [2, 120], d: 34, len: 110, wid: 50 },
        { type: 'mud', s: [12, 0], d: 0, len: 170, wid: 70 }, { type: 'mud', s: [18, 60], d: 30, len: 120, wid: 60 },
        { type: 'mud', s: [19, 120], d: -28, len: 110, wid: 54 }
      ],
      heaves: [[4, -60], [5, 40]],
      tractor: { s: [17, 80], period: 10 },
      crates: [[2, 0], [10, 140], [17, -100]],
      scCrates: [{ sc: 0, t: 0.5 }],
      decor: { trees: ['maple', 'maple', 'maple', 'birch', 'pine'], density: 1.1,
        props: [{ type: 'shack', s: [12, 0], side: -1, off: 110 }, { type: 'farmhouse', s: [1, 0], side: 1, off: 120 }, { type: 'barn', s: [2, 100], side: 1, off: 140 },
          { type: 'woodpile', s: [9, 0], side: -1, off: 60 }, { type: 'silo', s: [3, 0], side: 1, off: 110 }] }
    },
    {
      id: 'foliage', name: 'Foliage Fling', season: 'autumn', seed: 22,
      blurb: 'Peak color. Leaf piles hide the road edge and the covered bridge is one car wide... almost.',
      pts: [[500, 1700], [1000, 1820], [1600, 1800], [2100, 1700], [2400, 1450], [2420, 1080], [2150, 880], [1800, 960], [1550, 1180], [1250, 1150], [1150, 850], [1350, 560], [1750, 450], [2100, 330], [2050, 110], [1600, 80], [1050, 140], [650, 280], [380, 560], [300, 950], [350, 1350]],
      w: 126,
      bridge: { s: [19, 0], len: 230, w: 82 }, river: { a: 520, b: 420 },
      shortcuts: [{ from: [7, 30], to: [10, 40], via: [[1480, 900]], w: 62, surf: 3 }],
      zones: [
        { type: 'leaves', s: [2, 0], d: 52, len: 260, wid: 60 }, { type: 'leaves', s: [5, 0], d: 50, len: 220, wid: 60 },
        { type: 'leaves', s: [12, 0], d: -50, len: 240, wid: 60 }, { type: 'leaves', s: [16, 0], d: 48, len: 260, wid: 64 },
        { type: 'leaves', s: [9, 0], d: 0, len: 90, wid: 70 }, { type: 'leaves', s: [17, 100], d: -10, len: 80, wid: 60 },
        { type: 'mud', s: [14, 0], d: 0, len: 90, wid: 60 }
      ],
      heaves: [[3, 0]],
      crates: [[1, 0], [11, 0], [16, 100]],
      scCrates: [{ sc: 0, t: 0.5 }],
      edgeLeaves: true,
      decor: { trees: ['maple', 'maple', 'oak', 'birch', 'pine'], density: 1.15,
        props: [{ type: 'barn', s: [4, 0], side: -1, off: 150 }, { type: 'orchard', s: [8, 0], side: 1, off: 40 }, { type: 'church', s: [16, 0], side: -1, off: 140 },
          { type: 'farmhouse', s: [12, 0], side: 1, off: 110 }, { type: 'pumpkins', s: [1, 100], side: 1, off: 50 }] }
    },
    {
      id: 'notch', name: 'Snowbank Notch', season: 'winter', seed: 33,
      blurb: 'Plowed-in mountain road. Ice patches, big heaves, and a frozen pond if you are brave.',
      pts: [[600, 1850], [1200, 1900], [1800, 1820], [2200, 1600], [2300, 1250], [2050, 1050], [1650, 1100], [1300, 1000], [1250, 700], [1550, 550], [2000, 520], [2300, 350], [2200, 120], [1700, 80], [1200, 150], [800, 120], [450, 280], [300, 650], [420, 1000], [300, 1350], [380, 1650]],
      w: 122,
      bridge: { s: [1, 0], len: 220, w: 80 }, river: { a: 380, b: 520 },
      shortcuts: [{ from: [6, 40], to: [9, 70], via: [[1530, 900], [1560, 720]], w: 84, surf: 5, pond: true }],
      zones: [
        { type: 'ice', s: [3, 0], d: 20, len: 200, wid: 70 }, { type: 'ice', s: [8, 0], d: -10, len: 160, wid: 80 },
        { type: 'ice', s: [13, 0], d: 0, len: 220, wid: 70 }, { type: 'ice', s: [18, 0], d: 24, len: 150, wid: 60 }
      ],
      heaves: [[4, 0], [11, 100], [15, 0], [17, 0]],
      crates: [[2, 0], [9, 0], [16, 0]],
      decor: { trees: ['spruce', 'spruce', 'pine', 'bare', 'birch'], density: 1.2,
        props: [{ type: 'cabin', s: [14, 0], side: 1, off: 70 }, { type: 'plowshed', s: [2, 0], side: 1, off: 110 }, { type: 'cabin', s: [7, 0], side: -1, off: 80 }] }
    },
    {
      id: 'milkrun', name: 'Midnight Milk Run', season: 'night', seed: 44,
      blurb: 'Lights on. Dairy farm roads after dark, a drive-through barn and a tractor working late.',
      pts: [[650, 1800], [1250, 1880], [1850, 1800], [2250, 1550], [2300, 1150], [2000, 950], [2150, 650], [2300, 350], [2050, 130], [1600, 160], [1350, 450], [1050, 560], [700, 380], [400, 330], [250, 650], [450, 950], [750, 1100], [650, 1400], [400, 1600]],
      w: 124,
      bridge: { s: [9, 0], len: 220, w: 82 }, river: { a: 520, b: 200, pond: true },
      shortcuts: [{ from: [4, 30], to: [7, -20], via: [[2440, 760]], w: 60, surf: 3, barn: true }],
      zones: [{ type: 'mud', s: [12, 0], d: 0, len: 120, wid: 60 }, { type: 'mud', s: [16, 0], d: -30, len: 120, wid: 56 }],
      heaves: [[2, 40], [13, 60]],
      tractor: { s: [14, 0], period: 9 },
      crates: [[1, 0], [10, 60], [15, 60]],
      scCrates: [{ sc: 0, t: 0.5 }],
      decor: { trees: ['maple', 'pine', 'spruce', 'oak'], density: 1.0,
        props: [{ type: 'farmhouse', s: [1, 0], side: 1, off: 120 }, { type: 'silo', s: [5, 0], side: -1, off: 90 }, { type: 'cows', s: [11, 0], side: -1, off: 80 },
          { type: 'lamp', s: [0, 0], side: 1, off: 16 }, { type: 'lamp', s: [5, 0], side: 1, off: 16 }, { type: 'lamp', s: [12, 0], side: 1, off: 16 }, { type: 'lamp', s: [16, 0], side: -1, off: 16 },
          { type: 'barn', s: [3, 0], side: -1, off: 160 }, { type: 'cows', s: [17, 0], side: 1, off: 70 }] }
    }
  ];

  // Mirror roads: every track flipped left-to-right (unlockable, and sometimes the Daily Derby).
  // Everything placed by distance-along-the-road stays put; anything placed to a side swaps sides.
  function mirrorDef(def) {
    const W = 2800, m = (p) => [W - p[0], p[1]];
    const d = JSON.parse(JSON.stringify(def));
    d.id = def.id + '_m'; d.name = def.name + ' (Mirror)'; d.mirror = true; d.base = def.id; d.seed = def.seed + 500;
    d.pts = def.pts.map(m);
    d.shortcuts = (d.shortcuts || []).map((sc) => Object.assign(sc, { via: sc.via.map(m) }));
    d.zones = (d.zones || []).map((z) => Object.assign(z, { d: -(z.d || 0) }));
    if (def.river) d.river = Object.assign({}, def.river, { a: def.river.b, b: def.river.a });
    if (d.decor && d.decor.props) d.decor.props.forEach((b) => { if (b.at) b.at = m(b.at); else b.side = -(b.side || 1); });
    d.blurb = 'Mirror road: ' + def.blurb.charAt(0).toLowerCase() + def.blurb.slice(1);
    return d;
  }
  DRD.MIRROR_DEFS = DRD.TRACK_DEFS.map(mirrorDef);
  DRD.ALL_DEFS = DRD.TRACK_DEFS.concat(DRD.MIRROR_DEFS);

  DRD.buildTrack = build;
  DRD.SP = SP; DRD.CELL = CELL;
})(typeof window !== 'undefined' ? window : globalThis);
