// ============================================================================
// الإضاءة الديناميكية 2D — خريطة إضاءة منفصلة تُضرب على المشهد (Multiply).
// تعمل مع "الخرائط الطبيعية" (Normal Maps) المولّدة برمجيًا: نحسب اتجاه
// السطح التقريبي من التضاريس ونخفّف الإضاءة على الجوانب المعاكسة.
// ============================================================================

import { clamp, lerp, RNG } from '../core/math.js';

export class Lighting {
  constructor(w, h) {
    this.w = w;
    this.h = h;
    // نصف الدقة للأداء (ثم نحجبها بسلاسة عند الرسم)
    this.lw = Math.ceil(w / 2);
    this.lh = Math.ceil(h / 2);
    this.canvas = typeof document !== 'undefined' ? document.createElement('canvas') : null;
    if (this.canvas) {
      this.canvas.width = this.lw;
      this.canvas.height = this.lh;
      this.ctx = this.canvas.getContext('2d');
    }
    this.ambient = 0.55;          // 0 = ليل حالك، 1 = ظهيرة
    this.ambientColor = [16, 20, 30];
    this.lights = [];
    this.staticLights = [];       // أضواء ثابتة من الخريطة (مصابيح، نار، شاشات)
    this.timeOfDay = 0;           // 0..1 (0 = فجر، 0.5 = ظهيرة)
    this.flash = 0;               // وميض شاشة كامل (قنبلة ضوئية)
    this.normalStrength = 0.35;
    this.rng = new RNG(4242);
  }

  /** يمثّل مؤشر الإضاءة من عناصر الخريطة (يُستدعى مرة عند التحميل) */
  buildStatic(level) {
    this.staticLights.length = 0;
    for (const p of level.props) {
      if (p.kind === 'lamp') this.staticLights.push({ x: p.x, y: p.y - 10, r: 84, color: [255, 208, 128], intensity: 0.85, flicker: 0.12, seed: this.rng.next() * 100 });
      else if (p.kind === 'generator') this.staticLights.push({ x: p.x, y: p.y - 12, r: 62, color: [120, 200, 255], intensity: 0.6, flicker: 0.3, seed: this.rng.next() * 100 });
      else if (p.kind === 'water') this.staticLights.push({ x: p.x, y: p.y, r: 40, color: [110, 190, 255], intensity: 0.25, flicker: 0.05, seed: this.rng.next() * 100 });
    }
  }

  setTimeOfDay(t, theme) {
    this.timeOfDay = t;
    // 0 = فجر (بارد)، 0.25 = نهار، 0.5 = غروب، 0.75 = ليل
    if (t < 0.2) { this.ambient = 0.86; this.ambientColor = [130, 146, 186]; }
    else if (t < 0.45) { this.ambient = 0.94; this.ambientColor = [226, 230, 238]; }
    else if (t < 0.62) { this.ambient = 0.88; this.ambientColor = [238, 190, 150]; }
    else { this.ambient = 0.66; this.ambientColor = [104, 120, 168]; }
    if (theme === 'base' || theme === 'factory') this.ambient *= 0.78;
  }

  begin(trauma = 0) {
    if (!this.ctx) return;
    const ctx = this.ctx;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    const [r, g, b] = this.ambientColor;
    const a = clamp(this.ambient, 0.12, 1);
    ctx.globalCompositeOperation = 'source-over';
    ctx.fillStyle = `rgb(${Math.round(r * a)},${Math.round(g * a)},${Math.round(b * a)})`;
    ctx.fillRect(0, 0, this.lw, this.lh);
    ctx.globalCompositeOperation = 'lighter';
  }

  /** يضيف ضوءًا مؤقتًا (وميض طلق، انفجار، جيت باك، شعلة) */
  addLight(x, y, r, color, intensity = 1, life = 0.06, flicker = 0) {
    this.lights.push({ x, y, r, color, intensity, life, maxLife: life, flicker, seed: Math.random() * 100 });
  }

