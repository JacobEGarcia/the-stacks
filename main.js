import * as THREE from './1-three.module.js';

/* ============================================================
   THE STACKS - a library, after closing
   first-person horror. recover six pages. avoid the librarian.
   ============================================================ */

const Q = new URLSearchParams(location.search);
const AUTO = Q.has('auto');                       // headless test mode
const SEED = Q.get('seed') ?? String((Math.random() * 1e9) | 0);

function hashStr(s){ let h = 2166136261; for (const c of String(s)){ h ^= c.codePointAt(0); h = Math.imul(h, 16777619); } return h >>> 0; }
function mulberry32(a){ return function(){ a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
const rnd = mulberry32(hashStr(SEED));

/* ---------------- layout ---------------- */
const GRID = 26, CELL = 2.2, WALL_H = 3.3, EYE = 1.66;
const OPEN = 0, SHELF = 1, WALL = 2, TABLE = 3, DESK = 4, DOOR = 5;
const G = [];
for (let z = 0; z < GRID; z++){ G.push(new Array(GRID).fill(OPEN)); }

const DOOR_CX = 13, DOOR_CZ = GRID - 1;

function buildLayout(){
  for (let i = 0; i < GRID; i++){           // border walls
    G[0][i] = WALL; G[GRID-1][i] = WALL; G[i][0] = WALL; G[i][GRID-1] = WALL;
  }
  G[DOOR_CZ][DOOR_CX] = DOOR;               // the way out
  // stacks: shelf rows with aisles between, double center aisle
  const rowZ = [3, 5, 7, 9, 11, 13, 15];
  for (const z of rowZ)
    for (let x = 3; x <= 22; x++){
      if (x >= 11 && x <= 14) continue;     // center cross-aisle
      G[z][x] = SHELF;
    }
  // reading room tables (z = 19)
  for (const [a, b] of [[5, 8], [11, 14], [17, 20]])
    for (let x = a; x <= b; x++) G[19][x] = TABLE;
  // card catalogue + returns desk near the door
  G[22][4] = DESK; G[22][5] = DESK; G[23][4] = DESK;
  G[22][21] = DESK; G[22][22] = DESK; G[23][22] = DESK;
}
buildLayout();

const cellOpenFor = (x, z, entity) => {
  if (x < 0 || z < 0 || x >= GRID || z >= GRID) return false;
  const v = G[z][x];
  if (entity) return v === OPEN;
  return v === OPEN;                        // door blocks walking; win by interact
};
const blocksSight = (x, z) => {
  if (x < 0 || z < 0 || x >= GRID || z >= GRID) return true;
  const v = G[z][x];
  return v === SHELF || v === WALL || v === DOOR;
};
const c2w = c => (c - GRID / 2 + 0.5) * CELL;

function losClear(x0, z0, x1, z1){
  const dx = x1 - x0, dz = z1 - z0, d = Math.hypot(dx, dz), n = Math.ceil(d / 0.3);
  for (let i = 1; i < n; i++){
    const t = i / n;
    const cx = Math.floor((x0 + dx * t) / CELL + GRID / 2);
    const cz = Math.floor((z0 + dz * t) / CELL + GRID / 2);
    if (blocksSight(cx, cz)) return false;
  }
  return true;
}

/* ---------------- renderer / scene ---------------- */
const canvas = document.getElementById('game');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.25;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x030202);
scene.fog = new THREE.FogExp2(0x050403, 0.058);

const camera = new THREE.PerspectiveCamera(66, innerWidth / innerHeight, 0.05, 90);
scene.add(camera);

addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});

/* ---------------- lights ---------------- */
scene.add(new THREE.AmbientLight(0x2a2018, 1.0));
const moon = new THREE.DirectionalLight(0x33415e, 0.35);
moon.position.set(8, 20, -14);
scene.add(moon);

const lamp = new THREE.SpotLight(0xffdfae, 190, 42, 0.45, 0.45, 1.4);
const lampTarget = new THREE.Object3D();
scene.add(lamp, lampTarget);
lamp.target = lampTarget;
let lampOn = true, lampFlicker = 0;

/* ---------------- static geometry ---------------- */
const woodDark  = new THREE.MeshStandardMaterial({ color: 0x1f150d, roughness: 0.92 });
const woodFloor = new THREE.MeshStandardMaterial({ color: 0x17110b, roughness: 0.96 });
const wallMat   = new THREE.MeshStandardMaterial({ color: 0x191310, roughness: 0.98 });

{
  const half = GRID * CELL / 2;
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(GRID * CELL, GRID * CELL), woodFloor);
  floor.rotation.x = -Math.PI / 2; scene.add(floor);
  const ceil = new THREE.Mesh(new THREE.PlaneGeometry(GRID * CELL, GRID * CELL),
    new THREE.MeshStandardMaterial({ color: 0x0a0806, roughness: 1 }));
  ceil.rotation.x = Math.PI / 2; ceil.position.y = WALL_H; scene.add(ceil);
}

function instancedBoxes(list, w, h, d, mat){
  const m = new THREE.InstancedMesh(new THREE.BoxGeometry(w, h, d), mat, list.length);
  const M = new THREE.Matrix4();
  list.forEach(([x, y, z], i) => { M.makeTranslation(x, y, z); m.setMatrixAt(i, M); });
  m.instanceMatrix.needsUpdate = true;
  scene.add(m);
  return m;
}

