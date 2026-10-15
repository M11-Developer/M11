// ============================================================================
// المُصيّر — يرسم العالم كاملًا: طبقات المنظر الخلفي (Parallax)، التضاريس
// المُخزّنة مؤقتًا (Chunk Cache)، الشخصيات بأذرعها المسوّمة مسبقًا بزوايا
// (بلا دوران حر — القسم 3)، الأسلحة، الجزيئات، والإضاءة.
//
// قاعدة ذهبية: لا تصغير/تكبير عشري لأي بكسل فني. الدقة الداخلية ثابتة
// 640×360 ثم تُكبَّر بعدد صحيح (Integer Scaling) بلا تنعيم (Nearest).
// ============================================================================

import { CONFIG } from '../core/assets.js';
import { clamp, damp, lerp, RNG, TAU } from '../core/math.js';
import { TS, T, SOLID_TILES } from '../game/world.js';
import { WEAPONS, resolveStats } from '../game/weapons.js';
import { Particles } from './particles.js';
import { Lighting } from './lighting.js';
import { PostFX } from './postfx.js';

const W = CONFIG.internalWidth;
const H = CONFIG.internalHeight;

/** نسبة وزن السلاح داخل الإطار (من اليسار) لتحديد نقطة القبضة */
const GRIP_RATIO = {
  pistol: [0.32, 0.62], smg: [0.30, 0.58], ar: [0.26, 0.56], sr: [0.24, 0.55],
  shotgun: [0.28, 0.56], lmg: [0.26, 0.56], energy: [0.26, 0.55], launcher: [0.30, 0.60], melee: [0.28, 0.70],
};

/** خريطة حالة اللاعب → مقطع الرسم المُولَّد */
const STATE_ANIM = {
  idle: 'idle', walk: 'walk', run: 'run', sprint: 'sprint', jump: 'jump', fall: 'fall',
  jetpack: 'jetpack', prone: 'prone', crawl: 'crawl', slide: 'slide', roll: 'roll',
  climb: 'climb', walljump: 'walljump', ledge: 'ledge', dbno: 'dbno', dead: 'death0',
  death0: 'death0', death1: 'death1', death2: 'death2', win: 'win', victory: 'victory',
  taunt: 'taunt', throw: 'throw', melee: 'melee', reload: 'reload', heal: 'heal',
  revive: 'revive', switch: 'switch', swim: 'swim', drive: 'drive',
};

/** أطوال المقاطع بالثواني (تُشتق من frames/fps داخل characters_meta) */
const ACTIONS = ['reload', 'heal', 'throw', 'melee', 'switch', 'revive'];

export class Renderer {
  constructor(canvas, assets) {
    this.canvas = canvas;
    this.main = canvas.getContext('2d', { alpha: false });
    this.assets = assets;
    this.scale = 1;
    this.chunks = new Map();
    this.particles = new Particles(1600);
    this.lighting = new Lighting(W, H);
    this.postfx = new PostFX(W, H);
    this.rng = new RNG(1717);
    this.animTime = new Map();      // id → زمن الحركة (لتشغيل المقاطع)
    this.stateAnim = new Map();
    this.parallax = null;
    this.useAiTiles = false;   // يفعّلها الإعداد "أسلوب الرسم" إن أراد اللاعب
    this.minimap = null;
    this.minimapCtx = null;
    this.debug = { chunks: 0, draws: 0, fps: 0 };
    this.quality = 2;
    this.enableLighting = true;
    this.enablePost = true;
    this.enableParallax = true;
    this.enableEntities = true;
    this.weather = 'clear';
    this.weatherT = 0;
    this.rainDrops = [];
    this.setupCanvas();
  }

  setupCanvas() {
    this.canvas.width = W;
    this.canvas.height = H;
    this.main.imageSmoothingEnabled = false;
  }

  /** يحسب مقياس العرض الصحيح (عدد صحيح دائمًا) */
  resize(availW, availH, integerScaling = true) {
    let s = Math.min(availW / W, availH / H);
    if (integerScaling) s = Math.max(1, Math.floor(s * 2) / 2);
    this.scale = s;
    const cssW = Math.round(W * s);
    const cssH = Math.round(H * s);
    this.canvas.style.width = cssW + 'px';
    this.canvas.style.height = cssH + 'px';
    return { w: cssW, h: cssH, scale: s };
  }

  // ------------------------------------------------------------- التحضير
  setLevel(level, charMeta) {
    this.level = level;
    const armsAtlas = this.assets.get('arms');
    if (armsAtlas && armsAtlas.meta && armsAtlas.meta.angles) this.armAngleList = armsAtlas.meta.angles;
    this.charMeta = charMeta || null;
    this.chunks.clear();
    this.parallax = buildParallax(level.def.theme, level.def.seed || 1234);
    this.lighting.buildStatic(level);
    this.lighting.setTimeOfDay(level.def.timeOfDay != null ? level.def.timeOfDay : 0.25, level.def.theme);
    this.buildMinimap(level);
    this.animTime.clear();
  }

  buildMinimap(level) {
    const m = level.map;
    const cw = Math.ceil(m.w / 3), ch = Math.ceil(m.h / 3);
    const cv = document.createElement('canvas');
    cv.width = cw;
    cv.height = ch;
    const ctx = cv.getContext('2d');
    const img = ctx.createImageData(cw, ch);
    const themeCol = {
      desert: [186, 152, 84], base: [96, 104, 118], city: [128, 132, 140],
      forest: [86, 116, 66], village: [126, 92, 52], factory: [104, 104, 112],
      nightbase: [58, 64, 82], ruins: [122, 116, 104], oasis: [148, 158, 96],
    }[level.def.theme] || [120, 120, 120];
    for (let y = 0; y < ch; y++) {
      for (let x = 0; x < cw; x++) {
        let solid = false, empty = false, type = 0;
        for (let yy = y * 3; yy < (y + 1) * 3 && yy < m.h; yy++) {
          for (let xx = x * 3; xx < (x + 1) * 3 && xx < m.w; xx++) {
            const t = m.get(xx, yy);
            if (SOLID_TILES.has(t)) { solid = true; type = t; } else if (t !== T.BACK) empty = true;
          }
        }
        const i = (y * cw + x) * 4;
        if (solid) {
          const k = empty ? 1.0 : 0.72;
          img.data[i] = themeCol[0] * k;
          img.data[i + 1] = themeCol[1] * k;
          img.data[i + 2] = themeCol[2] * k;
        } else {
          img.data[i] = themeCol[0] * 0.42;
          img.data[i + 1] = themeCol[1] * 0.42;
          img.data[i + 2] = themeCol[2] * 0.42;
        }
        img.data[i + 3] = 255;
      }
    }
    ctx.putImageData(img, 0, 0);
    this.minimap = cv;
  }

  // ------------------------------------------------------------- التضاريس
  /** يرسم تايلات مقطع (16×16) في كانفس مخزّن — يتحدّث فقط عند تدمير تايل */
  chunkFor(cx, cy) {
    const lvl = this.level;
    const m = lvl.map;
    const key = cx + ':' + cy;
    const S = 16;
    let entry = this.chunks.get(key);
    let hash = 0;
    for (let y = cy * S; y < (cy + 1) * S; y++) {
      for (let x = cx * S; x < (cx + 1) * S; x++) hash = (hash * 31 + m.get(x, y)) | 0;
    }
    if (entry && entry.hash === hash) return entry;
    if (!entry) {
      const cv = document.createElement('canvas');
      cv.width = S * TS;
      cv.height = S * TS;
      entry = { canvas: cv, ctx: cv.getContext('2d'), hash: null, back: null, backCtx: null };
      const back = document.createElement('canvas');
      back.width = S * TS; back.height = S * TS;
      entry.back = back; entry.backCtx = back.getContext('2d');
      this.chunks.set(key, entry);
    }
    entry.hash = hash;
    entry.ctx.imageSmoothingEnabled = false;
    entry.ctx.clearRect(0, 0, S * TS, S * TS);
    entry.backCtx.clearRect(0, 0, S * TS, S * TS);
    for (let y = cy * S; y < (cy + 1) * S; y++) {
      for (let x = cx * S; x < (cx + 1) * S; x++) {
        const t = m.get(x, y);
        if (t === T.EMPTY) continue;
        const dx = (x - cx * S) * TS;
        const dy = (y - cy * S) * TS;
        const above = m.get(x, y - 1);
        let ctx = entry.ctx, canvas;
        if (t === T.BACK) ctx = entry.backCtx;
        this.drawTile(ctx, t, x, y, dx, dy, above);
      }
    }
    if (this.chunks.size > 260) {
      // تخلّص من المقاطع البعيدة
      const keys = [...this.chunks.keys()].slice(0, 60);
      for (const k of keys) this.chunks.delete(k);
    }
    return entry;
  }

