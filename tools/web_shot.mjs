// ============================================================================
// أداة تصوير بلا متصفح — تشغّل محاكاة اللعبة كاملة وترسم إطارات إلى PNG.
// تستخدم @napi-rs/canvas (Skia) لمحاكاة Canvas 2D في Node.
// الاستخدام: node tools/web_shot.mjs [mode] [frames] [outPrefix]
// ============================================================================
import napiCanvas from '@napi-rs/canvas';
const { createCanvas, loadImage } = napiCanvas;
import fs from 'node:fs';
import path from 'node:path';
import { atlasNames } from './atlas_names.mjs';

const ROOT = '/home/user/M11';
const WEB = path.join(ROOT, 'web');
const mode = process.argv[2] || 'dm';
const frames = parseInt(process.argv[3] || '600', 10);
const outPrefix = process.argv[4] || '/tmp/shot';
const mouse = { x: 0, y: 0 };

// --- محاكاة DOM بالحد الأدنى ---
globalThis.document = {
  createElement(tag) {
    if (tag === 'canvas') return createCanvas(1, 1);
    return { style: {}, appendChild() {}, addEventListener() {}, removeEventListener() {} };
  },
  getElementById: () => null,
  body: { appendChild() {}, style: {} },
  addEventListener() {}, removeEventListener() {},
};
globalThis.window = globalThis;
globalThis.performance = globalThis.performance || { now: () => Date.now() };
globalThis.requestAnimationFrame = (cb) => setTimeout(() => cb(performance.now()), 0);
globalThis.Image = napiCanvas.Image;
const resolvePath = (v) => {
  if (v.startsWith('file:')) return new URL(v).pathname;
  if (path.isAbsolute(v)) return v;
  if (v.startsWith('assets/')) return path.join(ROOT, 'project', v);
  return path.join(WEB, v);
};
globalThis.fetch = async (url) => {
  const p = resolvePath(url);
  const txt = fs.readFileSync(p, 'utf8');
  return { ok: true, json: async () => JSON.parse(txt), text: async () => txt };
};

const { GameWorld } = await import(path.join(WEB, 'src/game/game.js'));
const { Renderer, loadBackdrops, backdropImages } = await import(path.join(WEB, 'src/render/renderer.js'));
const { Camera } = await import(path.join(WEB, 'src/render/camera.js'));
const { Assets, CONFIG } = await import(path.join(WEB, 'src/core/assets.js'));
const { MODES } = await import(path.join(WEB, 'src/game/modes.js'));

// تحميل الأطالس من project/assets/atlases
Assets.base = path.join(ROOT, 'project/assets/atlases') + '/';
const names = atlasNames();
await Assets.load(names);
const charMeta = await Assets.loadJson('characters_meta.json');

const world = new GameWorld({ mode, seed: Number(process.argv[5] || 2024), warmup: 0, difficulty: 2, weather: process.argv[6] || 'clear' });
for (let i = 0; i < 9; i++) {
  const ops = Object.keys(charMeta.operators);
  world.addActor({ isBot: true, team: MODES[mode] && MODES[mode].teams > 1 ? i % 2 : 0, name: 'بوت' + i, difficulty: 2, seed: 500 + i, opKey: ops[i % ops.length] });
}
// لاعب اللعبة (يمثل الكاميرا)
const player = world.addActor({ team: 0, name: 'أنت', opKey: 'rashid', startWeapons: ['jabha', 'n9'] });
player.aimActive = true;

const canvas = createCanvas(CONFIG.internalWidth, CONFIG.internalHeight);
await loadBackdrops(Assets, (n) => console.warn('لوحة مفقودة:', n));
console.log('لوحات المنظر المحمّلة:', backdropImages.size, [...backdropImages.keys()].join(','));
const renderer = new Renderer(canvas, Assets);
// --hud: يرسم واجهة اللعب فوق المشهد للتحقق البصري من التخطيط
let hud = null;
if (process.argv.slice(2).includes('--hud')) {
  const { HUD } = await import(path.join(ROOT, 'web/src/game/hud.js'));
  hud = new HUD(Assets);
}
renderer.setLevel(world.level, charMeta);
renderer.weather = world.weather;
const cam = new Camera();
cam.setBounds(world.level);
const flags = process.argv.slice(2);
if (flags.includes('--no-light')) renderer.enableLighting = false;
if (flags.includes('--no-post')) renderer.enablePost = false;
if (flags.includes('--no-parallax')) renderer.enableParallax = false;
if (flags.includes('--no-entities')) renderer.enableEntities = false;

