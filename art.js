/* Dirt Road Derby — code-drawn art: ground pre-render (tiles), cars, trees, buildings, items.
   Every sprite lives in ART.ASSETS under a key; painted PNGs can replace them later (index.html?art=1). */
(function () {
  'use strict';
  const DRD = window.DRD;
  const S = DRD.SURF;
  const ART = (DRD.ART = {});
  const TAU = Math.PI * 2;

  function mk(w, h) { const c = document.createElement('canvas'); c.width = Math.max(1, Math.ceil(w)); c.height = Math.max(1, Math.ceil(h)); return c; }
  ART.mk = mk;
  function rr(g, x, y, w, h, r) { r = Math.min(r, w / 2, h / 2); g.beginPath(); g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r); g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath(); }
  ART.rr = rr;
  const rng = DRD.rng;

  // ------------------------------------------------------------ palettes
  const PAL = {
    spring: { floor: '#3c5529', floorDots: ['#344b23', '#486532', '#57703a', '#5b4a30'], grass: '#6b8a3b', grassDots: ['#5f7d33', '#7c9a47', '#87a34f', '#6f6a3c'], road: '#9a7550', road2: '#8a6644', rut: 'rgba(80,55,32,.45)', crown: 'rgba(200,165,120,.35)', speck: ['#c4a57c', '#7a5a3a', '#b39270', '#6a4c30'], mud: '#4c3420', mud2: '#62442a', mudHi: 'rgba(255,240,210,.18)', wall: '#8f8c82', wallHi: '#b9b6ab', wallLo: '#5d5a52', water: '#3f7f9c', water2: '#6fb0c8' },
    autumn: { floor: '#4b4523', floorDots: ['#5b4a22', '#3e3c1f', '#7a4a1c', '#8c5a1e', '#a0621f'], grass: '#7a8a3a', grassDots: ['#6c7c32', '#8e9a46', '#a09a40', '#8a6a2a'], road: '#a7865c', road2: '#957450', rut: 'rgba(90,62,36,.42)', crown: 'rgba(214,180,130,.35)', speck: ['#cdb089', '#80603e', '#b89670', '#d9531e', '#e8862a'], mud: '#523822', mud2: '#684a2c', mudHi: 'rgba(255,240,210,.16)', wall: '#8f8a7e', wallHi: '#bdb7a8', wallLo: '#5e594f', water: '#3c7591', water2: '#76aec2', leaves: ['#d9531e', '#e8862a', '#f2b632', '#b8321f', '#c4661c', '#9a2a18'] },
    winter: { floor: '#e7edf3', floorDots: ['#d9e2ec', '#f4f7fa', '#cfdae6'], grass: '#f1f5f9', grassDots: ['#e3eaf1', '#ffffff', '#d7e1eb'], road: '#cbc3b7', road2: '#b3aa9c', rut: 'rgba(120,104,88,.42)', crown: 'rgba(255,255,255,.4)', speck: ['#a89b8a', '#8a7d6c', '#f6f6f2', '#b8ae9f'], mud: '#8a7b68', mud2: '#9d8f7b', mudHi: 'rgba(255,255,255,.2)', wall: '#ffffff', wallHi: '#ffffff', wallLo: '#b4c7dc', water: '#5a8fb0', water2: '#a7d0e4', ice: '#c4e6f6' },
    night: { floor: '#34502b', floorDots: ['#2c4524', '#3f5d33', '#476638'], grass: '#55773b', grassDots: ['#4a6a33', '#628446', '#6b8b4b'], road: '#957452', road2: '#846446', rut: 'rgba(70,50,30,.45)', crown: 'rgba(200,170,130,.3)', speck: ['#b89a74', '#6e5136', '#a68867'], mud: '#4a3320', mud2: '#5e4229', mudHi: 'rgba(255,240,210,.16)', wall: '#7a5a3a', wallHi: '#a07a52', wallLo: '#4a3420', water: '#2f6a86', water2: '#5f9bb4' }
  };
  ART.PAL = PAL;

  // ------------------------------------------------------------ noise patterns
  const patCache = {};
  function noisePat(key, base, dots, seed, n) {
    const k = key; if (patCache[k]) return patCache[k];
    const c = mk(256, 256), g = c.getContext('2d'), R = rng(seed);
    g.fillStyle = base; g.fillRect(0, 0, 256, 256);
    for (let i = 0; i < n; i++) {
      const x = R() * 256, y = R() * 256, r = 1 + R() * 3.2;
      g.fillStyle = dots[Math.floor(R() * dots.length)]; g.globalAlpha = 0.35 + R() * 0.5;
      for (const ox of [-256, 0, 256]) for (const oy of [-256, 0, 256]) {
        if (x + ox < -6 || x + ox > 262 || y + oy < -6 || y + oy > 262) continue;
        g.beginPath(); g.ellipse(x + ox, y + oy, r, r * (0.5 + R() * 0.6), R() * 3, 0, TAU); g.fill();
      }
    }
    g.globalAlpha = 1;
    patCache[k] = c; return c;
  }
  ART.floorPattern = function (g, season) {
    const P = PAL[season];
    const c = noisePat('floor_' + season, P.floor, P.floorDots, 91, 2600);
    return g.createPattern(c, 'repeat');
  };

  // ------------------------------------------------------------ ground (pre-rendered tiles)
  const TILE = 512; // texture pixels per tile
  const pool = [];
  ART.release = function (c) { if (pool.length < 70) pool.push(c); else { c.width = 0; c.height = 0; } };
  ART.buildGround = function (T) {
    const season = T.season, P = PAL[season];
    const tex = Math.min(1.4, Math.max(0.9, Math.sqrt(10.5e6 / (T.W * T.H)) * 1.25));
    const tw = TILE / tex; // world units per tile
    const nx = Math.ceil(T.W / tw), ny = Math.ceil(T.H / tw);
    const G = { tex, tw, nx, ny, tiles: new Array(nx * ny).fill(null), T };
    // which tiles contain anything but forest floor
    const need = new Uint8Array(nx * ny);
    const mark = (x, y, r) => {
      const x0 = Math.floor((x - r - T.ox) / tw), x1 = Math.floor((x + r - T.ox) / tw), y0 = Math.floor((y - r - T.oy) / tw), y1 = Math.floor((y + r - T.oy) / tw);
      for (let a = Math.max(0, y0); a <= Math.min(ny - 1, y1); a++) for (let b = Math.max(0, x0); b <= Math.min(nx - 1, x1); b++) need[a * nx + b] = 1;
    };
    const C = T.C;
    for (let k = 0; k < C.n; k += 2) mark(C.X[k], C.Y[k], C.CR[k] + 40);
    if (T.river) { T.river.pts.forEach((p) => mark(p[0], p[1], 80)); if (T.river.pond) mark(T.river.pond.x, T.river.pond.y, 160); }
    if (T.tractor) { const tr = T.tractor; for (let t = -tr.reach - 120; t <= tr.reach + 120; t += 20) mark(tr.x + tr.nx * t, tr.y + tr.ny * t, 40); }
    // global feature lists (same random layout in every tile)
    const feat = prepFeatures(T, P);
    for (let a = 0; a < ny; a++) for (let b = 0; b < nx; b++) {
      if (!need[a * nx + b]) continue;
      const c = pool.pop() || mk(TILE, TILE), g = c.getContext('2d');
      g.setTransform(1, 0, 0, 1, 0, 0); g.clearRect(0, 0, TILE, TILE);
      const wx = T.ox + b * tw, wy = T.oy + a * tw;
      g.setTransform(tex, 0, 0, tex, -wx * tex, -wy * tex);
      drawGround(g, T, P, feat, { x0: wx - 4, y0: wy - 4, x1: wx + tw + 4, y1: wy + tw + 4 });
      G.tiles[a * nx + b] = { c, g, x: wx, y: wy };
    }
    G.floor = noisePat('floor_' + season, P.floor, P.floorDots, 91, 2600);
    G.count = G.tiles.filter(Boolean).length;
    return G;
  };
  // stamp a decal (skid mark) into the ground
  ART.decal = function (G, x0, y0, x1, y1, w, color) {
    const T = G.T, tw = G.tw;
    const bx0 = Math.floor((Math.min(x0, x1) - w - T.ox) / tw), bx1 = Math.floor((Math.max(x0, x1) + w - T.ox) / tw);
    const by0 = Math.floor((Math.min(y0, y1) - w - T.oy) / tw), by1 = Math.floor((Math.max(y0, y1) + w - T.oy) / tw);
    for (let a = by0; a <= by1; a++) for (let b = bx0; b <= bx1; b++) {
      if (a < 0 || b < 0 || a >= G.ny || b >= G.nx) continue;
      const t = G.tiles[a * G.nx + b]; if (!t) continue;
      const g = t.g; g.strokeStyle = color; g.lineWidth = w; g.lineCap = 'round';
      g.beginPath(); g.moveTo(x0, y0); g.lineTo(x1, y1); g.stroke();
    }
  };

  function prepFeatures(T, P) {
    const R = rng(T.def.seed * 7 + 3);
    const C = T.C, F = { specks: [], tufts: [], stones: [], leaves: [], puddles: [] };
    // speckles + gravel on roads
    for (let k = 0; k < C.n; k++) {
      const hw = C.HW[k], n = 5;
      for (let i = 0; i < n; i++) {
        const d = (R() * 2 - 1) * hw, a = (R() - 0.5) * 8;
        F.specks.push({ x: C.X[k] - C.TY[k] * d + C.TX[k] * a, y: C.Y[k] + C.TX[k] * d + C.TY[k] * a, r: 0.6 + R() * 1.6, c: P.speck[Math.floor(R() * P.speck.length)] });
      }
      // grass tufts along the road edge
      if (k % 2 === 0) for (const sd of [-1, 1]) {
        const d = sd * (hw + 2 + R() * 10);
        F.tufts.push({ x: C.X[k] - C.TY[k] * d, y: C.Y[k] + C.TX[k] * d, r: 2 + R() * 3, c: P.grassDots[Math.floor(R() * P.grassDots.length)] });
      }
      // wall stones along the corridor edge (skip where another corridor joins)
      if (k % 2 === 0) for (const sd of [-1, 1]) {
        const d = sd * (C.CR[k] + 5);
        const x = C.X[k] - C.TY[k] * d, y = C.Y[k] + C.TX[k] * d;
        const probe = DRD.surfAt(T, C.X[k] - C.TY[k] * sd * (C.CR[k] + 14), C.Y[k] + C.TX[k] * sd * (C.CR[k] + 14));
        if (probe !== S.OUT) continue;
        F.stones.push({ x, y, r: 4.5 + R() * 3.5, a: Math.atan2(C.TY[k], C.TX[k]), sd, tone: R() });
      }
    }
    if (T.season === 'autumn') {
      for (let k = 0; k < T.N; k++) {
        for (const sd of [-1, 1]) for (let i = 0; i < 9; i++) {
          const d = sd * (T.HW[k] + (R() * 2 - 1) * (R() < 0.5 ? 14 : 34));
          F.leaves.push({ x: T.X[k] - T.TY[k] * d + T.TX[k] * (R() - 0.5) * 8, y: T.Y[k] + T.TX[k] * d + T.TY[k] * (R() - 0.5) * 8, r: 2.2 + R() * 2.6, a: R() * TAU, c: P.leaves[Math.floor(R() * P.leaves.length)] });
        }
        if (R() < 0.3) { const d = (R() * 2 - 1) * T.HW[k]; F.leaves.push({ x: T.X[k] - T.TY[k] * d, y: T.Y[k] + T.TX[k] * d, r: 2 + R() * 2, a: R() * TAU, c: P.leaves[Math.floor(R() * P.leaves.length)] }); }
      }
    }
    if (T.season === 'spring' || T.season === 'night') {
      for (let i = 0; i < 26; i++) { const s = R() * T.L, p = T.point(s), d = (R() * 2 - 1) * p.hw * 0.7; F.puddles.push({ x: p.x - p.ty * d, y: p.y + p.tx * d, r: 6 + R() * 9, a: Math.atan2(p.ty, p.tx) }); }
    }
    return F;
  }

  function vis(rc, x, y, r) { return x + r > rc.x0 && x - r < rc.x1 && y + r > rc.y0 && y - r < rc.y1; }

  function strokeVar(g, X, Y, W, n, closed, rc, color, mul, add) {
    g.strokeStyle = color; g.lineCap = 'round'; g.lineJoin = 'round';
    const last = closed ? n : n - 1;
    for (let i = 0; i < last; i++) {
      const j = (i + 1) % n, w = W[i] * mul + add;
      if (!vis(rc, X[i], Y[i], w + 10)) continue;
      g.lineWidth = w; g.beginPath(); g.moveTo(X[i], Y[i]); g.lineTo(X[j], Y[j]); g.stroke();
    }
  }
  function strokeOff(g, X, Y, TXa, TYa, off, n, closed, rc, color, w) { // offset polyline
    g.strokeStyle = color; g.lineWidth = w; g.lineCap = 'round'; g.beginPath();
    let pen = false;
    const last = closed ? n + 1 : n;
    for (let q = 0; q < last; q++) {
      const i = q % n, o = typeof off === 'function' ? off(i) : off;
      const x = X[i] - TYa[i] * o, y = Y[i] + TXa[i] * o;
      if (!vis(rc, x, y, 40)) { pen = false; continue; }
      if (!pen) { g.moveTo(x, y); pen = true; } else g.lineTo(x, y);
    }
    g.stroke();
  }

  function drawGround(g, T, P, F, rc) {
    const season = T.season;
    // forest floor
    const pat = g.createPattern(noisePat('floor_' + season, P.floor, P.floorDots, 91, 2600), 'repeat');
    g.fillStyle = pat; g.fillRect(rc.x0, rc.y0, rc.x1 - rc.x0, rc.y1 - rc.y0);
    // farm lane for the tractor
    if (T.tractor) {
      const tr = T.tractor, ex = tr.reach + 140;
      g.lineCap = 'butt';
      g.strokeStyle = P.road2; g.lineWidth = 50; g.beginPath(); g.moveTo(tr.x - tr.nx * ex, tr.y - tr.ny * ex); g.lineTo(tr.x + tr.nx * ex, tr.y + tr.ny * ex); g.stroke();
      g.strokeStyle = P.rut; g.lineWidth = 7;
      for (const o of [-11, 11]) { g.beginPath(); g.moveTo(tr.x - tr.nx * ex - tr.ny * o, tr.y - tr.ny * ex + tr.nx * o); g.lineTo(tr.x + tr.nx * ex - tr.ny * o, tr.y + tr.ny * ex + tr.nx * o); g.stroke(); }
    }
    // river + pond
    if (T.river) {
      const pts = T.river.pts;
      const line = (w, c) => { g.strokeStyle = c; g.lineWidth = w; g.lineCap = 'round'; g.lineJoin = 'round'; g.beginPath(); pts.forEach((p, i) => i ? g.lineTo(p[0], p[1]) : g.moveTo(p[0], p[1])); g.stroke(); };
      line(T.river.w + 26, season === 'winter' ? '#c9d6e2' : '#5a4a32');
      line(T.river.w, season === 'winter' ? '#a9cde3' : P.water);
      line(T.river.w * 0.45, season === 'winter' ? '#cfe6f3' : P.water2);
      if (T.river.pond) { const q = T.river.pond; g.fillStyle = '#5a4a32'; g.beginPath(); g.ellipse(q.x, q.y, q.r + 14, q.r * 0.75 + 14, 0.4, 0, TAU); g.fill(); g.fillStyle = P.water; g.beginPath(); g.ellipse(q.x, q.y, q.r, q.r * 0.75, 0.4, 0, TAU); g.fill(); g.fillStyle = P.water2; g.globalAlpha = 0.5; g.beginPath(); g.ellipse(q.x - 20, q.y - 14, q.r * 0.5, q.r * 0.3, 0.4, 0, TAU); g.fill(); g.globalAlpha = 1; }
    }
    // shoulders (grass/snow) — main + shortcuts
    const Gp = g.createPattern(noisePat('grass_' + season, P.grass, P.grassDots, 17, 2200), 'repeat');
    strokeVar(g, T.X, T.Y, T.CR, T.N, true, rc, Gp, 2, 0);
    T.shorts.forEach((o) => { const W = new Float32Array(o.M).fill(o.cr); strokeVar(g, o.X, o.Y, W, o.M, false, rc, Gp, 2, 0); });
    // shortcut roads
    T.shorts.forEach((o) => {
      const W = new Float32Array(o.M).fill(o.hw);
      const col = o.surf === S.MUD ? P.mud : o.surf === S.ICE ? (P.ice || '#bfe0f0') : P.road2;
      if (o.def.pond) { strokeVar(g, o.X, o.Y, new Float32Array(o.M).fill(o.cr), o.M, false, rc, '#b6d9ec', 2, -10); }
      strokeVar(g, o.X, o.Y, W, o.M, false, rc, col, 2, 0);
      if (o.surf === S.MUD) {
        strokeOff(g, o.X, o.Y, o.TX, o.TY, -o.hw * 0.4, o.M, false, rc, P.mud2, 9); strokeOff(g, o.X, o.Y, o.TX, o.TY, o.hw * 0.4, o.M, false, rc, P.mud2, 9);
        strokeOff(g, o.X, o.Y, o.TX, o.TY, (i) => Math.sin(i * 0.3) * 6, o.M, false, rc, P.mudHi, 3);
      } else if (o.surf === S.ICE) {
        g.globalAlpha = 0.55; for (let q = -2; q <= 2; q++) strokeOff(g, o.X, o.Y, o.TX, o.TY, (i) => q * o.hw * 0.35 + Math.sin(i * 0.17 + q) * 8, o.M, false, rc, '#ffffff', 1.5); g.globalAlpha = 1;
      } else { strokeOff(g, o.X, o.Y, o.TX, o.TY, -o.hw * 0.42, o.M, false, rc, P.rut, 6); strokeOff(g, o.X, o.Y, o.TX, o.TY, o.hw * 0.42, o.M, false, rc, P.rut, 6); }
    });
    // main road
    strokeVar(g, T.X, T.Y, T.HW, T.N, true, rc, P.road2, 2, 3);
    strokeVar(g, T.X, T.Y, T.HW, T.N, true, rc, P.road, 2, -6);
    strokeOff(g, T.X, T.Y, T.TX, T.TY, 0, T.N, true, rc, P.crown, 16);
    strokeOff(g, T.X, T.Y, T.TX, T.TY, (i) => -T.HW[i] * 0.42, T.N, true, rc, P.rut, 9);
    strokeOff(g, T.X, T.Y, T.TX, T.TY, (i) => T.HW[i] * 0.42, T.N, true, rc, P.rut, 9);
    strokeOff(g, T.X, T.Y, T.TX, T.TY, (i) => -T.HW[i] * 0.42 + 1.5, T.N, true, rc, 'rgba(0,0,0,.08)', 3);
    if (season === 'winter') { // plowed edges: a darker slush line so the grey road reads against the snow
      for (const sd of [-1, 1]) { strokeOff(g, T.X, T.Y, T.TX, T.TY, (i) => sd * (T.HW[i] - 3), T.N, true, rc, 'rgba(96,82,68,.5)', 6); strokeOff(g, T.X, T.Y, T.TX, T.TY, (i) => sd * (T.HW[i] + 4), T.N, true, rc, 'rgba(150,175,200,.55)', 5); }
    }
    // speckles + puddles + tufts
    for (const s of F.specks) { if (!vis(rc, s.x, s.y, 3)) continue; g.fillStyle = s.c; g.fillRect(s.x - s.r / 2, s.y - s.r / 2, s.r, s.r); }
    for (const p of F.puddles) {
      if (!vis(rc, p.x, p.y, 20)) continue;
      g.fillStyle = 'rgba(60,40,24,.45)'; g.beginPath(); g.ellipse(p.x, p.y, p.r * 1.5, p.r, p.a, 0, TAU); g.fill();
      g.fillStyle = 'rgba(160,190,205,.45)'; g.beginPath(); g.ellipse(p.x - 1, p.y - 1, p.r * 1.2, p.r * 0.7, p.a, 0, TAU); g.fill();
    }
    for (const t of F.tufts) { if (!vis(rc, t.x, t.y, 5)) continue; g.fillStyle = t.c; g.beginPath(); g.arc(t.x, t.y, t.r, 0, TAU); g.fill(); }
    // zones
    T.zones.forEach((z) => {
      if (!vis(rc, z.x, z.y, Math.max(z.rl, z.rw) + 20)) return;
      g.save(); g.translate(z.x, z.y); g.rotate(z.a);
      const blob = (sc, col) => { g.fillStyle = col; g.beginPath(); for (let i = 0; i <= 32; i++) { const a = i / 32 * TAU, w = 1 + 0.12 * Math.sin(a * 3 + z.seed) + 0.07 * Math.sin(a * 5 + z.seed * 0.3); g.lineTo(Math.cos(a) * z.rl * w * sc, Math.sin(a) * z.rw * w * sc); } g.fill(); };
      if (z.type === 'mud') {
        blob(1.12, 'rgba(70,48,28,.5)'); blob(1, P.mud); blob(0.72, P.mud2);
        g.strokeStyle = 'rgba(30,18,8,.35)'; g.lineWidth = 5; for (const o of [-0.4, 0.4]) { g.beginPath(); g.moveTo(-z.rl * 0.9, z.rw * o); g.bezierCurveTo(-z.rl * 0.3, z.rw * (o + 0.15), z.rl * 0.3, z.rw * (o - 0.15), z.rl * 0.9, z.rw * o); g.stroke(); }
        g.fillStyle = P.mudHi; for (let i = 0; i < 5; i++) { g.beginPath(); g.ellipse((i - 2) * z.rl * 0.3, -z.rw * 0.25 + (i % 2) * 8, 9, 3, 0.2, 0, TAU); g.fill(); }
      } else if (z.type === 'ice') {
        blob(1.06, 'rgba(255,255,255,.7)'); blob(1, '#bfe2f4'); blob(0.75, '#d6eefa');
        g.strokeStyle = 'rgba(255,255,255,.85)'; g.lineWidth = 1.5; for (let i = 0; i < 6; i++) { g.beginPath(); g.moveTo(-z.rl * 0.7 + i * z.rl * 0.25, -z.rw * 0.5); g.lineTo(-z.rl * 0.5 + i * z.rl * 0.25, z.rw * 0.4); g.stroke(); }
        g.strokeStyle = 'rgba(120,170,200,.5)'; g.lineWidth = 1; g.beginPath(); g.moveTo(-z.rl * 0.4, 0); g.lineTo(0, z.rw * 0.2); g.lineTo(z.rl * 0.3, -z.rw * 0.3); g.stroke();
      } else if (z.type === 'leaves') {
        const R = rng(z.seed); const cols = P.leaves || ['#c4661c'];
        blob(1, 'rgba(150,70,20,.35)');
        for (let i = 0; i < z.rl * z.rw * 0.12; i++) { const a = R() * TAU, r = Math.sqrt(R()), x = Math.cos(a) * r * z.rl, y = Math.sin(a) * r * z.rw; g.fillStyle = cols[Math.floor(R() * cols.length)]; g.beginPath(); g.ellipse(x, y, 3 + R() * 2.5, 1.8 + R() * 1.2, R() * 6, 0, TAU); g.fill(); }
      }
      g.restore();
    });
    // autumn: leaves hide the road edge
    for (const l of F.leaves) { if (!vis(rc, l.x, l.y, 6)) continue; g.fillStyle = l.c; g.beginPath(); g.ellipse(l.x, l.y, l.r, l.r * 0.6, l.a, 0, TAU); g.fill(); }
    if (season === 'autumn') { for (const sd of [-1, 1]) strokeOff(g, T.X, T.Y, T.TX, T.TY, (i) => sd * (T.HW[i] - 2), T.N, true, rc, 'rgba(70,40,18,.55)', 4); }
    // frost heaves
    T.heaves.forEach((h) => {
      if (!vis(rc, h.x, h.y, h.hw + 20)) return;
      g.save(); g.translate(h.x, h.y); g.rotate(h.a);
      g.fillStyle = 'rgba(0,0,0,.28)'; g.fillRect(4, -h.hw, 7, h.hw * 2);
      g.fillStyle = season === 'winter' ? '#e9e6e0' : '#b89a72'; g.fillRect(-8, -h.hw, 12, h.hw * 2);
      g.fillStyle = 'rgba(255,255,255,.35)'; g.fillRect(-8, -h.hw, 3, h.hw * 2);
      g.strokeStyle = 'rgba(40,30,20,.55)'; g.lineWidth = 1.2; g.beginPath();
      for (let y = -h.hw + 6; y < h.hw - 4; y += 9) { g.moveTo(-6, y); g.lineTo(2, y + 4); g.lineTo(-3, y + 8); }
      g.stroke();
      g.restore();
    });
    // bridge deck planks
    if (T.bridge) {
      const b = T.bridge, n = Math.ceil(b.half * 2 / 7);
      for (let i = 0; i <= n; i++) {
        const s = b.s - b.half + i * 7, p = T.point(s);
        if (!vis(rc, p.x, p.y, 60)) continue;
        g.strokeStyle = i % 2 ? '#7a5634' : '#8a6340'; g.lineWidth = 7.4; g.lineCap = 'butt';
        g.beginPath(); g.moveTo(p.x + p.ty * b.hw, p.y - p.tx * b.hw); g.lineTo(p.x - p.ty * b.hw, p.y + p.tx * b.hw); g.stroke();
      }
    }
    // walls: stone walls / snowbanks / rail fence
    for (const st of F.stones) {
      if (!vis(rc, st.x, st.y, 14)) continue;
      if (season === 'winter') {
        g.fillStyle = P.wallLo; g.beginPath(); g.arc(st.x - Math.sin(st.a) * st.sd * -3, st.y + Math.cos(st.a) * st.sd * -3, st.r * 2.1, 0, TAU); g.fill();
        g.fillStyle = '#ffffff'; g.beginPath(); g.arc(st.x, st.y, st.r * 2, 0, TAU); g.fill();
      } else if (season === 'night') {
        g.fillStyle = P.wallLo; g.fillRect(st.x - 2, st.y - 2, 5, 5);
      } else {
        g.fillStyle = 'rgba(0,0,0,.28)'; g.beginPath(); g.ellipse(st.x + 2, st.y + 2.5, st.r * 1.1, st.r * 0.85, st.a, 0, TAU); g.fill();
        g.fillStyle = st.tone < 0.33 ? P.wallLo : st.tone < 0.75 ? P.wall : P.wallHi; g.beginPath(); g.ellipse(st.x, st.y, st.r, st.r * 0.78, st.a + st.tone, 0, TAU); g.fill();
      }
    }
    if (season === 'night') { // rails between posts
      strokeOff(g, T.X, T.Y, T.TX, T.TY, (i) => -(T.CR[i] + 5), T.N, true, rc, 'rgba(160,120,80,.0)', 0.1);
    }
    // start/finish line + grid boxes
    const p0 = T.point(0);
    if (vis(rc, p0.x, p0.y, 90)) {
      g.save(); g.translate(p0.x, p0.y); g.rotate(Math.atan2(p0.ty, p0.tx));
      const n = 10, cw = (p0.hw * 2) / n;
      for (let i = 0; i < n; i++) for (let j = 0; j < 2; j++) { g.fillStyle = (i + j) % 2 ? '#f6f1e4' : '#2b2420'; g.fillRect(-cw + j * cw, -p0.hw + i * cw, cw, cw); }
      g.restore();
    }
    g.strokeStyle = season === 'winter' ? 'rgba(90,70,50,.55)' : 'rgba(250,240,220,.55)'; g.lineWidth = 2.5;
    T.grid.forEach((q) => { if (!vis(rc, q.x, q.y, 30)) return; g.save(); g.translate(q.x, q.y); g.rotate(q.h); g.beginPath(); g.moveTo(22, -13); g.lineTo(-14, -13); g.moveTo(22, 13); g.lineTo(-14, 13); g.moveTo(22, -13); g.lineTo(22, 13); g.stroke(); g.restore(); });
  }

  // ------------------------------------------------------------ car sprites
  const CS = 3; // sprite scale
  ART.CS = CS;
  function carSprite(rig) {
    const L = 34, W = 19, pad = 8;
    const c = mk((L + pad * 2 + 16) * CS, (W + pad * 2) * CS), g = c.getContext('2d');
    g.scale(CS, CS); g.translate(L / 2 + pad + 8, W / 2 + pad);
    // wheels
    g.fillStyle = '#1c1a18';
    for (const x of [-10.5, 10]) for (const y of [-W / 2 - 1.2, W / 2 + 1.2 - 4]) { rr(g, x - 4, y, 8, 4, 1.4); g.fill(); }
    // body
    const body = (x, y, w, h, r) => { rr(g, x, y, w, h, r); };
    const grd = g.createLinearGradient(0, -W / 2, 0, W / 2);
    grd.addColorStop(0, rig.dark); grd.addColorStop(0.22, rig.body); grd.addColorStop(0.55, rig.roof); grd.addColorStop(0.8, rig.body); grd.addColorStop(1, rig.dark);
    g.fillStyle = grd; body(-L / 2, -W / 2, L, W, 5); g.fill();
    g.lineWidth = 0.9; g.strokeStyle = 'rgba(20,12,8,.85)'; g.stroke();
    if (rig.type === 'wagon') {
      // wood panel stripes
      if (rig.extra === 'canoe' || rig.trim) { g.fillStyle = rig.trim; g.globalAlpha = 0.9; rr(g, -L / 2 + 3, -W / 2 + 0.6, L - 9, 2.4, 1); g.fill(); rr(g, -L / 2 + 3, W / 2 - 3, L - 9, 2.4, 1); g.fill(); g.globalAlpha = 1; }
      // windshield
      g.fillStyle = '#20313d'; g.beginPath(); g.moveTo(6.5, -W / 2 + 2.5); g.lineTo(10.5, -W / 2 + 3.5); g.lineTo(10.5, W / 2 - 3.5); g.lineTo(6.5, W / 2 - 2.5); g.closePath(); g.fill();
      g.fillStyle = 'rgba(160,210,235,.45)'; g.beginPath(); g.moveTo(7.3, -W / 2 + 3.4); g.lineTo(9.6, -W / 2 + 4); g.lineTo(9.6, -1); g.lineTo(7.3, -1.5); g.fill();
      // roof
      const rg = g.createLinearGradient(0, -W / 2, 0, W / 2); rg.addColorStop(0, rig.body); rg.addColorStop(0.5, rig.roof); rg.addColorStop(1, rig.body);
      g.fillStyle = rg; rr(g, -13, -W / 2 + 2.6, 19.2, W - 5.2, 2.5); g.fill(); g.strokeStyle = 'rgba(0,0,0,.25)'; g.lineWidth = 0.6; g.stroke();
      // side windows
      g.fillStyle = '#2a3c48'; g.fillRect(-12.5, -W / 2 + 1.6, 18, 1.2); g.fillRect(-12.5, W / 2 - 2.8, 18, 1.2);
      // rear window
      g.fillStyle = '#20313d'; g.fillRect(-15.5, -W / 2 + 3.5, 2.2, W - 7);
      // roof rails
      g.strokeStyle = 'rgba(30,30,30,.7)'; g.lineWidth = 1; g.beginPath(); g.moveTo(-12, -W / 2 + 3.6); g.lineTo(5, -W / 2 + 3.6); g.moveTo(-12, W / 2 - 3.6); g.lineTo(5, W / 2 - 3.6); g.stroke();
      if (rig.extra === 'canoe') { // red canoe on the roof
        g.fillStyle = '#b8322a'; g.beginPath(); g.ellipse(-3.5, 0, 17, 3.6, 0, 0, TAU); g.fill(); g.strokeStyle = '#5a1712'; g.lineWidth = 0.8; g.stroke();
        g.fillStyle = '#e0634f'; g.beginPath(); g.ellipse(-4.5, -0.8, 13, 1.4, 0, 0, TAU); g.fill();
        g.strokeStyle = '#3a2a1a'; g.lineWidth = 0.7; for (const x of [-9, -3.5, 2]) { g.beginPath(); g.moveTo(x, -3.2); g.lineTo(x, 3.2); g.stroke(); }
      } else if (rig.extra === 'roofbox') {
        g.fillStyle = '#2b2b2e'; rr(g, -11, -4.6, 13, 9.2, 3); g.fill(); g.fillStyle = 'rgba(255,255,255,.18)'; rr(g, -10, -3.8, 11, 2.6, 1.3); g.fill();
      } else if (rig.extra === 'bikes') {
        g.strokeStyle = '#e8e2d0'; g.lineWidth = 1.1; for (const y of [-3, 3]) { g.beginPath(); g.arc(-8, y, 2.4, 0, TAU); g.moveTo(3.4, y); g.arc(1, y, 2.4, 0, TAU); g.moveTo(-8, y); g.lineTo(1, y); g.stroke(); }
      }
    } else {
      // pickup: hood + cab + bed
      g.fillStyle = '#20313d'; g.beginPath(); g.moveTo(7, -W / 2 + 2.5); g.lineTo(10.5, -W / 2 + 3.5); g.lineTo(10.5, W / 2 - 3.5); g.lineTo(7, W / 2 - 2.5); g.closePath(); g.fill();
      g.fillStyle = 'rgba(160,210,235,.45)'; g.beginPath(); g.moveTo(7.7, -W / 2 + 3.4); g.lineTo(9.8, -W / 2 + 4); g.lineTo(9.8, -1); g.lineTo(7.7, -1.5); g.fill();
      const rg = g.createLinearGradient(0, -W / 2, 0, W / 2); rg.addColorStop(0, rig.body); rg.addColorStop(0.5, rig.roof); rg.addColorStop(1, rig.body);
      g.fillStyle = rg; rr(g, -2.5, -W / 2 + 2.4, 9.8, W - 4.8, 2.2); g.fill(); g.strokeStyle = 'rgba(0,0,0,.3)'; g.lineWidth = 0.6; g.stroke();
      g.fillStyle = '#20313d'; g.fillRect(-4, -W / 2 + 3.5, 1.6, W - 7);
      // bed
      g.fillStyle = 'rgba(0,0,0,.35)'; rr(g, -16.2, -W / 2 + 2, 11.4, W - 4, 1.2); g.fill();
      g.fillStyle = '#3b3530'; rr(g, -15.4, -W / 2 + 2.8, 9.8, W - 5.6, 1); g.fill();
      if (rig.bed === 'hay') { g.fillStyle = '#d9b34a'; rr(g, -14.6, -5.6, 8.4, 11.2, 1.5); g.fill(); g.strokeStyle = '#9c7a26'; g.lineWidth = 0.7; g.beginPath(); g.moveTo(-12, -5.6); g.lineTo(-12, 5.6); g.moveTo(-9, -5.6); g.lineTo(-9, 5.6); g.stroke(); }
      else if (rig.bed === 'buckets') { for (const p of [[-12.5, -3.2], [-12.5, 3.2], [-8.6, -3.2], [-8.6, 3.2]]) { g.fillStyle = '#b9c2c8'; g.beginPath(); g.arc(p[0], p[1], 2.2, 0, TAU); g.fill(); g.fillStyle = '#7d878e'; g.beginPath(); g.arc(p[0], p[1], 1.3, 0, TAU); g.fill(); } }
      else if (rig.bed === 'wood') { for (let i = 0; i < 4; i++) { g.fillStyle = i % 2 ? '#8a5a32' : '#a0703f'; rr(g, -14.8, -5 + i * 2.6, 8.8, 2.3, 1); g.fill(); g.fillStyle = '#e1c08f'; g.beginPath(); g.arc(-6.4, -3.8 + i * 2.6, 1, 0, TAU); g.fill(); } }
    }
    // lights
    g.fillStyle = '#fff6c8'; rr(g, L / 2 - 2.2, -W / 2 + 1.6, 1.8, 3.2, 0.8); g.fill(); rr(g, L / 2 - 2.2, W / 2 - 4.8, 1.8, 3.2, 0.8); g.fill();
    g.fillStyle = '#d0281e'; g.fillRect(-L / 2 + 0.2, -W / 2 + 1.6, 1.4, 3); g.fillRect(-L / 2 + 0.2, W / 2 - 4.6, 1.4, 3);
    // paint-job extras: twin racing stripes or a plaid check
    if (rig.stripe) { g.fillStyle = rig.stripe; g.globalAlpha = 0.9; g.fillRect(-L / 2 + 1, -2.4, L - 2, 1.5); g.fillRect(-L / 2 + 1, 0.9, L - 2, 1.5); g.globalAlpha = 1; }
    if (rig.plaid) { g.save(); rr(g, -L / 2, -W / 2, L, W, 5); g.clip(); g.globalAlpha = 0.28; g.fillStyle = rig.plaid; for (let x = -L / 2; x < L / 2; x += 6) g.fillRect(x, -W / 2, 2.2, W); for (let y = -W / 2; y < W / 2; y += 6) g.fillRect(-L / 2, y, L, 2.2); g.restore(); }
    // top highlight
    g.fillStyle = 'rgba(255,255,255,.12)'; rr(g, -L / 2 + 2, -W / 2 + 1, L - 4, 3, 2); g.fill();
    return { c, ox: (L / 2 + pad + 8) * CS, oy: (W / 2 + pad) * CS };
  }
  function shadowSprite() {
    const c = mk(60 * CS / 1.5, 36 * CS / 1.5), g = c.getContext('2d');
    const sc = CS / 1.5; g.scale(sc, sc);
    g.filter = 'blur(3px)'; g.fillStyle = 'rgba(0,0,0,.45)'; rr(g, 12, 9, 36, 19, 6); g.fill(); g.filter = 'none';
    return { c, ox: 30 * sc, oy: 18 * sc, sc };
  }

  // ------------------------------------------------------------ trees
  const TREE = {
    maple: { spring: ['#7b8f3e', '#93a84d', '#b2c06a', '#a04a3a'], autumn: ['#c2361d', '#e0662a', '#f19a2c', '#a32518'], winter: null, night: ['#2f5a2e', '#3d6e38', '#4f8445'] },
    birch: { spring: ['#a9c25a', '#c3d77a', '#d7e59a'], autumn: ['#e2b62e', '#f2d04a', '#c99a1f'], winter: null, night: ['#4f7a3a', '#5f8c45'] },
    oak: { spring: ['#5f7f34', '#759443', '#8aa653'], autumn: ['#9a5a22', '#b8742c', '#7d4518'], winter: null, night: ['#2b4f2a', '#356034'] },
    apple: { spring: ['#6f9440', '#86a84e', '#f0d8e0'], autumn: ['#6f8a36', '#86a046', '#c0281e'], winter: null, night: ['#2f5a2e', '#3d6e38'] }
  };
  function treeSprite(kind, season, seed) {
    const s = 192, c = mk(s, s), g = c.getContext('2d'), R = rng(seed), m = s / 2;
    g.translate(m, m); g.scale(1.5, 1.5);
    // soft contact shadow, offset away from the top-left light
    const softShadow = (r, a) => { const gr = g.createRadialGradient(9, 11, r * 0.35, 9, 11, r); gr.addColorStop(0, 'rgba(20,16,30,' + a + ')'); gr.addColorStop(0.75, 'rgba(20,16,30,' + a * 0.55 + ')'); gr.addColorStop(1, 'rgba(20,16,30,0)'); g.fillStyle = gr; g.beginPath(); g.arc(9, 11, r, 0, TAU); g.fill(); };
    const isPine = kind === 'pine' || kind === 'spruce';
    if (isPine) {
      const dark = season === 'night' ? '#173323' : kind === 'spruce' ? '#1f4a35' : '#2a5232';
      const mid = season === 'night' ? '#1f4230' : kind === 'spruce' ? '#2d6247' : '#3a6b3f';
      const hi = season === 'night' ? '#2a5440' : kind === 'spruce' ? '#4a8763' : '#5a8d55';
      const pts = 9 + Math.floor(R() * 3);
      const star = (r, col, rot) => { g.fillStyle = col; g.beginPath(); for (let i = 0; i <= pts * 2; i++) { const a = rot + i / (pts * 2) * TAU, rr2 = i % 2 ? r * 0.62 : r; g.lineTo(Math.cos(a) * rr2, Math.sin(a) * rr2); } g.fill(); };
      softShadow(60, season === 'winter' ? 0.22 : 0.4);
      star(60, dark, 0); star(46, mid, 0.3); star(30, hi, 0.1); star(14, mid, 0.5);
      if (season === 'winter') { g.fillStyle = 'rgba(255,255,255,.85)'; for (let i = 0; i < 18; i++) { const a = R() * TAU, r = 10 + R() * 44; g.beginPath(); g.ellipse(Math.cos(a) * r, Math.sin(a) * r, 5 + R() * 6, 3 + R() * 3, a, 0, TAU); g.fill(); } }
      return c;
    }
    if (kind === 'bare' || (season === 'winter' && TREE[kind])) {
      softShadow(50, 0.18);
      g.strokeStyle = kind === 'birch' ? '#e8e4dc' : '#5a4a3c'; g.lineCap = 'round';
      const branch = (x, y, a, len, w, d) => { if (d > 4 || len < 4) return; const x2 = x + Math.cos(a) * len, y2 = y + Math.sin(a) * len; g.lineWidth = w; g.beginPath(); g.moveTo(x, y); g.lineTo(x2, y2); g.stroke(); branch(x2, y2, a + 0.5 + R() * 0.3, len * 0.66, w * 0.65, d + 1); branch(x2, y2, a - 0.5 - R() * 0.3, len * 0.66, w * 0.65, d + 1); };
      for (let i = 0; i < 6; i++) branch(0, 0, i / 6 * TAU + R(), 22, 5, 0);
      g.fillStyle = 'rgba(255,255,255,.6)'; for (let i = 0; i < 10; i++) { const a = R() * TAU, r = R() * 40; g.beginPath(); g.arc(Math.cos(a) * r, Math.sin(a) * r, 2 + R() * 3, 0, TAU); g.fill(); }
      return c;
    }
    const cols = (TREE[kind] || TREE.maple)[season] || TREE.maple.spring;
    // shadow
    softShadow(60, season === 'winter' ? 0.22 : 0.42);
    // blobs
    const blobs = [];
    for (let i = 0; i < 9; i++) { const a = R() * TAU, r = R() * 26; blobs.push([Math.cos(a) * r, Math.sin(a) * r, 22 + R() * 14]); }
    blobs.forEach((b) => { g.fillStyle = shade(cols[0], -0.35); g.beginPath(); g.arc(b[0] + 2, b[1] + 3, b[2], 0, TAU); g.fill(); });
    blobs.forEach((b, i) => {
      const col = cols[i % (cols.length > 3 && kind === 'maple' && season === 'spring' ? 3 : cols.length)];
      const gr = g.createRadialGradient(b[0] - b[2] * 0.4, b[1] - b[2] * 0.4, 2, b[0], b[1], b[2]);
      gr.addColorStop(0, shade(col, 0.25)); gr.addColorStop(0.7, col); gr.addColorStop(1, shade(col, -0.25));
      g.fillStyle = gr; g.beginPath(); g.arc(b[0], b[1], b[2], 0, TAU); g.fill();
    });
    // scalloped leaf clumps around the edge
    for (let i = 0; i < 22; i++) {
      const a = i / 22 * TAU + R() * 0.2, r = 40 + R() * 8, x = Math.cos(a) * r, y = Math.sin(a) * r, rr = 7 + R() * 5;
      const lit = Math.cos(a + 2.36); // facing the top-left light
      g.fillStyle = shade(cols[i % Math.min(3, cols.length)], lit > 0 ? 0.18 * lit : 0.3 * lit); g.beginPath(); g.arc(x, y, rr, 0, TAU); g.fill();
    }
    { const gr = g.createRadialGradient(-18, -20, 4, 0, 0, 54); gr.addColorStop(0, 'rgba(255,250,220,.22)'); gr.addColorStop(0.5, 'rgba(255,250,220,0)'); gr.addColorStop(0.85, 'rgba(0,0,0,0)'); gr.addColorStop(1, 'rgba(0,0,0,.18)'); g.fillStyle = gr; g.beginPath(); g.arc(0, 0, 54, 0, TAU); g.fill(); }
    // leaf texture
    for (let i = 0; i < 70; i++) { const a = R() * TAU, r = Math.sqrt(R()) * 52; g.fillStyle = R() < 0.5 ? 'rgba(255,255,255,.12)' : 'rgba(0,0,0,.12)'; g.beginPath(); g.arc(Math.cos(a) * r, Math.sin(a) * r, 2 + R() * 3, 0, TAU); g.fill(); }
    if (kind === 'maple' && season === 'spring') { g.fillStyle = '#b04a3a'; for (let i = 0; i < 26; i++) { const a = R() * TAU, r = Math.sqrt(R()) * 46; g.beginPath(); g.arc(Math.cos(a) * r, Math.sin(a) * r, 1.6, 0, TAU); g.fill(); } }
    if (kind === 'apple') { g.fillStyle = season === 'autumn' ? '#d22a1e' : '#ffe2ea'; for (let i = 0; i < 14; i++) { const a = R() * TAU, r = Math.sqrt(R()) * 40; g.beginPath(); g.arc(Math.cos(a) * r, Math.sin(a) * r, 3, 0, TAU); g.fill(); } }
    return c;
  }
  function shade(hex, f) {
    const n = parseInt(hex.slice(1), 16); let r = n >> 16, gg = (n >> 8) & 255, b = n & 255;
    if (f > 0) { r += (255 - r) * f; gg += (255 - gg) * f; b += (255 - b) * f; } else { r *= 1 + f; gg *= 1 + f; b *= 1 + f; }
    return 'rgb(' + (r | 0) + ',' + (gg | 0) + ',' + (b | 0) + ')';
  }
  ART.shade = shade;

  // ------------------------------------------------------------ buildings + props (top-down, facing +x)
  function roofHouse(g, w, h, roof, roof2, ridge) {
    g.fillStyle = 'rgba(0,0,0,.35)'; g.fillRect(-w / 2 + 6, -h / 2 + 8, w, h);
    const a = g.createLinearGradient(0, -h / 2, 0, 0); a.addColorStop(0, roof2); a.addColorStop(1, roof);
    g.fillStyle = a; g.fillRect(-w / 2, -h / 2, w, h / 2);
    const b = g.createLinearGradient(0, 0, 0, h / 2); b.addColorStop(0, shade(roof, -0.25)); b.addColorStop(1, shade(roof2, -0.4));
    g.fillStyle = b; g.fillRect(-w / 2, 0, w, h / 2);
    g.strokeStyle = ridge; g.lineWidth = 2.5; g.beginPath(); g.moveTo(-w / 2, 0); g.lineTo(w / 2, 0); g.stroke();
    g.strokeStyle = 'rgba(0,0,0,.18)'; g.lineWidth = 1; for (let x = -w / 2 + 6; x < w / 2; x += 6) { g.beginPath(); g.moveTo(x, -h / 2); g.lineTo(x, h / 2); g.stroke(); }
    g.strokeStyle = 'rgba(20,10,5,.7)'; g.lineWidth = 1.5; g.strokeRect(-w / 2, -h / 2, w, h);
  }
  function propSprite(k, season, v) {
    const snow = season === 'winter';
    const c = mk(320, 320), g = c.getContext('2d'); g.translate(160, 160);
    if (k === 'barn') {
      roofHouse(g, 150, 96, snow ? '#f2f5f8' : '#a8392b', snow ? '#ffffff' : '#c4493a', snow ? '#c9d6e2' : '#6b2018');
      g.fillStyle = '#7a756c'; g.beginPath(); g.arc(-60, 0, 6, 0, TAU); g.fill();
    } else if (k === 'farmhouse') {
      roofHouse(g, 104, 70, snow ? '#f4f6f9' : '#5f6670', snow ? '#ffffff' : '#7a838e', '#3a3f45');
      g.fillStyle = '#8a3a2a'; g.fillRect(20, -22, 10, 10); g.fillStyle = '#3a2a22'; g.fillRect(22, -20, 6, 6);
      g.fillStyle = '#e9e2d0'; g.fillRect(-56, -40, 18, 80); // porch
    } else if (k === 'shack') {
      roofHouse(g, 90, 62, snow ? '#f4f6f9' : '#6b4a2e', snow ? '#ffffff' : '#87613d', '#3a2616');
      g.fillStyle = '#4a3220'; g.fillRect(-14, -8, 28, 16); g.fillStyle = '#6b4a2e'; g.fillRect(-12, -6, 24, 12); // cupola
      g.fillStyle = '#5a3a22'; for (let i = 0; i < 4; i++) g.fillRect(52 + (i % 2) * 8, -24 + i * 12, 7, 10); // woodpile
    } else if (k === 'silo') {
      g.fillStyle = 'rgba(0,0,0,.35)'; g.beginPath(); g.arc(8, 9, 34, 0, TAU); g.fill();
      const gr = g.createRadialGradient(-10, -10, 4, 0, 0, 34); gr.addColorStop(0, '#e6e9ec'); gr.addColorStop(1, '#8e969e');
      g.fillStyle = gr; g.beginPath(); g.arc(0, 0, 34, 0, TAU); g.fill(); g.strokeStyle = 'rgba(40,40,40,.5)'; g.lineWidth = 1.5; g.stroke();
      g.strokeStyle = 'rgba(80,80,80,.35)'; for (let i = 0; i < 8; i++) { g.beginPath(); g.moveTo(0, 0); g.lineTo(Math.cos(i * TAU / 8) * 34, Math.sin(i * TAU / 8) * 34); g.stroke(); }
    } else if (k === 'cabin') {
      roofHouse(g, 80, 60, '#f4f6f9', '#ffffff', '#c9d6e2'); g.fillStyle = '#6a4a32'; g.fillRect(-46, -30, 6, 60); g.fillStyle = '#7a3a2a'; g.fillRect(18, -26, 8, 8);
    } else if (k === 'plowshed') {
      roofHouse(g, 110, 70, '#f4f6f9', '#ffffff', '#b0c0d0'); g.fillStyle = '#e8a020'; g.fillRect(58, -18, 20, 36); g.fillStyle = '#c4c4c4'; g.fillRect(76, -24, 6, 48);
    } else if (k === 'church') {
      roofHouse(g, 120, 66, '#4a5058', '#666e78', '#2a2e33'); g.fillStyle = '#f2efe6'; g.fillRect(56, -16, 30, 32); g.fillStyle = '#3a3f45'; g.beginPath(); g.moveTo(56, -16); g.lineTo(86, 0); g.lineTo(56, 16); g.fill();
    } else if (k === 'woodpile') {
      for (let i = 0; i < 8; i++) { g.fillStyle = i % 2 ? '#8a5a32' : '#a0703f'; g.fillRect(-40 + i * 10, -14, 9, 28); g.fillStyle = '#e1c08f'; g.beginPath(); g.arc(-35.5 + i * 10, -12, 3, 0, TAU); g.fill(); }
    } else if (k === 'lamp') {
      g.fillStyle = 'rgba(0,0,0,.4)'; g.beginPath(); g.arc(3, 4, 7, 0, TAU); g.fill(); g.fillStyle = '#2b2b2b'; g.beginPath(); g.arc(0, 0, 6, 0, TAU); g.fill(); g.fillStyle = '#ffe9a8'; g.beginPath(); g.arc(0, 0, 3.5, 0, TAU); g.fill();
    } else if (k === 'orchard' || k === 'cows' || k === 'pumpkins') {
      return null;
    } else return null;
    return c;
  }

  // chevron board: black arrows on yellow, pointing the way the road turns
  function chevSprite(dir) {
    const c = mk(96, 96), g = c.getContext('2d'); g.translate(48, 48); g.scale(dir, 1);
    g.fillStyle = 'rgba(0,0,0,.32)'; g.fillRect(-20, 8, 44, 18);
    g.fillStyle = '#5a4a3a'; g.fillRect(-14, 10, 4, 14); g.fillRect(10, 10, 4, 14);
    g.fillStyle = '#1b1b1b'; rr(g, -26, -14, 52, 28, 4); g.fill(); g.fillStyle = '#f2c230'; rr(g, -23.5, -11.5, 47, 23, 3); g.fill();
    g.fillStyle = '#1b1b1b';
    for (const x of [-14, 2]) { g.beginPath(); g.moveTo(x, -9); g.lineTo(x + 9, 0); g.lineTo(x, 9); g.lineTo(x + 6, 9); g.lineTo(x + 15, 0); g.lineTo(x + 6, -9); g.closePath(); g.fill(); }
    return c;
  }
  // signs (diamond, facing the road)
  function signSprite(v) {
    const c = mk(96, 96), g = c.getContext('2d'); g.translate(48, 48);
    g.fillStyle = 'rgba(0,0,0,.3)'; g.fillRect(-2, 6, 6, 30);
    g.fillStyle = '#5a4a3a'; g.fillRect(-2, 0, 4, 34);
    g.save(); g.rotate(Math.PI / 4); g.fillStyle = '#1b1b1b'; rr(g, -24, -24, 48, 48, 5); g.fill(); g.fillStyle = '#f2c230'; rr(g, -21.5, -21.5, 43, 43, 4); g.fill(); g.restore();
    g.fillStyle = '#1b1b1b';
    if (v === 'heave') { g.beginPath(); g.moveTo(-18, 6); g.quadraticCurveTo(-9, -10, 0, 6); g.quadraticCurveTo(9, -10, 18, 6); g.lineTo(18, 9); g.lineTo(-18, 9); g.fill(); g.font = 'bold 7px sans-serif'; g.textAlign = 'center'; g.fillText('BUMP', 0, 19); }
    else { // tractor pictogram
      g.beginPath(); g.arc(-8, 8, 8, 0, TAU); g.fill(); g.beginPath(); g.arc(10, 11, 5, 0, TAU); g.fill(); g.fillRect(-6, -6, 16, 10); g.fillRect(-2, -14, 9, 9); g.fillStyle = '#f2c230'; g.fillRect(0, -12, 5, 5); g.beginPath(); g.arc(-8, 8, 3, 0, TAU); g.fill();
    }
    return c;
  }

  // ------------------------------------------------------------ items & icons
  function iconSprite(k, size) {
    const s = size || 96, c = mk(s, s), g = c.getContext('2d'); g.translate(s / 2, s / 2); g.scale(s / 96, s / 96);
    if (k === 'syrup') { // maple syrup jug
      g.fillStyle = 'rgba(0,0,0,.25)'; g.beginPath(); g.ellipse(4, 34, 28, 7, 0, 0, TAU); g.fill();
      const gr = g.createLinearGradient(-26, 0, 26, 0); gr.addColorStop(0, '#9a4e0c'); gr.addColorStop(0.4, '#e8901e'); gr.addColorStop(1, '#8a3f08');
      g.fillStyle = gr; rr(g, -26, -16, 52, 50, 14); g.fill(); g.strokeStyle = '#3b1f08'; g.lineWidth = 3; g.stroke();
      g.fillStyle = '#c6281c'; rr(g, -10, -32, 20, 14, 4); g.fill(); g.stroke();
      g.strokeStyle = '#3b1f08'; g.lineWidth = 5; g.beginPath(); g.arc(18, -12, 11, -1.4, 1.2); g.stroke(); g.strokeStyle = '#e8901e'; g.lineWidth = 2.5; g.stroke();
      g.fillStyle = '#fff3d6'; rr(g, -17, 2, 34, 20, 4); g.fill(); drawLeaf(g, 0, 12, 7, '#c6281c');
      g.fillStyle = 'rgba(255,255,255,.35)'; rr(g, -20, -10, 8, 30, 4); g.fill();
    } else if (k === 'donut') {
      g.fillStyle = 'rgba(0,0,0,.25)'; g.beginPath(); g.ellipse(4, 30, 32, 8, 0, 0, TAU); g.fill();
      const gr = g.createRadialGradient(-10, -12, 6, 0, 0, 36); gr.addColorStop(0, '#e2a35a'); gr.addColorStop(1, '#9a5a22');
      g.fillStyle = gr; g.beginPath(); g.arc(0, 0, 34, 0, TAU); g.arc(0, 0, 12, 0, TAU, true); g.fill('evenodd');
      g.strokeStyle = '#4a2a10'; g.lineWidth = 3; g.beginPath(); g.arc(0, 0, 34, 0, TAU); g.stroke(); g.beginPath(); g.arc(0, 0, 12, 0, TAU); g.stroke();
      const R = rng(5); g.fillStyle = 'rgba(255,248,230,.85)'; for (let i = 0; i < 60; i++) { const a = R() * TAU, r = 14 + R() * 18; g.fillRect(Math.cos(a) * r, Math.sin(a) * r, 2, 2); }
    } else if (k === 'pine') {
      g.fillStyle = 'rgba(0,0,0,.25)'; g.beginPath(); g.ellipse(4, 36, 18, 6, 0, 0, TAU); g.fill();
      g.save(); g.rotate(-0.3);
      for (let r = 0; r < 7; r++) { const y = -30 + r * 9, w = 10 + Math.sin(r / 6 * Math.PI) * 14; for (let i = -1; i <= 1; i++) { g.fillStyle = r % 2 ? '#8a5228' : '#a8682f'; g.beginPath(); g.ellipse(i * w * 0.6, y, w * 0.55, 6, 0, 0, TAU); g.fill(); g.strokeStyle = '#3e220c'; g.lineWidth = 2; g.stroke(); } }
      g.fillStyle = '#4e7a33'; g.fillRect(-3, -42, 6, 10); g.restore();
    } else if (k === 'snow') {
      g.fillStyle = 'rgba(0,0,0,.2)'; g.beginPath(); g.ellipse(5, 32, 30, 8, 0, 0, TAU); g.fill();
      const gr = g.createRadialGradient(-12, -14, 4, 0, 0, 34); gr.addColorStop(0, '#ffffff'); gr.addColorStop(0.7, '#e6f1fa'); gr.addColorStop(1, '#a9c4dc');
      g.fillStyle = gr; g.beginPath(); g.arc(0, 0, 33, 0, TAU); g.fill(); g.strokeStyle = '#5c7a96'; g.lineWidth = 3; g.stroke();
      g.fillStyle = 'rgba(160,190,215,.6)'; for (const p of [[10, 8, 5], [-8, 14, 4], [14, -10, 3]]) { g.beginPath(); g.arc(p[0], p[1], p[2], 0, TAU); g.fill(); }
    } else if (k === 'hay') {
      g.fillStyle = 'rgba(0,0,0,.25)'; g.fillRect(-28, -18, 62, 46);
      const gr = g.createLinearGradient(0, -24, 0, 24); gr.addColorStop(0, '#f0cf6a'); gr.addColorStop(1, '#b88f2c');
      g.fillStyle = gr; rr(g, -32, -24, 64, 48, 6); g.fill(); g.strokeStyle = '#6b4f12'; g.lineWidth = 3; g.stroke();
      g.strokeStyle = 'rgba(120,85,20,.6)'; g.lineWidth = 1.5; const R = rng(3); for (let i = 0; i < 26; i++) { const x = -28 + R() * 56, y = -20 + R() * 40; g.beginPath(); g.moveTo(x, y); g.lineTo(x + 8 - R() * 16, y + R() * 3); g.stroke(); }
      g.strokeStyle = '#5a3a14'; g.lineWidth = 3; for (const x of [-12, 12]) { g.beginPath(); g.moveTo(x, -24); g.lineTo(x, 24); g.stroke(); }
    } else if (k === 'crate') {
      g.fillStyle = 'rgba(0,0,0,.3)'; g.fillRect(-26, -22, 56, 56);
      const gr = g.createLinearGradient(-30, -30, 30, 30); gr.addColorStop(0, '#d9a866'); gr.addColorStop(1, '#a06a32');
      g.fillStyle = gr; rr(g, -30, -30, 60, 60, 5); g.fill(); g.strokeStyle = '#4a2c12'; g.lineWidth = 3.5; g.stroke();
      g.strokeStyle = 'rgba(80,45,15,.55)'; g.lineWidth = 2; for (const y of [-15, 0, 15]) { g.beginPath(); g.moveTo(-28, y); g.lineTo(28, y); g.stroke(); }
      g.strokeStyle = '#6b4220'; g.lineWidth = 6; g.beginPath(); g.moveTo(-24, -24); g.lineTo(24, 24); g.stroke();
      g.fillStyle = '#fff3d6'; g.beginPath(); g.arc(0, 0, 15, 0, TAU); g.fill(); drawLeaf(g, 0, 1, 11, '#c6281c');
    }
    return c;
  }
  function drawLeaf(g, x, y, r, col) { // simple 5-point maple leaf
    g.save(); g.translate(x, y); g.fillStyle = col; g.beginPath();
    const P = [[0, -1], [0.22, -0.55], [0.55, -0.7], [0.45, -0.25], [0.95, -0.2], [0.6, 0.12], [0.75, 0.45], [0.2, 0.3], [0.08, 0.62], [0.08, 1], [-0.08, 1], [-0.08, 0.62], [-0.2, 0.3], [-0.75, 0.45], [-0.6, 0.12], [-0.95, -0.2], [-0.45, -0.25], [-0.55, -0.7], [-0.22, -0.55]];
    P.forEach((p, i) => i ? g.lineTo(p[0] * r, p[1] * r) : g.moveTo(p[0] * r, p[1] * r)); g.closePath(); g.fill(); g.restore();
  }
  ART.drawLeaf = drawLeaf;

  // world objects
  function syrupPuddle(seed) {
    const c = mk(96, 96), g = c.getContext('2d'), R = rng(seed); g.translate(48, 48);
    const blob = (sc, col) => { g.fillStyle = col; g.beginPath(); for (let i = 0; i <= 24; i++) { const a = i / 24 * TAU, w = 1 + 0.18 * Math.sin(a * 4 + seed) + 0.1 * Math.sin(a * 7); g.lineTo(Math.cos(a) * 36 * w * sc, Math.sin(a) * 30 * w * sc); } g.fill(); };
    blob(1.05, 'rgba(90,40,5,.55)'); blob(1, '#b8640f'); blob(0.75, '#d98a1d');
    g.fillStyle = 'rgba(255,240,190,.55)'; g.beginPath(); g.ellipse(-10, -9, 12, 5, -0.4, 0, TAU); g.fill(); g.beginPath(); g.ellipse(12, 6, 5, 2.5, -0.4, 0, TAU); g.fill();
    void R; return c;
  }
  function tractorSprite() {
    const c = mk(96 * 2, 64 * 2), g = c.getContext('2d'); g.scale(2, 2); g.translate(48, 32);
    g.fillStyle = 'rgba(0,0,0,.35)'; rr(g, -26, -16, 60, 40, 8); g.fill();
    g.fillStyle = '#1e1e1e'; rr(g, -26, -24, 22, 12, 3); g.fill(); rr(g, -26, 12, 22, 12, 3); g.fill(); rr(g, 14, -19, 14, 8, 2); g.fill(); rr(g, 14, 11, 14, 8, 2); g.fill();
    g.strokeStyle = '#3a3a3a'; g.lineWidth = 1; for (let i = 0; i < 6; i++) { g.beginPath(); g.moveTo(-24 + i * 3.5, -24); g.lineTo(-24 + i * 3.5, -12); g.moveTo(-24 + i * 3.5, 12); g.lineTo(-24 + i * 3.5, 24); g.stroke(); }
    const gr = g.createLinearGradient(0, -12, 0, 12); gr.addColorStop(0, '#d8521e'); gr.addColorStop(0.5, '#f07a30'); gr.addColorStop(1, '#a83a12');
    g.fillStyle = gr; rr(g, -4, -9, 34, 18, 4); g.fill(); g.strokeStyle = '#4a1a06'; g.lineWidth = 1.5; g.stroke();
    g.fillStyle = '#c84a1a'; rr(g, -24, -12, 22, 24, 3); g.fill(); g.stroke();
    g.fillStyle = '#22313a'; rr(g, -20, -9, 14, 18, 2); g.fill(); g.fillStyle = 'rgba(160,210,235,.35)'; g.fillRect(-19, -8, 5, 16);
    g.fillStyle = '#333'; g.beginPath(); g.arc(18, -4, 3, 0, TAU); g.fill();
    g.fillStyle = '#ffe9a8'; g.fillRect(28, -7, 3, 4); g.fillRect(28, 3, 3, 4);
    return c;
  }

  // ------------------------------------------------------------ cache
  ART.ASSETS = {};
  // a painted variant of a rig (key carN_pK), built on demand
  ART.paintKey = function (rigId, k) {
    if (!k) return 'car' + rigId;
    const key = 'car' + rigId + '_p' + k, A = ART.ASSETS;
    if (!A[key]) { const P = DRD.PAINTS[k], base = DRD.RIGS[rigId]; A[key] = carSprite(Object.assign({}, base, { body: P.body, dark: P.dark, roof: P.roof, stripe: P.stripe, plaid: P.plaid, trim: base.trim ? (P.stripe || base.trim) : base.trim })); }
    return key;
  };
  ART.prep = function (season) {
    const A = ART.ASSETS;
    DRD.RIGS.forEach((rig) => { if (!A['car' + rig.id]) A['car' + rig.id] = carSprite(rig); });
    if (!A.shadow) A.shadow = shadowSprite();
    ['syrup', 'donut', 'pine', 'snow', 'hay', 'crate'].forEach((k) => { if (!A['icon_' + k]) A['icon_' + k] = iconSprite(k, 128); });
    if (!A.syrupPuddle) A.syrupPuddle = syrupPuddle(3);
    if (!A.tractor) A.tractor = tractorSprite();
    if (!A.sign_heave) { A.sign_heave = signSprite('heave'); A.sign_tractor = signSprite('tractor'); }
    if (!A.sign_chevR) { A.sign_chevR = chevSprite(1); A.sign_chevL = chevSprite(-1); }
    ['maple', 'birch', 'oak', 'apple', 'pine', 'spruce', 'bare'].forEach((kind) => {
      for (let v = 0; v < 3; v++) { const key = 'tree_' + kind + '_' + season + '_' + v; if (!A[key]) A[key] = treeSprite(kind, season, 1000 + v * 77 + kind.length * 13); }
    });
    ['barn', 'farmhouse', 'shack', 'silo', 'cabin', 'plowshed', 'church', 'woodpile', 'lamp'].forEach((k) => { const key = 'prop_' + k + '_' + season; if (!(key in A)) A[key] = propSprite(k, season); });
    if (ART.painted) ART.loadPainted();
  };
  // optional painted art: assets/<key>.png replaces the code-drawn sprite when present
  ART.loadPainted = function () {
    Object.keys(ART.ASSETS).forEach((key) => {
      const img = new Image();
      img.onload = () => { const cur = ART.ASSETS[key]; if (cur && cur.c) { cur.c = img; } else ART.ASSETS[key] = img; };
      img.src = 'assets/' + key + '.png';
    });
  };
})();
