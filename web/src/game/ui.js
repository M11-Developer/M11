// ============================================================================
// واجهة القوائم — كلها عربية (RTL) ومن اليمين لليسار، بأيقونات أطلس ui ونصوص
// متجهة (خط Cairo المقلم). تعمل باللمس والفأرة والكيبورد ويد التحكم.
//
// الشاشات: الرئيسية، الأوضاع، الخرائط، المشغلون، الإعدادات، التحكم،
//          الشبكة المحلية (LAN)، الإنجازات، الإحصاءات، الإضافات، الائتمانات.
// ============================================================================

import { CONFIG } from '../core/assets.js';
import { clamp, lerp, formatTime, TAU } from '../core/math.js';
import { MODES, MODE_LIST } from './modes.js';
import { MAPS } from './world.js';
import { DIFFICULTY, BOT_NAMES } from './entities.js';
import { RANKS, ACHIEVEMENTS } from '../core/storage.js';
import { DEFAULT_CONTROLS } from '../core/input.js';

const W = CONFIG.internalWidth;
const H = CONFIG.internalHeight;

export class MenuSystem {
  constructor(assets, game) {
    this.assets = assets;
    this.game = game;
    this.stack = [];
    this.anim = { t: 0, fade: 0, cursor: 0, scroll: 0 };
    this.fontStack = '"Cairo", "Tahoma", "Segoe UI", system-ui, sans-serif';
    this.pixelFont = '"Press Start 2P", monospace';
    this.selected = { items: [], index: 0 };
    this.toast = null;
    this.mouse = { x: -100, y: -100, down: false, pressed: false };
    this.drag = null;
    this.pendingRow = null;     // صف انتُقر ولم يُرفع الإصبع بعد
    this.hoverIndex = -1;
    this.time = 0;
    this.screens = this.buildScreens();
    this.push('main');
  }

  open(screen) {
    this.push(screen);
  }

  push(name) {
    const screen = typeof name === 'string' ? this.screens[name] : name;
    if (!screen) return;
    this.stack.push({ name: typeof name === 'string' ? name : (screen.id || 'custom'), screen, index: 0, scroll: 0, t: 0 });
    this.anim.fade = 1;
  }

  pop() {
    if (this.stack.length > 1) this.stack.pop();
  }

  home() {
    this.stack.length = 0;
    this.push('main');
  }

  get current() {
    return this.stack[this.stack.length - 1];
  }

  /** الشاشة الحالية (بلا حالة التنقل) */
  get cur() {
    const e = this.stack[this.stack.length - 1];
    return e ? e.screen : null;
  }

  message(text, kind = 'info') {
    this.toast = { text, kind, life: 2.6 };
  }

  // ------------------------------------------------------------- الأحداث
  /** مستطيل زر الرجوع العلوي — يظهر في كل شاشة فرعية (كانت القوائم بلا أي رجوع للمس) */
  backChipRect() {
    if (!this.current || this.stack.length <= 1) return null;
    return { x: 10, y: 8, w: 76, h: 22 };
  }

  /** رجوع موحّد: في شاشة الإيقاف يستأنف، وإلا يرجع خطوة في السجل */
  back() {
    const name = this.current ? this.current.name : 'main';
    this.playUiSound('back');
    if (name === 'pause') {
      if (this.game.resume) this.game.resume();
      else { this.game.state = 'playing'; this.stack.length = 1; }
      return;
    }
    if (this.stack.length > 1) {
      this.pop();
      this.anim.fade = 1;
    }
  }

  onPointerMove(x, y) {
    this.mouse.x = x;
    this.mouse.y = y;
    if (this.drag) {
      const delta = y - this.drag.lastY;
      if (Math.abs(y - this.drag.startY) > 6) this.drag.moved = true;
      if (this.drag.moved) {
        this.current.scroll = clamp(this.current.scroll - delta * 0.7, 0, this.current.maxScroll || 0);
      }
      this.drag.lastY = y;
    }
    const hit = this.hitTest(x, y);
    this.hoverIndex = hit ? hit.index : -1;
  }

  onPointerDown(x, y) {
    this.mouse.x = x;
    this.mouse.y = y;
    this.mouse.down = true;
    this.mouse.pressed = true;
    const chip = this.backChipRect();
    if (chip && x >= chip.x && x <= chip.x + chip.w && y >= chip.y && y <= chip.y + chip.h) {
      this.back();
      return;
    }
    const hit = this.hitTest(x, y);
    this.pendingRow = null;
    if (hit && hit.item) {
      this.current.index = hit.index;
      this.pendingRow = hit;
    }
    // السحب يبدأ من أي مكان — لتمرير الإعدادات الطويلة بالإصبع
    this.drag = { lastY: y, startY: y, moved: false };
  }

  onPointerUp(x, y) {
    this.mouse.down = false;
    const moved = this.drag && this.drag.moved;
    if (!moved && this.pendingRow && this.pendingRow.item && !this.pendingRow.item.disabled
        && this.pendingRow.item.type !== 'header') {
      this.activate(this.pendingRow.item, this.pendingRow.index, x);
    }
    this.pendingRow = null;
    this.drag = null;
  }

  moveCursor(delta) {
    const items = this.cur.items().filter((i) => !i.hidden);
    if (!items.length) return;
    let i = this.current.index;
    for (let k = 0; k < items.length; k++) {
      i = (i + delta + items.length) % items.length;
      if (!items[i].disabled) break;
    }
    this.current.index = i;
    this.ensureVisible();
    this.playUiSound('click');
  }

  /** يُمرّر القائمة تلقائيًا حتى يبقى الصف المختار ظاهرًا (كان الاختيار يختفي أسفل الشاشة) */
  ensureVisible() {
    const cur = this.current;
    if (!cur) return;
    const rows = this.rowsFor(cur);
    const row = rows[Math.min(cur.index, rows.length - 1)];
    if (!row) return;
    cur.maxScroll = Math.max(0, rows[rows.length - 1].rect.y + 30 - (H - 30));
    const top = row.rect.y;
    const bottom = row.rect.y + row.rect.h;
    if (top - cur.scroll < 58) cur.scroll = Math.max(0, top - 58);
    else if (bottom - cur.scroll > H - 34) cur.scroll = Math.min(cur.maxScroll, bottom - (H - 34));
  }

  activate(item, index, x = null) {
    if (!item) return;
    if (item.type === 'slider') {
      // بالنقر على شريط القيمة نضبط النسبة مباشرة (أسرع بكثير من نقرات 10%)
      const rect = this.current && this.rowRectFor(index);
      if (x != null && rect) {
        const sw = 64, sx = rect.x + 8;
        if (x >= sx - 6 && x <= sx + sw + 6) {
          const pct = clamp((x - sx) / sw, 0, 1);
          const step = item.step || 0.01;
          let v = item.min + pct * (item.max - item.min);
          v = item.min + Math.round((v - item.min) / step) * step;
          item.onChange(clamp(v, item.min, item.max));
          this.playUiSound('confirm');
          return;
        }
      }
      item.onChange(clamp(item.get() + (item.step || 0.1), item.min, item.max));
    } else if (item.type === 'choice' || item.type === 'sliderChoice') {
      // لمس صف الاختيار يبدّل القيمة (كان الاختيار بالأسهم فقط — مستحيل على الهاتف)
      if (item.type === 'choice' && item.cycle) {
        const ids = (item.options || []).map((o) => (typeof o === 'object' ? o.id : o));
        const cur = ids.indexOf(item.get());
        if (ids.length) item.onChange(ids[(cur + 1) % ids.length]);
      } else if (item.onSelect) item.onSelect(item);
    } else if (item.onSelect) {
      item.onSelect(item);
    }
    this.playUiSound(item.type === 'danger' ? 'back' : 'confirm');
  }