  drawTile(ctx, t, tx, ty, dx, dy, above) {
    const theme = this.level.def.theme;
    // مسار اختياري: أطالس بلاطات مولّدة بالذكاء الاصطناعي (تُفعّل من الإعدادات)
    // الافتراضي مطفأ لأن بلاطات الكود مضمونة الاتساق (قرار 17 في DECISIONS.md).
    if (this.useAiTiles) {
      const ai = this.assets.get('tiles_' + theme);
      if (ai) {
        const map = { [T.SOLID]: 'solid', [T.TOP]: above === T.EMPTY || above === T.BACK ? 'top' : 'solid',
                      [T.BACK]: 'back', [T.PLATFORM]: 'platform', [T.GIRDER]: 'platform' };
        const base = map[t];
        if (base) {
          for (const key of [`tile/${theme}/${base}`, `tile/${theme}/${base}_1`, `tile/${theme}/${base}_2`]) {
            if (ai.has(key)) { ai.draw(ctx, key, dx, dy, 1, false); return; }
          }
        }
      }
    }
    const world = this.assets.get('world');
    if (!world) return;
    const pick = (base, variants) => {
      if (!variants) return `tile/${theme}/${base}`;
      const h = ((tx * 73856093) ^ (ty * 19349663)) >>> 0;
      const v = h % (variants + 1);
      return `tile/${theme}/${v === 0 ? base : base + '_' + v}`;
    };
    let key = null;
    switch (t) {
      case T.SOLID: key = pick('solid', 2); break;
      case T.TOP: key = above === T.SOLID || above === T.TOP ? pick('solid', 2) : pick('top', 2); break;
      case T.BACK: key = pick('back', 2); break;
      case T.PLATFORM: key = `tile/${theme}/platform`; break;
      case T.SLOPE_R: key = `tile/${theme}/slope_r`; break;
      case T.SLOPE_L: key = `tile/${theme}/slope_l`; break;
      case T.GIRDER: key = `tile/${theme}/girder`; break;
      case T.LADDER: key = 'prop/ladder'; break;
      case T.WATER: key = 'prop/water'; break;
      case T.HAZARD: key = 'prop/pipe'; break;
      case T.CRATE: key = `prop/crate${this.variant(tx, ty, 2)}`; break;
      case T.GLASS: key = 'prop/glass'; break;
      case T.SANDBAG: key = 'prop/sandbag'; break;
      case T.BARREL: key = 'prop/barrel'; break;
      default: key = null;
    }
    if (!key) return;
    if (!world.has(key)) {
      if (t === T.CRATE || t === T.SANDBAG) key = `tile/${theme}/solid`;
      else if (t === T.WATER) key = `tile/${theme}/back`;
      else return;
    }
    world.draw(ctx, key, dx, dy, 1, false);
    // حافة ضوء/ظل علوية على السطح (Hue shifting + تعتيم الحافة السفلية)
    if (t === T.TOP && (above === T.EMPTY || above === T.BACK)) {
      ctx.save();
      ctx.globalAlpha = 0.5;
      ctx.fillStyle = '#FFF1C9';
      ctx.fillRect(dx, dy, TS, 1);
      ctx.globalAlpha = 0.35;
      ctx.fillStyle = '#0B0D10';
      ctx.fillRect(dx, dy + TS - 1, TS, 1);
      ctx.restore();
    }
  }

  variant(tx, ty, max) {
    const h = ((tx * 374761393) ^ (ty * 668265263)) >>> 0;
    const v = h % (max + 1);
    return v === 0 ? '' : '_' + v;
  }

  // ------------------------------------------------------------- الإطار
  /**
   * يرسم إطارًا كاملًا.
   * @param {object} world عالم اللعبة
   * @param {object} cam الكاميرا
   * @param {object} view اللاعب (لمن نرسم الشاشة)
   * @param {number} dt
   * @param {object} opts إضافات (hud, menu, replay)
   */
  draw(world, cam, view, dt, opts = {}) {
    const ctx = this.main;
    const a = this.assets;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.imageSmoothingEnabled = false;
    this.deviceSc = { w: 1, h: 1, int: 1 };
    if (this.quality < 2 && (W * cam.zoom | 0) !== W) { /* التنعيم ممنوع دائمًا */ }
    this.lighting.begin(cam.trauma);
    this.updateWeather(dt);

    // 1) السماء + المنظر الخلفي (≥5 طبقات)
    this.drawSky(ctx, cam, world);
    if (this.enableParallax) this.drawParallax(ctx, cam);
    // ---- هنا يبدأ فضاء العالم (إحداثيات العالم) ----
    ctx.save();
    cam.apply(ctx);
    // 2) التضاريس الخلفية (جدران داخلية)
    this.drawTerrain(ctx, cam, world, 'back');
    this.drawTerrain(ctx, cam, world, 'main');
    // 3) الكيانات الخلفية: الأرضيات، فتحات السلالم، الماء
    this.drawWater(ctx, cam, world);
    this.particles.draw(ctx, a.get('vfx'), cam, 'back');
    // 4) الكيانات
    this.drawAirdrops(ctx, cam, world);
    this.drawPickups(ctx, cam, world);
    this.drawVehicles(ctx, cam, world);
    this.drawActors(ctx, cam, world, view, dt);
    this.drawProjectiles(ctx, cam, world);
    this.drawTracers(ctx, cam, world);
    this.drawDecals(ctx, cam, world);
    this.drawProps(ctx, cam, world);
    // 5) تفاصيل أمامية (عشب/أوراق أمام الكيانات) — عمق بصري فقط
    this.drawForeground(ctx, cam, world);
    this.particles.draw(ctx, a.get('vfx'), cam, 'top');
    this.drawZone(ctx, cam, world);
    ctx.restore();
    // ---- نهاية فضاء العالم ----
    // 6) الطقس (فضاء الشاشة)
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.imageSmoothingEnabled = false;
    this.drawWeather(ctx, cam, world);
    // 7) الإضاءة + ما بعد المعالجة
    this.lighting.update(dt);
    if (this.quality >= 1 && this.enableLighting) this.lighting.composite(ctx, cam, W, H);
    else if (this.lighting.flash > 0.01) {
      ctx.fillStyle = `rgba(255,255,255,${this.lighting.flash})`;
      ctx.fillRect(0, 0, W, H);
    }
    this.postfx.speedLines = view && view.alive ? clamp((Math.abs(view.vx) - 200) / 120, 0, 1) : 0;
    this.postfx.update(dt);
    if (this.quality >= 1 && this.enablePost) this.postfx.render(ctx, this.canvas);
    else if (this.postfx.damageFlash > 0.01) { /* الحد الأدنى فقط */ }
    return this.debug;
  }

  updateWeather(dt) {
    this.weatherT += dt;
    if (this.weather === 'rain' || this.weather === 'storm' || this.weather === 'snow') {
      if (this.rainDrops.length === 0) {
        for (let i = 0; i < 90; i++) {
          this.rainDrops.push({ x: Math.random() * W, y: Math.random() * H, s: 40 + Math.random() * 90, v: this.weather === 'snow' ? 18 + Math.random() * 22 : 260 + Math.random() * 220 });
        }
      }
      for (const d of this.rainDrops) {
        d.y += d.v * dt;
        if (this.weather !== 'snow') d.x -= d.s * dt * 0.35;
        else d.x += Math.sin((this.weatherT + d.y * 0.03) * 2) * 6 * dt;
        if (d.y > H) { d.y = -6; d.x = Math.random() * W; }
        if (d.x < -8) d.x = W + 4;
      }
    } else if (this.rainDrops.length) this.rainDrops.length = 0;
  }

  drawWeather(ctx, cam, world) {
    if (!this.rainDrops.length) return;
    ctx.save();
    if (this.weather === 'snow') {
      ctx.fillStyle = 'rgba(240,246,255,0.75)';
      for (const d of this.rainDrops) ctx.fillRect(d.x | 0, d.y | 0, 1, 1);
    } else {
      ctx.strokeStyle = 'rgba(190,210,235,0.32)';
      ctx.lineWidth = 1;
      for (const d of this.rainDrops) {
        ctx.beginPath();
        ctx.moveTo(d.x | 0, d.y | 0);
        ctx.lineTo((d.x - (this.weather === 'snow' ? 0 : 3)) | 0, (d.y + 9) | 0);
        ctx.stroke();
      }
      // ومضات برق في العواصف
      if (this.weather === 'storm' && Math.random() < 0.004) {
        ctx.fillStyle = 'rgba(255,255,255,0.5)';
        ctx.fillRect(0, 0, W, H);
        this.lighting.flash = 0.4;
      }
    }
    ctx.restore();
  }

