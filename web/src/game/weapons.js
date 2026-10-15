// ============================================================================
// الأسلحة — 27 سلاحًا + ملحقات + نظام إطلاق (Hitscan / Projectile)
// القسم 6: لكل سلاح جدول إحصائيات كامل، ارتداد ثابت قابل للتعلّم، ملحقات، ندرة، وزن.
// أسماء الأسلحة أصلية (غير تجارية) — القاعدة 8 في القسم 23.
// ============================================================================

import { clamp, TAU, RNG } from '../core/math.js';

export const ATTACHMENTS = {
  sight_iron: { nameAr: 'منظار حديدي', slot: 'sight', zoom: 1.0, spread: 1.0, rarity: 'common' },
  sight_dot: { nameAr: 'نقطة حمراء', slot: 'sight', zoom: 1.05, spread: 0.92, rarity: 'uncommon' },
  sight_x2: { nameAr: 'منظار 2×', slot: 'sight', zoom: 1.35, spread: 0.95, rarity: 'rare' },
  sight_x4: { nameAr: 'منظار 4×', slot: 'sight', zoom: 1.75, spread: 1.0, rarity: 'epic' },
  sight_x8: { nameAr: 'منظار 8×', slot: 'sight', zoom: 2.4, spread: 1.05, rarity: 'legendary' },
  muzzle_brake: { nameAr: 'مُعوّض ارتداد', slot: 'muzzle', recoil: 0.72, spread: 0.95, rarity: 'uncommon' },
  muzzle_suppressor: { nameAr: 'كاتم صوت', slot: 'muzzle', recoil: 0.85, spread: 0.98, quiet: 0.35, rarity: 'rare' },
  muzzle_flash: { nameAr: 'مخفي الفلاش', slot: 'muzzle', recoil: 0.9, spread: 0.9, rarity: 'uncommon' },
  grip_vertical: { nameAr: 'قبضة أمامية', slot: 'grip', spreadMove: 0.7, recoil: 0.9, rarity: 'uncommon' },
  grip_angled: { nameAr: 'قبضة مائلة', slot: 'grip', spreadMove: 0.8, adsSpeed: 1.2, rarity: 'uncommon' },
  mag_extended: { nameAr: 'مخزن موسّع', slot: 'mag', magMul: 1.5, reload: 1.15, rarity: 'rare' },
  mag_drum: { nameAr: 'مخزن أسطواني', slot: 'mag', magMul: 2.4, reload: 1.4, weight: 1.15, rarity: 'epic' },
  laser: { nameAr: 'مؤشر ليزر', slot: 'laser', spread: 0.9, hipFire: 0.75, rarity: 'rare' },
  stock_tactical: { nameAr: 'مثبّت', slot: 'stock', recoil: 0.85, spreadMove: 0.85, rarity: 'uncommon' },
  bipod_folded: { nameAr: 'أرجل ثنائية', slot: 'stock', proneSpread: 0.55, rarity: 'rare' },
};

export const ATTACHMENT_SLOTS = {
  sight: 'منظار', muzzle: 'فوهة', grip: 'قبضة', mag: 'مخزن', laser: 'ليزر', stock: 'مخبّئ',
};

