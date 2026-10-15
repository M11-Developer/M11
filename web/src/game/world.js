// ============================================================================
// العالم: توليد الخرائط + التايل ماب + التصادم + العناصر التفاعلية
// القسم 9 من دفتر المشروع: 8 خرائط + محرر خرائط + عناصر قابلة للتدمير.
// ============================================================================

import { CONFIG } from '../core/assets.js';
import { RNG, clamp, rectOverlap } from '../core/math.js';

export const TS = CONFIG.tile;

// أنواع التايلات
export const T = {
  EMPTY: 0,
  SOLID: 1,        // صلب (أرض/جدار)
  TOP: 2,          // صلب مع سطح مرئي (عشب/رمل أعلى الأرض)
  PLATFORM: 3,     // منصة تُخترق من الأسفل (One-way)
  CRATE: 4,        // صندوق خشبي قابل للتدمير
  GLASS: 5,        // زجاج ينكسر
  SANDBAG: 6,      // كيس رمل يتآكل
  LADDER: 7,       // سلّم
  WATER: 8,        // ماء (يبطئ + انعكاس)
  HAZARD: 9,       // منطقة سامة
  BACK: 10,        // جدار خلفي (لا يُصادم — عمق بصري)
  SLOPE_R: 11,
  SLOPE_L: 12,
  GIRDER: 13,      // سطح قابل للانهيار (يتحول إلى فراغ بعد وقوف طويل)
  BARREL: 14,      // برميل متفجر (كيان)
};

export const SOLID_TILES = new Set([T.SOLID, T.TOP, T.CRATE, T.GLASS, T.SANDBAG, T.SLOPE_R, T.SLOPE_L, T.GIRDER]);
export const DESTRUCTIBLE = { [T.CRATE]: 60, [T.GLASS]: 15, [T.SANDBAG]: 90, [T.GIRDER]: 140 };

let tileSeq = 0;

// ---------------------------------------------------------------- تعريف الخرائط
export const MAPS = [
  {
    id: 'oasis', nameAr: 'الواحة المحروقة', theme: 'desert', size: 'medium',
    w: 3200, h: 1000, mode: ['dm', 'tdm', 'gun', 'sniper', 'melee'], weather: 'sandstorm',
    time: 'sunset', desc: 'واحة جفّت بعد معركة طويلة — أرض مفتوحة ومبانٍ طينية قليلة.',
    layout: { platforms: 12, buildings: 2, crates: 26, trees: 5, water: 1 },
  },
  {
    id: 'port', nameAr: 'الميناء الحجري', theme: 'forest', size: 'small',
    w: 2400, h: 900, mode: ['dm', 'tdm', 'ctf', 'snd'], weather: 'clear',
    time: 'day', desc: 'أرصفة ومستودعات متلاصقة — قتال قريب وسريع.',
    layout: { platforms: 14, buildings: 3, crates: 30, containers: 8, water: 1 },
  },
  {
    id: 'nightbase', nameAr: 'القاعدة الليلية', theme: 'base', size: 'medium',
    w: 3000, h: 1100, mode: ['dm', 'tdm', 'snd', 'kotc', 'survival'], weather: 'rain',
    time: 'night', desc: 'قاعدة محصّنة تحت المطر — أنفاق ومصابيح انسدادية.',
    layout: { platforms: 16, buildings: 3, crates: 24, tunnels: 2, lamps: 8 },
  },
  {
    id: 'village', nameAr: 'القرية الطينية', theme: 'village', size: 'small',
    w: 2600, h: 950, mode: ['dm', 'tdm', 'infection', 'melee'], weather: 'clear',
    time: 'morning', desc: 'بيوت طينية وأسطح متراصة — حرب أسطح لا تنتهي.',
    layout: { platforms: 12, buildings: 5, crates: 22, trees: 8 },
  },
  {
    id: 'ruinedcity', nameAr: 'المدينة المدمرة', theme: 'city', size: 'medium',
    w: 3400, h: 1200, mode: ['dm', 'tdm', 'ctf', 'gun', 'vip'], weather: 'clear',
    time: 'dusk', desc: 'شوارع مهدّمة ومبانٍ مرتفعة — أفضل خريطة للقنص من الأسطح.',
    layout: { platforms: 18, buildings: 4, crates: 28, rubble: 14 },
  },
  {
    id: 'factory', nameAr: 'المصنع', theme: 'base', size: 'small',
    w: 2200, h: 850, mode: ['dm', 'tdm', 'gun', 'kotc'], weather: 'clear',
    time: 'day', desc: 'خطوط إنتاج وأحزمة ناقلة — خريطة مضغوطة للتعارك المباشر.',
    layout: { platforms: 10, buildings: 2, crates: 20, conveyors: 3, hazards: 2 },
  },
  {
    id: 'darkforest', nameAr: 'الغابة المظلمة', theme: 'forest', size: 'medium',
    w: 3100, h: 1150, mode: ['dm', 'tdm', 'infection', 'survival'], weather: 'fog',
    time: 'night', desc: 'أشجار كثيفة ورؤية محدودة — الرعب الحقيقي هنا.',
    layout: { platforms: 14, buildings: 2, crates: 18, trees: 20 },
  },
  {
    id: 'bridge', nameAr: 'الجسر الطويل', theme: 'city', size: 'large',
    w: 4200, h: 1000, mode: ['dm', 'tdm', 'ctf', 'br', 'tournament'], weather: 'clear',
    time: 'day', desc: 'جسر ممتد بين ضفتين — لا مكان للاختباء.',
    layout: { platforms: 20, buildings: 3, crates: 24, bridge: true },
  },
  {
    id: 'valleys', nameAr: 'الوديان الكبرى', theme: 'desert', size: 'br',
    w: 6000, h: 1400, mode: ['br', 'survival', 'tournament'], weather: 'day_night',
    time: 'day', desc: 'خريطة Battle Royale كاملة: أودية، مصنع مهجور، وقرية.',
    layout: { platforms: 30, buildings: 6, crates: 60, trees: 18, water: 2, lootNodes: 26 },
  },
];

