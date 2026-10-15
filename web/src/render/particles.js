// ============================================================================
// الجزيئات (Particles) — كل شيء من أطلس vfx المُولّد، بلا صور خارجية.
// أنواع: دخان، غبار، شرر، دم، حطام، نار، نفث الجيت باك، رشاش الماء، ماسورة فارغة.
// ============================================================================

import { clamp, RNG, TAU } from '../core/math.js';

export const PARTICLE_CLIPS = {
  muzzle: { clip: 'muzzle', frames: 3, fps: 40, life: 0.075, scale: 1, ontop: true },
  spark: { clip: 'spark', frames: 5, fps: 34, life: 0.28, scale: 0.8, g: 420, bounce: true, ontop: true },
  dust: { clip: 'dust', frames: 5, fps: 14, life: 0.75, scale: 0.9, g: -18, drag: 1.6, fade: true },
  debris: { clip: 'debris', frames: 5, fps: 20, life: 0.7, scale: 0.8, g: 700, bounce: true, spin: true },
  blood: { clip: 'blood', frames: 5, fps: 22, life: 0.5, scale: 0.9, g: 520, drag: 2.2 },
  smoke: { clip: 'smoke', frames: 8, fps: 12, life: 1.4, scale: 1, g: -14, drag: 1.1, fade: true, grow: 1.5 },
  explosion: { clip: 'explosion', frames: 8, fps: 22, life: 0.42, scale: 1.6, ontop: true, bright: true },
  fire: { clip: 'fire', frames: 6, fps: 16, life: 1.1, scale: 1, g: -30, drag: 1.4, fade: true, bright: true },
  jet: { clip: 'jet', frames: 5, fps: 26, life: 0.22, scale: 1, g: -60, drag: 2.4, bright: true },
  water: { clip: 'water_splash', frames: 6, fps: 24, life: 0.45, scale: 0.9, g: 640 },
  flash: { clip: 'flashbang', frames: 6, fps: 18, life: 0.6, scale: 1.2, bright: true, ontop: true },
  hitmarker: { clip: 'hitmarker', frames: 4, fps: 36, life: 0.18, scale: 0.5, ontop: true },
  casing: { clip: 'debris', frames: 5, fps: 26, life: 0.9, scale: 0.35, g: 760, bounce: true, spin: true, frameOffset: 2 },
};

export class Particles {
  constructor(max = 1400) {
    this.max = max;
    this.list = [];
    this.pool = [];
    this.rng = new RNG(9137);
    this.drawn = 0;
  }

  /** ينشئ جزيئة من النوع المحدد */
  spawn(kind, x, y, opts = {}) {
    const def = PARTICLE_CLIPS[kind] || PARTICLE_CLIPS.dust;
    if (this.list.length >= this.max) {
      // استبدل أقدم جزيئة غير مهمة
      const idx = this.list.findIndex((p) => !p.ontop);
      if (idx < 0) return null;
      this.pool.push(this.list.splice(idx, 1)[0]);
    }
    const p = this.pool.pop() || {};
    p.kind = kind;
    p.def = def;
    p.x = x;
    p.y = y;
    p.vx = opts.vx != null ? opts.vx : 0;
    p.vy = opts.vy != null ? opts.vy : 0;
    p.life = (def.life || 0.5) * (opts.lifeMul || 1);
    p.maxLife = p.life;
    p.scale = (def.scale || 1) * (opts.scale || 1);
    p.rot = opts.rot != null ? opts.rot : (def.spin ? this.rng.range(0, TAU) : 0);
    p.spin = opts.spin != null ? opts.spin : (def.spin ? this.rng.range(-9, 9) : 0);
    p.g = def.g || 0;
    p.drag = def.drag || 0;
    p.bounce = !!def.bounce;
    p.bright = !!def.bright;
    p.ontop = !!def.ontop;
    p.fade = !!def.fade;
    p.grow = def.grow || 1;
    p.frameOffset = def.frameOffset || 0;
    p.tint = opts.tint || null;
    p.bounceH = 0;
    this.list.push(p);
    return p;
  }