const wallCells = [], shelfCells = [];
for (let z = 0; z < GRID; z++) for (let x = 0; x < GRID; x++){
  if (G[z][x] === WALL) wallCells.push([c2w(x), WALL_H / 2, c2w(z)]);
  if (G[z][x] === SHELF) shelfCells.push([c2w(x), 1.22, c2w(z), x, z]);
}
instancedBoxes(wallCells, CELL, WALL_H, CELL, wallMat);
instancedBoxes(shelfCells.map(s => s.slice(0, 3)), CELL, 2.44, CELL, woodDark);

/* shelf tops / end trim: thin cap on each shelf row block */
instancedBoxes(shelfCells.map(s => [s[0], 2.47, s[2]]), CELL, 0.05, CELL,
  new THREE.MeshStandardMaterial({ color: 0x2a1c10, roughness: 0.85 }));

/* books - instanced spines on every shelf face that meets an aisle */
const BOOK_COLORS = [0x6e3b2a, 0x274135, 0x54431f, 0x3a2f4a, 0x713f1f, 0x2e3a4d, 0x5c2e2e, 0x4a3b28, 0x635232, 0x33302a];
{
  const mats = [], cols = [];
  const M = new THREE.Matrix4(), Qt = new THREE.Quaternion(), S = new THREE.Vector3(), P = new THREE.Vector3();
  for (const [wx, , wz, cx, cz] of shelfCells){
    for (const [dx, dz] of [[1,0],[-1,0],[0,1],[0,-1]]){
      if (G[cz + dz]?.[cx + dx] !== OPEN) continue;
      for (let lvl = 0; lvl < 4; lvl++){
        const baseY = 0.28 + lvl * 0.58;
        let along = -CELL / 2 + 0.10;
        while (along < CELL / 2 - 0.10){
          const bw = 0.055 + rnd() * 0.10, bh = 0.30 + rnd() * 0.16, bt = 0.15;
          if (rnd() > 0.06){
            const faceOff = CELL / 2 - bt / 2 + 0.012;
            P.set(wx + dx * faceOff + (dz ? along : 0), baseY + bh / 2, wz + dz * faceOff + (dx ? along : 0));
            Qt.setFromAxisAngle(new THREE.Vector3(0, 1, 0), dx ? Math.PI / 2 : 0);
            S.set(bw, bh, bt);
            M.compose(P, Qt, S);
            mats.push(M.clone());
            cols.push(BOOK_COLORS[(rnd() * BOOK_COLORS.length) | 0]);
          }
          along += bw + 0.012;
        }
      }
    }
  }
  // fallen books in the aisles
  for (let i = 0; i < 46; i++){
    let cx, cz, tries = 0;
    do { cx = 1 + (rnd() * (GRID - 2)) | 0; cz = 1 + (rnd() * (GRID - 2)) | 0; } while (G[cz][cx] !== OPEN && tries++ < 40);
    P.set(c2w(cx) + (rnd() - 0.5) * 1.2, 0.03, c2w(cz) + (rnd() - 0.5) * 1.2);
    Qt.setFromAxisAngle(new THREE.Vector3(0, 1, 0), rnd() * Math.PI);
    S.set(0.16 + rnd() * 0.08, 0.05, 0.24 + rnd() * 0.08);
    M.compose(P, Qt, S);
    mats.push(M.clone());
    cols.push(BOOK_COLORS[(rnd() * BOOK_COLORS.length) | 0]);
  }
  const books = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1),
    new THREE.MeshStandardMaterial({ roughness: 0.9 }), mats.length);
  const C = new THREE.Color();
  mats.forEach((m, i) => { books.setMatrixAt(i, m); books.setColorAt(i, C.setHex(cols[i])); });
  books.instanceMatrix.needsUpdate = true;
  if (books.instanceColor) books.instanceColor.needsUpdate = true;
  scene.add(books);
}

/* reading tables + banker lamps + catalogue desks */
const lampLights = [];
{
  const brass = new THREE.MeshStandardMaterial({ color: 0x6b5322, roughness: 0.4, metalness: 0.7 });
  const shade = new THREE.MeshStandardMaterial({ color: 0x14421f, emissive: 0x2e8b4f, emissiveIntensity: 1.15, roughness: 0.5 });
  for (let z = 0; z < GRID; z++) for (let x = 0; x < GRID; x++){
    const v = G[z][x];
    if (v !== TABLE && v !== DESK) continue;
    if (v === TABLE && (x === 5 || x === 11 || x === 17)){   // one table build per run start
      const w = 4 * CELL, cx = c2w(x) + 1.5 * CELL, cz = c2w(z);
      const top = new THREE.Mesh(new THREE.BoxGeometry(w, 0.07, 1.15), woodDark);
      top.position.set(cx, 0.78, cz); scene.add(top);
      for (const sx of [-w / 2 + 0.15, w / 2 - 0.15]) for (const sz of [-0.45, 0.45]){
        const leg = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.78, 0.09), woodDark);
        leg.position.set(cx + sx, 0.39, cz + sz); scene.add(leg);
      }
      // banker lamp at table center
      const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.05, 0.34, 8), brass);
      stem.position.set(cx, 0.98, cz); scene.add(stem);
      const sh = new THREE.Mesh(new THREE.SphereGeometry(0.14, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2), shade);
      sh.position.set(cx, 1.16, cz); scene.add(sh);
      const pl = new THREE.PointLight(0x3fae66, 16, 10, 1.7);
      pl.position.set(cx, 1.22, cz); scene.add(pl); lampLights.push(pl);
    }
    if (v === DESK){
      const d = new THREE.Mesh(new THREE.BoxGeometry(CELL * 0.94, 1.06, CELL * 0.94), woodDark);
      d.position.set(c2w(x), 0.53, c2w(z)); scene.add(d);
    }
  }
  // entry sconce - one warm light by the door
  const warm = new THREE.PointLight(0xd88b3a, 4.5, 9, 1.8);
  warm.position.set(c2w(DOOR_CX), 2.5, c2w(DOOR_CZ) - 1.4); scene.add(warm); lampLights.push(warm);
}

