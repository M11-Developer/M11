// ============================================================================
// أدوات رياضية مشتركة (M11 — الجبهة: عمليات محلية)
// كل حسابات الفيزياء تعمل بوحدات البكسل الداخلي (640×360) — القسم 2 من دفتر المشروع.
// ============================================================================

export const TAU = Math.PI * 2;
export const DEG = Math.PI / 180;

export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
export const lerp = (a, b, t) => a + (b - a) * t;
export const invLerp = (a, b, v) => (b === a ? 0 : (v - a) / (b - a));
export const sign = (v) => (v < 0 ? -1 : v > 0 ? 1 : 0);
export const approach = (v, target, delta) =>
  v < target ? Math.min(v + delta, target) : Math.max(v - delta, target);

/** تنعيم مستقل عن معدل الإطارات (Exponential Smoothing) */
export const damp = (a, b, lambda, dt) => lerp(a, b, 1 - Math.exp(-lambda * dt));

export function dist2(ax, ay, bx, by) {
  const dx = ax - bx, dy = ay - by;
  return dx * dx + dy * dy;
}
export function dist(ax, ay, bx, by) {
  return Math.sqrt(dist2(ax, ay, bx, by));
}

/** زاوية موجبة دائمًا من 0 إلى TAU */
export function normAngle(a) {
  a %= TAU;
  return a < 0 ? a + TAU : a;
}
/** فرق زوايا مختصر في المجال [-PI, PI] */
export function angleDelta(a, b) {
  let d = normAngle(b - a);
  if (d > Math.PI) d -= TAU;
  return d;
}

/** مولّد أرقام عشوائية ببذرة (Mulberry32) — نفس الخريطة/البوتات لكل اللاعبين */
export class RNG {
  constructor(seed = 1) {
    this.s = (seed >>> 0) || 1;
  }
  next() {
    let t = (this.s += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  range(a, b) {
    return a + this.next() * (b - a);
  }
  int(a, b) {
    return Math.floor(this.range(a, b + 1));
  }
  pick(arr) {
    return arr[Math.floor(this.next() * arr.length)];
  }
  chance(p) {
    return this.next() < p;
  }
  /** ضجيج قيمة ثنائي الأبعاد (Value Noise) لتوليد الخرائط والتمويه */
  noise2(x, y, freq = 0.1) {
    const xi = Math.floor(x * freq), yi = Math.floor(y * freq);
    const xf = x * freq - xi, yf = y * freq - yi;
    const h = (a, b) => {
      let n = Math.imul(a * 374761393 + b * 668265263, 2246822519) >>> 0;
      return ((n ^ (n >>> 13)) >>> 0) / 4294967296;
    };
    const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
    return lerp(lerp(h(xi, yi), h(xi + 1, yi), u), lerp(h(xi, yi + 1), h(xi + 1, yi + 1), u), v);
  }
  fbm(x, y, octaves = 3, freq = 0.08) {
    let sum = 0, amp = 1, f = freq, tot = 0;
    for (let i = 0; i < octaves; i++) {
      sum += this.noise2(x, y, f) * amp;
      tot += amp;
      amp *= 0.5;
      f *= 2.1;
    }
    return sum / tot;
  }
}

/** مستطيلات: كشف تداخل AABB */
export function aabb(a, b) {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}
export function rectContains(r, x, y) {
  return x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h;
}
export function rectOverlap(x, y, w, h, r) {
  return x < r.x + r.w && x + w > r.x && y < r.y + r.h && y + h > r.y;
}

/** تجميع الكائنات (Object Pool) — القسم 20: مطلوب للرصاص والجزيئات */
export class Pool {
  constructor(factory, reset, size = 256) {
    this.items = [];
    this.factory = factory;
    this.reset = reset;
    for (let i = 0; i < size; i++) this.items.push(factory());
  }
  get() {
    for (let i = 0; i < this.items.length; i++) {
      const it = this.items[i];
      if (!it.active) return it;
    }
    const it = this.factory();
    this.items.push(it);
    return it;
  }
  release(it) {
    it.active = false;
    if (this.reset) this.reset(it);
  }
  releaseAll() {
    for (const it of this.items) this.release(it);
  }
  get activeCount() {
    let n = 0;
    for (const it of this.items) if (it.active) n++;
    return n;
  }
}

export function formatTime(sec) {
  sec = Math.max(0, Math.floor(sec));
  const m = Math.floor(sec / 60), s = sec % 60;
  return `${m}:${s < 10 ? '0' : ''}${s}`;
}

/** تكميم القيم على الشبكة — القسم 4 بند 7 (تقليل حجم حزم الشبكة) */
export const quantizePos = (v) => Math.round(v * 4) / 4;
export const quantizeAngle = (v) => Math.round(normAngle(v) / (TAU / 256)) * (TAU / 256);