  /** مستطيل الصف الحالي برقمه (بعد السكرول) — لضبط السلايدرات باللمس */
  rowRectFor(index) {
    const rows = this.rowsFor(this.cur);
    const r = rows[index] && rows[index].rect;
    if (!r) return null;
    return { ...r, y: r.y - (this.current ? this.current.scroll : 0) };
  }

  /** تُنادى من main عند ضغط مفتاح في القوائم */
  key(code, cmd) {
    const items = this.cur.items();
    const item = items[this.current.index];
    switch (code) {
      case 'ArrowUp': case 'KeyW': this.moveCursor(-1); return true;
      case 'ArrowDown': case 'KeyS': this.moveCursor(1); return true;
      case 'ArrowLeft': case 'KeyA':
        if (item && item.type === 'slider') item.onChange(clamp(item.get() - (item.step || 0.1), item.min, item.max));
        else if (item && item.type === 'choice') item.onChange(item.cycle(-1));
        else this.moveCursor(-1);
        return true;
      case 'ArrowRight': case 'KeyD':
        if (item && item.type === 'slider') item.onChange(clamp(item.get() + (item.step || 0.1), item.min, item.max));
        else if (item && item.type === 'choice') item.onChange(item.cycle(1));
        else this.moveCursor(1);
        return true;
      case 'Enter': case 'Space': case 'NumpadEnter':
        if (item) this.activate(item, this.current.index);
        return true;
      case 'Escape': case 'Backspace':
        if (this.stack.length > 1) this.back();
        else if (this.game.state === 'playing') this.game.pause();
        return true;
      default: return false;
    }
  }

  playUiSound(kind) {
    const audio = this.game.audio;
    if (audio && audio.ready) audio.playUi ? audio.playUi(kind) : audio.ui && audio.ui(kind);
  }

  /**
   * يبني صفوف الشاشة الحالية: مستطيل لكل عنصر (أساس الرسم واللمس معًا).
   * كان الرسم سابقًا يطلب cur.screen.rows وهي غير معرّفة ⇒ استثناء يمنع رسم القوائم.
   */
  rowsFor(frame) {
    // يقبل إطار الشاشة (فيه screen) أو الشاشة نفسها — لأن this.cur يعيد الشاشة
    const screen = frame && frame.screen ? frame.screen : frame;
    if (!screen) return [];
    const items = screen.items(this).slice();
    // زر رجوع ظاهر في كل شاشة فرعية — بديل مضمون للكيبورد على الهاتف
    if (this.stack.length > 1) {
      items.push({ type: 'back', label: screen.id === 'pause' ? 'استئناف اللعب' : 'رجوع', onSelect: () => this.back() });
    }
    const rows = [];
    let y = 62;
    for (let index = 0; index < items.length; index++) {
      const item = items[index];
      const h = item.type === 'header' ? 20 : 24;
      rows.push({ item, index, rect: { x: W - 348, y, w: 330, h } });
      y += h + 4;
    }
    return rows;
  }

  /** الصف المختار حاليًا، أو أقرب صف سابق يحمل الحقل المطلوب (يتجاوز العناوين) */
  selectedItem(field) {
    const cur = this.current;
    if (!cur) return null;
    const rows = this.rowsFor(cur);
    if (!rows.length) return null;
    for (let i = Math.min(cur.index, rows.length - 1); i >= 0; i--) {
      const item = rows[i].item;
      if (!field) return item;
      if (item && item[field] != null) return item;
    }
    return null;
  }

  hitTest(x, y) {
    const rows = this.rowsFor(this.cur);
    const scroll = this.current ? this.current.scroll : 0;
    for (let i = 0; i < rows.length; i++) {
      const r = rows[i].rect;
      const ry = r.y - scroll;
      if (x >= r.x && x <= r.x + r.w && y >= ry && y <= ry + r.h) {
        return { item: rows[i].item, index: rows[i].index, rect: { ...r, y: ry } };
      }
    }
    return null;
  }

  // ------------------------------------------------------------- التحديث
  update(dt, input) {
    this.time += dt;
    this.anim.fade = Math.max(0, this.anim.fade - dt * 3);
    this.current.t += dt;
    if (this.toast) {
      this.toast.life -= dt;
      if (this.toast.life <= 0) this.toast = null;
    }
    // سكرول بالعجلة
    if (input && input.mouse.wheel) {
      this.current.scroll = clamp(this.current.scroll - input.mouse.wheel * 14, 0, this.current.maxScroll || 0);
    }
    // تصحيح الفهرس إن تجاوز الحد
    const items = this.cur.items();
    if (this.current.index >= items.length) this.current.index = Math.max(0, items.length - 1);
    this.mouse.pressed = false;
    if (input) {
      this.mouse.x = input.mouse.x * (W / this.game.canvas.width);
      this.mouse.y = input.mouse.y * (H / this.game.canvas.height);
      this.mouse.down = input.mouse.down;
    }
  }