/* EXIT sign */
const exitSign = (() => {
  const cv = document.createElement('canvas'); cv.width = 256; cv.height = 96;
  const g = cv.getContext('2d');
  g.fillStyle = '#0a0505'; g.fillRect(0, 0, 256, 96);
  g.font = '300 56px Georgia, serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillStyle = '#b33226'; g.letterSpacing = '14px'; g.fillText('EXIT', 132, 52);
  const tex = new THREE.CanvasTexture(cv);
  const m = new THREE.Mesh(new THREE.PlaneGeometry(0.9, 0.34),
    new THREE.MeshBasicMaterial({ map: tex, transparent: false }));
  m.position.set(c2w(DOOR_CX), 2.72, c2w(DOOR_CZ) - CELL / 2 - 0.02);
  m.rotation.y = Math.PI;
  scene.add(m);
  return { mesh: m, cv, g, tex };
})();

/* door */
const doorGroup = new THREE.Group();
{
  const doorMat = new THREE.MeshStandardMaterial({ color: 0x241a10, roughness: 0.8 });
  const panelMat = new THREE.MeshStandardMaterial({ color: 0x150d07, roughness: 0.9 });
  const knobMat = new THREE.MeshStandardMaterial({ color: 0x6b5322, roughness: 0.35, metalness: 0.8 });
  for (const s of [-1, 1]){
    const leaf = new THREE.Mesh(new THREE.BoxGeometry(CELL / 2 - 0.03, WALL_H - 0.1, 0.09), doorMat);
    leaf.position.set(s * CELL / 4, (WALL_H - 0.1) / 2, 0);
    doorGroup.add(leaf);
    for (const py of [0.75, 1.85]){
      const panel = new THREE.Mesh(new THREE.BoxGeometry(CELL / 2 - 0.28, 0.85, 0.03), panelMat);
      panel.position.set(s * CELL / 4, py, -0.055);
      doorGroup.add(panel);
    }
    const knob = new THREE.Mesh(new THREE.SphereGeometry(0.035, 10, 8), knobMat);
    knob.position.set(s * 0.09, 1.05, -0.08);
    doorGroup.add(knob);
  }
  doorGroup.position.set(c2w(DOOR_CX), 0, c2w(DOOR_CZ));
  scene.add(doorGroup);
}
let doorOpen = false;

/* dust motes */
const motes = (() => {
  const N = 420, pos = new Float32Array(N * 3);
  for (let i = 0; i < N; i++){ pos[i*3] = (rnd() - 0.5) * 40; pos[i*3+1] = rnd() * 3; pos[i*3+2] = (rnd() - 0.5) * 40; }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  const p = new THREE.Points(geo, new THREE.PointsMaterial({
    color: 0xa08b62, size: 0.02, sizeAttenuation: true, transparent: true,
    opacity: 0.4, blending: THREE.AdditiveBlending, depthWrite: false }));
  scene.add(p);
  return p;
})();

/* ---------------- pages (the objective) ---------------- */
const glowTex = (() => {
  const cv = document.createElement('canvas'); cv.width = cv.height = 128;
  const g = cv.getContext('2d');
  const gr = g.createRadialGradient(64, 64, 2, 64, 64, 64);
  gr.addColorStop(0, 'rgba(226,178,96,0.85)'); gr.addColorStop(0.4, 'rgba(226,178,96,0.22)'); gr.addColorStop(1, 'rgba(226,178,96,0)');
  g.fillStyle = gr; g.fillRect(0, 0, 128, 128);
  return new THREE.CanvasTexture(cv);
})();

const pages = [];
function placePages(){
  for (const p of pages) scene.remove(p.group);
  pages.length = 0;
  const taken = [];
  while (pages.length < 6){
    const cx = 2 + ((rnd() * (GRID - 4)) | 0), cz = 2 + ((rnd() * 16) | 0);   // stacks half
    if (G[cz][cx] !== OPEN) continue;
    const wx = c2w(cx), wz = c2w(cz);
    if (Math.hypot(wx - c2w(DOOR_CX), wz - c2w(DOOR_CZ - 2)) < 9) continue;
    if (taken.some(t => Math.hypot(t[0] - wx, t[1] - wz) < 8)) continue;
    taken.push([wx, wz]);
    const group = new THREE.Group();
    const book = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.035, 0.3),
      new THREE.MeshStandardMaterial({ color: 0xd8cfae, emissive: 0xc99a4e, emissiveIntensity: 0.85, roughness: 0.6 }));
    group.add(book);
    const glow = new THREE.Sprite(new THREE.SpriteMaterial({
      map: glowTex, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, opacity: 0.75 }));
    glow.scale.setScalar(1.1);
    group.add(glow);
    group.position.set(wx + (rnd() - 0.5), 0.75 + rnd() * 0.7, wz + (rnd() - 0.5));
    scene.add(group);
    pages.push({ group, wx: group.position.x, wz: group.position.z, taken: false, phase: rnd() * 6.28 });
  }
}

