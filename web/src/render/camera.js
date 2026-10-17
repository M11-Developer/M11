// ============================================================================
// الكاميرا — تتبع اللاعب مع تقديم النظر (Look-ahead) واهتزاز الشاشة (Trauma).
// ============================================================================

import { clamp, damp, lerp } from '../core/math.js';
import { CONFIG } from '../core/assets.js';

export class Camera {
  constructor(vw = CONFIG.internalWidth, vh = CONFIG.internalHeight) {
    this.vw = vw;
    this.vh = vh;
    this.x = 0;              // مركز الكاميرا في إحداثيات العالم
    this.y = 0;
    this.zoom = 1;
    this.targetZoom = 1;
    this.trauma = 0;         // 0..1 — الاهتزاز = trauma²
    this.shakeX = 0;
    this.shakeY = 0;
    this.shakeT = 0;
    this.lookAheadX = 0;
    this.lookAheadY = 0;
    this.bounds = null;      // { minX, minY, maxX, maxY }
    this.free = false;       // كاميرا حرة (مشاهد / تحرير الخرائط)
    this.rot = 0;
    this.followT = 0.12;
  }

  setBounds(level) {
    this.bounds = { minX: 0, minY: 0, maxX: level.width, maxY: level.height };
  }

  snapTo(x, y) {
    this.x = x;
    this.y = y;
    this.lookAheadX = 0;
    this.lookAheadY = 0;
    this.clampToBounds();
  }

  /** يضيف رجّة (0.2 = هزة بسيطة، 1 = انفجار قوي) */
  addTrauma(v) {
    this.trauma = clamp(this.trauma + v, 0, 1);
  }

  /** اتجاهي هزة بسيط (ضربة سلاح) */
  kick(dx, dy) {
    this.shakeX += dx;
    this.shakeY += dy;
  }

  update(dt, target, opts = {}) {
    this.shakeT += dt;
    if (!this.free && target) {
      // تقديم النظر: باتجاه التصويب + اتجاه السرعة
      const aimLead = target.aimActive ? (opts.aimLead != null ? opts.aimLead : 46) : 30;
      const wantX = Math.cos(target.aimAngle) * aimLead + clamp(target.vx * 0.22, -40, 40);
      const wantY = Math.sin(target.aimAngle) * aimLead * 0.45;
      this.lookAheadX = damp(this.lookAheadX, wantX, 5.5, dt);
      this.lookAheadY = damp(this.lookAheadY, wantY, 5.5, dt);
      const cx = target.cx + this.lookAheadX;
      const cy = target.cy - 14 + this.lookAheadY;
      this.x = damp(this.x, cx, 1 / this.followT, dt);
      this.y = damp(this.y, cy, 1 / this.followT, dt);
    }
    this.zoom = damp(this.zoom, this.targetZoom, 6, dt);
    // الاهتزاز
    this.trauma = Math.max(0, this.trauma - dt * 1.9);
    const s = this.trauma * this.trauma;
    const t = this.shakeT * 34;
    this.shakeX = damp(this.shakeX, Math.sin(t * 1.7) * s * 7, 22, dt);
    this.shakeY = damp(this.shakeY, Math.cos(t * 2.3) * s * 6, 22, dt);
    this.clampToBounds();
  }

  clampToBounds() {
    if (!this.bounds) return;
    const hw = this.vw / 2 / this.zoom, hh = this.vh / 2 / this.zoom;
    // أفقيًا: لا نخرج عن الخريطة. عموديًا: نتوقف عند القاع حتى تظل الأرض ظاهرة
    // (السماوات مفتوحة لأعلى فلا نحتاج حصرًا أعلى إلا بالحد الأدنى).
    this.x = clamp(this.x, this.bounds.minX + hw, Math.max(this.bounds.minX + hw, this.bounds.maxX - hw));
    const maxY = Math.max(this.bounds.minY + hh, this.bounds.maxY - hh + 8);
    this.y = clamp(this.y, this.bounds.minY + hh, maxY);
    // لا نسمح للنظر أن يكشف أسفل الخريطة أكثر من 24 بكسل
    const bottomLimit = this.bounds.maxY - this.vh + this.vh * 0.25;
    this.y = Math.min(this.y, Math.max(this.bounds.minY + hh, bottomLimit));
  }

  get left() { return this.x - this.vw / 2 / this.zoom; }
  get top() { return this.y - this.vh / 2 / this.zoom; }

  /** مستطيل العرض في العالم (مع هامش للمؤثرات) */
  viewRect(margin = 48) {
    return { x: this.left - margin, y: this.top - margin, w: this.vw / this.zoom + margin * 2, h: this.vh / this.zoom + margin * 2 };
  }

  /** يطبّق الإزاحة على السياق (يُستدعى مرة في الإطار) */
  /**
   * يطبّق تحويل الكاميرا على السياق: كل ما يُرسم بعدها بإحداثيات العالم
   * يظهر في مكانه الصحيح. نُدوّر الإزاحة لأعداد صحيحة حتى تبقى البكسلات حادة.
   */
  apply(ctx) {
    const ox = Math.round(-this.left + this.shakeX);
    const oy = Math.round(-this.top + this.shakeY);
    if (this.zoom === 1) {
      ctx.translate(ox, oy);
    } else {
      const k = 1 - this.zoom;
      ctx.translate(ox + k * this.vw * 0.5, oy + k * this.vh * 0.5);
      ctx.scale(this.zoom, this.zoom);
    }
  }

  worldToScreen(x, y) {
    return { x: (x - this.x) * this.zoom + this.vw / 2, y: (y - this.y) * this.zoom + this.vh / 2 };
  }

  screenToWorld(sx, sy) {
    return { x: (sx - this.vw / 2) / this.zoom + this.x, y: (sy - this.vh / 2) / this.zoom + this.y };
  }
}

/** كاميرا القتلة (Killcam) — تعرض لحظة القتل من زاوية القاتل */
export class KillCam {
  constructor(killer, victim) {
    this.killer = killer;
    this.victim = victim;
    this.time = 0;
    this.duration = 5.0;
    this.slowmo = 0;
  }
  update(dt, cam) {
    this.time += dt;
    // توقف زمني في أول 1.2 ثانية ثم تسريع
    this.slowmo = this.time < 1.2 ? 0.25 : 1;
    if (this.killer && this.killer.alive) {
      const a = Math.atan2(this.victim.cy - this.killer.cy, this.victim.cx - this.killer.cx);
      cam.free = true;
      cam.x = this.killer.cx + Math.cos(a) * 26;
      cam.y = this.killer.cy + Math.sin(a) * 26 - 6;
      cam.targetZoom = 1.25;
    }
    if (this.time > this.duration) {
      cam.free = false;
      cam.targetZoom = 1;
      return false;
    }
    return true;
  }
}