  update(dt) {
    for (let i = this.lights.length - 1; i >= 0; i--) {
      const l = this.lights[i];
      l.life -= dt;
      if (l.life <= 0) this.lights.splice(i, 1);
    }
    this.flash = Math.max(0, this.flash - dt * 1.6);
  }

  /** يرسم الأضواء في خريطة الإضاءة (إحداثيات العالم) */
  render(cam, tileMap = null) {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const t = performance.now ? performance.now() / 1000 : Date.now() / 1000;
    // الأضواء الثابتة
    for (const l of this.staticLights) {
      if (!this.inView(l.x, l.y, cam, l.r)) continue;
      const fl = 1 - l.flicker * (0.5 + 0.5 * Math.sin(t * 7.3 + l.seed) * Math.sin(t * 2.1 + l.seed * 1.7));
      this.drawLight(l.x, l.y, l.r, l.color, l.intensity * fl, cam);
    }
    // الأضواء المؤقتة
    for (const l of this.lights) {
      if (!this.inView(l.x, l.y, cam, l.r)) continue;
      const k = l.maxLife > 0 ? clamp(l.life / l.maxLife, 0, 1) : 1;
      const fl = 1 - l.flicker * (0.5 + 0.5 * Math.sin(t * 27 + l.seed));
      this.drawLight(l.x, l.y, l.r * (0.7 + 0.3 * k), l.color, l.intensity * k * fl, cam);
    }
  }

  inView(x, y, cam, pad = 0) {
    const v = cam.viewRect(pad);
    return x > v.x - pad && x < v.x + v.w + pad && y > v.y - pad && y < v.y + v.h + pad;
  }

  drawLight(wx, wy, worldR, color, intensity, cam) {
    const ctx = this.ctx;
    const sx = (wx - cam.left) * cam.zoom * 0.5;
    const sy = (wy - cam.top) * cam.zoom * 0.5;
    const r = Math.max(3, worldR * cam.zoom * 0.5);
    const [cr, cg, cb] = color;
    const grd = ctx.createRadialGradient(sx, sy, 0, sx, sy, r);
    const a = clamp(intensity, 0, 1.6);
    grd.addColorStop(0, `rgba(${cr},${cg},${cb},${a})`);
    grd.addColorStop(0.45, `rgba(${cr},${cg},${cb},${a * 0.45})`);
    grd.addColorStop(1, `rgba(${cr},${cg},${cb},0)`);
    ctx.fillStyle = grd;
    ctx.beginPath();
    ctx.arc(sx, sy, r, 0, Math.PI * 2);
    ctx.fill();
  }

  /** يُدمج خريطة الإضاءة على المشهد */
  composite(ctx, cam, width, height) {
    if (!this.canvas) return;
    ctx.save();
    ctx.globalCompositeOperation = 'multiply';
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(this.canvas, 0, 0, this.lw, this.lh, 0, 0, width, height);
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = 0.07;
    ctx.drawImage(this.canvas, 0, 0, this.lw, this.lh, 0, 0, width, height);
    ctx.restore();
    if (this.flash > 0) {
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      ctx.fillStyle = `rgba(255,255,255,${clamp(this.flash, 0, 0.92)})`;
      ctx.fillRect(0, 0, width, height);
      ctx.restore();
    }
  }

  /** تظليل بسيط حسب الخريطة الطبيعية: يعتّم الأسطح المعاكسة لاتجاه الضوء */
  shadeRect(ctx, x, y, w, h, normalX, normalY, cam) {
    const s = this.normalStrength;
    const nx = clamp(normalX, -1, 1), ny = clamp(normalY, -1, 1);
    const dot = clamp(nx * 0.4 + ny * -0.6, -1, 1);
    const shade = clamp(1 + dot * s, 0.6, 1.25);
    if (Math.abs(shade - 1) < 0.02) return;
    ctx.save();
    ctx.globalCompositeOperation = shade < 1 ? 'multiply' : 'lighter';
    ctx.globalAlpha = Math.abs(shade - 1) * 1.6;
    ctx.fillStyle = shade < 1 ? '#0B0D10' : '#FFE9C0';
    ctx.fillRect(x, y, w, h);
    ctx.restore();
  }
}