  drawSky(ctx, cam, world) {
    const tod = this.lighting.timeOfDay;
    let top, bottom;
    if (tod < 0.2) { top = '#2A3550'; bottom = '#7A6A86'; }
    else if (tod < 0.45) { top = '#4E86C6'; bottom = '#A9D3E8'; }
    else if (tod < 0.62) { top = '#3B4E86'; bottom = '#E39A5C'; }
    else { top = '#0E1526'; bottom = '#25324E'; }
    // --- لوحة السماء المولّدة: تُرسم أولًا ثم يُغلَّف عليها تدرّج وقت اليوم
    //     بشفافية، فتبقى ألوان اللوحة داخل مزاج الخريطة نفسه.
    //     الأولوية: لوحة ثيم الخريطة (5 بيئات) ← لوحة القائمة ← لا شيء. ---
    const themeKey = (world && world.level && world.level.def && world.level.def.theme) || '';
    const themeArt = themeBackdropName(themeKey, tod);
    const isEnvArtName = !!themeArt;
    const artName = themeArt || ((tod < 0.2 || tod > 0.62) ? 'poster_loading' : 'key_art_menu');
    const art = backdropImages.get(artName)
      || backdropImages.get((tod < 0.2 || tod > 0.62) ? 'poster_loading' : 'key_art_menu');
    let artDrawn = false;
    if (art) {
      const prep = prepareBackdrop(artName, art);
      const dw = prep.width, dh = prep.height;
      const off = ((cam.left * 0.02) % dw + dw) % dw;
      const y = Math.round(-8 - cam.top * 0.01);
      for (let x = -off - dw; x < W + dw; x += dw) {
        ctx.drawImage(prep, Math.round(x), y);
      }
      artDrawn = true;
      this._envArtName = isEnvArtName ? artName : null;
    }
    const isEnvArt = artDrawn && isEnvArtName;
    // لوحة البيئة تحمل سماءها الخاصة ومزاجها (نهار/ليل) ⇒ تلوين خفيف جدًا فقط
    const aTop = isEnvArt ? 0.22 : 0.55;
    const aBottom = isEnvArt ? 0.34 : 0.30;
    const g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, artDrawn ? withAlpha(top, aTop) : top);
    g.addColorStop(1, artDrawn ? withAlpha(bottom, aBottom) : bottom);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
    // الشمس/القمر
    const sunX = W * (0.15 + tod * 0.7);
    const sunY = H * (0.28 + Math.abs(0.5 - tod) * 0.5);
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    const sunR = tod > 0.62 ? 7 : 10;
    const sg = ctx.createRadialGradient(sunX, sunY, 0, sunX, sunY, sunR * 3.2);
    const sunCol = tod > 0.62 ? '170,188,224' : tod > 0.45 ? '255,178,118' : '255,244,206';
    sg.addColorStop(0, `rgba(${sunCol},0.85)`);
    sg.addColorStop(0.3, `rgba(${sunCol},0.22)`);
    sg.addColorStop(1, `rgba(${sunCol},0)`);
    ctx.fillStyle = sg;
    ctx.beginPath();
    ctx.arc(sunX, sunY, sunR * 3.2, 0, TAU);
    ctx.fill();
    ctx.globalAlpha = 1;
    ctx.fillStyle = `rgb(${sunCol})`;
    ctx.beginPath();
    ctx.arc(sunX, sunY, sunR, 0, TAU);
    ctx.fill();
    ctx.restore();
  }

  drawParallax(ctx, cam) {
    const p = this.parallax;
    if (!p) return;
    if (p.stars) {
      const off = (cam.left * 0.03 + cam.top * 0.01) % p.stars.width;
      for (let x = -off - p.stars.width; x < W + p.stars.width; x += p.stars.width) {
        ctx.drawImage(p.stars, Math.round(x), Math.round(6 - cam.top * 0.02));
      }
    }
    const envArt = !!this._envArtName;   // لوحة بيئة معروضة ⇒ نخفّف الطبقات البعيدة
    let li = 0;
    for (const layer of p.layers) {
      const off = cam.left * layer.f;
      const yOff = cam.top * layer.fy;
      const tileW = layer.canvas.width;
      let x = -((off % tileW) + tileW) % tileW;
      const y = layer.y - yOff;
      // الطبقتان البعيدتان شبه شفافتين فوق اللوحة الفنية (منع الشكل الرمادي المسطّح)
      const a = envArt ? (li === 0 ? 0.35 : li === 1 ? 0.6 : 1) : 1;
      if (a !== 1) ctx.globalAlpha = a;
      while (x < W) {
        ctx.drawImage(layer.canvas, Math.round(x), Math.round(y));
        x += tileW;
      }
      if (a !== 1) ctx.globalAlpha = 1;
      li++;
    }
    // سحاب/ضباب أمامي متحرك
    if (p.front) {
      const off = (cam.left * 0.55 + this.weatherT * 6) % p.front.width;
      let x = -off;
      while (x < W) {
        ctx.save();
        ctx.globalAlpha = p.frontAlpha;
        ctx.drawImage(p.front, Math.round(x), p.frontY - cam.top * 0.4);
        ctx.restore();
        x += p.front.width;
      }
    }
  }

  drawTerrain(ctx, cam, world, which) {
    const S = 16 * TS;
    const v = cam.viewRect(TS);
    const c0 = Math.max(0, Math.floor(v.x / S));
    const c1 = Math.floor((v.x + v.w) / S);
    const r0 = Math.max(0, Math.floor(v.y / S));
    const r1 = Math.floor((v.y + v.h) / S);
    let n = 0;
    for (let cy = r0; cy <= r1; cy++) {
      for (let cx = c0; cx <= c1; cx++) {
        const e = this.chunkFor(cx, cy);
        if (which === 'back') { if (e.back.width > 1) { ctx.drawImage(e.back, cx * S, cy * S); n++; } }
        else { ctx.drawImage(e.canvas, cx * S, cy * S); n++; }
      }
    }
    this.debug.chunks = n;
  }

  /** عشب/تفاصيل أمام الكيانات — يعطي إحساس العمق بلا أن يغطي اللاعب */
  drawForeground(ctx, cam, world) {
    const theme = world.level.def.theme;
    if (theme === 'base' || world.level.def.theme === 'factory') return;
    const grassCol = { desert: ['#6E7A3A', '#8A9448'], forest: ['#2F4A2A', '#3C5C33'], village: ['#4E5A2E', '#66743C'], oasis: ['#546A3E', '#667E48'], city: ['#3E4A32', '#4C5A3C'], port: ['#3A4A34', '#48603C'] }[theme] || ['#3E4A32', '#4C5A3C'];
    const m = world.level.map;
    const v = cam.viewRect(TS);
    const x0 = Math.max(0, Math.floor(v.x / TS)), x1 = Math.min(m.w - 1, Math.floor((v.x + v.w) / TS));
    const y0 = Math.max(1, Math.floor(v.y / TS)), y1 = Math.min(m.h - 1, Math.floor((v.y + v.h) / TS));
    const t = this.weatherT;
    ctx.save();
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        if (m.get(x, y) !== T.TOP) continue;
        const above = m.get(x, y - 1);
        if (above !== T.EMPTY && above !== T.BACK) continue;
        // أوراق عشب صغيرة تتمايل مع الريح (2-4 بكسل)
        const seed = (x * 7349 + y * 131) % 97;
        const sway = Math.round(Math.sin(t * 1.6 + x * 0.4 + seed * 0.1));
        const n = 1 + (seed % 3);
        for (let k = 0; k < n; k++) {
          const bx = x * TS + 4 + ((seed * (k + 3)) % 24);
          const hgt = 2 + ((seed + k * 7) % 3);
          ctx.fillStyle = k % 2 ? grassCol[0] : grassCol[1];
          ctx.fillRect(bx + (k === 0 ? sway : 0), y * TS - hgt, 1, hgt);
        }
      }
    }
    ctx.restore();
  }

  drawWater(ctx, cam, world) {
    const lvl = world.level;
    const t = this.weatherT;
    const m = lvl.map;
    const v = cam.viewRect(TS);
    const x0 = Math.max(0, Math.floor(v.x / TS)), x1 = Math.min(m.w - 1, Math.floor((v.x + v.w) / TS));
    const y0 = Math.max(0, Math.floor(v.y / TS)), y1 = Math.min(m.h - 1, Math.floor((v.y + v.h) / TS));
    let any = false;
    for (let y = y0; y <= y1 && !any; y++) for (let x = x0; x <= x1; x++) if (m.get(x, y) === T.WATER) { any = true; break; }
    if (!any) return;
    const deep = '#17354F', mid = '#245A78', shallow = '#3E88A8';
    ctx.save();
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        if (m.get(x, y) !== T.WATER) continue;
        const surface = m.get(x, y - 1) !== T.WATER;
        const px = x * TS, py = y * TS;
        // عمق: كل ما نزل عن السطح يصبح أغمق (Hue shift)
        const depth = Math.min(4, y - this.waterTop(m, x, y));
        const col = depth <= 0 ? shallow : depth <= 1 ? mid : deep;
        ctx.globalAlpha = surface ? 0.82 : 0.9;
        ctx.fillStyle = col;
        ctx.fillRect(px, py, TS, TS);
        if (surface) {
          const wave = Math.sin(t * 2.2 + x * 0.7);
          ctx.globalAlpha = 0.75;
          ctx.fillStyle = '#9AD6F0';
          ctx.fillRect(px, py + Math.round(wave), TS, 1);
          ctx.globalAlpha = 0.4;
          ctx.fillStyle = '#D6F0FF';
          const w2 = 5 + Math.round(wave * 3);
          ctx.fillRect(px + 4 + Math.round(wave * 2), py + 1, w2, 1);
          ctx.globalAlpha = 0.25;
          ctx.fillStyle = '#0B0D10';
          ctx.fillRect(px, py + 2, TS, 1);
        }
      }
    }
    ctx.restore();
  }

  waterTop(m, x, y) {
    let yy = y;
    while (yy > 0 && m.get(x, yy - 1) === T.WATER) yy--;
    return yy;
  }

  drawProps(ctx, cam, world) {
    const worldAtlas = this.assets.get('world');
    if (!worldAtlas) return;
    const v = cam.viewRect(64);
    // ترتيب حسب y للعمق
    const visible = world.level.props.filter((p) => p.x > v.x - 64 && p.x < v.x + v.w + 64 && p.y > v.y - 96 && p.y < v.y + v.h + 96);
    visible.sort((a, b) => a.y - b.y);
    for (const p of visible) {
      const key = `prop/${p.type}${p.v ? '_' + p.v : ''}`;
      const k = worldAtlas.has(key) ? key : `prop/${p.type}`;
      worldAtlas.draw(ctx, k, Math.round(p.x), Math.round(p.y), 1, false);
      if (p.explosive) {
        // وميض أحمر تحذيري على البراميل المتفجرة
        ctx.save();
        ctx.globalAlpha = 0.35 + 0.25 * Math.sin(this.weatherT * 4 + p.x);
        ctx.fillStyle = '#FF6B4A';
        ctx.fillRect(Math.round(p.x) + 6, Math.round(p.y) + 8, 3, 3);
        ctx.restore();
      }
    }
  }

  // ------------------------------------------------------------- الكيانات
  drawActors(ctx, cam, world, view, dt) {
    const v = cam.viewRect(96);
    const ordered = world.actors
      .filter((a) => a.x + a.w > v.x && a.x < v.x + v.w && a.y + a.h > v.y - 64 && a.y < v.y + v.h + 64)
      .sort((a, b) => (a.y + a.h) - (b.y + b.h));
    for (const a of ordered) {
      this.drawActor(ctx, cam, world, a, view, dt);
    }
    this.debug.draws = ordered.length;
  }

  drawActor(ctx, cam, world, a, view, dt) {
    const chars = this.assets.get('char_' + a.opKey);
    if (!chars) return;
    // 1) تقدّم الحركة
    const key = a.id;
    let at = this.animTime.get(key) || 0;
    const moving = Math.abs(a.vx) > 8;
    let anim = STATE_ANIM[a.state] || 'idle';
    if (a.dbno) anim = 'dbno';
    if (a.prone && (a.state === 'idle' || a.state === 'walk')) anim = moving ? 'crawl' : 'prone';
    if (!a.alive) anim = 'death' + (a.deathVariant || 0);
    const meta = this.charMeta || (this.assets.json ? this.assets.json.get('characters_meta.json') : null) || {};
    const info = meta && meta.anims ? meta.anims[anim] : null;
    const fps = info && info.fps ? info.fps : 12;
    const frames = info && info.frames ? info.frames : 1;
    if (!chars.has(`${a.opKey}/${anim}/0`)) anim = 'idle';
    const frameCount = (meta && meta.anims && meta.anims[anim]) ? meta.anims[anim].frames : frames;
    if (moving || ACTIONS.includes(anim) || anim.startsWith('death')) at += dt;
    else at += dt * 0.35;
    this.animTime.set(key, at);

    // توقيت المقطع: المقاطع القتالية تشغّل مرة واحدة بحسب مؤقت الحالة
    let fi = Math.floor(at * fps) % Math.max(1, frameCount);
    if (ACTIONS.includes(anim) && a.stateTimer != null) {
      const total = frameCount / fps;
      fi = clamp(Math.floor((a.stateTimer / Math.max(0.08, a.actionTime || total)) * frameCount), 0, frameCount - 1);
    } else if (anim.startsWith('death')) {
      fi = clamp(Math.floor((1 - clamp(a.deathTimer / 0.9, 0, 1)) * frameCount * -1 + frameCount), 0, frameCount - 1);
      fi = frameCount - 1 - clamp(Math.floor(a.deathTimer * fps), 0, frameCount - 1);
    } else if (anim === 'jump' || anim === 'walljump') {
      fi = clamp(Math.floor(at * fps), 0, frameCount - 1);
    }
    fi = clamp(fi, 0, frameCount - 1);
    const frameKey = `${a.opKey}/${anim}/${fi}`;

    const metaP = meta || {};
    const canvasW = metaP.canvas ? metaP.canvas[0] : 96;
    const canvasH = metaP.canvas ? metaP.canvas[1] : 78;
    const originX = metaP.origin ? metaP.origin[0] : 40;
    const baseline = metaP.baseline != null ? metaP.baseline : 64;

    const feetY = a.y + a.h;
    const pivotX = a.cx;
    // الظل
    const groundY = this.groundBelow(world, a.cx, feetY);
    if (groundY != null) {
      const d = clamp(1 - (groundY - feetY) / 120, 0.15, 1);
      ctx.save();
      ctx.globalAlpha = 0.34 * d;
      ctx.fillStyle = '#0B0D10';
      ctx.beginPath();
      ctx.ellipse(Math.round(pivotX), Math.round(groundY), 11 * d + 3, 3.4, 0, 0, TAU);
      ctx.fill();
      ctx.restore();
    }
    // وميض الإصابة
    const hitK = a.hitFlash > 0 ? clamp(a.hitFlash / 0.2, 0, 1) : 0;
    const flip = a.facing < 0;
    const blink = a.spawnProtect > 0 && (Math.floor(this.weatherT * 18) % 2 === 0);
    ctx.save();
    if (hitK > 0) {
      // وميض أبيض عند الإصابة: نرسم الإطار ثم نطلي البكسلات الظاهرة فقط
      ctx.globalAlpha = 1 - blink * 0.45;
      this.spritePivot(ctx, chars, frameKey, pivotX, feetY, [originX, baseline], flip);
      ctx.save();
      ctx.globalCompositeOperation = 'source-atop';
      ctx.globalAlpha = hitK * 0.7;
      ctx.fillStyle = '#FFFFFF';
      ctx.fillRect(0, 0, W, H);
      ctx.restore();
    } else {
      ctx.globalAlpha = blink ? 0.55 : 1;
      this.spritePivot(ctx, chars, frameKey, pivotX, feetY, [originX, baseline], flip);
    }
    ctx.restore();

    // 2) الذراعان + السلاح (الصور مرسومة مسبقًا بزوايا، بلا دوران حر)
    if (a.alive && !a.dbno) this.drawArmsAndWeapon(ctx, a, metaP, pivotX, feetY, originX, baseline, flip);
    // 3) مؤشرات صغيرة: حالة الجيت باك، إعادة الإحياء، أسماء للفريق
    this.drawActorOverlay(ctx, a, world, view, pivotX, feetY);
  }

  /**
   * يرسم إطارًا مثبّتًا على "نقطة ارتساء" (Anchor) داخل إطار الرسم الأصلي.
   *
   * كل الأطالس تحمل offset (موضع الإطار المقصوص داخل الإطار الأصلي)، لذا:
   *   destX = pivotX - anchor.x + offset.x
   * وعند القلب نعكس حول محور نقطة الارتساء نفسها (لا حول الإطار المقصوص)
   * حتى تبقى الشخصية متمركزة على قدميها تمامًا.
   */
  spritePivot(ctx, atlas, key, pivotX, pivotY, anchor, flip = false) {
    if (!atlas) return false;
    const f = atlas.frame(key);
    if (!f) return false;
    const [ox, oy] = atlas.offset(key);
    const ax = anchor[0], ay = anchor[1];
    if (flip) {
      ctx.save();
      ctx.translate(Math.round(pivotX), Math.round(pivotY));
      ctx.scale(-1, 1);
      ctx.drawImage(atlas.image, f.x, f.y, f.w, f.h,
        Math.round(ox - ax), Math.round(oy - ay), f.ox, f.oy);
      ctx.restore();
    } else {
      ctx.drawImage(atlas.image, f.x, f.y, f.w, f.h,
        Math.round(pivotX - ax + ox), Math.round(pivotY - ay + oy), f.ox, f.oy);
    }
    return true;
  }

  /** يختار أقرب زاوية مرسومة مسبقًا من قائمة */
  nearestAngle(list, deg) {
    let best = list[0], bd = 1e9;
    for (const ang of list) {
      let d = Math.abs(ang - deg);
      if (d > 180) d = 360 - d;
      if (d < bd) { bd = d; best = ang; }
    }
    return best;
  }

  /**
   * الأذرع + السلاح.
   *
   * - الأذرع والأسلحة كلها صور مرسومة مسبقًا بزوايا ثابتة (ممنوع الدوران الحر).
   * - الأذرع على نفس كانفس الشخصية (96×78) وتُثبَّت على محور الشخصية نفسه
   *   (origin) مع القلب عند الاتجاه لليسار.
   * - موضع الكف الحقيقي مأخوذ من الهيكل (hand_anchor) فيُثبَّت السلاح على اليد
   *   تمامًا بلا تقريب.
   */
  drawArmsAndWeapon(ctx, a, meta, pivotX, feetY, originX, baseline, flip) {
    const arms = this.assets.get('arms');
    if (!arms) return;
    const posture = a.jetpackOn ? 'jet' : (a.prone ? 'prone' : (a.crouch ? 'crouch' : 'stand'));
    const deg = a.aimAngle * 180 / Math.PI;
    let armDeg = deg;
    if (flip) {
      armDeg = 180 - deg;
      if (armDeg > 180) armDeg -= 360;
      if (armDeg < -180) armDeg += 360;
    }
    const list = (arms.meta && arms.meta.angles) || [0, 15, 30, 45, 60, 90, 120, 135, 150, 165, 180, -15, -30, -45, -60, -90, -120, -135, -150, -165];
    const keyDeg = this.nearestAngle(list, armDeg);
    let keyTry = `${a.opKey}/armframe/${posture}/${keyDeg}`;
    if (!arms.has(keyTry)) keyTry = `${a.opKey}/armframe/stand/${keyDeg}`;
    if (!arms.has(keyTry)) keyTry = `${a.opKey}/armframe/stand/0`;
    // نقطة أصل الكانفس على الشاشة (نفس تحويل الجسم تمامًا)
    const canvasOX = flip ? (pivotX + originX) : (pivotX - originX);
    const canvasOY = feetY - baseline;
    this.spritePivot(ctx, arms, keyTry, pivotX, feetY, [originX, baseline], flip);

    // ---- السلاح ----
    const weapons = this.assets.get('weapons');
    const wid = a.weaponId || 'n9';
    const wdef = WEAPONS[wid] || WEAPONS.n9;
    // موضع الكف: من جدول hand_anchor (إحداثيات كانفس 96×78) ثم يُحوّل للشاشة
    const ha = (meta.hand_anchor) ? meta.hand_anchor[`${posture}/${keyDeg}`] : null;
    const reach = (meta.arm_anchor && meta.arm_anchor[posture] && meta.arm_anchor[posture].reach) || 11.4;
    let handX, handY;
    if (ha) {
      handX = flip ? (canvasOX - ha[0]) : (canvasOX + ha[0]);
      handY = canvasOY + ha[1];
    } else {
      const ax = (meta.arm_anchor && meta.arm_anchor[posture]) || { x: 27.2, y: 29.4 };
      const sx = canvasOX + (flip ? -ax.x : ax.x);
      const sy = canvasOY + ax.y;
      handX = sx + Math.cos(a.aimAngle) * (reach + 2.2);
      handY = sy + Math.sin(a.aimAngle) * (reach + 2.2);
    }
    let muzzleLen = 16;
    if (weapons && wdef) {
      const wlist = (weapons.meta && weapons.meta.angles) || [0, 15, 30, 45, 60, 90, -15, -30, -45, -60, -90, 180, 135];
      let useDeg = deg;
      let mirror = false;
      if (deg > 90 || deg < -90) {
        useDeg = deg > 90 ? 180 - deg : -180 - deg;
        mirror = true;
      }
      const best = this.nearestAngle(wlist, useDeg);
      const wkey = `${wid}/${best}`;
      const anchors = (weapons.meta && weapons.meta.anchors) ? weapons.meta.anchors : null;
      const anc = anchors && anchors[wkey] ? anchors[wkey] : null;
      const grip = anc ? anc.grip : [8, 12];
      const muz = anc ? anc.muzzle : [30, 12];
      muzzleLen = Math.hypot(muz[0] - grip[0], muz[1] - grip[1]) || 16;
      if (!this.spritePivot(ctx, weapons, wkey, handX, handY, grip, mirror)) {
        this.spritePivot(ctx, weapons, `${wid}/0`, handX, handY, grip, mirror);
      }
    }
    a.muzzleX = handX + Math.cos(a.aimAngle) * muzzleLen;
    a.muzzleY = handY + Math.sin(a.aimAngle) * muzzleLen;
    a.handX = handX;
    a.handY = handY;
  }

  drawActorOverlay(ctx, a, world, view, cx, feetY) {
    const isView = view && a.id === view.id;
    const sameTeam = view && view.team === a.team;
    // شريط الصحة للأعداء عند الإصابة
    if (!isView && a.alive && a.hp < a.maxHp * 0.99 && !a.isBot) {
      const w = 26, hp = clamp(a.hp / a.maxHp, 0, 1);
      ctx.save();
      ctx.fillStyle = 'rgba(11,13,16,0.75)';
      ctx.fillRect(Math.round(cx - w / 2) - 1, Math.round(a.y - 10) - 1, w + 2, 5);
      ctx.fillStyle = a.team === 0 ? '#4FD1C5' : '#E8734A';
      ctx.fillRect(Math.round(cx - w / 2), Math.round(a.y - 10), Math.round(w * hp), 3);
      ctx.restore();
    }
    // شريط إعادة الإحياء
    if (a.dbno && a.reviveProgress > 0.01) {
      const w = 24;
      ctx.save();
      ctx.fillStyle = 'rgba(11,13,16,0.8)';
      ctx.fillRect(Math.round(cx - w / 2), Math.round(feetY - 6), w, 3);
      ctx.fillStyle = '#8CE99A';
      ctx.fillRect(Math.round(cx - w / 2), Math.round(feetY - 6), Math.round(w * a.reviveProgress), 3);
      ctx.restore();
    }
    // مؤشر "يُعاد إحياؤه" و"مُطرح"
    if (a.dbno && a.alive) {
      const t = this.weatherT * 5;
      const alpha = 0.55 + 0.35 * Math.sin(t);
      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.fillStyle = '#F2C14E';
      ctx.fillRect(Math.round(cx) - 2, Math.round(a.y - 16) - 2, 5, 2);
      ctx.fillRect(Math.round(cx) - 2, Math.round(a.y - 16), 2, 5);
      ctx.fillRect(Math.round(cx) + 1, Math.round(a.y - 16), 2, 5);
      ctx.restore();
    }
    // نبضة الشخصية المهمة (VIP)
    if (a.isVip) {
      ctx.save();
      ctx.globalAlpha = 0.6 + 0.4 * Math.sin(this.weatherT * 4);
      ctx.strokeStyle = '#F2C14E';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(Math.round(cx), Math.round(a.y - 4), 13, 0, TAU);
      ctx.stroke();
      ctx.restore();
    }
  }

  groundBelow(world, x, y) {
    const m = world.level.map;
    const tx = Math.floor(x / TS);
    let ty = Math.floor(y / TS);
    for (let i = 0; i < 14; i++) {
      if (ty + i >= m.h) break;
      if (SOLID_TILES.has(m.get(tx, ty + i))) return (ty + i) * TS;
    }
    return null;
  }

  drawPickups(ctx, cam, world) {
    const v = cam.viewRect(48);
    const worldAtlas = this.assets.get('world');
    const ui = this.assets.get('ui');
    for (const p of world.pickups) {
      if (!p.active) continue;
      if (p.x < v.x - 48 || p.x > v.x + v.w + 48) continue;
      // وميض ترحيبي حسب النُدرة
      const col = p.color || '#F2C14E';
      ctx.save();
      const bob = Math.sin(this.weatherT * 2.6 + p.x * 0.05) * 1.5;
      ctx.globalAlpha = 0.25;
      ctx.fillStyle = col;
      ctx.beginPath();
      ctx.ellipse(Math.round(p.cx), Math.round(p.cy + 8), 9, 3, 0, 0, TAU);
      ctx.fill();
      ctx.restore();
      if (p.icon && ui && ui.has('ui/' + p.icon)) {
        ui.draw(ctx, 'ui/' + p.icon, Math.round(p.cx - 5), Math.round(p.cy - 6 + bob), 1, false);
      } else if (p.sprite && worldAtlas && worldAtlas.has('prop/' + p.sprite)) {
        worldAtlas.draw(ctx, 'prop/' + p.sprite, Math.round(p.cx - 6), Math.round(p.cy - 6 + bob), 1, false);
      } else {
        ctx.fillStyle = col;
        ctx.fillRect(Math.round(p.cx - 4), Math.round(p.cy - 4 + bob), 8, 8);
        ctx.fillStyle = '#0B0D10';
        ctx.fillRect(Math.round(p.cx - 4), Math.round(p.cy - 4 + bob), 8, 1);
      }
      // لمعة
      ctx.save();
      ctx.globalAlpha = 0.5 + 0.3 * Math.sin(this.weatherT * 3 + p.cy);
      ctx.fillStyle = '#FFFFFF';
      ctx.fillRect(Math.round(p.cx + 3), Math.round(p.cy - 5 + bob), 1, 1);
      ctx.restore();
    }
  }

  drawProjectiles(ctx, cam, world) {
    const vfx = this.assets.get('vfx');
    for (const p of world.projectiles) {
      if (!p.active) continue;
      if (p.kind === 'grenade' || p.kind === 'flare') {
        ctx.save();
        if (p.kind === 'grenade') {
          ctx.fillStyle = '#4A5240';
          ctx.fillRect(Math.round(p.cx) - 2, Math.round(p.cy) - 2, 4, 5);
          ctx.fillStyle = '#2C3327';
          ctx.fillRect(Math.round(p.cx) - 2, Math.round(p.cy) - 3, 4, 1);
          // مؤشر وميض قبل الانفجار
          if (p.life < 0.9) {
            ctx.globalAlpha = 0.6 + 0.4 * Math.sin(this.weatherT * 30);
            ctx.fillStyle = '#FF4A3A';
            ctx.fillRect(Math.round(p.cx) - 1, Math.round(p.cy) - 5, 2, 2);
          }
        } else {
          ctx.globalAlpha = 0.9;
          ctx.fillStyle = '#FFB347';
          ctx.fillRect(Math.round(p.cx) - 6, Math.round(p.cy) - 6, 12, 12);
          ctx.fillStyle = 'rgba(255,220,140,0.5)';
          ctx.fillRect(Math.round(p.cx) - 9, Math.round(p.cy) - 9, 18, 18);
        }
        ctx.restore();
        continue;
      }
      if (!p.trail) p.trail = [];
      p.trail.push({ x: p.x, y: p.y, life: 0.06 });
      if (p.trail.length > 5) p.trail.shift();
      ctx.save();
      for (let i = 0; i < p.trail.length; i++) {
        const t = p.trail[i];
        ctx.globalAlpha = 0.12 + i * 0.07;
        ctx.fillStyle = p.color || '#FFE9A8';
        ctx.fillRect(Math.round(t.x), Math.round(t.y), 2, 1);
      }
      ctx.globalAlpha = 1;
      ctx.fillStyle = p.color || '#FFF3C4';
      ctx.fillRect(Math.round(p.x), Math.round(p.y), 2, 1);
      ctx.restore();
    }
  }

  drawTracers(ctx, cam, world) {
    ctx.save();
    for (const t of world.tracers) {
      ctx.globalAlpha = clamp(t.life / 0.07, 0, 1) * 0.85;
      ctx.strokeStyle = t.color || '#FFD98A';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(Math.round(t.x0), Math.round(t.y0));
      ctx.lineTo(Math.round(t.x1), Math.round(t.y1));
      ctx.stroke();
    }
    ctx.restore();
  }

  drawDecals(ctx, cam, world) {
    ctx.save();
    for (const d of world.decals) {
      const a = clamp(d.life / d.maxLife, 0, 1);
      ctx.globalAlpha = a * 0.7;
      if (d.kind === 'scorch') {
        ctx.fillStyle = '#12100E';
        ctx.beginPath();
        ctx.ellipse(Math.round(d.x), Math.round(d.y), d.scale, d.scale * 0.4, 0, 0, TAU);
        ctx.fill();
      } else {
        ctx.fillStyle = '#0B0D10';
        ctx.fillRect(Math.round(d.x), Math.round(d.y), 2, 2);
      }
    }
    ctx.restore();
  }

  drawVehicles(ctx, cam, world) {
    const v = cam.viewRect(64);
    for (const veh of world.vehicles) {
      if (!veh.active) continue;
      if (veh.x < v.x - 64 || veh.x > v.x + v.w + 64) continue;
      ctx.save();
      const body = veh.type === 'bike' ? '#5A4A38' : veh.type === 'drone' ? '#3E4A56' : '#4A5240';
      const dark = '#22262B';
      // الجسد
      ctx.fillStyle = dark;
      ctx.fillRect(Math.round(veh.x) - 1, Math.round(veh.y) - 1, veh.w + 2, veh.h + 2);
      ctx.fillStyle = body;
      ctx.fillRect(Math.round(veh.x), Math.round(veh.y), veh.w, veh.h);
      ctx.fillStyle = '#1B2026';
      ctx.fillRect(Math.round(veh.x), Math.round(veh.y + veh.h - 4), veh.w, 4);
      // عجلات
      ctx.fillStyle = '#14181C';
      ctx.beginPath();
      ctx.arc(Math.round(veh.x + 5), Math.round(veh.y + veh.h + 1), 3, 0, TAU);
      ctx.arc(Math.round(veh.x + veh.w - 5), Math.round(veh.y + veh.h + 1), 3, 0, TAU);
      ctx.fill();
      // تفاصيل
      ctx.fillStyle = '#8FA0AE';
      ctx.fillRect(Math.round(veh.x + 3), Math.round(veh.y + 2), 5, 3);
      if (veh.type === 'mg') {
        ctx.fillStyle = '#2C3327';
        ctx.fillRect(Math.round(veh.x + veh.w / 2), Math.round(veh.y - 6), 12, 2);
        ctx.fillRect(Math.round(veh.x + veh.w / 2 + 10), Math.round(veh.y - 8), 2, 6);
      }
      // شريط الصحة
      if (veh.hp < veh.maxHp) {
        ctx.fillStyle = '#0B0D10';
        ctx.fillRect(Math.round(veh.x) - 1, Math.round(veh.y) - 12, veh.w + 2, 4);
        ctx.fillStyle = '#7FD2F5';
        ctx.fillRect(Math.round(veh.x), Math.round(veh.y) - 11, Math.round(veh.w * clamp(veh.hp / veh.maxHp, 0, 1)), 2);
      }
      ctx.restore();
    }
  }

  drawAirdrops(ctx, cam, world) {
    const worldAtlas = this.assets.get('world');
    for (const ad of world.airdrops) {
      ctx.save();
      // المظلة
      const sway = Math.sin(this.weatherT * 1.6 + ad.x * 0.01) * 4;
      ctx.fillStyle = '#E8734A';
      ctx.beginPath();
      ctx.moveTo(Math.round(ad.x - 14 + sway), Math.round(ad.y - 30));
      ctx.lineTo(Math.round(ad.x + sway), Math.round(ad.y - 46));
      ctx.lineTo(Math.round(ad.x + 14 + sway), Math.round(ad.y - 30));
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = '#F2C14E';
      ctx.fillRect(Math.round(ad.x - 4 + sway), Math.round(ad.y - 38), 8, 8);
      // الحبال + الصندوق
      ctx.strokeStyle = '#C8CBB8';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(Math.round(ad.x - 12 + sway), Math.round(ad.y - 30));
      ctx.lineTo(Math.round(ad.x - 5), Math.round(ad.y - 12));
      ctx.moveTo(Math.round(ad.x + 12 + sway), Math.round(ad.y - 30));
      ctx.lineTo(Math.round(ad.x + 5), Math.round(ad.y - 12));
      ctx.stroke();
      if (worldAtlas) worldAtlas.draw(ctx, 'prop/crate', Math.round(ad.x) - 8, Math.round(ad.y) - 12, 1, false);
      else {
        ctx.fillStyle = '#8A6A3A';
        ctx.fillRect(Math.round(ad.x) - 8, Math.round(ad.y) - 12, 16, 14);
      }
      // وهج ذهبي
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = 0.25 + 0.15 * Math.sin(this.weatherT * 3);
      ctx.fillStyle = '#FFD36E';
      ctx.beginPath();
      ctx.arc(Math.round(ad.x), Math.round(ad.y), 20, 0, TAU);
      ctx.fill();
      ctx.restore();
    }
  }

  drawZone(ctx, cam, world) {
    const z = world.zone;
    if (!z) return;
    ctx.save();
    // دائرة المنطقة الآمنة
    ctx.strokeStyle = z.state === 'idle' ? 'rgba(120,220,255,0.75)' : 'rgba(255,90,90,0.85)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(z.cx, z.cy, z.radius, 0, TAU);
    ctx.stroke();
    if (z.targetRadius < z.radius) {
      ctx.strokeStyle = 'rgba(255,255,255,0.4)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(z.tx != null ? z.tx : z.cx, z.ty != null ? z.ty : z.cy, z.targetRadius, 0, TAU);
      ctx.stroke();
    }
    ctx.restore();
  }

  /** خريطة مصغّرة (تُستخدم في الواجهة وكخلفية لشاشة النتائج) */
  drawMinimap(ctx, x, y, w, h, world, view, opts = {}) {
    if (!this.minimap) return;
    const sx = this.minimap.width / world.level.width;
    const sy = this.minimap.height / world.level.height;
    ctx.save();
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(this.minimap, 0, 0, this.minimap.width, this.minimap.height, x, y, w, h);
    // المنطقة الآمنة
    if (world.zone) {
      ctx.strokeStyle = world.zone.state === 'idle' ? '#7FD2F5' : '#FF5A5A';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(x + world.zone.cx * sx * (w / (this.minimap.width * 1)) * (this.minimap.width / world.level.width), y + world.zone.cy * sy, world.zone.radius * (w / world.level.width), 0, TAU);
      ctx.stroke();
    }
    // اللاعبون
    for (const a of world.actors) {
      if (!a.alive) continue;
      if (opts.onlyTeam != null && a.id !== (view && view.id) && a.team !== opts.onlyTeam) continue;
      const px = x + a.cx * (w / world.level.width);
      const py = y + a.cy * (h / world.level.height);
      const isMe = view && a.id === view.id;
      ctx.fillStyle = isMe ? '#FFFFFF' : (a.team === 0 ? '#4FD1C5' : a.team === 1 ? '#E8734A' : '#F2C14E');
      const s = isMe ? 3 : 2;
      ctx.fillRect(Math.round(px - s / 2), Math.round(py - s / 2), s, s);
    }
    // الأسلحة الساقطة
    for (const p of world.pickups) {
      if (!p.active || p.data.kind !== 'weapon') continue;
      ctx.fillStyle = '#F2C14E';
      ctx.fillRect(Math.round(x + p.cx * (w / world.level.width)), Math.round(y + p.cy * (h / world.level.height)), 1, 1);
    }
    ctx.restore();
  }
}

