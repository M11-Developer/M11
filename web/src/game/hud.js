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
    this.drawWeaponPanel(ctx, view);
    this.drawMinimap(ctx, world, view, opts);
    this.drawTopBar(ctx, world, view);
    this.drawKillFeed(ctx, world);
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
    const x = 10, y = H - 46;
    // الصحة
    const hp = clamp(view.hp / view.maxHp, 0, 1);
    const hpCol = hp > 0.6 ? '#5ED67B' : hp > 0.3 ? '#F2C14E' : '#E8523F';
    this.panel(ctx, x - 2, y - 2, 178, 40, true);
    this.bar(ctx, x + 4, y + 6, 130, 9, hp, hpCol);
    this.num(ctx, `${Math.ceil(view.hp)}`, x + 138, y + 15, { size: 10, bold: true, color: hpCol });
    this.icon(ctx, 'icon_medkit', x + 158, y + 3);
    // الدرع (+ الخوذة)
    if (view.armorLevel > 0) {
      this.bar(ctx, x + 4, y + 18, 90, 5, view.armor / 100, '#7FD2F5');
      this.icon(ctx, 'icon_armor', x + 96, y + 14);
    }
    if (view.helmetLevel > 0) this.icon(ctx, 'icon_helmet', x + 112, y + 14);
    if (view.backpackLevel > 0) this.icon(ctx, 'icon_backpack', x + 128, y + 14);
    // وقود الجيت باك
    const fuel = clamp(view.jetFuel / CONFIG.jetpackFuel, 0, 1);
    this.bar(ctx, x + 4, y + 26, 130, 5, fuel, fuel > 0.25 ? '#F2A03E' : '#E8523F');
    this.icon(ctx, 'icon_jetpack', x + 138, y + 22);
    // عدّاد الجيت باك المشحون
    if (this.time % 1 < 0.5 && fuel > 0.99) this.text(ctx, 'ممتلئ', x + 170, y + 31, { size: 7, color: '#F2A03E' });
    // الأدوية
    let hx = W - 14;
    const healRow = [['bandage', view.heals ? view.heals.bandage : 0, 'icon_medkit'], ['medkit', view.heals ? view.heals.medkit : 0, 'icon_medkit'], ['adrenaline', view.heals ? view.heals.adrenaline : 0, 'icon_star']];
    for (const [k, count, icon] of healRow) {
      if (!count) continue;
      hx -= 22;
      this.panel(ctx, hx, H - 44, 20, 18, true);
      this.icon(ctx, icon, hx + 3, H - 42);
      this.num(ctx, `${count}`, hx + 13, H - 30, { size: 8, bold: true });
    }
    if (view.throwable && view.throwable.count) {
      hx -= 22;
      this.panel(ctx, hx, H - 44, 20, 18, true);
      this.icon(ctx, 'icon_grenade', hx + 3, H - 42);
      this.num(ctx, `${view.throwable.count}`, hx + 13, H - 30, { size: 8, bold: true });
    }
  }

  drawWeaponPanel(ctx, view) {
    if (!view || !view.weaponId) return;
    const w = WEAPONS[view.weaponId];
    if (!w) return;
    const st = view.weaponStats ? view.weaponStats() : resolveStats(view.weaponId, view.weaponAttachments || []);
    const slot = view.weapons[view.slot];
    const x = W - 186, y = H - 92;
    this.panel(ctx, x, y, 176, 42, true);
    // أيقونة الفئة
    const iconName = { pistol: 'icon_pistol', smg: 'icon_smg', ar: 'icon_rifle', sr: 'icon_sniper', shotgun: 'icon_shotgun', lmg: 'icon_lmg', energy: 'icon_rifle', launcher: 'icon_grenade', melee: 'icon_melee' }[w.cls] || 'icon_rifle';
    this.icon(ctx, iconName, x + 152, y + 6);
    // اسم السلاح (عربي) + الإضافات
    this.text(ctx, w.nameAr, x + 146, y + 20, { size: 10, bold: true, color: RARITY_COLOR[w.rarity] || '#EAF2F6', align: 'right' });
    this.text(ctx, WEAPON_CLASS_AR[w.cls] || '', x + 146, y + 32, { size: 7, color: '#9BB8C4' });
    // الذخيرة
    const inMag = slot ? slot.ammo : 0;
    const reserve = view.ammo[w.cls] || 0;
    this.num(ctx, `${inMag}`, x + 14, y + 26, { size: 16, bold: true, color: inMag === 0 ? '#E8523F' : '#EAF2F6' });
    this.num(ctx, `/ ${reserve}`, x + 44, y + 26, { size: 9, color: '#9BB8C4' });
    this.text(ctx, 'الذخيرة', x + 100, y + 33, { size: 7, color: '#9BB8C4' });
    // وضع الإطلاق
    const mode = w.fireMode === 'auto' ? 'آلي' : w.fireMode === 'burst' ? 'رشقة' : 'فردي';
    this.text(ctx, mode, x + 100, y + 41, { size: 7, color: '#F2C14E' });
    // مؤشر تبديل الأسلحة (سلوتان)
    for (let i = 0; i < 2; i++) {
      const wx = x + 156 + i * 12;
      const has = !!view.weapons[i];
      const active = view.slot === i;
      ctx.fillStyle = active ? '#F2C14E' : has ? 'rgba(234,242,246,0.55)' : 'rgba(234,242,246,0.18)';
      ctx.fillRect(wx, y + 36 - 2, 8, 2);
      if (i === 1 && view.weapons[1]) ctx.fillRect(wx, y + 34, 8, 1);
    }
    // شريط الإعادة/التصويب
    if (view.reloading) {
      const p = view.reloadProgress ? view.reloadProgress() : 0;
      this.bar(ctx, x + 4, y + 36, 70, 4, p, '#F2C14E');
      this.text(ctx, 'إعادة تعبئة', x + 76, y + 40, { size: 7, color: '#F2C14E' });
    }
    // مؤشر تبديل السلاح/الاستخدام
    if (view.switchTimer > 0) {
      this.bar(ctx, x + 4, y + 36, 70, 4, 1 - clamp(view.switchTimer / 0.5, 0, 1), '#7FD2F5');
    }
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
    // اسم الخريطة والوضع
    this.text(ctx, world.mode.nameAr, x + size - 2, y + h + 11, { size: 8, bold: true, color: '#F2C14E' });
    this.text(ctx, world.level.def.nameAr, x + size - 2, y + h + 20, { size: 7, color: '#9BB8C4' });
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

  drawTopBar(ctx, world, view) {
    const cx = W / 2;
    const mins = Math.max(0, Math.floor(world.matchTimer / 60));
    const secs = Math.max(0, Math.floor(world.matchTimer % 60));
    const timeStr = `${mins}:${secs.toString().padStart(2, '0')}`;
    this.panel(ctx, cx - 62, 6, 124, 22, true);
    this.num(ctx, timeStr, cx - 52, 21, { size: 13, bold: true, align: 'left' });
    // نقاط الفرق أو ترتيب اللاعب
    if (world.mode.teams > 1) {
      this.text(ctx, `ف١ ${world.teamScores[0] || 0}`, cx + 2, 21, { size: 10, bold: true, color: '#4FD1C5' });
      this.text(ctx, `ف٢ ${world.teamScores[1] || 0}`, cx + 56, 21, { size: 10, bold: true, color: '#E8734A' });
    } else if (world.mode.scoreLimit) {
      const target = world.mode.scoreLimit;
      const best = view ? view.kills : 0;
      this.text(ctx, `${best} / ${target}`, cx + 56, 21, { size: 10, bold: true, color: '#F2C14E' });
    }
    // عدد الأحياء
    const alive = world.getAliveCount();
    this.panel(ctx, cx + 66, 6, 54, 22, true);
    this.icon(ctx, 'icon_skull', cx + 106, 10);
    this.num(ctx, `${alive}`, cx + 72, 21, { size: 11, bold: true });
    // حالة الوضع الخاص
    if (world.modeId === 'snd' && world.snd) {
      this.text(ctx, `الجولة ${world.snd.round}`, cx + 124, 21, { size: 9, bold: true, color: '#F2C14E' });
    } else if (world.modeId === 'kotc' && world.kotc) {
      this.text(ctx, world.kotc.owner >= 0 ? `التل: فريق ${world.kotc.owner + 1}` : 'التل محايد', cx + 124, 21, { size: 9, bold: true, color: '#F2C14E' });
    } else if (world.modeId === 'goldenCard' && world.golden) {
      this.text(ctx, world.golden.holder ? `الكرت: ${world.golden.holder.name}` : 'الكرت حر', cx + 124, 21, { size: 9, bold: true, color: '#F2C14E' });
    } else if (world.modeId === 'infection' && world.infection) {
      const z = world.actors.filter((x) => x.isZombie && x.alive).length;
      this.text(ctx, `مصابون ${z}`, cx + 124, 21, { size: 9, bold: true, color: '#E85D9B' });
    } else if (world.matchState === 'warmup') {
      this.text(ctx, `تبدأ خلال ${Math.ceil(world.warmupTimer)}`, cx + 124, 21, { size: 9, bold: true, color: '#5ED67B' });
    }
  }

  drawKillFeed(ctx, world) {
    let y = 22;
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
    this.text(ctx, 'نتائج المباراة', W / 2, bannerH + 8, { size: 11, bold: true, color: '#F2C14E', align: 'center' });
    const winner = results.standings[0];
    if (winner) {
      this.text(ctx, `الأول: ${winner.name}`, W / 2, bannerH, { size: 10, color: '#EAF2F6', align: 'center' });
    }
    // رؤوس الأعمدة
    const cols = [
      ['#', 74], ['اللاعب', 92], ['قتل', 250], ['موت', 282], ['مساعدة', 312], ['رأس', 348],
      ['دقة', 380], ['ضرر', 414], ['أطول', 460],
    ];
    const headerY = bannerH + 22;
    ctx.save();
    ctx.font = `700 8px ${this.fontStack}`;
    ctx.fillStyle = '#9BB8C4';
    for (const [label, x] of cols) this.text(ctx, label, x + 26, headerY, { size: 8, bold: true, color: '#9BB8C4', align: 'right' });
    ctx.restore();
    let y = headerY + 14;
    results.standings.forEach((s, i) => {
      if (i % 2 === 0) {
        ctx.fillStyle = 'rgba(255,255,255,0.04)';
        ctx.fillRect(66, y - 9, W - 132, 13);
      }
      const col = s.team === 0 ? '#4FD1C5' : s.team === 1 ? '#E8734A' : '#EAF2F6';
      this.num(ctx, `${s.placement}`, 100, y, { size: 9, bold: true, color: i === 0 ? '#F2C14E' : '#9BB8C4', align: 'right' });
      this.text(ctx, s.name, 118 + 26, y, { size: 9, bold: s.isBot === false, color: col });
      this.num(ctx, `${s.kills}`, 276, y, { size: 9 });
      this.num(ctx, `${s.deaths}`, 306, y, { size: 9 });
      this.num(ctx, `${s.assists}`, 338, y, { size: 9 });
      this.num(ctx, `${s.headshots}`, 370, y, { size: 9 });
      this.num(ctx, `${s.accuracy}%`, 404, y, { size: 9 });
      this.num(ctx, `${s.damage}`, 446, y, { size: 9 });
      this.num(ctx, `${s.longestKill}`, 486, y, { size: 9 });
      y += 13;
      if (y > H - 60) return;
    });
    // ملخّص المباراة: الوضع والخريطة والمدة + الخبرة المكتسبة والإنجازات
    const mapName = (MAPS.find((m) => m.id === opts.map) || {}).nameAr || opts.map || '';
    const mins = Math.floor((results.duration || 0) / 60), secs = Math.floor((results.duration || 0) % 60);
    const summary = `الوضع: ${MODES[opts.mode] ? MODES[opts.mode].nameAr : (opts.mode || '')} | الخريطة: ${mapName} | المدة: ${mins}:${String(secs).padStart(2, '0')}`;
    this.text(ctx, summary, W / 2, H - 52, { size: 9, color: '#EAF2F6', align: 'center' });
    if (opts.xp && (opts.xp.xp != null)) {
      const lv = opts.xp.level != null ? ` — المستوى ${opts.xp.level}` : '';
      const up = opts.xp.leveled ? '  ⬆ ترقية!' : '';
      this.text(ctx, `خبرة: +${opts.xp.xp}${lv}${up}`, W / 2, H - 42, { size: 9, bold: true, color: '#5ED67B', align: 'center' });
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
      this.text(ctx, `إنجازات جديدة: ${names}`, W / 2, H - 32, { size: 8, color: '#F2C14E', align: 'center' });
    }
    this.text(ctx, 'اضغط Enter للمتابعة', W / 2, H - 18, { size: 9, color: '#9BB8C4', align: 'center' });
  }
}