/* ---------------- the librarian ---------------- */
const entity = (() => {
  const g = new THREE.Group();
  const robe = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.34, 1.95, 10),
    new THREE.MeshStandardMaterial({ color: 0x0c0a09, roughness: 1 }));
  robe.position.y = 0.975; g.add(robe);
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.145, 14, 12),
    new THREE.MeshStandardMaterial({ color: 0xcfc4ae, emissive: 0xcfc4ae, emissiveIntensity: 0.14, roughness: 0.6 }));
  head.position.y = 2.06; g.add(head);
  const eyeMat = new THREE.MeshBasicMaterial({ color: 0x000000 });
  for (const s of [-1, 1]){
    const e = new THREE.Mesh(new THREE.SphereGeometry(0.017, 6, 6), eyeMat);
    e.position.set(s * 0.052, 2.08, 0.125); g.add(e);
  }
  const armMat = robe.material;
  for (const s of [-1, 1]){
    const a = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.028, 1.05, 6), armMat);
    a.position.set(s * 0.24, 1.28, 0.02); a.rotation.z = s * 0.1; g.add(a);
  }
  const aura = new THREE.PointLight(0xbfb090, 4, 5, 1.8);
  aura.position.y = 1.9; g.add(aura);
  g.visible = false;
  scene.add(g);
  return { g, x: 0, z: 0, state: 'lurk', timer: 0, path: [], pathI: 0, stare: 0, lastSeen: -99, speed: 1.7 };
})();

function entitySpawnFar(){
  for (let i = 0; i < 60; i++){
    const cx = 2 + ((rnd() * (GRID - 4)) | 0), cz = 2 + ((rnd() * 8) | 0);
    if (G[cz][cx] !== OPEN) continue;
    const wx = c2w(cx), wz = c2w(cz);
    if (Math.hypot(wx - player.x, wz - player.z) > 14){ entity.x = wx; entity.z = wz; return; }
  }
  entity.x = c2w(12); entity.z = c2w(4);
}