export const MAP_BY_ID = Object.fromEntries(MAPS.map((m) => [m.id, m]));

// ---------------------------------------------------------------- التايل ماب
export class TileMap {
  constructor(w, h, fill = T.EMPTY) {
    this.w = w;
    this.h = h;
    this.data = new Uint8Array(w * h).fill(fill);
    this.hp = new Map();        // خريطة الصحة للتايلات القابلة للتدمير
    this.dirty = true;
    this.miniDirty = true;
    this.minimap = null;
    this.id = ++tileSeq;
  }
  idx(x, y) { return y * this.w + x; }
  get(x, y) {
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return T.SOLID;   // خارج الحدود = صلب
    return this.data[y * this.w + x];
  }
  getSafe(x, y) {
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return T.EMPTY;
    return this.data[y * this.w + x];
  }
  set(x, y, v) {
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return;
    this.data[y * this.w + x] = v;
    if (DESTRUCTIBLE[v]) this.hp.set(this.idx(x, y), DESTRUCTIBLE[v]);
    this.dirty = true;
    this.miniDirty = true;
  }
  isSolid(x, y) {
    return SOLID_TILES.has(this.get(x, y));
  }
  isPlatform(x, y) {
    return this.get(x, y) === T.PLATFORM;
  }
  /** يتعامل مع التايلات المائلة: نصف صلب أعلى المنحدر */
  isSolidAt(px, py) {
    const tx = Math.floor(px / TS), ty = Math.floor(py / TS);
    const t = this.get(tx, ty);
    if (t === T.SLOPE_R || t === T.SLOPE_L) {
      const fx = (px - tx * TS) / TS, fy = (py - ty * TS) / TS;
      const surface = t === T.SLOPE_R ? fx : 1 - fx;
      return fy >= surface;
    }
    return SOLID_TILES.has(t);
  }
  /** يدمّر تايلًا (يعيد true إن تدمّر فعلًا) */
  damage(x, y, amount) {
    const i = this.idx(x, y);
    if (!this.hp.has(i)) return false;
    const left = this.hp.get(i) - amount;
    if (left <= 0) {
      this.hp.delete(i);
      this.data[i] = T.EMPTY;
      this.dirty = true;
      this.miniDirty = true;
      return true;
    }
    this.hp.set(i, left);
    return false;
  }
  /** انفجار: يدمّر ما حول المركز بنصف قطر */
  explode(cx, cy, radius, power = 45) {
    const r = Math.ceil(radius / TS);
    const tx = Math.floor(cx / TS), ty = Math.floor(cy / TS);
    const broken = [];
    for (let y = ty - r; y <= ty + r; y++) {
      for (let x = tx - r; x <= tx + r; x++) {
        const d = Math.hypot((x - tx) * TS, (y - ty) * TS);
        if (d > radius) continue;
        if (this.hp.has(this.idx(x, y))) {
          if (this.damage(x, y, power * (1 - d / radius * 0.6))) broken.push([x, y]);
        }
      }
    }
    return broken;
  }
  /** شعاع لخط النظر (LOS) — للتصويب وكتم الصوت والإضاءة */
  raycast(x0, y0, x1, y1, maxDist = 3000) {
    const dx = x1 - x0, dy = y1 - y0;
    const len = Math.hypot(dx, dy);
    if (len < 1) return { hit: false, t: 0, x: x1, y: y1 };
    const steps = Math.min(400, Math.ceil(Math.min(len, maxDist) / 8));
    const sx = dx / steps, sy = dy / steps;
    let x = x0, y = y0;
    for (let i = 0; i < steps; i++) {
      x += sx; y += sy;
      if (this.isSolidAt(x, y)) {
        return { hit: true, t: i / steps, x, y, tx: Math.floor(x / TS), ty: Math.floor(y / TS) };
      }
    }
    return { hit: false, t: 1, x: x1, y: y1 };
  }
}

