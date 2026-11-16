/* Dirt Road Derby — 3D chase view. Draws the world for game.js; the race itself stays in sim.js (2D, untouched).
   Sim (x, y) maps to three (x, height, y). Exposes window.DRD.V3; calls DRD.onView3D() when ready. */
import * as THREE from './vendor/three.module.min.js';
import * as M from './models3d.js';

const DRD = window.DRD, S = DRD.SURF, TAU = Math.PI * 2, D2R = Math.PI / 180;
const clamp = (v, a, b) => v < a ? a : v > b ? b : v;
const lerp = (a, b, t) => a + (b - a) * t;
const wrapA = (a) => { while (a > Math.PI) a -= TAU; while (a < -Math.PI) a += TAU; return a; };
const ease = (t) => { t = clamp(t, 0, 1); return t * t * (3 - 2 * t); };
const expK = (rate, dt) => 1 - Math.exp(-rate * dt);

// ------------------------------------------------------------ season looks (art direction, design section 9)
const LOOK = {
  spring: { grass: '#5f9a45', grass2: '#6c9f45', verge: '#66783c', road: '#b8905f', road2: '#ab8456', mud: '#5a3d27', ice: '#a8dcef', leaf: '#c7702a', dirt: '#97794f',
    skyTop: '#5f9fd8', skyHor: '#d4e6ef', haze: '#cbd6c0', fog: [540, 1650], hemiSky: '#e6f2ff', hemiGround: '#6a7040', hemi: 1.9, sun: '#fff2d8', sunI: 2.1, sunDir: [0.5, 0.8, -0.35],
    crowns: ['#5fa046', '#7bb450', '#4c8a3e', '#6aa84a'], birch: '#a8c45a', evergreen: '#2f5d46', wall: '#8f8c82', wallKind: 'stone' },
  autumn: { grass: '#8a8f3a', grass2: '#9a8838', verge: '#6c6530', road: '#bc9262', road2: '#b08658', mud: '#5a3d27', ice: '#a8dcef', leaf: '#c7702a', dirt: '#9a7a4e',
    skyTop: '#86b8e0', skyHor: '#f6e2c2', haze: '#ecd6b4', fog: [540, 1650], hemiSky: '#ffeedd', hemiGround: '#7a6438', hemi: 1.8, sun: '#ffd9a8', sunI: 2.3, sunDir: [-0.6, 0.55, -0.2],
    crowns: ['#c8552a', '#e08a2e', '#e0b23c', '#9c3a22'], birch: '#e8c23a', evergreen: '#2f5d46', wall: '#8f8a7e', wallKind: 'fence' },
  winter: { grass: '#eef3f7', grass2: '#e2eaf2', verge: '#cfd9e2', road: '#b9b3a8', road2: '#aca598', mud: '#8a7b68', ice: '#a8dcef', leaf: '#c7702a', dirt: '#b0a492',
    skyTop: '#a9bdd2', skyHor: '#e2e8ee', haze: '#dde3e9', fog: [300, 1100], hemiSky: '#f2f6fb', hemiGround: '#b8c4d0', hemi: 2.0, sun: '#ffffff', sunI: 1.3, sunDir: [0.3, 0.7, 0.5],
    crowns: ['#8a8a7a', '#9a9482', '#7e7a6c'], birch: '#c8c4b4', evergreen: '#2f5d46', wall: '#ffffff', wallKind: 'snow' },
  night: { grass: '#3e6a46', grass2: '#3a6040', verge: '#3a5034', road: '#b08659', road2: '#a27a50', mud: '#5a3d27', ice: '#a8dcef', leaf: '#c7702a', dirt: '#97794f',
    skyTop: '#0b1430', skyHor: '#1d2b4d', haze: '#1d2b4d', fog: [250, 900], hemiSky: '#5068a8', hemiGround: '#203024', hemi: 0.55, sun: '#a8b8ff', sunI: 0.35, sunDir: [-0.7, 0.5, 0.1],
    crowns: ['#4a8a46', '#3e7a40', '#5a9450'], birch: '#7a9a4a', evergreen: '#24503c', wall: '#6e6a62', wallKind: 'stone' }
};

const V3 = { ok: false, mode: 'chase', buildMs: 0, info: {} };
DRD.V3 = V3;
let renderer, scene, camera, canvas, cw = 390, ch = 844, pr = 1;
let trk = null;            // per-track build (disposed on track change)
let curT = null;
const disposables = [];
const SH = {};             // shared resources (live across tracks)
const tmpM2 = new THREE.Matrix4();
const tmpV = new THREE.Vector3(), tmpV2 = new THREE.Vector3(), tmpM = new THREE.Matrix4(), tmpQ = new THREE.Quaternion(), tmpE = new THREE.Euler(), tmpS = new THREE.Vector3(), tmpC = new THREE.Color();
const UP = new THREE.Vector3(0, 1, 0);

// ------------------------------------------------------------ init
function init() {
  canvas = document.getElementById('gl');
  const ctxGL = DRD.glCtx; // game.js made it (or decided on the top-down fallback: ?view=top or no WebGL2)
  if (!ctxGL) throw new Error('no webgl context (top-down fallback)');
  renderer = new THREE.WebGLRenderer({ canvas, context: ctxGL, antialias: true, powerPreference: 'high-performance' });
  renderer.setClearColor(0x2b1d12, 1);
  renderer.info.autoReset = false;
  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(60, 0.5, 2, 2600);
  camera.rotation.order = 'YXZ';
  buildShared();
  canvas.addEventListener('webglcontextlost', (e) => { e.preventDefault(); V3.lost = true; if (DRD.onContextLost) DRD.onContextLost(); }, false);
  // three re-uploads every geometry and texture by itself after a restore (they keep their data), so nothing is rebuilt here
  canvas.addEventListener('webglcontextrestored', () => { V3.lost = false; if (DRD.onContextRestored) DRD.onContextRestored(); }, false);
}

function tex(c, srgb) { const t = new THREE.CanvasTexture(c); if (srgb !== false) t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; return t; }
function lambert(o) { return new THREE.MeshLambertMaterial(Object.assign({ vertexColors: true, flatShading: true }, o || {})); }