  // ------------------------------------------------------------- وصفات جاهزة
  muzzleFlash(x, y, angle, scale = 1) {
    this.spawn('muzzle', x, y, { rot: angle, scale: scale, vx: Math.cos(angle) * 20, vy: Math.sin(angle) * 20 });
    for (let i = 0; i < 3; i++) {
      const a = angle + this.rng.range(-0.5, 0.5);
      this.spawn('spark', x, y, { vx: Math.cos(a) * this.rng.range(60, 190), vy: Math.sin(a) * this.rng.range(60, 120) - 30, scale: 0.6 });
    }
    this.spawn('smoke', x, y, { vx: Math.cos(angle) * 26, vy: Math.sin(angle) * 26 - 12, scale: 0.5, lifeMul: 0.6 });
    this.spawn('casing', x - Math.cos(angle) * 4, y, { vx: -Math.cos(angle) * 40 + this.rng.range(-20, 20), vy: -this.rng.range(40, 90) });
  }

  impact(x, y, angle, material = 'concrete', scale = 1) {
    const back = angle + Math.PI;
    const n = material === 'glass' ? 7 : 4;
    for (let i = 0; i < n; i++) {
      const a = back + this.rng.range(-0.9, 0.9);
      this.spawn(material === 'water' ? 'water' : 'spark', x, y, {
        vx: Math.cos(a) * this.rng.range(40, 170), vy: Math.sin(a) * this.rng.range(40, 130) - 20,
        scale: scale * (material === 'wood' ? 0.7 : 1),
      });
    }
    if (material === 'wood' || material === 'metal') {
      this.spawn('debris', x, y, { vx: Math.cos(back) * 90, vy: -70, scale: 0.5, tint: material === 'wood' ? 'wood' : 'metal' });
    }
    if (material === 'dirt' || material === 'concrete' || material === 'water') {
      this.spawn(material === 'water' ? 'water' : 'dust', x, y, { vx: this.rng.range(-20, 20), vy: -18, scale: scale, lifeMul: 0.8 });
    }
  }

  bloodHit(x, y, angle, amount = 4) {
    for (let i = 0; i < amount; i++) {
      const a = angle + this.rng.range(-0.7, 0.7);
      this.spawn('blood', x, y, {
        vx: Math.cos(a) * this.rng.range(50, 190), vy: Math.sin(a) * this.rng.range(30, 120) - 40,
        scale: this.rng.range(0.7, 1.2),
      });
    }
  }

  explosion(x, y, radius, big = false) {
    this.spawn('explosion', x, y, { scale: big ? 2.6 : 1.5 });
    if (big) this.spawn('explosion', x + 6, y - 4, { scale: 1.9 });
    for (let i = 0; i < (big ? 16 : 9); i++) {
      const a = this.rng.range(0, TAU);
      const sp = this.rng.range(60, big ? 340 : 220);
      this.spawn('fire', x + Math.cos(a) * 6, y + Math.sin(a) * 6, { vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 40, scale: this.rng.range(0.6, 1.3) });
      this.spawn('smoke', x + Math.cos(a) * 10, y + Math.sin(a) * 10, { vx: Math.cos(a) * sp * 0.6, vy: Math.sin(a) * sp * 0.4 - 30, scale: this.rng.range(0.7, 1.6) });
    }
    for (let i = 0; i < (big ? 18 : 10); i++) {
      const a = this.rng.range(-Math.PI, 0);
      this.spawn('debris', x, y, { vx: Math.cos(a) * this.rng.range(60, 260), vy: Math.sin(a) * this.rng.range(120, 300), scale: this.rng.range(0.6, 1.4) });
    }
    this.spawn('dust', x, y, { scale: big ? 2.4 : 1.5, lifeMul: 1.6 });
  }

  jetpack(x, y, angle = Math.PI / 2, on = true) {
    if (!on) return;
    for (let i = 0; i < 2; i++) {
      this.spawn('jet', x + this.rng.range(-2, 2), y, { vy: this.rng.range(120, 200), vx: this.rng.range(-24, 24), scale: this.rng.range(0.7, 1.1), rot: angle });
    }
    this.spawn('smoke', x, y + 4, { vy: 40, scale: 0.4, lifeMul: 0.5 });
  }