// جداول الأسلحة — كل رقم مقصود لتوازن اللعب
export const WEAPONS = {
  // --- مسدسات
  n9: { nameAr: 'نصل 9', cls: 'pistol', body: 22, head: 46, rpm: 400, mag: 15, reload: 1.6, spread: 1.6,
    spreadMove: 3.2, spreadJump: 5.5, recoil: { v: 1.1, h: 0.35, recover: 8 }, speed: 0, range: 780,
    falloff: 0.55, pen: 0, rarity: 'common', weight: 0.5, pellets: 1, sound: 'pistol', slots: ['sight', 'muzzle', 'mag', 'laser'] },
  scorpion: { nameAr: 'عقرب', cls: 'pistol', auto: true, body: 17, head: 36, rpm: 900, mag: 20, reload: 1.9,
    spread: 2.4, spreadMove: 3.6, spreadJump: 6, recoil: { v: 0.7, h: 0.5, recover: 10 }, speed: 0, range: 720,
    falloff: 0.5, pen: 0, rarity: 'uncommon', weight: 0.6, pellets: 1, sound: 'pistol', slots: ['sight', 'muzzle', 'mag', 'laser'] },
  handcannon: { nameAr: 'مدفع اليد', cls: 'pistol', body: 52, head: 105, rpm: 120, mag: 6, reload: 2.4,
    spread: 1.2, spreadMove: 4.5, spreadJump: 7, recoil: { v: 4.6, h: 0.8, recover: 5 }, speed: 0, range: 900,
    falloff: 0.6, pen: 1, rarity: 'rare', weight: 1.1, pellets: 1, sound: 'pistol', slots: ['sight', 'muzzle', 'laser'] },
  // --- رشاشات خفيفة
  zarqa: { nameAr: 'زرقة', cls: 'smg', auto: true, body: 18, head: 37, rpm: 850, mag: 30, reload: 2.0,
    spread: 2.0, spreadMove: 2.6, spreadJump: 5, recoil: { v: 1.0, h: 0.6, recover: 11 }, speed: 0, range: 760,
    falloff: 0.55, pen: 0, rarity: 'uncommon', weight: 0.9, pellets: 1, sound: 'smg', slots: ['sight', 'muzzle', 'grip', 'mag', 'laser', 'stock'] },
  harrasa: { nameAr: 'هرّاسة', cls: 'smg', auto: true, body: 21, head: 43, rpm: 750, mag: 25, reload: 2.1,
    spread: 2.2, spreadMove: 3.0, spreadJump: 5.5, recoil: { v: 1.3, h: 0.7, recover: 10 }, speed: 0, range: 740,
    falloff: 0.5, pen: 0, rarity: 'common', weight: 0.85, pellets: 1, sound: 'smg', slots: ['sight', 'muzzle', 'mag', 'laser'] },
  timsah: { nameAr: 'تمساح', cls: 'smg', auto: true, body: 24, head: 49, rpm: 700, mag: 32, reload: 2.3,
    spread: 1.8, spreadMove: 2.4, spreadJump: 4.6, recoil: { v: 1.2, h: 0.55, recover: 11 }, speed: 0, range: 820,
    falloff: 0.55, pen: 1, rarity: 'rare', weight: 1.0, pellets: 1, sound: 'smg', slots: ['sight', 'muzzle', 'grip', 'mag', 'laser', 'stock'] },
  // --- بنادق هجومية
  jabha: { nameAr: 'جبهة', cls: 'ar', auto: true, body: 32, head: 66, rpm: 600, mag: 30, reload: 2.4,
    spread: 1.3, spreadMove: 2.4, spreadJump: 5.2, recoil: { v: 1.9, h: 0.7, recover: 9 }, speed: 0, range: 1300,
    falloff: 0.7, pen: 1, rarity: 'uncommon', weight: 1.4, pellets: 1, sound: 'ar', slots: ['sight', 'muzzle', 'grip', 'mag', 'laser', 'stock'] },
  fahd: { nameAr: 'فهد', cls: 'ar', auto: true, body: 34, head: 70, rpm: 640, mag: 30, reload: 2.3,
    spread: 1.25, spreadMove: 2.2, spreadJump: 5.0, recoil: { v: 1.85, h: 0.62, recover: 9.5 }, speed: 0, range: 1350,
    falloff: 0.72, pen: 1, rarity: 'rare', weight: 1.45, pellets: 1, sound: 'ar', slots: ['sight', 'muzzle', 'grip', 'mag', 'laser', 'stock'] },
  saqr: { nameAr: 'صقر', cls: 'ar', auto: true, body: 30, head: 62, rpm: 700, mag: 30, reload: 2.2,
    spread: 1.35, spreadMove: 2.0, spreadJump: 4.8, recoil: { v: 1.6, h: 0.55, recover: 10 }, speed: 0, range: 1280,
    falloff: 0.68, pen: 1, rarity: 'rare', weight: 1.3, pellets: 1, sound: 'ar', slots: ['sight', 'muzzle', 'grip', 'mag', 'laser', 'stock'] },
  raad: { nameAr: 'رعد', cls: 'ar', auto: true, body: 38, head: 78, rpm: 520, mag: 40, reload: 3.1,
    spread: 1.5, spreadMove: 2.8, spreadJump: 5.8, recoil: { v: 2.4, h: 0.8, recover: 8 }, speed: 0, range: 1400,
    falloff: 0.75, pen: 2, rarity: 'epic', weight: 1.9, pellets: 1, sound: 'ar', slots: ['sight', 'muzzle', 'grip', 'mag', 'laser', 'stock'] },
  // --- قنص
  shaheen: { nameAr: 'شاهين', cls: 'sr', body: 78, head: 165, rpm: 48, mag: 5, reload: 3.4,
    spread: 0.25, spreadMove: 6, spreadJump: 9, recoil: { v: 6.5, h: 1.1, recover: 4 }, speed: 0, range: 2200,
    falloff: 0.98, pen: 3, rarity: 'epic', weight: 2.4, pellets: 1, sound: 'sr', scope: 2.4,
    slots: ['sight', 'muzzle', 'mag', 'laser', 'stock'] },
  uqab: { nameAr: 'عقاب', cls: 'sr', auto: false, body: 62, head: 130, rpm: 75, mag: 10, reload: 2.8,
    spread: 0.4, spreadMove: 5.2, spreadJump: 8, recoil: { v: 4.8, h: 0.9, recover: 5 }, speed: 0, range: 1900,
    falloff: 0.95, pen: 2, rarity: 'rare', weight: 2.1, pellets: 1, sound: 'sr', scope: 1.75,
    slots: ['sight', 'muzzle', 'grip', 'mag', 'laser', 'stock'] },
  thuban: { nameAr: 'ثعبان', cls: 'sr', body: 95, head: 200, rpm: 38, mag: 5, reload: 4.0,
    spread: 0.15, spreadMove: 7, spreadJump: 10, recoil: { v: 8, h: 1.4, recover: 3.2 }, speed: 1400,
    projectile: true, range: 2600, falloff: 1.0, pen: 4, rarity: 'legendary', weight: 3.1, pellets: 1,
    sound: 'sr', scope: 3.0, slots: ['sight', 'muzzle', 'mag', 'laser', 'stock'] },
  // --- شوزن
  mitraqa: { nameAr: 'مطرقة', cls: 'shotgun', body: 16, head: 26, rpm: 70, mag: 6, reload: 3.2,
    spread: 5.5, spreadMove: 3, spreadJump: 5, recoil: { v: 5.5, h: 1.2, recover: 4 }, speed: 0, range: 520,
    falloff: 0.28, pen: 0, rarity: 'uncommon', weight: 1.9, pellets: 9, sound: 'shotgun',
    slots: ['sight', 'muzzle', 'mag', 'laser', 'stock'] },
  muzdawija: { nameAr: 'مزدوجة', cls: 'shotgun', body: 20, head: 32, rpm: 150, mag: 2, reload: 2.6,
    spread: 4.2, spreadMove: 3.2, spreadJump: 5.5, recoil: { v: 6.5, h: 1.4, recover: 3.4 }, speed: 0, range: 560,
    falloff: 0.3, pen: 0, rarity: 'rare', weight: 2.0, pellets: 10, sound: 'shotgun', slots: ['sight', 'laser'] },
  ali: { nameAr: 'آلي الرش', cls: 'shotgun', auto: true, body: 13, head: 22, rpm: 220, mag: 8, reload: 3.6,
    spread: 6.5, spreadMove: 3.4, spreadJump: 6, recoil: { v: 3.4, h: 1.0, recover: 6 }, speed: 0, range: 480,
    falloff: 0.25, pen: 0, rarity: 'epic', weight: 2.3, pellets: 8, sound: 'shotgun',
    slots: ['sight', 'muzzle', 'grip', 'mag', 'laser', 'stock'] },
  // --- رشاشات ثقيلة
  minjal: { nameAr: 'منجل', cls: 'lmg', auto: true, body: 36, head: 72, rpm: 700, mag: 75, reload: 5.2,
    spread: 2.0, spreadMove: 3.6, spreadJump: 6.5, recoil: { v: 1.7, h: 0.9, recover: 7 }, speed: 0, range: 1500,
    falloff: 0.8, pen: 2, rarity: 'epic', weight: 3.4, pellets: 1, sound: 'lmg',
    slots: ['sight', 'muzzle', 'grip', 'laser', 'stock'] },
  jarrar: { nameAr: 'جرّار', cls: 'lmg', auto: true, body: 42, head: 84, rpm: 600, mag: 100, reload: 6.4,
    spread: 2.2, spreadMove: 4.0, spreadJump: 7, recoil: { v: 2.0, h: 1.0, recover: 6 }, speed: 0, range: 1600,
    falloff: 0.82, pen: 2, rarity: 'legendary', weight: 4.2, pellets: 1, sound: 'lmg',
    slots: ['sight', 'muzzle', 'grip', 'laser', 'stock'] },
  // --- طاقة
  shuaa: { nameAr: 'شعاع', cls: 'energy', auto: true, body: 28, head: 58, rpm: 900, mag: 40, reload: 2.6,
    spread: 1.0, spreadMove: 2.2, spreadJump: 4.4, recoil: { v: 0.6, h: 0.5, recover: 12 }, speed: 1500,
    projectile: true, range: 1600, falloff: 1.0, pen: 1, rarity: 'epic', weight: 1.2, pellets: 1, sound: 'energy',
    energy: true, slots: ['sight', 'grip', 'mag', 'laser'] },
  najm: { nameAr: 'نجم البلازما', cls: 'energy', body: 62, head: 130, rpm: 130, mag: 12, reload: 3.0,
    spread: 0.6, spreadMove: 4, spreadJump: 7, recoil: { v: 2.6, h: 0.8, recover: 6 }, speed: 1100,
    projectile: true, range: 2000, falloff: 0.95, pen: 2, rarity: 'legendary', weight: 2.0, pellets: 1,
    sound: 'energy', energy: true, splash: 42, slots: ['sight', 'muzzle', 'mag', 'laser'] },
  // --- قاذفات
  burkan: { nameAr: 'بركان', cls: 'launcher', body: 90, head: 90, rpm: 45, mag: 4, reload: 4.2,
    spread: 1.5, spreadMove: 4, spreadJump: 6, recoil: { v: 5, h: 1, recover: 4 }, speed: 620,
    projectile: true, gravity: true, splash: 96, splashDamage: 110, range: 1400, falloff: 1, pen: 0,
    rarity: 'epic', weight: 3.8, pellets: 1, sound: 'launcher', slots: ['sight', 'laser'] },
  zilzal: { nameAr: 'زلزال', cls: 'launcher', body: 140, head: 140, rpm: 28, mag: 2, reload: 5.4,
    spread: 1.0, spreadMove: 5, spreadJump: 7, recoil: { v: 7, h: 1.2, recover: 3 }, speed: 520,
    projectile: true, gravity: true, splash: 150, splashDamage: 170, range: 1800, falloff: 1, pen: 0,
    rarity: 'legendary', weight: 5.0, pellets: 1, sound: 'launcher', slots: ['sight', 'laser'] },
  qadifa: { nameAr: 'قاذفة شظايا', cls: 'launcher', body: 34, head: 60, rpm: 90, mag: 6, reload: 3.4,
    spread: 2.0, spreadMove: 3, spreadJump: 5, recoil: { v: 2.4, h: 0.8, recover: 7 }, speed: 800,
    projectile: true, gravity: true, splash: 62, splashDamage: 58, bounce: true, range: 1200, falloff: 1,
    pen: 0, rarity: 'epic', weight: 2.6, pellets: 1, sound: 'launcher', slots: ['sight', 'grip', 'mag'] },
  // --- إشارة ومشاجرة
  shama: { nameAr: 'شمعة إشارة', cls: 'pistol', body: 14, head: 14, rpm: 100, mag: 1, reload: 1.2,
    spread: 2, spreadMove: 4, spreadJump: 6, recoil: { v: 1, h: 0.4, recover: 8 }, speed: 500,
    projectile: true, flare: true, splash: 40, splashDamage: 24, burn: 12, range: 1200, falloff: 1,
    pen: 0, rarity: 'common', weight: 0.4, pellets: 1, sound: 'pistol', slots: [] },
  shafra: { nameAr: 'شفرة', cls: 'melee', body: 55, head: 110, rpm: 120, mag: 0, reload: 0, spread: 0,
    meleeRange: 34, meleeArc: 1.2, rarity: 'common', weight: 0.6, sound: 'melee', slots: [] },
  fas: { nameAr: 'فأس', cls: 'melee', body: 75, head: 150, rpm: 80, mag: 0, reload: 0, spread: 0,
    meleeRange: 38, meleeArc: 1.0, rarity: 'uncommon', weight: 1.2, sound: 'melee', slots: [] },
  minjal_melee: { nameAr: 'منجل قتال', cls: 'melee', body: 62, head: 124, rpm: 140, mag: 0, reload: 0,
    spread: 0, meleeRange: 36, meleeArc: 1.4, rarity: 'rare', weight: 0.8, sound: 'melee', slots: [] },
  hirrawa: { nameAr: 'هراوة', cls: 'melee', body: 48, head: 86, rpm: 100, mag: 0, reload: 0, spread: 0,
    meleeRange: 42, meleeArc: 1.1, rarity: 'common', weight: 1.0, sound: 'melee', slots: [] },
};

