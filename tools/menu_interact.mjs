// ============================================================================
// اختبار تفاعل القوائم باللمس — بلا متصفح (نفس حزمة DOM الوهمية في menu_shot).
// يتحقق من الأخطاء التي شكا منها المستخدم على الهاتف:
//   ١) زر الرجوع العلوي يرجع فعلاً من أي شاشة فرعية.
//   ٢) شاشة الإيقاف: زر الرجوع يستأنف المباراة (لا يترك اللعبة معلّقة).
//   ٣) لمس صف عادي ينفّذه (كانت القوائم تعمل بالكيبورد فقط).
//   ٤) لمس صف الاختيار يبدّل قيمته (كان يحتاج أسهم لوحة مفاتيح).
// أي فشل ⇒ رمز خروج غير صفري.
// ============================================================================
import napiCanvas from '@napi-rs/canvas';
const { createCanvas } = napiCanvas;
import fs from 'node:fs';
import path from 'node:path';
import { atlasNames } from './atlas_names.mjs';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const WEB = path.join(ROOT, 'web');

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
globalThis.Image = napiCanvas.Image;
const resolvePath = (v) => {
  if (v.startsWith('assets/')) return path.join(ROOT, 'project', v);
  if (path.isAbsolute(v)) return v;
  return path.join(WEB, v);
};
globalThis.fetch = async (url) => {
  const p = resolvePath(url);
  const txt = fs.readFileSync(p, 'utf8');
  return { ok: true, json: async () => JSON.parse(txt), text: async () => txt };
};

const { Assets, CONFIG } = await import(path.join(WEB, 'src/core/assets.js'));
const { MenuSystem } = await import(path.join(WEB, 'src/game/ui.js'));
Assets.base = path.join(ROOT, 'project/assets/atlases') + '/';
await Assets.load(atlasNames());

let resumed = 0;
const game = {
  canvas: { width: CONFIG.internalWidth, height: CONFIG.internalHeight },
  state: 'menu',
  settings: { quality: 0 },
  controls: {},
  profile: { name: 'لاعب' },
  audioSettings: {},
  audio: null,
  controls_: null,
  startMatch() {}, resume() { resumed++; }, pause() {},
  saveSettings() {}, saveControls() {}, applyQuality() {}, applyColorblind() {},
  openEditor() {}, rebuildTouchButtons() {}, updateTouchVisibility() {},
  primaryOptions: () => [], secondaryOptions: () => [],
  progression: { profile: { achievements: [] }, challenges: [] },
};

const menus = new MenuSystem(Assets, game);
const ctx = createCanvas(CONFIG.internalWidth, CONFIG.internalHeight).getContext('2d');
const fail = (m) => { console.error('  ✘ ' + m); process.exit(1); };

// ١) زر الرجوع العلوي
menus.push('settings');
menus.update(1 / 60, null);
menus.draw(ctx, game.settings);
menus.onPointerDown(20, 18);
menus.onPointerUp(20, 18);
if (menus.current.name !== 'main') fail('زر الرجوع العلوي لا يرجع للرئيسية');
console.log('  ✔ زر الرجوع العلوي: settings → main');

// ٢) الإيقاف: الرجوع يستأنف
menus.push('pause');
menus.update(1 / 60, null);
menus.draw(ctx, game.settings);
menus.onPointerDown(20, 18);
menus.onPointerUp(20, 18);
if (resumed !== 1) fail('زر الاستئناف في شاشة الإيقاف لا يعمل');
console.log('  ✔ شاشة الإيقاف: زر الرجوع استأنف المباراة');

// ٣) لمس صف الاختيار يبدّل القيمة
menus.home();
menus.push('settings');
menus.update(1 / 60, null);
menus.draw(ctx, game.settings);
const rows = menus.rowsFor(menus.current);
const choiceRow = rows.find((r) => r.item && r.item.type === 'choice');
if (!choiceRow) fail('لم أجد صف اختيار في الإعدادات');
const before = choiceRow.item.get();
menus.onPointerDown(choiceRow.rect.x + 30, choiceRow.rect.y + 10);
menus.onPointerUp(choiceRow.rect.x + 30, choiceRow.rect.y + 10);
if (choiceRow.item.get() === before) fail('لمس صف الاختيار لا يغيّر القيمة');
console.log(`  ✔ لمس صف الاختيار: ${JSON.stringify(before)} → ${JSON.stringify(choiceRow.item.get())}`);

// ٤) لمس السلايدر يضبط النسبة مباشرة
const sliderRow = rows.find((r) => r.item && r.item.type === 'slider');
if (!sliderRow) fail('لم أجد صف سلايدر في الإعدادات');
const sv = sliderRow.item.get();
menus.onPointerDown(sliderRow.rect.x + 8 + 48, sliderRow.rect.y + 10);
menus.onPointerUp(sliderRow.rect.x + 8 + 48, sliderRow.rect.y + 10);
if (sliderRow.item.get() === sv) fail('لمس السلايدر لا يغيّر القيمة');
console.log(`  ✔ لمس السلايدر: ${sv} → ${sliderRow.item.get()}`);

// ٥) التنقّل بالأسهم يصل إلى صف الرجوع الأخير وينفّذه
menus.home();
menus.push('credits');
menus.update(1 / 60, null);
const rows2 = menus.rowsFor(menus.current);
const backIdx = rows2.length - 1;
if (!rows2[backIdx] || rows2[backIdx].item.type !== 'back') fail('صف الرجوع غير موجود في نهاية القائمة');
menus.current.index = backIdx;
menus.key('Enter');
if (menus.current.name !== 'main') fail('Enter على صف الرجوع لا يعمل');
console.log('  ✔ لوحة المفاتيح: Enter على صف «رجوع» يرجع للرئيسية');

console.log('✔ كل تفاعلات اللمس تعمل');