/* ---------------- audio (all procedural) ---------------- */
const AudioSys = {
  ok: false, ctx: null, master: null,
  init(){
    try {
      this.ctx = new (window.AudioContext || window.webkitAudioContext)();
      this.master = this.ctx.createGain(); this.master.gain.value = 0.9;
      this.master.connect(this.ctx.destination);
      this.drone();
      this.ok = true;
    } catch (e) { this.ok = false; }
  },
  noiseBuf(){
    if (this._nb) return this._nb;
    const n = this.ctx.sampleRate * 2, b = this.ctx.createBuffer(1, n, this.ctx.sampleRate);
    const d = b.getChannelData(0); let last = 0;
    for (let i = 0; i < n; i++){ const w = Math.random() * 2 - 1; last = (last + 0.02 * w) / 1.02; d[i] = last * 3.2; }
    return (this._nb = b);
  },
  whiteBuf(){
    if (this._wb) return this._wb;
    const n = this.ctx.sampleRate, b = this.ctx.createBuffer(1, n, this.ctx.sampleRate);
    const d = b.getChannelData(0);
    for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
    return (this._wb = b);
  },
  drone(){
    const c = this.ctx;
    const src = c.createBufferSource(); src.buffer = this.noiseBuf(); src.loop = true;
    const lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 190;
    const g = c.createGain(); g.gain.value = 0.055;
    src.connect(lp).connect(g).connect(this.master); src.start();
    for (const f of [47, 47.65]){
      const o = c.createOscillator(); o.type = 'sine'; o.frequency.value = f;
      const og = c.createGain(); og.gain.value = 0.028;
      o.connect(og).connect(this.master); o.start();
    }
  },
  thump(v){
    if (!this.ok) return;
    const c = this.ctx, t = c.currentTime;
    const o = c.createOscillator(); o.type = 'sine'; o.frequency.setValueAtTime(58, t);
    o.frequency.exponentialRampToValueAtTime(38, t + 0.1);
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(v, t + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.16);
    o.connect(g).connect(this.master); o.start(t); o.stop(t + 0.2);
  },
  step(v){
    if (!this.ok) return;
    const c = this.ctx, t = c.currentTime;
    const s = c.createBufferSource(); s.buffer = this.noiseBuf();
    const f = c.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 240;
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(v, t + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.11);
    s.connect(f).connect(g).connect(this.master); s.start(t); s.stop(t + 0.13);
  },
  whisper(){
    if (!this.ok) return;
    const c = this.ctx;
    for (let i = 0; i < 4; i++){
      const t = c.currentTime + i * (0.09 + Math.random() * 0.1);
      const s = c.createBufferSource(); s.buffer = this.whiteBuf();
      const f = c.createBiquadFilter(); f.type = 'bandpass';
      f.frequency.value = 900 + Math.random() * 1800; f.Q.value = 6;
      const p = c.createStereoPanner(); p.pan.value = Math.random() * 2 - 1;
      const g = c.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.03 + Math.random() * 0.03, t + 0.03);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.12 + Math.random() * 0.1);
      s.connect(f).connect(g).connect(p).connect(this.master);
      s.start(t); s.stop(t + 0.3);
    }
  },
  scrape(){
    if (!this.ok) return;
    const c = this.ctx, t = c.currentTime;
    const s = c.createBufferSource(); s.buffer = this.noiseBuf();
    const f = c.createBiquadFilter(); f.type = 'bandpass'; f.Q.value = 3;
    f.frequency.setValueAtTime(900, t); f.frequency.exponentialRampToValueAtTime(160, t + 0.7);
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.09, t + 0.05);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.8);
    s.connect(f).connect(g).connect(this.master); s.start(t); s.stop(t + 0.85);
  },
  chime(){
    if (!this.ok) return;
    const c = this.ctx;
    [392, 466.16, 587.33].forEach((fr, i) => {
      const t = c.currentTime + i * 0.09;
      const o = c.createOscillator(); o.type = 'sine'; o.frequency.value = fr;
      const g = c.createGain();
      g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.06, t + 0.015);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.9);
      o.connect(g).connect(this.master); o.start(t); o.stop(t + 1);
    });
  },
  sting(){
    if (!this.ok) return;
    const c = this.ctx, t = c.currentTime;
    [1174.7, 1244.5, 1318.5].forEach(fr => {
      const o = c.createOscillator(); o.type = 'sine'; o.frequency.value = fr * (0.99 + Math.random() * 0.02);
      const g = c.createGain();
      g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.022, t + 0.3);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 1.6);
      o.connect(g).connect(this.master); o.start(t); o.stop(t + 1.7);
    });
  },
  doom(){
    if (!this.ok) return;
    const c = this.ctx, t = c.currentTime;
    const o = c.createOscillator(); o.type = 'sine';
    o.frequency.setValueAtTime(140, t); o.frequency.exponentialRampToValueAtTime(28, t + 1.1);
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.4, t + 0.03);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 1.4);
    o.connect(g).connect(this.master); o.start(t); o.stop(t + 1.5);
    const s = c.createBufferSource(); s.buffer = this.whiteBuf();
    const sg = c.createGain();
    sg.gain.setValueAtTime(0.0001, t); sg.gain.exponentialRampToValueAtTime(0.25, t + 0.01);
    sg.gain.exponentialRampToValueAtTime(0.0001, t + 0.5);
    s.connect(sg).connect(this.master); s.start(t); s.stop(t + 0.6);
  },
  dawn(){
    if (!this.ok) return;
    const c = this.ctx;
    [261.6, 329.6, 392, 523.3].forEach((fr, i) => {
      const t = c.currentTime + i * 0.16;
      const o = c.createOscillator(); o.type = 'sine'; o.frequency.value = fr;
      const g = c.createGain();
      g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.05, t + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 1.4);
      o.connect(g).connect(this.master); o.start(t); o.stop(t + 1.5);
    });
  },
};

/* ---------------- player ---------------- */
const player = { x: c2w(DOOR_CX), z: c2w(DOOR_CZ - 2), yaw: 0, pitch: 0, bob: 0, stride: 0 };
const keys = {};
addEventListener('keydown', e => { keys[e.code] = true;
  if (e.code === 'KeyF' && state === 'PLAYING') { lampOn = !lampOn; AudioSys.step(0.05); }
  if (e.code === 'KeyE' && state === 'PLAYING') interact();
});
addEventListener('keyup', e => { keys[e.code] = false; });
addEventListener('mousemove', e => {
  if (state !== 'PLAYING' || (!document.pointerLockElement && !AUTO)) return;
  player.yaw -= e.movementX * 0.0021;
  player.pitch = Math.max(-1.45, Math.min(1.45, player.pitch - e.movementY * 0.0021));
});

function collide(){
  const r = 0.34;
  const cx0 = Math.floor((player.x - r) / CELL + GRID / 2), cx1 = Math.floor((player.x + r) / CELL + GRID / 2);
  const cz0 = Math.floor((player.z - r) / CELL + GRID / 2), cz1 = Math.floor((player.z + r) / CELL + GRID / 2);
  for (let cz = cz0; cz <= cz1; cz++) for (let cx = cx0; cx <= cx1; cx++){
    if (cellOpenFor(cx, cz, false)) continue;
    const bx = c2w(cx), bz = c2w(cz), h = CELL / 2;
    const nx = Math.max(bx - h, Math.min(player.x, bx + h));
    const nz = Math.max(bz - h, Math.min(player.z, bz + h));
    const dx = player.x - nx, dz = player.z - nz, d = Math.hypot(dx, dz);
    if (d < r && d > 0.0001){ player.x += dx / d * (r - d); player.z += dz / d * (r - d); }
  }
  const lim = GRID * CELL / 2 - 0.4;
  player.x = Math.max(-lim, Math.min(lim, player.x));
  player.z = Math.max(-lim, Math.min(lim, player.z));
}

/* ---------------- game state ---------------- */
let state = 'TITLE', collected = 0, dread = 0, startT = 0, elapsed = 0;
let beatTimer = 0, whisperTimer = 3, shake = 0;