// ---------------------------------------------------------------------------
// توليد طبقات المنظر الخلفي برمجيًا (لا صور خارجية — القسم 15.3)
// 5 طبقات: جبال بعيدة، تلال، مبانٍ/أشجار، ضباب، سحاب.
// ---------------------------------------------------------------------------
// ---------------------------------------------------------------------------
// طبقات منظر مبنية على صور مولّدة (لوحتا القسم 15.2: مدينة الغروب + بوستر الليل)
// تُستخدم كطبقتين إضافيتين حين تتوفر الصور في web/assets/backdrops/.
// ---------------------------------------------------------------------------
export const BACKDROPS = {
  key_art_menu: 'backdrops/key_art_menu.png',
  poster_loading: 'backdrops/poster_loading.png',
};
export const backdropImages = new Map();

export function setBackdrop(name, img) {
  backdropImages.set(name, img);
}

/** مسارات اللوحات المولّدة (نسبة إلى Assets.base = "assets/") */
export const BACKDROP_FILES = {
  key_art_menu: 'backdrops/key_art_menu.png',
  poster_loading: 'backdrops/poster_loading.png',
  bg_parallax_desert: 'backdrops/bg_parallax_desert.png',
  bg_parallax_forest_night: 'backdrops/bg_parallax_forest_night.png',
  bg_parallax_factory: 'backdrops/bg_parallax_factory.png',
  bg_parallax_snow: 'backdrops/bg_parallax_snow.png',
  bg_parallax_space: 'backdrops/bg_parallax_space.png',
  bg_parallax_coast: 'backdrops/bg_parallax_coast.png',
  bg_parallax_oasis_night: 'backdrops/bg_parallax_oasis_night.png',
  bg_parallax_sea_storm: 'backdrops/bg_parallax_sea_storm.png',
  bg_parallax_naval_base: 'backdrops/bg_parallax_naval_base.png',
};