export const GUN_GAME_LADDER = [
  'n9', 'scorpion', 'zarqa', 'harrasa', 'timsah', 'mitraqa', 'jabha', 'fahd', 'uqab',
  'minjal', 'raad', 'shuaa', 'shaheen', 'shafra',
];

export const RARITY_ORDER = ['common', 'uncommon', 'rare', 'epic', 'legendary', 'mythic'];

export function isMelee(id) {
  return WEAPONS[id] && WEAPONS[id].cls === 'melee';
}

/** إحصائيات السلاح بعد تطبيق الملحقات */
export function resolveStats(id, attachments = []) {
  const base = WEAPONS[id];
  if (!base) return null;
  const st = {
    ...base,
    magSize: base.mag || 0,
    recoilV: base.recoil ? base.recoil.v : 0,
    recoilH: base.recoil ? base.recoil.h : 0,
    recoilRecover: base.recoil ? base.recoil.recover : 8,
    fireDelay: base.rpm > 0 ? 60 / base.rpm : 1,
  };
  for (const a of attachments) {
    const at = ATTACHMENTS[a];
    if (!at) continue;
    if (at.magMul) st.magSize = Math.round(st.magSize * at.magMul);
    if (at.recoil) { st.recoilV *= at.recoil; st.recoilH *= at.recoil; }
    if (at.spread) st.spread *= at.spread;
    if (at.spreadMove) st.spreadMove = (st.spreadMove || st.spread) * at.spreadMove;
    if (at.zoom) st.zoom = at.zoom;
    if (at.weight) st.weight *= at.weight;
    if (at.quiet) st.quiet = true;
    if (at.hipFire) st.hipFireBonus = at.hipFire;
    if (at.proneSpread) st.proneSpread = at.proneSpread;
  }
  return st;
}