// ------------------------------------------------------------ shared (rigs, items, effects)
function buildShared() {
  const ART = DRD.ART;
  SH.glowTex = tex(M.glowTexture());
  SH.coneTex = tex(M.coneTexture());
  SH.noiseTex = tex(M.noiseTexture(), false); SH.noiseTex.wrapS = SH.noiseTex.wrapT = THREE.RepeatWrapping; SH.noiseTex.anisotropy = 1;
  SH.crateTex = tex(M.crateTexture(ART && ART.drawLeaf));
  const chev = M.chevronTexture(), chevR = document.createElement('canvas'); chevR.width = chev.width; chevR.height = chev.height; { const g = chevR.getContext('2d'); g.translate(chev.width, 0); g.scale(-1, 1); g.drawImage(chev, 0, 0); }
  SH.chevLTex = tex(chev); SH.chevRTex = tex(chevR);
  SH.heaveTex = tex(M.diamondTexture('heave')); SH.tractorTex = tex(M.diamondTexture('tractor'));
  SH.bannerTex = tex(M.bannerTexture()); SH.checkTex = tex(M.checkerTexture()); SH.checkTex.magFilter = THREE.NearestFilter;
  // rig materials: a night fill tinted by each rig's own paint (uFill), and a dithered fade (alphaHash) for a rival that comes
  // between the lens and your rig. Dithering keeps depth correct, so a fading rig never shows its own inside faces.
  SH.fillU = { value: 0 }; SH.fillPU = { value: 0 };
  const rigMat = (fillU, o) => { const m = lambert(o);
    m.onBeforeCompile = (sh) => { sh.uniforms.uFill = fillU; sh.fragmentShader = 'uniform float uFill;\n' + sh.fragmentShader.replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\n totalEmissiveRadiance += diffuseColor.rgb * uFill;'); };
    m.customProgramCacheKey = () => 'rigfill'; return m; };
  SH.carMat = rigMat(SH.fillU); SH.playerMat = rigMat(SH.fillPU, { emissive: new THREE.Color(0x141414) });
  // a fading rival: a depth-only pass first (drawn after everything opaque, so it never punches a hole in your rig), then its
  // colour at the faded alpha on the nearest faces only, so no inside faces show through
  SH.fadeMats = []; for (let i = 0; i < 7; i++) { const fm = rigMat(SH.fillU, { transparent: true, depthWrite: false }); SH.fadeMats.push(fm); }
  SH.depthMat = new THREE.MeshBasicMaterial({ colorWrite: false, transparent: true, depthWrite: true });
  SH.rigMat = rigMat;
  SH.ghostMat = new THREE.MeshLambertMaterial({ color: 0xa0d7ff, transparent: true, opacity: 0.45, flatShading: true, depthWrite: false });
  SH.rigGeo = {};
  SH.wheelGeo = M.wheelGeo();
  SH.cars = []; for (let i = 0; i < 7; i++) { const m = new THREE.Mesh(new THREE.BufferGeometry(), SH.carMat); m.rotation.order = 'YXZ'; m.matrixAutoUpdate = true; m.visible = false; m.frustumCulled = false;
    m.userData.piv = []; for (let k = 0; k < 8; k++) { const o = new THREE.Object3D(); m.add(o); m.userData.piv.push(o); }
    const dm = new THREE.Mesh(m.geometry, SH.depthMat); dm.visible = false; dm.frustumCulled = false; dm.renderOrder = 8; m.add(dm); m.userData.depth = dm;
    M.WHEELS.forEach(([x, z], k) => m.userData.piv[k].position.set(x, M.WHEEL_R, z));
    [[18.2, 6.6, 6.4], [18.2, 6.6, -6.4], [-18.1, 8.2, 6.6], [-18.1, 8.2, -6.6]].forEach(([x, y, z], k) => m.userData.piv[4 + k].position.set(x, y, z));
    scene.add(m); SH.cars.push(m); m.userData.spin = 0; }
  SH.wheels = new THREE.InstancedMesh(SH.wheelGeo, lambert(), 28); SH.wheels.frustumCulled = false; scene.add(SH.wheels);
  SH.lamps = new THREE.InstancedMesh(new THREE.BoxGeometry(0.8, 2.2, 3.6), new THREE.MeshBasicMaterial({ toneMapped: false }), 28); SH.lamps.frustumCulled = false; scene.add(SH.lamps);
  SH.lamps.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(28 * 3), 3);
  // flat soft blobs: shadows (dark, normal blend) and light pools (additive)
  const flat = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
  SH.shadows = new THREE.InstancedMesh(flat, new THREE.MeshBasicMaterial({ map: SH.glowTex, color: 0x000000, transparent: true, opacity: 0.42, depthWrite: false }), 80); SH.shadows.frustumCulled = false; SH.shadows.renderOrder = 1; scene.add(SH.shadows);
  SH.pools = new THREE.InstancedMesh(flat, new THREE.MeshBasicMaterial({ map: SH.glowTex, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }), 60); SH.pools.frustumCulled = false; SH.pools.renderOrder = 2; scene.add(SH.pools);
  SH.pools.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(60 * 3), 3);
  SH.cones = new THREE.InstancedMesh(flat.clone().translate(0.5, 0, 0), new THREE.MeshBasicMaterial({ map: SH.coneTex, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, color: 0x8a7a5a, toneMapped: false }), 8); SH.cones.frustumCulled = false; SH.cones.renderOrder = 2; scene.add(SH.cones);
  // billboards that always face the camera (tail-lights at night, beacon, lamp heads)
  SH.flares = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ map: SH.glowTex, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, fog: false, toneMapped: false }), 64); SH.flares.frustumCulled = false; SH.flares.renderOrder = 3; scene.add(SH.flares);
  SH.flares.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(64 * 3), 3);
  // items
  SH.crates = new THREE.InstancedMesh(M.crateGeo(), new THREE.MeshLambertMaterial({ map: SH.crateTex }), 24); SH.crates.frustumCulled = false; scene.add(SH.crates);
  SH.crateGlow = new THREE.InstancedMesh(flat, new THREE.MeshBasicMaterial({ map: SH.glowTex, color: 0xffc860, transparent: true, opacity: 0.55, blending: THREE.AdditiveBlending, depthWrite: false }), 24); SH.crateGlow.frustumCulled = false; SH.crateGlow.renderOrder = 2; scene.add(SH.crateGlow);
  SH.puddles = new THREE.InstancedMesh(new THREE.CircleGeometry(1, 14).rotateX(-Math.PI / 2), new THREE.MeshLambertMaterial({ color: 0xc8701a, emissive: 0x4a2004 }), 16); SH.puddles.frustumCulled = false; scene.add(SH.puddles);
  SH.jugs = new THREE.InstancedMesh(M.jugGeo(), lambert(), 16); SH.jugs.frustumCulled = false; scene.add(SH.jugs);
  SH.bales = new THREE.InstancedMesh(M.baleGeo(), lambert(), 16); SH.bales.frustumCulled = false; scene.add(SH.bales);
  SH.pines = new THREE.InstancedMesh(M.pineconeGeo(), lambert(), 16); SH.pines.frustumCulled = false; scene.add(SH.pines);
  SH.snows = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(1, 1), new THREE.MeshLambertMaterial({ color: 0xf4f8fc, emissive: 0x2a3440, flatShading: true }), 16); SH.snows.frustumCulled = false; scene.add(SH.snows);
  // boost: two short additive flame jets from the tail of any boosting rig (one instanced draw)
  SH.flames = new THREE.InstancedMesh(M.flameGeo(), new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false, fog: false, side: THREE.DoubleSide, opacity: 0.9 }), 14);
  SH.flames.frustumCulled = false; SH.flames.renderOrder = 6; SH.flames.count = 0; scene.add(SH.flames);
  SH.tractor = new THREE.Mesh(M.tractorGeo(), lambert()); SH.tractor.rotation.order = 'YXZ'; scene.add(SH.tractor);
  SH.beacon = new THREE.Mesh(new THREE.BoxGeometry(3, 3, 3), new THREE.MeshBasicMaterial({ color: 0xffa000, toneMapped: false })); SH.tractor.add(SH.beacon); SH.beacon.position.set(-8, 35.5, 0);
  // particles: one Points draw
  SH.PMAX = 640;
  const pg = new THREE.BufferGeometry();
  pg.setAttribute('position', new THREE.BufferAttribute(new Float32Array(SH.PMAX * 3), 3).setUsage(THREE.DynamicDrawUsage));
  pg.setAttribute('pcol', new THREE.BufferAttribute(new Float32Array(SH.PMAX * 4), 4).setUsage(THREE.DynamicDrawUsage));
  pg.setAttribute('psize', new THREE.BufferAttribute(new Float32Array(SH.PMAX), 1).setUsage(THREE.DynamicDrawUsage));
  pg.setAttribute('pvel', new THREE.BufferAttribute(new Float32Array(SH.PMAX * 4), 4).setUsage(THREE.DynamicDrawUsage));
  // soft particles: dust, smoke, steam, snow are radial-falloff puffs (no hard rim); sparks and chips are streaks stretched
  // along their screen-space velocity (pvel.xyz = world velocity, pvel.w = stretch, 0 = a round puff)
  SH.pmat = new THREE.ShaderMaterial({
    uniforms: { uScale: { value: 400 }, uAsp: { value: 0.46 }, fogC: { value: new THREE.Color() }, fogR: { value: new THREE.Vector2(500, 1500) } },
    vertexShader: `attribute vec4 pcol; attribute float psize; attribute vec4 pvel; uniform float uScale; uniform float uAsp; varying vec4 vC; varying float vD; varying vec2 vDir; varying float vStr;
      void main(){ vec4 mv = modelViewMatrix * vec4(position, 1.0); vD = -mv.z; vec4 c0 = projectionMatrix * mv;
        float sz = clamp(psize * uScale / max(vD, 1.0), 1.0, 30.0); vStr = 1.0; vDir = vec2(1.0, 0.0);
        if (pvel.w > 0.0) { vec4 c1 = projectionMatrix * (modelViewMatrix * vec4(position + pvel.xyz * 0.03, 1.0));
          vec2 d = (c1.xy / max(c1.w, 0.01) - c0.xy / max(c0.w, 0.01)) * vec2(uAsp, 1.0); float l = length(d);
          if (l > 1e-5) vDir = d / l; vStr = mix(1.0, pvel.w, smoothstep(0.0, 0.012, l)); sz = min(sz * (0.7 + 0.45 * vStr), 40.0); }
        gl_PointSize = sz; gl_Position = c0; vC = pcol; }`,
    fragmentShader: `uniform vec3 fogC; uniform vec2 fogR; varying vec4 vC; varying float vD; varying vec2 vDir; varying float vStr;
      void main(){ vec2 q = gl_PointCoord - 0.5; q.y = -q.y; float a;
        if (vStr > 1.05) { vec2 r = vec2(dot(q, vDir), dot(q, vec2(-vDir.y, vDir.x)) * vStr); float e = length(r) * 2.0; a = 1.0 - smoothstep(0.45, 1.0, e); }
        else { float d = length(q) * 2.0; a = exp(-d * d * 2.4) * (1.0 - smoothstep(0.75, 1.0, d)); }
        if (a < 0.01) discard;
        vec3 c = mix(vC.rgb, fogC, clamp((vD - fogR.x) / (fogR.y - fogR.x), 0.0, 1.0)); gl_FragColor = vec4(c, vC.a * a);
        #include <colorspace_fragment>
      }`,
    transparent: true, depthWrite: false
  });
  SH.points = new THREE.Points(pg, SH.pmat); SH.points.frustumCulled = false; SH.points.renderOrder = 4; scene.add(SH.points);
  // drift sparks also get an additive glow (a second, larger, faint point on the same spot), coloured by tier
  SH.GMAX = 200;
  const gg = new THREE.BufferGeometry();
  gg.setAttribute('position', new THREE.BufferAttribute(new Float32Array(SH.GMAX * 3), 3).setUsage(THREE.DynamicDrawUsage));
  gg.setAttribute('pcol', new THREE.BufferAttribute(new Float32Array(SH.GMAX * 4), 4).setUsage(THREE.DynamicDrawUsage));
  gg.setAttribute('psize', new THREE.BufferAttribute(new Float32Array(SH.GMAX), 1).setUsage(THREE.DynamicDrawUsage));
  gg.setAttribute('pvel', new THREE.BufferAttribute(new Float32Array(SH.GMAX * 4), 4)); // halos stay round
  SH.gmat = SH.pmat.clone(); SH.gmat.uniforms = SH.pmat.uniforms; SH.gmat.blending = THREE.AdditiveBlending;
  SH.glowPts = new THREE.Points(gg, SH.gmat); SH.glowPts.frustumCulled = false; SH.glowPts.renderOrder = 5; scene.add(SH.glowPts);
  // skid marks: a ring buffer of quads on the ground
  SH.SKN = 1200;
  const sg = new THREE.BufferGeometry();
  sg.setAttribute('position', new THREE.BufferAttribute(new Float32Array(SH.SKN * 6 * 3), 3).setUsage(THREE.DynamicDrawUsage));
  sg.setAttribute('color', new THREE.BufferAttribute(new Float32Array(SH.SKN * 6 * 4), 4).setUsage(THREE.DynamicDrawUsage));
  // each segment remembers when it was laid (birth) and fades out between 20 and 24 s, so tracks never build up into wide
  // dark bands by lap 3; each is capped at 35% darkness
  sg.setAttribute('birth', new THREE.BufferAttribute(new Float32Array(SH.SKN * 6).fill(-1e4), 1).setUsage(THREE.DynamicDrawUsage));
  SH.skidNow = { value: 0 };
  const skm = new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
  skm.onBeforeCompile = (sh) => { sh.uniforms.uNow = SH.skidNow;
    sh.vertexShader = 'attribute float birth; uniform float uNow; varying float vAge;\n' + sh.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\n vAge = uNow - birth;');
    sh.fragmentShader = 'varying float vAge;\n' + sh.fragmentShader.replace('#include <color_fragment>', '#include <color_fragment>\n diffuseColor.a *= 1.0 - smoothstep(20.0, 24.0, vAge);'); };
  skm.customProgramCacheKey = () => 'skidfade';
  SH.skids = new THREE.Mesh(sg, skm);
  SH.skids.frustumCulled = false; SH.skids.renderOrder = 1; SH.skidI = 0; scene.add(SH.skids);
  // ghost (time trial)
  SH.ghost = new THREE.Mesh(new THREE.BufferGeometry(), SH.ghostMat); SH.ghost.rotation.order = 'YXZ'; SH.ghost.visible = false; scene.add(SH.ghost);
  // lights
  SH.hemi = new THREE.HemisphereLight(0xffffff, 0x556633, 1.6); scene.add(SH.hemi);
  SH.sun = new THREE.DirectionalLight(0xffffff, 2); scene.add(SH.sun); scene.add(SH.sun.target);
  SH.spot = new THREE.SpotLight(0xfff0d0, 0, 440, 34 * D2R, 0.55, 0); scene.add(SH.spot); scene.add(SH.spot.target);
  scene.fog = new THREE.Fog(0xcfe0ea, 500, 1500);
  // sky dome + horizon backdrop (follow the camera's position, never its rotation)
  SH.sky = new THREE.Mesh(new THREE.SphereGeometry(2500, 24, 12), new THREE.ShaderMaterial({
    uniforms: { top: { value: new THREE.Color() }, hor: { value: new THREE.Color() } }, side: THREE.BackSide, depthWrite: false, fog: false,
    vertexShader: 'varying vec3 vP; void main(){ vP = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: `uniform vec3 top; uniform vec3 hor; varying vec3 vP; void main(){ float h = normalize(vP).y; gl_FragColor = vec4(mix(hor, top, pow(clamp(h, 0.0, 1.0), 0.55)), 1.0);
      #include <colorspace_fragment>
    }` }));
  SH.sky.renderOrder = -10; SH.sky.frustumCulled = false; scene.add(SH.sky);
  SH.backdrop = new THREE.Mesh(new THREE.CylinderGeometry(2350, 2350, 640, 48, 1, true), new THREE.MeshBasicMaterial({ transparent: true, side: THREE.BackSide, depthWrite: false, fog: false }));
  SH.backdrop.renderOrder = -9; SH.backdrop.frustumCulled = false; scene.add(SH.backdrop);
  SH.stars = new THREE.Points((() => { const g = new THREE.BufferGeometry(), p = new Float32Array(130 * 3), R = M.rng(5); for (let i = 0; i < 130; i++) { const a = R() * TAU, e = 0.12 + R() * 1.2, r = 2300; p[i * 3] = Math.cos(a) * Math.cos(e) * r; p[i * 3 + 1] = Math.sin(e) * r; p[i * 3 + 2] = Math.sin(a) * Math.cos(e) * r; } g.setAttribute('position', new THREE.BufferAttribute(p, 3)); return g; })(),
    new THREE.PointsMaterial({ color: 0xe8eeff, size: 2.2, sizeAttenuation: false, fog: false, depthWrite: false }));
  SH.stars.renderOrder = -8; SH.stars.frustumCulled = false; scene.add(SH.stars);
  SH.moon = new THREE.Mesh(new THREE.CircleGeometry(60, 20), new THREE.MeshBasicMaterial({ color: 0xf6f2dc, fog: false, depthWrite: false })); SH.moon.renderOrder = -7; scene.add(SH.moon);
  SH.moonHalo = new THREE.Mesh(new THREE.PlaneGeometry(420, 420), new THREE.MeshBasicMaterial({ map: SH.glowTex, color: 0x6a7ab0, transparent: true, blending: THREE.AdditiveBlending, fog: false, depthWrite: false })); SH.moonHalo.renderOrder = -7; scene.add(SH.moonHalo);
  // winter snow: 60 flakes in a box around the camera
  { const g = new THREE.BufferGeometry(), p = new Float32Array(60 * 3); g.setAttribute('position', new THREE.BufferAttribute(p, 3).setUsage(THREE.DynamicDrawUsage));
    SH.snow = new THREE.Points(g, new THREE.PointsMaterial({ color: 0xffffff, size: 3.2, map: SH.glowTex, transparent: true, depthWrite: false, opacity: 0.9 })); SH.snow.frustumCulled = false; SH.snow.visible = false; scene.add(SH.snow);
    SH.snowP = []; const R = M.rng(11); for (let i = 0; i < 60; i++) SH.snowP.push([R() * 400 - 200, R() * 120, R() * 400 - 200, 0.6 + R() * 0.8]); }
  // podium
  SH.podium = new THREE.Group(); SH.podium.visible = false; scene.add(SH.podium);
  [[0, 22], [-34, 14], [34, 8]].forEach(([z, h], i) => { const m = new THREE.Mesh(M.merge([M.part(new THREE.BoxGeometry(30, h, 30, 3, 2, 3), (x, y) => (Math.floor((y + 40) / 3.2) % 2 ? '#e6c564' : '#cfa74a'), { y: h / 2, jit: 0.1, seed: i + 2 }), M.part(new THREE.BoxGeometry(30.4, 1.2, 30.4), '#8a6a22', { y: h * 0.7 })]), lambert()); m.position.set(0, 0, z); SH.podium.add(m); m.userData.h = h; });
}

// rig geometry cache (rig id + paint index)
function rigGeoFor(rigId, paint) {
  const key = rigId + '_' + (paint || 0);
  if (!SH.rigGeo[key]) SH.rigGeo[key] = M.rigGeo(DRD.RIGS[rigId], paint ? DRD.PAINTS[paint] : null);
  return SH.rigGeo[key];
}

// ------------------------------------------------------------ per-track build
function track(o) { disposables.push(o); return o; }
function setTrack(T) {
  const t0 = performance.now();
  if (trk) { scene.remove(trk.group); disposables.forEach((o) => { if (o.dispose) o.dispose(); }); disposables.length = 0; }
  curT = T;
  const L = LOOK[T.season] || LOOK.spring;
  SH.dustCol = parseCol(L.road);
  const group = new THREE.Group();
  trk = { group, T, L, glowSpots: [], shacks: [], cows: [], bridges: [], wins: [] };
  scene.add(group);
  // lights + fog + sky
  SH.hemi.color.set(L.hemiSky); SH.hemi.groundColor.set(L.hemiGround); SH.hemi.intensity = L.hemi;
  // night: no flat grey glow (it turned every rig the same clay grey); a fill tinted by the rig's own paint keeps the green wagon green
  SH.playerMat.emissive.set(T.season === 'night' ? 0x000000 : 0x141414); SH.carMat.emissive.set(0x000000);
  SH.fillU.value = T.season === 'night' ? 0.42 : 0; SH.fillPU.value = T.season === 'night' ? 0.62 : 0;
  SH.sun.color.set(L.sun); SH.sun.intensity = L.sunI; trk.sunDir = new THREE.Vector3().fromArray(L.sunDir).normalize();
  scene.fog.color.set(L.haze); scene.fog.near = L.fog[0]; scene.fog.far = L.fog[1];
  SH.sky.material.uniforms.top.value.set(L.skyTop); SH.sky.material.uniforms.hor.value.set(L.skyHor);
  renderer.setClearColor(L.skyHor, 1);
  SH.pmat.uniforms.fogC.value.set(L.haze); SH.pmat.uniforms.fogR.value.set(L.fog[0], L.fog[1]);
  if (SH.backdrop.material.map) SH.backdrop.material.map.dispose();
  SH.backdrop.material.map = tex(M.backdropTexture(T.season, L.haze)); SH.backdrop.material.needsUpdate = true;
  const night = T.season === 'night';
  SH.stars.visible = SH.moon.visible = SH.moonHalo.visible = night;
  SH.snow.visible = T.season === 'winter';
  buildGround(T, L, group);
  buildWalls(T, L, group);
  buildTrees(T, L, group);
  buildProps(T, L, group);
  buildFurniture(T, L, group);
  buildEdges(T, L, group);
  buildRiver(T, L, group);
  // skid marks reset
  SH.skids.geometry.attributes.color.array.fill(0); SH.skids.geometry.attributes.color.needsUpdate = true; SH.skidI = 0; skidEnds.clear();
  SH.skids.geometry.attributes.birth.array.fill(-1e4); SH.skids.geometry.attributes.birth.needsUpdate = true; SH.skidNow.value = 0;
  V3.buildMs = Math.round(performance.now() - t0);
  return V3.buildMs;
}

// ---- ground: one plane painted by the sim's own surface field (so the picture can't disagree with the physics)
function buildGround(T, L, group) {
  const fw = T.fw, fh = T.fh, n = fw * fh, CELL = T.CELL, ox = T.ox, oy = T.oy, C = T.C;
  const dR = new Float32Array(n).fill(-40), dW = new Float32Array(n).fill(-40), dC = new Float32Array(n).fill(999), dK = new Int32Array(n).fill(-1);
  for (let k = 0; k < C.n; k++) {
    const x = C.X[k], y = C.Y[k], cr = C.CR[k], hw = C.HW[k], r = cr + 34;
    const c0 = Math.max(0, Math.floor((x - r - ox) / CELL)), c1 = Math.min(fw - 1, Math.floor((x + r - ox) / CELL));
    const r0 = Math.max(0, Math.floor((y - r - oy) / CELL)), r1 = Math.min(fh - 1, Math.floor((y + r - oy) / CELL));
    for (let cy = r0; cy <= r1; cy++) {
      const dy = oy + (cy + 0.5) * CELL - y;
      for (let cx = c0; cx <= c1; cx++) {
        const dx = ox + (cx + 0.5) * CELL - x, d = Math.sqrt(dx * dx + dy * dy), c = cy * fw + cx;
        if (hw - d > dR[c]) dR[c] = hw - d;
        if (cr - d > dW[c]) dW[c] = cr - d;
        if (d < dC[c]) { dC[c] = d; dK[c] = k; }
      }
    }
  }
  const A = new Uint8Array(n * 4), B = new Uint8Array(n * 4), surf = T.surf;
  for (let c = 0; c < n; c++) {
    A[c * 4] = 128 + 4 * clamp(dR[c], -31.5, 31.5); A[c * 4 + 1] = 128 + 4 * clamp(dW[c], -31.5, 31.5); A[c * 4 + 2] = Math.min(254, dC[c] * 2); A[c * 4 + 3] = 0;
  }
  // zone coverage with a 3x3 blur: R mud, G ice, B leaves, A dirt track
  const code = [S.MUD, S.ICE, S.LEAVES, S.DIRT];
  for (let cy = 0; cy < fh; cy++) for (let cx = 0; cx < fw; cx++) {
    const c = cy * fw + cx; if (dW[c] < -12) continue;
    for (let q = 0; q < 4; q++) {
      let s = 0;
      for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) { const xx = cx + i, yy = cy + j; if (xx >= 0 && yy >= 0 && xx < fw && yy < fh && surf[yy * fw + xx] === code[q]) s += (i || j) ? (i && j ? 0.0625 : 0.125) : 0.25; }
      B[c * 4 + q] = Math.round(s * 255);
    }
  }
  // along-the-road phase (so marks can run ACROSS the direction of travel and stream toward the lens) + a straightness mask.
  // RG = cos/sin of the distance along the road over a 64-unit period (a vector, so it filters smoothly), B = straight.
  const Cx = new Uint8Array(n * 4), N = T.N, SPC = T.ds;
  const straight = new Float32Array(C.n);
  for (let k = 0; k < N; k++) { const a0 = Math.atan2(C.TY[(k - 5 + N) % N], C.TX[(k - 5 + N) % N]), a1 = Math.atan2(C.TY[(k + 5) % N], C.TX[(k + 5) % N]); let da = Math.abs(a1 - a0); if (da > Math.PI) da = TAU - da; straight[k] = 1 - clamp((da - 0.06) / 0.14, 0, 1); }
  const sAt = (k) => k < N ? k * SPC : null;
  const shortOf = (k) => { for (const o of T.shorts) if (k >= o.base && k < o.base + o.M) return o; return null; };
  for (let cy = 0; cy < fh; cy++) for (let cx = 0; cx < fw; cx++) {
    const c = cy * fw + cx, k = dK[c]; if (k < 0 || dW[c] < -12) { Cx[c * 4] = Cx[c * 4 + 1] = 128; continue; }
    let s0 = sAt(k); if (s0 == null) { const o = shortOf(k); s0 = o ? (k - o.base) * DRD.SP : 0; }
    const px = ox + (cx + 0.5) * CELL - C.X[k], py = oy + (cy + 0.5) * CELL - C.Y[k];
    const sa = s0 + px * C.TX[k] + py * C.TY[k], ph = sa / 64 * TAU;
    Cx[c * 4] = Math.round(127.5 + 127 * Math.cos(ph)); Cx[c * 4 + 1] = Math.round(127.5 + 127 * Math.sin(ph)); Cx[c * 4 + 2] = Math.round(255 * straight[k]); Cx[c * 4 + 3] = 255;
  }
  const tA = track(new THREE.DataTexture(A, fw, fh)), tB = track(new THREE.DataTexture(B, fw, fh)), tC = track(new THREE.DataTexture(Cx, fw, fh));
  for (const t of [tA, tB, tC]) { t.magFilter = t.minFilter = THREE.LinearFilter; t.generateMipmaps = false; t.needsUpdate = true; }
  const W = fw * CELL, H = fh * CELL, M2 = 1600;
  const geo = track(new THREE.PlaneGeometry(W + M2 * 2, H + M2 * 2, 4, 4).rotateX(-Math.PI / 2).translate(ox + W / 2, 0, oy + H / 2));
  const col = (h) => new THREE.Color(h);
  const winter = T.season === 'winter', night = T.season === 'night';
  const mat = track(new THREE.ShaderMaterial({
    uniforms: {
      tA: { value: tA }, tB: { value: tB }, tC: { value: tC }, tN: { value: SH.noiseTex }, rect: { value: new THREE.Vector4(ox, oy, 1 / W, 1 / H) },
      cGrass: { value: col(L.grass) }, cGrass2: { value: col(L.grass2) }, cVerge: { value: col(L.verge) }, cRoad: { value: col(L.road) }, cRoad2: { value: col(L.road2) },
      cMud: { value: col(L.mud) }, cIce: { value: col(L.ice) }, cLeaf: { value: col(L.leaf) }, cDirt: { value: col(L.dirt) },
      fogC: { value: col(L.haze) }, fogR: { value: new THREE.Vector2(L.fog[0], L.fog[1]) }, uWinter: { value: winter ? 1 : 0 }, uNight: { value: night ? 1 : 0 },
      hPos: { value: new THREE.Vector2() }, hDir: { value: new THREE.Vector2(1, 0) }
    },
    vertexShader: `varying vec2 vW; varying float vD; void main(){ vec4 wp = modelMatrix * vec4(position, 1.0); vW = wp.xz; vec4 mv = viewMatrix * wp; vD = -mv.z; gl_Position = projectionMatrix * mv; }`,
    fragmentShader: `precision highp float;
      uniform sampler2D tA, tB, tC, tN; uniform vec4 rect;
      uniform vec3 cGrass, cGrass2, cVerge, cRoad, cRoad2, cMud, cIce, cLeaf, cDirt, fogC; uniform vec2 fogR, hPos, hDir; uniform float uWinter, uNight;
      varying vec2 vW; varying float vD;
      void main(){
        vec2 uv = (vW - rect.xy) * rect.zw;
        vec4 A = texture2D(tA, uv), B = texture2D(tB, uv);
        float nf = texture2D(tN, vW / 23.0).r, nb = texture2D(tN, vW / 150.0).g, nw = texture2D(tN, vW / 57.0 + 0.31).g, ns = texture2D(tN, vW / 7.0).b, nr = texture2D(tN, vW / 5.0 + 0.6).r;
        float wob = (nw - 0.5) * 4.0;
        float dR = (A.r * 255.0 - 128.0) * 0.25 + wob, dW = (A.g * 255.0 - 128.0) * 0.25 + wob * 0.7, dC = A.b * 127.5;
        vec3 col = mix(cGrass, cGrass2, smoothstep(0.35, 0.65, nb));
        col = mix(col, cVerge * (0.94 + 0.12 * nf), smoothstep(-1.5, 1.5, dW));
        vec3 road = mix(cRoad, cRoad2, smoothstep(0.3, 0.8, nb));
        float rut = 1.0 - smoothstep(0.0, 3.2, abs(dC - 11.0)); float rut2 = 1.0 - smoothstep(0.0, 3.0, abs(dC - 38.0));
        road *= 1.0 - 0.09 * rut - 0.05 * rut2; road *= 1.0 + 0.05 * (1.0 - smoothstep(0.0, 6.0, dC));
        road = mix(road, road * 0.78, uWinter * (1.0 - smoothstep(3.0, 10.0, dR)));
        road *= 0.95 + 0.1 * nr;
        // world-anchored detail ACROSS the direction of travel, strongest near the lens, so the road visibly streams at speed:
        // washboard ripples in patches, darker worn patches, pebbles, and a worn grass strip down the middle of straights
        { vec4 Cc = texture2D(tC, uv); float near = 1.0 - smoothstep(110.0, 300.0, vD);
          float ph = atan(Cc.g - 0.5, Cc.r - 0.5);
          float wb = 0.5 + 0.5 * sin(ph * 7.0 + nw * 1.5); wb = smoothstep(0.35, 1.0, wb);
          float wbPatch = smoothstep(0.34, 0.58, texture2D(tN, vW / 90.0 + 0.17).g);
          road *= 1.0 - (0.2 + 0.05 * uWinter) * wb * wbPatch * near * (1.0 - smoothstep(30.0, 46.0, dC));
          float patchD = smoothstep(0.52, 0.72, texture2D(tN, vW / 31.0 + 0.43).g);
          road *= 1.0 - 0.055 * patchD * (0.4 + 0.6 * near); // half strength: a full-strength patch read as a shadow of nothing
          float grain = texture2D(tN, vW / 170.0 + 0.21).b; // per-texel noise ~0.66 units: gravel grain
          road *= 1.0 + (min(grain, 0.36) - 0.18) * (0.9 + 0.5 * near) * (1.0 - 0.5 * uWinter);
          float peb = texture2D(tN, vW / 260.0).b, peb2 = texture2D(tN, vW / 230.0 + 0.5).b;
          road = mix(road, road * 0.55, smoothstep(0.5, 0.85, peb) * near);
          road = mix(road, road * 1.25 + 0.04, smoothstep(0.5, 0.85, peb2) * near * (1.0 - uWinter * 0.5));
          float strip = (1.0 - smoothstep(2.5, 5.5, dC + (nf - 0.5) * 5.0)) * smoothstep(0.5, 0.9, Cc.b) * smoothstep(0.3, 0.55, nb + 0.15);
          road = mix(road, mix(cVerge, cGrass, 0.4) * (0.9 + 0.2 * nr), strip * 0.75 * (1.0 - uWinter));
        }
        col = mix(col, road, smoothstep(-1.5, 1.5, dR));
        float zw = (nw - 0.5) * 0.3;
        float mud = smoothstep(0.42, 0.58, B.r + zw); vec3 mc = cMud * (0.85 + 0.3 * nf); mc += vec3(0.07) * step(0.74, nf) * (1.0 - uNight);
        col = mix(col, mc, mud);
        float ice = smoothstep(0.42, 0.58, B.g + zw); vec3 ic = cIce * (0.95 + 0.08 * nb) + vec3(0.5) * step(0.995, ns); col = mix(col, ic, ice);
        float lf = smoothstep(0.42, 0.58, B.b + zw); vec3 lc = mix(cLeaf, cLeaf * vec3(1.15, 0.7, 0.45), step(0.6, nr)) * (0.85 + 0.3 * ns); col = mix(col, lc, lf);
        float dt = smoothstep(0.42, 0.58, B.a + zw); vec3 dcol = cDirt * (0.88 + 0.24 * nf); dcol = mix(dcol, cVerge, (1.0 - smoothstep(0.0, 9.0, abs(dC - 0.0))) * 0.35); col = mix(col, dcol, dt * 0.85);
        col *= 0.93 + 0.14 * nf;
        if (uNight > 0.5) {
          vec2 d = vW - hPos; float dist = length(d); float ca = dot(d / max(dist, 1.0), hDir);
          float cone = smoothstep(0.80, 0.95, ca) * (1.0 - smoothstep(80.0, 440.0, dist));
          float near = 1.0 - smoothstep(10.0, 60.0, dist);
          float Lt = 0.10 + 1.05 * max(cone, near * 0.6);
          col *= vec3(0.62, 0.7, 1.0) * 0.1 + vec3(1.0, 0.93, 0.8) * Lt;
          col += vec3(0.20, 0.18, 0.13) * (1.0 - smoothstep(0.0, 1.2, abs(dR - 2.0))) * (1.0 - smoothstep(60.0, 700.0, dist));
        }
        col = mix(col, fogC, clamp((vD - fogR.x) / (fogR.y - fogR.x), 0.0, 1.0));
        gl_FragColor = vec4(col, 1.0);
        #include <colorspace_fragment>
      }`
  }));
  const mesh = new THREE.Mesh(geo, mat); mesh.renderOrder = -5; group.add(mesh);
  trk.ground = mat;
}

// ---- corridor walls (what you actually bounce off): stone wall, split-rail fence or snowbank
function outside(T, x, y, need) { const c = DRD.cellOf(T, x, y); if (c < 0) return true; return T.bD[c] > need; }
function buildWalls(T, L, group) {
  const C = T.C, pos = [], col = [], posts = [], refl = [];
  const kind = L.wallKind, base = new THREE.Color(L.wall);
  const prof = kind === 'snow' ? [[-9, 0], [-6, 6.5], [-1, 10], [5, 8], [11, 0]] : kind === 'fence' ? null : [[-3.2, 0], [-2.6, 5.4], [-0.6, 7.2], [1.6, 6.6], [3, 0]];
  const rails = kind === 'fence' ? [[[-0.6, 3.6], [0.6, 3.6], [0.6, 4.8], [-0.6, 4.8], [-0.6, 3.6]], [[-0.6, 7.2], [0.6, 7.2], [0.6, 8.4], [-0.6, 8.4], [-0.6, 7.2]]] : null;
  const R = M.rng((T.def.seed || 1) * 7);
  const bridgeS = T.bridge ? T.bridge.s : null;
  const runs = [];
  // main loop (both sides) + shortcuts (both sides)
  const paths = [{ X: T.X, Y: T.Y, TX: T.TX, TY: T.TY, CR: T.CR, HW: T.HW, n: T.N, closed: true, main: true }];
  T.shorts.forEach((o) => { const crA = new Float32Array(o.M).fill(o.cr), hwA = new Float32Array(o.M).fill(o.hw); paths.push({ X: o.X, Y: o.Y, TX: o.TX, TY: o.TY, CR: crA, HW: hwA, n: o.M, closed: false, main: false }); });
  for (const P of paths) for (const sd of [-1, 1]) {
    let run = [];
    const step = 2;
    for (let i = 0; i <= P.n; i += step) {
      if (!P.closed && i >= P.n) break;
      const k = i % P.n, nx = -P.TY[k] * sd, ny = P.TX[k] * sd, cr = P.CR[k];
      const x = P.X[k] + nx * (cr + 1), y = P.Y[k] + ny * (cr + 1);
      let ok = outside(T, x + nx * 8, y + ny * 8, 3) && outside(T, x, y, -6);
      if (P.main && bridgeS != null && Math.abs(T.wrapD(k * T.ds, bridgeS)) < T.bridge.half + 14) ok = false;
      if (ok) run.push([x, y, nx, ny]); else { if (run.length > 1) runs.push(run); run = []; }
      // night: reflector posts every 48 units on the shoulder line
      if (P.main && T.season === 'night' && k % 6 === 0) { const hx = P.X[k] + nx * (P.HW[k] + 8), hy = P.Y[k] + ny * (P.HW[k] + 8); const c = DRD.cellOf(T, hx, hy); if (c >= 0 && T.surf[c] === S.SHOULDER && (!bridgeS || Math.abs(T.wrapD(k * T.ds, bridgeS)) > T.bridge.half + 30)) refl.push([hx, hy]); }
    }
    if (run.length > 1) runs.push(run);
  }
  const pushProfile = (run, pr2, colr, jit) => {
    for (let i = 0; i < run.length - 1; i++) {
      const a = run[i], b = run[i + 1];
      if (Math.hypot(a[0] - b[0], a[1] - b[1]) > 40) continue;
      const j = 1 + (R() - 0.5) * jit;
      for (let p = 0; p < pr2.length - 1; p++) {
        const p0 = pr2[p], p1 = pr2[p + 1];
        const A0 = [a[0] + a[2] * p0[0], p0[1], a[1] + a[3] * p0[0]], A1 = [a[0] + a[2] * p1[0], p1[1], a[1] + a[3] * p1[0]];
        const B0 = [b[0] + b[2] * p0[0], p0[1], b[1] + b[3] * p0[0]], B1 = [b[0] + b[2] * p1[0], p1[1], b[1] + b[3] * p1[0]];
        pos.push(...A0, ...B0, ...B1, ...A0, ...B1, ...A1);
        const sh = j * (p0[1] + p1[1] > 9 ? 1.04 : 0.92);
        for (let v = 0; v < 6; v++) col.push(colr.r * sh, colr.g * sh, colr.b * sh);
      }
    }
  };
  for (const run of runs) {
    if (prof) pushProfile(run, prof, base, kind === 'snow' ? 0.04 : 0.22);
    else { // split-rail fence: two rails + posts every 24
      const wood = new THREE.Color('#8a6a48');
      for (const r of rails) pushProfile(run, r, wood, 0.18);
      let acc = 0; for (let i = 0; i < run.length - 1; i++) { acc += Math.hypot(run[i + 1][0] - run[i][0], run[i + 1][1] - run[i][1]); if (acc >= 24) { acc = 0; posts.push(run[i]); } }
    }
  }
  if (pos.length) {
    const g = track(new THREE.BufferGeometry()); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3)); g.computeVertexNormals();
    const m = new THREE.Mesh(g, track(new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true, side: THREE.DoubleSide }))); group.add(m);
  }
  if (posts.length) {
    const im = new THREE.InstancedMesh(track(new THREE.BoxGeometry(2.4, 10, 2.4).translate(0, 5, 0)), track(new THREE.MeshLambertMaterial({ color: 0x6e5238, flatShading: true })), posts.length);
    posts.forEach((p, i) => { tmpM.makeTranslation(p[0], 0, p[1]); im.setMatrixAt(i, tmpM); }); im.computeBoundingSphere(); group.add(im);
  }
  if (refl.length) {
    const im = new THREE.InstancedMesh(track(new THREE.BoxGeometry(1.4, 7, 1.4).translate(0, 3.5, 0)), track(new THREE.MeshBasicMaterial({ color: 0xfff0d6, toneMapped: false })), refl.length);
    refl.forEach((p, i) => { tmpM.makeTranslation(p[0], 0, p[1]); im.setMatrixAt(i, tmpM); }); im.computeBoundingSphere(); group.add(im);
  }
}

// ---- trees: merged into spatial chunks (one draw each, culled as a block) + far field + blob shadows
function geoArrays(g) { const n = g.attributes.position.count; return { n, p: g.attributes.position.array, c: g.attributes.color.array }; }
function buildTrees(T, L, group) {
  const R = M.rng((T.def.seed || 1) * 13);
  const list = T.decor.filter((d) => d.k === 'tree').map((d) => ({ v: d.v, x: d.x, y: d.y, r: d.r, a: d.a, seed: d.seed }));
  let x0 = 1e9, x1 = -1e9, y0 = 1e9, y1 = -1e9; for (let i = 0; i < T.N; i++) { x0 = Math.min(x0, T.X[i]); x1 = Math.max(x1, T.X[i]); y0 = Math.min(y0, T.Y[i]); y1 = Math.max(y1, T.Y[i]); }
  const kinds = (T.def.decor && T.def.decor.trees) || ['maple'];
  for (let i = 0, tries = 0; i < 150 && tries < 3000; tries++) { // far field: a tree line under the mountains
    const a = R() * TAU, rr = 1.0 + R() * 0.5, cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
    const x = cx + Math.cos(a) * ((x1 - x0) / 2 + 380) * rr, y = cy + Math.sin(a) * ((y1 - y0) / 2 + 380) * rr;
    const c = DRD.cellOf(T, x, y); if (c >= 0 && (T.surf[c] !== S.OUT || T.bD[c] < 160)) continue;
    if (Math.cos(a) < -0.45 && R() < 0.85) continue; // keep the west (lake) side mostly open so Lake Champlain shows
    list.push({ v: kinds[Math.floor(R() * kinds.length)], x, y, r: 40 + R() * 30, a: R() * TAU, seed: Math.floor(R() * 1e6) }); i++;
  }
  const winter = T.season === 'winter';
  const tpl = { trunk: geoArrays(track(M.trunkGeo())), birch: geoArrays(track(M.birchTrunkGeo())), blob: geoArrays(track(M.blobGeo(T.def.seed || 3))), ever: geoArrays(track(M.evergreenGeo(L.evergreen, winter))), bare: geoArrays(track(M.bareGeo())) };
  const CH = 700, chunks = new Map();
  const put = (key, t, x, y, z, sx, sy, sz, ry, col) => {
    let ch2 = chunks.get(key); if (!ch2) { ch2 = { p: [], c: [] }; chunks.set(key, ch2); }
    const ca = Math.cos(ry), sa = Math.sin(ry), cr = col ? col.r : 1, cg = col ? col.g : 1, cb = col ? col.b : 1;
    for (let i = 0; i < t.n; i++) {
      const px = t.p[i * 3] * sx, py = t.p[i * 3 + 1] * sy, pz = t.p[i * 3 + 2] * sz;
      ch2.p.push(x + px * ca + pz * sa, y + py, z - px * sa + pz * ca);
      ch2.c.push(t.c[i * 3] * cr, t.c[i * 3 + 1] * cg, t.c[i * 3 + 2] * cb);
    }
  };
  const shadowL = [], sap = [], col = new THREE.Color();
  for (const t of list) {
    const key = Math.floor(t.x / CH) + ',' + Math.floor(t.y / CH);
    if (t.v === 'pine' || t.v === 'spruce') { const H = t.r * 2.1; col.setRGB(1, 1, 1).multiplyScalar(0.85 + ((t.seed >> 3) % 25) / 100); put(key, tpl.ever, t.x, 0, t.y, t.r * 1.05, H, t.r * 1.05, t.a, col); shadowL.push([t.x, t.y, t.r * 2.0]); continue; }
    if (t.v === 'bare' || winter) { const H = t.r * 1.9; col.setRGB(1, 1, 1); put(key, tpl.bare, t.x, 0, t.y, H, H, H, t.a, col); shadowL.push([t.x, t.y, t.r * 1.1]); continue; }
    const H = t.r * 1.85, cr = t.r * 0.74, trunkH = H - cr * 1.05, tr = Math.max(1.6, t.r * 0.07);
    put(key, t.v === 'birch' ? tpl.birch : tpl.trunk, t.x, 0, t.y, tr * (t.v === 'birch' ? 0.8 : 1), trunkH, tr * (t.v === 'birch' ? 0.8 : 1), t.a, null);
    const pal = t.v === 'birch' ? [L.birch] : t.v === 'apple' ? ['#6a9a3c', '#7aa846'] : L.crowns;
    col.set(pal[t.seed % pal.length]).multiplyScalar(0.92 + ((t.seed >> 4) % 17) / 100);
    put(key, tpl.blob, t.x, trunkH + cr * 0.62, t.y, cr, cr, cr, t.a, col);
    shadowL.push([t.x, t.y, cr * 2.2]);
    if (T.id.indexOf('sugarbush') === 0 && t.v === 'maple') { const c = DRD.cellOf(T, t.x, t.y); if (c >= 0 && T.bD[c] < 150) sap.push([t, tr]); }
  }
  const mat = track(cutMat(lambert()));
  for (const ch2 of chunks.values()) {
    const g = track(new THREE.BufferGeometry()); g.setAttribute('position', new THREE.Float32BufferAttribute(ch2.p, 3)); g.setAttribute('color', new THREE.Float32BufferAttribute(ch2.c, 3)); g.computeVertexNormals(); g.computeBoundingSphere();
    group.add(new THREE.Mesh(g, mat));
  }
  const shadows = new THREE.InstancedMesh(track(new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2)), track(new THREE.MeshBasicMaterial({ map: SH.glowTex, color: 0x000000, transparent: true, opacity: 0.3, depthWrite: false })), Math.max(1, shadowL.length));
  shadowL.forEach(([x, y, s2], i) => { tmpM.compose(tmpV.set(x, 0.15, y), tmpQ.identity(), tmpS.set(s2, 1, s2)); shadows.setMatrixAt(i, tmpM); });
  shadows.count = shadowL.length; shadows.renderOrder = 1; shadows.computeBoundingSphere(); group.add(shadows);
  if (sap.length) { // metal sap buckets on the sugar maples by the road
    const im = new THREE.InstancedMesh(track(M.merge([M.part(new THREE.CylinderGeometry(2.2, 1.8, 4, 7), '#c4ccd2', { y: 0 }), M.part(new THREE.BoxGeometry(4.6, 0.6, 4.6), '#8a9298', { y: 2.4 })])), track(lambert()), sap.length);
    sap.forEach(([t, tr], i) => { tmpQ.identity(); tmpM.compose(tmpV.set(t.x + Math.cos(t.a) * (tr + 1.6), 9, t.y + Math.sin(t.a) * (tr + 1.6)), tmpQ, tmpS.set(1, 1, 1)); im.setMatrixAt(i, tmpM); }); im.computeBoundingSphere(); group.add(im);
  }
}

// ---- buildings, props, cows, pumpkins, tunnels
// tunnel roofs: the part within ~75 units of the lens is cut away, so following a rig through a covered bridge or the dairy
// barn shows the walls and the lit far opening, never a dark slab across the top of the view
SH.camU = { value: new THREE.Vector3() };
// trees and buildings standing on the line between the lens and your rig (the orchard shortcut, a tight bend) are cut away
// in a narrow capsule, so nothing ever hides your own rig
SH.tgtU = { value: new THREE.Vector3(0, -1e5, 0) };
function cutMat(m) {
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uCam = SH.camU; sh.uniforms.uTgt = SH.tgtU;
    sh.vertexShader = 'varying vec3 vWp;\n' + sh.vertexShader.replace('#include <project_vertex>', '#include <project_vertex>\n vWp = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    sh.fragmentShader = 'uniform vec3 uCam, uTgt; varying vec3 vWp;\n' + sh.fragmentShader.replace('void main() {', `void main() {
      if (uTgt.y > -1000.0) { vec2 a = uCam.xz, ab = uTgt.xz - a; float L2 = max(dot(ab, ab), 1.0); float t = dot(vWp.xz - a, ab) / L2;
        if (t > 0.0 && t < 0.97 && length(vWp.xz - a - ab * t) < 22.0 && vWp.y < mix(uCam.y, uTgt.y, t) + 22.0) discard; }`);
  };
  m.customProgramCacheKey = () => 'cutaway'; return m;
}
function roofMat() {
  if (trk.roofMat) return trk.roofMat;
  const m = track(lambert());
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uCam = SH.camU;
    sh.vertexShader = 'varying vec3 vWp;\n' + sh.vertexShader.replace('#include <project_vertex>', '#include <project_vertex>\n vWp = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    sh.fragmentShader = 'uniform vec3 uCam; varying vec3 vWp;\n' + sh.fragmentShader.replace('void main() {', 'void main() {\n if (length(vWp.xz - uCam.xz) < 75.0 && uCam.y < 40.0) discard;');
  };
  m.customProgramCacheKey = () => 'roofcut';
  trk.roofMat = m; return m;
}
function buildProps(T, L, group) {
  const winPos = [], mat = track(cutMat(lambert()));
  const cows = T.decor.filter((d) => d.k === 'cow'), pumps = T.decor.filter((d) => d.k === 'pumpkin');
  const geoCache = {};
  for (const d of T.decor) {
    if (d.k === 'bridge' || d.k === 'barnroof') {
      const tg = M.tunnelGeo(d.len + 6, d.w, d.k === 'barnroof' ? 'barn' : 'bridge', T.season);
      const m = new THREE.Mesh(track(tg.body), mat); m.position.set(d.x, 0, d.y); m.rotation.y = -d.a; group.add(m);
      const rm = new THREE.Mesh(track(tg.roof), roofMat()); rm.position.copy(m.position); rm.rotation.y = m.rotation.y; group.add(rm);
      trk.bridges.push({ x: d.x, y: d.y, a: d.a, half: d.len / 2, sc: d.k === 'barnroof' ? d.sc : -1 });
      continue;
    }
    const key = d.k + '_' + (d.v || 0);
    if (!(key in geoCache)) geoCache[key] = M.propGeo(d.k, T.season, d.v);
    const P = geoCache[key]; if (!P) continue;
    const m = new THREE.Mesh(P.geo, mat); m.position.set(d.x, 0, d.y); m.rotation.y = -d.a; m.scale.setScalar(d.sc || 1); group.add(m);
    m.updateMatrixWorld(true);
    for (const w of P.wins) {
      const q = new THREE.Object3D(); q.position.set(w.x, w.y, w.z); q.rotation.y = w.ry; m.add(q); q.updateMatrixWorld(true);
      const g = new THREE.PlaneGeometry(w.w, w.h); g.applyMatrix4(q.matrixWorld); winPos.push(g); m.remove(q);
    }
    if (d.k === 'shack') trk.shacks.push({ x: d.x, y: d.y, t: 0 });
    if (d.k === 'lamp') { const c = Math.cos(d.a), s = Math.sin(d.a); trk.glowSpots.push({ x: d.x - c * 12, y: d.y - s * 12, h: 37, r: 150, col: 0xffc878 }); }
    if (d.k === 'farmhouse' || d.k === 'barn') trk.glowSpots.push({ x: d.x, y: d.y, h: 0, r: 150, col: 0xb07838, pool: true });
  }
  for (const k in geoCache) if (geoCache[k]) track(geoCache[k].geo);
  // windows: one draw, dull glass by day, warm and glowing at night
  if (winPos.length) {
    let n = 0; winPos.forEach((g) => { n += g.attributes.position.count; });
    const merged = new THREE.BufferGeometry(), arr = new Float32Array(winPos.reduce((a, g) => a + g.toNonIndexed().attributes.position.count * 3, 0)); let o = 0;
    winPos.forEach((g) => { const gg = g.toNonIndexed(); arr.set(gg.attributes.position.array, o); o += gg.attributes.position.array.length; g.dispose(); gg.dispose(); });
    void n; merged.setAttribute('position', new THREE.BufferAttribute(arr, 3));
    const night = T.season === 'night';
    group.add(new THREE.Mesh(track(merged), track(new THREE.MeshBasicMaterial({ color: night ? 0xffcf6a : 0x3a4652, side: THREE.DoubleSide, toneMapped: false, polygonOffset: true, polygonOffsetFactor: -1 }))));
  }
  if (cows.length) {
    const body = new THREE.InstancedMesh(track(M.cowGeo()), track(lambert()), cows.length), head = new THREE.InstancedMesh(track(M.cowHeadGeo()), track(lambert()), cows.length);
    cows.forEach((d, i) => { tmpQ.setFromAxisAngle(UP, -d.a); tmpM.compose(tmpV.set(d.x, 0, d.y), tmpQ, tmpS.set(1, 1, 1)); body.setMatrixAt(i, tmpM); if (d.v === 1) head.setColorAt(i, tmpC.set('#8a6a52')); else head.setColorAt(i, tmpC.set('#ffffff')); trk.cows.push({ x: d.x, y: d.y, a: d.a, ha: 0 }); });
    if (head.instanceColor) head.instanceColor.needsUpdate = true;
    body.computeBoundingSphere(); group.add(body, head); trk.cowHead = head; trk.cowBody = body;
  }
  if (pumps.length) {
    const im = new THREE.InstancedMesh(track(M.pumpkinGeo()), track(lambert()), pumps.length);
    pumps.forEach((d, i) => { tmpQ.setFromAxisAngle(UP, d.a); tmpM.compose(tmpV.set(d.x, 0, d.y), tmpQ, tmpS.set(d.r, d.r, d.r)); im.setMatrixAt(i, tmpM); });
    im.computeBoundingSphere(); group.add(im);
  }
}

// ---- road furniture: chevrons, diamond signs, start banner, heave ridges
function buildFurniture(T, L, group) {
  const night = T.season === 'night';
  const signs = T.decor.filter((d) => d.k === 'sign');
  const boardGeo = track(new THREE.PlaneGeometry(28, 16)), diaGeo = track(new THREE.PlaneGeometry(20, 20)), backGeo = track(new THREE.PlaneGeometry(28, 16));
  const postGeo = track(new THREE.BoxGeometry(1.8, 1, 1.8).translate(0, 0.5, 0));
  const bright = night ? 1.0 : 0.92;
  const mkMat = (t) => track(new THREE.MeshBasicMaterial({ map: t, color: new THREE.Color(bright, bright, bright), toneMapped: false }));
  const groups = { chevL: [], chevR: [], heave: [], tractor: [] };
  signs.forEach((d) => { if (groups[d.v]) groups[d.v].push(d); });
  const posts = [], backs = [];
  const face = (d) => Math.atan2(-Math.cos(d.a), -Math.sin(d.a)); // board faces the oncoming traffic
  for (const k in groups) {
    const list = groups[k]; if (!list.length) continue;
    const chev = k === 'chevL' || k === 'chevR';
    const im = new THREE.InstancedMesh(chev ? boardGeo : diaGeo, mkMat(k === 'chevL' ? SH.chevLTex : k === 'chevR' ? SH.chevRTex : k === 'heave' ? SH.heaveTex : SH.tractorTex), list.length);
    list.forEach((d, i) => {
      const ry = face(d), y = chev ? 13 : 22;
      tmpQ.setFromAxisAngle(UP, ry); tmpM.compose(tmpV.set(d.x, y, d.y), tmpQ, tmpS.set(1, 1, 1)); im.setMatrixAt(i, tmpM);
      if (chev) { posts.push([d.x + Math.sin(ry + Math.PI / 2) * 11, d.y + Math.cos(ry + Math.PI / 2) * 11, 6]); posts.push([d.x - Math.sin(ry + Math.PI / 2) * 11, d.y - Math.cos(ry + Math.PI / 2) * 11, 6]); }
      else posts.push([d.x, d.y, 13]);
      backs.push([d.x - Math.sin(ry) * 0.3, y, d.y - Math.cos(ry) * 0.3, ry + Math.PI, chev ? 1 : 0.72]);
    });
    im.computeBoundingSphere(); group.add(im);
  }
  if (posts.length) { const im = new THREE.InstancedMesh(postGeo, track(new THREE.MeshLambertMaterial({ color: 0x5a4634 })), posts.length); posts.forEach((p, i) => { tmpM.compose(tmpV.set(p[0], 0, p[1]), tmpQ.identity(), tmpS.set(1, p[2], 1)); im.setMatrixAt(i, tmpM); }); im.computeBoundingSphere(); group.add(im); }
  if (backs.length) { const im = new THREE.InstancedMesh(backGeo, track(new THREE.MeshLambertMaterial({ color: 0x6a6a64 })), backs.length); backs.forEach((b, i) => { tmpQ.setFromAxisAngle(UP, b[3]); tmpM.compose(tmpV.set(b[0], b[1], b[2]), tmpQ, tmpS.set(b[4], b[4] * (b[4] < 1 ? 1.4 : 1), 1)); im.setMatrixAt(i, tmpM); }); im.computeBoundingSphere(); group.add(im); }
  // start / finish: two timber posts, a checkered banner across the road, a checkered strip on the ground
  { const p = T.point(0), a = Math.atan2(p.ty, p.tx), hw = p.hw + 10, nx = -p.ty, ny = p.tx;
    const pm = track(lambert());
    const postG = track(M.merge([M.part(new THREE.BoxGeometry(4, 44, 4), '#6e5238', { y: 22 })]));
    for (const s of [-1, 1]) { const m = new THREE.Mesh(postG, pm); m.position.set(p.x + nx * hw * s, 0, p.y + ny * hw * s); group.add(m); }
    const ban = new THREE.Mesh(track(new THREE.PlaneGeometry(hw * 2, hw * 2 / 8)), track(new THREE.MeshLambertMaterial({ map: SH.bannerTex, side: THREE.DoubleSide, emissive: night ? 0x404040 : 0x000000 })));
    ban.position.set(p.x, 38, p.y); ban.rotation.y = Math.atan2(-Math.cos(a), -Math.sin(a)) + 0; group.add(ban);
    const strip = new THREE.Mesh(track(new THREE.PlaneGeometry(12, p.hw * 2).rotateX(-Math.PI / 2)), track(new THREE.MeshBasicMaterial({ map: SH.checkTex, transparent: true, opacity: 0.85, polygonOffset: true, polygonOffsetFactor: -2 })));
    strip.position.set(p.x, 0.2, p.y); strip.rotation.y = -a; group.add(strip);
    trk.finish = { x: p.x, y: p.y, nx, ny, a, hw: p.hw };
  }
  // leaf piles: low mounds inside each leaf zone (visual only; the slip comes from the sim's surface field)
  const leafZ = T.zones.filter((z) => z.type === 'leaves');
  if (leafZ.length) {
    const R = M.rng((T.def.seed || 1) * 31), mounds = [];
    for (const z of leafZ) for (let i = 0; i < 6; i++) { const u = (R() - 0.5) * 1.5, v = (R() - 0.5) * 1.4, ca = Math.cos(z.a), sa = Math.sin(z.a); const x = z.x + ca * u * z.rl - sa * v * z.rw, y = z.y + sa * u * z.rl + ca * v * z.rw; if (DRD.surfAt(T, x, y) === S.LEAVES) mounds.push([x, y, 7 + R() * 6, R() * TAU]); }
    if (mounds.length) {
      const g = track(M.merge([M.part(new THREE.SphereGeometry(1, 7, 3, 0, TAU, 0, Math.PI / 2), (x, y, z) => ['#c7702a', '#d9531e', '#e0a030', '#9c3a22'][Math.abs(Math.floor(x * 7 + z * 5)) % 4], {})]));
      const im = new THREE.InstancedMesh(g, track(lambert()), mounds.length);
      mounds.forEach(([x, y, r, a], i) => { tmpQ.setFromAxisAngle(UP, a); tmpM.compose(tmpV.set(x, 0, y), tmpQ, tmpS.set(r, 4, r * 0.8)); im.setMatrixAt(i, tmpM); });
      im.computeBoundingSphere(); group.add(im);
    }
  }
  // frost heaves: a low rounded bump in the road's own colour (lighter crest, soft shadow on the far side), never a plank
  if (T.heaves.length) {
    const g = track(M.humpGeo(L.road));
    let hm;
    if (night && trk.ground) { // at night the bump is lit by your headlight cone exactly like the road around it
      hm = new THREE.MeshBasicMaterial({ vertexColors: true, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 });
      const gu = trk.ground.uniforms;
      hm.onBeforeCompile = (sh) => { sh.uniforms.hPos = gu.hPos; sh.uniforms.hDir = gu.hDir;
        sh.vertexShader = 'varying vec2 vHW;\n' + sh.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\n vHW = (modelMatrix * instanceMatrix * vec4(transformed, 1.0)).xz;');
        sh.fragmentShader = 'uniform vec2 hPos, hDir; varying vec2 vHW;\n' + sh.fragmentShader.replace('#include <color_fragment>', `#include <color_fragment>
          { vec2 d = vHW - hPos; float dist = length(d); float ca = dot(d / max(dist, 1.0), hDir);
            float cone = smoothstep(0.80, 0.95, ca) * (1.0 - smoothstep(80.0, 440.0, dist)); float near = 1.0 - smoothstep(10.0, 60.0, dist);
            float Lt = 0.10 + 1.05 * max(cone, near * 0.6); diffuseColor.rgb *= vec3(0.62, 0.7, 1.0) * 0.1 + vec3(1.0, 0.93, 0.8) * Lt; }`); };
      hm.customProgramCacheKey = () => 'heavenight';
    } else hm = new THREE.MeshLambertMaterial({ vertexColors: true, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 });
    const im = new THREE.InstancedMesh(g, track(hm), T.heaves.length);
    T.heaves.forEach((h, i) => { tmpQ.setFromAxisAngle(UP, -h.a); tmpM.compose(tmpV.set(h.x, 0, h.y), tmpQ, tmpS.set(11, 2.6, h.hw * 2 + 2)); im.setMatrixAt(i, tmpM); });
    im.computeBoundingSphere(); group.add(im);
  }
}

// ---- road edge: grass tufts and stones right at the edge of the road, short wooden posts every 60 units (speed you can see)
function buildEdges(T, L, group) {
  const R = M.rng((T.def.seed || 1) * 41), tufts = [], stones = [], posts = [];
  const night = T.season === 'night', winter = T.season === 'winter';
  const bridgeS = T.bridge ? T.bridge.s : null;
  const nearBridge = (k) => bridgeS != null && Math.abs(T.wrapD(k * T.ds, bridgeS)) < T.bridge.half + 20;
  const okAt = (x, y) => { const sf = DRD.surfAt(T, x, y); return sf === S.SHOULDER || sf === S.OUT; };
  let nextPost = 0;
  for (let i = 0; i < T.N; i++) {
    if (nearBridge(i)) continue;
    const sAlong = i * T.ds;
    for (const sd of [-1, 1]) {
      const nx = -T.TY[i] * sd, ny = T.TX[i] * sd, hw = T.HW[i];
      if (R() < 0.85) { const o = hw + 1 + R() * 6, j = (R() - 0.5) * T.ds; const x = T.X[i] + nx * o + T.TX[i] * j, y = T.Y[i] + ny * o + T.TY[i] * j; if (okAt(x, y)) tufts.push([x, y, 0.7 + R() * 0.8, R() * TAU]); }
      if (R() < 0.16) { const o = hw + 3 + R() * 10; const x = T.X[i] + nx * o, y = T.Y[i] + ny * o; if (okAt(x, y)) stones.push([x, y, 1.2 + R() * 1.8, R() * TAU]); }
    }
    if (!night && sAlong >= nextPost) { nextPost = sAlong + 60; for (const sd of [-1, 1]) { const nx = -T.TY[i] * sd, ny = T.TX[i] * sd, o = T.HW[i] + 12; const x = T.X[i] + nx * o, y = T.Y[i] + ny * o; if (okAt(x, y) && T.CR[i] - o > 6) posts.push([x, y]); } }
  }
  const tc = winter ? ['#9a8a62', '#7e7050'] : night ? ['#4f8a4a', '#3e7040'] : T.season === 'autumn' ? ['#b8a24e', '#8f8a3c'] : ['#7fae4c', '#5f923c'];
  if (tufts.length) {
    const blade = (a, lean, h, c) => { const g = new THREE.BufferGeometry(); const ca = Math.cos(a), sa = Math.sin(a);
      g.setAttribute('position', new THREE.Float32BufferAttribute([-ca * 1.6, 0, -sa * 1.6, ca * 1.6, 0, sa * 1.6, lean * -sa, h, lean * ca], 3)); return M.part(g, c, {}); };
    const g = track(M.merge([blade(0, 1.2, 6, tc[0]), blade(1.1, -1.5, 4.8, tc[1]), blade(2.2, 0.8, 5.4, tc[0]), blade(2.9, -0.6, 3.8, tc[1])]));
    const im = new THREE.InstancedMesh(g, track(new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide })), tufts.length);
    tufts.forEach(([x, y, sc, a], i) => { tmpQ.setFromAxisAngle(UP, a); tmpM.compose(tmpV.set(x, 0, y), tmpQ, tmpS.set(sc, sc, sc)); im.setMatrixAt(i, tmpM); });
    im.computeBoundingSphere(); group.add(im);
  }
  if (stones.length) {
    const g = track(M.merge([M.part(new THREE.IcosahedronGeometry(1, 0), winter ? '#8a8a88' : '#9a948a', { sy: 0.6, y: 0.25, jit: 0.25, seed: 3 })]));
    const im = new THREE.InstancedMesh(g, track(lambert()), stones.length);
    stones.forEach(([x, y, sc, a], i) => { tmpQ.setFromAxisAngle(UP, a); tmpM.compose(tmpV.set(x, 0, y), tmpQ, tmpS.set(sc * 1.3, sc, sc)); im.setMatrixAt(i, tmpM); });
    im.computeBoundingSphere(); group.add(im);
  }
  if (posts.length) { // short timber posts with a white cap: a steady beat at the edge of vision
    const g = track(M.merge([M.part(new THREE.BoxGeometry(2, 9, 2), '#6e5238', { y: 4.5 }), M.part(new THREE.BoxGeometry(2.3, 2.2, 2.3), '#f2ece0', { y: 8.4 })]));
    const im = new THREE.InstancedMesh(g, track(lambert()), posts.length);
    posts.forEach(([x, y], i) => { tmpM.makeTranslation(x, 0, y); im.setMatrixAt(i, tmpM); });
    im.computeBoundingSphere(); group.add(im);
  }
}

// ---- river (and the Milk Run pond), skipping anything inside a road corridor
function buildRiver(T, L, group) {
  if (!T.river) return;
  const pts = T.river.pts, w = T.river.w / 2, pos = [], col = [];
  const water = new THREE.Color(T.season === 'winter' ? '#c2dbe8' : T.season === 'night' ? '#2a4a66' : T.season === 'autumn' ? '#4f7f96' : '#4a86a6'), edge = water.clone().lerp(new THREE.Color(0xffffff), 0.35);
  const inRoad = (x, y) => { const s = DRD.surfAt(T, x, y); return s !== S.OUT; };
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i], b = pts[i + 1], mx = (a[0] + b[0]) / 2, my = (a[1] + b[1]) / 2;
    if (inRoad(mx, my)) continue;
    const dx = b[0] - a[0], dy = b[1] - a[1], l = Math.hypot(dx, dy) || 1, nx = -dy / l, ny = dx / l;
    const lanes = [-1, -0.6, 0.6, 1];
    for (let q = 0; q < 3; q++) {
      const o0 = lanes[q] * w, o1 = lanes[q + 1] * w;
      const A0 = [a[0] + nx * o0, 0.4, a[1] + ny * o0], A1 = [a[0] + nx * o1, 0.4, a[1] + ny * o1], B0 = [b[0] + nx * o0, 0.4, b[1] + ny * o0], B1 = [b[0] + nx * o1, 0.4, b[1] + ny * o1];
      pos.push(...A0, ...B0, ...B1, ...A0, ...B1, ...A1);
      const c0 = q === 0 ? edge : water, c1 = q === 2 ? edge : water;
      [c0, c0, c1, c0, c1, c1].forEach((c, v) => { const cc = (v === 0 || v === 1 || v === 3) ? (q === 0 ? edge : water) : (q === 2 ? edge : water); col.push(cc.r, cc.g, cc.b); void c; });
    }
  }
  if (T.river.pond) { const p = T.river.pond; for (let i = 0; i < 20; i++) { const a0 = i / 20 * TAU, a1 = (i + 1) / 20 * TAU; pos.push(p.x, 0.4, p.y, p.x + Math.cos(a1) * p.r, 0.4, p.y + Math.sin(a1) * p.r, p.x + Math.cos(a0) * p.r, 0.4, p.y + Math.sin(a0) * p.r); col.push(water.r, water.g, water.b, edge.r, edge.g, edge.b, edge.r, edge.g, edge.b); } }
  if (!pos.length) return;
  const g = track(new THREE.BufferGeometry()); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3)); g.computeVertexNormals();
  const m = new THREE.Mesh(g, track(new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide, emissive: T.season === 'night' ? 0x08101c : 0x000000, polygonOffset: true, polygonOffsetFactor: -1 }))); m.renderOrder = 0; group.add(m);
}

// ------------------------------------------------------------ camera
let PEEK_D = 220, PEEK_MAX = 0.58, PEEK_K = 0.8; // corner peek: the camera turns toward the road ahead so the apex is on screen early
V3.tunePeek = (d, m, k) => { PEEK_D = d; PEEK_MAX = m; PEEK_K = k; };
let DRIFT_AIM = 0.95, DRIFT_RATE = 5.5; // tuned by measurement: rig shows 25-37 deg off straight-up on screen in a held drift
V3.tuneDrift = (a, r) => { DRIFT_AIM = a; DRIFT_RATE = r; };
const CAM = { x: 0, y: 0, h: 46, yaw: 0, back: 88, side: 0, fovK: 0, boostT: 0, init: false, mode: 'chase', tun: 0, shake: 0, sx: 0, sy: 0, sz: 0, shotT: 0, shot: 0, lookX: 0, lookY: 0, lookH: 0, orbitA: 0, pitch: 0 };
V3.cam = CAM;
let CAM_LIM = 0.26; V3.tuneLim = (v) => { CAM_LIM = v; };
let PORT_OFF = 9.9, PORT_BACK = 76, PORT_H = 44; V3.tunePortrait = (b, h, o) => { PORT_BACK = b; PORT_H = h; if (o != null) PORT_OFF = o; };
function frame() { // framing numbers per orientation (design 4.1)
  const portrait = ch >= cw;
  // tuned so the acceptance rows hold: portrait horizon ~31%, rig centre ~60%, rig ~28% of the width; landscape 25% / 68% / 16.5%
  return portrait ? { back: PORT_BACK, h: PORT_H, off: PORT_OFF, hfov: 42, fastDrop: 6, fastFov: 4 } : { back: 69, h: 31.5, off: 7.9, vfov: 42, fastDrop: 3.5, fastFov: 3 };
}
function setFov(extra) {
  const F = frame(), asp = cw / ch;
  let v;
  if (F.hfov) v = Math.min(86, 2 * Math.atan(Math.tan((F.hfov + extra) * D2R / 2) / asp) / D2R);
  else v = F.vfov + extra;
  if (Math.abs(camera.fov - v) > 0.01 || camera.aspect !== asp) { camera.fov = v; camera.aspect = asp; camera.updateProjectionMatrix(); }
}
function carPos(G, c) { // interpolated between sim steps (and carried along a tow-back while one plays)
  const a = G.alpha == null ? 1 : G.alpha;
  let x = c.x, y = c.y, h = c.h;
  if (c.px != null) { x = lerp(c.px, c.x, a); y = lerp(c.py, c.y, a); h = c.ph + wrapA(c.h - c.ph) * a; }
  const m = SH.cars[c.i], tw = m && m.userData.tow;
  if (tw && tw.t < 1) { const k = ease(tw.t); x = lerp(tw.x, x, k); y = lerp(tw.y, y, k); }
  return [x, y, h];
}
function inTunnel(c) {
  if (!trk || !trk.bridges.length) return false;
  for (const b of trk.bridges) {
    const dx = c.x - b.x, dy = c.y - b.y, along = dx * Math.cos(b.a) + dy * Math.sin(b.a), lat = -dx * Math.sin(b.a) + dy * Math.cos(b.a);
    if (Math.abs(along) < b.half + 150 && Math.abs(lat) < 60) return true; // drop low well before the portal so the roof never fills the view
  }
  return false;
}
function chaseCam(G, c, dt, snap) {
  const T = G.T, R = G.race;
  const [cx, cy, chh] = carPos(G, c);
  const F = frame();
  const spd = c.speed, vf = c.vf != null ? c.vf : spd;
  const vdir = spd > 60 && vf > 0 ? Math.atan2(c.vy, c.vx) : chh;
  // during a drift the camera sits closer to the nose (the visual drift yaw + the remaining slip give the 20-35 deg slide);
  // yaw-rate feed-forward cancels the follow lag that would otherwise swing the rig sideways on screen
  let tgt = vdir + (c.drifting ? DRIFT_AIM : 0.35) * wrapA(chh - vdir);
  if (c.spinT <= 0) tgt += (c.yaw || 0) * (c.drifting ? 1 : 0.6) / (c.drifting ? DRIFT_RATE : 5.5);
  // corner peek: turn up to ~8 degrees toward the road 200 ahead, so the apex shows before you get there
  const onMain = c.k >= 0 && c.k < T.N;
  if (onMain && c.spinT <= 0 && Math.abs(wrapA(chh - Math.atan2(T.TY[c.k], T.TX[c.k]))) < 1.2) {
    const P = T.point(c.s + PEEK_D);
    tgt += clamp(wrapA(Math.atan2(P.y - cy, P.x - cx) - vdir), -PEEK_MAX, PEEK_MAX) * PEEK_K * clamp(spd / 200, 0, 1);
  }
  const rate = c.spinT > 0 ? 0 : c.drifting ? DRIFT_RATE : 5.5;
  if (snap || !CAM.init) { CAM.yaw = tgt; } else CAM.yaw += wrapA(tgt - CAM.yaw) * Math.min(1, rate * dt);
  CAM.yaw = wrapA(CAM.yaw);
  // tunnels (covered bridges, the dairy barn): drop low and close
  CAM.tun += ((inTunnel(c) ? 1 : 0) - CAM.tun) * Math.min(1, dt / 0.4 * 2.2);
  const boostK = ease(clamp(CAM.boostT, 0, 1));
  // top speed: above 85% of it the camera eases lower and wider over 0.6 s (44 -> 38 up, 42 -> 46 deg in portrait)
  const vmax0 = R ? R.cls.vmax : 300, fastT = c.speed > vmax0 * 0.85 && c.vf > 0 && !V3.noFast ? 1 : 0; // V3.noFast: tests only
  CAM.fast = clamp((CAM.fast || 0) + clamp(fastT - (CAM.fast || 0), -dt / 0.6, dt / 0.6), 0, 1);
  const fastK = ease(CAM.fast) * (1 - CAM.tun);
  const back = lerp(F.back, 70, CAM.tun) + 4 * boostK;
  const hgt = lerp(F.h, 26, CAM.tun) - F.fastDrop * fastK;
  // drift framing: slide 8 units toward the outside of the turn so the inside opens up
  const sideT = c.drifting ? -c.driftDir * 8 : 0;
  CAM.side += (sideT - CAM.side) * Math.min(1, 3 * dt);
  const fx = Math.cos(CAM.yaw), fy = Math.sin(CAM.yaw), rx = -fy, ry = fx;
  // the camera's offset from the rig is what's smoothed (10 /s along the view, 14 /s sideways), so there is no lag at a
  // steady speed and the framing holds at 300 u/s; a boost's +10 back is what visibly pulls the rig away from the lens
  const tox = -fx * back + rx * CAM.side, toy = -fy * back + ry * CAM.side;
  if (snap || !CAM.init) { CAM.ox = tox; CAM.oy = toy; CAM.init = true; }
  else {
    const dx = tox - CAM.ox, dy = toy - CAM.oy, along = dx * fx + dy * fy, lat = dx * rx + dy * ry;
    const ka = Math.min(1, 10 * dt), kl = Math.min(1, 14 * dt);
    CAM.ox += fx * along * ka + rx * lat * kl; CAM.oy += fy * along * ka + ry * lat * kl;
  }
  CAM.x = cx + CAM.ox; CAM.y = cy + CAM.oy;
  // keep the camera inside the road corridor (never inside a tree line or snowbank on a hairpin)
  // The corridor point is searched only on the stretch of road just behind your rig: a global nearest-point could pick the
  // other leg of a hairpin and drag the lens sideways off your rig. If the clamp moves the lens, the view turns by the
  // same angle so your rig stays where it was on screen.
  let yawFix = 0;
  if (R && R.nearest) {
    const C = T.C, N = T.N; let k = R.nearest(CAM.x, CAM.y);
    const far = k >= 0 && k < N && c.k >= 0 && c.k < N && Math.abs(((k - c.k) % N + N + N / 2) % N - N / 2) > 30; // another leg of the road
    if (far || k < 0) { k = c.k; if (c.k >= 0 && c.k < N) { let bd = 1e18; for (let j = -18; j <= 3; j++) { const kk = (c.k + j + N) % N, d2 = (CAM.x - C.X[kk]) ** 2 + (CAM.y - C.Y[kk]) ** 2; if (d2 < bd) { bd = d2; k = kk; } } } }
    if (k >= 0) { const dx = CAM.x - C.X[k], dy = CAM.y - C.Y[k], d = Math.hypot(dx, dy), lim = Math.max(C.HW[k] * 0.5, C.CR[k] - 28);
      if (d > lim) { const a0 = Math.atan2(cy - CAM.y, cx - CAM.x); CAM.x = C.X[k] + dx / d * lim; CAM.y = C.Y[k] + dy / d * lim; yawFix = wrapA(Math.atan2(cy - CAM.y, cx - CAM.x) - a0); } } // well clear of the wall line and the trees beyond it
  }
  const lift = (c.z || 0) * 12;
  CAM.h = hgt + lift * 0.3;
  // pitch: aim so the rig sits at the same screen height whatever the distance
  const dist = Math.hypot(cx - CAM.x, cy - CAM.y);
  CAM.pitch = Math.atan2(CAM.h - 8 - lift * 0.3, Math.max(20, dist)) - F.off * D2R;
  // fov: wider above 85% of top speed (eased over 0.6 s above), +2 deg punch on a boost (with the +4 pull-back: the rig ~8% smaller)
  const fovT = F.fastFov * fastK + 2 * boostK;
  CAM.fovK += (fovT - CAM.fovK) * Math.min(1, (fovT > CAM.fovK ? 14 : 6) * dt);
  // never let your rig drift more than ~14 degrees off the middle of the view (a 90-degree shortcut exit or a hairpin,
  // where the lens is still swinging round): the excess is taken out of the aim
  { const err = wrapA(Math.atan2(cy - CAM.y, cx - CAM.x) - (CAM.yaw + yawFix)), lim = CAM_LIM; if (Math.abs(err) > lim) yawFix += err - Math.sign(err) * lim; }
  placeCam(CAM.x, CAM.h, CAM.y, CAM.yaw + yawFix, CAM.pitch, CAM.fovK);
}
function clampCorridor(G, x, y, c) { // keep a camera spot well inside the road corridor (never inside a tree line)
  const R = G.race, T = G.T; if (!R || !R.nearest) return { x, y };
  let k = R.nearest(x, y); if (k < 0) k = c ? c.k : -1; if (k < 0) return { x, y };
  const C = T.C, dx = x - C.X[k], dy = y - C.Y[k], d = Math.hypot(dx, dy), lim = Math.max(C.HW[k] * 0.5, C.CR[k] - 28);
  return d > lim ? { x: C.X[k] + dx / d * lim, y: C.Y[k] + dy / d * lim } : { x, y };
}
function placeCam(x, h, y, yaw, pitch, fovExtra) {
  setFov(fovExtra || 0);
  let sx = 0, sy = 0, sz = 0;
  if (CAM.shake > 0) { sx = (Math.random() - 0.5) * 2 * CAM.shake; sy = (Math.random() - 0.5) * 2 * CAM.shake; sz = (Math.random() - 0.5) * 2 * CAM.shake; }
  camera.position.set(x + sx, h + sy, y + sz);
  camera.rotation.set(-pitch, -yaw - Math.PI / 2, 0, 'YXZ'); // never any roll
}
function lookCam(x, h, y, tx, th, ty, fovExtra) { // free camera looking at a point (intro, orbit, title shots)
  setFov(fovExtra || 0);
  const yaw = Math.atan2(ty - y, tx - x), pitch = Math.atan2(h - th, Math.hypot(tx - x, ty - y));
  CAM.yaw = yaw; CAM.pitch = pitch;
  camera.position.set(x, h, y); camera.rotation.set(-pitch, -yaw - Math.PI / 2, 0, 'YXZ');
}

function updateCamera(G, dt) {
  const R = G.race, T = G.T; if (!R) return;
  CAM.shake = Math.max(0, CAM.shake - dt * 10);
  if (CAM.boostT > 0) CAM.boostT -= dt / 0.6; // back over 0.6 s
  if (G.screen === 'podium' && G.podium) return podiumCam(G, dt);
  const P = R.player && !G.demo ? R.player : null;
  if (G.screen === 'title' || G.demo) return titleCam(G, dt);
  if (!P) return;
  if (V3.debug) { const d = V3.debug; lookCam(d.x, d.h, d.y + 1, d.x, 0, d.y, 0); return; } // tests: look straight down at a spot
  let mode = V3.forceMode || 'chase';
  if (!V3.forceMode) {
    if (R.phase === 'countdown' && !G.camSkip) mode = 'intro';
    else if (G.photo && (!P.finished || R.raceT - P.finishT < 1.2)) mode = 'finish';
    else if (G.screen === 'results' || (P.finished && R.raceT - P.finishT > 1.6)) mode = 'orbit';
  }
  if (mode !== CAM.mode) { if (mode === 'chase' && CAM.mode !== 'intro') CAM.init = false; if (mode === 'orbit') CAM.orbitT = 0; CAM.mode = mode; }
  V3.mode = mode;
  const [px, py, ph] = carPos(G, P);
  if (mode === 'intro') {
    // start 60 in front of your rig at height 14 looking at it, swing round behind it as 3-2-1 counts
    const total = 3 * DRD.CD_STEP + (G.introT0 || 0);
    const k = ease(1 - (Math.max(0, R.countdown) + Math.max(0, G.introT || 0)) / total);
    const F = frame();
    const a = ph + Math.PI * (1 - k) * (k < 1 ? 1 : 0) + 0; // angle of the camera from the car: ph = in front .. ph+pi = behind
    const ang = ph + lerp(0, Math.PI, k) * 1;
    const rad = lerp(60, F.back, k), hh = lerp(14, F.h, k);
    const cx = px + Math.cos(ang) * rad, cy = py + Math.sin(ang) * rad;
    // look target: the car's middle at first, the chase look point at the end
    const chaseLook = 100, pitchEnd = Math.atan2(F.h - 8, F.back) - F.off * D2R;
    const fx = Math.cos(ph), fy = Math.sin(ph);
    const ex = cx + fx * chaseLook, ey = cy + fy * chaseLook, eh = hh - Math.tan(pitchEnd) * chaseLook;
    const kl = k * k * k; // keep the rig in frame through the swing; the view only settles onto the road at the end
    lookCam(cx, hh, cy, lerp(px, ex, kl), lerp(9, eh, kl), lerp(py, ey, kl));
    void a;
    CAM.ox = -fx * F.back; CAM.oy = -fy * F.back; CAM.x = px + CAM.ox; CAM.y = py + CAM.oy; CAM.yaw = ph; CAM.init = true; CAM.side = 0; CAM.tun = 0;
    return;
  }
  if (mode === 'finish' && trk && trk.finish) {
    const f = trk.finish, s = 1, off = f.hw + 25;
    const x = f.x + f.nx * off * s, y = f.y + f.ny * off * s;
    lookCam(x, 10, y, f.x - f.nx * 10, 7, f.y - f.ny * 10, -6);
    return;
  }
  if (mode === 'orbit') {
    // a slow swing round the rig's front three-quarter, aligned with the road so the lens stays over the road, never in a tree
    CAM.orbitT = (CAM.orbitT || 0) + dt;
    const rp = T.point(P.s), ra = Math.atan2(rp.ty, rp.tx), oa = ra + 0.75 * Math.sin(CAM.orbitT * 0.3) + 0.35;
    let x = px + Math.cos(oa) * 72, y = py + Math.sin(oa) * 72;
    ({ x, y } = clampCorridor(G, x, y, P));
    if (Math.hypot(x - px, y - py) < 50) { x = px + Math.cos(ra) * 72; y = py + Math.sin(ra) * 72; }
    lookCam(x, 26, y, px, 8, py, 0);
    CAM.init = false;
    return;
  }
  chaseCam(G, P, dt, false);
}
// title demo: leader from a three-quarter front angle, a chase view of 3rd place, a static roadside shot; cut every 7 s
function titleCam(G, dt) {
  const R = G.race; if (!R) return;
  CAM.shotT -= dt;
  const land = cw > ch; // landscape: the wide frame put the chase shot inside the pack (a blurred tailgate behind the logo)
  if (CAM.shotT <= 0 || !CAM.init || (land && CAM.shot === 1)) { CAM.shotT = 7; CAM.shot = land ? (CAM.init && CAM.shot === 0 ? 2 : 0) : CAM.init ? (CAM.shot + 1) % 3 : 1; CAM.init = true; CAM.fixed = null; CAM.chaseInit = false; }
  const lead = R.order[0], third = R.order[2] || lead;
  if (CAM.shot === 0) {
    const [x, y, h] = carPos(G, lead), fx = Math.cos(h), fy = Math.sin(h), rx = -fy, ry = fx;
    const tx = x + fx * 95 - rx * 55, ty = y + fy * 95 - ry * 55;
    if (CAM.fixed == null) { CAM.fx = tx; CAM.fy = ty; CAM.fixed = true; }
    CAM.fx += (tx - CAM.fx) * Math.min(1, 4 * dt); CAM.fy += (ty - CAM.fy) * Math.min(1, 4 * dt);
    lookCam(CAM.fx, 30, CAM.fy, x - fx * 10, 10, y - fy * 10, 0);
  } else if (CAM.shot === 1) {
    if (!CAM.chaseInit) { CAM.init = false; CAM.chaseInit = true; }
    const save = CAM.init; chaseCam(G, third, dt, !save); CAM.init = true;
  } else {
    if (CAM.fixed == null) { // a roadside spot ~350 ahead of the leader, looking back up the road
      const p = G.T.point(lead.s + 360), nx = -p.ty, ny = p.tx; CAM.fx = p.x + nx * (p.hw + 30); CAM.fy = p.y + ny * (p.hw + 30); CAM.fixed = true;
    }
    const [x, y] = carPos(G, lead);
    lookCam(CAM.fx, 14, CAM.fy, x, 8, y, 0);
  }
}
let PODIUM_D = 140, PODIUM_A = 21; V3.tunePodium = (d, a) => { PODIUM_D = d; PODIUM_A = a; };
function podiumCam(G, dt) {
  const pd = G.podium, f = trk && trk.finish; if (!f) return;
  const portrait = ch >= cw;
  const k = ease(pd.t / 3), dist = lerp(portrait ? 210 : 250, portrait ? PODIUM_D : 170, k), h = lerp(44, portrait ? 30 : 34, k);
  const fx = Math.cos(f.a), fy = Math.sin(f.a), px = f.x + fx * 260, py = f.y + fy * 260;
  // aim low so the steps fill the top half, above the standings card
  lookCam(px - fx * dist, h, py - fy * dist, px, 16 - Math.tan((portrait ? PODIUM_A : 12) * D2R) * dist, py, 0);
}

// ------------------------------------------------------------ per-frame sync
const pcolCache = new Map();
function parseCol(s) {
  let v = pcolCache.get(s); if (v) return v;
  const c = new THREE.Color(); let a = 1;
  const m = /^rgba?\(([^)]+)\)/.exec(s);
  if (m) { const p = m[1].split(',').map(Number); c.setRGB(p[0] / 255, p[1] / 255, p[2] / 255, THREE.SRGBColorSpace); if (p.length > 3) a = p[3]; } else c.set(s);
  v = [c.r, c.g, c.b, a]; pcolCache.set(s, v); return v;
}
const crateVis = [];
function sync(G, dt) {
  const R = G.race, T = G.T, P = R.player, night = T.season === 'night';
  // tyre-track clock: advances with race time only (pausing doesn't age them; a new race on the same road keeps counting up)
  if (R.t > (SH.skidRt || 0)) SH.skidNow.value += Math.min(0.5, R.t - (SH.skidRt || 0)); SH.skidRt = R.t;
  const now = performance.now() / 1000;
  // ---- cars
  let wi = 0, li = 0, si = 0, pi = 0, fi = 0, ci = 0, fl = 0;
  const camQ = camera.quaternion;
  const flare = (x, y, z, s, col) => { if (fi >= 64) return; tmpM.compose(tmpV.set(x, y, z), camQ, tmpS.set(s, s, s)); SH.flares.setMatrixAt(fi, tmpM); SH.flares.setColorAt(fi, tmpC.set(col)); fi++; };
  const pool = (x, y, s, col) => { if (pi >= 60) return; tmpM.compose(tmpV.set(x, 0.3, y), tmpQ.identity(), tmpS.set(s, 1, s)); SH.pools.setMatrixAt(pi, tmpM); SH.pools.setColorAt(pi, tmpC.set(col)); pi++; };
  const shadow = (x, y, sx, sz, ry, op) => { if (si >= 80) return; tmpQ.setFromAxisAngle(UP, ry); tmpM.compose(tmpV.set(x, 0.25, y), tmpQ, tmpS.set(sx * op, 1, sz * op)); SH.shadows.setMatrixAt(si, tmpM); si++; };
  const fadeOK = P && !G.demo && CAM.mode === 'chase';
  // the line from the lens to your rig: a rival on it (on your bumper, or closing from behind) dissolves
  const pdx = P ? P.x - camera.position.x : 1, pdy = P ? P.y - camera.position.z : 0, pAl = Math.hypot(pdx, pdy) || 1, cfx = pdx / pAl, cfy = pdy / pAl;
  // items right at the lens (a snowball rolling up from behind, a bale you just passed) shrink away inside ~50 units
  const lensK = (x, y) => fadeOK ? clamp((Math.hypot(x - camera.position.x, y - camera.position.z) - 36) / 14, 0, 1) : 1;
  R.cars.forEach((c, i) => {
    const m = SH.cars[i]; m.visible = true;
    const key = c.isPlayer && c.paintI ? c.rig.id + '_' + c.paintI : c.rig.id + '_0';
    if (m.userData.key !== key) { m.geometry = rigGeoFor(c.rig.id, c.isPlayer ? c.paintI || 0 : 0); m.userData.key = key; }
    m.material = c.isPlayer && !G.demo ? SH.playerMat : SH.carMat; m.userData.faded = false;
    let fade = 1;
    if (fadeOK && c !== P) { // a rival coming between the lens and your rig dissolves to nothing over ~25 units (its shadow stays)
      const dx = c.x - camera.position.x, dy = c.y - camera.position.z, al = dx * cfx + dy * cfy, lat = Math.abs(dx * -cfy + dy * cfx);
      if (al < pAl - 6 && lat < 18 + Math.max(0, al) * 0.12) fade = clamp((al - (pAl - 29)) / 23, 0, 1);
      if (al < 0 && lat < 40) fade = 0;
    }
    m.userData.fade = fade; m.renderOrder = 0; m.userData.depth.visible = false;
    if (fade < 1) {
      m.userData.faded = fade < 0.75; // wheels and lamps can't dissolve, so they go first
      if (fade <= 0.02) m.visible = false;
      else { m.material = SH.fadeMats[i]; m.material.opacity = fade; m.renderOrder = 9; m.userData.depth.visible = true; m.userData.depth.geometry = m.geometry; }
    }
    const [x, y, h] = carPos(G, c);
    let lift = (c.z || 0) * 12 + (c.hop > 0 ? Math.sin((1 - c.hop / 0.14) * Math.PI) * 2.5 : 0);
    // tow-back: lifted, carried to the road and dropped (0.6 s); carPos already carries it sideways
    const tw = m.userData.tow;
    if (tw) { tw.t += dt / 0.6; if (tw.t >= 1) m.userData.tow = null; else lift += Math.sin(tw.t * Math.PI) * 12; }
    const ud = m.userData;
    ud.drift = lerp(ud.drift || 0, c.drifting ? c.driftDir : 0, Math.min(1, 8 * dt));
    ud.roll = lerp(ud.roll || 0, -(c.steer || 0) * (c.drifting ? 7 : 4) * D2R, Math.min(1, 10 * dt));
    ud.pitch = lerp(ud.pitch || 0, (c.boostT > 0 ? 3 : 0) * D2R, Math.min(1, 6 * dt));
    if (c.airT <= 0 && ud.wasAir) ud.squash = 0.12; ud.wasAir = c.airT > 0;
    if (ud.squash > 0) ud.squash -= dt;
    const sq = ud.squash > 0 ? 1 - 0.08 * (ud.squash / 0.12) : 1;
    m.position.set(x, lift, y);
    m.rotation.set(ud.roll, -(h + ud.drift * 12 * D2R), ud.pitch, 'YXZ');
    m.scale.set(1, sq, 1);
    m.updateMatrixWorld(true);
    // wheels: spin with speed, fronts turn with steer
    ud.spin = (ud.spin || 0) - (c.vf != null ? c.vf : c.speed) * dt / M.WHEEL_R;
    const brake = c.inp && c.inp.brake;
    if (!ud.faded) { // a see-through rival on your bumper drops its (opaque) wheels and lamps too
      for (let k = 0; k < 4; k++) {
        const pv = ud.piv[k]; pv.rotation.set(0, k < 2 ? -(c.steer || 0) * 0.45 : 0, ud.spin, 'YXZ'); pv.updateMatrixWorld(true);
        SH.wheels.setMatrixAt(wi++, pv.matrixWorld);
      }
      // lamps: cream headlights, red tail-lights (brighter when braking)
      for (let k = 0; k < 4; k++) { const pv = ud.piv[4 + k]; SH.lamps.setMatrixAt(li, pv.matrixWorld); SH.lamps.setColorAt(li, tmpC.set(k < 2 ? '#fff6dc' : brake ? '#ff3a24' : '#b4261c')); li++; }
    }
    shadow(x, y, 48, 30, -h, 1 - (c.z || 0) * 0.3);
    if (night && !ud.faded) {
      const tl = (c === P ? 0.55 : 1) * (brake ? 16 : 10);
      pv2(ud.piv[6], tmpV); flare(tmpV.x, tmpV.y, tmpV.z, tl, brake ? '#ff4030' : '#c02818');
      pv2(ud.piv[7], tmpV); flare(tmpV.x, tmpV.y, tmpV.z, tl, brake ? '#ff4030' : '#c02818');
      pv2(ud.piv[4], tmpV); flare(tmpV.x, tmpV.y, tmpV.z, 9, '#fff0c8'); pv2(ud.piv[5], tmpV); flare(tmpV.x, tmpV.y, tmpV.z, 9, '#fff0c8');
      if (!(c.isPlayer && !G.demo) && ci < 8) { tmpQ.setFromAxisAngle(UP, -h); tmpM.compose(tmpV.set(x + Math.cos(h) * 16, 0.35, y + Math.sin(h) * 16), tmpQ, tmpS.set(260, 1, 120)); SH.cones.setMatrixAt(ci++, tmpM); }
      pool(x, y, 70, '#3a3020');
    }
    // boost flames: two jets from the tail, length by boost strength, flickering, fading out over the last 0.25 s
    if (c.boostT > 0 && m.visible && !ud.faded && fl < 14) {
      const str = c.boostDur >= 0.85 ? 1 : 0.65, out = clamp(c.boostT / 0.25, 0, 1), on = clamp((Math.max(0.01, c.boostDur) - c.boostT) / 0.06, 0, 1);
      for (const z of [-5.4, 5.4]) {
        const len = (6 + 9 * str) * (0.8 + 0.35 * Math.random()) * out * on, r = (1.6 + 0.6 * str) * (0.7 + 0.3 * out);
        tmpE.set(0, 0, 0.1); tmpQ.setFromEuler(tmpE); tmpM2.compose(tmpV.set(-18.6, 5.4, z), tmpQ, tmpS.set(Math.max(0.01, len), r, r));
        tmpM.multiplyMatrices(m.matrixWorld, tmpM2); SH.flames.setMatrixAt(fl++, tmpM);
        tmpV.set(-19, 5.4, z).applyMatrix4(m.matrixWorld); flare(tmpV.x, tmpV.y, tmpV.z, (7 + 6 * str) * out, '#ffa040');
      }
    }
  });
  SH.flames.count = fl; SH.flames.instanceMatrix.needsUpdate = true;
  for (let i = R.cars.length; i < SH.cars.length; i++) SH.cars[i].visible = false;
  // ghost
  const gp = G.ghostNow;
  if (gp) {
    SH.ghost.visible = true;
    if (SH.ghost.userData.rig !== gp.rig) { SH.ghost.geometry = rigGeoFor(gp.rig, 0); SH.ghost.userData.rig = gp.rig; }
    SH.ghost.position.set(gp.x, 0, gp.y); SH.ghost.rotation.set(0, -gp.h, 0, 'YXZ');
  } else SH.ghost.visible = false;
  SH.wheels.count = wi; SH.wheels.instanceMatrix.needsUpdate = true;
  SH.lamps.count = li; SH.lamps.instanceMatrix.needsUpdate = true; SH.lamps.instanceColor.needsUpdate = true;
  // ---- crates: floating, spinning, bobbing, a soft glow disc below
  let k = 0;
  R.crates.forEach((cr, j) => {
    const was = crateVis[j] || 0;
    if (!cr.alive) { crateVis[j] = 0; return; }
    const t = Math.min(1, was + dt / 0.25); crateVis[j] = t;
    // 60% size (a full-size crate filled the view as you drove through it), and it bursts a little before a rig that can
    // take it gets there: it shrinks away over the last ~30 units, then the splinters fly
    let dmin = 1e9; for (const c of R.cars) { if (R.items && (c.item || c.roulette > 0)) continue; const fx = Math.cos(c.h), fy = Math.sin(c.h), dx = cr.x - c.x, dy = cr.y - c.y, al = dx * fx + dy * fy;
      if (al > -10 && al < 70 && Math.abs(dx * -fy + dy * fx) < 24 && al < dmin) dmin = al; } // a rig on course to take it
    const burstK = ease(clamp((dmin - 18) / 34, 0, 1));
    const s = 0.6 * (t < 1 ? 1 + 1.70158 * Math.pow(t - 1, 3) + 2.70158 * Math.pow(t - 1, 2) : 1) * lensK(cr.x, cr.y) * (0.15 + 0.85 * burstK); // ease-out-back pop-in
    tmpE.set(0.25, cr.spin * 0.9, 0.18, 'YXZ'); tmpQ.setFromEuler(tmpE);
    tmpM.compose(tmpV.set(cr.x, 10 + Math.sin(now * 3 + cr.spin) * 1.2, cr.y), tmpQ, tmpS.set(s, s, s)); SH.crates.setMatrixAt(k, tmpM);
    tmpM.compose(tmpV.set(cr.x, 0.3, cr.y), tmpQ.identity(), tmpS.set(32 * burstK, 1, 32 * burstK)); SH.crateGlow.setMatrixAt(k, tmpM);
    k++;
  });
  SH.crates.count = SH.crateGlow.count = k; SH.crates.instanceMatrix.needsUpdate = true; SH.crateGlow.instanceMatrix.needsUpdate = true;
  // ---- ground objects: syrup (puddle + tipped jug), hay bales
  let np = 0, nb = 0;
  for (const o of R.objs) {
    if (o.dead) continue;
    const k2 = Math.min(1, o.age / 0.25), sc = (1 - Math.pow(1 - k2, 3)) * (o.life < 1 ? o.life : 1);
    if (o.type === 'syrup' && np < 16) {
      tmpQ.setFromAxisAngle(UP, o.a); tmpM.compose(tmpV.set(o.x, 0.35, o.y), tmpQ, tmpS.set(26 * sc, 1, 22 * sc)); SH.puddles.setMatrixAt(np, tmpM);
      const jk = sc * lensK(o.x, o.y); tmpE.set(0, o.a, 1.25, 'YXZ'); tmpQ.setFromEuler(tmpE); tmpM.compose(tmpV.set(o.x + Math.cos(o.a) * 6, 5.5 * jk, o.y + Math.sin(o.a) * 6), tmpQ, tmpS.set(jk, jk, jk)); SH.jugs.setMatrixAt(np, tmpM); np++;
    } else if (o.type === 'hay' && nb < 16) {
      tmpQ.setFromAxisAngle(UP, -o.a); const s = (0.6 + 0.4 * sc) * lensK(o.x, o.y); tmpM.compose(tmpV.set(o.x, 0, o.y), tmpQ, tmpS.set(s, s, s)); SH.bales.setMatrixAt(nb, tmpM); nb++;
      shadow(o.x, o.y, 40, 30, -o.a, 1);
    }
  }
  SH.puddles.count = SH.jugs.count = np; SH.bales.count = nb;
  [SH.puddles, SH.jugs, SH.bales].forEach((im) => { im.instanceMatrix.needsUpdate = true; });
  // ---- projectiles: tumbling pinecones (arc when thrown), rolling snowballs
  let npi = 0, ns = 0;
  for (const p of R.proj) {
    if (p.dead) continue;
    if (p.type === 'pine' && npi < 16) {
      const hgt = 6 + 6 * Math.sin(clamp(p.age / 0.45, 0, 1) * Math.PI);
      tmpE.set(p.a, Math.atan2(-p.vy, p.vx), 1.2, 'YXZ'); tmpQ.setFromEuler(tmpE); const pk = 1.25 * lensK(p.x, p.y); tmpM.compose(tmpV.set(p.x, hgt, p.y), tmpQ, tmpS.set(pk, pk, pk)); SH.pines.setMatrixAt(npi++, tmpM);
      shadow(p.x, p.y, 16, 16, 0, 0.9);
      if (night && pk > 0.4) flare(p.x, hgt, p.y, 18, '#5a3a20');
    } else if (p.type === 'snow' && ns < 16) {
      const r = p.r * 1.05, rk = r * lensK(p.x, p.y); tmpE.set(p.a, Math.atan2(-p.vy, p.vx), 0, 'YXZ'); tmpQ.setFromEuler(tmpE); tmpM.compose(tmpV.set(p.x, r, p.y), tmpQ, tmpS.set(rk, rk, rk)); SH.snows.setMatrixAt(ns++, tmpM);
      shadow(p.x, p.y, r * 2.6, r * 2.6, 0, 1);
      if (night && rk > 0.3) flare(p.x, r, p.y, r * 3, '#4a5a70');
    }
  }
  SH.pines.count = npi; SH.snows.count = ns; SH.pines.instanceMatrix.needsUpdate = true; SH.snows.instanceMatrix.needsUpdate = true;
  // (no donut ring: drawn over the roof it read as a flying pancake up the road; the flames say "boost")
  // ---- tractor + beacon (visible through fog)
  if (R.tractor) {
    const tr = R.tractor; SH.tractor.visible = true; SH.tractor.position.set(tr.x, 0, tr.y); SH.tractor.rotation.set(0, -tr.h, 0, 'YXZ');
    const on = tr.warn && Math.floor(now * 4) % 2;
    SH.beacon.material.color.set(on ? 0xffb000 : 0x7a4a00);
    if (on) flare(tr.x - Math.cos(tr.h) * 8, 37, tr.y - Math.sin(tr.h) * 8, 46, '#ffa000');
    shadow(tr.x, tr.y, 50, 34, -tr.h, 1);
    if (night) { tmpQ.setFromAxisAngle(UP, -tr.h); tmpM.compose(tmpV.set(tr.x + Math.cos(tr.h) * 24, 0.35, tr.y + Math.sin(tr.h) * 24), tmpQ, tmpS.set(220, 1, 110)); if (ci < 8) SH.cones.setMatrixAt(ci++, tmpM); }
  } else SH.tractor.visible = false;
  // ---- night glows: lamps, lit barns and farmhouses
  if (trk && night) for (const g of trk.glowSpots) {
    if (Math.abs(g.x - camera.position.x) > 1200 || Math.abs(g.y - camera.position.z) > 1200) continue;
    pool(g.x, g.y, g.r * (g.pool ? 1.6 : 1.2), g.pool ? '#4a3418' : '#6a4e24');
    if (!g.pool) flare(g.x, g.h, g.y, 40, '#ffd088');
  }
  // ---- cows look at the nearest car
  if (trk && trk.cowHead) {
    trk.cows.forEach((cw2, i) => {
      let best = null, bd = 260 * 260; for (const c of R.cars) { const d = (c.x - cw2.x) ** 2 + (c.y - cw2.y) ** 2; if (d < bd) { bd = d; best = c; } }
      const want = best ? clamp(wrapA(Math.atan2(best.y - cw2.y, best.x - cw2.x) - cw2.a), -0.9, 0.9) : Math.sin(now * 0.4 + i) * 0.3;
      cw2.ha += (want - cw2.ha) * Math.min(1, 3 * dt);
      const fx = Math.cos(cw2.a), fy = Math.sin(cw2.a);
      tmpQ.setFromAxisAngle(UP, -(cw2.a + cw2.ha)); tmpM.compose(tmpV.set(cw2.x + fx * 12, 18, cw2.y + fy * 12), tmpQ, tmpS.set(1, 1, 1)); trk.cowHead.setMatrixAt(i, tmpM);
    });
    trk.cowHead.instanceMatrix.needsUpdate = true;
  }
  // ---- sugar shack steam plume
  if (trk && G.parts && trk.shacks.length) for (const s of trk.shacks) {
    s.t -= dt; if (s.t > 0 || Math.abs(s.x - camera.position.x) > 900 || Math.abs(s.y - camera.position.z) > 900 || G.parts.length > 480) continue;
    s.t = 0.35; G.parts.push({ x: s.x + (Math.random() - 0.5) * 6, y: s.y + (Math.random() - 0.5) * 6, vx: 6 + Math.random() * 6, vy: -4 + Math.random() * 8, z: 50, vz: 16, life: 0, max: 2.6, size: 6, col: 'rgba(245,245,240,.55)', type: 'steam', rot: 0, vr: 0 });
  }
  SH.shadows.count = si; SH.shadows.instanceMatrix.needsUpdate = true;
  SH.pools.count = pi; SH.pools.instanceMatrix.needsUpdate = true; SH.pools.instanceColor.needsUpdate = true;
  SH.cones.count = ci; SH.cones.instanceMatrix.needsUpdate = true;
  SH.flares.count = fi; SH.flares.instanceMatrix.needsUpdate = true; SH.flares.instanceColor.needsUpdate = true;
  // ---- particles
  syncParticles(G);
  // ---- player headlight (night): the ground shader cone + one real spot light for trees and signs
  const F = R.player || R.order[0];
  if (trk && trk.ground) {
    const [x, y, h] = carPos(G, F);
    trk.ground.uniforms.hPos.value.set(x + Math.cos(h) * 10, y + Math.sin(h) * 10); trk.ground.uniforms.hDir.value.set(Math.cos(h), Math.sin(h));
    if (night) { SH.spot.intensity = 5; SH.spot.position.set(x + Math.cos(h) * 18, 12, y + Math.sin(h) * 18); SH.spot.target.position.set(x + Math.cos(h) * 200, 0, y + Math.sin(h) * 200); SH.spot.target.updateMatrixWorld(); }
    else SH.spot.intensity = 0;
  }
}
function pv2(o, v) { return v.setFromMatrixPosition(o.matrixWorld); }

const GLOW_RED = [1, 0.28, 0.12], GLOW_GOLD = [1, 0.72, 0.18], GLOW_PALE = [1, 0.95, 0.8];
const STREAK = { spark: 3.6, gold: 3.6, red: 3.6, orange: 3.2, splinter: 1.9, hay: 1.9, pine: 1.7, leaf: 1.6 };
const SOFT_A = { dust: 1.3, smoke: 1.15, steam: 1.15, snow: 1.25, sugar: 1.2, mud: 1.3, syrup: 1.3, water: 1.2 };
function syncParticles(G) {
  const g = SH.points.geometry, pos = g.attributes.position.array, col = g.attributes.pcol.array, sz = g.attributes.psize.array, pv = g.attributes.pvel.array;
  const road = SH.dustCol;
  const G2 = SH.glowPts.geometry, gp = G2.attributes.position.array, gc2 = G2.attributes.pcol.array, gs = G2.attributes.psize.array;
  let n = 0, gn = 0;
  for (const p of G.parts) {
    if (n >= SH.PMAX) break;
    const c = parseCol(p.col), a = 1 - p.life / p.max, ty = p.type;
    pos[n * 3] = p.x; pos[n * 3 + 1] = (p.z || 0) + 1.5; pos[n * 3 + 2] = p.y;
    if (ty === 'dust' && road) { col[n * 4] = lerp(c[0], road[0], 0.55); col[n * 4 + 1] = lerp(c[1], road[1], 0.55); col[n * 4 + 2] = lerp(c[2], road[2], 0.55); } // dust in the road's own colour
    else { col[n * 4] = c[0]; col[n * 4 + 1] = c[1]; col[n * 4 + 2] = c[2]; }
    col[n * 4 + 3] = Math.min(1, c[3] * (ty === 'smoke' || ty === 'steam' ? a * 0.8 : Math.min(1, a * 1.6)) * (SOFT_A[ty] || 1));
    const spk = ty === 'gold' || ty === 'red' || ty === 'sugar' || ty === 'spark', st = STREAK[ty] || 0;
    sz[n] = p.size * (p.sv || 1) * (ty === 'smoke' || ty === 'steam' ? 2.0 : ty === 'gold' || ty === 'red' ? 1.15 : spk ? 0.8 : ty === 'orange' ? 0.9 : 1.2) * (st ? 1.25 : 1);
    pv[n * 4] = p.vx || 0; pv[n * 4 + 1] = p.vz || 0; pv[n * 4 + 2] = p.vy || 0; pv[n * 4 + 3] = st;
    if (spk && gn < SH.GMAX) { // glow halo
      gp[gn * 3] = pos[n * 3]; gp[gn * 3 + 1] = pos[n * 3 + 1]; gp[gn * 3 + 2] = pos[n * 3 + 2];
      const gc = ty === 'red' ? GLOW_RED : ty === 'gold' ? GLOW_GOLD : GLOW_PALE;
      gc2[gn * 4] = gc[0]; gc2[gn * 4 + 1] = gc[1]; gc2[gn * 4 + 2] = gc[2]; gc2[gn * 4 + 3] = (ty === 'sugar' || ty === 'spark' ? 0.35 : 0.6) * Math.min(1, a * 1.6);
      gs[gn] = p.size * (ty === 'red' ? 4.2 : ty === 'gold' ? 3.6 : 2.4); gn++;
    }
    n++;
  }
  g.setDrawRange(0, n);
  G2.setDrawRange(0, gn); G2.attributes.position.needsUpdate = true; G2.attributes.pcol.needsUpdate = true; G2.attributes.psize.needsUpdate = true;
  g.attributes.position.needsUpdate = true; g.attributes.pcol.needsUpdate = true; g.attributes.psize.needsUpdate = true; g.attributes.pvel.needsUpdate = true;
  SH.pmat.uniforms.uScale.value = (ch * pr) / (2 * Math.tan(camera.fov * D2R / 2)); SH.pmat.uniforms.uAsp.value = cw / ch;
}

const skidEnds = new Map(), skidKey = (x, y) => Math.round(x * 8) + ',' + Math.round(y * 8);
// skid ribbon: called from game.js for each tyre-track segment
V3.skid = function (x0, y0, x1, y1, w, col) {
  const c = parseCol(col), i = SH.skidI; SH.skidI = (SH.skidI + 1) % SH.SKN;
  const dx = x1 - x0, dy = y1 - y0, l = Math.hypot(dx, dy) || 1, nx = -dy / l * w / 2, ny = dx / l * w / 2;
  const P = SH.skids.geometry.attributes.position.array, C = SH.skids.geometry.attributes.color.array, o = i * 18, q = i * 24;
  // one continuous ribbon: a segment that starts where an earlier one ended reuses that end edge (mitred to the average
  // direction), so a spin draws a smooth curl instead of a chain of rectangles
  let ax = x0 + nx, ay = y0 + ny, bx = x0 - nx, by = y0 - ny;
  const prev = skidEnds.get(skidKey(x0, y0));
  if (prev) {
    const mx = (prev[4] + nx) / 2, my = (prev[5] + ny) / 2, ml = Math.hypot(mx, my) || 1, sc = Math.min(2, (w / 2) / ml) ;
    ax = x0 + mx * sc; ay = y0 + my * sc; bx = x0 - mx * sc; by = y0 - my * sc;
    const j = prev[6]; // pull the earlier segment's end edge onto the shared mitre
    if (j != null) { const oo = j * 18; P[oo + 3] = ax; P[oo + 5] = ay; P[oo + 6] = bx; P[oo + 8] = by; P[oo + 12] = bx; P[oo + 14] = by; }
    skidEnds.delete(skidKey(x0, y0));
  }
  if (skidEnds.size > 96) skidEnds.clear();
  skidEnds.set(skidKey(x1, y1), [0, 0, 0, 0, nx, ny, i]);
  const v = [ax, 0.12, ay, x1 + nx, 0.12, y1 + ny, x1 - nx, 0.12, y1 - ny, ax, 0.12, ay, x1 - nx, 0.12, y1 - ny, bx, 0.12, by];
  for (let j = 0; j < 18; j++) P[o + j] = v[j];
  const a = Math.min(0.35, c[3] * 1.35), B = SH.skids.geometry.attributes.birth;
  for (let j = 0; j < 6; j++) { C[q + j * 4] = c[0]; C[q + j * 4 + 1] = c[1]; C[q + j * 4 + 2] = c[2]; C[q + j * 4 + 3] = a; B.array[i * 6 + j] = SH.skidNow.value; }
  SH.skids.geometry.attributes.position.needsUpdate = true; SH.skids.geometry.attributes.color.needsUpdate = true; B.needsUpdate = true;
};
V3.tow = function (i, fromX, fromY) { const m = SH.cars[i]; if (m) m.userData.tow = { x: fromX, y: fromY, t: 0 }; };
V3.donut = function () {}; // the donut ring was dropped (review 2); flames show a donut boost
V3.boost = function () { CAM.boostT = 1.5; }; // pull back + fov punch: held for 0.3 s, eased back over 0.6 s
V3.shake = function (u) { CAM.shake = Math.max(CAM.shake, Math.min(1.5, u)); };
V3.camMode = function (m) { V3.forceMode = m === 'auto' ? null : m; if (m === 'chase') CAM.init = false; return V3.forceMode; };
V3.resetCam = function () { CAM.init = false; CAM.mode = 'chase'; CAM.tun = 0; CAM.side = 0; CAM.fovK = 0; CAM.boostT = 0; CAM.shotT = 0; CAM.fast = 0; };

// ------------------------------------------------------------ podium (3 hay-bale steps, top three rigs, confetti in the HUD)
function syncPodium(G) {
  const pd = G.podium, f = trk && trk.finish; if (!f) return;
  for (const m of SH.cars) m.visible = false;
  SH.ghost.visible = false; SH.tractor.visible = false;
  const fx = Math.cos(f.a), fy = Math.sin(f.a), px = f.x + fx * 260, py = f.y + fy * 260;
  SH.podium.visible = true; SH.podium.position.set(px, 0, py); SH.podium.rotation.y = -f.a; SH.podium.updateMatrixWorld(true);
  let wi = 0;
  [0, 1, 2].forEach((rank) => {
    const s = pd.st[rank]; if (!s) return;
    const step = SH.podium.children[rank], m = SH.cars[rank];
    const rise = ease(pd.t * 1.5 - rank * 0.15);
    m.visible = rise > 0.05; m.geometry = rigGeoFor(s.rig, 0); m.userData.key = null; m.material = SH.carMat;
    step.scale.y = Math.max(0.01, rise);
    tmpV.set(0, step.userData.h * rise, step.position.z).applyMatrix4(SH.podium.matrixWorld);
    m.position.copy(tmpV); m.rotation.set(0, -f.a + Math.PI + 0.5 + Math.sin(pd.t * 0.8 + rank) * 0.25, 0, 'YXZ'); m.scale.set(1, 1, 1);
    m.updateMatrixWorld(true);
    for (let k = 0; k < 4; k++) { const pv = m.userData.piv[k]; pv.rotation.set(0, 0, 0); pv.updateMatrixWorld(true); SH.wheels.setMatrixAt(wi++, pv.matrixWorld); }
  });
  SH.wheels.count = wi; SH.wheels.instanceMatrix.needsUpdate = true;
  SH.lamps.count = 0; SH.crates.count = SH.crateGlow.count = 0; SH.shadows.count = 0; SH.pools.count = 0; SH.cones.count = 0; SH.flares.count = 0; SH.points.geometry.setDrawRange(0, 0); SH.glowPts.geometry.setDrawRange(0, 0);
  SH.puddles.count = SH.jugs.count = SH.bales.count = SH.pines.count = SH.snows.count = SH.flames.count = 0;
}

// ------------------------------------------------------------ the frame
let perfAcc = 0, perfN = 0;
V3.render = function (G, dt) {
  if (!V3.ok || V3.lost) return;
  // the podium is always a daytime stage: after a night cup it is built with the autumn look on the same road
  const podium0 = G.screen === 'podium' && G.podium;
  let wantT = G.T;
  if (G.T && podium0 && G.T.season === 'night') { if (!G.T._dayT) { G.T._dayT = Object.create(G.T); G.T._dayT.season = 'autumn'; } wantT = G.T._dayT; }
  if (wantT && wantT !== curT) setTrack(wantT);
  if (!trk || !G.race) return;
  renderer.info.reset();
  const t0 = performance.now();
  const podium = G.screen === 'podium' && G.podium;
  SH.podium.visible = !!podium;
  // the podium is always well lit, even after a night race
  SH.hemi.intensity = podium ? Math.max(trk.L.hemi, 1.7) : trk.L.hemi; SH.sun.intensity = podium ? Math.max(trk.L.sunI, 1.6) : trk.L.sunI;
  updateCamera(G, dt);
  if (podium) syncPodium(G); else sync(G, dt);
  // sky + backdrop + snow follow the camera
  SH.sky.position.copy(camera.position); SH.backdrop.position.set(camera.position.x, 300 - 26, camera.position.z); SH.stars.position.copy(camera.position);
  if (SH.moon.visible) { const mx = camera.position.x - 2200, mz = camera.position.z + 300; SH.moon.position.set(mx, 520, mz); SH.moon.lookAt(camera.position); SH.moonHalo.position.copy(SH.moon.position); SH.moonHalo.quaternion.copy(SH.moon.quaternion); }
  if (SH.snow.visible) { const p = SH.snow.geometry.attributes.position.array; SH.snowP.forEach((f, i) => { f[1] -= dt * 30 * f[3]; f[0] += dt * 8; if (f[1] < 0) f[1] += 120; if (f[0] > 200) f[0] -= 400; p[i * 3] = camera.position.x + f[0]; p[i * 3 + 1] = f[1]; p[i * 3 + 2] = camera.position.z + f[2]; }); SH.snow.geometry.attributes.position.needsUpdate = true; }
  SH.sun.position.copy(camera.position).addScaledVector(trk.sunDir, 500); SH.sun.target.position.copy(camera.position); SH.sun.target.updateMatrixWorld();
  // small rig snapshots (results card, garage) go into a corner of this canvas first; the main render then covers it
  if (G.rigShots && G.rigShots.length) { while (G.rigShots.length) rigShot(G.rigShots.shift()); }
  if (G.rigShot) rigShot(G.rigShot);
  SH.camU.value.copy(camera.position);
  { const Pl = G.race && G.race.player; // cutaway only in the chase view, aimed at your rig's roof
    if (Pl && !G.demo && !podium && CAM.mode === 'chase') { const [x, y] = carPos(G, Pl); SH.tgtU.value.set(x, 12, y); } else SH.tgtU.value.y = -1e5; }
  renderer.render(scene, camera);
  const ms = performance.now() - t0;
  perfAcc += ms; perfN++;
  V3.info = { calls: renderer.info.render.calls, tris: renderer.info.render.triangles, ms: +ms.toFixed(2) };
  if (G.cam) { G.cam.x = camera.position.x; G.cam.y = camera.position.z; G.cam.a = CAM.yaw; } // game.js uses it for sound distance, pan and particle culling
};

// ------------------------------------------------------------ rig snapshots (results card, garage)
let rigScene = null, rigCam = null, rigMesh = null, rigWheels = null;
function rigShot(o) { // o = { canvas, rig, paint, angle }
  if (!rigScene) {
    rigScene = new THREE.Scene();
    rigScene.add(new THREE.HemisphereLight(0xfff4e0, 0x5a4a3a, 2.2)); const d = new THREE.DirectionalLight(0xffffff, 2.2); d.position.set(30, 60, 40); rigScene.add(d);
    rigMesh = new THREE.Mesh(new THREE.BufferGeometry(), SH.carMat); rigMesh.rotation.order = 'YXZ'; rigScene.add(rigMesh);
    rigWheels = new THREE.InstancedMesh(SH.wheelGeo, lambert(), 4); rigScene.add(rigWheels);
    M.WHEELS.forEach(([x, z], k) => { tmpM.makeTranslation(x, M.WHEEL_R, z); rigWheels.setMatrixAt(k, tmpM); });
    rigCam = new THREE.PerspectiveCamera(26, 2.4, 1, 1000);
  }
  const cv = o.canvas, w = cv.width, h = cv.height;
  rigMesh.geometry = rigGeoFor(o.rig, o.paint || 0);
  const fill0 = SH.fillU.value; SH.fillU.value = 0; // the garage / results card is always lit like day
  const g = new THREE.Group(); void g;
  rigScene.rotation.y = o.angle || 0;
  rigCam.aspect = w / h; rigCam.fov = o.fov || 24; rigCam.updateProjectionMatrix();
  rigCam.position.set(o.dist || 92, o.camH || 38, 0); rigCam.lookAt(0, 6, 0);
  const gw = renderer.domElement.width, gh = renderer.domElement.height;
  if (w > gw || h > gh) return;
  renderer.setViewport(0, 0, w / pr, h / pr); renderer.setScissor(0, 0, w / pr, h / pr); renderer.setScissorTest(true);
  renderer.setClearColor(o.bg != null ? o.bg : 0x000000, o.bg != null ? 1 : 0); renderer.clear();
  renderer.render(rigScene, rigCam);
  const g2 = cv.getContext('2d'); g2.clearRect(0, 0, w, h); g2.drawImage(renderer.domElement, 0, gh - h, w, h, 0, 0, w, h);
  renderer.setScissorTest(false); renderer.setViewport(0, 0, cw, ch); SH.fillU.value = fill0;
  renderer.setClearColor(trk ? trk.L.skyHor : 0x2b1d12, 1);
}
V3.rigShot = function (o) { if (!V3.ok) return false; rigShot(o); return true; };

// ------------------------------------------------------------ sizing, projection, info
V3.resize = function (w, h, maxPR) {
  cw = w; ch = h;
  const touch = window.matchMedia && window.matchMedia('(pointer: coarse)').matches;
  pr = Math.min(window.devicePixelRatio || 1, touch ? 1.5 : 2, maxPR || 9);
  if (!renderer) return;
  renderer.setPixelRatio(pr); renderer.setSize(w, h, false);
  canvas.style.width = w + 'px'; canvas.style.height = h + 'px';
  setFov(CAM.fovK || 0);
};
V3.project = function (x, y, h) {
  tmpV.set(x, h || 0, y).project(camera);
  const vis = tmpV.z < 1 && tmpV.z > -1 && Math.abs(tmpV.x) <= 1 && Math.abs(tmpV.y) <= 1;
  return { sx: (tmpV.x + 1) / 2 * cw, sy: (1 - tmpV.y) / 2 * ch, visible: vis, z: tmpV.z };
};
V3.view = function (G) {
  const R = G && G.race, P = R && (R.player || R.order[0]);
  // horizon: where a far point straight ahead lands
  const fx = Math.cos(CAM.yaw), fy = Math.sin(CAM.yaw);
  tmpV.set(camera.position.x + fx * 100000, 0, camera.position.z + fy * 100000).project(camera);
  const horizonY = (1 - tmpV.y) / 2;
  let car = null;
  if (P) {
    const [x, y, h] = carPos(G, P), rx = -Math.sin(h) * 10, ry = Math.cos(h) * 10;
    const c = V3.project(x, y, 7), a = V3.project(x + rx, y + ry, 7), b = V3.project(x - rx, y - ry, 7);
    // on-screen heading of the rig as drawn (sim heading + the drift's visual yaw): 0 = straight up the screen
    const m = SH.cars[P.i], hv = m ? -m.rotation.y : h, nose = V3.project(x + Math.cos(hv) * 18, y + Math.sin(hv) * 18, 7), tail = V3.project(x - Math.cos(hv) * 18, y - Math.sin(hv) * 18, 7);
    const hd = Math.atan2(nose.sx - tail.sx, -(nose.sy - tail.sy)) / D2R;
    car = { sx: +(c.sx / cw).toFixed(3), sy: +(c.sy / ch).toFixed(3), sw: +(Math.abs(a.sx - b.sx) / cw).toFixed(3), hd: +hd.toFixed(1) };
  }
  const vfov = camera.fov, hfov = 2 * Math.atan(Math.tan(vfov * D2R / 2) * camera.aspect) / D2R;
  return { mode: 'chase', camMode: CAM.mode, calls: V3.info.calls, tris: V3.info.tris, pixelRatio: pr, renderMs: V3.info.ms,
    cam: { x: +CAM.x.toFixed(1), y: +CAM.y.toFixed(1), h: +camera.position.y.toFixed(1), yaw: +CAM.yaw.toFixed(3), pitch: +(CAM.pitch / D2R).toFixed(2), roll: +camera.rotation.z.toFixed(4), hfov: +hfov.toFixed(1), vfov: +vfov.toFixed(1), tun: +CAM.tun.toFixed(2) },
    horizonY: +horizonY.toFixed(3), car, buildMs: V3.buildMs, fade: R ? R.cars.map((c) => { const m = SH.cars[c.i]; return m && m.visible ? +(m.userData.fade == null ? 1 : m.userData.fade).toFixed(2) : 0; }) : null, mem: { geometries: renderer.info.memory.geometries, textures: renderer.info.memory.textures } };
};
V3.renderer = () => renderer;

// ------------------------------------------------------------ boot
try {
  init();
  V3.ok = true;
  if (DRD.onView3D) DRD.onView3D(V3);
} catch (e) {
  V3.ok = false; V3.error = String(e);
  if (DRD.onView3DFail) DRD.onView3DFail(e);
}