  // ------------------------------------------------------------- الرسم
  draw(ctx, settings) {
    const cur = this.current;
    ctx.save();
    this.drawBackground(ctx);
    const rows = this.rowsFor(cur);
    cur.maxScroll = Math.max(0, rows.length && rows[rows.length - 1] ? rows[rows.length - 1].rect.y + 30 - (H - 30) : 0);
    // العنوان
    const title = cur.screen.title || '';
    if (title) {
      this.text(ctx, title, W - 24, 34, { size: 17, bold: true, color: '#F2C14E', shadow: true });
      if (cur.screen.subtitle) {
        let ss = 9;
        while (ss > 6 && this.measure(ctx, cur.screen.subtitle, ss) > W - 48) ss -= 0.5;
        this.text(ctx, cur.screen.subtitle, W - 24, 48, { size: ss, color: '#9BB8C4' });
      }
    }
    this.drawBackChip(ctx);
    // الصفوف — ستارة داكنة خلف عمود القائمة حتى تبقى النصوص واضحة فوق أي لوحة فنية
    ctx.save();
    const scrimW = 352;
    const sg = ctx.createLinearGradient(W - scrimW, 0, W, 0);
    sg.addColorStop(0, 'rgba(5,7,10,0)');
    sg.addColorStop(0.35, 'rgba(5,7,10,0.72)');
    sg.addColorStop(1, 'rgba(5,7,10,0.86)');
    ctx.fillStyle = sg;
    ctx.fillRect(W - scrimW, 50, scrimW, H - 50);
    ctx.beginPath();
    ctx.rect(0, 54, W, H - 54 - 40);
    ctx.clip();
    let hovered = this.hitTest(this.mouse.x, this.mouse.y);
    if (this.drag && this.drag.moved) hovered = null;
    for (const row of rows) {
      const y = row.rect.y - cur.scroll;
      if (y < 40 || y > H + 20) continue;
      this.drawRow(ctx, row, y, row.index === cur.index, hovered && hovered.index === row.index);
    }
    ctx.restore();
    // تلاشٍ سفلي حتى لا تُقطع آخر صف بشكل حاد فوق التذييل
    const fade = ctx.createLinearGradient(0, H - 58, 0, H - 40);
    fade.addColorStop(0, 'rgba(8,11,15,0)');
    fade.addColorStop(1, 'rgba(8,11,15,0.92)');
    ctx.fillStyle = fade;
    ctx.fillRect(W - 360, H - 58, 360, 18);
    // معاينة الخريطة المختارة: مصغّرة حقيقية مرسومة من أصول اللعبة نفسها
    if (cur.name === 'maps') {
      const chosen = this.selectedItem('mapId');
      const m = (chosen && MAPS.find((x) => x.id === chosen.mapId)) || MAPS[0];
      if (m) {
        const pw = 168, ph = 94;
        const px = 14, py = H - ph - 52;
        const thumb = this.uiImage(`thumb_${m.id}.png`);
        if (thumb) {
          this.drawArt(ctx, thumb, px, py, pw, ph, { smooth: false });
        } else {
          this.panel(ctx, px, py, pw, ph, true);
          this.text(ctx, 'جارٍ رسم المعاينة…', px + pw / 2, py + ph / 2 + 3, { size: 8, color: '#9BB8C4', align: 'center' });
        }
        // لوحة نصية أسفل الصورة ليبقى النص مقروءًا فوق أي خلفية
        ctx.fillStyle = 'rgba(6,8,11,0.82)';
        ctx.fillRect(px - 3, py + ph + 4, pw + 6, 30);
        this.text(ctx, m.nameAr, px + pw, py + ph + 15, { size: 9, bold: true, color: '#F2C14E', align: 'right' });
        this.text(ctx, `${m.w}×${m.h} — ${m.theme}`, px + pw, py + ph + 27, { size: 7, color: '#9BB8C4', align: 'right' });
      }
    }

    // بورتريه المشغّل المختار: مقطوع من أطلس البورتريهات (10 + 10 مشغلين)
    if (cur.name === 'operators') {
      const meta = this.assets.json.get('characters_meta.json') || {};
      const keys = Object.keys(meta.operators || {});
      const chosen = this.selectedItem('opKey');
      const key = (chosen && chosen.opKey) || keys[0];
      const info = key ? meta.operators[key] : null;
      if (key && info) {
        const pw = 84, ph = 104;
        const px = 16, py = H - ph - 62;
        // أطلس البورتريهات: العشرة الأولى في portraits_orig، والعشرة الجديدة في portraits_new
        const origKeys = ['rashid', 'karim', 'yusuf', 'tariq', 'adam', 'layla', 'noor', 'hala', 'sara', 'mariam'];
        const idx = keys.indexOf(key);
        const atlasName = (idx >= 0 && idx < 10) ? 'portraits_orig' : 'portraits_new';
        const frameKey = idx < 10 ? `portrait/${origKeys[idx]}` : `portrait/portrait_${idx + 1}`;
        const atlas = this.assets.get(atlasName);
        let drawn = false;
        if (atlas && atlas.has(frameKey)) {
          ctx.save();
          ctx.fillStyle = 'rgba(3,5,8,0.82)';
          ctx.fillRect(px - 3, py - 3, pw + 6, ph + 6);
          ctx.strokeStyle = 'rgba(242,193,78,0.55)';
          ctx.lineWidth = 1;
          ctx.strokeRect(px - 2.5, py - 2.5, pw + 5, ph + 5);
          const f = atlas.frame(frameKey);
          ctx.imageSmoothingEnabled = false;
          ctx.drawImage(atlas.image, f.x, f.y, f.w, f.h, px, py, pw, ph);
          ctx.restore();
          drawn = true;
        }
        if (!drawn) {
          const img = this.uiImage(`portrait_${key}.png`);
          if (img) this.drawArt(ctx, img, px, py, pw, ph, { smooth: false });
        }
        ctx.fillStyle = 'rgba(6,8,11,0.82)';
        ctx.fillRect(px - 3, py + ph + 4, pw + 6, 26);
        this.text(ctx, info.name, px + pw, py + ph + 15, { size: 10, bold: true, color: '#F2C14E', align: 'right' });
        // سطران من السيرة: نأخذ أول جملتين قصيرتين
        const bioLines = (info.bio || '').split('\n').slice(0, 2).map((l) => l.slice(0, 34));
        bioLines.forEach((l, i) => this.text(ctx, l, px + pw, py + ph + 25 + i * 8, { size: 6.5, color: '#9BB8C4', align: 'right' }));
      }
    }

    // شريط الميداليات: ميدالية لكل إنجاز مفتوح (أطلس medals_2) — يجعل التقدّم مرئيًا
    if (cur.name === 'stats') {
      const atlas = this.assets.get('medals_2');
      const p = (this.game && this.game.profile) || { achievements: [] };
      if (atlas) {
        const unlocked = p.achievements || [];
        const keys = Object.keys(atlas.frames).sort();
        // شريط ميداليات أفقي فوق التذييل في الفرع الأيسر (لا يغطي القائمة)
        const stripY = H - 62;
        ctx.fillStyle = 'rgba(5,7,10,0.74)';
        ctx.fillRect(10, stripY, 262, 22);
        ctx.strokeStyle = 'rgba(242,193,78,0.22)';
        ctx.lineWidth = 1;
        ctx.strokeRect(10.5, stripY + 0.5, 261, 21);
        const label = `الإنجازات ${unlocked.length}/${ACHIEVEMENTS.length}`;
        const lw = this.measure(ctx, label, 7);
        this.text(ctx, label, 266, stripY + 14, { size: 7, bold: true, color: '#F2C14E' });
        const y0 = stripY + 11;
        let x = 266 - lw - 8;
        for (let i = 0; i < Math.min(keys.length, ACHIEVEMENTS.length); i++) {
          const done = i < unlocked.length;
          const f = atlas.frame(keys[i]);
          const s2 = 12 / Math.max(f.w, f.h);
          ctx.save();
          ctx.imageSmoothingEnabled = false;
          ctx.globalAlpha = done ? 1 : 0.2;
          ctx.drawImage(atlas.image, f.x, f.y, f.w, f.h, x - 12, y0 - 12, f.w * s2, f.h * s2);
          ctx.restore();
          x -= 15;
          if (x < 16) break;
        }
      }
    }

    // شريط سكرول
    if (cur.maxScroll > 0) {
      const trackH = H - 70;
      const barH = Math.max(20, trackH * (trackH / (cur.maxScroll + trackH)));
      const barY = 60 + (trackH - barH) * (cur.scroll / cur.maxScroll);
      ctx.fillStyle = 'rgba(255,255,255,0.12)';
      ctx.fillRect(4, 60, 3, trackH);
      ctx.fillStyle = '#F2C14E';
      ctx.fillRect(4, barY, 3, barH);
    }
    // تذييل
    this.drawFooter(ctx, cur);
    if (this.toast) {
      const t = this.toast;
      const a = clamp(t.life, 0, 1);
      ctx.save();
      ctx.globalAlpha = a;
      const col = t.kind === 'error' ? '#E8523F' : t.kind === 'ok' ? '#5ED67B' : '#F2C14E';
      const w = Math.min(W - 60, this.measure(ctx, t.text, 10) + 24);
      this.panel(ctx, W / 2 - w / 2, H - 42, w, 20, true);
      this.text(ctx, t.text, W / 2 + w / 2 - 12, H - 28, { size: 10, bold: true, color: col, align: 'right' });
      ctx.restore();
    }
    if (this.anim.fade > 0.01) {
      ctx.fillStyle = `rgba(6,8,11,${this.anim.fade * 0.55})`;
      ctx.fillRect(0, 0, W, H);
    }
    ctx.restore();
  }

  /** يحمّل صورة واجهة مرة واحدة (مصغّرة خريطة، ملصق، بورتريه مقطوع) ويخزّنها */
  uiImage(path) {
    if (!this._imgs) this._imgs = new Map();
    if (this._imgs.has(path)) return this._imgs.get(path);
    this._imgs.set(path, null);
    const img = new Image();
    img.onload = () => { this._imgs.set(path, img); };
    img.onerror = () => { this._imgs.set(path, false); };
    img.src = (this.assets && this.assets.base ? this.assets.base : 'assets/') + path;
    return null;
  }

