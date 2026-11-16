/* Dirt Road Derby — code-built low-poly models for the chase view (rigs, trees, buildings, items, signs).
   Everything is vertex-coloured, flat-shaded geometry built from three.js primitives: no model or image files.
   World convention: three (x, y, z) = sim (x, height, y). Models face +x (the sim heading 0), origin at ground centre. */
import * as THREE from './vendor/three.module.min.js';

const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _e = new THREE.Euler(), _p = new THREE.Vector3(), _s = new THREE.Vector3(), _c = new THREE.Color();
const TAU = Math.PI * 2;
export function rng(seed) { let a = seed >>> 0; return () => { a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

// ------------------------------------------------------------ geometry kit
// part(): a primitive, transformed and painted one colour (optionally a per-face shade jitter); merge() joins parts into one draw.
export function part(geo, color, o) {
  o = o || {};
  const g = geo.index ? geo.toNonIndexed() : geo.clone();
  geo.dispose();
  for (const k of Object.keys(g.attributes)) if (k !== 'position') g.deleteAttribute(k);
  _e.set(o.rx || 0, o.ry || 0, o.rz || 0, o.order || 'XYZ'); _q.setFromEuler(_e);
  _m.compose(_p.set(o.x || 0, o.y || 0, o.z || 0), _q, _s.set(o.sx || 1, o.sy || 1, o.sz || 1));
  g.applyMatrix4(_m);
  const n = g.attributes.position.count, col = new Float32Array(n * 3);
  const fn = typeof color === 'function' ? color : null;
  if (!fn) _c.set(color);
  const R = o.jit ? rng(o.seed || 7) : null, P = g.attributes.position.array;
  for (let f = 0; f < n; f += 3) {
    if (fn) { const cx = (P[f * 3] + P[f * 3 + 3] + P[f * 3 + 6]) / 3, cy = (P[f * 3 + 1] + P[f * 3 + 4] + P[f * 3 + 7]) / 3, cz = (P[f * 3 + 2] + P[f * 3 + 5] + P[f * 3 + 8]) / 3; _c.set(fn(cx, cy, cz)); }
    const j = R ? 1 + (R() - 0.5) * o.jit : 1;
    for (let v = 0; v < 3; v++) { const i = (f + v) * 3; col[i] = _c.r * j; col[i + 1] = _c.g * j; col[i + 2] = _c.b * j; }
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return g;
}
export function merge(parts) {
  let n = 0; for (const g of parts) n += g.attributes.position.count;
  const pos = new Float32Array(n * 3), col = new Float32Array(n * 3);
  let o = 0;
  for (const g of parts) { pos.set(g.attributes.position.array, o * 3); col.set(g.attributes.color.array, o * 3); o += g.attributes.position.count; g.dispose(); }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  out.setAttribute('color', new THREE.BufferAttribute(col, 3));
  out.computeVertexNormals(); // non-indexed = flat normals
  out.computeBoundingSphere();
  return out;
}
const box = (w, h, d) => new THREE.BoxGeometry(w, h, d);
const cyl = (rt, rb, h, seg) => new THREE.CylinderGeometry(rt, rb, h, seg || 8);
const cone = (r, h, seg) => new THREE.ConeGeometry(r, h, seg || 7);
function prism(points, depth) { // extrude a 2D (z, y) outline along x, centred
  const sh = new THREE.Shape(); points.forEach((p, i) => i ? sh.lineTo(p[0], p[1]) : sh.moveTo(p[0], p[1]));
  const g = new THREE.ExtrudeGeometry(sh, { depth, bevelEnabled: false });
  g.translate(0, 0, -depth / 2); g.rotateY(Math.PI / 2); // extrusion axis -> x
  return g;
}
function shadeHex(hex, f) { _c.set(hex); if (f < 0) _c.multiplyScalar(1 + f); else _c.lerp(new THREE.Color(1, 1, 1), f); return '#' + _c.getHexString(); }
export { shadeHex };

// ------------------------------------------------------------ rigs (36 long, 20 wide, 15 tall; wheels are drawn separately)
export const WHEELS = [[11.5, 9.6], [11.5, -9.6], [-11.5, 9.6], [-11.5, -9.6]]; // x, z of each wheel centre
export const WHEEL_R = 3.9;
export function wheelGeo() {
  const tire = part(cyl(WHEEL_R, WHEEL_R, 3.2, 8), '#1d1a18', { rx: Math.PI / 2 });
  const hub = part(cyl(1.6, 1.6, 3.4, 6), '#b9b2a6', { rx: Math.PI / 2 });
  const tread = part(box(1.4, 0.7, 3.3), '#3a3532', { y: WHEEL_R - 0.2 }); // one lug so the spin reads
  return merge([tire, hub, tread]);
}
export function rigGeo(rig, paint) {
  const P = paint && paint.body ? paint : null;
  const body = P ? P.body : rig.body, dark = P ? P.dark : rig.dark, roof = P ? P.roof : rig.roof;
  const glass = '#25303a', grey = '#3b3632', chrome = '#d9d2c4';
  const plaid = P && P.plaid ? (x, y, z) => { const a = ((Math.floor((x + 40) / 2.6) % 4) === 0), b = ((Math.floor((z + 40) / 2.6) % 4) === 0) || ((Math.floor((y + 40) / 2.6) % 4) === 0); return a && b ? P.plaid : a || b ? shadeHex(P.body, -0.35) : P.body; } : null;
  const bc = plaid || body;
  const parts = [];
  const pick = rig.type === 'pickup';
  const seg = plaid ? 12 : 1;
  // lower body + skirt
  parts.push(part(new THREE.BoxGeometry(35, 6.2, 19, seg, 2, seg), bc, { y: 5.4 }));
  parts.push(part(box(36, 1.6, 19.6), dark, { y: 2.6 }));
  // nose wedge (chamfered hood)
  parts.push(part(new THREE.BoxGeometry(9, 2.2, 18.4, plaid ? 4 : 1, 1, seg), bc, { x: 12.2, y: 9.0, rz: -0.16 }));
  // bumpers + grille
  parts.push(part(box(1.4, 2.4, 19.2), grey, { x: 17.9, y: 3.6 }), part(box(1.4, 2.4, 19.2), grey, { x: -17.9, y: 3.6 }));
  parts.push(part(box(0.6, 2.6, 9), '#2a2622', { x: 17.6, y: 6.6 }));
  if (!pick) {
    // wagon cabin: glass band + roof, long
    parts.push(part(box(21, 3.4, 17.2), glass, { x: -4.5, y: 10.4 }));
    parts.push(part(box(21.6, 0.9, 17.4), bc === body ? body : bc, { x: -4.5, y: 12.4 }));
    parts.push(part(box(22.4, 1.3, 18.2), roof, { x: -4.6, y: 13.4 }));
    parts.push(part(box(2.2, 4.4, 17.4), bc === body ? body : bc, { x: 5.4, y: 10.8, rz: -0.35 })); // A pillar
    if (rig.trim && !(P && P.stripe)) parts.push(part(box(30, 1.7, 19.5), rig.trim, { x: -1.5, y: 6.4 })); // wood-trim side strip
    if (rig.extra === 'canoe') {
      parts.push(part(cyl(2.2, 1.4, 25, 8), '#c8482c', { x: -4.5, y: 15.6, rz: Math.PI / 2, sy: 0.55, sz: 0.62 }));
      parts.push(part(box(1, 1.4, 17), '#2b2622', { x: -10, y: 14.6 }), part(box(1, 1.4, 17), '#2b2622', { x: 1, y: 14.6 }));
    } else if (rig.extra === 'roofbox') {
      parts.push(part(box(15, 3.6, 11), '#2b2a2a', { x: -5, y: 15.8 }));
    } else if (rig.extra === 'bikes') {
      for (const z of [-4, 4]) { parts.push(part(box(15, 0.8, 0.8), '#e8452a', { x: -5, y: 17, z })); parts.push(part(cyl(3, 3, 0.6, 8), '#1b1b1b', { x: -11, y: 17, z, rx: Math.PI / 2 })); parts.push(part(cyl(3, 3, 0.6, 8), '#1b1b1b', { x: 1, y: 17, z, rx: Math.PI / 2 })); }
      parts.push(part(box(1, 1.2, 17), '#2b2622', { x: -5, y: 14.6 }));
    }
  } else {
    // pickup cab + open bed
    parts.push(part(box(12.5, 3.6, 17.2), glass, { x: 2.5, y: 10.5 }));
    parts.push(part(box(13, 1.4, 17.8), roof, { x: 2.3, y: 13 }));
    parts.push(part(box(2.2, 4.6, 17.4), bc === body ? body : bc, { x: 8.2, y: 10.8, rz: -0.35 }));
    parts.push(part(box(16, 3.8, 1.3), bc === body ? body : bc, { x: -9.7, y: 10.2, z: 9.0 }), part(box(16, 3.8, 1.3), bc === body ? body : bc, { x: -9.7, y: 10.2, z: -9.0 }));
    parts.push(part(box(1.3, 3.8, 19), dark, { x: -17.3, y: 10.2 }));
    parts.push(part(box(15, 0.6, 17), '#4a3a2c', { x: -9.7, y: 8.7 }));
    if (rig.bed === 'hay') parts.push(part(box(11, 5.5, 13.5), '#e3bf5a', { x: -9.6, y: 11.6, jit: 0.1 }));
    else if (rig.bed === 'buckets') for (const [x, z] of [[-6, -4], [-6, 4], [-12.5, -4], [-12.5, 4]]) parts.push(part(cyl(2.4, 2, 4.5, 7), '#c4ccd2', { x, y: 11.2, z }));
    else for (const z of [-5, 0, 5]) parts.push(part(cyl(2.2, 2.2, 13.5, 7), '#8a5a32', { x: -9.6, y: 11.2 + (z ? 0 : 3.4), z, rz: Math.PI / 2 }));
  }
  if (P && P.stripe) { parts.push(part(box(9.3, 0.5, 3.2), P.stripe, { x: 12.2, y: 10.25, rz: -0.16 })); parts.push(part(box(pick ? 13.2 : 22.6, 0.4, 3.2), P.stripe, { x: pick ? 2.3 : -4.6, y: pick ? 13.9 : 14.2 })); parts.push(part(box(35.4, 1.2, 19.6), P.stripe, { y: 6.6 })); }
  // mirrors
  parts.push(part(box(1.2, 1.4, 2), dark, { x: pick ? 8 : 5, y: 10.4, z: 10.2 }), part(box(1.2, 1.4, 2), dark, { x: pick ? 8 : 5, y: 10.4, z: -10.2 }));
  void chrome;
  return merge(parts);
}

// ------------------------------------------------------------ trees (unit size; instances scale them)
// blob crown: two jittered squashed icosahedra; vertex colour white so the instance colour paints it
export function blobGeo(seed) {
  const R = rng(seed || 3);
  // the same corner gets the same push in every face that shares it, so the blob stays closed
  const jitter = (g) => { const p = g.attributes.position, seen = new Map(); for (let i = 0; i < p.count; i++) { const key = Math.round(p.getX(i) * 100) + ',' + Math.round(p.getY(i) * 100) + ',' + Math.round(p.getZ(i) * 100); let k = seen.get(key); if (k == null) { k = 0.86 + R() * 0.28; seen.set(key, k); } p.setXYZ(i, p.getX(i) * k, p.getY(i) * k, p.getZ(i) * k); } return g; };
  const a = new THREE.IcosahedronGeometry(1, 0), b = new THREE.IcosahedronGeometry(0.72, 0);
  // jitter shared verts consistently: work on indexed-free copies, so faces stay closed by jittering before un-indexing
  const A1 = part(jitter(a), '#ffffff', { sy: 0.78 }), B1 = part(jitter(b), '#e6e6e6', { x: 0.35, y: 0.55, z: -0.2, sy: 0.8 });
  return merge([A1, B1]);
}
export function trunkGeo() { return merge([part(new THREE.CylinderGeometry(0.7, 1, 1, 5, 1, true), '#5b4330', { y: 0.5 })]); }
export function birchTrunkGeo() { return merge([part(new THREE.CylinderGeometry(0.75, 1, 1, 5, 6, true), (x, y) => (Math.floor((y + 0.5) * 6.5) % 3 === 1 ? '#2a2622' : '#ece8de'), { y: 0.5 })]); }
export function bareGeo() { // winter hardwood, unit height: trunk + a spreading fan of branches and twigs (scale uniformly)
  const br = '#5e4a3c', tw = '#7a6656', parts = [part(new THREE.CylinderGeometry(0.022, 0.045, 0.62, 5, 1, true), br, { y: 0.31 })];
  for (let i = 0; i < 7; i++) {
    const a = i * 0.9 + 0.3, lean = 0.45 + (i % 3) * 0.17, y0 = 0.38 + (i % 3) * 0.09, L = 0.34 - (i % 3) * 0.04;
    const dx = Math.cos(a) * Math.sin(lean), dz = Math.sin(a) * Math.sin(lean), dy = Math.cos(lean);
    const g = new THREE.CylinderGeometry(0.006, 0.016, L, 4, 1, true); g.translate(0, L / 2, 0);
    // tilt the branch from vertical toward (dx, dz) by `lean`
    const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), new THREE.Vector3(dx, dy, dz).normalize()); g.applyQuaternion(q);
    parts.push(part(g, i % 2 ? br : tw, { y: y0 }));
  }
  return merge(parts);
}
// evergreen: three stacked cones, colours baked (instances only jitter brightness); winter adds white caps
export function evergreenGeo(green, snow) {
  const parts = [part(cyl(0.12, 0.16, 0.3, 5), '#4a3626', { y: 0.15 })];
  [[0.62, 0.5, 0.38], [0.48, 0.42, 0.6], [0.32, 0.36, 0.8]].forEach(([r, h, y], i) => {
    parts.push(part(cone(r, h, 7), shadeHex(green, i * 0.06), { y, ry: i * 0.5 }));
    if (snow) parts.push(part(cone(r * 0.48, h * 0.36, 7), '#f4f8fb', { y: y + h * 0.33, ry: i * 0.5 }));
  });
  return merge(parts);
}

// ------------------------------------------------------------ buildings and props (facing +x along the road)
export function propGeo(k, season, v) {
  const win = season === 'winter', parts = [], wins = [];
  const roofC = win ? '#eef3f7' : '#4b3d38';
  const W = (x, y, z, w, h, ry) => wins.push({ x, y, z, w, h, ry: ry || 0 }); // window quads, lit at night
  if (k === 'barn') {
    const red = '#a8322a', L = 110, hw = 40;
    parts.push(part(prism([[-hw, 0], [hw, 0], [hw, 50], [30, 72], [0, 84], [-30, 72], [-hw, 50]], L), red, { jit: 0.06 }));
    const pan = (z0, y0, z1, y1) => { const len = Math.hypot(z1 - z0, y1 - y0), a = Math.atan2(y1 - y0, z1 - z0); parts.push(part(box(L + 6, 2.2, len + 2), roofC, { y: (y0 + y1) / 2 + 1, z: (z0 + z1) / 2, rx: -a })); };
    pan(hw + 2, 49, 30, 72); pan(30, 72, 0, 85); pan(-hw - 2, 49, -30, 72); pan(-30, 72, 0, 85);
    // white trim: big door with an X on the long side facing the road (-z), corner boards
    for (const s of [-1, 1]) {
      parts.push(part(box(34, 40, 1), '#8e2a22', { y: 20, z: s * (hw + 0.4) }));
      parts.push(part(box(36, 2.2, 1.6), '#f4efe4', { y: 41, z: s * (hw + 0.6) }), part(box(2.2, 41, 1.6), '#f4efe4', { x: 17, y: 20.5, z: s * (hw + 0.6) }), part(box(2.2, 41, 1.6), '#f4efe4', { x: -17, y: 20.5, z: s * (hw + 0.6) }));
      parts.push(part(box(50, 2, 1.4), '#f4efe4', { y: 20, z: s * (hw + 0.7), rx: 0, rz: 0.9 }), part(box(50, 2, 1.4), '#f4efe4', { y: 20, z: s * (hw + 0.7), rz: -0.9 }));
      W(-38, 56, s * (hw + 0.8), 10, 9, s > 0 ? 0 : Math.PI); W(38, 56, s * (hw + 0.8), 10, 9, s > 0 ? 0 : Math.PI);
    }
    for (const x of [-L / 2 - 0.4, L / 2 + 0.4]) W(x, 64, 0, 12, 10, x > 0 ? Math.PI / 2 : -Math.PI / 2);
  } else if (k === 'farmhouse') {
    const wall = v === 1 ? '#dfe3e6' : '#efe6d2';
    parts.push(part(box(78, 40, 50), wall, { y: 20 }));
    parts.push(part(prism([[-29, 0], [29, 0], [0, 24]], 84), roofC, { y: 40 }));
    parts.push(part(box(78, 2, 14), '#cbbfa8', { y: 1, z: -32 }), part(box(78, 2.4, 16), roofC, { y: 22, z: -32, rx: -0.15 }));
    for (const x of [-36, -12, 12, 36]) parts.push(part(box(2, 21, 2), '#f4efe4', { x, y: 11.5, z: -39 }));
    parts.push(part(box(8, 18, 8), '#8a3a2c', { x: 22, y: 56, z: 8 }));
    for (const x of [-26, -2, 22]) { W(x, 28, -25.6, 9, 11, Math.PI); W(x, 28, 25.6, 9, 11, 0); }
    W(-26, 12, -25.6, 9, 11, Math.PI); W(22, 12, -25.6, 9, 11, Math.PI);
  } else if (k === 'silo') {
    const c = season === 'night' ? '#8b97a0' : '#b9c2c8';
    parts.push(part(new THREE.CylinderGeometry(15, 15, 92, 12, 6), (x, y) => (Math.floor(y / 15.4) % 2 ? c : shadeHex(c, -0.08)), { y: 46 }));
    parts.push(part(new THREE.SphereGeometry(15.5, 12, 5, 0, TAU, 0, Math.PI / 2), win ? '#f4f8fb' : '#7b8790', { y: 92 }));
  } else if (k === 'shack') { // sugar shack: board-and-batten, roof vent cupola (the steam plume is a particle effect)
    parts.push(part(box(56, 26, 36), '#7a5236', { y: 13, jit: 0.08 }));
    parts.push(part(prism([[-21, 0], [21, 0], [0, 14]], 62), roofC, { y: 26 }));
    parts.push(part(box(16, 10, 10), '#6a4630', { y: 43 }), part(prism([[-8, 0], [8, 0], [0, 6]], 20), roofC, { y: 48 }));
    parts.push(part(box(14, 22, 12), '#8a6a4a', { x: -34, y: 11, jit: 0.2, seed: 3 }));
    W(10, 15, -18.4, 8, 7, Math.PI); W(-12, 15, -18.4, 8, 7, Math.PI);
  } else if (k === 'church') {
    parts.push(part(box(74, 36, 42), '#f6f3ec', { y: 18 }));
    parts.push(part(prism([[-24, 0], [24, 0], [0, 22]], 78), roofC, { y: 36 }));
    parts.push(part(box(18, 40, 18), '#f6f3ec', { x: 44, y: 20 }), part(box(15, 16, 15), '#f6f3ec', { x: 44, y: 48 }), part(cone(11, 36, 4), roofC, { x: 44, y: 74, ry: Math.PI / 4 }));
    for (const x of [-24, -6, 12]) { W(x, 20, -21.4, 6, 14, Math.PI); W(x, 20, 21.4, 6, 14, 0); }
  } else if (k === 'cabin') {
    parts.push(part(new THREE.BoxGeometry(50, 24, 34, 1, 6, 1), (x, y) => (Math.floor(y / 4) % 2 ? '#7a4e2e' : '#6a4226'), { y: 12 }));
    parts.push(part(prism([[-21, 0], [21, 0], [0, 15]], 58), roofC, { y: 24 }));
    parts.push(part(box(6, 14, 6), '#6c6a66', { x: -16, y: 36 }));
    W(10, 13, -17.4, 8, 7, Math.PI); W(-8, 13, -17.4, 8, 7, Math.PI);
  } else if (k === 'plowshed') {
    parts.push(part(box(66, 30, 44), '#8f969c', { y: 15 }));
    parts.push(part(box(72, 3, 50), roofC, { y: 31.5, rz: 0.06 }));
    parts.push(part(box(30, 10, 3), '#e8792a', { x: 0, y: 5, z: -26, ry: 0.3 }));
  } else if (k === 'woodpile') {
    for (let r = 0; r < 3; r++) for (let i = 0; i < 6 - r; i++) parts.push(part(cyl(3.2, 3.2, 26, 7), i % 2 ? '#9a6a3c' : '#7e5430', { x: (i - (5 - r) / 2) * 6.6, y: 3.2 + r * 5.6, rx: Math.PI / 2 }));
  } else if (k === 'lamp') {
    parts.push(part(cyl(0.9, 1.2, 40, 6), '#3a3634', { y: 20 }), part(box(14, 1.2, 1.2), '#3a3634', { x: -6, y: 39.5 }), part(box(4, 2.5, 4), '#3a3634', { x: -12, y: 38 }));
  } else return null;
  return { geo: merge(parts), wins };
}

// covered bridge / drive-through dairy barn: a real tunnel with open ends (clear height >= 32).
// Returns { body, roof }: the roof (ceiling, roof, gables, portal trim) is its own mesh so the view can cut away the part
// nearest the lens when the camera follows you through.
export function tunnelGeo(len, w, kind, season) {
  const win = season === 'winter', parts = [], roof = [];
  const H = kind === 'barn' ? 38 : 34, half = w / 2 + 2;
  // barn red with white trim, the way a Vermont covered bridge reads from a quarter mile off
  const wall = kind === 'barn' ? '#a8322a' : '#b8382c', inner = '#8a5a3e', trim = '#f4efe4';
  const roofC = win ? '#eef3f7' : '#4a4642';
  for (const s of [-1, 1]) {
    parts.push(part(new THREE.BoxGeometry(len, H, 2, Math.max(1, Math.round(len / 9)), 1, 1), (x) => (Math.floor((x + 400) / 4.5) % 2 ? wall : shadeHex(wall, -0.1)), { y: H / 2, z: s * (half + 1) }));
    parts.push(part(box(len - 2, H - 2, 0.6), inner, { y: H / 2, z: s * (half - 0.4) }));
    parts.push(part(box(len + 1, 2.2, 2.6), trim, { y: H - 1.1, z: s * (half + 1.2) })); // white eave board along each side
    parts.push(part(box(len + 1, 1.6, 2.6), trim, { y: 0.8, z: s * (half + 1.2) }));     // and a white sill
    if (kind !== 'barn') for (let x = -len / 2 + 20; x < len / 2 - 10; x += 40) parts.push(part(box(16, 6, 2.4), '#1e120c', { x, y: H * 0.62, z: s * (half + 1) })); // window slots
  }
  if (kind === 'barn') {
    const hw = half + 2, rc = win ? '#eef3f7' : '#4b3d38';
    const pan = (z0, y0, z1, y1) => { const l = Math.hypot(z1 - z0, y1 - y0), a = Math.atan2(y1 - y0, z1 - z0); roof.push(part(box(len + 6, 2.4, l + 2), rc, { y: (y0 + y1) / 2 + 1, z: (z0 + z1) / 2, rx: -a })); };
    pan(hw, H, hw * 0.72, H + 20); pan(hw * 0.72, H + 20, 0, H + 32); pan(-hw, H, -hw * 0.72, H + 20); pan(-hw * 0.72, H + 20, 0, H + 32);
    for (const x of [-len / 2, len / 2]) {
      roof.push(part(prism([[-hw, 0], [hw, 0], [hw * 0.72, 20], [0, 32], [-hw * 0.72, 20]], 2), wall, { x, y: H }));
      roof.push(part(box(2.5, 3, w + 8), trim, { x: x + Math.sign(x) * 1.2, y: H - 1 }));
      for (const s of [-1, 1]) parts.push(part(box(2.5, H, 3), trim, { x: x + Math.sign(x) * 1.2, y: H / 2, z: s * (half + 1) }));
    }
    roof.push(part(box(len - 4, 1, w + 2), '#7a5638', { y: H - 0.5 })); // ceiling
  } else {
    roof.push(part(prism([[-half - 6, 0], [half + 6, 0], [0, 22]], len + 10), roofC, { y: H }));
    roof.push(part(box(len + 2, 1, w + 4), '#7a5638', { y: H + 0.2 }));
    for (const x of [-len / 2, len / 2]) {
      // the red gable sits flush with the roof's overhang, so from the approach the portal reads barn red (winter too, under
      // its snow roof) instead of showing the roof's own end face
      roof.push(part(prism([[-half - 6, -1], [half + 6, -1], [0, 22]], 2), (px, py, pz) => (Math.floor((pz + 60) / 4.5) % 2 ? wall : shadeHex(wall, -0.1)), { x: x + Math.sign(x) * 5.5, y: H }));
      roof.push(part(box(1.2, 3, w + 6), trim, { x: x + Math.sign(x) * 7.1, y: H - 1.4 }));
      // white portal trim: the two gable rakes and the posts either side of the opening
      for (const s of [-1, 1]) {
        const l = Math.hypot(half + 6, 23), a = Math.atan2(23, half + 6);
        roof.push(part(box(1.2, 2.2, l), trim, { x: x + Math.sign(x) * 7.1, y: H + 10.5, z: s * (half + 6) / 2, rx: s * a }));
        parts.push(part(box(2.4, H, 2.6), trim, { x: x + Math.sign(x) * 1.3, y: H / 2, z: s * (half + 1.2) }));
      }
    }
  }
  // plank deck over the river / floor: weathered boards close to the road's own colour, nearly flush, so the near end of it
  // never reads as a dark slab across the bottom of the view
  parts.push(part(new THREE.BoxGeometry(len + 6, 0.6, w + 2, Math.round(len / 6), 1, 1), (x) => (Math.floor((x + 400) / 3) % 2 ? (win ? '#b6ab9a' : '#b48f62') : (win ? '#a89e8e' : '#a68258')), { y: 0.1 }));
  return { body: merge(parts), roof: merge(roof) };
}

// ------------------------------------------------------------ items / hazards
export function crateGeo() { return new THREE.BoxGeometry(16, 16, 16); } // textured (maple-leaf stamp)
export function baleGeo() { // round bale on its side, 30 wide x 20 tall: straw-gold, with the rolled spiral showing on both ends
  const straw = (x, y, z) => { const k = Math.abs(Math.sin(x * 1.7 + y * 0.9) * 43758.5) % 1; return k < 0.33 ? '#e8c45a' : k < 0.66 ? '#dcb44a' : '#f0d070'; };
  const parts = [part(new THREE.CylinderGeometry(10, 10, 25, 16, 3, true), straw, { rx: Math.PI / 2, y: 10 })];
  // twine: two thin pale bands round the roll
  for (const z of [-6, 6]) parts.push(part(new THREE.CylinderGeometry(10.15, 10.15, 0.8, 16, 1, true), '#f6e6b0', { rx: Math.PI / 2, y: 10, z }));
  // ends: a fine ring mesh coloured by an Archimedean spiral (r - 1.6 * turn), so the roll reads at a glance
  for (const s of [-1, 1]) {
    const ring = new THREE.RingGeometry(0.2, 10, 28, 7);
    parts.push(part(ring, (x, y) => { const r = Math.hypot(x, y - 10), a = Math.atan2(y - 10, x * s) / TAU; return ((r / 2.2 - a) % 1 + 1) % 1 < 0.5 ? '#d8b048' : '#a8822c'; }, { y: 10, z: s * 12.5, ry: s > 0 ? 0 : Math.PI }));
  }
  return merge(parts);
}
export function jugGeo() { // a tipped tin syrup jug, 14 tall standing
  return merge([part(cyl(5.5, 6, 11, 8), '#d6dade', { y: 5.5 }), part(cyl(2, 2.4, 3, 6), '#c6281c', { y: 12.5 }), part(box(6.2, 5, 12.2), '#c8781e', { y: 5 }), part(new THREE.TorusGeometry(3, 0.8, 4, 8, Math.PI), '#9aa2a8', { x: 0, y: 11, rx: 0 })]);
}
export function pineconeGeo() {
  const parts = [];
  for (let i = 0; i < 5; i++) parts.push(part(cyl(2.2 + Math.sin(i / 4 * Math.PI) * 4, 2.2 + Math.sin((i + 1) / 4 * Math.PI) * 4, 3, 7), i % 2 ? '#8a5228' : '#a8682f', { y: -6 + i * 3, ry: i * 0.45 }));
  parts.push(part(cone(2.4, 4, 6), '#6a3a18', { y: 9.5 }));
  return merge(parts);
}
export function donutGeo() { return merge([part(new THREE.TorusGeometry(6, 2.8, 6, 12), '#c88a48', { rx: Math.PI / 2 }), part(new THREE.TorusGeometry(6, 2.9, 3, 12, TAU), '#f6ead2', { rx: Math.PI / 2, y: 0.6, sy: 0.6 })]); }
export function tractorGeo() {
  const g = '#3d8a3a', parts = [];
  parts.push(part(box(30, 10, 14), g, { x: 6, y: 13 }), part(box(10, 6, 12), g, { x: 16, y: 20, rz: -0.12 }));
  parts.push(part(box(12, 14, 15), '#2b2a28', { x: -8, y: 25 }), part(box(14, 1.6, 17), g, { x: -8, y: 32.5 }));
  parts.push(part(cyl(1.3, 1.3, 10, 6), '#2b2a28', { x: 12, y: 24 }));
  for (const s of [-1, 1]) { parts.push(part(cyl(11, 11, 6, 10), '#1d1a18', { x: -10, y: 11, z: s * 11, rx: Math.PI / 2 })); parts.push(part(cyl(5, 5, 6.2, 8), '#e8c22a', { x: -10, y: 11, z: s * 11, rx: Math.PI / 2 })); parts.push(part(cyl(6.5, 6.5, 4, 8), '#1d1a18', { x: 18, y: 6.5, z: s * 9, rx: Math.PI / 2 })); parts.push(part(cyl(3, 3, 4.2, 6), '#e8c22a', { x: 18, y: 6.5, z: s * 9, rx: Math.PI / 2 })); }
  return merge(parts);
}
export function cowGeo() { // body + legs (the head is its own instanced mesh so it can turn)
  const spots = (x, y, z) => ((Math.sin(x * 0.55) + Math.sin(z * 0.9 + 1) + Math.sin(y * 0.7)) > 0.9 ? '#262422' : '#f4f1ea');
  const parts = [part(new THREE.BoxGeometry(24, 12, 12, 6, 3, 3), spots, { y: 15 })];
  for (const [x, z] of [[9, 4], [9, -4], [-9, 4], [-9, -4]]) parts.push(part(box(3, 10, 3), '#e8e4dc', { x, y: 5, z }));
  parts.push(part(box(2, 2, 1), '#262422', { x: -12.5, y: 16, z: 0 }));
  return merge(parts);
}
export function cowHeadGeo() { return merge([part(box(9, 8, 7), '#f4f1ea', { x: 4.5 }), part(box(3, 4, 6.4), '#e8a8a0', { x: 9.4, y: -1.6 }), part(box(2, 2, 11), '#e9e4d6', { x: 1, y: 4.6 })]); }
export function pumpkinGeo() { return merge([part(new THREE.SphereGeometry(1, 8, 5), '#e07a1e', { y: 0.75, sy: 0.75, jit: 0.15 }), part(cyl(0.12, 0.16, 0.4, 5), '#4e7a33', { y: 1.6 })]); }
export function signPostGeo(h) { return merge([part(box(1.6, h, 1.6), '#5a4634', { y: h / 2 })]); }

// ------------------------------------------------------------ canvas textures (each keyed in IMAGE-PROMPTS.md)
function cv(w, h) { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; }
export function crateTexture(drawLeaf) {
  const c = cv(128, 128), g = c.getContext('2d');
  const gr = g.createLinearGradient(0, 0, 128, 128); gr.addColorStop(0, '#e2b06c'); gr.addColorStop(1, '#b07638');
  g.fillStyle = gr; g.fillRect(0, 0, 128, 128);
  g.strokeStyle = 'rgba(80,45,15,.55)'; g.lineWidth = 3; for (const y of [32, 64, 96]) { g.beginPath(); g.moveTo(0, y); g.lineTo(128, y); g.stroke(); }
  g.strokeStyle = '#6b4220'; g.lineWidth = 12; g.strokeRect(6, 6, 116, 116);
  g.fillStyle = '#fff3d6'; g.beginPath(); g.arc(64, 64, 30, 0, TAU); g.fill();
  if (drawLeaf) drawLeaf(g, 64, 66, 22, '#c6281c');
  return c;
}
export function chevronTexture() {
  const c = cv(128, 72), g = c.getContext('2d');
  g.fillStyle = '#1c1a17'; g.fillRect(0, 0, 128, 72);
  g.fillStyle = '#ffd23a'; g.fillRect(4, 4, 120, 64);
  g.fillStyle = '#1c1a17';
  for (const x of [26, 64, 102]) { g.beginPath(); g.moveTo(x + 14, 12); g.lineTo(x - 6, 36); g.lineTo(x + 14, 60); g.lineTo(x + 2, 60); g.lineTo(x - 18, 36); g.lineTo(x + 2, 12); g.closePath(); g.fill(); }
  return c;
}
export function diamondTexture(kind) {
  const c = cv(96, 96), g = c.getContext('2d');
  g.translate(48, 48); g.rotate(Math.PI / 4);
  g.fillStyle = '#1c1a17'; g.fillRect(-33, -33, 66, 66); g.fillStyle = '#ffc928'; g.fillRect(-30, -30, 60, 60);
  g.rotate(-Math.PI / 4); g.fillStyle = '#1c1a17';
  if (kind === 'heave') { g.beginPath(); g.moveTo(-26, 10); g.quadraticCurveTo(-13, -14, 0, 10); g.quadraticCurveTo(13, -14, 26, 10); g.lineTo(26, 16); g.lineTo(-26, 16); g.fill(); }
  else { g.fillRect(-16, -6, 22, 12); g.fillRect(-6, -16, 10, 10); g.beginPath(); g.arc(-10, 10, 8, 0, TAU); g.fill(); g.beginPath(); g.arc(12, 12, 5, 0, TAU); g.fill(); g.fillStyle = '#ffc928'; g.beginPath(); g.arc(-10, 10, 3, 0, TAU); g.fill(); }
  return c;
}
export function bannerTexture() {
  const c = cv(512, 64), g = c.getContext('2d');
  for (let x = 0; x < 32; x++) for (let y = 0; y < 4; y++) { g.fillStyle = (x + y) % 2 ? '#1b1b1b' : '#f4e8cc'; g.fillRect(x * 16, y * 16, 16, 16); }
  g.fillStyle = '#7a2a1c'; g.fillRect(150, 6, 212, 52); g.strokeStyle = '#f4e8cc'; g.lineWidth = 4; g.strokeRect(152, 8, 208, 48);
  g.fillStyle = '#ffd34d'; g.font = '40px "Alfa Slab One", Georgia, serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('DERBY', 256, 34);
  return c;
}
export function checkerTexture() { // 2 squares along the road x 20 across it
  const c = cv(16, 160), g = c.getContext('2d');
  for (let x = 0; x < 2; x++) for (let y = 0; y < 20; y++) { g.fillStyle = (x + y) % 2 ? '#1b1b1b' : '#f4efe2'; g.fillRect(x * 8, y * 8, 8, 8); }
  return c;
}
export function ridgeGeo(color) { // frost heave: a low hump across the road (profile along x, extruded across z)
  const sh = new THREE.Shape(); [[-1, 0], [-0.62, 0.55], [0, 1], [0.62, 0.55], [1, 0]].forEach((p, i) => i ? sh.lineTo(p[0], p[1]) : sh.moveTo(p[0], p[1]));
  const g = new THREE.ExtrudeGeometry(sh, { depth: 1, bevelEnabled: false }); g.translate(0, 0, -0.5);
  return merge([part(g, color)]);
}
// frost heave as a bump: a low, rounded hump in the road's own colour (smooth normals, so it shades like a swell, not a
// plank), a lighter crest line, the far slope a touch darker as its own soft shadow. Local x = along the road (-1..1.6,
// the far side runs out longer), y = height 0..1, z = across the road (-0.5..0.5), the ends easing into the road edges.
export function humpGeo(road) {
  const NX = 18, NZ = 10, base = new THREE.Color(road), lite = base.clone().lerp(new THREE.Color(1, 0.97, 0.9), 0.32), dark = base.clone().multiplyScalar(0.8);
  const pos = [], col = [], idx = [];
  const prof = (x) => x < 0 ? 0.5 + 0.5 * Math.cos(Math.PI * Math.min(1, -x)) : 0.5 + 0.5 * Math.cos(Math.PI * Math.min(1, x / 1.6));
  for (let i = 0; i <= NX; i++) for (let j = 0; j <= NZ; j++) {
    const x = -1 + 2.6 * i / NX, z = -0.5 + j / NZ, e = Math.min(1, (0.5 - Math.abs(z)) / 0.12), ez = e * e * (3 - 2 * e);
    pos.push(x, prof(x) * ez, z);
    const c = base.clone();
    if (Math.abs(x - 0.05) < 0.22) c.lerp(lite, (1 - Math.abs(x - 0.05) / 0.22) * ez); // crest line
    else if (x > 0.35) c.lerp(dark, Math.sin(Math.PI * Math.min(1, (x - 0.35) / 1.25)) * ez); // soft far-side shadow
    col.push(c.r, c.g, c.b);
  }
  for (let i = 0; i < NX; i++) for (let j = 0; j < NZ; j++) { const a = i * (NZ + 1) + j, b = a + NZ + 1; idx.push(a, a + 1, b, b, a + 1, b + 1); }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3)); g.setIndex(idx);
  g.computeVertexNormals(); g.computeBoundingSphere(); return g;
}
// boost flame: two nested cones pointing back (-x) from the origin, length 1; colours for additive blending (the tip fades
// to black = clear): a pale-yellow core inside an orange sheath
export function flameGeo() {
  const mk = (r, cBase, cTip, seg) => { const g = new THREE.ConeGeometry(r, 1, seg, 1, true).toNonIndexed(); g.rotateZ(Math.PI / 2); g.translate(-0.5, 0, 0);
    const P = g.attributes.position.array, n = P.length / 3, col = new Float32Array(n * 3), a = new THREE.Color(cBase), b = new THREE.Color(cTip);
    for (let i = 0; i < n; i++) { const t = Math.min(1, -P[i * 3]); _c.copy(a).lerp(b, t); col[i * 3] = _c.r; col[i * 3 + 1] = _c.g; col[i * 3 + 2] = _c.b; }
    g.setAttribute('color', new THREE.BufferAttribute(col, 3)); for (const k of Object.keys(g.attributes)) if (k !== 'position' && k !== 'color') g.deleteAttribute(k); return g; };
  const outer = mk(1, '#ff8a24', '#2a0800', 10), inner = mk(0.5, '#fff4b8', '#ff7a1a', 8); inner.scale(0.7, 1, 1);
  const n = outer.attributes.position.count + inner.attributes.position.count, pos = new Float32Array(n * 3), col = new Float32Array(n * 3);
  pos.set(outer.attributes.position.array, 0); pos.set(inner.attributes.position.array, outer.attributes.position.count * 3);
  col.set(outer.attributes.color.array, 0); col.set(inner.attributes.color.array, outer.attributes.position.count * 3);
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setAttribute('color', new THREE.BufferAttribute(col, 3)); g.computeBoundingSphere(); return g;
}
export function glowTexture() { // soft radial blob (shadows, light pools, glows)
  const c = cv(64, 64), g = c.getContext('2d'), gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.45, 'rgba(255,255,255,.55)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gr; g.fillRect(0, 0, 64, 64); return c;
}
export function coneTexture() { // headlight pool: bright near the car, fading forward and to the sides (texture u = forward)
  const c = cv(128, 64), g = c.getContext('2d'), d = g.createImageData(128, 64);
  for (let y = 0; y < 64; y++) for (let x = 0; x < 128; x++) {
    const u = x / 127, v = (y - 31.5) / 31.5, spread = 0.12 + u * 0.88, a = Math.max(0, 1 - Math.abs(v) / spread) * Math.min(1, u * 8) * Math.pow(1 - u, 1.2);
    const i = (y * 128 + x) * 4; d.data[i] = d.data[i + 1] = d.data[i + 2] = 255; d.data[i + 3] = Math.round(255 * Math.min(1, a * 1.4));
  }
  g.putImageData(d, 0, 0); return c;
}
// tiling value noise (R: fine grain, G: blotches, B: sparkle)
export function noiseTexture() {
  const N = 256, c = cv(N, N), g = c.getContext('2d'), d = g.createImageData(N, N), R = rng(99);
  const grid = (n) => { const a = new Float32Array(n * n); for (let i = 0; i < a.length; i++) a[i] = R(); return a; };
  const layers = [[grid(32), 32], [grid(16), 16], [grid(8), 8], [grid(64), 64]];
  const sample = (a, n, x, y) => { const fx = x / N * n, fy = y / N * n, x0 = Math.floor(fx), y0 = Math.floor(fy), u = fx - x0, v = fy - y0, s = (t) => t * t * (3 - 2 * t);
    const A = a[(y0 % n) * n + (x0 % n)], B = a[(y0 % n) * n + ((x0 + 1) % n)], C = a[((y0 + 1) % n) * n + (x0 % n)], D = a[((y0 + 1) % n) * n + ((x0 + 1) % n)];
    return A + (B - A) * s(u) + (C - A) * s(v) + (A - B - C + D) * s(u) * s(v); };
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const i = (y * N + x) * 4;
    const fine = sample(layers[3][0], 64, x, y) * 0.6 + sample(layers[0][0], 32, x, y) * 0.4;
    const blot = sample(layers[2][0], 8, x, y) * 0.6 + sample(layers[1][0], 16, x, y) * 0.4;
    d.data[i] = Math.round(fine * 255); d.data[i + 1] = Math.round(blot * 255); d.data[i + 2] = R() < 0.012 ? 255 : Math.round(R() * 90); d.data[i + 3] = 255;
  }
  g.putImageData(d, 0, 0); return c;
}
// the horizon: Green Mountains to the east, Lake Champlain to the west (u 0.25 = east, 0.75 = west on the backdrop cylinder)
export function backdropTexture(season, hazeCol) {
  const Wd = 2048, H = 256, c = cv(Wd, H), g = c.getContext('2d'), R = rng(7);
  // two ridges, far and near, blue-green; the lake is a clear blue band across the west with glints
  const P = {
    spring: { haze: '#cbd6c0', ridges: ['#93b4b6', '#5e8c7e'], lake: '#5f97c2', glint: '#f2f8fb', snow: null },
    autumn: { haze: '#ecd6b4', ridges: ['#9fb0b8', '#7f8a6a'], lake: '#6d9cc0', glint: '#fff1cc', snow: null, fall: ['#b4562e', '#c88a3a', '#8e4a2a', '#d0a040'] },
    winter: { haze: '#dde3e9', ridges: ['#b6c6d4', '#8aa0b2'], lake: '#9cbad2', glint: '#ffffff', snow: '#f6f9fb' },
    night: { haze: '#1d2b4d', ridges: ['#1f2c4c', '#141d36'], lake: '#2c4472', glint: '#d8e2ff', snow: null }
  }[season] || null;
  const p = P || { haze: '#cfe0ea', ridges: ['#93b4b6', '#5e8c7e'], lake: '#5f97c2', glint: '#fff' };
  if (hazeCol) p.haze = hazeCol;
  // the eye line sits at row ~220 of 256; the Green Mountains rise ~100 px over it in the east (about 8% of a portrait screen),
  // and fall to a low blue far shore across the lake in the west
  const ridge = (layer) => {
    const base = H - 30 + layer * 8, pts = [];
    const ph = R() * 10;
    for (let x = 0; x <= Wd; x += 8) {
      const u = x / Wd, east = Math.max(0, Math.cos((u - 0.25) * TAU)); // 1 at east, 0 at west
      const lake = Math.max(0, Math.cos((u - 0.75) * TAU));
      let h = (34 + 86 * east) * (layer ? 0.62 : 1) + Math.sin(u * TAU * 7 + ph) * 14 * (0.4 + east) + Math.sin(u * TAU * 19 + ph * 2) * 7 + Math.sin(u * TAU * 43 + ph) * 2.6;
      // the landmark: a tall double-humped peak just north of due east, on the far ridge
      const dk = (u - 0.215) * 40; if (layer === 0) h += east * (62 * Math.exp(-dk * dk) + 44 * Math.exp(-(dk + 1.4) * (dk + 1.4)));
      h *= 1 - lake * (layer ? 0.92 : 0.7);
      pts.push([x, base - Math.max(3, h)]);
    }
    return pts;
  };
  g.clearRect(0, 0, Wd, H);
  for (let L = 0; L < 2; L++) {
    const pts = ridge(L);
    const gr = g.createLinearGradient(0, H - 150, 0, H); gr.addColorStop(0, p.ridges[L]); gr.addColorStop(1, shadeHex(p.ridges[L], L ? 0.12 : 0.22));
    g.fillStyle = gr; g.beginPath(); g.moveTo(0, H); pts.forEach(([x, y]) => g.lineTo(x, y)); g.lineTo(Wd, H); g.closePath(); g.fill();
    if (p.snow) { g.save(); g.clip(); g.fillStyle = p.snow; g.globalAlpha = L ? 0.6 : 0.85; for (const [x, y] of pts) if (y < H - 80) g.fillRect(x, y, 8, (H - 80 - y) * 0.5 + 3); g.restore(); g.globalAlpha = 1; }
    if (p.fall && L === 1) { g.save(); g.clip(); for (let i = 0; i < 1400; i++) { g.fillStyle = p.fall[i % 4]; g.globalAlpha = 0.45; g.fillRect(R() * Wd, H - 90 + R() * 90, 6, 3); } g.restore(); g.globalAlpha = 1; }
  }
  // the lake: a clear blue band across the west half, brightest at the far shore, with glints
  const lk = g.createLinearGradient(0, H - 58, 0, H); lk.addColorStop(0, shadeHex(p.lake, 0.18)); lk.addColorStop(0.5, p.lake); lk.addColorStop(1, shadeHex(p.lake, -0.1));
  g.fillStyle = lk;
  g.beginPath(); for (let x = 0; x <= Wd; x += 8) { const u = x / Wd, lake = Math.max(0, Math.cos((u - 0.75) * TAU)); const y = H - 56 * Math.min(1, lake * 2.2); x ? g.lineTo(x, y) : g.moveTo(x, y); } g.lineTo(Wd, H); g.lineTo(0, H); g.fill();
  g.fillStyle = p.glint; for (let x = Wd * 0.56; x < Wd * 0.94; x += 5) { const u = x / Wd, lake = Math.max(0, Math.cos((u - 0.75) * TAU)); if (lake > 0.45 && R() < 0.5) { g.globalAlpha = 0.5 + R() * 0.45; g.fillRect(x, H - 50 + R() * 30, 4 + R() * 14, 1.6); } } g.globalAlpha = 1;
  // two long flat clouds (spring, autumn) high over the hills
  if (season === 'spring' || season === 'autumn') for (const [u, w] of [[0.16, 0.14], [0.62, 0.11]]) {
    const cx = u * Wd, cy = 20, cw2 = w * Wd;
    for (let i = 0; i < 9; i++) { const x = cx + (R() - 0.5) * cw2, y = cy + (R() - 0.5) * 12, rx = 30 + R() * 50, ry = 7 + R() * 6; const g2 = g.createRadialGradient(x, y, 0, x, y, rx); g2.addColorStop(0, season === 'autumn' ? 'rgba(255,246,232,.85)' : 'rgba(255,255,255,.85)'); g2.addColorStop(1, 'rgba(255,255,255,0)'); g.fillStyle = g2; g.save(); g.translate(x, y); g.scale(1, ry / rx); g.translate(-x, -y); g.beginPath(); g.arc(x, y, rx, 0, TAU); g.fill(); g.restore(); }
  }
  // haze at the foot, matching the fog
  const hz = g.createLinearGradient(0, H - 30, 0, H); hz.addColorStop(0, 'rgba(0,0,0,0)'); hz.addColorStop(1, p.haze);
  g.globalCompositeOperation = 'source-atop'; g.fillStyle = hz; g.fillRect(0, H - 30, Wd, 30); g.globalCompositeOperation = 'source-over';
  g.fillStyle = p.haze; g.fillRect(0, H - 6, Wd, 6);
  return c;
}
