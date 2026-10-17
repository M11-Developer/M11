// ============================================================================
// واجهة اللعب (HUD) — عربية بالكامل من اليمين لليسار، مرسومة بأيقونات أطلس ui
// ونصوص متجهّة (لا نص محروق داخل الصور — القسم 3).
//
// تشمل: الصحة/الدرع/الوقود، الذخيرة والسلاح، الخريطة المصغّرة والمنطقة الآمنة،
// عجلة الأوامر (Ping)، سجل القتل، مؤشر اتجاه الضرر، العدّاد، لوحة الفريق،
// وصفحة الإحصاءات. كل الأرقام إنجليزية لكن التسميات عربية (قاعدة الأرقام).
// ============================================================================
import { getBackdrop } from '../render/renderer.js';

import { CONFIG, WEAPON_CLASS_AR, RARITY_AR, RARITY_COLOR } from '../core/assets.js';
import { clamp, lerp, formatTime, TAU } from '../core/math.js';
import { WEAPONS, resolveStats } from '../game/weapons.js';
import { MODES } from './modes.js';
import { MAPS } from './world.js';

const W = CONFIG.internalWidth;
const H = CONFIG.internalHeight;

export const PING_TYPES = [
  { id: 'enemy', label: 'عدو هنا', icon: 'icon_enemy', color: '#E8734A' },
  { id: 'loot', label: 'غنائم', icon: 'icon_star', color: '#F2C14E' },
  { id: 'move', label: 'تحرّكوا', icon: 'icon_map', color: '#4FD1C5' },
  { id: 'help', label: 'أحتاج مساعدة', icon: 'icon_warning', color: '#E85D9B' },
  { id: 'yes', label: 'نعم', icon: 'icon_crown', color: '#7FD2F5' },
  { id: 'no', label: 'لا', icon: 'icon_skull', color: '#9BB8C4' },
];

export class HUD {
  constructor(assets) {
    this.assets = assets;
    this.scale = 1;
    this.time = 0;
    this.toasts = [];
    this.damageDirs = [];
    this.killMarkers = [];
    this.chat = [];
    this.pingWheel = { open: false, index: 0, angle: 0 };
    this.netOverlay = false;
    this.net = { ping: 0, jitter: 0, loss: 0, up: 0, down: 0, mode: 'بوتات' };
    this.hitMarker = 0;
    this.hitMarkerKill = false;
    this.hitMarkerHead = false;
    this.fontStack = '"Cairo", "Noto Sans Arabic", "Tahoma", "Segoe UI", system-ui, sans-serif';
    this.pixelFont = '"Press Start 2P", monospace';
    this.showBigMap = false;
    this.spectate = null;
    this.killcam = null;
    this.fps = 60;
    this.pingMarker = null;   // { x, y, t, kind }
    this.pings = [];
  }

  toast(text, color = '#F2C14E', life = 2.4) {
    this.toasts.push({ text, color, life, max: life });
    if (this.toasts.length > 5) this.toasts.shift();
  }

  chatMessage(name, text, team) {
    this.chat.push({ name, text, team, life: 8 });
    if (this.chat.length > 6) this.chat.shift();
  }

  damageFrom(angle, amount) {
    this.damageDirs.push({ angle, life: 1.1, max: 1.1, amount });
    if (this.damageDirs.length > 4) this.damageDirs.shift();
  }

  showHit(killed, headshot) {
    this.hitMarker = 0.28;
    this.hitMarkerKill = killed;
    this.hitMarkerHead = headshot;
  }

  update(dt) {
    this.time += dt;
    for (let i = this.toasts.length - 1; i >= 0; i--) {
      this.toasts[i].life -= dt;
      if (this.toasts[i].life <= 0) this.toasts.splice(i, 1);
    }
    for (let i = this.damageDirs.length - 1; i >= 0; i--) {
      this.damageDirs[i].life -= dt;
      if (this.damageDirs[i].life <= 0) this.damageDirs.splice(i, 1);
    }
    for (let i = this.chat.length - 1; i >= 0; i--) {
      this.chat[i].life -= dt;
      if (this.chat[i].life <= 0) this.chat.splice(i, 1);
    }
    this.hitMarker = Math.max(0, this.hitMarker - dt);
    if (this.pingMarker) {
      this.pingMarker.t -= dt;
      if (this.pingMarker.t <= 0) this.pingMarker = null;
    }
    for (let i = this.pings.length - 1; i >= 0; i--) {
      this.pings[i].t -= dt;
      if (this.pings[i].t <= 0) this.pings.splice(i, 1);
    }
  }

  // ------------------------------------------------------------- الرسم
  /**
   * يرسم واجهة اللعب.
   * @param {object} ctx سياق فضاء الشاشة (640×360)
   * @param {object} world عالم اللعبة
   * @param {object} view اللاعب
   * @param {object} opts { renderer, inputMode, showTouchControls, settings, net }
   */
  draw(ctx, world, view, opts = {}) {
    const a = this.assets;
    const ui = a.get('ui');
    ctx.save();
    ctx.textBaseline = 'alphabetic';
    this.drawCrosshair(ctx, view, world, opts);
    this.drawHitMarker(ctx);
    this.drawVitals(ctx, view, world, opts);
    this.drawWeaponPanel(ctx, view, opts);
    this.drawMinimap(ctx, world, view, opts);
    this.drawTopBar(ctx, world, view, opts);
    this.drawKillFeed(ctx, world, opts);
    this.drawDamageDirs(ctx, view);
    this.drawToasts(ctx);
    this.drawChat(ctx);
    this.drawZoneWarnings(ctx, world, view);
    if (this.pingWheel.open) this.drawPingWheel(ctx, opts);
    if (this.pings.length || this.pingMarker) this.drawPings(ctx, world, opts);
    if (view && !view.alive && view.spectate) this.drawSpectate(ctx, world, view, opts);
    if (this.killcam) this.drawKillcam(ctx, world, opts);
    if (this.netOverlay) this.drawNetOverlay(ctx, world, view, opts);
    this.drawInteraction(ctx, world, view);
    // عدّاد الإطارات (تشخيص اختياري — يُفعّل من الإعدادات)
    if (opts.settings && opts.settings.showFps) {
      this.num(ctx, `${Math.round(this.fps)} FPS`, W / 2, H - 3, { size: 7, color: '#7E8C99', align: 'center' });
    }
    ctx.restore();
  }

