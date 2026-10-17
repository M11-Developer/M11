// ============================================================================
// مؤثرات ما بعد المعالجة — محدودة ومدروسة (القسم 3): توهّج، حافة داكنة (Vignette)،
// حبيبات فيلم، انحراف لوني، وميض الضرر، حركة بطيئة، ضباب، وميض المنطقة.
// تُطبَّق على "الحواف الناعمة" فقط — لا نلمس البكسلات الحادة في الأطالس.
// ============================================================================

import { clamp, lerp } from '../core/math.js';

export class PostFX {
  constructor(w, h) {
    this.w = w;
    this.h = h;
    this.quality = 2;             // 0=منخفضة 1=متوسطة 2=عالية 3=قصوى
    this.vignette = 0.45;
    this.grain = 0.12;
    this.bloomStrength = 0.34;
    this.bloomThreshold = 0.86;
    this.chroma = 0.5;
    this.damageFlash = 0;
    this.zoneFlash = 0;
    this.healFlash = 0;
    this.speedLines = 0;
    this.time = 0;
    this.enabled = true;
    this._grainData = null;
    this._grainFrame = 0;
    const mk = (k) => {
      if (typeof document === 'undefined') return null;
      const c = document.createElement('canvas');
      c.width = Math.max(1, Math.floor(w / k));
      c.height = Math.max(1, Math.floor(h / k));
      return c;
    };
    this.brightCanvas = mk(2);
    this.blurCanvas = mk(4);
    this.grainCanvas = mk(1);
    this.brightCtx = this.brightCanvas ? this.brightCanvas.getContext('2d') : null;
    this.blurCtx = this.blurCanvas ? this.blurCanvas.getContext('2d') : null;
    this.grainCtx = this.grainCanvas ? this.grainCanvas.getContext('2d') : null;
    this.buildGrain();
  }

  buildGrain() {
    if (!this.grainCtx) return;
    const w = this.grainCanvas.width, h = this.grainCanvas.height;
    const img = this.grainCtx.createImageData(w, h);
    for (let i = 0; i < w * h; i++) {
      const v = 118 + Math.floor(Math.random() * 26);
      img.data[i * 4] = v;
      img.data[i * 4 + 1] = v;
      img.data[i * 4 + 2] = v;
      img.data[i * 4 + 3] = 255;
    }
    this.grainCtx.putImageData(img, 0, 0);
  }

  hit(amount = 0.4) { this.damageFlash = clamp(this.damageFlash + amount, 0, 1); }
  heal() { this.healFlash = 1; }
  inZoneDanger() { this.zoneFlash = 1; }

  update(dt) {
    this.time += dt;
    this.damageFlash = Math.max(0, this.damageFlash - dt * 1.4);
    this.zoneFlash = Math.max(0, this.zoneFlash - dt * 1.2);
    this.healFlash = Math.max(0, this.healFlash - dt * 1.6);
  }