const overlay = document.getElementById('overlay');
const overlayContent = document.getElementById('overlay-content');
const pagesEl = document.getElementById('pages');
const promptEl = document.getElementById('prompt');
const objectiveEl = document.getElementById('objective');
const vignetteEl = document.getElementById('vignette');

function showScreen(html, cls){
  overlayContent.innerHTML = html;
  overlay.className = 'screen' + (cls ? ' ' + cls : '');
}
function hideScreen(){ overlay.className = 'screen hidden'; }

function startGame(){
  collected = 0; dread = 0; elapsed = 0; startT = performance.now();
  player.x = c2w(DOOR_CX); player.z = c2w(DOOR_CZ - 2); player.yaw = 0; player.pitch = 0;
  doorOpen = false; doorGroup.rotation.y = 0; doorGroup.position.z = c2w(DOOR_CZ);
  exitSign.g.fillStyle = '#b33226'; exitSign.g.fillText('EXIT', 132, 52); exitSign.tex.needsUpdate = true;
  placePages();
  entity.state = 'lurk'; entity.timer = 5; entity.g.visible = false; entity.stare = 0;
  entitySpawnFar();
  hideScreen();
  pagesEl.innerHTML = 'pages &nbsp;<b>0 / 6</b>';
  objectiveEl.textContent = 'recover the six missing pages. leave before it finds you.';
  objectiveEl.style.opacity = 1;
  setTimeout(() => { objectiveEl.style.opacity = 0; }, 8000);
  state = 'PLAYING';
  if (!AUTO) document.body.requestPointerLock();
}

function die(){
  state = 'DEAD'; AudioSys.doom();
  document.exitPointerLock?.();
  setTimeout(() => {
    showScreen(`<h1>SHHH.</h1><div class="rule"></div>
      <p class="sub">it shelved you among the quiet things.</p>
      <p class="go">click to try again</p>`, 'dead');
  }, 900);
}

function win(){
  state = 'WON'; AudioSys.dawn();
  document.exitPointerLock?.();
  const m = Math.floor(elapsed / 60), s = Math.floor(elapsed % 60);
  setTimeout(() => {
    showScreen(`<h1>MORNING.</h1><div class="rule"></div>
      <p class="sub">you returned what was lost.</p>
      <p class="stat">six pages &nbsp;&middot;&nbsp; ${m}m ${String(s).padStart(2, '0')}s</p>
      <p class="go">click to walk back in</p>`, 'won');
  }, 600);
}

overlay.addEventListener('click', () => {
  if (state === 'TITLE' || state === 'DEAD' || state === 'WON'){ AudioSys.init(); startGame(); }
  else if (state === 'PAUSED'){ hideScreen(); state = 'PLAYING'; if (!AUTO) document.body.requestPointerLock(); }
});
document.addEventListener('pointerlockchange', () => {
  if (!document.pointerLockElement && state === 'PLAYING' && !AUTO){
    state = 'PAUSED';
    showScreen(`<h1>PAUSED</h1><div class="rule"></div><p class="go">click to resume</p>`);
  }
});

/* ---------------- interaction ---------------- */
function nearestPage(){
  let best = null, bd = 1.5;
  for (const p of pages){
    if (p.taken) continue;
    const d = Math.hypot(p.group.position.x - player.x, p.group.position.z - player.z);
    if (d < bd){ bd = d; best = p; }
  }
  return best;
}
function nearDoor(){
  return Math.hypot(player.x - c2w(DOOR_CX), player.z - (c2w(DOOR_CZ) - 0.8)) < 2.0;
}
function interact(){
  const p = nearestPage();
  if (p){
    p.taken = true; scene.remove(p.group); collected++;
    AudioSys.chime();
    pagesEl.innerHTML = `pages &nbsp;<b>${collected} / 6</b>`;
    if (collected === 6){
      exitSign.g.fillStyle = '#0a0505'; exitSign.g.fillRect(0, 0, 256, 96);
      exitSign.g.fillStyle = '#3fae66'; exitSign.g.fillText('EXIT', 132, 52);
      exitSign.tex.needsUpdate = true;
      objectiveEl.textContent = 'the door will open now. go.';
      objectiveEl.style.opacity = 1;
      setTimeout(() => { objectiveEl.style.opacity = 0; }, 5000);
    }
    return;
  }
  if (nearDoor() && collected >= 6 && !doorOpen){
    doorOpen = true;
    win();
  }
}

/* ---------------- entity brain ---------------- */
function bfs(sx, sz, tx, tz){
  const key = (x, z) => z * GRID + x;
  const prev = new Map(), seen = new Set([key(sx, sz)]), q = [[sx, sz]];
  while (q.length){
    const [x, z] = q.shift();
    if (x === tx && z === tz){
      const path = []; let k = key(x, z), cur = [x, z];
      while (cur){ path.unshift(cur); cur = prev.get(k); if (cur) k = key(cur[0], cur[1]); }
      return path;
    }
    for (const [dx, dz] of [[1,0],[-1,0],[0,1],[0,-1]]){
      const nx = x + dx, nz = z + dz;
      if (!cellOpenFor(nx, nz, true) || seen.has(key(nx, nz))) continue;
      seen.add(key(nx, nz)); prev.set(key(nx, nz), [x, z]); q.push([nx, nz]);
    }
  }
  return null;
}