  panel(ctx, x, y, w, h, deep = false) {
    const ui = this.assets.get('ui');
    const key = deep ? 'ui/panel_deep' : 'ui/panel';
    if (ui && ui.has(key) && ui.frame(key).ox >= w && ui.frame(key).oy >= h) {
      ui.draw(ctx, key, x, y, 1, false);
      return;
    }
    ctx.fillStyle = deep ? 'rgba(9,11,15,0.86)' : 'rgba(14,17,22,0.78)';
    ctx.fillRect(x, y, w, h);
    ctx.fillStyle = 'rgba(255,255,255,0.10)';
    ctx.fillRect(x, y, w, 1);
    ctx.fillStyle = 'rgba(0,0,0,0.5)';
    ctx.fillRect(x, y + h - 1, w, 1);
    ctx.fillRect(x + w - 1, y, 1, h);
  }

  icon(ctx, name, x, y) {
    const ui = this.assets.get('ui');
    if (ui && ui.has('ui/' + name)) {
      ui.draw(ctx, 'ui/' + name, Math.round(x), Math.round(y), 1, false);
      return true;
    }
    return false;
  }

  text(ctx, str, x, y, opts = {}) {
    ctx.save();
    ctx.font = `${opts.bold ? '700 ' : ''}${opts.size || 9}px ${opts.pixel ? this.pixelFont : this.fontStack}`;
    ctx.textAlign = opts.align || 'right';
    ctx.direction = 'rtl';
    if (opts.shadow !== false) {
      ctx.fillStyle = 'rgba(0,0,0,0.75)';
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
    if (opts.shadow !== false) {
      ctx.fillStyle = 'rgba(0,0,0,0.75)';
      ctx.fillText(str, x + 1, y + 1);
    }
    ctx.fillStyle = opts.color || '#EAF2F6';
    ctx.fillText(str, x, y);
    ctx.restore();
  }

  /** قياس عرض نص بخط الواجهة — لتفادي القصّ وحساب الأعمدة */
  measure(ctx, str, size = 9, bold = true) {
    ctx.save();
    ctx.font = `${bold ? '700 ' : ''}${size}px ${this.fontStack}`;
    const w = ctx.measureText(str).width;
    ctx.restore();
    return w;
  }

  bar(ctx, x, y, w, h, pct, color, bg = 'rgba(11,13,16,0.8)', border = '#0B0D10') {
    ctx.fillStyle = border;
    ctx.fillRect(x - 1, y - 1, w + 2, h + 2);
    ctx.fillStyle = bg;
    ctx.fillRect(x, y, w, h);
    const fw = Math.round(w * clamp(pct, 0, 1));
    ctx.fillStyle = color;
    ctx.fillRect(x, y, fw, h);
    // لمعة علوية (تظليل بقعة ضوء)
    ctx.fillStyle = 'rgba(255,255,255,0.22)';
    ctx.fillRect(x, y, fw, Math.max(1, Math.floor(h / 3)));
    ctx.fillStyle = 'rgba(0,0,0,0.28)';
    ctx.fillRect(x, y + h - 1, fw, 1);
  }

  // ------------------------------------------------------------- العناصر
  drawCrosshair(ctx, view, world, opts) {
    if (!view || !view.alive) return;
    const a = this.assets;
    const ui = a.get('ui');
    const cx = W / 2, cy = H / 2;
    const st = view.weaponStats ? view.weaponStats() : (view.weaponId ? resolveStats(view.weaponId, view.weaponAttachments || []) : null);
    const spread = st ? Math.max(2, Math.round(st.spreadBase * (view.ads ? 0.45 : 1) + (view.grounded ? 0 : 2) + (view.velocitySpread || 0))) : 3;
    const idx = view.ads ? 3 : (view.weaponId && WEAPONS[view.weaponId] && WEAPONS[view.weaponId].cls === 'sr' ? 2 : 1);
    if (ui) {
      const key = 'ui/crosshair_' + idx;
      if (ui.has(key)) {
        const f = ui.frame(key);
        ui.draw(ctx, key, Math.round(cx - (f.ox + spread * 2) / 2), Math.round(cy - (f.oy + spread * 2) / 2), 1 + spread * 0.06, false);
      }
    }
    ctx.save();
    ctx.globalAlpha = 0.85;
    ctx.fillStyle = opts.settings && opts.settings.crosshairColor ? opts.settings.crosshairColor : '#7CFFB2';
    const g = 3 + spread;
    ctx.fillRect(cx - 1, cy - g - 4, 2, 4);
    ctx.fillRect(cx - 1, cy + g, 2, 4);
    ctx.fillRect(cx - g - 4, cy - 1, 4, 2);
    ctx.fillRect(cx + g, cy - 1, 4, 2);
    ctx.fillRect(cx, cy, 1, 1);
    ctx.restore();
    // مؤشر القنص (تلسكوبي)
    if (view.ads && st && st.scopeLevel >= 2) {
      ctx.save();
      ctx.fillStyle = 'rgba(6,8,10,0.72)';
      ctx.beginPath();
      ctx.arc(cx, cy, 62, 0, TAU);
      ctx.rect(0, 0, W, H);
      ctx.fill('evenodd');
      ctx.strokeStyle = 'rgba(10,12,14,0.9)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(cx - 60, cy); ctx.lineTo(cx + 60, cy);
      ctx.moveTo(cx, cy - 60); ctx.lineTo(cx, cy + 60);
      ctx.stroke();
      ctx.strokeStyle = 'rgba(255,255,255,0.18)';
      ctx.beginPath();
      ctx.arc(cx, cy, 62, 0, TAU);
      ctx.stroke();
      // علامات المسافة
      for (let i = 1; i <= 3; i++) {
        ctx.fillStyle = 'rgba(255,255,255,0.5)';
        ctx.fillRect(cx - 3 - i * 6, cy + i * 6, 2, 2);
      }
      ctx.restore();
    }
    // تعتيم أثناء التصويب (ADS)
    if (view.ads) {
      ctx.save();
      ctx.globalAlpha = 0.25;
      ctx.fillStyle = '#05070A';
      ctx.fillRect(0, 0, W, H);
      ctx.restore();
    }
  }

  drawHitMarker(ctx) {
    if (this.hitMarker <= 0.001) return;
    const cx = W / 2, cy = H / 2;
    const t = 1 - this.hitMarker / 0.28;
    ctx.save();
    ctx.globalAlpha = clamp(1 - t, 0, 1);
    ctx.strokeStyle = this.hitMarkerKill ? '#FF6B4A' : (this.hitMarkerHead ? '#F2C14E' : '#FFFFFF');
    ctx.lineWidth = 2;
    const r = 4 + t * 4;
    ctx.beginPath();
    ctx.moveTo(cx - r, cy - r); ctx.lineTo(cx - r + 3, cy - r + 3);
    ctx.moveTo(cx + r, cy - r); ctx.lineTo(cx + r - 3, cy - r + 3);
    ctx.moveTo(cx - r, cy + r); ctx.lineTo(cx - r + 3, cy + r - 3);
    ctx.moveTo(cx + r, cy + r); ctx.lineTo(cx + r - 3, cy + r - 3);
    ctx.stroke();
    ctx.restore();
  }

  drawVitals(ctx, view, world, opts) {
    if (!view) return;
    const touch = !!(opts && opts.showTouchControls);
    // على الهاتف ننقل الصحة أعلى اليسار (تحت الخريطة) حتى لا يغطيها الإبهام
    const mmH = Math.round(((opts && opts.settings && opts.settings.bigMinimap) ? 150 : 104) * 0.62);
    const x = 10;
    const y = touch ? 8 + mmH + 28 : H - 62;
    const hp = clamp(view.hp / Math.max(1, view.maxHp), 0, 1);
    const hpCol = hp > 0.6 ? '#5ED67B' : hp > 0.3 ? '#F2C14E' : '#E8523F';
    this.panel(ctx, x - 2, y - 2, 186, 58, true);
    // الصحة
    this.bar(ctx, x + 6, y + 6, 138, 10, hp, hpCol);
    this.num(ctx, `${Math.ceil(view.hp)}`, x + 148, y + 15, { size: 11, bold: true, color: hpCol });
    this.icon(ctx, 'icon_medkit', x + 168, y + 2);
    // الدرع
    if (view.armorLevel > 0) this.bar(ctx, x + 6, y + 21, 104, 5, view.armor / 100, '#7FD2F5');
    else this.bar(ctx, x + 6, y + 21, 104, 5, 0, '#7FD2F5');
    // وقود الجيت باك
    const fuel = clamp(view.jetFuel / CONFIG.jetpackFuel, 0, 1);
    this.bar(ctx, x + 6, y + 31, 104, 5, fuel, fuel > 0.25 ? '#F2A03E' : '#E8523F');
    // العتاد: خوذة/درع/حقيبة + عدّاد الوقود
    let gx = x + 116;
    if (view.helmetLevel > 0) { this.icon(ctx, 'icon_helmet', gx, y + 18); gx += 17; }
    if (view.armorLevel > 0) { this.icon(ctx, 'icon_armor', gx, y + 18); gx += 17; }
    if (view.backpackLevel > 0) { this.icon(ctx, 'icon_backpack', gx, y + 18); gx += 17; }
    this.icon(ctx, 'icon_jetpack', x + 154, y + 29);
    // الأدوية — على اللمس تُصفّ أسفل لوحة الصحة (كانت تحت أزرار الإطلاق مباشرة)
    const healRow = [['bandage', view.heals ? view.heals.bandage : 0, 'icon_medkit'], ['medkit', view.heals ? view.heals.medkit : 0, 'icon_medkit'], ['adrenaline', view.heals ? view.heals.adrenaline : 0, 'icon_star']];
    let hx = touch ? x : W - 14;
    const hy = touch ? y + 62 : H - 44;
    const step = touch ? 24 : 22;
    for (const [k, count, icon] of healRow) {
      if (!count) continue;
      if (!touch) hx -= step;
      this.panel(ctx, hx, hy, 20, 18, true);
      this.icon(ctx, icon, hx + 3, hy + 2);
      this.num(ctx, `${count}`, hx + 13, hy + 14, { size: 8, bold: true });
      if (touch) hx += step;
    }
    if (view.throwable && view.throwable.count) {
      if (!touch) hx -= step;
      this.panel(ctx, hx, hy, 20, 18, true);
      this.icon(ctx, 'icon_grenade', hx + 3, hy + 2);
      this.num(ctx, `${view.throwable.count}`, hx + 13, hy + 14, { size: 8, bold: true });
    }
  }

  drawWeaponPanel(ctx, view, opts = {}) {
    if (!view || !view.weaponId) return;
    const w = WEAPONS[view.weaponId];
    if (!w) return;
    const st = view.weaponStats ? view.weaponStats() : resolveStats(view.weaponId, view.weaponAttachments || []);
    const slot = view.weapons[view.slot];
    // على الهاتف نرفع لوحة السلاح فوق عنقود أزرار الإطلاق (كانت فوقها تمامًا)
    const x = W - 196;
    const y = (opts.showTouchControls ? H - 206 : H - 96);
    const pw = 188, ph = 54;
    this.panel(ctx, x, y, pw, ph, true);
    // أيقونة الفئة أعلى اليسار (طرف الشاشة)
    const iconName = { pistol: 'icon_pistol', smg: 'icon_smg', ar: 'icon_rifle', sr: 'icon_sniper', shotgun: 'icon_shotgun', lmg: 'icon_lmg', energy: 'icon_rifle', launcher: 'icon_grenade', melee: 'icon_melee' }[w.cls] || 'icon_rifle';
    this.icon(ctx, iconName, x + 8, y + 6);
    // اسم السلاح (عربي) في سطر مستقل + الفئة تحته
    const nameW = pw - 44;
    this.text(ctx, w.nameAr, x + pw - 8, y + 16, { size: 11, bold: true, color: RARITY_COLOR[w.rarity] || '#EAF2F6', align: 'right', shadow: false });
    this.text(ctx, `${WEAPON_CLASS_AR[w.cls] || ''} · ${w.fireMode === 'auto' ? 'آلي' : w.fireMode === 'burst' ? 'رشقة' : 'فردي'}`,
      x + pw - 8 - Math.min(nameW, this.measure(ctx, w.nameAr, 11) + 6), y + 16, { size: 7, color: '#9BB8C4', align: 'right', shadow: false });
    // الذخيرة: رقم كبير + الاحتياطي
    const inMag = slot ? slot.ammo : 0;
    const reserve = view.ammo && view.ammo[w.cls] != null ? view.ammo[w.cls] : null;
    this.num(ctx, `${inMag}`, x + 10, y + 40, { size: 17, bold: true, color: inMag === 0 ? '#E8523F' : '#EAF2F6' });
    this.num(ctx, reserve == null ? '/ ∞' : `/ ${reserve}`, x + 10 + this.measure(ctx, `${inMag}`, 17) + 5, y + 40, { size: 9, color: '#9BB8C4' });
    // شريط الإعادة / التبديل فوق الأرقام
    if (view.reloading) {
      const p = view.reloadProgress ? view.reloadProgress() : 0;
      this.bar(ctx, x + 8, y + 25, 76, 4, p, '#F2C14E');
      this.text(ctx, 'إعادة تعبئة', x + 88, y + 29, { size: 7, color: '#F2C14E', shadow: false });
    } else if (view.switchTimer > 0) {
      this.bar(ctx, x + 8, y + 25, 76, 4, 1 - clamp(view.switchTimer / 0.5, 0, 1), '#7FD2F5');
    }
    // مؤشرا الخانتين أسفل يمين
    for (let i = 0; i < 2; i++) {
      const wx = x + pw - 44 + i * 14;
      const has = !!view.weapons[i];
      const active = view.slot === i;
      ctx.fillStyle = active ? '#F2C14E' : has ? 'rgba(234,242,246,0.55)' : 'rgba(234,242,246,0.18)';
      ctx.fillRect(wx, y + ph - 12, 10, 3);
    }
    this.text(ctx, view.slot === 0 ? '١' : '٢', x + pw - 10, y + ph - 12, { size: 7, color: '#7E8C99', shadow: false });
  }

  drawMinimap(ctx, world, view, opts) {
    const size = opts.settings && opts.settings.bigMinimap ? 150 : 104;
    const x = 8, y = 8, h = Math.round(size * 0.62);
    this.panel(ctx, x - 2, y - 2, size + 4, h + 4, true);
    const r = opts.renderer;
    if (r) {
      r.drawMinimap(ctx, x, y, size, h, world, view, { onlyTeam: world.mode.teams > 1 ? (view ? view.team : null) : null });
    }
    // إطار الخريطة المصغّرة
    this.icon(ctx, 'ui/minimap_frame', x - 1, y - 1);
    // اسم الخريطة فقط: اسم الوضع مكرر في شارة أعلى الشاشة، وكان السطران يزدحمان
    const mapW = this.measure(ctx, world.level.def.nameAr, 7);
    this.text(ctx, world.level.def.nameAr, x + size - 2, y + h + 12,
      { size: mapW > size - 6 ? 6 : 7, color: '#9BB8C4' });
    if (this.showBigMap) {
      const bw = 380, bh = 232, bx = (W - bw) / 2, by = (H - bh) / 2;
      ctx.save();
      ctx.fillStyle = 'rgba(6,8,11,0.88)';
      ctx.fillRect(0, 0, W, H);
      ctx.restore();
      this.panel(ctx, bx, by, bw, bh, true);
      if (r) r.drawMinimap(ctx, bx + 6, by + 6, bw - 12, bh - 12, world, view, { onlyTeam: null });
      this.text(ctx, 'الخريطة الكاملة — اضغط M للإغلاق', bx + bw - 8, by + bh - 6, { size: 8, color: '#9BB8C4' });
    }
  }

  drawTopBar(ctx, world, view, opts = {}) {
    const cx = W / 2;
    const touch = !!opts.showTouchControls;
    const mins = Math.max(0, Math.floor(world.matchTimer / 60));
    const secs = Math.max(0, Math.floor(world.matchTimer % 60));
    const timeStr = `${mins}:${secs.toString().padStart(2, '0')}`;
    // مؤقت مركزي واضح — كان نص النقاط يُرسم فوق أرقام المؤقت فيظهر مشوّهًا
    this.panel(ctx, cx - 37, 5, 74, 23, true);
    this.num(ctx, timeStr, cx, 21, { size: 13, bold: true, align: 'center' });
    // نقاط الوضع: يمين المؤقت
    if (world.mode.teams > 1) {
      this.panel(ctx, cx + 42, 5, 82, 23, true);
      this.num(ctx, `${world.teamScores[0] || 0}`, cx + 58, 21, { size: 12, bold: true, color: '#4FD1C5', align: 'center' });
      this.num(ctx, `:`, cx + 83, 21, { size: 11, color: '#7E8C99', align: 'center' });
      this.num(ctx, `${world.teamScores[1] || 0}`, cx + 108, 21, { size: 12, bold: true, color: '#E8734A', align: 'center' });
    } else {
      const target = world.mode.scoreLimit || 0;
      const best = view ? view.kills : 0;
      this.panel(ctx, cx + 42, 5, 82, 23, true);
      this.num(ctx, `${best}${target ? ' / ' + target : ''}`, cx + 83, 21, { size: 11, bold: true, color: '#F2C14E', align: 'center' });
    }
    // عدد الأحياء: يسار المؤقت
    const alive = world.getAliveCount();
    this.panel(ctx, cx - 108, 5, 66, 23, true);
    this.icon(ctx, 'icon_skull', cx - 102, 8);
    this.num(ctx, `${alive}`, cx - 66, 21, { size: 11, bold: true, align: 'center' });
    // اسم الوضع في سطر مستقل أسفل المؤقت — لا يزاحم الأرقام ولا يُقصّ
    const modeName = world.mode && world.mode.nameAr ? world.mode.nameAr : '';
    if (modeName) {
      const tw = Math.min(240, this.measure(ctx, modeName, 8) + 16);
      ctx.fillStyle = 'rgba(8,11,15,0.88)';
      ctx.fillRect(cx - tw / 2, 31, tw, 13);
      ctx.strokeStyle = 'rgba(242,193,78,0.22)';
      ctx.lineWidth = 1;
      ctx.strokeRect(cx - tw / 2 + 0.5, 31.5, tw - 1, 12);
      this.text(ctx, modeName, cx + tw / 2 - 8, 40, { size: 8, bold: true, color: '#F2C14E', align: 'right' });
    }
    // حالة الوضع الخاص أسفل الشريط
    let extra = '';
    if (world.modeId === 'snd' && world.snd) extra = `الجولة ${world.snd.round}`;
    else if (world.modeId === 'kotc' && world.kotc) extra = world.kotc.owner >= 0 ? `التل: فريق ${world.kotc.owner + 1}` : 'التل محايد';
    else if (world.modeId === 'goldenCard' && world.golden) extra = world.golden.holder ? `الكرت: ${world.golden.holder.name}` : 'الكرت حر';
    else if (world.modeId === 'infection' && world.infection) extra = `مصابون ${world.actors.filter((x) => x.isZombie && x.alive).length}`;
    else if (world.matchState === 'warmup') extra = `تبدأ خلال ${Math.ceil(world.warmupTimer)}`;
    if (extra && !touch) {
      this.text(ctx, extra, cx, 54, { size: 8, color: '#9BB8C4', align: 'center' });
    }
  }

  drawKillFeed(ctx, world, opts = {}) {
    // على اللمس توجد أزرار إيقاف/خريطة أعلى اليمين، فنبدأ السجل أسفل منها
    let y = opts.showTouchControls ? 48 : 22;
    const x = W - 10;
    for (let i = world.killFeed.length - 1; i >= 0 && i >= world.killFeed.length - 5; i--) {
      const k = world.killFeed[i];
      const age = world.time - k.time;
      if (age > 7) continue;
      const alpha = clamp(1 - (age - 5) / 2, 0, 1);
      ctx.save();
      ctx.globalAlpha = alpha;
      const wkey = k.weapon && WEAPONS[k.weapon] ? WEAPONS[k.weapon].nameAr : 'مشاجرة';
      const text = `${k.victim}`;
      const text2 = `${k.killer}`;
      this.text(ctx, text, x, y, { size: 8, color: k.victimTeam === 0 ? '#4FD1C5' : '#E8734A', align: 'right' });
      this.text(ctx, wkey + (k.headshot ? ' (رأس)' : ''), x - ctx.measureText(text).width - 26, y, { size: 7, color: '#F2C14E' });
      this.text(ctx, text2, x - 96, y, { size: 8, color: k.killerTeam === 0 ? '#4FD1C5' : k.killerTeam === 1 ? '#E8734A' : '#9BB8C4' });
      y += 11;
      ctx.restore();
    }
  }

  drawDamageDirs(ctx, view) {
    for (const d of this.damageDirs) {
      const fade = clamp(d.life / d.max, 0, 1);
      const cx = W / 2, cy = H / 2;
      const r = 52;
      ctx.save();
      ctx.globalAlpha = fade * 0.85;
      ctx.translate(cx, cy);
      ctx.rotate(d.angle);
      ctx.fillStyle = '#FF5A4A';
      ctx.beginPath();
      ctx.moveTo(r, 0);
      ctx.lineTo(r + 16, -7);
      ctx.lineTo(r + 16, 7);
      ctx.closePath();
      ctx.fill();
      ctx.globalAlpha = fade * 0.45;
      ctx.strokeStyle = '#FF5A4A';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(0, 0, r - 6, -0.35, 0.35);
      ctx.stroke();
      ctx.restore();
    }
  }

  drawToasts(ctx) {
    let y = H - 120;
    for (const t of this.toasts) {
      const fade = clamp(t.life / Math.min(0.6, t.max), 0, 1);
      ctx.save();
      ctx.globalAlpha = fade;
      this.text(ctx, t.text, W / 2 + 60, y, { size: 10, bold: true, color: t.color, align: 'right' });
      ctx.restore();
      y -= 13;
    }
  }

  drawChat(ctx) {
    let y = H - 150;
    for (const c of this.chat) {
      const fade = clamp(c.life / 1.2, 0, 1);
      ctx.save();
      ctx.globalAlpha = fade;
      this.text(ctx, `${c.name}: ${c.text}`, 10 + 200, y, { size: 8, color: c.team == null ? '#EAF2F6' : (c.team === 0 ? '#4FD1C5' : '#E8734A'), align: 'right' });
      ctx.restore();
      y -= 11;
    }
  }

  drawZoneWarnings(ctx, world, view) {
    if (!world.zone) return;
    const z = world.zone;
    const inZone = view && view.alive ? Math.hypot(view.cx - z.cx, view.cy - z.cy) <= z.radius : true;
    const x = W - 12;
    // حالة المنطقة
    let label, color;
    if (z.state === 'idle') { label = `تتقلّص خلال ${Math.ceil(z.timer)}`; color = '#7FD2F5'; }
    else if (z.shrinking) { label = 'المنطقة تتقلّص!'; color = '#FF8A5A'; }
    else { label = 'انتظار'; color = '#9BB8C4'; }
    this.panel(ctx, x - 112, 32, 112, 20, true);
    this.icon(ctx, 'icon_warning', x - 106, 35);
    this.text(ctx, label, x - 8, 46, { size: 9, bold: true, color });
    if (!inZone && view && view.alive) {
      ctx.save();
      ctx.globalAlpha = 0.35 + 0.35 * Math.sin(this.time * 6);
      ctx.fillStyle = '#E8523F';
      ctx.fillRect(0, 0, W, 3);
      ctx.fillRect(0, H - 3, W, 3);
      ctx.restore();
      this.text(ctx, 'أنت خارج المنطقة الآمنة!', W / 2, 60, { size: 12, bold: true, color: '#FF5A4A' });
    }
  }

  drawInteraction(ctx, world, view) {
    if (!view || !view.alive) return;
    const near = world.findLootNear ? world.findLootNear(view, 30) : null;
    if (!near || !near.active) return;
    const label = near.label || '';
    this.panel(ctx, W / 2 - 60, H / 2 + 38, 120, 18, true);
    this.text(ctx, `التقاط: ${label}`, W / 2, H / 2 + 51, { size: 9, bold: true, color: '#F2C14E', align: 'center' });
  }

  drawPingWheel(ctx, opts) {
    const cx = W / 2, cy = H / 2;
    const r = 56;
    ctx.save();
    ctx.globalAlpha = 0.55;
    ctx.fillStyle = '#05070A';
    ctx.fillRect(0, 0, W, H);
    ctx.restore();
    this.text(ctx, 'عجلة الأوامر', cx, cy - r - 12, { size: 10, bold: true, color: '#F2C14E', align: 'center' });
    PING_TYPES.forEach((p, i) => {
      const ang = -Math.PI / 2 + (i / PING_TYPES.length) * TAU;
      const px = cx + Math.cos(ang) * r;
      const py = cy + Math.sin(ang) * r;
      const active = i === this.pingWheel.index;
      ctx.save();
      ctx.globalAlpha = active ? 1 : 0.72;
      ctx.fillStyle = active ? 'rgba(242,193,78,0.22)' : 'rgba(14,17,22,0.85)';
      ctx.beginPath();
      ctx.arc(px, py, 19, 0, TAU);
      ctx.fill();
      ctx.strokeStyle = active ? '#F2C14E' : 'rgba(234,242,246,0.35)';
      ctx.lineWidth = active ? 2 : 1;
      ctx.stroke();
      ctx.restore();
      this.icon(ctx, p.icon, px - 8, py - 8);
      this.text(ctx, p.label, px, py + 30, { size: 7, color: active ? '#F2C14E' : '#9BB8C4', align: 'center' });
    });
  }

  drawPings(ctx, world, opts) {
    const cam = opts.cam;
    for (const p of this.pings) {
      if (!cam) continue;
      const s = cam.worldToScreen(p.x, p.y);
      const fade = clamp(p.t / 3, 0, 1);
      ctx.save();
      ctx.globalAlpha = fade;
      const def = PING_TYPES.find((q) => q.id === p.kind) || PING_TYPES[0];
      const bob = Math.sin(this.time * 6) * 2;
      ctx.strokeStyle = def.color;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(s.x, s.y - 20 + bob, 9, 0, TAU);
      ctx.stroke();
      this.icon(ctx, def.icon, s.x - 8, s.y - 28 + bob);
      ctx.restore();
    }
    if (this.pingMarker) {
      const m = this.pingMarker;
      ctx.save();
      ctx.globalAlpha = clamp(m.t / 0.6, 0, 1);
      ctx.strokeStyle = '#F2C14E';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(m.sx, m.sy, 6 + (1 - m.t / 0.6) * 6, 0, TAU);
      ctx.stroke();
      ctx.restore();
    }
  }

  drawSpectate(ctx, world, view, opts) {
    const target = world.actors.find((a) => a.id === view.spectate);
    this.panel(ctx, W / 2 - 90, H - 40, 180, 30, true);
    this.text(ctx, 'وضع المشاهدة — الفريق كامل', W / 2, H - 28, { size: 9, bold: true, color: '#F2C14E', align: 'center' });
    if (target) {
      this.text(ctx, `تشاهد: ${target.name}`, W / 2, H - 16, { size: 10, color: '#EAF2F6', align: 'center' });
    } else {
      this.text(ctx, 'انتظر انتهاء الجولة أو اخرج للقائمة', W / 2, H - 16, { size: 8, color: '#9BB8C4', align: 'center' });
    }
    this.text(ctx, '← → للتبديل بين اللاعبين', W / 2, H - 52, { size: 8, color: '#9BB8C4', align: 'center' });
  }

  drawKillcam(ctx, world, opts) {
    const kc = this.killcam;
    ctx.save();
    ctx.globalAlpha = 0.5;
    ctx.fillStyle = '#08090C';
    ctx.fillRect(0, 0, W, H);
    ctx.restore();
    this.text(ctx, 'إعادة المشهد', W / 2, 30, { size: 12, bold: true, color: '#E8523F', align: 'center' });
    const killer = world.actors.find((x) => x.id === kc.killerId);
    const dist = kc.dist;
    this.panel(ctx, W / 2 - 100, H - 42, 200, 32, true);
    this.text(ctx, `قاتلك: ${killer ? killer.name : 'بيئة'}`, W / 2 + 90, H - 28, { size: 10, bold: true, color: '#E8734A' });
    this.text(ctx, `المسافة ${Math.round(dist)} م | ${kc.weaponName || 'سلاح'}`, W / 2 + 90, H - 16, { size: 8, color: '#9BB8C4' });
    this.text(ctx, 'اضغط للتخطي', W / 2 - 90, H - 20, { size: 8, color: '#9BB8C4', align: 'left' });
  }

  drawNetOverlay(ctx, world, view, opts) {
    const pad = 8;
    const lines = [
      ['البِنج', `${Math.round(this.net.ping)} م.ث`, this.net.ping < 60 ? '#5ED67B' : this.net.ping < 120 ? '#F2C14E' : '#E8523F'],
      ['التذبذب', `${Math.round(this.net.jitter)} م.ث`, '#9BB8C4'],
      ['الفقد', `${(this.net.loss * 100).toFixed(1)}%`, this.net.loss < 0.02 ? '#5ED67B' : '#E8523F'],
      ['الأدوار', `${this.net.tick} Hz`, '#9BB8C4'],
      ['حجم الحزمة', `${this.net.up}/${this.net.down} بايت`, '#9BB8C4'],
      ['FPS', `${Math.round(this.fps)}`, '#5ED67B'],
      ['الوضع', this.net.mode, '#F2C14E'],
    ];
    const w = 148, h = lines.length * 11 + 10;
    this.panel(ctx, W - w - pad, 60, w, h, true);
    let y = 60 + 14;
    for (const [k, v, c] of lines) {
      this.text(ctx, k, W - pad - 8, y, { size: 8, color: '#9BB8C4' });
      this.num(ctx, v, W - pad - 60, y, { size: 8, bold: true, color: c, align: 'right' });
      y += 11;
    }
  }

  /** يحمّل صورة واجهة مرة واحدة (مصغّرة الخريطة في شاشة النتائج) */
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

  /** شاشة النتائج النهائية — بلوحة النصر أو الهزيمة المولّدة خلف الجدول */
  drawResults(ctx, results, opts = {}) {
    ctx.fillStyle = 'rgba(5,7,10,0.9)';
    ctx.fillRect(0, 0, W, H);
    const me = (results.standings || []).find((s) => s.isBot === false) || (results.standings || [])[0];
    // فوز/هزيمة: في الأوضاع الفرقية نقارن نقاط الفريقين، وفي الفردية نقارن الترتيب
    const teams = results.teams || [];
    const teamMode = teams.length > 1;
    const iWon = teamMode
      ? (!!me && me.team === (teams[0] >= teams[1] ? 0 : 1))
      : (!!me && me.placement === 1);
    const wonFinal = results.won !== undefined ? !!results.won : iWon;
    const poster = getBackdrop(wonFinal ? 'poster_victory' : 'poster_defeat');
    const bannerH = Math.round(H * 0.46);
    if (poster) {
      ctx.save();
      ctx.imageSmoothingEnabled = false;
      ctx.globalAlpha = 0.95;
      // اللوحة في الشريط العلوي (بعرض الشاشة) ليبقى فنها ظاهرًا كاملًا
      const ar = poster.width / poster.height;
      const dh = bannerH, dw = Math.min(W, dh * ar);
      ctx.drawImage(poster, 0, 0, poster.width, poster.height, (W - dw) / 2, 0, dw, dh);
      ctx.restore();
      // ستارة علوية خفيفة ليبقى نص "فوز/هزيمة" مقروءًا فوق أي لوحة
      const gTop = ctx.createLinearGradient(0, 0, 0, 64);
      gTop.addColorStop(0, 'rgba(5,7,10,0.82)');
      gTop.addColorStop(1, 'rgba(5,7,10,0)');
      ctx.fillStyle = gTop;
      ctx.fillRect(0, 0, W, 64);
      // تدرّج سفلي يدمج اللوحة مع الجدول
      const g2 = ctx.createLinearGradient(0, bannerH - 30, 0, bannerH + 6);
      g2.addColorStop(0, 'rgba(5,7,10,0)');
      g2.addColorStop(1, 'rgba(5,7,10,1)');
      ctx.fillStyle = g2;
      ctx.fillRect(0, bannerH - 30, W, 36);
    }
    this.panel(ctx, 60, bannerH - 8, W - 120, H - bannerH + 4, true);
    // شريط النتيجة العلوي: نص عربي واضح فوق اللوحة
    const title = wonFinal ? 'فوز' : 'هزيمة';
    this.text(ctx, title, W / 2, 30, { size: 18, bold: true, color: wonFinal ? '#5ED67B' : '#E8523F', align: 'center', shadow: true });
    this.text(ctx, wonFinal ? 'أحسنت — ساحة النار لك' : 'خسارة… حاول مرة أخرى', W / 2, 44, { size: 9, color: '#EAF2F6', align: 'center', shadow: true });
    // كان عنوان «نتائج المباراة» يُرسم فوق سطر الفائز تمامًا فيتراكبان
    this.text(ctx, 'نتائج المباراة', W / 2, bannerH + 10, { size: 11, bold: true, color: '#F2C14E', align: 'center' });
    const winner = results.standings[0];
    if (winner) {
      this.text(ctx, `الأول: ${winner.name}`, W - 74, bannerH + 10, { size: 9, color: '#EAF2F6', align: 'right' });
    }
    // رؤوس الأعمدة
    // أعمدة الجدول: مصدر واحد للعناوين والقيم حتى لا يتراكب أي عمودين
    const cols = [
      { key: 'placement', label: '#', x: 104, head: 104 },
      { key: 'name', label: 'اللاعب', x: 214, head: 214, text: true },
      { key: 'kills', label: 'قتل', x: 268, head: 268 },
      { key: 'deaths', label: 'موت', x: 306, head: 306 },
      { key: 'assists', label: 'مساعدة', x: 350, head: 350 },
      { key: 'headshots', label: 'رأس', x: 388, head: 388 },
      { key: 'accuracy', label: 'دقّة', x: 428, head: 428 },
      { key: 'damage', label: 'ضرر', x: 470, head: 470 },
      { key: 'longestKill', label: 'أطول', x: 514, head: 514 },
    ];
    const headerY = bannerH + 28;
    for (const c of cols) {
      this.text(ctx, c.label, c.head, headerY, { size: 8, bold: true, color: '#9BB8C4', align: 'right', shadow: false });
    }
    let y = headerY + 14;
    results.standings.forEach((s, i) => {
      if (i % 2 === 0) {
        ctx.fillStyle = 'rgba(255,255,255,0.04)';
        ctx.fillRect(66, y - 9, W - 132, 13);
      }
      const col = s.team === 0 ? '#4FD1C5' : s.team === 1 ? '#E8734A' : '#EAF2F6';
      for (const c of cols) {
        if (c.key === 'name') {
          this.text(ctx, String(s.name || ''), c.x, y, { size: 9, bold: s.isBot === false, color: col, align: 'right' });
        } else if (c.key === 'accuracy') {
          this.num(ctx, `${s.accuracy}%`, c.x, y, { size: 9, align: 'right' });
        } else {
          this.num(ctx, `${s[c.key]}`, c.x, y, {
            size: 9, align: 'right',
            color: c.key === 'placement' && i === 0 ? '#F2C14E' : '#EAF2F6',
          });
        }
      }
      y += 13;
      if (y > H - 60) return;
    });
    // ملخّص المباراة: الوضع والخريطة والمدة + الخبرة المكتسبة والإنجازات
    const mapName = (MAPS.find((m) => m.id === opts.map) || {}).nameAr || opts.map || '';
    const mins = Math.floor((results.duration || 0) / 60), secs = Math.floor((results.duration || 0) % 60);
    const summary = `الوضع: ${MODES[opts.mode] ? MODES[opts.mode].nameAr : (opts.mode || '')} | الخريطة: ${mapName} | المدة: ${mins}:${String(secs).padStart(2, '0')}`;
    // مركز النصوص أسفل الجدول: يمين مصغّرة الخريطة حتى لا تتراكب معها (كانت فوقها)
    const boxL = 196, boxR = W - 16;
    const tcx = (boxL + boxR) / 2;
    this.text(ctx, summary, tcx, H - 64, { size: 8.5, color: '#EAF2F6', align: 'center' });
    if (opts.xp && (opts.xp.xp != null)) {
      const lv = opts.xp.level != null ? ` — المستوى ${opts.xp.level}` : '';
      const up = opts.xp.leveled ? '  ⬆ ترقية!' : '';
      this.text(ctx, `خبرة: +${opts.xp.xp}${lv}${up}`, tcx, H - 52, { size: 9, bold: true, color: '#5ED67B', align: 'center' });
    }
    // مصغّرة الخريطة التي لُعبت (صورة حقيقية مولّدة من أصول اللعبة) — تملأ الفراغ ذا معنى
    const thumb = this.uiImage ? this.uiImage(`thumb_${opts.map}.png`) : null;
    if (thumb) {
      const tw = 120, th = 68;
      const tx = 68, ty = H - th - 26;
      ctx.save();
      ctx.fillStyle = 'rgba(3,5,8,0.8)';
      ctx.fillRect(tx - 3, ty - 3, tw + 6, th + 6);
      ctx.strokeStyle = 'rgba(242,193,78,0.5)';
      ctx.lineWidth = 1;
      ctx.strokeRect(tx - 2.5, ty - 2.5, tw + 5, th + 5);
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(thumb, tx, ty, tw, th);
      ctx.restore();
      this.text(ctx, 'خريطة المباراة', tx + tw / 2, ty + th + 12, { size: 7, color: '#9BB8C4', align: 'center' });
    }
    if (opts.achievements && opts.achievements.length) {
      const names = opts.achievements.map((a) => a.nameAr).join(' • ');
      this.text(ctx, `إنجازات جديدة: ${names}`, tcx, H - 42, { size: 8, color: '#F2C14E', align: 'center' });
    }
    // على الهاتف لا لوحة مفاتيح: اللمس في أي مكان يكمل (main يقرأ المؤشر)
    const bw = 170, bx = tcx - bw / 2, by = H - 32;
    ctx.fillStyle = 'rgba(242,193,78,0.16)';
    ctx.fillRect(bx, by, bw, 16);
    ctx.strokeStyle = 'rgba(242,193,78,0.6)';
    ctx.lineWidth = 1;
    ctx.strokeRect(bx + 0.5, by + 0.5, bw - 1, 15);
    this.text(ctx, 'اضغط للمتابعة', W / 2, by + 11, { size: 9, bold: true, color: '#F2C14E', align: 'center' });
  }
}