// ---------------------------------------------------------------- التوليد
/** يولّد خريطة كاملة من تعريفها (نفس البذرة = نفس الخريطة لكل اللاعبين) */
export function generateMap(def, seed = 12345) {
  const rng = new RNG(seed + def.id.length * 977);
  const w = Math.ceil(def.w / TS), h = Math.ceil(def.h / TS);
  const map = new TileMap(w, h);
  const props = [];
  const lootNodes = [];
  const spawns = [];
  const vehicles = [];
  const layout = def.layout || {};
  const groundBase = h - 5;

  // 1) خط الأرض الأساسي (تلال ناعمة)
  const heights = new Array(w);
  let hh = groundBase;
  for (let x = 0; x < w; x++) {
    const n = rng.fbm(x * 1.7, 0, 3, 0.06);
    hh = groundBase - Math.round(2 + n * 7);
    heights[x] = clamp(hh, 6, groundBase);
  }
  // تسطيح مناطق البناء لتفادي منحدرات حادة
  const flatZones = [];
  const buildingCount = layout.buildings || 3;
  for (let b = 0; b < buildingCount; b++) {
    const bw = rng.int(8, 16);
    const bx = Math.floor(rng.range(4, w - bw - 4));
    flatZones.push([bx - 2, bx + bw + 2]);
  }
  if (layout.bridge) flatZones.push([0, w]);
  for (const [a, b] of flatZones) {
    const target = heights[clamp(a, 0, w - 1)];
    for (let x = a; x <= b && x < w; x++) if (x >= 0) heights[x] = target;
  }
  // 2) تعبئة الأرض
  for (let x = 0; x < w; x++) {
    const gy = Math.max(5, heights[x]);
    for (let y = gy; y < h - 1; y++) {
      map.set(x, y, y === gy ? T.TOP : T.SOLID);
    }
  }
  // 3) مبانٍ: غرف بجدران وسقف وأبواب
  for (let b = 0; b < buildingCount; b++) {
    const bw = rng.int(9, 18);
    const bh = rng.int(5, 10);
    const bx = Math.floor(rng.range(3, w - bw - 3));
    const by = clamp(heights[bx] - bh - 1, 3, h - 4);
    for (let x = bx; x < bx + bw; x++) {
      for (let y = by; y < by + bh; y++) {
        const edge = x === bx || x === bx + bw - 1 || y === by || y === by + bh - 1;
        if (edge) map.set(x, y, T.SOLID);
        else map.set(x, y, y > by + 1 ? T.BACK : T.EMPTY);
      }
    }
    // أبواب (فتحات في الأسفل) ونوافذ
    const doors = rng.int(1, 3);
    for (let d = 0; d < doors; d++) {
      const dx = bx + rng.int(2, bw - 3);
      map.set(dx, by + bh - 1, T.EMPTY);
      map.set(dx, by + bh - 2, T.EMPTY);
      if (rng.chance(0.4)) { map.set(dx, by + bh - 3, T.EMPTY); map.set(dx, by + bh - 1, T.EMPTY); }
    }
    for (let k = 0; k < 2; k++) {
      if (rng.chance(0.6)) {
        const wx = bx + rng.int(1, bw - 2);
        map.set(wx, by + 1, T.GLASS);
      }
    }
    // سطح علوي + صندوق
    const roofY = by - 1;
    if (roofY > 2) {
      for (let x = bx; x < bx + bw; x++) map.set(x, roofY, T.TOP);
      props.push({ type: 'crate', x: (bx + 1) * TS, y: roofY * TS - 28, v: rng.int(0, 1) });
      if (rng.chance(0.5)) props.push({ type: 'sandbag', x: (bx + bw - 3) * TS, y: roofY * TS - 26 });
    }
    lootNodes.push({ x: (bx + bw / 2) * TS, y: (by + bh - 2) * TS, tier: rng.chance(0.4) ? 2 : 1 });
    if (rng.chance(0.7)) lootNodes.push({ x: (bx + bw / 2) * TS, y: roofY * TS - 10, tier: 2 });
    spawns.push({ x: (bx + 2) * TS, y: roofY * TS - 40 });
  }
  // 4) منصّات معلّقة (One-way) — عمق رأسي ومسارات للجيت باك
  const platformCount = layout.platforms || 12;
  for (let p = 0; p < platformCount; p++) {
    const pw = rng.int(4, 11);
    const px = Math.floor(rng.range(2, w - pw - 2));
    const py = clamp(heights[px] - rng.int(3, 14), 5, h - 6);
    for (let x = px; x < px + pw; x++) {
      if (map.getSafe(x, py) === T.EMPTY) map.set(x, py, T.PLATFORM);
      if (rng.chance(0.12) && x > px) map.set(x, py - 1, T.CRATE);
    }
    if (rng.chance(0.5)) lootNodes.push({ x: (px + pw / 2) * TS, y: py * TS - 10, tier: 1 });
    if (rng.chance(0.35)) spawns.push({ x: (px + 1) * TS, y: py * TS - 40 });
  }
  // 5) أنفاق/ممرات أرضية
  for (let t = 0; t < (layout.tunnels || 0); t++) {
    const tw = rng.int(14, 26);
    const tx = Math.floor(rng.range(2, w - tw - 2));
    const ty = clamp(heights[tx] + rng.int(2, 5), 5, h - 3);
    for (let x = tx; x < tx + tw; x++) {
      for (let y = ty; y < ty + 3; y++) if (map.getSafe(x, y) !== T.EMPTY) map.set(x, y, T.EMPTY);
      if (map.getSafe(x, ty + 3) === T.EMPTY) map.set(x, ty + 3, T.SOLID);
    }
    lootNodes.push({ x: (tx + tw / 2) * TS, y: ty * TS, tier: 2 });
  }
  // 6) عناصر وأشجار ماء ومصابيح
  for (let i = 0; i < (layout.crates || 20); i++) {
    const x = rng.int(2, w - 3);
    const y = clamp(heights[x] - 1, 1, h - 2);
    const kind = rng.chance(0.12) ? 'barrel' : 'crate';
    props.push({ type: kind, x: x * TS, y: y * TS - 28, v: rng.int(0, 2), explosive: kind === 'barrel' && rng.chance(0.5) });
    if (rng.chance(0.25)) {
      const x2 = clamp(x + rng.int(-2, 2), 1, w - 2);
      props.push({ type: 'crate', x: x2 * TS, y: y * TS - 56, v: rng.int(0, 2) });
    }
  }
  for (let i = 0; i < (layout.trees || 0); i++) {
    const x = rng.int(2, w - 3);
    props.push({ type: rng.chance(0.6) ? 'tree' : 'bush', x: x * TS, y: heights[x] * TS - 30, v: rng.int(0, 2) });
  }
  for (let i = 0; i < (layout.lamps || 0); i++) {
    const x = rng.int(2, w - 3);
    props.push({ type: 'lamp', x: x * TS, y: heights[x] * TS - 32, light: true, v: 0 });
  }
  for (let i = 0; i < (layout.rubble || 0); i++) {
    const x = rng.int(2, w - 3);
    props.push({ type: 'rubble', x: x * TS, y: heights[x] * TS - 24, v: rng.int(0, 2) });
  }
  // براميل متفجرة قريبة من نقاط النهب (تفجير مفيد)
  for (const node of lootNodes) {
    if (rng.chance(0.25)) props.push({ type: 'barrel', x: node.x + 40, y: node.y, v: 1, explosive: true });
  }
  // 7) ماء
  for (let i = 0; i < (layout.water || 0); i++) {
    const ww = rng.int(10, 24);
    const wx = Math.floor(rng.range(3, w - ww - 3));
    const wy = heights[wx] + 1;
    for (let x = wx; x < wx + ww; x++) {
      for (let y = wy; y < wy + 3; y++) map.set(x, y, T.WATER);
    }
  }
  // 8) نقاط الظهور متباعدة
  const spawnTarget = def.size === 'br' ? 16 : 12;
  const step = Math.max(3, Math.floor(w / (spawnTarget + 1)));
  for (let i = 1; i <= spawnTarget; i++) {
    const x = i * step + rng.int(-2, 2);
    if (x >= w - 2) continue;
    spawns.push({ x: x * TS, y: (heights[clamp(x, 0, w - 1)] - 3) * TS });
  }
  // 9) نقاط النهب العامة + إسقاطات جوية + مركبات
  const lootTarget = layout.lootNodes || Math.round(w / 22);
  for (let i = 0; i < lootTarget; i++) {
    const x = rng.int(2, w - 3);
    lootNodes.push({ x: x * TS, y: (heights[x] - 1) * TS, tier: rng.chance(0.2) ? 3 : rng.chance(0.5) ? 2 : 1 });
  }
  for (let i = 0; i < Math.max(1, Math.round(w / 900)); i++) {
    const x = rng.int(6, w - 6);
    vehicles.push({ type: rng.pick(['mg', 'bike', 'drone']), x: x * TS, y: (heights[x] - 1) * TS });
  }
  // حدود العالم
  for (let y = 0; y < h; y++) {
    map.set(0, y, T.SOLID);
    map.set(w - 1, y, T.SOLID);
  }
  return {
    def, seed, map, props, lootNodes, spawns, vehicles, heights,
    width: w * TS, height: h * TS,
  };
}

