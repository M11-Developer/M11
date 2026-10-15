// ============================================================================
// محمّل الأصول — يقرأ الأطالس المولّدة بالكود (tools/build_assets.py)
// كل إطارات اللعبة تأتي من أطالس PNG + JSON (إحداثيات + إزاحات القصّ).
// ============================================================================

export class Atlas {
  constructor(name, image, meta) {
    this.name = name;
    this.image = image;
    this.meta = meta;
    this.frames = meta.frames || {};
    this.offsets = meta.offsets || {};
    this.cache = new Map();
  }
  has(key) {
    return !!this.frames[key];
  }
  frame(key) {
    return this.frames[key];
  }
  /** إزاحة الإطار داخل الإطار الأصلي (نتيجة قصّ الإطارات الفارغة) */
  offset(key) {
    return this.offsets[key] || [0, 0];
  }
  /**
   * يرسم إطارًا مع مراعاة الإزاحة الأصلية.
   * (x,y) = موضع الإطار الأصلي (قبل القص) على الشاشة.
   */
  draw(ctx, key, x, y, scale = 1, flip = false) {
    const f = this.frames[key];
    if (!f) return false;
    const [ox, oy] = this.offset(key);
    const dx = x + ox * scale;
    const dy = y + oy * scale;
    const w = f.ox * scale, h = f.oy * scale;
    if (flip) {
      ctx.save();
      ctx.translate(dx + w, dy);
      ctx.scale(-1, 1);
      ctx.drawImage(this.image, f.x, f.y, f.w, f.h, 0, 0, w, h);
      ctx.restore();
    } else {
      ctx.drawImage(this.image, f.x, f.y, f.w, f.h, dx, dy, w, h);
    }
    return true;
  }
  /** يرسم بإزاحة مركزية (بكسل أصل) — للجزيئات والمؤثرات */
  drawCentered(ctx, key, cx, cy, scale = 1, flip = false) {
    const f = this.frames[key];
    if (!f) return false;
    const w = f.ox * scale, h = f.oy * scale;
    return this.draw(ctx, key, cx - w / 2, cy - h / 2, scale, flip);
  }
}

export const Assets = {
  atlases: new Map(),
  json: new Map(),
  audio: new Map(),
  loaded: 0,
  total: 0,
  base: 'assets/',
  onProgress: null,

  get(name) {
    return this.atlases.get(name);
  },

  async loadJson(path) {
    if (this.json.has(path)) return this.json.get(path);
    const res = await fetch(this.base + path);
    if (!res.ok) throw new Error('فشل تحميل ' + path);
    const data = await res.json();
    this.json.set(path, data);
    return data;
  },

  async loadImage(path) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error('فشل تحميل الصورة ' + path));
      img.src = this.base + path;
    });
  },

  /** يحمّل الأطالس المطلوبة (اسم الأطلس = اسم الملف بلا امتداد) */
  async load(names) {
    this.total = names.length;
    this.loaded = 0;
    const jobs = names.map(async (n) => {
      const meta = await this.loadJson(`${n}.json`);
      const img = await this.loadImage(`${n}.png`);
      this.atlases.set(n, new Atlas(n, img, meta));
      this.loaded++;
      if (this.onProgress) this.onProgress(this.loaded, this.total, n);
    });
    await Promise.all(jobs);
  },

  /** يجمع مفاتيح الشخصية: char_{op}/{anim}/{frame} */
  frameKey(opKey, anim, frame) {
    return `${opKey}/${anim}/${frame}`;
  },
};

// ---------------------------------------------------------------------------
// بيانات اللعبة المشتركة (تُطابق ما ولّده build_assets.py)
// ---------------------------------------------------------------------------

/** إعدادات اللعبة العامة */
export const CONFIG = {
  internalWidth: 640,
  internalHeight: 360,
  tile: 32,
  gravity: 1500,
  maxFallSpeed: 620,
  moveSpeed: 132,
  sprintSpeed: 186,
  airControl: 0.55,
  jumpSpeed: 405,
  doubleJumpSpeed: 350,
  jetpackForce: 2050,      // تسارع صاعد عند تشغيل الجيت باك
  jetpackMaxRise: 250,
  jetpackFuel: 100,
  jetpackDrain: 26,        // لكل ثانية
  jetpackRefill: 34,       // لكل ثانية على الأرض
  slideSpeed: 260,
  slideTime: 0.55,
  rollSpeed: 205,
  rollTime: 0.42,
  climbSpeed: 92,
  playerWidth: 16,
  playerHeight: 62,
  playerCrouchHeight: 34,
  proneHeight: 18,
  respawnTime: 3.2,
  dbnoTime: 20,
  reviveTime: 4.0,
  tickRate: 30,
  sendRate: 30,
  interpDelay: 0.1,
  maxLagComp: 0.2,
  reconnectGrace: 60,
  maxPlayers: 8,
  maxCombatants: 12,
};

/** فئات الأسلحة للواجهة */
export const WEAPON_CLASS_AR = {
  pistol: 'مسدس',
  smg: 'رشاش خفيف',
  ar: 'بندقية هجومية',
  sr: 'قنص',
  shotgun: 'شوزن',
  lmg: 'رشاش ثقيل',
  energy: 'طاقة',
  launcher: 'قاذفة',
  melee: 'مشاجرة',
};

export const RARITY_AR = {
  common: 'عادي',
  uncommon: 'غير شائع',
  rare: 'نادر',
  epic: 'ملحمي',
  legendary: 'أسطوري',
  mythic: 'خرافي',
};

export const RARITY_COLOR = {
  common: '#9BB8C4',
  uncommon: '#7FA05A',
  rare: '#4A90D9',
  epic: '#9B5DE8',
  legendary: '#F2C14E',
  mythic: '#E85D9B',
};