/**
 * ثيم الخريطة → لوحة المنظر الخاصة بها (طبقات عمق 5 لكل بيئة).
 * أي ثيم غير مذكور يسقط على لوحة القائمة الرئيسية.
 */
export const THEME_BACKDROP = {
  // القيمة إما اسم لوحة واحدة، أو {day, night} لاختيار اللوحة حسب وقت الخريطة
  desert: { day: 'bg_parallax_desert', night: 'bg_parallax_oasis_night' },
  oasis: { day: 'bg_parallax_desert', night: 'bg_parallax_oasis_night' },
  village: { day: 'bg_parallax_desert', night: 'bg_parallax_oasis_night' },
  ruins: { day: 'bg_parallax_desert', night: 'bg_parallax_oasis_night' },
  forest: 'bg_parallax_forest_night',
  nightbase: 'bg_parallax_forest_night',
  base: 'bg_parallax_factory',
  factory: 'bg_parallax_factory',
  city: { day: 'bg_parallax_city_dusk', night: 'bg_parallax_factory' },
  port: { day: 'bg_parallax_naval_base', night: 'bg_parallax_sea_storm' },
  snow: 'bg_parallax_snow',
  mountain: 'bg_parallax_snow',
  space: 'bg_parallax_space',
  station: 'bg_parallax_space',
  scifi: 'bg_parallax_space',
};