  footDust(x, y, speed = 1, water = false) {
    const kind = water ? 'water' : 'dust';
    this.spawn(kind, x, y, { vx: this.rng.range(-26, 26) * (water ? 1.6 : 1), vy: -this.rng.range(6, 22), scale: this.rng.range(0.4, 0.7) * speed });
  }

  landingDust(x, y, power = 1) {
    for (let i = 0; i < 6; i++) {
      this.spawn('dust', x + this.rng.range(-8, 8), y, { vx: this.rng.range(-70, 70) * power, vy: -this.rng.range(10, 40), scale: this.rng.range(0.6, 1.1) * power });
    }
  }

  trail(x, y, color) {
    const p = this.spawn('smoke', x, y, { scale: 0.28, lifeMul: 0.35, tint: color });
    return p;
  }

  hitMarker(x, y, killed, headshot) {
    this.spawn('hitmarker', x, y, { scale: killed ? 1.1 : 0.85, tint: headshot ? 'crit' : null, rot: 0 });
  }

  flashbang(x, y) {
    this.spawn('flash', x, y, { scale: 1.8 });
    for (let i = 0; i < 10; i++) {
      const a = this.rng.range(0, TAU);
      this.spawn('spark', x, y, { vx: Math.cos(a) * 240, vy: Math.sin(a) * 240, scale: 0.9 });
    }
  }

  zoneGust(x, y) {
    this.spawn('smoke', x, y, { vx: this.rng.range(30, 90), vy: this.rng.range(-10, 10), scale: 1.1, lifeMul: 1.4 });
  }

  // ------------------------------------------------------------- التحديث
  update(dt, world = null) {
    const lvl = world ? world.level : null;
    for (let i = this.list.length - 1; i >= 0; i--) {
      const p = this.list[i];
      p.life -= dt;
      if (p.life <= 0) {
        this.pool.push(p);
        this.list.splice(i, 1);
        continue;
      }
      p.vy += p.g * dt;
      if (p.drag) {
        const d = Math.exp(-p.drag * dt);
        p.vx *= d;
        p.vy *= d;
      }
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.rot += p.spin * dt;
      // تصادم بسيط مع التضاريس
      if (p.bounce && lvl) {
        const below = lvl.map.isSolidAt(p.x, p.y + 2);
        if (below && p.vy > 0) {
          p.vy *= -0.36;
          p.vx *= 0.7;
          p.y -= 2;
          p.bounceH++;
        }
        const sideAhead = lvl.map.isSolidAt(p.x + Math.sign(p.vx) * 2, p.y);
        if (sideAhead) p.vx *= -0.4;
      }
    }
  }

  clear() {
    for (const p of this.list) this.pool.push(p);
    this.list.length = 0;
  }

  /** يرسم كل الجزيئات. atlas = أطلس vfx. */
  draw(ctx, atlas, cam, layer = 'back') {
    this.drawn = 0;
    for (const p of this.list) {
      if ((layer === 'top') !== p.ontop) continue;
      const d = p.def;
      const t = 1 - p.life / p.maxLife;
      const fi = Math.min(d.frames - 1, Math.floor(t * d.frames) + p.frameOffset);
      const key = `${d.clip}/${fi}`;
      let sc = p.scale * (p.grow !== 1 ? 1 + (p.grow - 1) * t : 1);
      const a = p.fade ? clamp(1 - t * t, 0, 1) : 1;
      if (a <= 0.02) continue;
      ctx.save();
      ctx.globalAlpha = a;
      if (p.bright) ctx.globalCompositeOperation = 'lighter';
      if (p.rot) {
        ctx.translate(Math.round(p.x), Math.round(p.y));
        ctx.rotate(p.rot);
        atlas.drawCentered(ctx, key, 0, 0, sc);
      } else {
        atlas.drawCentered(ctx, key, Math.round(p.x), Math.round(p.y), sc);
      }
      ctx.restore();
      this.drawn++;
    }
  }
}
