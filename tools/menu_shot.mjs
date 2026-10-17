// ============================================================================
// أداة تصوير القوائم بلا متصفح — ترسم شاشات القائمة الحقيقية إلى PNG.
// الغرض: التحقق البصري من المصغّرات والبورتريهات ولوحات النتائج قبل البناء.
// الاستخدام: node tools/menu_shot.mjs <screen> <index> <out.png> [--results-win|--results-lose]
//   screen: main | maps | operators | stats | modes | lan
// ============================================================================
import napiCanvas from '@napi-rs/canvas';
const { createCanvas } = napiCanvas;
import fs from 'node:fs';
import path from 'node:path';
import { atlasNames } from './atlas_names.mjs';

const ROOT = '/home/user/M11';
const WEB = path.join(ROOT, 'web');
const screenName = process.argv[2] || 'maps';
const index = parseInt(process.argv[3] || '0', 10);
const out = process.argv[4] || '/tmp/menu_shot.png';
const flags = process.argv.slice(2);
const winMode = flags.includes('--results-win');
const loseMode = flags.includes('--results-lose');

// --- محاكاة DOM بالحد الأدنى (نفس أسلوب web_shot.mjs) ---
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

const { Assets, CONFIG } = await import(path.join(WEB, 'src/core/assets.js'));
const { MenuSystem } = await import(path.join(WEB, 'src/game/ui.js'));
const { loadBackdrops, backdropImages } = await import(path.join(WEB, 'src/render/renderer.js'));
const { MODES } = await import(path.join(WEB, 'src/game/modes.js'));
const { MAPS } = await import(path.join(WEB, 'src/game/world.js'));
const { DEFAULT_CONTROLS: requireControls } = await import(path.join(WEB, 'src/core/input.js'));

Assets.base = path.join(ROOT, 'project/assets/atlases') + '/';
await Assets.load(atlasNames());
const charMeta = await Assets.loadJson('characters_meta.json');
await loadBackdrops(Assets, (n) => console.warn('لوحة مفقودة:', n));

// كائن لعبة مبدئي — يكفي لرسم القوائم (لا محاكاة هنا)
const game = {
  canvas: { width: CONFIG.internalWidth, height: CONFIG.internalHeight },
  state: 'menu',
  settings: {
    map: 'oil_rig', opKey: Object.keys(charMeta.operators)[0], quality: 2, language: 'ar',
    skinIndex: 0, loadout: ['jabha', 'n9'], throwable: 'grenade', difficulty: 2, bots: 7,
  },
  primaryOptions: () => ['jabha', 'n9', 'rasa'],
  secondaryOptions: () => ['n9', 'jabha'],
  // نفس شكل الحفظ الحقيقي: الإنجازات خريطة، والإحصاءات بالمفاتيح الصحيحة
  profile: {
    name: 'لاعب', level: 7, xp: 3200,
    stats: { kills: 128, deaths: 42, matches: 30, wins: 9, revives: 4, assists: 12,
      longestKill: 640, shotsFired: 2400, shotsHit: 900 },
    achievements: { first_blood: 1, kills_10: 1, win_1: 1 },
    weaponKills: {}, weaponShots: {},
  },
  progression: {
    level: 7, rank: { key: 'sergeant', nameAr: 'رقيب', xp: 6800 },
    profile: {
      achievements: { first_blood: 1, kills_10: 1, win_1: 1 },
      challenges: {
        daily: [{ id: 'd_kills', nameAr: 'اقتل 15 عدوًا', target: 15, progress: 12, done: false }],
        weekly: [{ id: 'w_kills', nameAr: 'اقتل 100 عدوًا', target: 100, progress: 100, done: true }],
      },
    },
  },
  audioSettings: { master: 0.8, music: 0.6, sfx: 0.9, voice: 0.8 },
  controls: (() => {
    // نأخذ قيم التحكم الحقيقية من اللعبة نفسها حتى تعكس الصور الواقع
    const defaults = {};
    try {
      const dc = requireControls;
      Object.assign(defaults, dc);
    } catch (e) { /* نكمل بالافتراضي */ }
    return { joystickMode: 'floating', ...defaults };
  })(),
  saveSettings() {}, startMatch() {}, openEditor() {},
  applyQuality() {}, applyAudio() {}, applyColorblind() {}, pause() {},
};