function entityVisible(){
  if (!entity.g.visible) return false;
  const dx = entity.x - player.x, dz = entity.z - player.z, d = Math.hypot(dx, dz);
  if (d > 26) return false;
  const fx = Math.sin(player.yaw) * -1, fz = Math.cos(player.yaw) * -1;   // camera forward (yaw=PI faces -z... see below)
  const dot = (dx * fx + dz * fz) / (d || 1);
  if (dot < 0.55) return false;
  return losClear(player.x, player.z, entity.x, entity.z);
}

function updateEntity(dt){
  const d = Math.hypot(entity.x - player.x, entity.z - player.z);
  const seen = entityVisible();
  if (seen && performance.now() / 1000 - entity.lastSeen > 6){ AudioSys.sting(); }
  if (seen) entity.lastSeen = performance.now() / 1000;

  if (entity.state === 'lurk'){
    entity.timer -= dt * (seen ? 0.25 : 1);
    if (seen){ entity.stare += dt; if (d < 9 && entity.stare > 2.2){ entity.state = 'hunt'; entity.timer = 5; entity.path = null; AudioSys.scrape(); } }
    else entity.stare = Math.max(0, entity.stare - dt);
    if (entity.timer <= 0){
      // relocate: mostly unseen spots, sometimes right where you will see it
      const wantShow = collected >= 2 && rnd() < 0.3;
      for (let i = 0; i < 50; i++){
        const a = rnd() * Math.PI * 2, r = 6 + rnd() * 9;
        const wx = player.x + Math.cos(a) * r, wz = player.z + Math.sin(a) * r;
        const cx = Math.floor(wx / CELL + GRID / 2), cz = Math.floor(wz / CELL + GRID / 2);
        if (!cellOpenFor(cx, cz, true)) continue;
        const vis = losClear(player.x, player.z, wx, wz);
        if (wantShow ? vis : !vis){ entity.x = c2w(cx); entity.z = c2w(cz); break; }
      }
      entity.g.visible = true;
      entity.timer = Math.max(3.5, 9 - collected * 0.9);
      if (d < 13) AudioSys.scrape();
    }
  } else if (entity.state === 'hunt'){
    entity.timer -= dt;
    if (!entity.path || entity.pathI >= entity.path.length || (entity.repath = (entity.repath || 0) + dt) > 0.6){
      entity.repath = 0;
      const sx = Math.floor(entity.x / CELL + GRID / 2), sz = Math.floor(entity.z / CELL + GRID / 2);
      const tx = Math.floor(player.x / CELL + GRID / 2), tz = Math.floor(player.z / CELL + GRID / 2);
      entity.path = bfs(sx, sz, tx, tz); entity.pathI = 1;
    }
    if (entity.path && entity.pathI < entity.path.length){
      const [cx, cz] = entity.path[entity.pathI];
      const tx = c2w(cx), tz = c2w(cz);
      const dx = tx - entity.x, dz = tz - entity.z, dd = Math.hypot(dx, dz);
      const sp = 1.5 + collected * 0.4;
      if (dd < 0.12) entity.pathI++;
      else { entity.x += dx / dd * sp * dt; entity.z += dz / dd * sp * dt; }
    }
    if (entity.timer <= 0){ entity.state = 'lurk'; entity.timer = Math.max(3, 7 - collected * 0.6); }
  }

  // face the player, gentle bob
  entity.g.position.set(entity.x, Math.sin(performance.now() / 700) * 0.03, entity.z);
  entity.g.rotation.y = Math.atan2(player.x - entity.x, player.z - entity.z);

  if (d < 1.15 && state === 'PLAYING') die();

  // dread model
  const prox = Math.max(0, 1 - d / 15);
  const target = Math.min(1, collected / 6 * 0.35 + prox * 0.75 + (seen ? 0.25 : 0));
  dread += (target - dread) * Math.min(1, dt * 1.5);
  if (seen && d < 12) shake = Math.min(1, shake + dt * 2); else shake = Math.max(0, shake - dt * 1.4);
}

/* ---------------- frame loop ---------------- */
const grainEl = document.getElementById('grain');
const grainCv = document.createElement('canvas'); grainCv.width = grainCv.height = 128;
const grainCtx = grainCv.getContext('2d');
let grainTick = 0;

function drawGrain(){
  const img = grainCtx.createImageData(128, 128);
  for (let i = 0; i < img.data.length; i += 4){
    const v = (Math.random() * 255) | 0;
    img.data[i] = img.data[i+1] = img.data[i+2] = v; img.data[i+3] = 255;
  }
  grainCtx.putImageData(img, 0, 0);
  grainEl.style.backgroundImage = `url(${grainCv.toDataURL()})`;
}

const clock = new THREE.Clock();
let promptShown = '';