/** يبني خريطة مصغّرة (Minimap) من التايل ماب — تُشتق آليًا ولا تُخزّن */
export function buildMinimap(level, scale = 3) {
  const m = level.map;
  const cw = Math.ceil(m.w / scale), ch = Math.ceil(m.h / scale);
  const canvas = document.createElement('canvas');
  canvas.width = cw;
  canvas.height = ch;
  const ctx = canvas.getContext('2d');
  const img = ctx.createImageData(cw, ch);
  const themeCol = {
    desert: [168, 130, 60], base: [90, 98, 110], city: [120, 124, 130],
    forest: [78, 107, 58], village: [110, 75, 35],
  }[level.def.theme] || [110, 110, 110];
  for (let y = 0; y < ch; y++) {
    for (let x = 0; x < cw; x++) {
      let solid = false, empty = false;
      for (let yy = y * scale; yy < (y + 1) * scale && yy < m.h; yy++) {
        for (let xx = x * scale; xx < (x + 1) * scale && xx < m.w; xx++) {
          const t = m.get(xx, yy);
          if (SOLID_TILES.has(t)) solid = true; else empty = true;
        }
      }
      const i = (y * cw + x) * 4;
      if (solid) {
        const l = empty ? 1.0 : 0.78;
        img.data[i] = themeCol[0] * l;
        img.data[i + 1] = themeCol[1] * l;
        img.data[i + 2] = themeCol[2] * l;
        img.data[i + 3] = 255;
      } else {
        img.data[i + 3] = 0;
      }
    }
  }
  ctx.putImageData(img, 0, 0);
  m.minimap = canvas;
  m.miniDirty = false;
  return canvas;
}