// نسخة مبسّطة من drawTouchControls (الأداة لا تشغّل main.js كاملًا)
function drawTouchPreview(ctx2, inp, S) {
  const TAU2 = Math.PI * 2;
  const glyph = { fire: '◎', jump: '↥', jetpack: '↟', reload: '⟳', crouch: '⌄', prone: '⌄⌄', melee: '✕', heal: '＋', grenade: '●', swap: '⇄', pause: '❚❚', score: '▣' };
  const label = { fire: 'إطلاق', jump: 'قفز', jetpack: 'جيت', reload: 'تعبئة', crouch: 'انخفاض', prone: 'انبطاح', melee: 'مشاجرة', heal: 'علاج', grenade: 'قنبلة', swap: 'بديل', pause: 'إيقاف', score: 'خريطة' };
  ctx2.save();
  ctx2.globalAlpha = S.buttonAlpha;
  for (const [name, b] of inp.buttons) {
    const big = name === 'fire';
    ctx2.beginPath();
    ctx2.arc(b.x, b.y, b.r, 0, TAU2);
    ctx2.fillStyle = big ? 'rgba(22,28,36,0.62)' : 'rgba(16,20,26,0.52)';
    ctx2.fill();
    ctx2.strokeStyle = big ? 'rgba(242,193,78,0.55)' : 'rgba(234,242,246,0.38)';
    ctx2.lineWidth = big ? 2 : 1.4;
    ctx2.stroke();
    ctx2.save();
    ctx2.globalAlpha = Math.min(1, S.buttonAlpha + 0.35);
    ctx2.font = `700 ${Math.round(b.r * 0.85)}px "Cairo", sans-serif`;
    ctx2.textAlign = 'center';
    ctx2.fillStyle = '#EAF2F6';
    if (b.r >= 14) ctx2.fillText(glyph[name] || '', b.x, b.y + 2);
    if (b.r < 15) { ctx2.restore(); continue; }
    const fs = Math.max(6, Math.min(8, Math.round(b.r * 0.5)));
    ctx2.font = `700 ${fs}px "Cairo", sans-serif`;
    // نفس منطق اللعبة: نُبعد التسمية عن الحواف، ونقلبها فوق الزر إن خرجت تحت الشاشة
    const txt = label[name] || '';
    const lw = ctx2.measureText(txt).width;
    const lx = Math.min(Math.max(b.x, lw / 2 + 2), CONFIG.internalWidth - lw / 2 - 2);
    const ly = b.y + b.r * 0.72 > CONFIG.internalHeight - 8 ? b.y - b.r - 1 : b.y + b.r * 0.72;
    ctx2.fillText(txt, lx, ly);
    ctx2.restore();
  }
  // العصا لا تُرسم وهي خاملة في اللعبة الحقيقية — لا نرسم حلقات وهمية هنا
  ctx2.restore();
}

const dt = 1 / 60;
const shots = [];
const shotAt = new Set([60, Math.floor(frames * 0.35), Math.floor(frames * 0.6), frames]);
let saved = 0;
for (let i = 1; i <= frames; i++) {
  // تحكم آلي بسيط للاعب: يتحرك ويرمي نار نحو أقرب عدو
  const enemy = world.findVisibleEnemy(player, 900);
  const cmd = { moveX: Math.sin(i / 90) > 0 ? 1 : -1, jump: i % 150 === 0, fire: false, jet: false };
  if (enemy) {
    const ang = Math.atan2(enemy.cy - player.cy, enemy.cx - player.cx);
    cmd.aimX = Math.cos(ang); cmd.aimY = Math.sin(ang); cmd.aimActive = true;
    cmd.fire = true; cmd.moveX = Math.abs(ang) > 1.8 ? (Math.cos(ang) > 0 ? 1 : -1) : 0;
  } else {
    cmd.aimX = Math.cos(i / 40); cmd.aimY = Math.sin(i / 60);
  }
  player.update(dt, world, cmd);
  world.update(dt);
  if (shotAt.has(i)) {
    // ثبّت اللاعب على الأرض لقطة تموضع جيدة (أداة تصوير فقط)
  const gy = world.level.groundH ? world.level.groundH(player.cx) : null;
  if (gy != null && player.y + player.h < gy - 6) {
    player.y = gy - player.h - 1;
    player.vy = 0;
    player.grounded = true;
  }
  cam.update(dt, player, { aimLead: 46 });
    renderer.draw(world, cam, player, dt);
    if (hud) {
      const ctx2 = canvas.getContext('2d');
      hud.settings = {};
      hud.update(dt);
      const touch = process.argv.slice(2).includes('--touch');
      hud.draw(ctx2, world, player, {
        renderer, cam, settings: { bigMinimap: false }, showTouchControls: touch,
      });
      if (touch) {
        // نفس حلقة رسم أزرار اللمس في اللعبة (لعرض التخطيط الحقيقي في اللقطة)
        const fakeInput = { buttons: new Map(), actions: {}, move: { active: false }, aim: { active: false } };
        const S = { stickAlpha: 0.55, buttonAlpha: 0.6, leftHanded: false };
        const W = CONFIG.internalWidth, H = CONFIG.internalHeight;
        const add = (name, x, y, r) => fakeInput.buttons.set(name, { x, y, r });
        add('fire', W - 68, H - 58, 26); add('jump', W - 128, H - 62, 16);
        add('reload', W - 126, H - 100, 15); add('melee', W - 88, H - 124, 15);
        add('jetpack', W - 50, H - 116, 16); add('crouch', W - 18, H - 56, 13);
        add('prone', W - 16, H - 88, 13); add('grenade', W - 34, H - 22, 12);
        add('heal', W - 110, H - 24, 12); add('swap', W - 138, H - 30, 12);
        add('pause', W - 14, 14, 10); add('score', W - 38, 14, 10);
        drawTouchPreview(ctx2, fakeInput, S);
      }
    }
    const out = `${outPrefix}_${mode}_${i}.png`;
    fs.writeFileSync(out, canvas.toBuffer('image/png'));
    shots.push(out);
    saved++;
  } else {
    cam.update(dt, player);
  }
}
console.log('shots:', shots.join(' '));
console.log('cam', Math.round(cam.x), Math.round(cam.y), 'player', Math.round(player.x), Math.round(player.y), 'screen', Math.round(player.cx - cam.left), Math.round(player.cy - cam.top));
console.log('actors on screen:', world.actors.filter(a => a.alive).map(a => [a.opKey, Math.round(a.cx - cam.left), Math.round(a.cy - cam.top)]).slice(0, 5));
console.log('kills', world.actors.reduce((s, a) => s + a.kills, 0), 'shots', world.actors.reduce((s, a) => s + a.shotsFired, 0), 'particles', renderer.particles.list.length, 'chunks', renderer.debug.chunks, 'pickups', world.pickups.filter(p=>p.active).length);