  /**
   * يرسم المؤثرات فوق مشهد داخلي مرسوم بالفعل.
   * scene = canvas الإطار الداخلي (640×360).
   */
  render(ctx, scene) {
    if (!this.enabled) return;
    // 1) التوهّج (Bloom): نأخذ البكسلات الساطعة ونضبّبها ونضيفها
    if (this.bloomStrength > 0.02 && this.brightCtx && this.quality >= 1) {
      const bc = this.brightCtx;
      const bw = this.brightCanvas.width, bh = this.brightCanvas.height;
      bc.setTransform(1, 0, 0, 1, 0, 0);
      bc.globalCompositeOperation = 'source-over';
      bc.clearRect(0, 0, bw, bh);
      bc.drawImage(scene, 0, 0, this.w, this.h, 0, 0, bw, bh);
      // عتبة: نُبقي الساطع فقط
      const data = bc.getImageData(0, 0, bw, bh);
      const px = data.data;
      const th = this.bloomThreshold * 255;
      for (let i = 0; i < px.length; i += 4) {
        const l = (px[i] + px[i + 1] + px[i + 2]) / 3;
        if (l < th) { px[i] = px[i + 1] = px[i + 2] = 0; }
        else {
          const k = (l - th) / (255 - th);
          px[i] *= k; px[i + 1] *= k; px[i + 2] *= k;
        }
      }
      bc.globalCompositeOperation = 'source-over';
      bc.putImageData(data, 0, 0);
      const bl = this.blurCtx;
      const lw = this.blurCanvas.width, lh = this.blurCanvas.height;
      bl.setTransform(1, 0, 0, 1, 0, 0);
      bl.clearRect(0, 0, lw, lh);
      bl.globalAlpha = 0.5;
      bl.drawImage(this.brightCanvas, 0, 0, bw, bh, 0, 0, lw, lh);
      bl.globalAlpha = 0.28;
      bl.drawImage(this.brightCanvas, 0, 0, bw, bh, -2, 0, lw, lh);
      bl.drawImage(this.brightCanvas, 0, 0, bw, bh, 2, 0, lw, lh);
      bl.drawImage(this.brightCanvas, 0, 0, bw, bh, 0, -2, lw, lh);
      bl.drawImage(this.brightCanvas, 0, 0, bw, bh, 0, 2, lw, lh);
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = clamp(this.bloomStrength, 0, 1);
      ctx.imageSmoothingEnabled = true;
      ctx.drawImage(this.blurCanvas, 0, 0, lw, lh, 0, 0, this.w, this.h);
      ctx.restore();
    }
    // 2) الانحراف اللوني عند الحواف (خفيف جدًا — إحساس كاميرا)
    if (this.chroma > 0.01 && this.quality >= 2) {
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = 0.06 * this.chroma;
      ctx.drawImage(scene, -1, 0, this.w, this.h);
      ctx.drawImage(scene, 1, 0, this.w, this.h);
      ctx.restore();
    }
    // 3) الحافة الداكنة
    if (this.vignette > 0.01) {
      const g = ctx.createRadialGradient(this.w / 2, this.h / 2, this.h * 0.32, this.w / 2, this.h / 2, this.h * 0.78);
      g.addColorStop(0, 'rgba(0,0,0,0)');
      g.addColorStop(1, `rgba(4,5,8,${this.vignette})`);
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, this.w, this.h);
    }
    // 4) وميض الضرر (أحمر على الحواف)
    if (this.damageFlash > 0.01) {
      const g = ctx.createRadialGradient(this.w / 2, this.h / 2, this.h * 0.2, this.w / 2, this.h / 2, this.h * 0.75);
      g.addColorStop(0, 'rgba(180,20,20,0)');
      g.addColorStop(1, `rgba(190,26,26,${0.75 * this.damageFlash})`);
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, this.w, this.h);
    }
    // 5) إصلاح صحة (أخضر خفيف)
    if (this.healFlash > 0.01) {
      ctx.fillStyle = `rgba(60,190,120,${0.16 * this.healFlash})`;
      ctx.fillRect(0, 0, this.w, this.h);
    }
    // 6) خارج المنطقة الآمنة (نبض أحمر)
    if (this.zoneFlash > 0.01) {
      const p = 0.5 + 0.5 * Math.sin(this.time * 7);
      ctx.fillStyle = `rgba(210,40,60,${0.1 * this.zoneFlash * p})`;
      ctx.fillRect(0, 0, this.w, this.h);
    }
    // 7) سرعة (خطوط حركة أثناء الاندفاع/الهبوط السريع)
    if (this.speedLines > 0.05) {
      ctx.save();
      ctx.globalAlpha = clamp(this.speedLines * 0.5, 0, 0.5);
      ctx.strokeStyle = 'rgba(255,255,255,0.5)';
      ctx.lineWidth = 1;
      const n = 8;
      for (let i = 0; i < n; i++) {
        const y = ((i * 37 + this.time * 260) % this.h);
        const x = (i * 97) % this.w;
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.lineTo(x + 22, y - 3);
        ctx.stroke();
      }
      ctx.restore();
    }
    // 8) حبيبات فيلم
    if (this.grain > 0.005 && this.grainCtx && this.quality >= 2) {
      this._grainFrame++;
      if (this._grainFrame % 2 === 0) this.buildGrain();
      ctx.save();
      ctx.globalAlpha = this.grain;
      ctx.globalCompositeOperation = 'overlay';
      ctx.drawImage(this.grainCanvas, 0, 0, this.grainCanvas.width, this.grainCanvas.height, 0, 0, this.w, this.h);
      ctx.restore();
    }
  }

  /** تأثير ضباب/غيوم فوق المشهد (طبقة عمق بعيدة) */
  fog(ctx, color = 'rgba(180,190,205,0.10)', amount = 1) {
    ctx.save();
    ctx.globalAlpha = amount;
    ctx.fillStyle = color;
    ctx.fillRect(0, 0, this.w, this.h);
    ctx.restore();
  }

  /** وميض أبيض للفوز/الانفجار الكبير */
  whiteFlash(ctx, amount) {
    if (amount <= 0.01) return;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.fillStyle = `rgba(255,255,255,${clamp(amount, 0, 0.95)})`;
    ctx.fillRect(0, 0, this.w, this.h);
    ctx.restore();
  }

  applyQuality(q) {
    this.quality = q;
    if (q === 0) { this.bloomStrength = 0; this.grain = 0; this.chroma = 0; this.vignette = 0.3; }
    else if (q === 1) { this.bloomStrength = 0.3; this.grain = 0; this.chroma = 0; this.vignette = 0.4; }
    else if (q === 2) { this.bloomStrength = 0.34; this.grain = 0.09; this.chroma = 0.4; this.vignette = 0.45; }
    else { this.bloomStrength = 0.42; this.grain = 0.14; this.chroma = 0.7; this.vignette = 0.5; }
  }
}