const canvas = createCanvas(CONFIG.internalWidth, CONFIG.internalHeight);
const ctx = canvas.getContext('2d');
const menus = new MenuSystem(Assets, game);
menus.stack.length = 0;
// الرئيسية أولًا (السياق الحقيقي: شاشة رئيسية ثم شاشة فرعية)
menus.push('main');
if (winMode || loseMode) {
  // شاشة النتائج الحقيقية تأتي من HUD: نرسمها مع لوحة النصر/الهزيمة
  const { HUD } = await import(path.join(WEB, 'src/game/hud.js'));
  const hud = new HUD(Assets);
  hud.assets = Assets;
  const results = {
    reason: 'score', duration: 254, teams: [winMode ? 30 : 14, winMode ? 18 : 30],
    standings: [
      { id: 1, name: 'أنت', team: 0, kills: winMode ? 22 : 9, deaths: winMode ? 7 : 18, assists: 4, headshots: 6, accuracy: 31, damage: 4210, placement: winMode ? 1 : 3, isBot: false, longestKill: 42 },
      { id: 2, name: 'بوت ٣', team: 1, kills: 18, deaths: 11, assists: 2, headshots: 4, accuracy: 24, damage: 3120, placement: 2, isBot: true, longestKill: 31 },
      { id: 3, name: 'بوت ١', team: 0, kills: 12, deaths: 14, assists: 6, headshots: 3, accuracy: 19, damage: 2480, placement: 3, isBot: true, longestKill: 22 },
    ],
  };
  globalThis.__results = results;
  globalThis.__hud = hud;
  results.won = !!winMode;
  results.teamMode = true;
  var resultsDraw = (c) => hud.drawResults(c, results, {
    mode: 'tdm', map: 'docks', xp: { xp: 820, level: 8, leveled: true },
    achievements: [{ nameAr: 'أول دم' }, { nameAr: 'قنّاص' }],
  });
} else {
  // نبدأ من الرئيسية ثم ندفع الشاشة المطلوبة حتى تظهر عناصر الرجوع كما في اللعب الحقيقي
  if (screenName !== 'main') menus.push(screenName);
  menus.current.index = index;
  // نُمرّر القائمة حتى يظهر الصف المختار (يثبت أن التمرير التلقائي يعمل)
  menus.ensureVisible();
}

const input = { mouse: { x: -50, y: -50, down: false, wheel: 0 } };
const noop = { update() {} };
// update() يُنقص تلاشي الدخول — بدونه تبقى كل الشاشة معتمة بنسبة 55%
for (let i = 0; i < 90; i++) {
  input.mouse.wheel = 0;
  menus.update(1 / 60, input);
  ctx.fillStyle = '#05070A';
  ctx.fillRect(0, 0, CONFIG.internalWidth, CONFIG.internalHeight);
  if (globalThis.__results) resultsDraw(ctx); else menus.draw(ctx, game.settings);
  await new Promise((r) => setTimeout(r, 12));
}
// نمنح تحميل الصور فرصة أخيرة ثم نرسم الإطار النهائي
for (let i = 0; i < 40; i++) {
  ctx.fillStyle = '#05070A';
  ctx.fillRect(0, 0, CONFIG.internalWidth, CONFIG.internalHeight);
  if (globalThis.__results) resultsDraw(ctx); else menus.draw(ctx, game.settings);
  await new Promise((r) => setTimeout(r, 15));
}
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, canvas.toBuffer('image/png'));
const imgs = menus._imgs ? [...menus._imgs.entries()].filter(([, v]) => v).length : 0;
console.log(`✔ ${out} — الشاشة: ${winMode ? 'نتائج (فوز)' : loseMode ? 'نتائج (هزيمة)' : screenName + '#' + index}`);
console.log(`   لوحات محمّلة: ${backdropImages.size} | صور واجهة جاهزة: ${imgs} | خرائط: ${MAPS.length} | مشغلون: ${Object.keys(charMeta.operators).length}`);