/** يختار اسم لوحة الثيم حسب وقت اليوم (نهار/ليل) */
export function themeBackdropName(theme, tod) {
  const v = THEME_BACKDROP[theme];
  if (!v) return null;
  const night = tod < 0.2 || tod > 0.62;
  return typeof v === 'string' ? v : (night ? v.night : v.day);
}

/**
 * يحمّل لوحات المنظر المولّدة. تُستخدم من التطبيق ومن أدوات اللقطات معًا،
 * وغياب أي صورة لا يُفشل الإقلاع (تعمل اللعبة بالطبقات البرمجية وحدها).
 */
export async function loadBackdrops(Assets, onWarn) {
  for (const [name, path] of Object.entries(BACKDROP_FILES)) {
    try {
      setBackdrop(name, await Assets.loadImage(path));
    } catch (e) {
      if (onWarn) onWarn(name);
    }
  }
  return backdropImages.size;
}

const _preparedBackdrops = new Map();

/**
 * يجهّز لوحة المنظر للرسم: اختزال بعدد صحيح (×3) + تلاشٍ سفلي متدرّج
 * حتى لا تتصادم أرضية اللوحة مع تضاريس اللعبة الفعلية.
 */
function prepareBackdrop(name, img) {
  if (_preparedBackdrops.has(name)) return _preparedBackdrops.get(name);
  const sc = 3;
  const dw = Math.ceil(img.width / sc);
  const dh = Math.ceil(img.height / sc);
  const cv = document.createElement('canvas');
  cv.width = dw;
  cv.height = dh;
  const c = cv.getContext('2d');
  c.imageSmoothingEnabled = false;
  c.drawImage(img, 0, 0, img.width, img.height, 0, 0, dw, dh);
  // تلاشٍ سفلي: آخر 34% من اللوحة يتلاشى تدريجيًا
  c.globalCompositeOperation = 'destination-out';
  const g = c.createLinearGradient(0, dh * 0.66, 0, dh);
  g.addColorStop(0, 'rgba(0,0,0,0)');
  g.addColorStop(1, 'rgba(0,0,0,1)');
  c.fillStyle = g;
  c.fillRect(0, dh * 0.66, dw, dh * 0.34);
  c.globalCompositeOperation = 'source-over';
  _preparedBackdrops.set(name, cv);
  return cv;
}