function frame(){
  requestAnimationFrame(frame);
  const dt = Math.min(0.05, clock.getDelta());

  if (state === 'PLAYING'){
    elapsed = (performance.now() - startT) / 1000;

    // movement
    const run = keys['ShiftLeft'] || keys['ShiftRight'];
    const sp = run ? 4.5 : 2.6;
    let mx = 0, mz = 0;
    if (keys['KeyW']) mz -= 1; if (keys['KeyS']) mz += 1;
    if (keys['KeyA']) mx -= 1; if (keys['KeyD']) mx += 1;
    if (mx || mz){
      const l = Math.hypot(mx, mz); mx /= l; mz /= l;
      const s = Math.sin(player.yaw), c = Math.cos(player.yaw);
      player.x += (mx * c + mz * s) * sp * dt;
      player.z += (mz * c - mx * s) * sp * dt;
      player.stride += sp * dt;
      if (player.stride > (run ? 1.9 : 1.4)){ player.stride = 0; AudioSys.step(run ? 0.14 : 0.08); }
      player.bob += dt * (run ? 11 : 7.5);
    } else player.bob *= 0.9;
    collide();

    updateEntity(dt);

    // camera
    const bobY = Math.sin(player.bob) * 0.028;
    const shX = (Math.random() - 0.5) * 0.01 * shake, shY = (Math.random() - 0.5) * 0.01 * shake;
    camera.position.set(player.x + shX, EYE + bobY + shY, player.z);
    camera.rotation.set(0, 0, 0);
    camera.rotateY(player.yaw); camera.rotateX(player.pitch);

    // lamp follows view, flickers with dread
    const fw = new THREE.Vector3(); camera.getWorldDirection(fw);
    lamp.position.copy(camera.position);
    lampTarget.position.copy(camera.position).addScaledVector(fw, 6);
    lampFlicker = Math.max(0, lampFlicker - dt);
    if (dread > 0.62 && Math.random() < 0.02) lampFlicker = 0.12 + Math.random() * 0.2;
    lamp.intensity = lampOn ? (lampFlicker > 0 ? 190 * Math.random() : 190) : 0;

    // pages bob
    for (const p of pages){
      if (p.taken) continue;
      p.group.position.y += Math.sin(performance.now() / 900 + p.phase) * 0.0009;
      p.group.rotation.y += dt * 0.4;
    }

    // motes drift around player
    const mp = motes.geometry.attributes.position;
    for (let i = 0; i < mp.count; i++){
      let y = mp.getY(i) + dt * 0.05;
      if (y > 3) y = 0;
      mp.setY(i, y);
      const dx = mp.getX(i) - player.x, dz = mp.getZ(i) - player.z;
      if (Math.abs(dx) > 20) mp.setX(i, player.x - Math.sign(dx) * 19);
      if (Math.abs(dz) > 20) mp.setZ(i, player.z - Math.sign(dz) * 19);
    }
    mp.needsUpdate = true;

    // heartbeat + whispers
    beatTimer -= dt;
    if (beatTimer <= 0){
      const rate = 0.9 + dread * 1.5;
      AudioSys.thump(0.05 + dread * 0.16);
      setTimeout(() => AudioSys.thump(0.03 + dread * 0.1), 140);
      beatTimer = 1 / rate;
    }
    whisperTimer -= dt;
    if (whisperTimer <= 0){ if (dread > 0.3) AudioSys.whisper(); whisperTimer = 2 + Math.random() * (7 - dread * 5); }

    // prompts
    let txt = '';
    if (nearestPage()) txt = 'e — take the page';
    else if (nearDoor()) txt = collected >= 6 ? 'e — open the door' : 'sealed — six pages';
    if (txt !== promptShown){ promptShown = txt; promptEl.textContent = txt; promptEl.style.opacity = txt ? 1 : 0; }

    // atmosphere layers
    vignetteEl.style.opacity = 0.75 + dread * 0.25;
    grainEl.style.opacity = 0.045 + dread * 0.07;
    if (++grainTick % 3 === 0) drawGrain();
  }

  renderer.render(scene, camera);
}

/* ---------------- auto / test mode ---------------- */
if (AUTO){
  addEventListener('load', () => {
    startGame();
    const pose = Q.get('pose');
    if (pose === 'aisle'){ player.x = c2w(12); player.z = c2w(10); player.yaw = 0; }
    if (pose === 'reading'){ player.x = c2w(12); player.z = c2w(21); player.yaw = 0; }
    if (pose === 'entity'){
      player.x = c2w(12); player.z = c2w(14); player.yaw = 0;
      entity.x = c2w(12); entity.z = c2w(6); entity.g.visible = true;
    }
    if (pose === 'door'){ player.x = c2w(DOOR_CX); player.z = c2w(DOOR_CZ - 2); player.yaw = Math.PI; }
    window.__ready = false;
    setTimeout(() => { window.__ready = true; }, 1500);
    if (Q.has('selftest')){
      const R = [];
      // bfs sanity: path from spawn to a far stacks cell
      const path = bfs(DOOR_CX, DOOR_CZ - 2, 4, 4);
      R.push(['bfs_spawn_to_stacks', path ? path.length : null]);
      // death test: drop the librarian on the player
      entity.x = player.x; entity.z = player.z; entity.g.visible = true; entity.state = 'hunt'; entity.path = null;
      setTimeout(() => {
        R.push(['death_state', state]);
        // win test: fresh run, collect all pages, open door
        startGame();
        R.push(['pages_placed', pages.length]);
        for (const q of pages){ player.x = q.group.position.x; player.z = q.group.position.z; interact(); }
        R.push(['collected', collected]);
        player.x = c2w(DOOR_CX); player.z = c2w(DOOR_CZ) - 0.9; interact();
        R.push(['final_state', state]);
        R.push(['door_open', doorOpen]);
        console.log('SELFTEST ' + JSON.stringify(R));
      }, 800);
    }
  });
}

frame();