  /** يرسم صورة داخل إطار ذهبي مع تعبئة نسبية (contain) وحفظ نسبة الأبعاد */
  drawArt(ctx, img, x, y, w, h, opts = {}) {
    if (!img) return false;
    ctx.save();
    if (opts.frame !== false) {
      ctx.fillStyle = 'rgba(3,5,8,0.82)';
      ctx.fillRect(x - 3, y - 3, w + 6, h + 6);
      ctx.strokeStyle = opts.frameColor || 'rgba(242,193,78,0.55)';
      ctx.lineWidth = 1;
      ctx.strokeRect(x - 2.5, y - 2.5, w + 5, h + 5);
    }
    const ar = img.width / img.height;
    const box = w / h;
    let dw = w, dh = h;
    if (ar > box) { dh = w / ar; } else { dw = h * ar; }
    const dx = x + (w - dw) / 2;
    const dy = y + (h - dh) / 2;
    ctx.imageSmoothingEnabled = !!opts.smooth;
    ctx.globalAlpha = opts.alpha === undefined ? 1 : opts.alpha;
    ctx.drawImage(img, 0, 0, img.width, img.height, dx, dy, dw, dh);
    ctx.restore();
    return true;
  }

  drawBackground(ctx) {
    const t = this.time;
    // خلفية متحركة: تدرّج + طبقات جبال من طابع اللعبة
    const g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, '#101A28');
    g.addColorStop(0.55, '#1B2A3A');
    g.addColorStop(1, '#0B1017');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
    // لوحة الفن الرئيسية خلف القائمة (إن حُمّلت) — تعطي هوية بصرية فورية
    const hero = this.uiImage('backdrops/key_art_main.png');
    if (hero) this.drawArt(ctx, hero, -8, -6, W + 16, H + 12, { frame: false, alpha: 0.42 });
    else if (this._imgs && this._imgs.get('backdrops/key_art_main.png') === false) { /* لا صورة: نبقى على التدرّج */ }
    // شمس/هالة
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    const sg = ctx.createRadialGradient(W * 0.22, H * 0.3, 0, W * 0.22, H * 0.3, 160);
    sg.addColorStop(0, 'rgba(242,193,78,0.22)');
    sg.addColorStop(1, 'rgba(242,193,78,0)');
    ctx.fillStyle = sg;
    ctx.fillRect(0, 0, W, H);
    ctx.restore();
    // جبال بخمس طبقات
    for (let l = 0; l < 5; l++) {
      const f = 0.12 + l * 0.16;
      const off = (t * (6 + l * 3)) % 200;
      ctx.fillStyle = `rgba(${18 + l * 12},${28 + l * 14},${40 + l * 16},1)`;
      ctx.beginPath();
      ctx.moveTo(0, H);
      for (let x = -200; x < W + 200; x += 20) {
        const y = H - 60 - l * 18 - Math.sin((x + off) * 0.02 + l) * (18 - l * 2) - Math.sin((x + off) * 0.06 + l * 2) * 7;
        ctx.lineTo(x, y);
      }
      ctx.lineTo(W, H);
      ctx.closePath();
      ctx.fill();
    }
    // نقاط رمادية (حبيبات) لطابع البكسل
    ctx.save();
    ctx.globalAlpha = 0.05;
    ctx.fillStyle = '#FFFFFF';
    for (let i = 0; i < 90; i++) {
      const x = (i * 97 + Math.sin(t * 0.4 + i) * 12) % W;
      const y = (i * 53) % H;
      ctx.fillRect(x | 0, y | 0, 1, 1);
    }
    ctx.restore();
  }

  /** زر الرجوع العلوي الدائم — واضح للمس فوق أي شاشة فرعية */
  drawBackChip(ctx) {
    const r = this.backChipRect();
    if (!r) return;
    ctx.save();
    ctx.fillStyle = 'rgba(8,11,15,0.88)';
    ctx.fillRect(r.x, r.y, r.w, r.h);
    ctx.strokeStyle = 'rgba(242,193,78,0.55)';
    ctx.lineWidth = 1;
    ctx.strokeRect(r.x + 0.5, r.y + 0.5, r.w - 1, r.h - 1);
    // سهم الرجوع (يمين في واجهة عربية)
    const ax = r.x + r.w - 13, ay = r.y + r.h / 2;
    ctx.strokeStyle = '#F2C14E';
    ctx.lineWidth = 1.8;
    ctx.beginPath();
    ctx.moveTo(ax - 5, ay - 4); ctx.lineTo(ax + 1, ay); ctx.lineTo(ax - 5, ay + 4);
    ctx.stroke();
    this.text(ctx, 'رجوع', r.x + r.w - 22, ay + 4, { size: 10, bold: true, color: '#F2C14E', align: 'right' });
    ctx.restore();
  }

  drawRow(ctx, row, y, focused, hovered) {
    const item = row.item;
    const r = row.rect;
    const x = r.x, w = r.w, h = r.h;
    const isHeader = item.type === 'header';
    if (item.type === 'back') {
      // صف الرجوع: لون ذهبي وأسهم واضحة
      const active2 = focused || hovered;
      ctx.fillStyle = active2 ? 'rgba(242,193,78,0.20)' : 'rgba(12,16,21,0.62)';
      ctx.fillRect(x, y, w, h);
      ctx.fillStyle = active2 ? '#F2C14E' : 'rgba(242,193,78,0.45)';
      ctx.fillRect(x + w - 2, y, 2, h);
      // سهم يتجه يمينًا (اتجاه الرجوع في واجهة عربية)
      const ax = x + w - 20, ay = y + h / 2;
      ctx.strokeStyle = active2 ? '#F2C14E' : '#C9A44A';
      ctx.lineWidth = 1.6;
      ctx.beginPath();
      ctx.moveTo(ax - 5, ay - 4); ctx.lineTo(ax + 1, ay); ctx.lineTo(ax - 5, ay + 4);
      ctx.stroke();
      this.text(ctx, item.label, x + w - 30, y + h / 2 + 4, { size: 10, bold: true, color: active2 ? '#F2C14E' : '#E8D9AE' });
      return;
    }
    if (isHeader) {
      this.text(ctx, item.label, x + w - 8, y + 14, { size: 10, bold: true, color: '#7FD2F5' });
      ctx.fillStyle = 'rgba(127,210,245,0.25)';
      ctx.fillRect(x + w - 8 - this.measure(ctx, item.label, 10), y + 18, this.measure(ctx, item.label, 10), 1);
      return;
    }
    // لوحة الصف
    const active = focused || hovered;
    ctx.save();
    if (active) {
      ctx.fillStyle = item.type === 'danger' ? 'rgba(232,82,63,0.24)' : 'rgba(242,193,78,0.16)';
      ctx.fillRect(x, y, w, h);
      ctx.fillStyle = item.type === 'danger' ? '#E8523F' : '#F2C14E';
      ctx.fillRect(x + w - 2, y, 2, h);
    } else {
      ctx.fillStyle = 'rgba(12,16,21,0.55)';
      ctx.fillRect(x, y, w, h);
      ctx.fillStyle = 'rgba(255,255,255,0.07)';
      ctx.fillRect(x, y + h - 1, w, 1);
    }
    ctx.restore();
    if (item.disabled) {
      ctx.save();
      ctx.globalAlpha = 0.45;
    }
    // أيقونة
    let labelX = x + w - 10;
    if (item.icon) {
      const ui = this.assets.get('ui');
      const key = 'ui/' + item.icon;
      if (ui && ui.has(key)) {
        ui.draw(ctx, key, x + w - 22, y + h / 2 - 8, 1, false);
        labelX -= 22;
      }
    }
    // نصوص
    this.text(ctx, item.label, labelX, y + h / 2 + 4, { size: item.size || 10, bold: true, color: item.color || '#EAF2F6' });
    if (item.desc) {
      this.text(ctx, item.desc, labelX - this.measure(ctx, item.label, item.size || 10) - 12, y + h / 2 + 4, { size: 8, color: '#7E8C99' });
    }
    // قيمة / سلايدر / اختيار
    if (item.type === 'slider') {
      const raw = Number(item.get());
      const v = Number.isFinite(raw) ? raw : item.min;
      const pct = clamp((v - item.min) / Math.max(1e-6, item.max - item.min), 0, 1);
      const sw = 64, sx = x + 8;
      ctx.fillStyle = 'rgba(11,13,16,0.8)';
      ctx.fillRect(sx - 1, y + h / 2 - 3, sw + 2, 7);
      ctx.fillStyle = '#5ED67B';
      ctx.fillRect(sx, y + h / 2 - 2, Math.round(sw * pct), 5);
      ctx.fillStyle = '#EAF2F6';
      ctx.fillRect(sx + Math.round(sw * pct) - 1, y + h / 2 - 4, 2, 9);
      this.num(ctx, item.format ? item.format(v) : `${Math.round(v * 100)}%`, sx + sw + 6, y + h / 2 + 4, { size: 8, color: '#9BB8C4' });
    } else if (item.type === 'choice' || item.type === 'sliderChoice') {
      const val = item.get();
      const txt = typeof item.format === 'function' ? item.format(val) : String(val);
      const col = active ? '#F2C14E' : '#9BB8C4';
      // القيم العربية تُرسم باتجاه RTL (كانت تُعرض معكوسة حين تُرسم LTR)
      if (/[\u0600-\u06FF]/.test(txt)) this.text(ctx, txt, x + 10, y + h / 2 + 4, { size: 9, bold: true, color: col, align: 'left' });
      else this.num(ctx, txt, x + 10, y + h / 2 + 4, { size: 9, bold: true, color: col });
      this.text(ctx, '◄ ►', x + 10 + this.measure(ctx, txt, 9) + 6, y + h / 2 + 4, { size: 8, color: '#5C6B78', align: 'left' });
    } else if (item.value != null) {
      const txt = String(item.value);
      if (/[\u0600-\u06FF]/.test(txt)) this.text(ctx, txt, x + 10, y + h / 2 + 4, { size: 9, color: active ? '#F2C14E' : '#9BB8C4', align: 'left' });
      else this.num(ctx, txt, x + 10, y + h / 2 + 4, { size: 9, color: active ? '#F2C14E' : '#9BB8C4' });
    }
    if (item.disabled) ctx.restore();
    if (item.badge) {
      ctx.fillStyle = '#E85D9B';
      ctx.beginPath();
      ctx.arc(x + 14, y + 8, 3, 0, TAU);
      ctx.fill();
    }
  }

  drawFooter(ctx, cur) {
    const hints = (cur.screen.hints || [
      ['▲▼', 'تنقّل'], ['Enter', 'اختيار'],
    ]).slice();
    if (this.stack.length > 1) hints.push(['Esc', 'رجوع']);
    let x = 12;
    for (const [key, label] of hints) {
      ctx.fillStyle = 'rgba(255,255,255,0.10)';
      ctx.fillRect(x, H - 16, this.measure(ctx, key, 8) + 4, 10);
      this.num(ctx, key, x + 2, H - 8, { size: 8, color: '#EAF2F6' });
      x += this.measure(ctx, key, 8) + 8;
      this.text(ctx, label, x + 30, H - 8, { size: 8, color: '#7E8C99' });
      x += this.measure(ctx, label, 8) + 12;
    }
    // اسم اللاعب ورتبته
    const p = this.game.profile;
    if (p) {
      const rank = RANKS[Math.min(RANKS.length - 1, p.rank || 0)];
      this.text(ctx, `${p.name} — ${rank.nameAr}`, W - 12, H - 8, { size: 8, color: '#F2C14E' });
    }
  }

  panel(ctx, x, y, w, h, deep = false) {
    const ui = this.assets.get('ui');
    const key = deep ? 'ui/panel_deep' : 'ui/panel';
    if (ui && ui.has(key)) {
      const f = ui.frame(key);
      if (f.ox >= w && f.oy >= h) { ui.draw(ctx, key, x, y, 1, false); return; }
    }
    ctx.fillStyle = deep ? 'rgba(9,11,15,0.92)' : 'rgba(14,17,22,0.82)';
    ctx.fillRect(x, y, w, h);
    ctx.fillStyle = 'rgba(255,255,255,0.10)';
    ctx.fillRect(x, y, w, 1);
  }

  text(ctx, str, x, y, opts = {}) {
    ctx.save();
    ctx.font = `${opts.bold ? '700 ' : ''}${opts.size || 10}px ${opts.pixel ? this.pixelFont : this.fontStack}`;
    ctx.textAlign = opts.align || 'right';
    ctx.direction = 'rtl';
    if (opts.shadow !== false) {
      ctx.fillStyle = 'rgba(0,0,0,0.7)';
      ctx.fillText(str, x + 1, y + 1);
    }
    ctx.fillStyle = opts.color || '#EAF2F6';
    ctx.fillText(str, x, y);
    ctx.restore();
  }

  num(ctx, str, x, y, opts = {}) {
    ctx.save();
    ctx.font = `${opts.bold ? '700 ' : ''}${opts.size || 9}px ${this.fontStack}`;
    ctx.textAlign = opts.align || 'left';
    ctx.direction = 'ltr';
    ctx.fillStyle = opts.color || '#EAF2F6';
    ctx.fillText(str, x, y);
    ctx.restore();
  }

  measure(ctx, str, size) {
    ctx.save();
    ctx.font = `700 ${size}px ${this.fontStack}`;
    const w = ctx.measureText(str).width;
    ctx.restore();
    return w;
  }

  // ------------------------------------------------------------- الشاشات
  buildScreens() {
    const g = this.game;
    const S = {};
    const row = (item, y, x = 40, w = W - 80, h = 22) => ({ item, rect: { x, y, w, h } });

    const choice = (label, opts, get, set, extra = {}) => ({
      type: 'choice', label, options: opts, get, onChange: set,
      format: (v) => (typeof opts[0] === 'object' ? (opts.find((o) => o.id === v) || opts[0]).label : String(v)),
      cycle: (d) => {
        const ids = opts.map((o) => (typeof o === 'object' ? o.id : o));
        const i = ids.indexOf(get());
        const ni = clamp(i + d, 0, ids.length - 1);
        set(ids[ni]);
        return ids[ni];
      },
      ...extra,
    });
    const slider = (label, min, max, step, get, set, format, extra = {}) =>
      ({ type: 'slider', label, min, max, step, get, onChange: set, format, ...extra });
    const action = (label, onSelect, extra = {}) => ({ type: 'action', label, onSelect, ...extra });
    const header = (label) => ({ type: 'header', label });

    // ---------------- الرئيسية
    S.main = {
      id: 'main', title: 'ميكا 11 — ساحة النار', subtitle: 'الحرب المحلية بلا إنترنت: 8 لاعبين على شبكة واحدة',
      hints: [['▲▼', 'تنقّل'], ['Enter', 'اختيار']],
      items: () => [
        action('لعب سريع — ضد بوتات', () => { g.startMatch({ mode: 'dm', bots: true }); g.state = 'playing'; }, { icon: 'icon_star', desc: 'ابدأ فورًا' }),
        action('اختيار الوضع', () => this.push('modes'), { icon: 'icon_skull', desc: `${MODE_LIST.length} وضعًا` }),
        action('اختيار الخريطة', () => this.push('maps'), { icon: 'icon_map', desc: `${MAPS.length} خرائط` }),
        action('تخصيص المقاتل', () => this.push('operators'), { icon: 'icon_team', desc: '10 مشغلين وأسلحة البداية' }),
        action('شبكة محلية (LAN)', () => this.push('lan'), { icon: 'icon_ping', desc: 'حتى 8 لاعبين على نقطة اتصال' }),
        action('محرّر الخرائط', () => { g.openEditor(); }, { icon: 'icon_settings', desc: 'ابنِ خريطتك وصدّرها JSON' }),
        action('الإحصاءات والإنجازات', () => this.push('stats'), { icon: 'icon_crown', desc: `${g.progression ? g.progression.profile.achievements.length : 0}/${ACHIEVEMENTS.length} إنجازًا` }),
        action('الإعدادات', () => this.push('settings'), { icon: 'icon_settings' }),
        action('تخصيص التحكم', () => this.push('controls'), { icon: 'icon_settings', desc: 'عصا مزدوجة، أحجام، شفافية، جيروسكوب' }),
        action('كيف تجعل هوت سبوت؟', () => this.push('hotspot'), { icon: 'icon_warning', desc: 'دليل مصوّر قصير' }),
        action('الائتمانات', () => this.push('credits'), { icon: 'icon_star' }),
        action('تغيير الاسم', () => {
          const name = prompt('اكتب اسمك (بالعربية أو الإنجليزية):', g.profile.name);
          if (name && name.trim()) { g.profile.name = name.trim().slice(0, 16); g.saveProfile(); this.message('تم تغيير الاسم إلى ' + g.profile.name, 'ok'); }
        }, { icon: 'icon_team', value: g.profile.name }),
        action('خروج', () => { this.message('يمكنك إغلاق التبويب أو الضغط على Alt+F4', 'info'); }, { type: 'danger', label: 'خروج', icon: 'icon_warning' }),
      ],
    };

    // ---------------- الأوضاع
    S.modes = {
      id: 'modes', title: 'أوضاع اللعب', subtitle: 'اختر وضعًا ثم اضغط Enter للبدء فورًا',
      items: () => MODE_LIST.map((id) => {
        const m = MODES[id];
        return action(m.nameAr, () => {
          g.startMatch({ mode: id, bots: true });
          g.state = 'playing';
        }, { desc: m.descAr, icon: m.icon || 'icon_skull', size: 11 });
      }),
    };

    // ---------------- الخرائط
    S.maps = {
      id: 'maps', title: 'الخرائط', subtitle: 'كل خريطة تولَّد إجرائيًا بنفس البذرة لجميع اللاعبين',
      items: () => MAPS.map((m) => action(`${m.nameAr} (${m.size === 'br' ? 'كبيرة' : m.size === 'medium' ? 'متوسطة' : 'صغيرة'})`, () => {
        g.settings.map = m.id;
        g.saveSettings();
        this.message('تم اختيار الخريطة: ' + m.nameAr, 'ok');
      }, { desc: m.desc, icon: 'icon_map', mapId: m.id, color: g.settings.map === m.id ? '#F2C14E' : '#EAF2F6' })),
    };

    // ---------------- المشغلون
    S.operators = {
      id: 'operators', title: 'المشغلون', subtitle: '10 مشغلين — كل مشغل له 4 أشكال ألوان (Skins)',
      items: () => {
        const meta = this.assets.json.get('characters_meta.json') || {};
        const ops = Object.keys(meta.operators || {});
        const rows = [header('المشغل')];
        for (const key of ops) {
          const info = meta.operators[key];
          rows.push(action(info.name, () => {
            g.settings.opKey = key;
            g.saveSettings();
            this.message('اخترت: ' + info.name, 'ok');
          }, {
            desc: (info.bio || '').split('\n')[0].slice(0, 46),
            color: g.settings.opKey === key ? '#F2C14E' : '#EAF2F6',
            icon: 'icon_team', opKey: key,
          }));
        }
        rows.push(header('شكل اللون (Skin)'));
        rows.push(choice('لون الزي', [0, 1, 2, 3].map((i) => ({ id: i, label: 'شكل ' + (i + 1) })), () => g.settings.skinIndex, (v) => { g.settings.skinIndex = v; g.saveSettings(); }));
        rows.push(header('أسلحة البداية'));
        rows.push(choice('السلاح الأساسي', g.primaryOptions(), () => g.settings.loadout[0], (v) => { g.settings.loadout[0] = v; g.saveSettings(); }));
        rows.push(choice('السلاح الثانوي', g.secondaryOptions(), () => g.settings.loadout[1], (v) => { g.settings.loadout[1] = v; g.saveSettings(); }));
        rows.push(choice('القنبلة', [['grenade', 'قنبلة يدوية'], ['shama', 'شمعة إشارة']], () => g.settings.throwable, (v) => { g.settings.throwable = v; g.saveSettings(); }));
        return rows;
      },
    };

    // ---------------- الإعدادات
    S.settings = {
      id: 'settings', title: 'الإعدادات', subtitle: 'كل شيء يعمل دون إنترنت، وتُحفظ في جهازك',
      items: () => [
        header('الشاشة والرسم'),
        choice('جودة الرسم', [{ id: 0, label: 'منخفضة' }, { id: 1, label: 'متوسطة' }, { id: 2, label: 'عالية' }, { id: 3, label: 'قصوى' }], () => g.settings.quality, (v) => { g.settings.quality = v; g.saveSettings(); g.applyQuality(); }),
        choice('حد الإطارات', [{ id: 30, label: '30' }, { id: 60, label: '60' }, { id: 120, label: '120' }, { id: 0, label: 'غير محدود' }], () => g.settings.fpsLimit, (v) => { g.settings.fpsLimit = v; g.saveSettings(); }),
        choice('تكبير البكسل (عدد صحيح)', [{ id: true, label: 'مضبوط (أفضل)' }, { id: false, label: 'ملء الشاشة' }], () => g.settings.integerScaling, (v) => { g.settings.integerScaling = v; g.saveSettings(); }),
        slider('اهتزاز الشاشة', 0, 1.5, 0.05, () => (Number.isFinite(g.settings.shakeScale) ? g.settings.shakeScale : 1), (v) => { g.settings.shakeScale = v; g.saveSettings(); }, (v) => `${Math.round((Number.isFinite(v) ? v : 1) * 100)}%`),
        choice('مؤثرات ما بعد المعالجة', [{ id: true, label: 'مفعّلة' }, { id: false, label: 'موقوفة (أسرع)' }], () => g.settings.postFx, (v) => { g.settings.postFx = v; g.saveSettings(); g.applyQuality(); }),
        choice('الإضاءة الديناميكية', [{ id: true, label: 'مفعّلة' }, { id: false, label: 'موقوفة' }], () => g.settings.lighting, (v) => { g.settings.lighting = v; g.saveSettings(); g.applyQuality(); }),
        choice('حبيبات الفيلم', [{ id: 0, label: 'بدون' }, { id: 0.06, label: 'خفيفة' }, { id: 0.14, label: 'قوية' }], () => g.settings.grain, (v) => { g.settings.grain = v; g.saveSettings(); g.applyQuality(); }),
        choice('وضع توفير الطاقة', [{ id: false, label: 'إيقاف' }, { id: true, label: 'تشغيل' }], () => g.settings.powerSaving, (v) => { g.settings.powerSaving = v; g.saveSettings(); g.applyQuality(); }),
        header('الصوت'),
        slider('الصوت العام', 0, 1, 0.05, () => g.audioSettings.master, (v) => { g.audioSettings.master = v; g.applyAudio(); }, (v) => `${Math.round(v * 100)}%`),
        slider('الموسيقى', 0, 1, 0.05, () => g.audioSettings.music, (v) => { g.audioSettings.music = v; g.applyAudio(); }, (v) => `${Math.round(v * 100)}%`),
        slider('المؤثرات', 0, 1, 0.05, () => g.audioSettings.sfx, (v) => { g.audioSettings.sfx = v; g.applyAudio(); }, (v) => `${Math.round(v * 100)}%`),
        slider('الأصوات البشرية', 0, 1, 0.05, () => g.audioSettings.voice, (v) => { g.audioSettings.voice = v; g.applyAudio(); }, (v) => `${Math.round(v * 100)}%`),
        header('اللعب'),
        choice('اللغة', [{ id: 'ar', label: 'العربية (RTL)' }, { id: 'en', label: 'English (LTR)' }], () => g.settings.language, (v) => { g.settings.language = v; g.saveSettings(); this.message(v === 'ar' ? 'اللغة: العربية' : 'Language: English', 'ok'); }),
        choice('نمط التصويب', [{ id: 'hold', label: 'استمر بالضغط' }, { id: 'toggle', label: 'تبديل' }], () => g.settings.adsMode, (v) => { g.settings.adsMode = v; g.saveSettings(); }),
        choice('إطلاق تلقائي عند التصويب', [{ id: true, label: 'مفعّل' }, { id: false, label: 'موقوف' }], () => g.settings.autoFire, (v) => { g.settings.autoFire = v; g.saveSettings(); }),
        choice('وضع لوني (عمى الألوان)', [{ id: 'none', label: 'عادي' }, { id: 'deuter', label: 'ديوترانوبيا' }, { id: 'prot', label: 'بروتانوبيا' }, { id: 'trit', label: 'تريتانوبيا' }], () => g.settings.colorblind, (v) => { g.settings.colorblind = v; g.saveSettings(); g.applyColorblind(); }),
        slider('مساعد التصويب', 0, 1, 0.05, () => g.settings.aimAssist, (v) => { g.settings.aimAssist = v; g.saveSettings(); }, (v) => `${Math.round(v * 100)}%`),
        header('البوتات'),
        slider('عدد البوتات', 0, 11, 1, () => g.settings.botCount, (v) => { g.settings.botCount = v; g.saveSettings(); }, (v) => `${v}`),
        choice('صعوبة البوتات', DIFFICULTY.map((d, i) => ({ id: i, label: d.nameAr })), () => g.settings.difficulty, (v) => { g.settings.difficulty = v; g.saveSettings(); }),
        choice('قتال الفريق (Friendly Fire)', [{ id: false, label: 'موقوف' }, { id: true, label: 'مفعّل (خطر!)' }], () => g.settings.friendlyFire, (v) => { g.settings.friendlyFire = v; g.saveSettings(); }),
        header('خيارات متقدمة'),
        choice('شبكة/تشخيص (Overlay)', [{ id: false, label: 'مخفي' }, { id: true, label: 'ظاهر' }], () => g.settings.netOverlay, (v) => { g.settings.netOverlay = v; g.saveSettings(); }),
        choice('عداد الإطارات (FPS)', [{ id: false, label: 'مخفي' }, { id: true, label: 'ظاهر' }], () => g.settings.showFps, (v) => { g.settings.showFps = v; g.saveSettings(); }),
        action('تصفير الإعدادات', () => { g.resetSettings(); this.message('أُعيدت الإعدادات الافتراضية', 'ok'); }),
        action('حذف كل البيانات المحفوظة', () => { g.wipeData(); this.message('حُذفت البيانات', 'error'); }, { type: 'danger' }),
      ],
    };

    // ---------------- التحكم
    S.controls = {
      id: 'controls', title: 'تخصيص التحكم', subtitle: 'اضبط التحكم كما تحب — يُحفظ تلقائيًا',
      items: () => [
        header('العصا اللمسية'),
        choice('موضع العصا', [{ id: 'floating', label: 'عائم (حيث تلمس)' }, { id: 'fixed', label: 'ثابت' }], () => g.controls.joystickMode, (v) => { g.controls.joystickMode = v; g.saveControls(); }),
        slider('حجم العصا', 40, 100, 2, () => g.controls.stickSize, (v) => { g.controls.stickSize = v; g.saveControls(); }, (v) => `${v} بكسل`),
        slider('شفافية العصا', 0.1, 1, 0.05, () => g.controls.stickAlpha, (v) => { g.controls.stickAlpha = v; g.saveControls(); }, (v) => `${Math.round(v * 100)}%`),
        slider('شفافية الأزرار', 0.1, 1, 0.05, () => g.controls.buttonAlpha, (v) => { g.controls.buttonAlpha = v; g.saveControls(); }, (v) => `${Math.round(v * 100)}%`),
        header('التصويب'),
        slider('حساسية الحركة', 0.3, 2, 0.05, () => g.controls.sensitivity, (v) => { g.controls.sensitivity = v; g.saveControls(); }, (v) => `${v.toFixed(2)}×`),
        slider('حساسية التصويب', 0.3, 2, 0.05, () => g.controls.aimSensitivity, (v) => { g.controls.aimSensitivity = v; g.saveControls(); }, (v) => `${v.toFixed(2)}×`),
        choice('تصويب بالجيروسكوب', [{ id: false, label: 'موقوف' }, { id: true, label: 'مفعّل (يتطلب صلاحية)' }], () => g.controls.gyro, async (v) => { g.controls.gyro = v; g.saveControls(); if (v && g.input.enableGyro) { const ok = await g.input.enableGyro(); this.message(ok ? 'تم تشغيل الجيروسكوب' : 'لم تُمنح الصلاحية', ok ? 'ok' : 'error'); } }),
        slider('مساعد التصويب باللمس', 0, 1, 0.05, () => g.controls.aimAssist, (v) => { g.controls.aimAssist = v; g.saveControls(); }, (v) => `${Math.round(v * 100)}%`),
        header('التخطيط والأزرار'),
        choice('تخطيط Claw', [{ id: 2, label: 'إصبعان' }, { id: 3, label: 'ثلاثة أصابع' }, { id: 4, label: 'أربعة أصابع' }], () => g.controls.clawLayout, (v) => { g.controls.clawLayout = v; g.saveControls(); g.rebuildTouchButtons(); }),
        choice('الاستخدام باليد اليسرى', [{ id: false, label: 'يمين' }, { id: true, label: 'يسار' }], () => g.controls.leftHanded, (v) => { g.controls.leftHanded = v; g.saveControls(); g.rebuildTouchButtons(); }),
        choice('إظهار أزرار اللمس', [{ id: 'auto', label: 'تلقائي' }, { id: 'always', label: 'دائمًا' }, { id: 'never', label: 'مخفي' }], () => g.settings.showTouchControls, (v) => { g.settings.showTouchControls = v; g.saveSettings(); g.updateTouchVisibility(); }),
        choice('إطلاق عند اللمس', [{ id: true, label: 'مفعّل' }, { id: false, label: 'موقوف' }], () => g.controls.tapToFire, (v) => { g.controls.tapToFire = v; g.saveControls(); }),
        choice('الاستمرار بالتصويب', [{ id: false, label: 'اضغط واحتفظ' }, { id: true, label: 'اضغط مرة' }], () => g.controls.holdToAim, (v) => { g.controls.holdToAim = v; g.saveControls(); }),
        choice('الاهتزاز (هاتف)', [{ id: true, label: 'مفعّل' }, { id: false, label: 'موقوف' }], () => g.controls.haptics, (v) => { g.controls.haptics = v; g.saveControls(); }),
        action('استعادة التحكم الافتراضي', () => { Object.assign(g.controls, DEFAULT_CONTROLS); g.saveControls(); this.message('أُعيد التحكم الافتراضي', 'ok'); }),
      ],
    };

    // ---------------- الشبكة المحلية
    S.lan = {
      id: 'lan', title: 'شبكة محلية (LAN)', subtitle: 'بلا إنترنت: نقطة اتصال واحدة تكفي',
      items: () => [
        action('إنشاء غرفة (استضافة)', () => { g.hostLan(); }, { icon: 'icon_crown', desc: 'أنت المضيف — البقية ينضمون' }),
        action('الانضمام المباشر بأقرب مضيف', () => { g.joinLanAuto(); }, { icon: 'icon_ping', desc: 'بحث تلقائي بالإرسال العام (3 ثوانٍ)' }),
        action('الانضمام بعنوان IP يدوي', () => {
          const ip = prompt('اكتب عنوان المضيف (مثال: 192.168.1.5:41980):', g.settings.lastIp || '');
          if (ip) { g.settings.lastIp = ip; g.saveSettings(); g.joinLanManual(ip); }
        }, { icon: 'icon_map', desc: g.settings.lastIp || 'لم يُستخدم بعد' }),
        action('دليل نقطة الاتصال (هوت سبوت)', () => this.push('hotspot'), { icon: 'icon_warning' }),
        header('خيارات الشبكة'),
        choice('منفذ الشبكة', [{ id: 41980, label: '41980 (افتراضي)' }, { id: 41981, label: '41981' }, { id: 27015, label: '27015' }], () => g.settings.port, (v) => { g.settings.port = v; g.saveSettings(); }),
        choice('نوع الاتصال في نسخة الويب', [{ id: 'bots', label: 'بوتات فقط (الويب)' }, { id: 'ws', label: 'وسيط WebSocket (تجربة)' }], () => g.settings.webNet, (v) => { g.settings.webNet = v; g.saveSettings(); this.message('ملاحظة: نسخة أندرويد تستخدم UDP مباشرًا', 'info'); }),
        slider('حجم إعادة الإرسال', 0, 8, 1, () => g.settings.maxResend, (v) => { g.settings.maxResend = v; g.saveSettings(); }, (v) => `${v} حزم`),
        action('الاتصال يعمل عبر نقطة الاتصال فقط — لا يخرج للإنترنت أبدًا', () => {}, { disabled: true, icon: 'icon_warning' }),
      ],
    };

    // ---------------- الهوت سبوت
    S.hotspot = {
      id: 'hotspot', title: 'كيف تجعل هوت سبوت؟', subtitle: 'بوابة شبكة من هاتفك ليلعب الجميع',
      items: () => [
        header('أندرويد'),
        action('١) الإعدادات ← الشبكة والإنترنت', () => {}, { disabled: true }),
        action('٢) نقطة اتصال/مشاركة ← نقطة اتصال Wi-Fi', () => {}, { disabled: true }),
        action('٣) شغّلها واكتب اسمًا وكلمة مرور', () => {}, { disabled: true }),
        action('٤) دع أصدقاءك يتصلون بنفس النقطة', () => {}, { disabled: true }),
        action('٥) المضيف: إنشاء غرفة. البقية: الانضمام التلقائي', () => {}, { disabled: true }),
        header('آيفون'),
        action('١) الإعدادات ← نقطة اتصال شخصية', () => {}, { disabled: true }),
        action('٢) شغّل «السماح للآخرين بالانضمام»', () => {}, { disabled: true }),
        action('٣) البقية يدخلون نفس كلمة المرور', () => {}, { disabled: true }),
        header('تنبيهات مهمة'),
        action('أوقف تشغيل بيانات الهاتف (LAN فقط)', () => {}, { disabled: true, icon: 'icon_warning' }),
        action('أوقف VPN — قد يمنع بثّ الاكتشاف', () => {}, { disabled: true, icon: 'icon_warning' }),
        action('تأكد من صلاحية «الأجهزة القريبة» على أندرويد 13', () => {}, { disabled: true, icon: 'icon_warning' }),
        action('البِنج المثالي أقل من 30 م.ث — العب قريبًا من جهاز الاستضافة', () => {}, { disabled: true }),
      ],
    };

    // ---------------- الإحصاءات
    S.stats = {
      id: 'stats', title: 'الإحصاءات والإنجازات', subtitle: 'كل التقدم محلي على جهازك، مشفّر',
      items: () => {
        const p = g.profile;
        const s = p.stats || {};
        const rows = [
          header('ملخّص'),
          action(`المستوى ${p.level} — ${p.xp} نقطة خبرة`, () => {}, { disabled: true, icon: 'icon_crown' }),
          action(`قتلات: ${s.kills || 0} | موت: ${s.deaths || 0} | مباريات: ${s.matches || 0}`, () => {}, { disabled: true }),
          action(`الدقة العامة: ${s.matches ? Math.round(((s.hits || 0) / Math.max(1, s.shots || 0)) * 100) : 0}%`, () => {}, { disabled: true }),
          action(`أطول قتلة: ${Math.round(s.longestKill || 0)} مترًا`, () => {}, { disabled: true }),
          action(`إحياءات: ${s.revives || 0} | مساعدات: ${s.assists || 0}`, () => {}, { disabled: true }),
          header('التحديات اليومية/الأسبوعية'),
        ];
        for (const c of (g.progression ? g.progression.challenges : [])) {
          rows.push(action(`${c.text} — ${c.progress}/${c.goal}`, () => {}, { disabled: true, color: c.done ? '#5ED67B' : '#EAF2F6' }));
        }
        rows.push(header(`الإنجازات (${p.achievements.length}/${ACHIEVEMENTS.length})`));
        for (const a of ACHIEVEMENTS) {
          const done = p.achievements.includes(a.id);
          rows.push(action(`${done ? '✔ ' : '✖ '}${a.nameAr}`, () => {}, { disabled: true, desc: a.descAr, color: done ? '#5ED67B' : '#7E8C99' }));
        }
        return rows;
      },
    };

    // ---------------- الائتمانات
    S.credits = {
      id: 'credits', title: 'الائتمانات', subtitle: 'كل شيء هنا صُنع من الصفر بالكود',
      items: () => [
        header('التصميم والبرمجة'),
        action('فريق ميكا 11', () => {}, { disabled: true }),
        header('الرسوم'),
        action('كل الأطالس مولّدة برمجيًا (Python + Pillow)', () => {}, { disabled: true, desc: 'لا صور جاهزة من الإنترنت' }),
        action('لوحة ألوان واحدة 64 لونًا + حد خارجي 1 بكسل', () => {}, { disabled: true }),
        header('الصوت'),
        action('مولّد صوت إجرائي (NumPy + soundfile)', () => {}, { disabled: true, desc: '108 ملفًا' }),
        header('الخطوط'),
        action('Cairo — رخصة SIL Open Font License 1.1', () => {}, { disabled: true }),
        action('Noto Sans Arabic — SIL OFL 1.1', () => {}, { disabled: true }),
        action('Press Start 2P — SIL OFL 1.1', () => {}, { disabled: true }),
        header('التراخيص'),
        action('لا مكتبات تتطلب إذن الإنترنت — لا إعلانات ولا تتبّع', () => {}, { disabled: true }),
      ],
    };

    // ---------------- الإيقاف المؤقت
    S.pause = {
      id: 'pause', title: 'إيقاف مؤقت', subtitle: 'المباراة متوقفة',
      items: () => [
        action('استئناف', () => { g.resume ? g.resume() : (g.state = 'playing'); }, { icon: 'icon_star' }),
        action('الإعدادات', () => this.push('settings'), { icon: 'icon_settings' }),
        action('تخصيص التحكم', () => this.push('controls'), { icon: 'icon_settings' }),
        action('إعادة المباراة', () => { g.restartMatch(); }, { icon: 'icon_map' }),
        action('الخروج للقائمة', () => { g.toMenu(); this.home(); }, { type: 'danger', icon: 'icon_warning' }),
      ],
    };

    return S;
  }
}
