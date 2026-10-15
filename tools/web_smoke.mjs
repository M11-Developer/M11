// ============================================================================
// اختبار دخاني بلا متصفح: يبني DOM وهميًا كافيًا ثم يشغّل main.js كاملًا
// (تحميل الأصول + القوائم + مباراة قصيرة بالبوتات) ويرسم إطارات حقيقية إلى PNG.
// ============================================================================
import napiCanvas from '@napi-rs/canvas';
const { createCanvas, Image } = napiCanvas;
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = '/home/user/M11';
const WEB = path.join(ROOT, 'web');
process.chdir(WEB);   // حتى تُحلّ مسارات "assets/..." النسبية كما في المتصفح
const resolvePath = (v) => {
  if (typeof v !== 'string') return null;
  if (v.startsWith('file:')) return new URL(v).pathname;
  if (path.isAbsolute(v)) return v;
  if (v.startsWith('assets/')) return path.join(WEB, 'assets', v.slice(7));
  return path.join(WEB, v);
};

// ---------------------------------------------------------------- DOM وهمي
const rafQueue = [];
const listeners = new Map();
const elements = new Map();

function makeEl(tag, id) {
  if (tag === 'canvas') {
    const c = createCanvas(640, 360);
    c.style = {};
    c.getBoundingClientRect = () => ({ left: 0, top: 0, width: c.width, height: c.height });
    c.addEventListener = () => {};
    c.removeEventListener = () => {};
    c.toDataURL = () => '';
    return c;
  }
  const el = {
    tagName: tag, id, style: {}, children: [], textContent: '', className: '',
    classList: { add() {}, remove() {}, contains: () => false, toggle() {} },
    appendChild(c) { this.children.push(c); return c; },
    removeChild() {}, addEventListener() {}, removeEventListener() {},
    getContext: () => null, setAttribute() {}, getAttribute: () => null,
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 0, height: 0 }),
    focus() {}, blur() {}, click() {},
  };
  return el;
}

globalThis.window = globalThis;
globalThis.document = {
  hidden: false,
  createElement: (tag) => makeEl(tag),
  getElementById(id) {
    if (!elements.has(id)) elements.set(id, makeEl(id === 'game' ? 'canvas' : 'div', id));
    return elements.get(id);
  },
  querySelector: () => null,
  addEventListener: (t, fn) => { (listeners.get(t) || listeners.set(t, []).get(t) || listeners.get(t)).push(fn); },
  removeEventListener: () => {},
  body: makeEl('body'),
  documentElement: makeEl('html'),
};
globalThis.Image = Image;
globalThis.addEventListener = (t, fn) => { if (!listeners.has(t)) listeners.set(t, []); listeners.get(t).push(fn); };
globalThis.removeEventListener = () => {};
globalThis.requestAnimationFrame = (cb) => { rafQueue.push(cb); return rafQueue.length; };
globalThis.cancelAnimationFrame = () => {};
globalThis.localStorage = (() => {
  const m = new Map();
  return {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => m.set(k, String(v)),
    removeItem: (k) => m.delete(k),
    clear: () => m.clear(),
    get length() { return m.size; },
  };
})();
globalThis.performance = globalThis.performance || { now: () => Date.now() };
globalThis.innerWidth = 1280;
globalThis.innerHeight = 720;
globalThis.devicePixelRatio = 1;
try {
  Object.defineProperty(globalThis, 'navigator', {
    value: { userAgent: 'node', vibrate: () => {}, getGamepads: () => [], maxTouchPoints: 0 },
    configurable: true, writable: true,
  });
} catch (e) { /* موجود مسبقًا */ }
globalThis.prompt = (msg, def) => def || 'مقاتل';
globalThis.Blob = globalThis.Blob || class { constructor() {} };
globalThis.URL.createObjectURL = () => 'blob:test';
globalThis.WebSocket = class { constructor() { throw new Error('no ws'); } };
globalThis.AudioContext = class {
  constructor() { this.destination = {}; this.currentTime = 0; }
  createGain() { return { connect() {}, gain: { value: 1 }, disconnect() {} }; }
  createDynamicsCompressor() { return { connect() {}, threshold: {}, knee: {}, ratio: {} }; }
  createBufferSource() { return { connect() {}, start() {}, stop() {}, buffer: null, playbackRate: {}, loop: false }; }
  createPanner() { return { connect() {}, positionX: {}, positionY: {}, positionZ: {} }; }
  createBiquadFilter() { return { connect() {}, frequency: {}, Q: {}, type: '' }; }
  createAnalyser() { return { connect() {}, fftSize: 256, frequencyBinCount: 128, getByteFrequencyData() {} }; }
  createStereoPanner() { return { connect() {}, pan: {} }; }
  createConvolver() { return { connect() {}, buffer: null }; }
  createBuffer() { return { getChannelData: () => new Float32Array(64), length: 64, numberOfChannels: 1, sampleRate: 44100 }; }
  decodeAudioData(buf, ok) { ok && ok({ getChannelData: () => new Float32Array(64), length: 64, numberOfChannels: 1, duration: 0.1, sampleRate: 44100 }); return Promise.resolve(); }
  resume() { return Promise.resolve(); }
  get state() { return 'running'; }
};
globalThis.fetch = async (url) => {
  const p = resolvePath(url);
  if (!p || !fs.existsSync(p)) return { ok: false, status: 404, json: async () => ({}), arrayBuffer: async () => new ArrayBuffer(0) };
  const buf = fs.readFileSync(p);
  return {
    ok: true, status: 200,
    json: async () => JSON.parse(buf.toString('utf8')),
    arrayBuffer: async () => buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength),
    text: async () => buf.toString('utf8'),
    headers: { get: () => null },
  };
};