function withAlpha(hex, a) {
  const h = hex.replace('#', '');
  const n = parseInt(h.length === 3 ? h.replace(/./g, (c) => c + c) : h, 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}

export function buildParallax(theme, seed) {
  const rng = new RNG(seed + 77);
  const palettes = {
    desert: { far: ['#B79A62', '#8E7440'], mid: ['#A8834E', '#7E5E32'], near: ['#7C5C34', '#5A4224'], haze: 'rgba(226,200,150,0.30)', night: false },
    base: { far: ['#5A6878', '#434E5C'], mid: ['#46525F', '#333D48'], near: ['#2B333D', '#1E242B'], haze: 'rgba(120,136,152,0.24)', night: true },
    city: { far: ['#8B98A6', '#6C7885'], mid: ['#6B7885', '#515C68'], near: ['#454F5B', '#333B45'], haze: 'rgba(170,184,198,0.26)', night: false },
    forest: { far: ['#6D8A5C', '#4F6A44'], mid: ['#516D46', '#38502F'], near: ['#33482C', '#22331E'], haze: 'rgba(150,178,140,0.26)', night: false },
    village: { far: ['#9C8B62', '#7A6A48'], mid: ['#7A6848', '#5C4E34'], near: ['#4E4230', '#3A3024'], haze: 'rgba(196,182,146,0.26)', night: false },
    factory: { far: ['#767B84', '#585D66'], mid: ['#585D66', '#43474F'], near: ['#383C43', '#282B31'], haze: 'rgba(140,146,158,0.24)', night: true },
    nightbase: { far: ['#2B3450', '#1C2338'], mid: ['#1F2740', '#141A2A'], near: ['#121724', '#0A0D15'], haze: 'rgba(40,54,84,0.34)', night: true },
    ruins: { far: ['#9A9384', '#7B7466'], mid: ['#7A7365', '#5F594E'], near: ['#4F4A40', '#3A362E'], haze: 'rgba(180,174,158,0.26)', night: false },
    oasis: { far: ['#A8BC84', '#84A065'], mid: ['#88A066', '#667E4C'], near: ['#5A7042', '#42562F'], haze: 'rgba(206,216,176,0.26)', night: false },
    port: { far: ['#889AA4', '#6B7C86'], mid: ['#68767F', '#4F5B63'], near: ['#3F484E', '#2E353A'], haze: 'rgba(170,186,196,0.26)', night: false },
  };
  const pal = palettes[theme] || palettes.city;
  const shape = theme === 'forest' ? 'trees' : (theme === 'city' || theme === 'base' || theme === 'factory') ? 'city' : 'ridge';
  const layers = [
    { f: 0.08, fy: 0.02, y: 26, style: 'ridge', colors: pal.far, height: 104, step: 62, detail: 'dither' },
    { f: 0.16, fy: 0.05, y: 54, style: shape === 'trees' ? 'trees' : 'ridge', colors: pal.mid, height: 86, step: 42, detail: 'dither' },
    { f: 0.28, fy: 0.09, y: 84, style: shape, colors: pal.near, height: 66, step: 30, detail: 'solid' },
    { f: 0.40, fy: 0.13, y: 112, style: shape === 'city' ? 'citySmall' : 'ridgeSmall', colors: [pal.near[1], '#0B0D10'], height: 46, step: 22, detail: 'silhouette' },
  ].map((d) => {
    const cv = document.createElement('canvas');
    cv.width = 480;
    cv.height = 190;
    const ctx = cv.getContext('2d');
    ctx.imageSmoothingEnabled = false;
    drawParallaxShape(ctx, d, rng, pal);
    return { canvas: cv, f: d.f, fy: d.fy, y: d.y };
  });

  // طبقة النجوم ليلاً
  let stars = null;
  if (pal.night) {
    stars = document.createElement('canvas');
    stars.width = 320; stars.height = 120;
    const sctx = stars.getContext('2d');
    for (let i = 0; i < 90; i++) {
      const b = rng.next();
      sctx.fillStyle = b > 0.85 ? '#FFFFFF' : b > 0.5 ? '#C8D4F0' : '#8E9BC4';
      sctx.fillRect(Math.round(rng.range(0, 320)), Math.round(rng.range(0, 100)), 1, 1);
    }
  }
  const cloud = document.createElement('canvas');
  cloud.width = 320;
  cloud.height = 90;
  drawClouds(cloud.getContext('2d'), rng, theme, pal);
  return { layers, stars, front: cloud, frontAlpha: theme === 'nightbase' ? 0.22 : 0.38, frontY: 26, pal };
}

/** رقش باير 4×4 (Dithering يدوي — مطلوب في القسم 3) */
const BAYER4 = [
  [0, 8, 2, 10], [12, 4, 14, 6], [3, 11, 1, 9], [15, 7, 13, 5],
];

function drawParallaxShape(ctx, def, rng, pal) {
  const { style, colors, height, step } = def;
  const W = ctx.canvas.width, H = ctx.canvas.height;
  const baseY = H - 4;
  const top = (x) => baseY - height * (0.4 + rng.fbm(x * 0.03, def.step, 3, 0.62) * 0.6);

  // بناء مسار الشكل (بلا Path2D — متوافق مع كل البيئات)
  const emit = (c) => {
    c.beginPath();
    c.moveTo(0, baseY);
    if (style === 'ridge' || style === 'ridgeSmall') {
      const pts = [];
      for (let x = 0; x <= W + step; x += step) {
        const y = style === 'ridge' ? top(x) : baseY - height * (0.3 + rng.fbm(x * 0.05, 5, 2, 0.6) * 0.7);
        pts.push([x, y]);
      }
      c.lineTo(0, pts[0][1]);
      for (let i = 1; i < pts.length; i++) {
        const [px, py] = pts[i - 1];
        const [cx2, cy2] = pts[i];
        c.quadraticCurveTo((px + cx2) / 2, Math.min(py, cy2) - 10, cx2, cy2);
      }
    } else if (style === 'trees') {
      if (!def.trees) {
        def.trees = [];
        for (let x = 0; x < W; x += 7) {
          def.trees.push({ x, th: 18 + rng.next() * height, tw: 4 + Math.round(rng.next() * 3) });
        }
      }
      for (const t of def.trees) c.lineTo(t.x, baseY - t.th * 0.55);
    } else {
      if (!def.blocks) {
        def.blocks = [];
        let x = 0;
        while (x < W + 20) {
          const bw = 10 + Math.round(rng.next() * (style === 'city' ? 26 : 14));
          const bh = (style === 'city' ? 22 : 12) + rng.next() * height;
          def.blocks.push({ x, bw, bh });
          x += bw + Math.round(rng.next() * 5);
        }
      }
    }
    c.lineTo(W, baseY + 2);
    c.closePath();
  };
  emit(ctx);
  ctx.save();
  ctx.clip();
  const g = ctx.createLinearGradient(0, baseY - height, 0, baseY);
  g.addColorStop(0, colors[0]);
  g.addColorStop(1, colors[1]);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);
  // رقش باير للانتقال بين اللونين (Dithering يدوي)
  if (def.detail === 'dither') {
    const rows = {};
    for (const b of (def.blocks || [])) rows[b.x] = 1;
    for (let y = Math.max(0, Math.floor(baseY - height)); y < baseY; y++) {
      for (let x = 0; x < W; x++) {
        const t = (baseY - y) / height;
        if ((BAYER4[y & 3][x & 3] / 16) > t) {
          ctx.fillStyle = colors[0];
          ctx.fillRect(x, y, 1, 1);
        }
      }
    }
  }
  ctx.restore();
  // حافة ضوئية علوية (Rim light) — تُرسم على المسار نفسه
  ctx.save();
  ctx.strokeStyle = def.detail === 'silhouette' ? '#141A22' : 'rgba(255,246,214,0.35)';
  ctx.lineWidth = 1;
  emit(ctx);
  ctx.stroke();
  ctx.restore();

  // تفاصيل المباني: نوافذ
  if (def.blocks && style === 'city') {
    for (const b of def.blocks) {
      for (let wy = baseY - b.bh + 4; wy < baseY - 3; wy += 5) {
        for (let wx = b.x + 2; wx < b.x + b.bw - 2; wx += 5) {
          if (rng.next() < 0.26) {
            ctx.fillStyle = rng.next() < 0.5 ? '#F2E0A0' : '#8FB8D8';
            ctx.fillRect(wx, wy, 1, 2);
          }
        }
      }
    }
  }
  if (def.trees && style === 'trees') {
    for (const t of def.trees) {
      ctx.fillStyle = colors[1];
      ctx.fillRect(t.x + t.tw / 2 - 1, baseY - t.th * 0.6, 2, t.th * 0.6);
      ctx.fillStyle = colors[0];
      ctx.fillRect(t.x - 1, baseY - t.th * 0.78, t.tw + 2, t.tw + 1);
    }
  }
  // ضباب أفقي (Haze) لفصل الطبقات
  const hg = ctx.createLinearGradient(0, baseY - height * 0.75, 0, baseY + 2);
  hg.addColorStop(0, 'rgba(255,255,255,0)');
  hg.addColorStop(1, pal.haze);
  ctx.fillStyle = hg;
  ctx.fillRect(0, baseY - height, W, height + 4);
}