export const DEFAULT_ATTACHMENTS = {
  ar: ['sight_dot', 'muzzle_brake', 'grip_vertical', 'mag_extended'],
  smg: ['sight_dot', 'muzzle_suppressor', 'grip_angled'],
  sr: ['sight_x4', 'muzzle_brake', 'bipod_folded'],
  lmg: ['sight_x2', 'muzzle_brake', 'grip_vertical'],
  shotgun: ['sight_dot', 'laser'],
  pistol: ['sight_dot', 'mag_extended'],
  energy: ['sight_dot', 'laser'],
  launcher: ['sight_iron'],
  melee: [],
};

/** اختبار الرصاص (Hitscan) — أسرع وأدق من الأجسام الفيزيائية */
export function hitscan(level, entities, x0, y0, angle, range, opts = {}) {
  const steps = Math.ceil(range / 6);
  const dx = Math.cos(angle), dy = Math.sin(angle);
  const pen = opts.pen || 0;
  const hits = [];
  let x = x0, y = y0;
  let remainingPen = pen;
  for (let i = 1; i <= steps; i++) {
    x = x0 + dx * i * 6;
    y = y0 + dy * i * 6;
    if (level.map.isSolidAt(x, y)) {
      return { x, y, dist: i * 6, entities: hits, blocked: true };
    }
    for (const e of entities) {
      if (!e.alive || e.hp <= 0 || e === opts.shooter) continue;
      if (opts.isHostile && !opts.isHostile(e)) continue;
      if (opts.ignoreTeam != null && e.team === opts.ignoreTeam && !opts.friendlyFire) continue;
      if (x >= e.x && x <= e.x + e.w && y >= e.y && y <= e.y + e.h) {
        hits.push({ entity: e, x, y });
        if (remainingPen-- <= 0) return { x, y, dist: i * 6, entities: hits, blocked: false };
      }
    }
  }
  return { x, y, dist: range, entities: hits, blocked: false };
}