// ---------------------------------------------------------------- التشغيل
const errors = [];
process.on('uncaughtException', (e) => { errors.push(e); console.error('!! uncaught', e.message); });
process.on('unhandledRejection', (e) => { errors.push(e); console.error('!! unhandled', e && e.message); });

const main = await import(path.join(WEB, 'src/main.js'));
const game = globalThis.__M11;
console.log('booted. state =', game.state);

// انتظر انتهاء boot
for (let i = 0; i < 200 && game.state === 'loading'; i++) await new Promise((r) => setTimeout(r, 25));
console.log('after boot: state =', game.state, '| atlases:', game.renderer ? 'ok' : 'MISSING');

// اختبر القوائم
if (game.menus) {
  const items = game.menus.cur.items();
  console.log('main menu rows:', items.length, '| first:', items[0].label);
  // تنقّل
  game.menus.key('ArrowDown');
  game.menus.key('ArrowUp');
  // افتح الإعدادات ثم ارجع
  game.menus.push('settings');
  console.log('settings rows:', game.menus.cur.items().length);
  game.menus.key('Escape');
  game.menus.push('lan');
  console.log('lan rows:', game.menus.cur.items().length);
  game.menus.key('Escape');
}

// ابدأ مباراة بالبوتات وارسم
game.settings.botCount = 7;
game.settings.quality = 2;
const SEED = parseInt(process.env.M11_SEED || '12345', 10);
game.startMatch({ mode: process.env.M11_MODE || 'tdm', warmup: 0, seed: SEED });
console.log('seed:', SEED);
console.log('match started. actors:', game.world.actors.length, 'mode:', game.world.modeId);
const dt = 1 / 60;
const FRAMES = Math.max(60, parseInt(process.argv[2] || '480', 10) || 480);
const shotFrames = new Set([60, 200, Math.min(420, FRAMES)]);
let simErrors = 0;
let dmgEvents = 0;
const origTakeDamage = game.world.actors[0].constructor.prototype.takeDamage;
game.world.actors[0].constructor.prototype.takeDamage = function (...args) { dmgEvents++; return origTakeDamage.apply(this, args); };
for (let i = 1; i <= FRAMES; i++) {
  try {
    game.updatePlaying(dt);
  } catch (e) {
    simErrors++;
    if (simErrors < 4) console.error('frame', i, 'error:', e.message, '\n', (e.stack || '').split('\n').slice(1, 4).join('\n'));
  }
  game.input.endFrame();
  if (process.env.M11_DEBUG && i % 300 === 0) {
    const a0 = game.world.actors;
    console.log(`  f${i}:`, a0.map((a) => `${a.name.slice(0, 6)}@${a.cx.toFixed(0)},${a.cy.toFixed(0)} v=${a.vx.toFixed(0)},${a.vy.toFixed(0)} g=${a.grounded ? 1 : 0} hp${a.hp | 0} st=${a.ai ? a.ai.state : '-'}`).join(' | '));
  }
  if (shotFrames.has(i)) {
    const cv = game.renderer.main.canvas;
    fs.writeFileSync(`/tmp/game_${i}.png`, cv.toBuffer('image/png'));
  }
}
const totalKills = game.world.actors.reduce((s, a) => s + a.kills, 0);
const totalShots = game.world.actors.reduce((s, a) => s + a.shotsFired, 0);
const alive = game.world.actors.filter((a) => a.alive).length;
if (process.env.M11_DEBUG) {
  const w = game.world;
  const M = w.level.map;
  console.log('map tiles:', M.w, 'x', M.h, '| TS:', 32, '| px:', M.w * 32, 'x', M.h * 32);
  const actors = w.actors;
  const xs = actors.map((x) => x.cx);
  const ys = actors.map((x) => x.cy);
  const x0 = Math.max(0, Math.floor((Math.min(...xs) - 160) / 32));
  const x1 = Math.min(M.w - 1, Math.ceil((Math.max(...xs) + 160) / 32));
  const y0 = Math.max(0, Math.floor((Math.min(...ys) - 220) / 32));
  const y1 = Math.min(M.h - 1, Math.ceil((Math.max(...ys) + 120) / 32));
  console.log(`slice cols ${x0}..${x1} rows ${y0}..${y1}`);
  let header = '     ';
  for (let tx = x0; tx <= x1; tx++) header += (tx % 10 === 0 ? String(Math.floor(tx / 10) % 10) : '.');
  console.log(header);
  for (let ty = y0; ty <= y1; ty++) {
    let row = String(ty).padStart(4, ' ');
    for (let tx = x0; tx <= x1; tx++) {
      const v = M.get(tx, ty);
      row += v === 0 ? '.' : (M.isSolid(tx, ty) ? '#' : '=');
    }
    const marks = actors.filter((x) => x.cy >= ty * 32 && x.cy < (ty + 1) * 32).map((x) => `${x.name.slice(0, 6)}@${(x.cx / 32).toFixed(1)}`);
    console.log(row, marks.join(' '));
  }
  for (const x of actors) console.log(`  ${x.name.slice(0, 10)} t${x.team} @${(x.cx / 32).toFixed(1)},${(x.cy / 32).toFixed(1)} v=${x.vx.toFixed(0)},${x.vy.toFixed(0)} g=${x.grounded ? 1 : 0} hp=${x.hp | 0}`);
}
console.log('sim errors:', simErrors);
console.log('kills:', totalKills, '| shots:', totalShots,
  '| accuracy:', totalShots ? (totalKills / totalShots * 100).toFixed(1) + '%' : 'n/a',
  '| damage events:', dmgEvents,
  '| particles:', game.renderer.particles.list.length,
  '| alive:', alive + '/' + game.world.actors.length,
  '| matchState:', game.world.matchState);
// معدّل القتل لكل دقيقة — مقياس «شراسة البوتات» الحقيقي
const mins = FRAMES / 3600;
console.log('kills/min:', mins > 0 ? (totalKills / mins).toFixed(1) : 'n/a',
  '| frames:', FRAMES);
console.log('exceptions captured:', errors.length);
if (errors.length) console.log(errors.slice(0, 3).map((e) => e && e.message).join(' | '));