// ---------------------------------------------------------------- التصادم
/**
 * يحرّك جسمًا فيزيائيًا مع تصادم التايلات.
 * يعيد معلومات التصادم (على الأرض، اصطدم برأس/جانب... إلخ).
 */
export function moveAndCollide(map, body, dx, dy, opts = {}) {
  const res = { hitX: false, hitY: false, grounded: false, stepped: false };
  const ignorePlatforms = opts.ignorePlatforms || false;
  const w = body.w, h = body.h;
  // --- المحور الأفقي
  let x = body.x + dx;
  if (dx !== 0) {
    const dir = dx > 0 ? 1 : -1;
    const edge = dir > 0 ? x + w : x;
    const x0 = Math.floor(edge / TS), x1 = Math.floor((dir > 0 ? x + w - 0.01 : x + 0.01) / TS);
    const yTop = Math.floor((body.y + 2) / TS);
    const yBot = Math.floor((body.y + h - 2) / TS);
    let blocked = false;
    for (let ty = yTop; ty <= yBot; ty++) {
      if (map.isSolidAt(edge, ty * TS + TS / 2)) { blocked = true; break; }
    }
    if (blocked) {
      const steps = MAX_STEP || 36;
      if (opts.canStep && map.isSolidAt(body.x, body.y + h + 2) && !map.isSolidAt(edge, body.y + h + 2)
        && !map.isSolidAt(edge, body.y + 2)) {
        // درجة صغيرة: نصعد
        res.stepped = true;
      } else {
        x = body.x;
        res.hitX = true;
      }
    }
  }
  body.x = clamp(x, 0, map.w * TS - w - 1);
  // --- المحور الرأسي
  let y = body.y + dy;
  if (dy > 0) {
    const foot = y + h;
    const ty = Math.floor(foot / TS);
    let onGround = false;
    const x0 = Math.floor((body.x + 2) / TS), x1 = Math.floor((body.x + w - 2) / TS);
    for (let tx = x0; tx <= x1; tx++) {
      const t = map.get(tx, ty);
      if (SOLID_TILES.has(t)) { onGround = true; break; }
      if (t === T.PLATFORM && !ignorePlatforms) {
        // المنصة تُصادم فقط إن كان الجسم فوقها (One-way)
        if (body.y + h <= ty * TS + 4) onGround = true;
      }
      if (t === T.SLOPE_R || t === T.SLOPE_L) {
        const fx = (body.x + w / 2 - tx * TS) / TS;
        const surface = t === T.SLOPE_R ? fx : 1 - fx;
        if (body.y + h >= ty * TS + surface * TS) onGround = true;
      }
    }
    if (onGround) {
      y = ty * TS - h;
      res.grounded = true;
    }
  } else if (dy < 0) {
    const head = y;
    const ty = Math.floor(head / TS);
    const x0 = Math.floor((body.x + 2) / TS), x1 = Math.floor((body.x + w - 2) / TS);
    for (let tx = x0; tx <= x1; tx++) {
      if (map.isSolidAt(body.x + w / 2, ty * TS + 2) || SOLID_TILES.has(map.get(tx, ty))) {
        y = (ty + 1) * TS;
        res.hitY = true;
        break;
      }
    }
  }
  body.y = clamp(y, 0, map.h * TS - h - 1);
  if (body.y + h >= map.h * TS - 2) {
    body.y = map.h * TS - h - 1;
    res.grounded = true;
  }
  // هل الجسم على الأرض فعلًا؟
  if (!res.grounded) {
    const footTy = Math.floor((body.y + h + 1) / TS);
    const x0 = Math.floor((body.x + 2) / TS), x1 = Math.floor((body.x + w - 2) / TS);
    for (let tx = x0; tx <= x1; tx++) {
      const t = map.get(tx, footTy);
      if (SOLID_TILES.has(t)) { res.grounded = true; break; }
      if (t === T.PLATFORM && body.y + h <= footTy * TS + 6) { res.grounded = true; break; }
    }
  }
  return res;
}
const MAX_STEP = 8;

/** ارتفاع الأرض عند نقطة أفقية (للبوتات والتوليد) */
export function groundHeightAt(level, px) {
  const tx = clamp(Math.floor(px / TS), 0, level.map.w - 1);
  for (let y = 0; y < level.map.h; y++) {
    if (level.map.isSolid(tx, y)) return y * TS;
  }
  return level.map.h * TS;
}