function drawClouds(ctx, rng, theme, pal) {
  const W = ctx.canvas.width, H = ctx.canvas.height;
  const dark = pal ? pal.night : theme === 'nightbase';
  for (let i = 0; i < 14; i++) {
    const cx0 = rng.range(0, W), cy0 = rng.range(6, H - 24);
    const w = rng.range(18, 54), h = rng.range(5, 11);
    const body = dark ? '#3A4767' : '#FFFFFF';
    const shade = dark ? '#26304A' : '#C6D4E2';
    for (let k = 0; k < 5; k++) {
      const bw = Math.round(w * rng.range(0.35, 0.95));
      const bh = Math.round(h * rng.range(0.4, 0.95));
      const bx = Math.round(cx0 + rng.range(-w / 2, w / 2));
      const by = Math.round(cy0 + rng.range(-h / 2, h / 2));
      ctx.globalAlpha = dark ? 0.4 : 0.72;
      ctx.fillStyle = body;
      ctx.fillRect(bx, by, bw, bh);
      // حافة سفلية مظللة + رقش
      ctx.globalAlpha = dark ? 0.28 : 0.4;
      ctx.fillStyle = shade;
      ctx.fillRect(bx, by + bh - 2, bw, 2);
      for (let d = 0; d < bw; d += 2) {
        if ((BAYER4[(by + 1) & 3][d & 3] / 16) > 0.5) ctx.fillRect(bx + d, by + bh - 2, 1, 1);
      }
    }
  }
  ctx.globalAlpha = 1;
}
