/* Dirt Road Derby — game shell: loop, camera, rendering, HUD, controls, menus, modes, saves, ghost, test hooks. */
(function () {
  'use strict';
  const DRD = window.DRD, ART = DRD.ART, A = DRD.audio, S = DRD.SURF, DT = DRD.DT;
  const $ = (id) => document.getElementById(id);
  const stage = $('stage'), canvas = $('c'), ctx = canvas.getContext('2d');
  const TAU = Math.PI * 2;
  const clamp = (v, a, b) => v < a ? a : v > b ? b : v;
  const lerp = (a, b, t) => a + (b - a) * t;
  const wrapA = (a) => { while (a > Math.PI) a -= TAU; while (a < -Math.PI) a += TAU; return a; };
  const easeOut = (t) => 1 - Math.pow(1 - clamp(t, 0, 1), 3);
  const ordinal = (n) => n + (n === 1 ? 'st' : n === 2 ? 'nd' : n === 3 ? 'rd' : 'th');
  const fmt = (t) => { if (!isFinite(t)) return '--:--.--'; const m = Math.floor(t / 60), s = t - m * 60; return m + ':' + (s < 10 ? '0' : '') + s.toFixed(2); };
  ART.painted = /[?&]art=1/.test(location.search);
  // 3D chase view (view3d.js, three.js) unless WebGL is missing or ?view=top asks for the old top-down renderer (fallback only)
  const glCanvas = $('gl');
  let glCtx = null;
  if (!/[?&]view=top/.test(location.search)) { try { glCtx = glCanvas.getContext('webgl2', { antialias: true, powerPreference: 'high-performance', alpha: true, stencil: false }); } catch (e) { glCtx = null; } } // alpha: rig snapshots for the results card / garage need a clear background
  DRD.glCtx = glCtx;
  if (!glCtx) glCanvas.style.display = 'none'; else glCanvas.classList.add('off');

  // ------------------------------------------------------------ save
  const KEY = 'drd.v1';
  const defaults = { sound: true, music: true, buzz: true, steer: 'tap', prMax: 0, cls: 0, rig: 0, track: 0, best: {}, tt: {}, gp: {}, hints: {}, races: 0, wins: 0, paint: 0, mirror: false, daily: {}, streak: { n: 0, last: '' } };
  let save = Object.assign({}, defaults);
  try { const s = JSON.parse(localStorage.getItem(KEY) || 'null'); if (s && typeof s === 'object') save = Object.assign({}, defaults, s); } catch (e) {}
  if (save.steer !== 'tap') save.steer = 'tap'; // "Steer: drag" is gone: one steering scheme
  function persist() { try { localStorage.setItem(KEY, JSON.stringify(save)); } catch (e) {} }
  function ghostKey(id) { return 'drd.ghost.' + id; }
  function loadGhost(id) { try { const g = JSON.parse(localStorage.getItem(ghostKey(id)) || 'null'); return g && g.f && g.f.length ? g : null; } catch (e) { return null; } }
  function saveGhost(id, g) { try { localStorage.setItem(ghostKey(id), JSON.stringify(g)); } catch (e) {} }
  A.sound = save.sound; A.music = save.music;

  // ------------------------------------------------------------ state
  const G = {
    screen: 'title', mode: 'single', trackI: save.track, race: null, T: null, ground: null, demo: false,
    cam: { x: 0, y: 0, a: -Math.PI / 2, z: 1, sx: 0, sy: 0 }, shake: 0, flash: 0, flashCol: '#fff',
    parts: [], pops: [], banner: null, timeScale: 1, slowT: 0, hitPause: 0, acc: 0,
    finishShownT: 0, resultsQueued: false, photo: false, photoDone: false,
    gp: null, ghost: null, ghostRec: null, ghostLapStart: 0, lastSplit: null,
    wheels: [], tracks: [], kb: { l: 0, r: 0, d: 0, drift: 0 }, touchUI: false, hintT: 0, prompt: null,
    lastPlace: 0, frameMs: 16, weather: [],
    use3D: !!glCtx, v3: null, alpha: 1, sSteer: 0, ctrlT: 0, camSkip: false, introT0: 0, incoming: null, passArrow: null, prDrop: 0
  };
  const V3on = () => G.use3D && G.v3 && G.v3.ok && !G.v3.lost;
  function paintOk(k) { const P = DRD.PAINTS[k]; return !!P && (save.wins || 0) >= P.need; }
  function track(i) { if (!G.tracks[i]) G.tracks[i] = DRD.buildTrack(DRD.ALL_DEFS[i]); return G.tracks[i]; }

  // ------------------------------------------------------------ Daily Derby: one shared race a day (same track, class, rivals and item luck)
  const TWISTS = [
    { id: null, name: 'Classic rules', sub: 'all five items in the crates' },
    { id: 'donut', name: 'Cider Donut Day', sub: 'every crate is a cider donut' },
    { id: 'pine', name: 'Pinecone Party', sub: 'every crate is a pinecone' },
    { id: 'snow', name: 'Snowball Fight', sub: 'every crate is a snowball' },
    { id: 'syrup', name: 'Sticky Syrup Day', sub: 'every crate is a syrup slick' },
    { id: null, name: 'Classic rules', sub: 'all five items in the crates' }
  ];
  function dayKey(d) { d = d || new Date(); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); }
  function hashStr(str) { let h = 2166136261; for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }
  function dailyInfo() {
    const key = dayKey(), h = hashStr('drd-daily-' + key);
    const track = h % 8, cls = [1, 1, 2, 0, 1, 2, 1, 1][(h >>> 3) % 8], twist = TWISTS[(h >>> 7) % TWISTS.length];
    return { key, track, cls, twist, seed: h % 1000000007 };
  }
  function yesterdayKey() { const d = new Date(); d.setDate(d.getDate() - 1); return dayKey(d); }
  function streakNow() { const st = save.streak || { n: 0, last: '' }; return st.last === dayKey() || st.last === yesterdayKey() ? st.n : 0; }

  // ------------------------------------------------------------ layout (once per orientation)
  let cw = 390, ch = 844, dpr = 1, ins = { t: 0, r: 0, b: 0, l: 0 }, lastW = 0, lastH = 0;
  const UI = { btn: {}, z0: 1, mm: null };
  function readInsets() { const cs = getComputedStyle($('probe')); ins = { t: parseFloat(cs.paddingTop) || 0, r: parseFloat(cs.paddingRight) || 0, b: parseFloat(cs.paddingBottom) || 0, l: parseFloat(cs.paddingLeft) || 0 }; }
  function layout() {
    readInsets();
    const wasPortrait = UI.portrait;
    cw = Math.max(300, window.innerWidth); ch = Math.max(300, window.innerHeight);
    lastW = window.innerWidth; lastH = window.innerHeight;
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    stage.style.width = cw + 'px'; stage.style.height = ch + 'px';
    canvas.width = Math.round(cw * dpr); canvas.height = Math.round(ch * dpr);
    UI.z0 = ch >= cw ? Math.min(cw / 325, ch / 450) : Math.min(cw / 405, ch / 470);
    UI.portrait = ch >= cw;
    // rotating: held fingers' coordinates mean something else now, so drop them; a toolbar height change keeps them
    if (wasPortrait !== undefined && wasPortrait !== UI.portrait) ptrs.clear();
    layoutButtons();
    for (const q of ptrs.values()) if (q.btn) q.btn = UI.btn[q.btn.key] || null;
    if (G.T) buildMinimap();
    lightC = null;
    if (G.v3) G.v3.resize(cw, ch, save.prMax || 0);
  }
  function layoutButtons() {
    const b = {}, pb = ins.b + 14, small = Math.min(cw, ch) < 420;
    const R = small ? 44 : 50;
    b.driftL = { x: ins.l + 16 + R, y: ch - pb - R, r: R, role: 'drift', label: 'DRIFT' };
    b.driftR = { x: cw - ins.r - 16 - R, y: ch - pb - R, r: R, role: 'drift', label: 'DRIFT' };
    if (UI.portrait) b.item = { x: cw / 2, y: ch - pb - R * 0.86, r: R * 0.86, role: 'item', label: 'ITEM' };
    else b.item = { x: b.driftR.x - R * 0.15, y: b.driftR.y - R - R * 0.86 - 12, r: R * 0.86, role: 'item', label: 'ITEM' }; // landscape: keep the middle clear for the car
    for (const k in b) b[k].key = k;
    UI.btn = b;
    const pbtn = $('pauseBtn'); pbtn.style.top = (ins.t + 10) + 'px'; pbtn.style.right = (ins.r + 10) + 'px';
  }
  function onResize() {
    const coarse = window.matchMedia && window.matchMedia('(pointer: coarse)').matches;
    const flip = (window.innerWidth > window.innerHeight) !== (lastW > lastH);
    if (coarse) { if (flip || Math.abs(window.innerWidth - lastW) > 8 || window.innerHeight < lastH - 30 || (G.screen !== 'race' && Math.abs(window.innerHeight - lastH) > 30)) { layout(); setTimeout(layout, 320); } }
    else { clearTimeout(onResize.t); onResize.t = setTimeout(layout, 80); }
  }
  window.addEventListener('resize', onResize);
  window.addEventListener('orientationchange', () => setTimeout(layout, 350));

  // ------------------------------------------------------------ input
  const ptrs = new Map(); let ptrSeq = 0;
  function hitBtn(x, y) {
    let best = null, bd = 1e9;
    for (const k in UI.btn) { const b = UI.btn[k]; const d = Math.hypot(x - b.x, y - b.y); if (d < b.r * 1.2 && d < bd) { bd = d; best = b; } }
    return best;
  }
  function onDown(e) {
    G.tapped = true;
    if (e.pointerType === 'touch' && !G.touchUI) { G.touchUI = true; }
    if (e.target !== canvas) return; // DOM buttons (pause) handle their own taps
    A.unlock();
    if (G.screen !== 'race') return;
    e.preventDefault();
    const x = e.clientX, y = e.clientY;
    const b = hitBtn(x, y);
    if (G.introT > 0) G.introT = Math.min(G.introT, 0.05); // a tap skips the fly-in
    if (G.race && G.race.phase === 'countdown') G.camSkip = true; // ...and the grid camera swing
    const p = { role: b ? b.role : 'steer', x, y, x0: x, t: ++ptrSeq, btn: b };
    ptrs.set(e.pointerId, p);
    try { stage.setPointerCapture(e.pointerId); } catch (er) {}
    if (p.role === 'item') pressItem();
    if (b) buzz(8);
  }
  function onMove(e) {
    const p = ptrs.get(e.pointerId); if (!p) return;
    p.x = e.clientX; p.y = e.clientY;
    if (p.btn && Math.hypot(p.x - p.btn.x, p.y - p.btn.y) > p.btn.r * 1.8) {
      if (p.role === 'item' || p.role === 'brake') { p.role = 'steer'; p.x0 = p.x; p.t = ++ptrSeq; p.btn = null; }
      else if (p.role === 'drift' && !p.alsoSteer) { p.alsoSteer = true; p.t = ++ptrSeq; }
    }
  }
  function onUp(e) { ptrs.delete(e.pointerId); }
  stage.addEventListener('pointerdown', onDown, { passive: false });
  stage.addEventListener('pointermove', onMove);
  stage.addEventListener('pointerup', onUp);
  stage.addEventListener('pointercancel', onUp);
  stage.addEventListener('lostpointercapture', onUp);
  ['touchstart', 'touchmove'].forEach((ev) => stage.addEventListener(ev, (e) => { if (G.screen === 'race' && e.target === canvas) e.preventDefault(); }, { passive: false }));
  document.addEventListener('contextmenu', (e) => e.preventDefault());
  document.addEventListener('gesturestart', (e) => e.preventDefault());

  function pressItem() {
    const p = G.race && G.race.player; if (!p || G.race.phase !== 'race' || p.finished) return;
    if (p.item || p.roulette > 0) p.inp.use = true; else { G.itemShake = 0.3; }
  }
  const KEYS = { ArrowLeft: 'l', KeyA: 'l', ArrowRight: 'r', KeyD: 'r', ArrowDown: 'd', KeyS: 'd', ShiftLeft: 'drift', ShiftRight: 'drift', KeyX: 'drift' };
  document.addEventListener('pointerdown', () => { G.tapped = true; }, true);
  window.addEventListener('keydown', (e) => {
    A.unlock();
    if (e.code === 'Escape' || e.code === 'KeyP') { if (G.screen === 'race') pauseGame(); else if (G.screen === 'paused') resumeGame(); return; }
    if (G.screen === 'race') {
      if (KEYS[e.code]) { G.kb[KEYS[e.code]] = 1; e.preventDefault(); }
      if ((e.code === 'Space' || e.code === 'KeyZ') && !e.repeat) { pressItem(); e.preventDefault(); }
      if (e.code === 'ArrowUp' || e.code === 'Space') e.preventDefault();
    } else if (e.code === 'Enter' || e.code === 'Space') {
      const primary = document.querySelector('.screen:not([hidden]) .primary'); if (primary) { primary.click(); e.preventDefault(); }
    }
  });
  window.addEventListener('keyup', (e) => { if (KEYS[e.code]) G.kb[KEYS[e.code]] = 0; });
  window.addEventListener('blur', () => { G.kb = { l: 0, r: 0, d: 0, drift: 0 }; ptrs.clear(); if (G.screen === 'race' && !(window.__T && window.__T.noPause)) pauseGame(); });
  document.addEventListener('visibilitychange', () => { if (document.hidden) { if (G.screen === 'race' && !(window.__T && window.__T.noPause)) pauseGame(); A.suspend(); } else A.resume(); });

  // thumb steering: how far the thumb sits from the middle line is how hard you turn.
  // 8 px dead zone in the middle; ~108 px out (x <= 87 or x >= 303 on a 390 px phone) is full lock.
  const STEER_RATE = 9;
  DRD.SUNDAY_GRACE = 3; // Sunday Driver: seconds of immunity after your rig is spun (no mirror in a chase view, so no chained hits)
  DRD.CALM_START = 8; // every class: rivals can't fire an item for the first 8 s after GO
  DRD.syrupGrace = (P, c) => { const fx = Math.cos(c.h), fy = Math.sin(c.h), ox = c.x - fx * 30 - P.x, oy = c.y - fy * 30 - P.y, d = Math.hypot(ox, oy), v = Math.max(P.speed, 120);
    if (ox * Math.cos(P.h) + oy * Math.sin(P.h) > 0 && d < 30 + v * 0.8) P.invT = Math.max(P.invT, (d + 45) / v); };
  DRD.toWobble = (R, c) => { const p = R.T.point(c.s); c.spinKind = 'wobble'; c.spinFrom = c.h; c.spinTot = wrapA(Math.atan2(p.ty, p.tx) - c.h) * 0.5; c.spinDur = c.spinT = 0.6; c.invT = Math.max(c.invT, 1.5); };
  function thumbSteer(x) {
    const span = Math.max(100, Math.min(170, cw * 0.256)), dx = x - cw / 2, u = clamp((Math.abs(dx) - 8) / span, 0, 1);
    return Math.sign(dx) * u * (0.55 + 0.45 * u);
  }
  // lane-keep nudge (Sunday Driver full, Commuter half, Rally Pro none): a person's thumb reacts ~0.2 s late, and in a low
  // chase camera you see less of the corner. When the rig's current heading and turn rate would carry it off the road
  // within ~0.8 s, up to 35% of a look-ahead correction is blended into the thumb. Off at full lock, while drifting or
  // braking, while reversing, and when you're aiming into a shortcut.
  const LANE_KEEP = { sunday: 0.35, commuter: 0.175 };
  DRD.LANE_KEEP = LANE_KEEP;
  function laneKeep(R, p, steer, thumb, busy) {
    const w0 = LANE_KEEP[R.cls.id] || 0;
    if (!w0 || busy || R.phase !== 'race' || p.finished || p.drifting || p.spinT > 0 || p.airT > 0 || !(p.vf > 70)) return steer;
    const T = R.T, C = T.C; if (!(p.k >= 0) || p.k >= T.N || C.KIND[p.k] >= 0) return steer; // on a shortcut: hands off
    const t = 0.8, v = p.speed, hm = p.h + (p.yaw || 0) * t * 0.5;
    const qx = p.x + Math.cos(hm) * v * t, qy = p.y + Math.sin(hm) * v * t;
    const qk = R.nearest(qx, qy); if (qk >= 0 && C.KIND[qk] >= 0) return steer; // heading into a shortcut mouth is a choice
    let i0 = T.idx(p.s + v * t * 0.9), bi = i0, bd = 1e18;
    for (let j = -10; j <= 10; j++) { const i = (i0 + j + T.N) % T.N, d = (qx - T.X[i]) ** 2 + (qy - T.Y[i]) ** 2; if (d < bd) { bd = d; bi = i; } }
    const lat = (qx - T.X[bi]) * -T.TY[bi] + (qy - T.Y[bi]) * T.TX[bi], over = Math.abs(lat) - (T.HW[bi] - 14);
    if (over <= 0) return steer;
    const tp = R.lineAt(p.s + 60 + v * 0.42, 0.5, 0);
    let d = Math.atan2(tp.y - p.y, tp.x - p.x) - p.h; while (d > Math.PI) d -= TAU; while (d < -Math.PI) d += TAU;
    const corr = clamp(d * 2.3, -1, 1);
    const w = w0 * clamp(over / 26, 0, 1) * (1 - clamp((Math.abs(thumb) - 0.85) / 0.15, 0, 1));
    return steer + (corr - steer) * w;
  }
  function readControls() {
    const R = G.race, p = R && R.player; if (!p) return;
    const tap = true;
    let steer = 0, drift = false, brake = false, analog = false, newest = -1, driftSide = 0, driftNewest = -1, sideL = false, sideR = false;
    for (const q of ptrs.values()) {
      if (q.role === 'drift') { drift = true; if (q.alsoSteer && q.t > newest) { newest = q.t; steer = tap ? thumbSteer(q.x) : q.x < cw / 2 ? -1 : 1; analog = tap; } else if (q.t > driftNewest && q.btn && tap) { driftNewest = q.t; driftSide = q.btn.key === 'driftL' ? -1 : 1; } }
      else if (q.role === 'brake') brake = true;
      else if (q.role === 'steer') {
        if (q.x < cw / 2) sideL = true; else sideR = true;
        if (q.t > newest) {
          newest = q.t;
          steer = thumbSteer(q.x);
          analog = true;
        }
      }
    }
    // both thumbs down on opposite halves = brake, then reverse (after a 0.35 s grace, so rolling from one thumb to the other in an S-bend doesn't brake)
    if (tap && sideL && sideR) { if (G.bothT == null) G.bothT = R.t; if (R.t - G.bothT > 0.35) { brake = true; steer = 0; analog = false; } }
    else G.bothT = null;
    const rawThumb = steer;
    if (G.kb.l || G.kb.r) { steer = (G.kb.r ? 1 : 0) - (G.kb.l ? 1 : 0); analog = false; }
    if (G.kb.drift) drift = true;
    if (G.kb.d) brake = true;
    // chase view: the whole world yaws with you, so the thumb is low-passed a little (9 /s instead of the sim's 11 /s)
    const sdt = clamp(R.t - (G.ctrlT || 0), 0, 0.1); G.ctrlT = R.t;
    if (analog) G.sSteer += clamp(steer - G.sSteer, -STEER_RATE * sdt, STEER_RATE * sdt); else G.sSteer = steer;
    if (analog) steer = G.sSteer;
    if (analog && newest >= 0 && !G.kb.l && !G.kb.r) steer = laneKeep(R, p, steer, rawThumb, drift || brake);
    if (G.virt) { if (G.virt.steer != null) steer = G.virt.steer; if (G.virt.drift != null) drift = G.virt.drift; if (G.virt.brake != null) brake = G.virt.brake; }
    if (p.auto) return;
    p.inp.steer = steer; p.inp.drift = drift; p.inp.brake = brake; p.inp.analog = analog;
    p.inp.driftSide = newest < 0 ? driftSide : 0; // DRIFT held with no steering finger: that button's side picks the drift direction
  }
  function buzz(ms) { if (save.buzz && navigator.vibrate && G.touchUI && G.tapped) { try { navigator.vibrate(ms); } catch (e) {} } }

  // ------------------------------------------------------------ race setup
  function startRace(opts) {
    opts = opts || {};
    const ti = opts.track != null ? opts.track : G.trackI;
    G.trackI = ti; G.mode = opts.mode || G.mode;
    G.demo = !!opts.demo;
    const T = track(ti);
    G.T = T;
    ART.prep(T.season);
    // free the previous ground tiles right away (iOS Safari holds canvas memory until GC otherwise)
    if (G.ground) G.ground.tiles.forEach((t) => { if (t) ART.release(t.c); }); // reuse tile canvases instead of allocating ~50 MB per race
    G.ground = G.use3D ? null : ART.buildGround(T); // the 3D view paints the ground itself (no tiles, no wait)
    const D = G.mode === 'daily' && !G.demo ? dailyInfo() : null;
    const cls = D ? D.cls : opts.cls != null ? opts.cls : save.cls;
    const seed = D ? D.seed : opts.seed != null ? opts.seed : Math.floor(Math.random() * 1e9);
    const ro = { cls, seed, mode: G.mode === 'tt' ? 'tt' : 'race', player: G.demo ? -1 : save.rig, itemOnly: D ? D.twist.id : null };
    if (D) ro.nameSeed = D.seed;
    if (G.mode === 'gp' && G.gp) ro.nameSeed = G.gp.nameSeed;
    G.race = new DRD.Race(T, ro);
    if (G.race.player) { G.race.player.skin = ART.paintKey(save.rig, paintOk(save.paint) ? save.paint : 0); G.race.player.paintI = paintOk(save.paint) ? save.paint : 0; }
    if (G.demo) { G.race.countdown = 0.01; if (G.use3D) { for (let i = 0; i < 720; i++) G.race.step(); G.race.ev.length = 0; } } // title demo: start 6 s in, with the field strung out
    G.parts = []; G.pops = []; G.banner = null; G.timeScale = 1; G.slowT = 0; G.hitPause = 0; G.acc = 0; G.flash = 0; G.hitV = 0; G.shake = 0;
    G.resultsQueued = false; G.wrongT = 0; G.finishShownT = 0; G.photo = false; G.photoDone = false; G.prompt = null; G.itemShake = 0; G.itemName = null; G.lapDelta = null; G.bothT = null; G.spinLap = -9; G.dropPop = null;
    G.wheels = G.race.cars.map(() => null);
    G.virt = null; ptrs.clear(); G.kb = { l: 0, r: 0, d: 0, drift: 0 };
    const focus = G.race.player || G.race.cars[0];
    const p0 = T.point(focus.s + 120);
    G.cam.x = p0.x; G.cam.y = p0.y; G.cam.a = focus.h; G.cam.z = UI.z0;
    G.lastPlace = focus.place;
    // ghost (time trial)
    G.ghost = G.mode === 'tt' && !G.demo ? loadGhost(T.id) : null;
    G.ghostRec = G.mode === 'tt' && !G.demo ? { f: [], t0: 0 } : null;
    G.ghostLapStart = 0; G.lastSplit = null;
    buildMinimap();
    initWeather();
    G.introT = G.demo || G.racedOnce ? 0 : 0.8; // brief fly-in before the countdown, first race of the session only
    G.introT0 = G.introT; G.camSkip = false; G.alpha = 1; G.sSteer = 0; G.ctrlT = 0; G.incoming = null; G.passArrow = null; G.ghostNow = null;
    if (G.v3) G.v3.resetCam();
    if (!G.demo) G.racedOnce = true;
    if (!G.demo) G.race.countdown = 3 * DRD.CD_STEP + DT; // 3, 2, 1 at 0.7 s each (the extra step makes the 3 show)
    G.hintT = 0;
  }

  // ------------------------------------------------------------ events -> juice
  function camDist(x, y) { return Math.hypot(x - G.cam.x, y - G.cam.y); }
  function handleEvents() {
    const R = G.race; if (!R) return;
    const P = R.player;
    for (const e of R.ev) {
      const c = e.c >= 0 ? R.cars[e.c] : null;
      const mine = c && c === P;
      A.pan = !mine && G.use3D && !G.demo ? panFor(c ? c.x : e.x, c ? c.y : e.y) : 0;
      const near = c ? camDist(c.x, c.y) < 420 : (e.x != null ? camDist(e.x, e.y) < 420 : false);
      const audible = !G.demo && (mine || near);
      switch (e.t) {
        case 'count': if (!G.demo) { A.count(e.n); G.banner = { text: String(e.n), t: 0, dur: 0.7, big: true }; } break;
        case 'go': if (!G.demo) { A.go(); G.banner = { text: 'GO!', t: 0, dur: 0.9, big: true, col: '#ffd34d' }; buzz(25); A.applyMusic(true, 'race'); } break;
        case 'crate': burst(e.x, e.y, 'splinter', 14); if (audible) A.crate(); if (mine) buzz(12); break;
        case 'roulette': break;
        case 'gotItem':
          // a calm start on every class: no rival can fire anything for the first 8 s after GO (their roulette just runs long)
          if (c && !mine && !G.demo && P && R.raceT < DRD.CALM_START) { c.item = null; c.itemN = 0; c.inp.use = false; c.roulette = DRD.CALM_START - R.raceT + 0.25 + (c.i * 0.29 % 1) * 1.2; break; } // staggered, so the pack doesn't all fire at once at 8 s
          if (mine && !G.demo) { A.gotItem(); G.itemPop = 0.4; G.itemName = { text: (e.n > 1 ? e.n + ' × ' : '') + ITEM_NAMES[e.item], t: 0 }; if (!save.hints.item) G.prompt = { text: 'Tap ITEM to use it!', t: 0, dur: 3, btn: 'item' }; } break;
        case 'useItem':
          // Sunday Driver: a pinecone or snowball thrown at you from point-blank (no time to see or dodge it) bounces off
          if (P && c && c !== P && R.cls.id === 'sunday' && (e.item === 'pine' || e.item === 'snow') && !P.finished) {
            const dx = P.x - c.x, dy = P.y - c.y; if (dx * dx + dy * dy < 125 * 125 && dx * Math.cos(c.h) + dy * Math.sin(c.h) > 0) P.invT = Math.max(P.invT, 0.5);
          }
          // ...and syrup dropped right in front of you (under ~0.8 s away, too close to steer round) doesn't catch you
          if (P && c && c !== P && R.cls.id === 'sunday' && e.item === 'syrup' && !P.finished) DRD.syrupGrace(P, c);
          if (audible) { if (e.item === 'donut') A.boost(1); else if (e.item === 'pine' || e.item === 'snow') A.throw(); else A.thump(); }
          if (mine) { save.hints.item = true; if (G.prompt && G.prompt.btn === 'item') G.prompt = null; if (e.item === 'syrup' || e.item === 'hay') { G.dropPop = { item: e.item, t: 0 }; buzz(10); } }
          if (e.item === 'donut' && c) { for (let i = 0; i < 10; i++) part(c.x, c.y, 'sugar'); if (V3on()) G.v3.donut(c.i); if (mine) { G.kick = 0.8; G.shake = Math.max(G.shake, 3); G.speedT = 1.3; if (V3on()) G.v3.boost(); } }
          break;
        case 'hop': if (mine) A.hop(); break;
        case 'rocket': if (mine) { A.boost(2); G.speedT = 0.9; if (V3on()) G.v3.boost(); G.shake = Math.max(G.shake, 5); G.kick = 1; pop(c, 'ROCKET START!', '#ffd34d'); buzz(30); save.hints.rocket = (save.hints.rocket || 0) + 1; persist(); for (let i = 0; i < 16; i++) part(c.x - Math.cos(c.h) * 18, c.y - Math.sin(c.h) * 18, Math.random() < 0.5 ? 'orange' : 'smoke'); } break;
        case 'bog': if (mine) { A.bog(); for (let i = 0; i < 14; i++) part(c.x - Math.cos(c.h) * 16, c.y - Math.sin(c.h) * 16, 'smoke', null, null, { size: 5, life: 0.9 }); } break;
        case 'draft': if (mine) { A.draft(); pop(c, 'SLIPSTREAM', '#cfeaff'); } break;
        case 'driftStart': break;
        case 'driftTier': if (mine) { A.driftTier(e.tier); buzz(6); } break;
        case 'miniBoost': if (audible) A.boost(e.tier); if (mine) { if (V3on()) G.v3.boost(); G.speedT = e.tier === 2 ? 1.15 : 0.6; G.kick = e.tier === 2 ? 0.9 : 0.5; G.shake = Math.max(G.shake, e.tier * 2); pop(c, e.tier === 2 ? 'SUPER BOOST!' : 'BOOST!', e.tier === 2 ? '#ff6a48' : '#ffd34d'); buzz(15); if (!save.hints.drift) { save.hints.drift = true; persist(); G.prompt = null; } } break;
        case 'spin':
          if (mine && R.cls.id === 'sunday') {
            // Sunday Driver: the tractor only bumps you (no wobble), and a spin is followed by 3 s in which nothing can spin you again
            if (e.kind === 'wobble' && G.tractorHitT === R.raceT) { c.spinT = 0; c.hits = Math.max(0, c.hits - 1); c.invT = 0.4; break; }
            // ...a snowball (it rolls up from behind, where a chase view can't see) is a wobble, and at most one full spin
            // a lap: after the first, a hit that lap is only a wobble
            if (e.kind === 'spin') { const snow = R.ev.some((x) => x.t === 'hit' && x.c === c.i && x.item === 'snow'); if (snow || G.spinLap === c.lapIdx) DRD.toWobble(R, c); else G.spinLap = c.lapIdx; }
            c.invT = Math.max(c.invT, c.spinT + DRD.SUNDAY_GRACE);
          }
          if (audible) A.spin();
          if (mine) { G.shake = Math.max(G.shake, 6); G.hitPause = 0.07; buzz(60); if (V3on()) G.v3.shake(1.5); } break;
        case 'hit':
          if (e.item === 'syrup') { burst(e.x, e.y, 'syrup', 12); if (audible) A.splat(); }
          else if (e.item === 'hay') { burst(e.x, e.y, 'hay', 22); if (audible) A.thump(); }
          else if (e.item === 'pine') { burst(e.x, e.y, 'pine', 10); if (audible) A.knock(); }
          else { burst(e.x, e.y, 'snow', 22); if (audible) A.puff(); }
          if (P && e.by === P.i && !mine && !G.demo) buzz(20);
          if (mine) { G.hitV = 0.55; if (V3on()) G.v3.shake(1.5); const by = e.by != null && R.cars[e.by]; if (by && by !== c && !G.demo) pop(c, by.name + ' got you!', '#ff9a7a', true); }
          break;
        case 'poof': burst(e.x, e.y, e.item === 'snow' ? 'snow' : e.item === 'hay' ? 'hay' : e.item === 'syrup' ? 'syrup' : 'pine', 10); if (near && !G.demo) A.puff(); break;
        case 'pineBounce': if (near && !G.demo) A.knock(); break;
        case 'wall': if (audible) A.wall(e.v); burst(e.x, e.y, R.T.season === 'winter' ? 'snow' : 'dust', 6); if (mine) { G.shake = Math.max(G.shake, Math.min(5, e.v / 60)); buzz(10); if (e.v > 150 && V3on()) G.v3.shake(Math.min(1.5, e.v / 200)); } break;
        case 'bump': if (audible) A.bump(e.v); burst(e.x, e.y, 'spark', 6); if (mine || (P && e.other === P.i)) { G.shake = Math.max(G.shake, Math.min(4, e.v / 70)); buzz(12); } break;
        case 'tractorHit': if (audible) A.thump(); if (mine) { G.tractorHitT = R.raceT; G.shake = 7; G.hitPause = 0.08; buzz(50); if (V3on()) G.v3.shake(1.5); } break;
        case 'heave': if (mine) { A.heave(e.big); G.shake = Math.max(G.shake, e.big ? 4 : 2); } if (c) burst(c.x, c.y, R.T.season === 'winter' ? 'snow' : 'dust', e.big ? 10 : 4); break;
        case 'land': if (mine) { A.land(); G.shake = Math.max(G.shake, 4); buzz(25); if (V3on()) G.v3.shake(1.2); } if (c) burst(c.x, c.y, R.T.season === 'winter' ? 'snow' : 'dust', 12); break;
        case 'tow': if (mine) A.tow(); if (c) burst(c.x, c.y, 'dust', 16); if (c && V3on() && c.px != null) G.v3.tow(c.i, c.px, c.py); break;
        case 'lap': if (mine) { A.lap(e.final); if (e.final) A.musicMood('final'); G.banner = { text: e.final ? 'FINAL LAP!' : 'LAP ' + e.lap, t: 0, dur: 1.6, col: e.final ? '#ff8a3d' : '#fff', sub: fmt(e.time) }; lapGhost(c, e.time); lapDelta(c, e.time); } break;
        case 'finish': if (mine) onPlayerFinish(e); break;
        case 'place': if (mine && !G.demo && R.raceT > 3) { A.pass(e.to < e.from); if (R.cars.some((q) => q !== c && camDist(q.x, q.y) < 90 && Math.hypot(q.x - c.x, q.y - c.y) < 70)) A.whoosh(e.to < e.from); if (e.to < e.from) G.placePop = 0.5; } break;
        case 'done': break;
      }
    }
    R.ev.length = 0; A.pan = 0;
  }
  // stereo: rival hits and crashes come from where they are on screen
  function panFor(x, y) { if (x == null) return 0; const a = G.cam.a, lat = (x - G.cam.x) * -Math.sin(a) + (y - G.cam.y) * Math.cos(a); return clamp(lat / 180, -1, 1) * 0.75; }

  // ------------------------------------------------------------ particles
  const ITEM_NAMES = { syrup: 'Syrup slick', donut: 'Cider donut', pine: 'Pinecone', snow: 'Snowball', hay: 'Hay bale' };
  const PCOL = {
    mud: ['#4a3220', '#5e4229', '#6e5034'], dust: ['#b39470', '#c9ad86', '#9c7d5a'], snow: ['#ffffff', '#e8f2fa', '#cfe0ee'], leaf: ['#d9531e', '#e8862a', '#f2b632', '#b8321f'],
    splinter: ['#c99a5c', '#a06a32', '#e2bd85', '#c6281c'], syrup: ['#d98a1d', '#b8640f', '#f0b04a'], hay: ['#f0cf6a', '#d9b34a', '#b88f2c'], pine: ['#8a5228', '#a8682f', '#5a3416'],
    spark: ['#fff2b0', '#ffd34d', '#ffffff'], sugar: ['#fff6dc', '#ffe9b8'], blue: ['#9fe2ff', '#5cc4ff', '#ffffff'], gold: ['#ffe27a', '#ffd34d', '#fff6c8'], red: ['#ff5a3c', '#ff8a5a', '#ffd0a0'], orange: ['#ffb24d', '#ff7a2a', '#fff0a0'], smoke: ['rgba(90,80,70,.5)'], water: ['#9fd2ea', '#d5eef8']
  };
  function part(x, y, type, vx, vy, opt) {
    if (G.parts.length > 520) return;
    const cols = PCOL[type] || PCOL.dust;
    const a = Math.random() * TAU, sp = (opt && opt.sp) || (40 + Math.random() * 120);
    G.parts.push({ x, y, vx: vx != null ? vx : Math.cos(a) * sp, vy: vy != null ? vy : Math.sin(a) * sp, z: 0, vz: (opt && opt.vz) != null ? opt.vz : 40 + Math.random() * 80,
      life: 0, max: (opt && opt.life) || 0.5 + Math.random() * 0.5, size: (opt && opt.size) || (2 + Math.random() * 3), col: cols[Math.floor(Math.random() * cols.length)], type, rot: Math.random() * TAU, vr: (Math.random() - 0.5) * 12, sv: 0.6 + Math.random() * 0.8 });
  }
  function burst(x, y, type, n) { if (x == null || camDist(x, y) > 900) return; for (let i = 0; i < n; i++) part(x, y, type, null, null, { sp: 60 + Math.random() * 160, vz: 60 + Math.random() * 120, size: type === 'splinter' || type === 'hay' ? 2.5 + Math.random() * 3 : null }); }
  function pop(c, text, col, top) { if (G.demo) return; G.pops = [{ text, col: col || '#fff', t: 0, top: !!top }]; } // one at a time, beside your car (never on the road ahead); "X got you!" sits centred in the top third
  // every call-out stays inside the screen with a 12 px margin, at its largest (pop-in) scale too
  function popPlace(q, px, py, gap) {
    const s = 1 + 0.3 * Math.max(0, 1 - q.t * 7);
    let size = q.top ? 20 : 18; ctx.font = size + 'px "Alfa Slab One", serif'; let w = ctx.measureText(q.text).width;
    const room = cw - 24 - 4; if (w * 1.3 > room) { size = Math.floor(size * room / (w * 1.3)); ctx.font = size + 'px "Alfa Slab One", serif'; w = ctx.measureText(q.text).width; }
    let cx, y;
    if (q.top) { cx = cw / 2; y = (G.use3D ? Math.max(ins.t + 150, ch * (UI.portrait ? 0.2 : 0.3)) : ch * 0.36) + (G.banner ? 62 : 0) - q.t * 10; }
    else { const right = px + gap + w <= cw - 12 || px < cw / 2; cx = right ? px + gap + w / 2 : px - gap - w / 2; y = py - q.t * 14; }
    const half = (w * s) / 2 + 2; cx = clamp(cx, 12 + half, cw - 12 - half);
    return { cx, y, s };
  }
  function drawPop(q, px, py, gap) {
    const o = popPlace(q, px, py, gap), k = q.t / 1.1;
    ctx.globalAlpha = 1 - Math.max(0, k - 0.65) / 0.35;
    ctx.save(); ctx.translate(o.cx, o.y); ctx.scale(o.s, o.s); ctx.textAlign = 'center';
    ctx.lineJoin = 'round'; ctx.lineWidth = 4; ctx.strokeStyle = 'rgba(30,18,8,.85)'; ctx.strokeText(q.text, 0, 0); ctx.fillStyle = q.col; ctx.fillText(q.text, 0, 0); ctx.restore();
    ctx.globalAlpha = 1;
  }

  function updateParts(dt) {
    for (const p of G.parts) {
      p.life += dt; p.x += p.vx * dt; p.y += p.vy * dt;
      const drag = p.type === 'smoke' ? 1.5 : p.type === 'leaf' ? 2.2 : 3;
      p.vx *= Math.exp(-drag * dt); p.vy *= Math.exp(-drag * dt);
      if (p.type === 'steam') { p.z += p.vz * dt; p.size += 9 * dt; continue; }
      p.vz -= 320 * dt; p.z = Math.max(0, p.z + p.vz * dt); if (p.z <= 0 && p.vz < 0) p.vz *= -0.25;
      p.rot += p.vr * dt;
      if (p.type === 'smoke') p.size += 14 * dt;
    }
    G.parts = G.parts.filter((p) => p.life < p.max);
    for (const q of G.pops) q.t += dt;
    G.pops = G.pops.filter((q) => q.t < 1.1);
  }

  // per-car continuous effects: spray, tracks, sparks, exhaust
  function carFx(c, i, dt) {
    const T = G.T, R = G.race;
    const near = camDist(c.x, c.y) < 700;
    const fx = Math.cos(c.h), fy = Math.sin(c.h), rx = -fy, ry = fx;
    const spd = c.speed;
    // tire tracks (decals on the ground)
    const sl = Math.abs(c.slip || 0);
    const surf = c.surf;
    const marking = spd > 40 && c.airT <= 0 && (c.drifting || sl > 55 || (c.inp.brake && c.vf > 120) || c.mudT > 0 || surf === S.MUD || surf === S.SHOULDER || surf === S.LEAVES || (T.season === 'winter' && surf !== S.ICE) || c.spinT > 0);
    const wl = G.wheels[i];
    const rw = [[c.x - fx * 11 + rx * 7.5, c.y - fy * 11 + ry * 7.5], [c.x - fx * 11 - rx * 7.5, c.y - fy * 11 - ry * 7.5]];
    if (marking && wl) {
      const d = Math.hypot(rw[0][0] - wl[0][0], rw[0][1] - wl[0][1]);
      if (d > 5) {
        let col;
        if (surf === S.MUD || (c.mudT > 0 && surf !== S.SHOULDER)) col = 'rgba(52,32,16,' + (surf === S.MUD ? 0.42 : 0.28 * Math.min(1, c.mudT)) + ')';
        else if (T.season === 'winter') col = surf === S.ROAD || surf === S.HEAVE || surf === S.BRIDGE ? 'rgba(120,110,100,.16)' : 'rgba(150,170,195,.35)';
        else if (surf === S.SHOULDER || surf === S.LEAVES) col = 'rgba(40,48,20,.24)';
        else col = c.drifting || sl > 55 ? 'rgba(45,28,16,.26)' : 'rgba(60,40,24,.14)';
        if (d < 30) for (let w = 0; w < 2; w++) { if (G.ground) ART.decal(G.ground, wl[w][0], wl[w][1], rw[w][0], rw[w][1], c.drifting ? 4.2 : 3.6, col); else if (V3on() && camDist(c.x, c.y) < 900) G.v3.skid(wl[w][0], wl[w][1], rw[w][0], rw[w][1], c.drifting ? 4.2 : 3.6, col); }
        G.wheels[i] = rw;
      }
    } else G.wheels[i] = rw;
    if (!near) return;
    if (R.phase === 'countdown') { // revving on the grid: the rear wheels throw dust while DRIFT is held
      if (c.revT > 0 && Math.random() < 0.6) { const w = rw[Math.random() < 0.5 ? 0 : 1]; part(w[0], w[1], T.season === 'winter' ? 'snow' : 'dust', -fx * (60 + Math.random() * 60) + (Math.random() - 0.5) * 40, -fy * (60 + Math.random() * 60) + (Math.random() - 0.5) * 40, { vz: 40 + Math.random() * 60, life: 0.5, size: 2.5 + Math.random() * 2 }); }
      return;
    }
    // spray / dust
    const rate = spd / 320;
    if (spd > 70 && c.airT <= 0) {
      let type = null, n = 0;
      if (surf === S.MUD) { type = 'mud'; n = 3; }
      else if (surf === S.SHOULDER || surf === S.LEAVES) { type = T.season === 'winter' ? 'snow' : surf === S.LEAVES ? 'leaf' : 'dust'; n = 1.4; }
      else if (T.season === 'winter' && surf !== S.ICE) { type = 'snow'; n = c.drifting ? 1.6 : 0.4; }
      else if (c.drifting || sl > 60) { type = surf === S.ICE ? 'snow' : 'dust'; n = 1.2; }
      else if (surf === S.DIRT) { type = 'dust'; n = 0.5; }
      if (type) {
        const cnt = n * rate * 60 * dt;
        let k = Math.floor(cnt); if (Math.random() < cnt - k) k++;
        for (let q = 0; q < k; q++) {
          const w = rw[Math.random() < 0.5 ? 0 : 1];
          const back = -0.55 - Math.random() * 0.4, side = (Math.random() - 0.5) * 0.9;
          part(w[0], w[1], type, c.vx * 0.25 + (fx * back + rx * side) * (60 + spd * 0.35), c.vy * 0.25 + (fy * back + ry * side) * (60 + spd * 0.35), { vz: 50 + Math.random() * 110, life: type === 'leaf' ? 1.2 : 0.45 + Math.random() * 0.35, size: type === 'mud' ? 2.2 + Math.random() * 2.8 : type === 'leaf' ? 3 : 2 + Math.random() * 2.5 });
        }
      }
    }
    // drift sparks by tier
    // drift sparks grow with the charge: a few pale ones while it builds, gold at tier 1, a red stream at tier 2
    if (c.drifting) {
      const ch2 = clamp(c.driftT / DRD.DRIFT_T2, 0, 1), cnt = c.driftTier === 2 ? 2 : c.driftTier === 1 ? 1 : (Math.random() < ch2 * 0.8 ? 1 : 0);
      for (let q = 0; q < cnt; q++) {
        const w = rw[c.driftDir > 0 ? 1 : 0];
        part(w[0], w[1], c.driftTier === 2 ? 'red' : c.driftTier === 1 ? 'gold' : 'sugar', c.vx * 0.2 + (Math.random() - 0.5) * 90, c.vy * 0.2 + (Math.random() - 0.5) * 90, { vz: 60 + Math.random() * 60, life: 0.22 + Math.random() * 0.15 + ch2 * 0.08, size: (c.driftTier ? 1.6 : 1.1) + Math.random() * 1.4 + ch2 * 0.6 });
      }
    }
    // boost flames + smoke
    if (c.boostT > 0 && Math.random() < 0.8) part(c.x - fx * 18, c.y - fy * 18, Math.random() < 0.6 ? 'orange' : 'smoke', c.vx * 0.3 - fx * 80 + (Math.random() - 0.5) * 40, c.vy * 0.3 - fy * 80 + (Math.random() - 0.5) * 40, { vz: 10, life: 0.3 + Math.random() * 0.2, size: 3 + Math.random() * 3 });
  }

  // ------------------------------------------------------------ ghost (time trial)
  function recordGhost() {
    const R = G.race, p = R.player; if (!G.ghostRec || !p || p.finished || R.phase !== 'race') return;
    const lt = R.raceT - p.lapStart;
    const f = G.ghostRec.f;
    if (!f.length || lt - f[f.length - 1][0] >= 1 / 30) f.push([+lt.toFixed(3), Math.round(p.x), Math.round(p.y), +p.h.toFixed(2)]);
  }
  function lapGhost(c, lapTime) {
    if (G.mode !== 'tt' || !G.ghostRec) return;
    const T = G.T, best = save.tt[T.id];
    if (c.lapTimes.length === 1) { G.ghostRec.f = []; G.lastSplit = null; return; } // lap 1 is a standing start: ghosts are flying laps only
    if (!best || lapTime < best.lap) {
      const g = { lap: lapTime, rig: c.rig.id, f: G.ghostRec.f };
      saveGhost(T.id, g); G.ghost = g;
      save.tt[T.id] = Object.assign({}, best || {}, { lap: lapTime }); persist();
      G.lastSplit = { d: best ? lapTime - best.lap : null, rec: true };
    } else G.lastSplit = { d: lapTime - best.lap, rec: false };
    G.ghostRec.f = [];
  }
  function ghostPos() {
    const g = G.ghost, R = G.race, p = R && R.player; if (!g || !p || R.phase !== 'race' || p.finished || p.lapIdx < 1) return null;
    const lt = R.raceT - p.lapStart, f = g.f;
    if (lt > f[f.length - 1][0]) return null;
    let lo = 0, hi = f.length - 1;
    while (hi - lo > 1) { const m = (lo + hi) >> 1; if (f[m][0] <= lt) lo = m; else hi = m; }
    const a = f[lo], b = f[hi], u = clamp((lt - a[0]) / Math.max(1e-3, b[0] - a[0]), 0, 1);
    return { x: lerp(a[1], b[1], u), y: lerp(a[2], b[2], u), h: a[3] + wrapA(b[3] - a[3]) * u, rig: g.rig };
  }

  // lap 2 and 3: your lap against your best lap on this track and class (time trial: against the ghost lap)
  function lapDelta(c, lapTime) {
    if (G.demo || c.lapTimes.length < 2) return; // lap 1 is a standing start
    if (G.mode === 'tt') { if (G.lastSplit && G.lastSplit.d != null) G.lapDelta = { d: G.lastSplit.d, t: 0 }; return; }
    const b = save.best[G.T.id + '_' + G.race.cls.id];
    let ref = b && b.lap ? b.lap : Infinity;
    for (let i = 1; i < c.lapTimes.length - 1; i++) ref = Math.min(ref, c.lapTimes[i]);
    if (isFinite(ref)) G.lapDelta = { d: lapTime - ref, t: 0 };
  }

  // ------------------------------------------------------------ finish, results
  function onPlayerFinish(e) {
    const R = G.race, p = R.player;
    p.auto = true; // cool-down lap on autopilot
    if (G.mode === 'tt') lapGhost(p, p.lapTimes[p.lapTimes.length - 1]); // the final lap counts for the ghost too
    lapDelta(p, p.lapTimes[p.lapTimes.length - 1]);
    A.finish(e.place); if (e.place <= 3 && G.mode !== 'tt') setTimeout(() => A.cheer(e.place === 1), 250);
    G.banner = { text: G.mode === 'tt' ? 'FINISH!' : ordinal(e.place).toUpperCase() + '!', t: 0, dur: 2.6, big: true, col: e.place === 1 ? '#ffd34d' : e.place <= 3 ? '#fff' : '#d6c6b0', sub: fmt(e.time) };
    buzz(e.place === 1 ? [40, 60, 40] : 30);
    if (e.place <= 3) for (let i = 0; i < 40; i++) part(p.x, p.y, Math.random() < 0.5 ? 'orange' : 'spark', null, null, { sp: 80 + Math.random() * 200, vz: 150 + Math.random() * 150, life: 1.2, size: 3 });
    G.finishShownT = 2.8;
    if (G.photo) { G.photoDone = true; A.shutter(); G.flash = 0.6; G.flashCol = 'rgba(255,255,255,'; setTimeout(() => { if (G.banner) G.banner.sub2 = 'PHOTO FINISH!'; }, 10); }
  }
  function finishRaceFast() {
    const R = G.race; let n = 0;
    while (!R.done && n < 120 * 40) { R.step(); R.ev.length = 0; n++; }
    for (const c of R.cars) { c.px = c.x; c.py = c.y; c.ph = c.h; } G.alpha = 1; // the results orbit sits on the final pose
    if (!R.done) { R.raceT += 0; }
  }
  function showResults() {
    const R = G.race, T = G.T, p = R.player;
    finishRaceFast();
    G.screen = 'results'; A.engine(false, 0, 0, 0); A.applyMusic(false);
    save.races++;
    const isTT = G.mode === 'tt';
    const place = p.place, time = p.finishT;
    const bestLap = Math.min(...p.lapTimes), flyBest = p.lapTimes.length > 1 ? Math.min(...p.lapTimes.slice(1)) : bestLap;
    let rec = '';
    const key = T.id + '_' + R.cls.id;
    if (!isTT) {
      const b = save.best[key] || {};
      if (!b.time || time < b.time) { if (b.time) rec = 'New best time!'; b.time = time; }
      if (!b.place || place < b.place) b.place = place;
      if (!b.lap || bestLap < b.lap) b.lap = bestLap;
      const md = DRD.medal(T.id, R.cls.id === 'sunday' ? 0 : R.cls.id === 'commuter' ? 1 : 2, time);
      const rank = md && md.medal ? ['gold', 'silver', 'bronze'].indexOf(md.medal) : 9;
      if (b.medal == null || rank < b.medal) b.medal = rank;
      save.best[key] = b;
      G.medalRes = md;
    } else {
      const b = save.tt[T.id] || {};
      if (!b.total || time < b.total) { if (b.total) rec = 'New best race time!'; b.total = time; }
      save.tt[T.id] = b;
    }
    // promotion: a win moves you up a class, two last places in a row move you down one (single races)
    let promo = '';
    if (G.mode === 'single' && R.cls.id === DRD.CLASSES[save.cls].id) {
      if (place === 1 && save.cls < DRD.CLASSES.length - 1) { save.cls++; save.lastSix = 0; promo = 'PROMOTED: ' + DRD.CLASSES[save.cls].name.toUpperCase(); }
      else if (place === R.cars.length) { save.lastSix = (save.lastSix || 0) + 1; if (save.lastSix >= 2 && save.cls > 0) { save.cls--; save.lastSix = 0; promo = 'Next race: ' + DRD.CLASSES[save.cls].name + ' (win it to move back up)'; } }
      else save.lastSix = 0;
    }
    let unlock = '';
    if (!isTT && place === 1) { save.wins = (save.wins || 0) + 1; const np = DRD.PAINTS.find((P) => P.need === save.wins); if (np) unlock = 'NEW PAINT: ' + np.name + '! Pick it in the Garage.'; }
    if (!isTT && place === 1 && R.cls.id !== 'sunday' && !save.mirror) { save.mirror = true; unlock = (unlock ? unlock + '\n' : '') + 'NEW: Mirror roads unlocked! Find them under Modes › Pick track.'; }
    let dailyLine = '';
    G.share = null;
    if (G.mode === 'daily') {
      const D = dailyInfo(), d = save.daily && save.daily.key === D.key ? save.daily : { key: D.key, tries: 0 };
      const first = !d.tries;
      d.tries++;
      if (first) { d.place = place; d.time = time; } // the first finish of the day is the one that counts
      else if (!d.pPlace || place < d.pPlace || (place === d.pPlace && time < d.pTime)) { d.pPlace = place; d.pTime = time; }
      save.daily = d;
      const st = save.streak || { n: 0, last: '' };
      if (first) { st.n = st.last === yesterdayKey() ? st.n + 1 : st.last === D.key ? st.n : 1; st.last = D.key; save.streak = st; }
      dailyLine = (first ? 'Daily Derby: this run counts! ' : 'Practice run. Today\'s official: ') + ordinal(d.place) + ' · ' + fmt(d.time) + '\nstreak 🔥' + st.n + (first && st.n > 1 ? ' (+1 today)' : '') + (first ? '  ·  come back tomorrow for a new road' : '');
      G.share = 'Dirt Road Derby · Daily ' + D.key + '\n' + DRD.ALL_DEFS[D.track].name + ' · ' + D.twist.name + '\n' + ['🥇', '🥈', '🥉'][d.place - 1] + ' ' + ordinal(d.place) + ' of 6 · ' + fmt(d.time) + '  🔥' + st.n;
      G.share = G.share.replace('undefined ', '🏁 ');
    }
    persist();
    // build table
    const rows = [];
    let gpAward = null;
    if (G.mode === 'gp') {
      gpAward = {};
      R.order.forEach((c, i) => { const pts = DRD.POINTS[i] || 0; gpAward[c.name] = pts; G.gp.pts[c.name] = (G.gp.pts[c.name] || 0) + pts; G.gp.rig[c.name] = c.rig.id; });
      G.gp.round++;
    }
    const leader = R.order[0].finishT;
    R.order.forEach((c, i) => {
      const t = i === 0 ? fmt(c.finishT) : '+' + (c.finishT - leader).toFixed(2);
      rows.push(`<div class="row${c.isPlayer ? ' me' : ''}"><b>${i + 1}</b><span class="sw" style="background:${c.isPlayer && c.skin && DRD.PAINTS[save.paint] && DRD.PAINTS[save.paint].body ? DRD.PAINTS[save.paint].body : c.rig.body}"></span><span class="nm">${c.name}</span><span class="tm">${t}${c.estimated ? '<small> est.</small>' : ''}</span>${gpAward ? `<span class="pt">+${gpAward[c.name]}</span>` : ''}</div>`);
    });
    if (V3on()) { const cv = $('rsCar'); cv.getContext('2d').clearRect(0, 0, cv.width, cv.height); cv.className = 'rscar' + (place === 1 && !isTT ? ' win' : ''); }
    else { const cv = $('rsCar'), g = cv.getContext('2d'), sp = ART.ASSETS[p.skin] || ART.ASSETS['car' + p.rig.id]; g.setTransform(1, 0, 0, 1, 0, 0); g.clearRect(0, 0, cv.width, cv.height);
      g.translate(cv.width / 2, cv.height / 2 + 4); g.fillStyle = 'rgba(0,0,0,.3)'; g.beginPath(); g.ellipse(10, 14, 150, 52, 0, 0, TAU); g.fill();
      const k = 7.4; g.drawImage(sp.c || sp, -sp.ox / ART.CS * k, -sp.oy / ART.CS * k, (sp.c || sp).width / ART.CS * k, (sp.c || sp).height / ART.CS * k);
      cv.className = 'rscar' + (place === 1 && !isTT ? ' win' : ''); }
    $('rsHead').textContent = isTT ? 'TIME TRIAL' : ordinal(place) + ' place';
    $('rsHead').className = 'place p' + Math.min(4, place);
    $('rsTrack').textContent = T.name + (isTT ? '' : ' · ' + R.cls.name);
    $('rsTable').innerHTML = isTT ? `<div class="row me"><b>⏱</b><span class="nm">Race</span><span class="tm">${fmt(time)}</span></div>` + p.lapTimes.map((t, i) => `<div class="row"><b>${i + 1}</b><span class="nm">Lap ${i + 1}${i > 0 && t === flyBest ? ' ★' : i === 0 ? ' <small>standing start</small>' : ''}</span><span class="tm">${fmt(t)}</span></div>`).join('') : rows.join('');
    const tb = save.tt[T.id];
    $('rsNote').textContent = [rec || (isTT ? (tb && tb.lap ? 'Best lap ' + fmt(tb.lap) + (G.ghost ? ' · ghost saved' : '') : '') : 'Best lap ' + fmt(bestLap)), dailyLine].filter(Boolean).join('\n');
    $('rsNote').className = 'note' + (rec ? ' rec' : '');
    { const md = !isTT ? G.medalRes : null; let html = '';
      if (md) {
        const nm = (k) => k[0].toUpperCase() + k.slice(1);
        if (md.medal) html = `<span class="medal ${md.medal}"></span>${nm(md.medal)} medal` + (md.next ? ` <span class="gap">· ${md.next.gap.toFixed(1)} s off ${md.next.name}</span>` : '!');
        else html = `<span class="gap">${md.next.gap.toFixed(1)} s off a bronze medal</span>`;
      }
      if (promo) html += (html ? '<br>' : '') + `<span class="promo">${promo}</span>`;
      $('rsMedal').innerHTML = html; $('rsMedal').hidden = !html; G.medalRes = null; }
    $('rsUnlock').textContent = unlock; $('rsUnlock').hidden = !unlock;
    const gpDone = G.mode === 'gp' && G.gp.round >= 4;
    $('btnAgain').hidden = G.mode === 'gp'; $('btnAgain').textContent = G.mode === 'daily' ? 'PRACTICE' : 'RACE AGAIN';
    $('btnShare').hidden = !G.share; $('btnShare').textContent = 'Share result';
    $('btnNext').hidden = !(G.mode === 'gp' && !gpDone) && !(G.mode !== 'gp' && G.mode !== 'daily');
    $('btnNext').textContent = G.mode === 'gp' ? 'Next race ›' : 'Next track ›';
    $('btnPodium').hidden = !gpDone;
    $('btnAgain').classList.toggle('primary', G.mode !== 'gp');
    $('btnNext').classList.toggle('primary', G.mode === 'gp' && !gpDone);
    $('btnPodium').classList.toggle('primary', gpDone);
    if (G.mode === 'gp') {
      const st = standings();
      $('rsGP').hidden = false;
      $('rsGP').innerHTML = `<div class="lab">Grand Prix standings · race ${G.gp.round}/4</div>` + st.map((s, i) => `<div class="row${s.name === 'You' ? ' me' : ''}"><b>${i + 1}</b><span class="sw" style="background:${DRD.RIGS[s.rig].body}"></span><span class="nm">${s.name}</span><span class="tm">${s.pts} pts</span></div>`).join('');
    } else $('rsGP').hidden = true;
    G.confetti = place <= 3 && !isTT ? [] : null;
    show('results');
  }
  function standings() { return Object.keys(G.gp.pts).map((n) => ({ name: n, pts: G.gp.pts[n], rig: G.gp.rig[n] })).sort((a, b) => b.pts - a.pts || (a.name === 'You' ? -1 : b.name === 'You' ? 1 : a.name.localeCompare(b.name))); }
  function showPodium() {
    const st = standings();
    const myPlace = st.findIndex((s) => s.name === 'You') + 1;
    const cls = DRD.CLASSES[G.gp.cls];
    const prev = save.gp[cls.id];
    if (!prev || myPlace < prev) { save.gp[cls.id] = myPlace; persist(); }
    if (myPlace <= 3 && !save.mirror) { save.mirror = true; persist(); $('pdSub').dataset.unlock = '1'; }
    $('pdHead').textContent = myPlace === 1 ? 'CHAMPION!' : ordinal(myPlace) + ' overall';
    $('pdSub').textContent = cls.name + ' Grand Prix' + ($('pdSub').dataset.unlock ? ' · Mirror roads unlocked!' : ''); delete $('pdSub').dataset.unlock;
    $('pdTable').innerHTML = st.map((s, i) => `<div class="row${s.name === 'You' ? ' me' : ''}"><b>${i + 1}</b><span class="sw" style="background:${DRD.RIGS[s.rig].body}"></span><span class="nm">${s.name}</span><span class="tm">${s.pts} pts</span></div>`).join('');
    G.podium = { st, t: 0, conf: [] };
    G.screen = 'podium';
    show('podium');
    A.finish(myPlace); if (myPlace <= 3) setTimeout(() => A.cheer(true), 300);
  }

  // ------------------------------------------------------------ screens
  const SCREENS = ['title', 'select', 'pause', 'results', 'podium', 'loading'];
  function show(id) { if (Math.abs(window.innerHeight - lastH) > 30 || Math.abs(window.innerWidth - lastW) > 8) layout(); SCREENS.forEach((s) => { $(s).hidden = s !== id; }); $('pauseBtn').hidden = id !== null && id !== 'race'; }
  function hideAll() { SCREENS.forEach((s) => { $(s).hidden = true; }); $('pauseBtn').hidden = false; }
  function goTitle() {
    G.screen = 'title'; G.mode = 'single';
    startRace({ demo: true, track: Math.floor(Math.random() * 4), cls: 1 });
    G.screen = 'title';
    show('title'); showPanel('panMain'); renderTitle();
    A.applyMusic(false); A.applyMusic(true, 'title');
  }
  function launch(opts) {
    if (G.use3D) {
      const go = () => { if (!G.use3D) return launch(opts); startRace(opts); hideAll(); G.screen = 'race'; A.applyMusic(false); applyPRDrop(); };
      if (V3on()) go(); else { $('loading').querySelector('.loadcard').textContent = 'Warming up the engine…'; show('loading'); const t0 = performance.now(); const wait = () => { if (V3on() || !G.use3D) go(); else if (performance.now() - t0 < 9000) setTimeout(wait, 50); else { fallbackTop(); go(); } }; wait(); }
      return;
    }
    show('loading');
    // let the loading card paint before the ground pre-render
    setTimeout(() => {
      startRace(opts);
      hideAll(); G.screen = 'race';
      A.applyMusic(false);
    }, 60);
  }
  function pauseGame() { if (G.screen !== 'race') return; G.screen = 'paused'; applyPRDrop(); ptrs.clear(); G.kb = { l: 0, r: 0, d: 0, drift: 0 }; A.engine(false, 0, 0, 0); show('pause'); syncToggles(); }
  function resumeGame() { if (G.screen !== 'paused') return; hideAll(); G.screen = 'race'; A.unlock(); }

  function renderTitle() {
    const chips = $('clsChips'); chips.innerHTML = '';
    DRD.CLASSES.forEach((c, i) => {
      const b = document.createElement('button'); b.className = 'chip' + (save.cls === i ? ' sel' : '');
      const tro = save.gp[c.id]; b.innerHTML = `<b>${c.name}</b><i>${['easy going', 'steady traffic', 'flat out'][i]}</i><em>${tro ? (tro === 1 ? '🏆' : tro <= 3 ? '🥉' : '') + ' GP ' + ordinal(tro) : ''}</em>`;
      b.onclick = () => { A.unlock(); A.click(); save.cls = i; persist(); renderTitle(); };
      chips.appendChild(b);
    });
    const rigs = $('rigs'); rigs.innerHTML = '';
    DRD.RIGS.forEach((r) => {
      const b = document.createElement('button'); b.className = 'rig' + (save.rig === r.id ? ' sel' : ''); b.title = r.name; b.setAttribute('aria-label', r.name);
      const cv = ART.ASSETS['car' + r.id];
      if (V3on()) { const im = document.createElement('canvas'); im.width = 168; im.height = 96; im.className = 'r3d'; b.appendChild(im); (G.rigShots || (G.rigShots = [])).push({ canvas: im, rig: r.id, paint: 0, angle: 0.75, dist: 96, camH: 40, fov: 24 }); }
      else if (cv) { const im = document.createElement('canvas'); im.width = 84; im.height = 48; const g = im.getContext('2d'); g.translate(42, 24); g.drawImage(cv.c, -cv.ox * 0.62, -cv.oy * 0.62, cv.c.width * 0.62, cv.c.height * 0.62); b.appendChild(im); }
      b.onclick = () => { A.unlock(); A.click(); save.rig = r.id; persist(); renderTitle(); };
      rigs.appendChild(b);
    });
    const D = dailyInfo(), dd = save.daily && save.daily.key === D.key ? save.daily : null, sn = streakNow();
    $('btnDaily').innerHTML = `<b>DAILY DERBY</b><span>${DRD.ALL_DEFS[D.track].name} · ${DRD.CLASSES[D.cls].name}</span><span class="tw">${D.twist.name}</span><em>${dd ? 'today: ' + ordinal(dd.place) : 'not raced yet'}${sn ? ' · 🔥' + sn : ''}</em>`;
    $('btnDaily').classList.toggle('done', !!dd);
    const pr = $('paints'); pr.innerHTML = '';
    DRD.PAINTS.forEach((P, k) => {
      const ok = paintOk(k), b = document.createElement('button'); b.className = 'paint' + (save.paint === k ? ' sel' : '') + (ok ? '' : ' locked');
      const col = P.body || DRD.RIGS[save.rig].body; b.style.background = P.plaid ? `repeating-linear-gradient(90deg, ${P.body} 0 5px, ${P.plaid} 5px 7px)` : P.stripe ? `linear-gradient(90deg, ${col} 0 38%, ${P.stripe} 38% 46%, ${col} 46% 54%, ${P.stripe} 54% 62%, ${col} 62%)` : col;
      b.title = P.name; b.setAttribute('aria-label', P.name + (ok ? '' : ' (locked)'));
      if (!ok) b.innerHTML = `<i>${P.need}</i>`;
      b.onclick = () => { A.unlock(); A.click(); if (!ok) { $('rigName').textContent = P.name + ' paint: win ' + P.need + ' race' + (P.need > 1 ? 's' : '') + ' (you have ' + (save.wins || 0) + ')'; return; } save.paint = k; persist(); renderTitle(); };
      pr.appendChild(b);
    });
    $('rigName').textContent = DRD.RIGS[save.rig].name + (DRD.RIGS[save.rig].type === 'pickup' ? ' · heavier, shoves harder' : ' · grippier in corners');
    $('raceCls').textContent = DRD.CLASSES[save.cls].name;
    medalLine();
    $('garageSub').textContent = DRD.CLASSES[save.cls].name + ' · ' + DRD.RIGS[save.rig].name.split(' ')[0];
    syncToggles();
  }
  // title sub-panels: Modes (GP / pick track / time trial) and Garage (class, car, paint, toggles)
  function showPanel(id) { ['panMain', 'panModes', 'panGarage'].forEach((p) => { $(p).hidden = p !== id; }); $('garageRig').hidden = !(id === 'panGarage' && V3on()); }
  function syncToggles() {
    ['togglesTitle', 'togglesPause'].forEach((id) => {
      const el = $(id); el.innerHTML = '';
      [['sound', 'Sound'], ['music', 'Music'], ['buzz', 'Buzz']].forEach(([k, label]) => {
        if (k === 'buzz' && !navigator.vibrate) return;
        const b = document.createElement('button'); b.className = 'tg' + (save[k] ? ' on' : ''); b.textContent = label;
        b.onclick = () => {
          A.unlock();
          save[k] = !save[k];
          A.sound = save.sound; A.music = save.music; persist(); A.click(); A.applyMusic(G.screen === 'title' || G.screen === 'paused'); syncToggles();
        };
        el.appendChild(b);
      });
    });
  }
  function renderSelect(mode) {
    G.selMode = mode;
    $('selHead').textContent = mode === 'tt' ? 'Time Trial' : 'Pick a track';
    $('selSub').textContent = mode === 'tt' ? 'Race your best-lap ghost. Three cider donuts per run.' : DRD.CLASSES[save.cls].name + ' · 3 laps';
    const box = $('cards'); box.innerHTML = '';
    $('selMirror').textContent = save.mirror ? '⇄ Mirror' : '⇄ Mirror 🔒'; $('selMirror').classList.toggle('on', !!(save.mirror && G.selMirrorOn));
    const off = save.mirror && G.selMirrorOn ? 4 : 0;
    DRD.ALL_DEFS.slice(off, off + 4).forEach((d, j) => { const i = j + off;
      const T = track(i);
      const b = document.createElement('button'); b.className = 'card2 ' + d.season + (d.mirror ? ' mirror' : '');
      const key = d.id + '_' + DRD.CLASSES[save.cls].id;
      const best = mode === 'tt' ? save.tt[d.id] : save.best[key];
      const mr = mode === 'tt' || !best ? 9 : best.medal != null ? best.medal : ((m) => m && m.medal ? ['gold', 'silver', 'bronze'].indexOf(m.medal) : 9)(DRD.medal(d.id, save.cls, best.time)), md = mr < 3 ? ['gold', 'silver', 'bronze'][mr] : null;
      const line = mode === 'tt' ? (best && best.lap ? 'Best lap ' + fmt(best.lap) : 'No ghost yet') : (best ? (md ? `<span class="medal ${md}"></span>` : '') + 'Best ' + ordinal(best.place) + ' · ' + fmt(best.time) : 'Not raced yet');
      b.innerHTML = `<canvas width="120" height="96"></canvas><div class="ct"><b>${d.name}</b><i>${{ spring: 'Mud season', autumn: 'Foliage', winter: 'Snow', night: 'Night' }[d.season]}</i><span>${d.blurb}</span><em>${line}</em></div>`;
      drawMini(b.querySelector('canvas'), T);
      b.onclick = () => { A.unlock(); A.click(); save.track = i; persist(); launch({ mode, track: i }); };
      box.appendChild(b);
    });
    show('select');
  }
  function drawMini(cv, T) {
    const g = cv.getContext('2d'), W = cv.width, H = cv.height;
    let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9; for (let i = 0; i < T.N; i++) { x0 = Math.min(x0, T.X[i]); x1 = Math.max(x1, T.X[i]); y0 = Math.min(y0, T.Y[i]); y1 = Math.max(y1, T.Y[i]); }
    const sc = Math.min((W - 16) / (x1 - x0), (H - 16) / (y1 - y0));
    const ox = (W - (x1 - x0) * sc) / 2 - x0 * sc, oy = (H - (y1 - y0) * sc) / 2 - y0 * sc;
    g.lineJoin = 'round'; g.lineCap = 'round';
    const path = (X, Y, n, closed) => { g.beginPath(); for (let i = 0; i < n; i++) { const x = X[i] * sc + ox, y = Y[i] * sc + oy; i ? g.lineTo(x, y) : g.moveTo(x, y); } if (closed) g.closePath(); };
    g.strokeStyle = 'rgba(0,0,0,.45)'; g.lineWidth = 8; path(T.X, T.Y, T.N, true); g.stroke();
    g.strokeStyle = '#f4e8cc'; g.lineWidth = 4.5; path(T.X, T.Y, T.N, true); g.stroke();
    T.shorts.forEach((o) => { g.strokeStyle = '#ffb24d'; g.lineWidth = 2.5; g.setLineDash([3, 3]); path(o.X, o.Y, o.M, false); g.stroke(); g.setLineDash([]); });
    const p = T.point(0); g.fillStyle = '#e8452a'; g.beginPath(); g.arc(p.x * sc + ox, p.y * sc + oy, 4, 0, TAU); g.fill();
    return { sc, ox, oy };
  }

  function bind() {
    $('btnRace').onclick = () => { A.unlock(); A.click(); G.mode = 'single'; launch({ mode: 'single', track: save.track }); };
    $('btnGP').onclick = () => { A.unlock(); A.click(); G.gp = { round: 0, pts: {}, rig: {}, cls: save.cls, nameSeed: Math.floor(Math.random() * 1e6) }; G.mode = 'gp'; launch({ mode: 'gp', track: 0 }); };
    $('btnPick').onclick = () => { A.unlock(); A.click(); renderSelect('single'); };
    $('btnModes').onclick = () => { A.unlock(); A.click(); showPanel('panModes'); };
    $('btnGarage').onclick = () => { A.unlock(); A.click(); showPanel('panGarage'); };
    document.querySelectorAll('[data-back]').forEach((b) => { b.onclick = () => { A.click(); showPanel('panMain'); renderTitle(); }; });
    $('btnDaily').onclick = () => { A.unlock(); A.click(); G.mode = 'daily'; launch({ mode: 'daily', track: dailyInfo().track }); };
    $('selMirror').onclick = () => { A.click(); if (!save.mirror) { $('selSub').textContent = 'Mirror roads: win a Commuter or Rally Pro race, or finish on a Grand Prix podium.'; return; } G.selMirrorOn = !G.selMirrorOn; renderSelect(G.selMode); };
    $('btnShare').onclick = () => {
      A.click(); const txt = G.share; if (!txt) return;
      const done = (m) => { $('btnShare').textContent = m; };
      try { if (navigator.share) { navigator.share({ text: txt }).then(() => done('Shared!'), () => {}); return; } } catch (e) {}
      try { navigator.clipboard.writeText(txt).then(() => done('Copied! Paste it anywhere'), () => done('Could not copy')); } catch (e) { done('Could not copy'); }
    };
    $('btnTT').onclick = () => { A.unlock(); A.click(); renderSelect('tt'); };
    $('selBack').onclick = () => { A.click(); show('title'); };
    $('pauseBtn').addEventListener('pointerdown', (e) => { e.stopPropagation(); e.preventDefault(); A.unlock(); pauseGame(); });
    $('btnResume').onclick = () => { A.click(); resumeGame(); };
    $('btnRestart').onclick = () => { A.click(); if (G.mode === 'gp') G.gp.round = G.gp.round; launch({ mode: G.mode, track: G.trackI }); };
    $('btnQuit').onclick = () => { A.click(); goTitle(); };
    $('btnAgain').onclick = () => { A.unlock(); A.click(); launch({ mode: G.mode, track: G.trackI }); };
    $('btnNext').onclick = () => { A.unlock(); A.click(); const base = G.trackI >= 4 ? 4 : 0, n = G.mode === 'gp' ? G.gp.round : base + (G.trackI - base + 1) % 4; if (G.mode !== 'gp') { save.track = n; persist(); } launch({ mode: G.mode, track: n }); };
    $('btnPodium').onclick = () => { A.click(); showPodium(); };
    $('btnMenu').onclick = () => { A.click(); goTitle(); };
    $('pdMenu').onclick = () => { A.click(); goTitle(); };
    $('pdAgain').onclick = () => { A.unlock(); A.click(); G.gp = { round: 0, pts: {}, rig: {}, cls: save.cls, nameSeed: Math.floor(Math.random() * 1e6) }; G.mode = 'gp'; launch({ mode: 'gp', track: 0 }); };
  }

  // ------------------------------------------------------------ minimap
  function buildMinimap() {
    const T = G.T; if (!T) return;
    const size = Math.round(Math.min(76, Math.min(cw, ch) * 0.2));
    const c = ART.mk(size * dpr, size * dpr), g = c.getContext('2d'); g.scale(dpr, dpr);
    let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9; for (let i = 0; i < T.N; i++) { x0 = Math.min(x0, T.X[i]); x1 = Math.max(x1, T.X[i]); y0 = Math.min(y0, T.Y[i]); y1 = Math.max(y1, T.Y[i]); }
    const sc = Math.min((size - 12) / (x1 - x0), (size - 12) / (y1 - y0));
    const ox = (size - (x1 - x0) * sc) / 2 - x0 * sc, oy = (size - (y1 - y0) * sc) / 2 - y0 * sc;
    g.fillStyle = 'rgba(20,14,8,.6)'; ART.rr(g, 0, 0, size, size, 12); g.fill();
    g.lineJoin = 'round'; g.lineCap = 'round';
    const path = (X, Y, n, closed) => { g.beginPath(); for (let i = 0; i < n; i += 2) { const x = X[i] * sc + ox, y = Y[i] * sc + oy; i ? g.lineTo(x, y) : g.moveTo(x, y); } if (closed) g.closePath(); };
    g.strokeStyle = 'rgba(0,0,0,.5)'; g.lineWidth = 4.6; path(T.X, T.Y, T.N, true); g.stroke();
    g.strokeStyle = 'rgba(244,232,204,.92)'; g.lineWidth = 2.6; path(T.X, T.Y, T.N, true); g.stroke();
    T.shorts.forEach((o) => { g.strokeStyle = 'rgba(255,178,77,.9)'; g.lineWidth = 1.8; g.setLineDash([2.5, 2.5]); path(o.X, o.Y, o.M, false); g.stroke(); g.setLineDash([]); });
    const p = T.point(0); g.fillStyle = '#fff'; g.fillRect(p.x * sc + ox - 2, p.y * sc + oy - 2, 4, 4);
    UI.mm = { c, size, sc, ox, oy };
  }

  // ------------------------------------------------------------ camera
  function updateCamera(dt) {
    const R = G.race; if (!R) return;
    if (G.use3D) { if (G.kick > 0) G.kick = Math.max(0, G.kick - dt * 2.2); G.shake = Math.max(0, G.shake - dt * 18); return; } // the 3D view moves its own camera
    const c = R.player && !G.demo ? R.player : R.order[0];
    const cam = G.cam;
    const spd = c.speed, k = 0.3;
    const lx = c.x + clamp(c.vx * k, -130, 130), ly = c.y + clamp(c.vy * k, -130, 130);
    const intro = G.introT > 0 ? G.introT : 0;
    cam.x += (lx - cam.x) * Math.min(1, (intro ? 2.2 : 7) * dt); cam.y += (ly - cam.y) * Math.min(1, (intro ? 2.2 : 7) * dt);
    let ta = c.h;
    if (spd > 60 && c.vf > 0) ta = c.h + wrapA(Math.atan2(c.vy, c.vx) - c.h) * 0.55;
    if (c.spinT > 0) ta = cam.a; // don't spin the world
    cam.a += wrapA(ta - cam.a) * Math.min(1, 4.6 * dt);
    if (G.kick > 0) G.kick = Math.max(0, G.kick - dt * 2.2);
    const zt = UI.z0 * (1 - 0.1 * clamp(spd / 340, 0, 1.3) - 0.07 * (G.kick || 0) - 0.1 * clamp(Math.abs(c.yaw || 0) / 2.4, 0, 1)) * (intro ? 1 - intro * 0.25 : 1);
    cam.z += (zt - cam.z) * Math.min(1, 2.5 * dt);
    G.shake = Math.max(0, G.shake - dt * 18);
    cam.sx = (Math.random() - 0.5) * G.shake; cam.sy = (Math.random() - 0.5) * G.shake;
  }
  function camAY() { return G.screen === 'title' ? (UI.portrait ? 0.4 : 0.5) : UI.portrait ? 0.64 : 0.7; }
  function camTransform(g, scale) {
    const cam = G.cam, ay = camAY();
    g.setTransform(dpr * scale, 0, 0, dpr * scale, 0, 0);
    g.translate(cw / 2 + cam.sx, ch * ay + cam.sy);
    g.rotate(-Math.PI / 2 - cam.a);
    g.scale(cam.z, cam.z);
    g.translate(-cam.x, -cam.y);
  }
  function viewBox() {
    const cam = G.cam, ay = camAY();
    const pts = [[0, 0], [cw, 0], [0, ch], [cw, ch]].map(([sx, sy]) => {
      const dx = (sx - cw / 2) / cam.z, dy = (sy - ch * ay) / cam.z, a = Math.PI / 2 + cam.a;
      return [cam.x + dx * Math.cos(a) - dy * Math.sin(a), cam.y + dx * Math.sin(a) + dy * Math.cos(a)];
    });
    return { x0: Math.min(...pts.map((p) => p[0])) - 60, x1: Math.max(...pts.map((p) => p[0])) + 60, y0: Math.min(...pts.map((p) => p[1])) - 60, y1: Math.max(...pts.map((p) => p[1])) + 60 };
  }
  function worldToScreen(x, y) {
    const cam = G.cam, ay = camAY(), a = -Math.PI / 2 - cam.a;
    const dx = (x - cam.x) * cam.z, dy = (y - cam.y) * cam.z;
    return [cw / 2 + dx * Math.cos(a) - dy * Math.sin(a), ch * ay + dx * Math.sin(a) + dy * Math.cos(a)];
  }

  // ------------------------------------------------------------ render world
  let floorPat = null, floorSeason = '';
  let lightC = null, lightG = null;
  function render() {
    const R = G.race, T = G.T;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    if (G.use3D) { // the world is WebGL (#gl); this canvas only carries the HUD, buttons, pops and tags
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      if (!R || !T || !V3on()) return;
      G.ghostNow = ghostPos();
      G.v3.render(G, G.frameDt || 1 / 60);
      drawOverlay3D();
      return;
    }
    if (!R || !T) { ctx.fillStyle = '#2b2219'; ctx.fillRect(0, 0, canvas.width, canvas.height); return; }
    camTransform(ctx, 1);
    const vb = viewBox();
    if (floorSeason !== T.season) { floorPat = ctx.createPattern(G.ground.floor, 'repeat'); floorSeason = T.season; }
    ctx.fillStyle = floorPat; ctx.fillRect(vb.x0, vb.y0, vb.x1 - vb.x0, vb.y1 - vb.y0);
    // ground tiles
    const Gd = G.ground, tw = Gd.tw;
    const bx0 = Math.max(0, Math.floor((vb.x0 - T.ox) / tw)), bx1 = Math.min(Gd.nx - 1, Math.floor((vb.x1 - T.ox) / tw));
    const by0 = Math.max(0, Math.floor((vb.y0 - T.oy) / tw)), by1 = Math.min(Gd.ny - 1, Math.floor((vb.y1 - T.oy) / tw));
    for (let a = by0; a <= by1; a++) for (let b = bx0; b <= bx1; b++) { const t = Gd.tiles[a * Gd.nx + b]; if (t) ctx.drawImage(t.c, t.x, t.y, tw + 0.6, tw + 0.6); }
    const inView = (x, y, r) => x + r > vb.x0 && x - r < vb.x1 && y + r > vb.y0 && y - r < vb.y1;
    const AS = ART.ASSETS;
    // ground objects
    for (const o of R.objs) {
      if (!inView(o.x, o.y, 40)) continue;
      const k = Math.min(1, o.age / 0.25), sc = easeOut(k) * (o.life < 1 ? o.life : 1);
      if (o.type === 'syrup') { const s = 52 * sc; ctx.save(); ctx.translate(o.x, o.y); ctx.rotate(o.a); ctx.drawImage(AS.syrupPuddle, -s / 2, -s / 2, s, s); ctx.restore(); }
      else { const s = 36 * (0.6 + 0.4 * sc); ctx.save(); ctx.translate(o.x, o.y); ctx.rotate(o.a); ctx.drawImage(AS.icon_hay, -s / 2, -s / 2, s, s); ctx.restore(); }
    }
    // crates (bob + spin)
    const ct = performance.now() / 1000;
    for (const cr of R.crates) {
      if (!cr.alive || !inView(cr.x, cr.y, 30)) continue;
      const bob = Math.sin(ct * 3 + cr.spin) * 0.06, s = 30 * (1 + bob);
      ctx.fillStyle = 'rgba(0,0,0,.25)'; ctx.beginPath(); ctx.ellipse(cr.x + 4, cr.y + 5, 14, 14, 0, 0, TAU); ctx.fill();
      ctx.save(); ctx.translate(cr.x, cr.y); ctx.rotate(cr.spin * 0.6); ctx.drawImage(AS.icon_crate, -s / 2, -s / 2, s, s); ctx.restore();
    }
    // ghost
    const gp = ghostPos();
    if (gp) { const sp = AS['car' + gp.rig]; ctx.save(); ctx.globalAlpha = 0.6; ctx.fillStyle = 'rgba(160,215,255,.35)'; ctx.beginPath(); ctx.ellipse(gp.x, gp.y, 26, 26, 0, 0, TAU); ctx.fill(); ctx.translate(gp.x, gp.y); ctx.rotate(gp.h); ctx.drawImage(sp.c, -sp.ox / ART.CS, -sp.oy / ART.CS, sp.c.width / ART.CS, sp.c.height / ART.CS); ctx.restore(); }
    // tractor
    if (R.tractor && inView(R.tractor.x, R.tractor.y, 60)) {
      const tr = R.tractor; ctx.save(); ctx.translate(tr.x, tr.y); ctx.rotate(tr.h); ctx.drawImage(AS.tractor, -24, -16, 48, 32);
      if (tr.warn && Math.floor(ct * 4) % 2) { ctx.fillStyle = '#ffb000'; ctx.beginPath(); ctx.arc(-2, 0, 3.2, 0, TAU); ctx.fill(); }
      ctx.restore();
    }
    // name tags: only the two rivals nearest to you
    G.tagPts = [];
    G.tagSet = R.player ? new Set(R.cars.filter((q) => q !== R.player).sort((a, b) => Math.hypot(a.x - R.player.x, a.y - R.player.y) - Math.hypot(b.x - R.player.x, b.y - R.player.y)).slice(0, 2)) : null;
    // cars
    for (const c of R.cars) {
      if (!inView(c.x, c.y, 50)) continue;
      drawCar(c, ct);
    }
    // projectiles
    for (const p of R.proj) {
      if (!inView(p.x, p.y, 40)) continue;
      if (p.type === 'pine') { ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.a); ctx.drawImage(AS.icon_pine, -11, -11, 22, 22); ctx.restore(); }
      else { const s = p.r * 2.25; ctx.fillStyle = 'rgba(40,60,90,.25)'; ctx.beginPath(); ctx.arc(p.x + 3, p.y + 4, p.r, 0, TAU); ctx.fill(); ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.a); ctx.drawImage(AS.icon_snow, -s / 2, -s / 2, s, s); ctx.restore(); }
    }
    // particles
    for (const p of G.parts) {
      if (!inView(p.x, p.y, 10)) continue;
      const a = 1 - p.life / p.max;
      ctx.globalAlpha = p.type === 'smoke' ? a * 0.6 : Math.min(1, a * 1.6);
      ctx.fillStyle = p.col;
      const y = p.y - p.z * 0.35, x = p.x + p.z * 0.2;
      if (p.type === 'leaf' || p.type === 'splinter' || p.type === 'hay' || p.type === 'pine') { ctx.save(); ctx.translate(x, y); ctx.rotate(p.rot); ctx.fillRect(-p.size, -p.size * 0.4, p.size * 2, p.size * 0.8); ctx.restore(); }
      else { ctx.beginPath(); ctx.arc(x, y, p.size, 0, TAU); ctx.fill(); }
    }
    ctx.globalAlpha = 1;
    // decor (trees, buildings, roofs)
    drawDecor(vb, ct);
    // night lighting
    if (T.season === 'night') drawNight(vb);
    // floating text
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    // pop-up beside your car (left or right, whichever side has room), never on the road ahead of it
    if (G.pops.length && R.player) { const [px, py] = worldToScreen(R.player.x, R.player.y); drawPop(G.pops[0], px, py + 6, 34); }
    ctx.globalAlpha = 1;
    drawWeather();
    // boost speed lines
    const P = R.player;
    if (P && P.boostT > 0 && !G.demo) {
      ctx.strokeStyle = 'rgba(255,255,255,.22)'; ctx.lineWidth = 2;
      for (let i = 0; i < 14; i++) { const x = Math.random() * cw, y = Math.random() * ch * 0.8, l = 40 + Math.random() * 80; ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x, y + l); ctx.stroke(); }
    }
    if (G.flash > 0) { ctx.fillStyle = G.flashCol + Math.min(0.7, G.flash) + ')'; ctx.fillRect(0, 0, cw, ch); }
    if (G.hitV > 0) drawHitVignette();
    if (G.timeScale < 1) { const vg = ctx.createRadialGradient(cw / 2, ch / 2, Math.min(cw, ch) * 0.3, cw / 2, ch / 2, Math.max(cw, ch) * 0.7); vg.addColorStop(0, 'rgba(0,0,0,0)'); vg.addColorStop(1, 'rgba(0,0,0,.45)'); ctx.fillStyle = vg; ctx.fillRect(0, 0, cw, ch); }
  }

  // ------------------------------------------------------------ 3D overlay (2D canvas over the WebGL world)
  function proj(x, y, h) { return G.v3.project(x, y, h); }
  function drawOverlay3D() {
    const R = G.race, P = R.player;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    G.tagPts = [];
    if (P && !G.demo && R.phase === 'race' && !P.finished && G.screen === 'race') {
      // name tags: the two nearest rivals AHEAD within 400, fading with distance; a gold ▲ over the car one place ahead
      const fx = Math.cos(P.h), fy = Math.sin(P.h), me = proj(P.x, P.y, 8);
      const ahead = R.cars.filter((q) => q !== P && ((q.x - P.x) * fx + (q.y - P.y) * fy) > 10 && Math.hypot(q.x - P.x, q.y - P.y) < 400).sort((a, b) => Math.hypot(a.x - P.x, a.y - P.y) - Math.hypot(b.x - P.x, b.y - P.y)).slice(0, 2);
      ctx.font = '800 12px Barlow, sans-serif'; ctx.textAlign = 'center';
      for (const c of ahead) {
        const d = Math.hypot(c.x - P.x, c.y - P.y), q = proj(c.x, c.y, 24);
        if (!q.visible || q.sy > ch * 0.8) continue;
        if (Math.abs(q.sx - me.sx) < 60 && Math.abs(q.sy - me.sy) < 46) continue; // never over your own rig
        ctx.globalAlpha = clamp((400 - d) / 120, 0, 1) * 0.92;
        ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(20,12,6,.75)'; ctx.strokeText(c.name, q.sx, q.sy); ctx.fillStyle = c.rig.roof || '#fff'; ctx.fillText(c.name, q.sx, q.sy); G.tagPts.push([q.sx, q.sy]);
        if (c.place === P.place - 1) { ctx.fillStyle = '#ffd34d'; ctx.fillText('▲', q.sx, q.sy - 12); }
      }
      ctx.globalAlpha = 1;
      // slipstream building: four thin streaks converge on the car you are tucked in behind
      if (P.draftT > 0.05 && P.draftT < 0.45) {
        let tgt = null; for (const q of R.cars) { if (q === P) continue; const dx = q.x - P.x, dy = q.y - P.y, al = dx * fx + dy * fy; if (al > 26 && al < 110 && Math.abs(dx * -fy + dy * fx) < 18) { tgt = q; break; } }
        if (tgt) { const q = proj(tgt.x, tgt.y, 8), k = P.draftT / 0.45; ctx.strokeStyle = 'rgba(220,240,255,' + (0.35 * (1 - k * 0.5)).toFixed(3) + ')'; ctx.lineWidth = 1.5;
          for (let i = 0; i < 4; i++) { const a = -0.9 + i * 0.6 + (i > 1 ? 0.6 : 0), r0 = 150 - k * 60, r1 = 40; ctx.beginPath(); ctx.moveTo(q.sx + Math.cos(a + Math.PI / 2) * r0 * (i % 2 ? 1 : -1), q.sy + Math.sin(a) * r0 * 0.4 + 30); ctx.lineTo(q.sx + Math.cos(a + Math.PI / 2) * r1 * (i % 2 ? 1 : -1), q.sy + Math.sin(a) * r1 * 0.4 + 10); ctx.stroke(); } }
      }
    }
    // time trial: a small BEST tag over the ghost
    if (G.ghostNow && P && G.screen === 'race') { const q = proj(G.ghostNow.x, G.ghostNow.y, 24), me = proj(P.x, P.y, 8);
      if (q.visible && !(Math.abs(q.sx - me.sx) < 50 && Math.abs(q.sy - me.sy) < 40)) { ctx.font = '800 11px Barlow, sans-serif'; ctx.textAlign = 'center'; ctx.globalAlpha = 0.85; ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(20,30,50,.7)'; ctx.strokeText('BEST', q.sx, q.sy); ctx.fillStyle = '#cfe9ff'; ctx.fillText('BEST', q.sx, q.sy); ctx.globalAlpha = 1; } }
    // pop-up beside your rig (left or right, whichever has room), one at a time
    if (G.pops.length && P && !G.demo) { const me = proj(P.x, P.y, 10); drawPop(G.pops[0], me.sx, me.sy - 4, 64); }
    // above 90% of top speed: thin streaks flying out from the vanishing point along the screen edges (never over the road
    // ahead or your rig); stronger on a boost
    if (P && !G.demo && R.phase === 'race' && !P.finished && V3on()) {
      const k = clamp((P.speed / R.cls.vmax - 0.9) / 0.1, 0, 1), kb = G.speedT > 0 && P.boostT > 0 ? (P.boostDur >= 0.85 ? 1 : 0.75) * clamp(P.boostT / 0.3, 0, 1) : 0, amt = Math.max(k * 0.7, kb);
      if (amt > 0.02) {
        const vp = G.v3.project(G.cam.x + Math.cos(G.cam.a) * 6000, G.cam.y + Math.sin(G.cam.a) * 6000, 0), ox = vp.sx, oy = vp.sy, R0 = Math.hypot(cw, ch);
        if (!G.streaks) { G.streaks = []; for (let i = 0; i < 14; i++) G.streaks.push({ a: 0, r: 0, v: 0 }); }
        ctx.lineWidth = kb > 0 ? 2.4 : 1.6; ctx.lineCap = 'round';
        const nSt = kb > 0 ? 14 : 9; // a boost: more, thicker, brighter streaks (they show in a still)
        for (let si = 0; si < nSt; si++) { const st = G.streaks[si];
          st.r += st.v * (G.frameDt || 0.016);
          if (st.r > st.e || st.v === 0) { // respawn part-way to the screen edge, so each streak stays in view ~0.3 s
            const side = Math.random() < 0.5 ? -1 : 1; st.a = Math.PI / 2 + side * (0.95 + Math.random() * 0.5) + (Math.random() < 0.3 ? side * 0.9 : 0);
            const c0 = Math.cos(st.a), s0 = Math.sin(st.a), tx = c0 > 0.01 ? (cw - ox) / c0 : c0 < -0.01 ? -ox / c0 : 1e4, ty = s0 > 0.01 ? (ch - oy) / s0 : s0 < -0.01 ? -oy / s0 : 1e4;
            st.e = Math.max(60, Math.min(tx, ty)); st.r = st.e * (0.3 + Math.random() * 0.35); st.v = st.e * (1.5 + Math.random() * 0.9);
          }
          const ca = Math.cos(st.a), sa = Math.sin(st.a), l = st.e * 0.2 * (0.6 + amt) * (kb > 0 ? 1.4 : 1);
          ctx.strokeStyle = kb > 0 ? 'rgba(255,246,220,' + (0.5 * amt).toFixed(3) + ')' : 'rgba(255,255,255,' + (0.26 * amt).toFixed(3) + ')';
          ctx.beginPath(); ctx.moveTo(ox + ca * st.r, oy + sa * st.r); ctx.lineTo(ox + ca * (st.r + l), oy + sa * (st.r + l)); ctx.stroke();
        }
      }
    }
    // the old boost lines stay for the top-down fallback only
    if (P && !G.demo && G.speedT > 0 && P.boostT > 0 && !V3on()) {
      ctx.strokeStyle = 'rgba(255,255,255,.18)'; ctx.lineWidth = 2;
      for (let i = 0; i < 5; i++) { const left = i % 2 === 0, x = left ? 8 + Math.random() * cw * 0.14 : cw - 8 - Math.random() * cw * 0.14, y = ch * (0.3 + Math.random() * 0.4), l = 50 + Math.random() * 70; ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + (left ? -1 : 1) * l * 0.25, y + l); ctx.stroke(); }
    }
    if (G.flash > 0) { ctx.fillStyle = G.flashCol + Math.min(0.7, G.flash) + ')'; ctx.fillRect(0, 0, cw, ch); }
    if (G.hitV > 0) drawHitVignette();
  }
  // a hit reddens only the screen edges (the sky and the road ahead stay readable)
  let hitVG = null, hitVGk = '';
  function drawHitVignette() {
    const key = cw + 'x' + ch, sw = Math.round(Math.min(cw, ch) * 0.16);
    if (hitVGk !== key) {
      const mk = (x0, y0, x1, y1) => { const g = ctx.createLinearGradient(x0, y0, x1, y1); g.addColorStop(0, 'rgba(210,26,14,.62)'); g.addColorStop(0.45, 'rgba(225,36,20,.22)'); g.addColorStop(1, 'rgba(230,40,24,0)'); return g; };
      hitVG = { l: mk(0, 0, sw, 0), r: mk(cw, 0, cw - sw, 0), t: mk(0, 0, 0, sw), b: mk(0, ch, 0, ch - sw) }; hitVGk = key;
    }
    ctx.globalAlpha = Math.min(1, G.hitV / 0.3);
    ctx.fillStyle = hitVG.l; ctx.fillRect(0, 0, sw, ch); ctx.fillStyle = hitVG.r; ctx.fillRect(cw - sw, 0, sw, ch);
    ctx.fillStyle = hitVG.t; ctx.fillRect(0, 0, cw, sw); ctx.fillStyle = hitVG.b; ctx.fillRect(0, ch - sw, cw, sw);
    ctx.globalAlpha = 1;
  }
  // incoming item from behind (you can't see behind you in chase view) + a rival about to pass
  function updateWarnings(dt) {
    const R = G.race, P = R && R.player; G.incoming = null;
    if (G.passArrow) { G.passArrow.t -= dt; if (G.passArrow.t <= 0) G.passArrow = null; }
    if (G.speedT > 0) G.speedT -= dt;
    if (!P || G.demo || P.finished || R.phase !== 'race') return;
    const fx = Math.cos(P.h), fy = Math.sin(P.h);
    let best = null;
    for (const p of R.proj) {
      if (p.dead || p.owner === P.i) continue;
      const dx = P.x - p.x, dy = P.y - p.y, d = Math.hypot(dx, dy) || 1;
      if (dx * fx + dy * fy <= 0) continue; // only from behind
      const close = ((p.vx - P.vx) * dx + (p.vy - P.vy) * dy) / d;
      if (close <= 20) continue;
      const tti = Math.max(0, d - 24) / close; if (tti > 1.2) continue;
      const lat = (p.x - P.x) * -fy + (p.y - P.y) * fx;
      if (!best || tti < best.t) best = { t: tti, side: lat < -14 ? -1 : lat > 14 ? 1 : 0, type: p.type };
    }
    // no projectile yet: a rival close behind with a pinecone aimed at you, or a snowball and you in range, shows the same
    // diamond as an outline 1.2 s ahead of the throw's likely arrival (the AI's own throw rules), so a hit is never a surprise
    if (!best) for (const q of R.cars) {
      if (q === P || q.finished || !q.item || q.roulette > 0 || q.spinT > 0 || (q.item !== 'pine' && q.item !== 'snow')) continue;
      const dx = P.x - q.x, dy = P.y - q.y, d = Math.hypot(dx, dy) || 1;
      if (dx * fx + dy * fy <= 0) continue; // it must be behind you
      let est = 9;
      if (q.item === 'pine') { const qa = (dx * Math.cos(q.h) + dy * Math.sin(q.h)) / d; if (d < 430 && d > 40 && qa > 0.95) est = Math.max(0, d - 24) / 430 + 0.25; }
      else { const ahead = P.dist - q.dist; if (ahead > 60 && ahead < 330) est = ahead / 260 + 0.25; }
      if (est > 1.45) continue;
      const lat = (q.x - P.x) * -fy + (q.y - P.y) * fx;
      if (!best || est < best.t) best = { t: Math.min(1.2, est), side: lat < -14 ? -1 : lat > 14 ? 1 : 0, type: q.item, armed: true };
    }
    if (best && P.invT > best.t + 0.15) best = null; // it will bounce off you anyway
    G.incoming = best;
    if (best && !best.armed) { G.incBeepT = (G.incBeepT || 0) - dt; if (G.incBeepT <= 0) { G.incBeepT = 0.12 + 0.3 * best.t / 1.2; A.incoming(1 - best.t / 1.2); } } else G.incBeepT = 0;
    for (const q of R.cars) {
      if (q === P) continue;
      const dx = q.x - P.x, dy = q.y - P.y, al = dx * fx + dy * fy, lat = dx * -fy + dy * fx;
      if (R.raceT > 3 && al < 0 && al > -40 - 30 && Math.abs(lat) < 50 && q.speed > P.speed + 12) { if (!G.passArrow) G.passArrow = { side: lat < 0 ? -1 : 1, t: 0.6 }; else G.passArrow.t = Math.max(G.passArrow.t, 0.3); }
    }
  }
  function drawWarnings() {
    const it = UI.btn.item; if (!it) return;
    const now = performance.now() / 1000;
    if (G.incoming) {
      const inc = G.incoming, k = 1 - inc.t / 1.2, pulse = inc.armed ? 0.5 + 0.5 * Math.sin(now * 6) : 0.5 + 0.5 * Math.sin(now * (8 + k * 22));
      const x = cw / 2 + inc.side * Math.min(110, cw * 0.28), y = UI.portrait ? it.y - it.r - 54 : ch - ins.b - 78, s = (inc.armed ? 27 : 30) + 4 * pulse;
      ctx.save(); ctx.translate(x, y); ctx.globalAlpha = inc.armed ? 0.7 + 0.2 * pulse : 0.8 + 0.2 * pulse;
      ctx.rotate(Math.PI / 4); ctx.fillStyle = '#1c1a17'; ctx.fillRect(-s, -s, s * 2, s * 2);
      if (inc.armed) { ctx.fillStyle = 'rgba(28,26,23,.55)'; ctx.fillRect(-s + 4, -s + 4, s * 2 - 8, s * 2 - 8); ctx.strokeStyle = '#ffc928'; ctx.lineWidth = 4; ctx.strokeRect(-s + 5, -s + 5, s * 2 - 10, s * 2 - 10); }
      else { ctx.fillStyle = '#ffc928'; ctx.fillRect(-s + 3, -s + 3, s * 2 - 6, s * 2 - 6); }
      ctx.rotate(-Math.PI / 4);
      const ic = ART.ASSETS['icon_' + inc.type]; if (ic) ctx.drawImage(ic, -22, -22, 44, 44);
      ctx.restore(); ctx.globalAlpha = 1;
    }
    if (G.passArrow) {
      const b = G.passArrow.side < 0 ? UI.btn.driftL : UI.btn.driftR; if (!b) return;
      const x = b.x + (G.passArrow.side < 0 ? 1 : -1) * (b.r + 18), y = b.y + 4, a = Math.min(1, G.passArrow.t * 4);
      ctx.save(); ctx.globalAlpha = a * 0.9; ctx.translate(x, y); ctx.fillStyle = '#f4e8cc'; ctx.strokeStyle = 'rgba(30,18,8,.8)'; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.moveTo(0, -14); ctx.lineTo(12, 4); ctx.lineTo(4, 4); ctx.lineTo(4, 14); ctx.lineTo(-4, 14); ctx.lineTo(-4, 4); ctx.lineTo(-12, 4); ctx.closePath(); ctx.stroke(); ctx.fill();
      ctx.restore(); ctx.globalAlpha = 1;
    }
  }

  function drawCar(c, ct) {
    const AS = ART.ASSETS, sp = AS[c.skin] || AS['car' + c.rig.id], sh = AS.shadow;
    const lift = c.z * 7 + (c.hop > 0 ? Math.sin((1 - c.hop / 0.14) * Math.PI) * 2.5 : 0);
    const sc = 1 + c.z * 0.14 + (c.hop > 0 ? 0.04 : 0);
    // shadow (world-fixed light from the top-left)
    ctx.save(); ctx.translate(c.x + 3 + lift * 0.8, c.y + 4 + lift); ctx.rotate(c.h); ctx.globalAlpha = 1 - c.z * 0.3;
    ctx.drawImage(sh.c, -sh.ox / sh.sc, -sh.oy / sh.sc, sh.c.width / sh.sc, sh.c.height / sh.sc); ctx.restore(); ctx.globalAlpha = 1;
    const me = c.isPlayer && !G.demo;
    if (me) { ctx.fillStyle = 'rgba(0,0,0,.35)'; ctx.save(); ctx.translate(c.x + lift * 0.5, c.y + lift * 0.6); ctx.rotate(c.h); ctx.beginPath(); ctx.ellipse(0, 0, 25, 16, 0, 0, TAU); ctx.fill(); ctx.restore(); }
    ctx.save(); ctx.translate(c.x, c.y); ctx.rotate(c.h);
    // body roll in drifts: slight squash
    const roll = c.drifting ? 0.06 : 0;
    ctx.scale(sc * (1 + roll * 0.3), sc * (1 - roll));
    if (c.invT > 0 && c.spinT <= 0 && Math.floor(ct * 16) % 2) ctx.globalAlpha = 0.8;
    if (me) { const ol = ART.outline(sp, 2.2); ctx.drawImage(ol.c, -ol.ox / ART.CS, -ol.oy / ART.CS, ol.c.width / ART.CS, ol.c.height / ART.CS); }
    ctx.drawImage(sp.c, -sp.ox / ART.CS, -sp.oy / ART.CS, sp.c.width / ART.CS, sp.c.height / ART.CS);
    ctx.globalAlpha = 1;
    // boost flame
    if (c.boostT > 0) {
      const f = 8 + Math.random() * 7;
      const gr = ctx.createLinearGradient(-17, 0, -17 - f, 0); gr.addColorStop(0, '#fff6b0'); gr.addColorStop(0.4, '#ffb24d'); gr.addColorStop(1, 'rgba(255,80,20,0)');
      ctx.fillStyle = gr; ctx.beginPath(); ctx.moveTo(-17, -4); ctx.lineTo(-17 - f, 0); ctx.lineTo(-17, 4); ctx.fill();
    }
    // drift charge glow under rear wheels
    if (c.drifting && c.driftTier > 0) { ctx.fillStyle = c.driftTier === 2 ? 'rgba(255,80,50,.6)' : 'rgba(255,210,70,.6)'; for (const y of [-9, 9]) { ctx.beginPath(); ctx.arc(-11, y, 3.5 + Math.random() * 1.5, 0, TAU); ctx.fill(); } }
    ctx.restore();
    // name tag over rivals near you (fades with distance) so they read as drivers
    if (!c.isPlayer && !G.demo && G.race.player && G.race.phase === 'race' && !G.race.player.finished) {
      const P = G.race.player, d = Math.hypot(c.x - P.x, c.y - P.y);
      if (d < 260 && G.tagSet && G.tagSet.has(c)) {
        const [sx, sy] = worldToScreen(c.x, c.y), a = clamp((260 - d) / 80, 0, 1) * 0.9;
        ctx.save(); ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.globalAlpha = a; ctx.font = '800 11px Barlow, sans-serif'; ctx.textAlign = 'center';
        ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(20,12,6,.75)'; ctx.strokeText(c.name, sx, sy - 22); ctx.fillStyle = c.rig.roof || '#fff'; ctx.fillText(c.name, sx, sy - 22); if (G.tagPts) G.tagPts.push([sx, sy - 22]);
        if (c.place < P.place && c.place === P.place - 1) { ctx.fillStyle = '#ffd34d'; ctx.fillText('▲', sx, sy - 33); }
        ctx.restore(); camTransform(ctx, 1);
      }
    }
    // roulette / held item bubble over AI cars that hold something nasty? keep it clean: only name tag for the player
    if (c.isPlayer && !G.demo && G.race.phase === 'countdown') {
      const [sx, sy] = worldToScreen(c.x, c.y);
      // pulsing ring on your car + a tag beside it (above would sit on the car in front on the grid)
      const pu = 0.5 + 0.5 * Math.sin(ct * 6), rr = 24 + pu * 3;
      ctx.save(); ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(255,211,77,' + (0.55 + 0.4 * pu) + ')'; ctx.beginPath(); ctx.arc(sx, sy, rr, 0, TAU); ctx.stroke();
      ctx.restore();
      camTransform(ctx, 1);
    }
  }

  function drawDecor(vb, ct) {
    const T = G.T, R = G.race, AS = ART.ASSETS, D = T.decor, B = T.dB;
    const bx0 = Math.max(0, Math.floor((vb.x0 - 200 - T.ox) / B.B)), bx1 = Math.min(B.bw - 1, Math.floor((vb.x1 + 200 - T.ox) / B.B));
    const by0 = Math.max(0, Math.floor((vb.y0 - 200 - T.oy) / B.B)), by1 = Math.min(B.bh - 1, Math.floor((vb.y1 + 200 - T.oy) / B.B));
    const list = [];
    for (let a = by0; a <= by1; a++) for (let b = bx0; b <= bx1; b++) for (const i of B.buckets[a * B.bw + b]) list.push(i);
    list.sort((a, b) => a - b);
    const P = R.player || R.order[0];
    for (const i of list) {
      const d = D[i];
      const r = d.r || 80;
      if (d.x + r < vb.x0 - 60 || d.x - r > vb.x1 + 60 || d.y + r < vb.y0 - 60 || d.y - r > vb.y1 + 60) continue;
      if (d.k === 'tree') {
        const key = 'tree_' + d.v + '_' + T.season + '_' + (d.seed % 3);
        const sp = AS[key] || AS['tree_maple_' + T.season + '_0'];
        ctx.save(); ctx.translate(d.x, d.y); ctx.rotate(d.a); ctx.drawImage(sp, -d.r, -d.r, d.r * 2, d.r * 2); ctx.restore();
      } else if (d.k === 'sign') {
        const sp = AS['sign_' + d.v], z = d.v === 'chevL' || d.v === 'chevR' ? 64 : 40; ctx.save(); ctx.translate(d.x, d.y); ctx.rotate(d.a + Math.PI / 2); ctx.drawImage(sp, -z / 2, -z / 2, z, z); ctx.restore();
      } else if (d.k === 'bridge' || d.k === 'barnroof') {
        // covered roof: see-through when the player is under it
        let under = Math.hypot(P.x - d.x, P.y - d.y) < d.len / 2 + 10;
        d.fade = lerp(d.fade == null ? 1 : d.fade, under ? 0.22 : 1, 0.12);
        ctx.save(); ctx.translate(d.x, d.y); ctx.rotate(d.a); ctx.globalAlpha = d.fade;
        const L = d.len + 14, W = d.w + 22, red = d.k === 'bridge' ? (T.season === 'winter' ? '#f2f6fa' : '#9a2f22') : '#8f2f22', red2 = d.k === 'bridge' ? (T.season === 'winter' ? '#d0dce8' : '#b8402e') : '#a83c2c';
        ctx.fillStyle = 'rgba(0,0,0,.35)'; ctx.fillRect(-L / 2 + 6, -W / 2 + 8, L, W);
        const g1 = ctx.createLinearGradient(0, -W / 2, 0, 0); g1.addColorStop(0, red2); g1.addColorStop(1, red); ctx.fillStyle = g1; ctx.fillRect(-L / 2, -W / 2, L, W / 2);
        const g2 = ctx.createLinearGradient(0, 0, 0, W / 2); g2.addColorStop(0, ART.shade(red, -0.3)); g2.addColorStop(1, ART.shade(red2, -0.45)); ctx.fillStyle = g2; ctx.fillRect(-L / 2, 0, L, W / 2);
        ctx.strokeStyle = 'rgba(0,0,0,.2)'; ctx.lineWidth = 1; for (let x = -L / 2 + 8; x < L / 2; x += 8) { ctx.beginPath(); ctx.moveTo(x, -W / 2); ctx.lineTo(x, W / 2); ctx.stroke(); }
        ctx.strokeStyle = T.season === 'winter' ? '#a8b8c8' : '#5a1810'; ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(-L / 2, 0); ctx.lineTo(L / 2, 0); ctx.stroke();
        ctx.strokeStyle = 'rgba(30,10,5,.8)'; ctx.lineWidth = 2; ctx.strokeRect(-L / 2, -W / 2, L, W);
        ctx.fillStyle = '#f4e8cc'; ctx.fillRect(-L / 2 - 3, -W / 2, 6, W); ctx.fillRect(L / 2 - 3, -W / 2, 6, W);
        ctx.restore(); ctx.globalAlpha = 1;
      } else if (d.k === 'cow') {
        ctx.save(); ctx.translate(d.x, d.y); ctx.rotate(d.a + Math.sin(ct * 0.5 + i) * 0.1);
        ctx.fillStyle = 'rgba(0,0,0,.3)'; ctx.beginPath(); ctx.ellipse(3, 4, 15, 9, 0, 0, TAU); ctx.fill();
        ctx.fillStyle = '#f4f1ea'; ctx.beginPath(); ctx.ellipse(0, 0, 15, 8.5, 0, 0, TAU); ctx.fill(); ctx.strokeStyle = '#2a2a2a'; ctx.lineWidth = 1; ctx.stroke();
        ctx.fillStyle = '#222'; ctx.beginPath(); ctx.ellipse(-4, -2, 5, 4, 0.5, 0, TAU); ctx.fill(); ctx.beginPath(); ctx.ellipse(6, 3, 4, 3, 0, 0, TAU); ctx.fill();
        ctx.fillStyle = d.v === 1 ? '#6b4a32' : '#f4f1ea'; ctx.beginPath(); ctx.ellipse(17, 0, 5.5, 4.5, 0, 0, TAU); ctx.fill(); ctx.stroke(); ctx.fillStyle = '#e8a0a0'; ctx.fillRect(20.5, -2, 2, 4);
        ctx.restore();
      } else if (d.k === 'pumpkin') {
        ctx.fillStyle = 'rgba(0,0,0,.25)'; ctx.beginPath(); ctx.arc(d.x + 2, d.y + 2.5, d.r, 0, TAU); ctx.fill();
        ctx.fillStyle = '#e07a1e'; ctx.beginPath(); ctx.arc(d.x, d.y, d.r, 0, TAU); ctx.fill(); ctx.strokeStyle = '#9a4a0a'; ctx.lineWidth = 1; ctx.stroke(); ctx.fillStyle = '#4e7a33'; ctx.fillRect(d.x - 1, d.y - d.r - 1, 2, 3);
      } else {
        const sp = AS['prop_' + d.k + '_' + T.season]; if (!sp) continue;
        ctx.save(); ctx.translate(d.x, d.y); ctx.rotate(d.a); ctx.drawImage(sp, -160 * d.sc, -160 * d.sc, 320 * d.sc, 320 * d.sc); ctx.restore();
        if (d.k === 'shack' && Math.random() < 0.3 && G.parts.length < 400) part(d.x, d.y, 'smoke', 8 + Math.random() * 10, -10 - Math.random() * 10, { vz: 30, life: 2.2, size: 5 });
      }
    }
  }

  function drawNight(vb) {
    const R = G.race, T = G.T;
    const ls = 0.5;
    const W = Math.ceil(cw * dpr * ls), H = Math.ceil(ch * dpr * ls);
    if (!lightC || lightC.width !== W || lightC.height !== H) { lightC = ART.mk(W, H); lightG = lightC.getContext('2d'); }
    const g = lightG;
    g.setTransform(1, 0, 0, 1, 0, 0); g.globalCompositeOperation = 'source-over';
    g.clearRect(0, 0, W, H); g.fillStyle = 'rgba(10,16,46,0.66)'; g.fillRect(0, 0, W, H); // cleared every frame (it used to stack up to solid navy)
    g.globalCompositeOperation = 'destination-out';
    camTransform(g, ls);
    const glow = (x, y, r, a) => { const gr = g.createRadialGradient(x, y, 0, x, y, r); gr.addColorStop(0, 'rgba(0,0,0,' + a + ')'); gr.addColorStop(1, 'rgba(0,0,0,0)'); g.fillStyle = gr; g.beginPath(); g.arc(x, y, r, 0, TAU); g.fill(); };
    const cone = (x, y, h, len, spread, a) => { const gr = g.createRadialGradient(x, y, 0, x, y, len); gr.addColorStop(0, 'rgba(0,0,0,' + a + ')'); gr.addColorStop(0.6, 'rgba(0,0,0,' + a * 0.6 + ')'); gr.addColorStop(1, 'rgba(0,0,0,0)'); g.fillStyle = gr; g.beginPath(); g.moveTo(x, y); g.arc(x, y, len, h - spread, h + spread); g.closePath(); g.fill(); };
    // moonlight on the gravel: the unlit road stays clearly lighter than the unlit grass, so the next corner reads
    const NP = nightPaths(T);
    g.lineCap = 'round'; g.lineJoin = 'round'; g.strokeStyle = 'rgba(0,0,0,.5)';
    for (const q of NP.road) { g.lineWidth = q.w; g.stroke(q.p); }
    for (const c of R.cars) {
      const me = c === R.player;
      if (!me && (c.x < vb.x0 - 400 || c.x > vb.x1 + 400 || c.y < vb.y0 - 400 || c.y > vb.y1 + 400)) continue;
      const fx = Math.cos(c.h), fy = Math.sin(c.h);
      cone(c.x + fx * 14, c.y + fy * 14, c.h, me ? 480 : 260, me ? 0.58 : 0.36, me ? 1 : 0.75);
      glow(c.x, c.y, 34, 0.7);
    }
    for (const d of T.decor) {
      if (d.k === 'lamp' || d.k === 'farmhouse' || d.k === 'barn' || d.k === 'bridge' || d.k === 'barnroof' || d.k === 'silo') {
        if (d.x < vb.x0 - 200 || d.x > vb.x1 + 200 || d.y < vb.y0 - 200 || d.y > vb.y1 + 200) continue;
        glow(d.x, d.y, d.k === 'lamp' ? 150 : 120, d.k === 'lamp' ? 0.95 : 0.6);
      }
    }
    if (R.tractor) { const tr = R.tractor; cone(tr.x + Math.cos(tr.h) * 24, tr.y + Math.sin(tr.h) * 24, tr.h, 220, 0.4, 0.85); glow(tr.x, tr.y, 50, 0.6); }
    for (const p of R.proj) glow(p.x, p.y, 26, 0.5);
    for (const cr of R.crates) if (cr.alive && cr.x > vb.x0 && cr.x < vb.x1 && cr.y > vb.y0 && cr.y < vb.y1) glow(cr.x, cr.y, 30, 0.55);
    g.globalCompositeOperation = 'source-over';
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.drawImage(lightC, 0, 0, canvas.width, canvas.height);
    // warm additive glow + taillights
    camTransform(ctx, 1);
    ctx.globalCompositeOperation = 'lighter';
    for (const d of T.decor) {
      if (d.k !== 'lamp' && d.k !== 'farmhouse') continue;
      if (d.x < vb.x0 - 100 || d.x > vb.x1 + 100 || d.y < vb.y0 - 100 || d.y > vb.y1 + 100) continue;
      const gr = ctx.createRadialGradient(d.x, d.y, 0, d.x, d.y, 60); gr.addColorStop(0, 'rgba(255,200,120,.35)'); gr.addColorStop(1, 'rgba(255,200,120,0)'); ctx.fillStyle = gr; ctx.beginPath(); ctx.arc(d.x, d.y, 60, 0, TAU); ctx.fill();
    }
    // faint cream edge lines along both sides of the road
    ctx.globalCompositeOperation = 'source-over'; ctx.strokeStyle = 'rgba(255,246,220,.35)'; ctx.lineWidth = 2; ctx.stroke(NP.edge);
    ctx.globalCompositeOperation = 'lighter';
    // roadside reflector posts: sparse and pale (not yellow, so nothing on the field looks like your minimap dot); the cream edge line does most of the work
    if (!T.reflectors) { T.reflectors = []; for (let i = 0; i < T.N; i += 24) for (const sd of [-1, 1]) { const d = sd * (T.HW[i] + 10); T.reflectors.push([T.X[i] - T.TY[i] * d, T.Y[i] + T.TX[i] * d]); } }
    ctx.fillStyle = 'rgba(255,236,215,.4)';
    for (const r of T.reflectors) { if (r[0] < vb.x0 || r[0] > vb.x1 || r[1] < vb.y0 || r[1] > vb.y1) continue; ctx.beginPath(); ctx.arc(r[0], r[1], 2, 0, TAU); ctx.fill(); }
    for (const c of R.cars) {
      if (c.x < vb.x0 || c.x > vb.x1 || c.y < vb.y0 || c.y > vb.y1) continue;
      const fx = Math.cos(c.h), fy = Math.sin(c.h), rx = -fy, ry = fx;
      const br = c.inp.brake ? 0.9 : 0.5;
      for (const s of [-1, 1]) { const x = c.x - fx * 17 + rx * s * 6, y = c.y - fy * 17 + ry * s * 6; const gr = ctx.createRadialGradient(x, y, 0, x, y, 10); gr.addColorStop(0, 'rgba(255,40,30,' + br + ')'); gr.addColorStop(1, 'rgba(255,40,30,0)'); ctx.fillStyle = gr; ctx.beginPath(); ctx.arc(x, y, 10, 0, TAU); ctx.fill(); }
    }
    ctx.globalCompositeOperation = 'source-over';
  }

  function nightPaths(T) {
    if (T.nightP) return T.nightP;
    const poly = (X, Y, n, closed, off) => { const p = new Path2D(); for (let i = 0; i < n; i++) { const o = off ? off(i) : 0, x = X[i] - (off ? T.TY[i] : 0) * o, y = Y[i] + (off ? T.TX[i] : 0) * o; i ? p.lineTo(x, y) : p.moveTo(x, y); } if (closed) p.closePath(); return p; };
    let hw = 0; for (let i = 0; i < T.N; i++) hw += T.HW[i]; hw /= T.N;
    const road = [{ p: poly(T.X, T.Y, T.N, true), w: hw * 2 }].concat(T.shorts.map((o) => ({ p: poly(o.X, o.Y, o.M, false), w: o.hw * 2 })));
    const edge = new Path2D(); edge.addPath(poly(T.X, T.Y, T.N, true, (i) => T.HW[i] - 1)); edge.addPath(poly(T.X, T.Y, T.N, true, (i) => -(T.HW[i] - 1)));
    T.nightP = { road, edge };
    return T.nightP;
  }

  // ------------------------------------------------------------ weather (screen space)
  function initWeather() {
    G.weather = [];
    const s = G.T.season, n = s === 'winter' && !G.use3D ? 24 : 0; // weather stays a hint, never a curtain over the road (3D: snow is in the scene)
    for (let i = 0; i < n; i++) G.weather.push({ x: Math.random(), y: Math.random(), z: 0.4 + Math.random() * 0.8, p: Math.random() * TAU });
  }
  function drawWeather() {
    const s = G.T.season, t = performance.now() / 1000;
    const camA = G.cam.a;
    for (const f of G.weather) {
      // drift relative to camera rotation so it feels like world-space weather
      const vx = Math.cos(-camA) * 0.004, vy = 0.012 * f.z;
      if (G.screen === 'race' || G.screen === 'title') { f.x = (f.x + vx * f.z + Math.sin(t + f.p) * 0.0008 + 1) % 1; f.y = (f.y + (s === 'night' ? 0 : vy) * (s === 'autumn' ? 0.4 : s === 'spring' ? 0.25 : 1) + 1) % 1; }
      const x = f.x * cw, y = f.y * ch;
      if (s === 'winter') { ctx.fillStyle = 'rgba(255,255,255,' + (0.35 + f.z * 0.4) + ')'; ctx.beginPath(); ctx.arc(x, y, 1 + f.z * 2, 0, TAU); ctx.fill(); }
      else if (s === 'autumn') { ctx.save(); ctx.translate(x, y); ctx.rotate(t * 2 + f.p); ctx.fillStyle = ['#d9531e', '#f2b632', '#e8862a'][Math.floor(f.p * 3) % 3]; ctx.fillRect(-4 * f.z, -2 * f.z, 8 * f.z, 4 * f.z); ctx.restore(); }
      else if (s === 'night') { const b = 0.5 + 0.5 * Math.sin(t * 2.3 + f.p * 5); ctx.fillStyle = 'rgba(230,255,140,' + (b * 0.7) + ')'; ctx.beginPath(); ctx.arc(x, y, 1.6, 0, TAU); ctx.fill(); }
      else { ctx.fillStyle = 'rgba(255,250,235,.55)'; ctx.save(); ctx.translate(x, y); ctx.rotate(t * 4 + f.p); ctx.fillRect(-3, -0.8, 6, 1.6); ctx.restore(); } // maple seeds
    }
  }

  // ------------------------------------------------------------ HUD
  function hudText(txt, x, y, size, col, align, font, stroke) {
    ctx.font = font && font.indexOf('px') >= 0 ? font : `${size}px ${font || '"Alfa Slab One", serif'}`; ctx.textAlign = align || 'left'; ctx.textBaseline = 'alphabetic';
    ctx.lineJoin = 'round'; ctx.lineWidth = stroke != null ? stroke : Math.max(3, size * 0.16); ctx.strokeStyle = 'rgba(30,18,8,.85)'; ctx.strokeText(txt, x, y);
    ctx.fillStyle = col || '#fff'; ctx.fillText(txt, x, y);
  }
  function drawHUD(dt) {
    const R = G.race; if (!R || G.demo) return;
    const P = R.player; if (!P) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const top = ins.t + 12, L = ins.l + 14;
    // position
    if (G.mode !== 'tt') {
      const pp = G.placePop > 0 ? 1 + G.placePop * 0.6 : 1;
      const big = G.use3D ? 56 : 44, bx = G.use3D ? 22 : 18, by = G.use3D ? 44 : 34;
      ctx.save(); ctx.translate(L + bx, top + by); ctx.scale(pp, pp);
      hudText(String(P.place), 0, 0, big, P.place === 1 ? '#ffd34d' : '#fff', 'center');
      ctx.restore();
      hudText(ordinal(P.place).slice(-2), L + bx * 2 + 4 + (P.place >= 10 ? 10 : 0), top + (G.use3D ? 18 : 14), 16, '#f4e8cc');
      hudText('/' + R.cars.length, L + bx * 2 + 4, top + by, 14, '#d6c6b0', 'left', '800 14px Barlow, sans-serif', 3);
    } else {
      hudText('TIME TRIAL', L, top + 18, 15, '#ffd34d');
      if (G.ghost) hudText('ghost ' + fmt(G.ghost.lap), L, top + 36, 14, '#cfe6ff', 'left', '800 14px Barlow, sans-serif', 3);
    }
    // lap + time (right, left of the pause button)
    const rx = cw - ins.r - 60;
    const lapN = clamp(P.lapIdx + 1, 1, R.laps);
    hudText('LAP ' + lapN + '/' + R.laps, rx, top + 20, 18, P.lapIdx + 1 === R.laps ? '#ff9a3c' : '#fff', 'right');
    hudText(fmt(R.phase === 'race' ? (P.finished ? P.finishT : R.raceT) : 0), rx, top + 40, 15, '#f4e8cc', 'right', '800 15px Barlow, sans-serif', 3);
    // lap delta against your best lap here (time trial: against the ghost lap)
    if (G.lapDelta && G.lapDelta.t < 1.5) {
      const d = G.lapDelta.d; ctx.globalAlpha = Math.min(1, (1.5 - G.lapDelta.t) * 4);
      hudText((d <= 0 ? '−' : '+') + Math.abs(d).toFixed(2), rx, top + 62, 18, d <= 0 ? '#8fe08a' : '#ff8a70', 'right', '800 18px Barlow, sans-serif', 3.5);
      ctx.globalAlpha = 1;
    }
    // minimap
    if (UI.mm) {
      const m = UI.mm, mx = L - 4, my = top + (G.use3D ? 58 : 48);
      ctx.drawImage(m.c, mx, my, m.size, m.size);
      for (const c of R.cars) {
        if (c === P) continue;
        ctx.fillStyle = c.rig.body; ctx.strokeStyle = '#1a120a'; ctx.lineWidth = 1.2;
        ctx.beginPath(); ctx.arc(mx + c.x * m.sc + m.ox, my + c.y * m.sc + m.oy, 2.6, 0, TAU); ctx.fill(); ctx.stroke();
      }
      const gp = ghostPos(); if (gp) { ctx.fillStyle = 'rgba(200,230,255,.8)'; ctx.beginPath(); ctx.arc(mx + gp.x * m.sc + m.ox, my + gp.y * m.sc + m.oy, 3, 0, TAU); ctx.fill(); }
      ctx.fillStyle = '#ffd34d'; ctx.strokeStyle = '#1a120a'; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.arc(mx + P.x * m.sc + m.ox, my + P.y * m.sc + m.oy, 3.8, 0, TAU); ctx.fill(); ctx.stroke();
    }
    // touch controls
    if (G.touchUI && !P.finished) drawButtons();
    else if (!G.touchUI && R.raceT < 9 && !P.finished && (!G.use3D || (save.races || 0) < 1)) {
      ctx.globalAlpha = R.phase === 'countdown' ? 1 : clamp(1 - (R.raceT - 6) / 3, 0, 1);
      hudText('← → steer   ·   SHIFT drift (hold in corners)   ·   SPACE item   ·   ↓ brake', cw / 2, ch - ins.b - 20, 15, '#f4e8cc', 'center', '800 15px Barlow, sans-serif', 3);
      ctx.globalAlpha = 1;
    }
    // drift prompt for first-timers
    if (!save.hints.drift && R.phase === 'race' && !P.finished && !P.drifting && P.speed > 200) {
      const T = G.T, k0 = T.idx(P.s); let mk = 0, side = 0; for (let j = 4; j < 30; j += 2) { const kk = T.LK[(k0 + j) % T.N]; if (Math.abs(kk) > mk) { mk = Math.abs(kk); side = Math.sign(kk); } }
      // teach the one-thumb drift (the DRIFT button on the turn side alone picks the direction): it is the easiest one to land
      if (mk * P.speed > 2.0) G.prompt = { text: G.touchUI ? "Hold the DRIFT on the side you're turning" : 'Hold SHIFT + steer to drift!', t: 0, dur: 1.6, btn: 'drift', side: G.touchUI ? side : 0 };
    }
    // wrong way: heading well against the road for a moment -> big sign + which way to turn
    if (R.phase === 'race' && !P.finished && P.k >= 0 && P.k < G.T.N && P.spinT <= 0) {
      const Tk = G.T, rd = Math.atan2(Tk.TY[P.k], Tk.TX[P.k]), hd = wrapA(P.h - rd);
      G.wrongT = Math.abs(hd) > 1.9 && P.speed > 30 ? (G.wrongT || 0) + dt : Math.max(0, (G.wrongT || 0) - dt * 3);
      G.wrongDir = hd > 0 ? -1 : 1;
    } else G.wrongT = 0;
    if (G.wrongT > 0.7) {
      const a = clamp((G.wrongT - 0.7) * 4, 0, 1) * (0.75 + 0.25 * Math.sin(performance.now() / 110));
      ctx.globalAlpha = a; ctx.save(); ctx.translate(cw / 2, Math.max(ins.t + 200, ch * 0.24));
      ctx.fillStyle = 'rgba(160,30,20,.85)'; ART.rr(ctx, -112, -30, 224, 60, 16); ctx.fill(); ctx.lineWidth = 3; ctx.strokeStyle = '#ffd34d'; ctx.stroke();
      hudText('WRONG WAY', 0, 10, 26, '#fff', 'center');
      // turn-around arrow on the side to steer toward
      const d = G.wrongDir; ctx.translate(d * 150, 0); ctx.scale(d, 1);
      ctx.lineWidth = 7; ctx.lineCap = 'round'; ctx.strokeStyle = '#ffd34d'; ctx.beginPath(); ctx.arc(-14, 0, 22, Math.PI * 1.15, Math.PI * 0.35, false); ctx.stroke();
      ctx.fillStyle = '#ffd34d'; ctx.beginPath(); ctx.moveTo(-6, 34); ctx.lineTo(14, 8); ctx.lineTo(-14, 12); ctx.fill();
      ctx.restore(); ctx.globalAlpha = 1;
    }
    // stuck against something: say how to get out (a tow comes at 5.5 s anyway)
    if (R.phase === 'race' && !P.finished && P.progT > 1.5 && P.speed < 70 && P.spinT <= 0 && !(G.prompt && G.prompt.btn === 'brake')) G.prompt = { text: !G.touchUI ? 'Stuck? Hold ↓ to back out' : 'Stuck? Hold both sides to back up', t: 0, dur: 2.2, btn: 'brake' };
    if (G.prompt && G.wrongT > 0.7) G.prompt.t = Math.min(G.prompt.t, 0.01); // hold other prompts while WRONG WAY shows
    if (G.prompt && !(G.wrongT > 0.7)) {
      if (G.prompt.t > G.prompt.dur) G.prompt = null;
      else if (G.prompt.text) { const a = Math.min(1, G.prompt.t * 5) * Math.min(1, (G.prompt.dur - G.prompt.t) * 4); ctx.globalAlpha = a; coachLine(G.prompt.text, '#ffd34d'); ctx.globalAlpha = 1; }
    }
    // countdown / banners
    if (G.banner) {
      const b = G.banner;
      if (b.t > b.dur) G.banner = null;
      else {
        const k = b.t / b.dur, s = (b.big ? 1.6 : 1) * (1 + 0.5 * Math.max(0, 1 - b.t * 5)), a = 1 - Math.max(0, k - 0.75) / 0.25;
        ctx.globalAlpha = a; ctx.save(); ctx.translate(cw / 2, G.use3D ? Math.max(ins.t + 150, ch * (UI.portrait ? 0.2 : 0.3)) : ch * 0.36); ctx.scale(s, s);
        hudText(b.text, 0, 0, 40, b.col || '#fff', 'center');
        if (b.sub) hudText(b.sub, 0, 24, 15, '#f4e8cc', 'center', '800 15px Barlow, sans-serif', 3);
        if (b.sub2) hudText(b.sub2, 0, 46, 16, '#ffd34d', 'center');
        ctx.restore(); ctx.globalAlpha = 1;
      }
    }
    const races = save.races || 0;
    if (R.phase === 'countdown' && G.introT <= 0 && races >= 2 && races <= 3 && (save.hints.rocket || 0) < 2 && G.mode !== 'daily') {
      ctx.globalAlpha = clamp((2.1 - R.countdown) * 3, 0, 1); coachLine(G.touchUI ? 'Hold DRIFT as the 1 shows = rocket start' : 'Hold SHIFT as the 1 shows = rocket start', '#ffd34d', 14); ctx.globalAlpha = 1;
      if (!G.prompt || G.prompt.btn !== 'drift') G.prompt = { text: '', t: 0, dur: 0.4, btn: 'drift' };
    } else if (G.touchUI && races < 2 && !P.finished && R.raceT < 12 && G.introT <= 0 && !(G.prompt && G.prompt.text)) {
      // first two races: teach the thumb steering with one line + a live steering bar
      ctx.globalAlpha = R.phase === 'countdown' ? 1 : clamp(1 - (R.raceT - 9) / 3, 0, 1);
      coachLine('slide your thumb: edge = hard turn, middle = gentle', '#f4e8cc', 14);
      ctx.globalAlpha = 1;
    }
    if ((G.introT > 0 || (G.use3D && R.countdown > DRD.CD_STEP * 2.2)) && R.phase === 'countdown') {
      ctx.globalAlpha = G.use3D ? 1 : clamp(G.introT, 0, 1);
      const ty = G.use3D ? Math.max(ins.t + 96, ch * (UI.portrait ? 0.12 : 0.2)) : ch * 0.3;
      hudText(G.T.name, cw / 2, ty, 30, '#fff', 'center');
      hudText(G.mode === 'gp' ? 'Grand Prix · race ' + (G.gp.round + 1) + ' of 4' : G.mode === 'tt' ? 'Time trial · beat the ghost' : G.mode === 'daily' ? 'Daily Derby · ' + dailyInfo().twist.name : R.cls.name + ' · 3 laps', cw / 2, ty + 26, 16, '#f4e8cc', 'center', '800 16px Barlow, sans-serif', 3);
      ctx.globalAlpha = 1;
    }
    if (G.use3D && G.touchUI && !P.finished) drawWarnings();
  }
  // one place for teaching text: a single line just above the bottom controls, off the road ahead
  function coachY() {
    const it = UI.btn.item, y = UI.portrait && it ? it.y - it.r - 44 : ch - ins.b - 22;
    // a rival's name tag right under the line: lift the line 18 px so neither hides the other
    // (held for 0.4 s after the tag leaves, so the line doesn't flicker up and down)
    const now = performance.now();
    if (G.tagPts && G.tagPts.some((q) => Math.abs(q[0] - cw / 2) < 170 && q[1] > y - 16 && q[1] < y + 12)) G.coachLiftAt = now;
    return now - (G.coachLiftAt || -1e9) < 400 ? y - 18 : y;
  }
  function coachLine(text, col, size) { size = size || 15; if (G.incoming) return; hudText(text, cw / 2, coachY(), size, col || '#f4e8cc', 'center', '800 ' + size + 'px Barlow, sans-serif', 3.5); }
  function drawButtons() {
    const R = G.race, P = R.player, tap = save.steer === 'tap', snow = G.T && G.T.season === 'winter';
    const held = { drift: false, brake: false, item: false };
    for (const q of ptrs.values()) if (q.role in held) held[q.role] = true;
    if (G.kb.drift) held.drift = true;
    // (no steering edge glow: the steering bar and the rig's turning front wheels already show your input)
    // first two races: a live steering bar just above ITEM (dot = how hard the car is turning)
    const it = UI.btn.item;
    if (tap && it && (save.races || 0) < 2 && R.raceT < 12) {
      const a = R.phase === 'countdown' ? 1 : clamp(1 - (R.raceT - 9) / 3, 0, 1), y = it.y - it.r - 14;
      ctx.globalAlpha = a;
      ctx.fillStyle = 'rgba(20,12,6,.55)'; ART.rr(ctx, cw / 2 - 64, y - 4.5, 128, 9, 4.5); ctx.fill();
      ctx.fillStyle = 'rgba(244,232,204,.75)'; ctx.fillRect(cw / 2 - 60, y - 1.5, 120, 3); ctx.fillRect(cw / 2 - 1, y - 4, 2, 8);
      ctx.fillStyle = '#ffd34d'; ctx.beginPath(); ctx.arc(cw / 2 + clamp(P.steer || 0, -1, 1) * 60, y, 5, 0, TAU); ctx.fill(); ctx.lineWidth = 1.5; ctx.strokeStyle = '#2a1a0c'; ctx.stroke();
      ctx.globalAlpha = 1;
    }
    // item name for a second after you pick it up
    if (it && G.itemName && G.itemName.t < 1) {
      ctx.globalAlpha = Math.min(1, (1 - G.itemName.t) * 5);
      hudText(G.itemName.text, it.x, it.y - it.r - (tap && (save.races || 0) < 2 && R.raceT < 12 ? 26 : 12), 13, '#ffe7a8', 'center', '800 13px Barlow, sans-serif', 3);
      ctx.globalAlpha = 1;
    }
    for (const k in UI.btn) {
      const b = UI.btn[k], on = held[b.role];
      ctx.save(); ctx.translate(b.x, b.y);
      // on snow the pale buttons vanish: a dark fill and a dark ring, and they stay more opaque when idle
      let fill = snow ? 'rgba(40,28,18,.55)' : 'rgba(30,20,10,.5)', ring = snow ? 'rgba(40,28,18,.9)' : 'rgba(244,232,204,.7)', alpha = 1, s = on ? 0.92 : 1;
      if (b.role === 'drift') {
        if (P.drifting && P.driftTier === 2) { fill = 'rgba(255,80,50,.55)'; ring = '#ff8a5a'; }
        else if (P.drifting && P.driftTier === 1) { fill = 'rgba(255,200,60,.45)'; ring = '#ffe27a'; }
        else if (on) fill = snow ? 'rgba(40,28,18,.65)' : 'rgba(244,232,204,.35)';
        else alpha = snow ? 0.85 : 0.45;
      } else if (b.role === 'item') {
        const full = P.item || P.roulette > 0;
        if (P.item && P.roulette <= 0) { ring = '#ffd34d'; fill = 'rgba(255,200,60,' + (0.25 + 0.15 * Math.sin(performance.now() / 150)) + ')'; }
        else if (on) fill = 'rgba(244,232,204,.35)';
        if (!full) alpha = snow ? 0.6 : 0.35;
        if (G.itemShake > 0) ctx.translate(Math.sin(G.itemShake * 60) * 4, 0);
        if (G.itemPop > 0) s *= 1 + G.itemPop * 0.35;
      } else if (on) fill = 'rgba(255,90,60,.45)';
      ctx.scale(s, s); ctx.globalAlpha = alpha;
      ctx.fillStyle = fill; ctx.beginPath(); ctx.arc(0, 0, b.r, 0, TAU); ctx.fill();
      ctx.lineWidth = 3; ctx.strokeStyle = ring; ctx.stroke();
      // drift charge arc
      if (b.role === 'drift' && P.drifting) { const kk = clamp(P.driftT / DRD.DRIFT_T2, 0, 1); ctx.lineWidth = 5; ctx.strokeStyle = P.driftTier === 2 ? '#ff5a3c' : P.driftTier === 1 ? '#ffd34d' : '#fff'; ctx.beginPath(); ctx.arc(0, 0, b.r - 6, -Math.PI / 2, -Math.PI / 2 + kk * TAU); ctx.stroke(); }
      if (b.role === 'item') {
        // the ITEM button is the item slot: the roulette spins on it, then it shows what you hold
        let ik = P.roulette > 0 ? null : P.item;
        if (P.roulette > 0) { const idx = Math.floor(performance.now() / 70) % 5; ik = DRD.ITEMS[idx]; if (G._lastTick !== idx) { G._lastTick = idx; A.tick(idx); } ctx.globalAlpha = 0.8; }
        if (ik) ctx.drawImage(ART.ASSETS['icon_' + ik], -b.r * 0.55, -b.r * 0.58, b.r * 1.1, b.r * 1.1);
        ctx.globalAlpha = 1;
        if (P.item && P.roulette <= 0 && P.itemN > 1) hudText('×' + P.itemN, b.r * 0.62, b.r * 0.62, 15, '#ffd34d', 'center', '"Alfa Slab One", serif', 3);
        // syrup or hay just went out the back (it lands behind the camera, so the button says so): the icon drops out of the slot
        if (G.dropPop && G.dropPop.t < 0.4) { const k = G.dropPop.t / 0.4, e2 = k * k; ctx.globalAlpha = 1 - e2; ctx.drawImage(ART.ASSETS['icon_' + G.dropPop.item], -b.r * 0.5, -b.r * 0.55 + e2 * b.r * 0.9, b.r, b.r); ctx.globalAlpha = Math.min(1, (0.4 - G.dropPop.t) * 6); hudText('DROPPED', 0, -b.r - 8 - k * 6, 12, '#ffe7a8', 'center', '800 12px Barlow, sans-serif', 3); ctx.globalAlpha = 1; }
      } else if (b.role === 'drift') { if ((save.races || 0) < 3) hudText(b.label, 0, 6, 15, '#f4e8cc', 'center', '"Alfa Slab One", serif', 3); }
      else hudText(b.label, 0, 4, 11, '#f4e8cc', 'center', '800 11px Barlow, sans-serif', 3);
      ctx.globalAlpha = 1;
      if (G.prompt && G.prompt.btn === b.role && !(G.prompt.side && b.role === 'drift' && (k === 'driftL' ? -1 : 1) !== G.prompt.side)) { ctx.strokeStyle = 'rgba(255,211,77,' + (0.5 + 0.5 * Math.sin(performance.now() / 120)) + ')'; ctx.lineWidth = 4; ctx.beginPath(); ctx.arc(0, 0, b.r + 8, 0, TAU); ctx.stroke(); }
      ctx.restore();
    }
  }

  function drawConfetti(list, dt) {
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    if (list.length < 140 && Math.random() < 0.8) list.push({ x: Math.random() * cw, y: -10, vx: (Math.random() - 0.5) * 40, vy: 70 + Math.random() * 90, r: Math.random() * TAU, c: ['#ffd34d', '#e8452a', '#f4e8cc', '#7fe08a', '#e8862a'][Math.floor(Math.random() * 5)] });
    for (const c of list) { c.x += c.vx * dt; c.y += c.vy * dt; c.r += dt * 6; ctx.save(); ctx.translate(c.x, c.y); ctx.rotate(c.r); ctx.fillStyle = c.c; ctx.fillRect(-4, -2, 8, 4); ctx.restore(); }
    for (let i = list.length - 1; i >= 0; i--) if (list[i].y > ch + 20) list.splice(i, 1);
  }
  // podium (drawn on canvas behind the DOM card)
  function drawPodium(dt) {
    const pd = G.podium; pd.t += dt;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const gr = ctx.createLinearGradient(0, 0, 0, ch); gr.addColorStop(0, '#1d2a44'); gr.addColorStop(1, '#5a3a24'); ctx.fillStyle = gr; ctx.fillRect(0, 0, cw, ch);
    const base = ch * 0.34, w = Math.min(110, cw * 0.26);
    const order = [1, 0, 2], hs = [70, 100, 50];
    order.forEach((idx, i) => {
      const s = pd.st[idx]; if (!s) return;
      const x = cw / 2 + (i - 1) * (w + 8), h = hs[i] * easeOut(pd.t * 1.5 - i * 0.15);
      ctx.fillStyle = ['#c9ccd2', '#f2c230', '#c98a4a'][i]; ctx.fillRect(x - w / 2, base - h, w, h + 400);
      ctx.fillStyle = 'rgba(0,0,0,.2)'; ctx.fillRect(x - w / 2, base - h, w, 8);
      hudText(String(idx + 1), x, base - h + 62, 30, '#fff', 'center');
      const sp = ART.ASSETS['car' + s.rig]; if (sp && h > 10) { ctx.save(); ctx.translate(x, base - h - 24 + Math.sin(pd.t * 3 + i) * 2); ctx.rotate(-Math.PI / 2); ctx.scale(1.7, 1.7); ctx.drawImage(sp.c, -sp.ox / ART.CS, -sp.oy / ART.CS, sp.c.width / ART.CS, sp.c.height / ART.CS); ctx.restore(); }
      hudText(s.name, x, base - h - 64, 15, s.name === 'You' ? '#ffd34d' : '#fff', 'center', '800 15px Barlow, sans-serif', 3);
    });
    if (pd.conf.length < 120 && Math.random() < 0.7) pd.conf.push({ x: Math.random() * cw, y: -10, vx: (Math.random() - 0.5) * 40, vy: 60 + Math.random() * 80, r: Math.random() * TAU, c: ['#ffd34d', '#e8452a', '#7fd3ff', '#7fe08a', '#fff'][Math.floor(Math.random() * 5)] });
    for (const c of pd.conf) { c.x += c.vx * dt; c.y += c.vy * dt; c.r += dt * 6; ctx.save(); ctx.translate(c.x, c.y); ctx.rotate(c.r); ctx.fillStyle = c.c; ctx.fillRect(-4, -2, 8, 4); ctx.restore(); }
    pd.conf = pd.conf.filter((c) => c.y < ch + 20);
  }

  // ------------------------------------------------------------ main loop
  let last = performance.now();
  function frame(now) {
    requestAnimationFrame(frame);
    let dt = (now - last) / 1000; last = now;
    if (dt > 0.1) dt = 0.1; if (dt < 0) dt = 0;
    G.frameMs = G.frameMs * 0.95 + dt * 1000 * 0.05;
    G.frameDt = dt;
    watchPerf(dt);
    tick(dt);
    rigShots(now / 1000);
    if (G.screen === 'podium') {
      if (V3on()) { G.podium.t += dt; render(); drawConfetti(G.podium.conf, dt); }
      else drawPodium(dt);
      return;
    }
    render();
    if (G.screen === 'race' || G.screen === 'paused') drawHUD(G.screen === 'race' ? dt : 0);
    if (G.screen === 'results' && G.confetti) drawConfetti(G.confetti, dt);
  }
  // photo finish: another car within half a car-length as you near the line on the final lap
  function checkPhoto() {
    const R = G.race, P = R && R.player;
    if (!P || G.demo || P.finished || G.photo || P.lapIdx !== R.laps - 1 || R.phase !== 'race') return;
    const toGo = R.laps * R.T.L - P.dist;
    const close = R.cars.some((c) => c !== P && Math.abs(c.dist - P.dist) < 34 && (!c.finished || R.raceT - c.finishT < 0.4));
    if (toGo < 90 && toGo > 0 && close) G.photo = true;
  }
  function updateTimers(dt) {
    if (G.flash > 0) G.flash -= dt * 1.6;
    if (G.hitV > 0) G.hitV -= dt;
    if (G.dropPop) { G.dropPop.t += dt; if (G.dropPop.t > 0.4) G.dropPop = null; }
    if (G.itemShake > 0) G.itemShake -= dt; if (G.itemPop > 0) G.itemPop -= dt * 2; if (G.placePop > 0) G.placePop -= dt * 2;
    if (G.itemName) G.itemName.t += dt; if (G.lapDelta) G.lapDelta.t += dt;
    if (G.banner) G.banner.t += dt;
    if (G.prompt) G.prompt.t += dt;
  }
  function tick(dt) {
    const R = G.race;
    if (!R || G.hold) return; // __T.hold(): tests freeze the race while frames keep drawing
    const live = G.screen === 'race' || G.screen === 'title';
    if (!live) { A.engine(false, 0, 0, 0); return; }
    if (G.screen === 'race') readControls();
    if (G.introT > 0) { G.introT -= dt; updateCamera(dt); return; }
    if (G.hitPause > 0) { G.hitPause -= dt; dt *= 0.1; }
    const P = R.player;
    G.timeScale = G.photo && P && (!P.finished || R.raceT - P.finishT < 0.5) ? 0.28 : lerp(G.timeScale, 1, Math.min(1, dt * 3));
    G.acc += dt * G.timeScale;
    let n = 0;
    while (G.acc >= DT && n < 24) {
      for (const c of R.cars) { c.px = c.x; c.py = c.y; c.ph = c.h; }
      R.step(); G.acc -= DT; n++;
      checkPhoto(); handleEvents();
      if (G.screen === 'race') recordGhost();
    }
    if (n >= 24) G.acc = 0;
    G.alpha = clamp(G.acc / DT, 0, 1);
    R.cars.forEach((c, i) => carFx(c, i, dt * G.timeScale));
    updateParts(dt * G.timeScale);
    updateCamera(dt);
    updateTimers(dt);
    if (G.use3D && G.screen === 'race') updateWarnings(dt);
    // engine sound
    if (G.screen === 'race' && P) {
      const sp = (R.phase === 'countdown' ? 0.15 + (P.inp.drift ? 0.25 : 0) : P.speed / R.cls.vmax);
      const rough = P.surf === S.MUD ? 1 : P.surf === S.SHOULDER || P.surf === S.LEAVES || P.surf === S.DIRT ? 0.6 : 0.1;
      A.engine(true, sp, P.drifting ? 0.9 : Math.min(1, Math.abs(P.slip || 0) / 120), rough, P.boostT > 0, P.drifting ? clamp(P.driftT / DRD.DRIFT_T2, 0, 1) : 0);
      if (R.tractor && G.T.tractor) { const d = camDist(R.tractor.x, R.tractor.y); G.tractT = (G.tractT || 0) - dt; if (d < 500 && G.tractT <= 0) { G.tractT = 0.16; A.tractor(1 - d / 500); } }
    } else A.engine(false, 0, 0, 0);
    // results after finish
    if (G.screen === 'race' && R.done && !G.resultsQueued) { G.resultsQueued = true; if (!(G.finishShownT > 0)) G.finishShownT = 1.2; }
    if (G.screen === 'race' && P && P.finished && G.finishShownT > 0) { G.finishShownT -= dt; if (G.finishShownT <= 0) showResults(); }
    // demo: restart when done
    if (G.demo && (R.done || R.raceT > 70)) startRace({ demo: true, track: (G.trackI + 1) % 4, cls: 1 });
  }

  // ------------------------------------------------------------ 3D helpers: rig snapshots, frame-time watch, fallback, boot
  // the results card and the Garage show a turning 3D rig (rendered by the 3D view into their 2D canvases)
  function rigShots(t) {
    G.rigShot = null;
    if (!V3on()) return;
    G.rigFrame = (G.rigFrame || 0) + 1; if (G.rigFrame % 2) return; // 30 Hz is plenty for a turning preview (each one is a GPU readback)
    if (G.screen === 'results' && G.race && G.race.player && !$('results').hidden) { const p = G.race.player; G.rigShot = { canvas: $('rsCar'), rig: p.rig.id, paint: p.paintI || 0, angle: 0.7 + Math.sin(t * 0.7) * 0.5, dist: 100, camH: 34, fov: 22 }; }
    else if (G.screen === 'title' && !$('panGarage').hidden) { $('garageRig').hidden = false; G.rigShot = { canvas: $('garageRig'), rig: save.rig, paint: paintOk(save.paint) ? save.paint : 0, angle: t * 0.6, dist: 100, camH: 34, fov: 22 }; }
  }
  // if the average frame time stays above 19 ms, the next race (or the pause menu) drops the 3D pixel ratio a step
  function watchPerf(dt) {
    if (!V3on() || G.screen !== 'race' || !G.race || G.race.phase !== 'race' || document.hidden) { G.pw = null; return; }
    const w = G.pw || (G.pw = { t: 0, n: 0 }); w.t += dt; w.n++;
    if (w.t >= 2) { if (w.t / w.n * 1000 > 19) G.prDrop = 1; G.pw = null; }
  }
  function applyPRDrop() {
    if (!G.prDrop || !V3on()) return;
    G.prDrop = 0;
    const cur = G.v3.view(G).pixelRatio;
    if (cur <= 1) return;
    save.prMax = cur > 1.25 ? 1.25 : 1; persist(); G.v3.resize(cw, ch, save.prMax);
  }
  function fallbackTop() { // WebGL died or the 3D module never arrived: the old top-down renderer takes over
    if (!G.use3D) return;
    G.use3D = false; glCanvas.style.display = 'none';
    if (G.T) G.ground = ART.buildGround(G.T);
    if (G.T && G.race) { const f = G.race.player || G.race.cars[0], p0 = G.T.point(f.s + 120); G.cam.x = p0.x; G.cam.y = p0.y; G.cam.a = f.h; G.cam.z = UI.z0; }
    initWeather();
  }
  DRD.onView3D = function (V) {
    if (!G.use3D) return;
    G.v3 = V; V.resize(cw, ch, save.prMax || 0);
    requestAnimationFrame(() => glCanvas.classList.remove('off'));
    renderTitle();
  };
  DRD.onView3DFail = function () { fallbackTop(); };
  DRD.onContextLost = function () { if (G.screen === 'race') pauseGame(); };
  DRD.onContextRestored = function () { if (G.v3) G.v3.resize(cw, ch, save.prMax || 0); };
  if (G.use3D) setTimeout(() => { if (!G.v3) fallbackTop(); }, 9000);
  function medalLine() {
    let g = 0, sv = 0, b = 0;
    for (const k in save.best) { const m = save.best[k] && save.best[k].medal; if (m === 0) g++; else if (m === 1) sv++; else if (m === 2) b++; }
    const el = $('medalCount'); if (!el) return;
    el.hidden = !(g + sv + b); el.textContent = '🥇 ' + g + ' · 🥈 ' + sv + ' · 🥉 ' + b + '  of 24';
  }

  // ------------------------------------------------------------ boot
  layout();
  bind();
  ART.prep('spring');
  goTitle();
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => renderTitle());
  requestAnimationFrame(frame);

  // ------------------------------------------------------------ test hooks
  window.__T = {
    noPause: false,
    start(o) { o = o || {}; if (o.steer) save.steer = o.steer; if (o.rig != null) save.rig = o.rig; if (o.cls != null) save.cls = o.cls; G.mode = o.mode || 'single'; if (G.mode === 'gp') G.gp = { round: o.round || 0, pts: {}, rig: {}, cls: save.cls, nameSeed: 5 }; startRace({ mode: G.mode, track: o.track || 0, cls: o.cls, seed: o.seed }); hideAll(); G.screen = 'race'; if (o.skipIntro !== false) G.introT = 0; if (o.skipCountdown) { G.race.countdown = 0.001; } layoutButtons(); return this.state(); },
    step(ms) { const n = Math.round((ms || 16) / (DT * 1000)); G.alpha = 1; G.frameDt = DT; for (let i = 0; i < n; i++) { if (G.screen === 'race') readControls(); for (const c of G.race.cars) { c.px = c.x; c.py = c.y; c.ph = c.h; } G.race.step(); if (G.use3D && G.screen === 'race') updateWarnings(DT); checkPhoto(); handleEvents(); recordGhost(); G.race.cars.forEach((c, j) => carFx(c, j, DT)); if (i % 2 === 0) { updateParts(DT * 2); updateCamera(DT * 2); updateTimers(DT * 2); } if (G.screen === 'race' && G.race.player && G.race.player.finished && G.finishShownT > 0) { G.finishShownT -= DT; if (G.finishShownT <= 0) { showResults(); break; } } } render(); if (G.screen === 'race') drawHUD(0); return this.state(); },
    state() {
      const R = G.race; if (!R) return { screen: G.screen };
      return { screen: G.screen, mode: G.mode, track: G.T.name, phase: R.phase, t: +R.raceT.toFixed(2), countdown: R.countdown, fps: Math.round(1000 / G.frameMs), parts: G.parts.length,
        player: R.player ? { place: R.player.place, lap: R.player.lapIdx + 1, speed: Math.round(R.player.speed), steer: +R.player.inp.steer.toFixed(2), drift: R.player.inp.drift, drifting: R.player.drifting, tier: R.player.driftTier, brake: R.player.inp.brake, item: R.player.item, itemN: R.player.itemN, boost: R.player.boostT > 0, finished: R.player.finished, laps: R.player.lapTimes.map((t) => +t.toFixed(2)), surf: R.player.surf } : null,
        cars: R.order.map((c) => ({ name: c.name, place: c.place, lap: c.lapIdx + 1, dist: Math.round(c.dist), finished: c.finished, t: c.finished ? +c.finishT.toFixed(2) : null, laps: c.lapTimes.map((t) => +t.toFixed(2)), respawns: c.respawns })) };
    },
    input(o) { G.virt = o ? Object.assign({}, G.virt || {}, o) : null; if (o && o.use) { pressItem(); delete G.virt.use; } return this.state(); },
    autopilot(on) { const p = G.race && G.race.player; if (p) { p.auto = on !== false; if (!p.ai) p.ai = null; } return this.state(); },
    thumb(x, y) { if (x == null) { ptrs.delete('T'); return; } const q = ptrs.get('T'); if (q) q.x = x; else ptrs.set('T', { role: 'steer', x, y: y || 640, x0: x, t: ++ptrSeq, btn: null }); }, // a scripted thumb (fast bot tests)
    pointers() { return Array.from(ptrs.values()).map((p) => ({ role: p.role, x: Math.round(p.x), y: Math.round(p.y) })); },
    buttons() { return JSON.parse(JSON.stringify(UI.btn)); },
    // full races, headless, every car on AI (no rendering)
    simRace(track, cls, seed) { return DRD.simRace(track, { cls, seed }); },
    simAll(seeds) { const out = []; for (let t = 0; t < 4; t++) for (let c = 0; c < 3; c++) for (let s = 1; s <= (seeds || 1); s++) { const r = DRD.simRace(t, { cls: c, seed: s * 31 + c }); out.push({ track: r.track, cls: r.cls, seed: s, winner: r.cars[0].finish, last: r.cars[5].finish, bestLap: Math.min(...r.cars.flatMap((x) => x.laps)), worstLap: Math.max(...r.cars.flatMap((x) => x.laps)), respawns: r.cars.reduce((a, x) => a + x.respawns, 0), unfinished: r.cars.filter((x) => x.est).length }); } return out; },
    showResults() { showResults(); return G.screen; },
    goTitle() { goTitle(); return G.screen; },
    perf(n) { n = n || 60; const t0 = performance.now(); for (let i = 0; i < n; i++) { render(); drawHUD(0); } const gl = G.v3 && G.v3.renderer && G.v3.renderer(); if (gl) gl.getContext().finish(); return +((performance.now() - t0) / n).toFixed(2); },
    view() { return V3on() ? G.v3.view(G) : { mode: 'top' }; },
    project(x, y, h) { return V3on() ? G.v3.project(x, y, h || 0) : null; },
    camMode(m) { return V3on() ? G.v3.camMode(m) : null; },
    fallback() { fallbackTop(); return G.use3D; },
    hold(on) { G.hold = on !== false; return G.hold; },
    G, save
  };
})();