/** ارتداد تراكمي بنمط ثابت قابل للتعلّم لكل سلاح (Pattern) */
export function recoilOffset(shotIndex, weaponId) {
  const rng = new RNG(hashStr(weaponId));
  const pattern = [];
  let hx = 0, vy = 0;
  const w = WEAPONS[weaponId];
  const magSize = Math.max(1, (w && w.mag) || 20);
  for (let i = 0; i < magSize; i++) {
    const t = i / magSize;
    vy -= 0.55 + t * 0.9 + rng.range(-0.08, 0.08);
    hx += (i % 5 < 2 ? 1 : -1) * (0.28 + t * 0.5) + rng.range(-0.12, 0.12);
    pattern.push({ x: hx, y: vy });
  }
  return pattern[Math.min(shotIndex, pattern.length - 1)];
}

function hashStr(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

/** حساب زاوية الانتشار الحالية حسب حالة اللاعب */
export function currentSpread(state, weapon, shotIndex) {
  let s = weapon.spread;
  if (state.prone) s *= (weapon.proneSpread || 0.55);
  else if (state.crouch) s *= 0.8;
  if (state.grounded === false) s *= weapon.spreadJump || 4;
  else if (Math.abs(state.vx) > 30) s *= weapon.spreadMove || 2.5;
  if (state.ads) s *= 0.6;
  s *= 1 + Math.min(2.2, shotIndex * 0.06);   // تراكم الرش
  return s * (Math.PI / 180) * 0.55;          // تحويل من درجات إلى انحراف فعلي
}

/** ضرر الرصاصة مع السقوط بالمسافة + مضاعف الرأس */
export function bulletDamage(weapon, dist, isHead, target) {
  let dmg = isHead ? weapon.head : weapon.body;
  const falloffStart = (weapon.range || 1200) * 0.45;
  if (dist > falloffStart) {
    const t = clamp((dist - falloffStart) / ((weapon.range || 1200) - falloffStart), 0, 1);
    dmg *= 1 - t * (1 - (weapon.falloff || 0.7));
  }
  if (isHead) dmg *= 1.0;
  // الدرع يخفّض الضرر حسب مستواه
  if (target && target.armor > 0) {
    const armorAbsorb = [0, 0.18, 0.3, 0.42][clamp(target.armorLevel || 1, 0, 3)];
    const absorbed = dmg * armorAbsorb;
    target.armor = Math.max(0, target.armor - absorbed * 0.6);
    dmg -= absorbed;
  }
  return dmg;
}
