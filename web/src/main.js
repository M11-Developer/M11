// ============================================================================
// نقطة الدخول — يربط كل شيء: تحميل الأصول، القوائم، اللعب، البوتات، الصوت،
// الحفظ المحلي، وأدوات التشخيص. نسخة الويب تعمل بلا إنترنت تمامًا.
// ============================================================================

import { Assets, CONFIG, WEAPON_CLASS_AR } from './core/assets.js';
import { clamp, lerp, damp, RNG, formatTime, TAU } from './core/math.js';
import { Input, DEFAULT_CONTROLS, screenToWorld } from './core/input.js';
import { audio, DEFAULT_AUDIO } from './core/audio.js';
import { Storage, Progression, RANKS } from './core/storage.js';
import { GameWorld } from './game/game.js';
import { MODES, MODE_LIST } from './game/modes.js';
import { MAPS, MAP_BY_ID } from './game/world.js';
import { WEAPONS, resolveStats } from './game/weapons.js';
import { Actor, Bot, DIFFICULTY, BOT_NAMES } from './game/entities.js';
import { HUD, PING_TYPES } from './game/hud.js';
import { MenuSystem } from './game/ui.js';
import { Renderer, loadBackdrops } from './render/renderer.js';
import { Camera, KillCam } from './render/camera.js';
import { NetSession, NetTransportLocal } from './core/net.js';

const DEFAULT_SETTINGS = {
  quality: 2, fpsLimit: 0, integerScaling: true, shakeScale: 1, postFx: true,
  lighting: true, grain: 0.09, powerSaving: false, language: 'ar',
  adsMode: 'hold', autoFire: false, colorblind: 'none', aimAssist: 0.35,
  botCount: 7, difficulty: 2, friendlyFire: false, netOverlay: false,
  map: 'oasis', opKey: 'rashid', skinIndex: 0, loadout: ['jabha', 'n9'],
  throwable: 'grenade', port: 41980, webNet: 'bots', maxResend: 3,
  lastIp: '', bigMinimap: false, showTouchControls: 'auto', crosshairColor: '#7CFFB2',
  playerName: 'مقاتل', volumeIntro: true,
};

class Game {
  constructor() {
    this.canvas = document.getElementById('game');
    this.state = 'loading';       // loading | menu | playing | paused | results
    this.settings = { ...DEFAULT_SETTINGS };
    this.controls = { ...DEFAULT_CONTROLS };
    this.audioSettings = { ...DEFAULT_AUDIO };
    this.rng = new RNG(Date.now() & 0xffffffff);
    this.world = null;
    this.camera = new Camera();
    this.fpsSamples = [];
    this.lastTime = 0;
    this.accum = 0;
    this.fixedDt = 1 / 60;
    this.net = null;
    this.killcam = null;
    this.replayRecording = null;
    this.spectateIndex = 0;
  }

  // ------------------------------------------------------------- التهيئة
  async boot() {
    const bar = document.getElementById('progress-bar');
    const label = document.getElementById('progress-label');
    const setProgress = (p, text) => {
      if (bar) bar.style.width = Math.round(p * 100) + '%';
      if (label && text) label.textContent = text;
    };
    setProgress(0.02, 'تجهيز…');
    this.profile = Storage.loadProfile();
    this.progression = new Progression(this.profile);
    this.progression.rollChallenges();
    const savedSettings = Storage.loadSettings();
    if (savedSettings) Object.assign(this.settings, savedSettings);
    const savedControls = Storage.loadControls();
    if (savedControls) Object.assign(this.controls, savedControls);
    const savedLoadout = Storage.loadLoadout();
    if (savedLoadout) Object.assign(this.settings, savedLoadout);

    // تحميل الأصول
    const names = ['world', 'vfx', 'ui', 'weapons', 'arms'];
    let meta = null;
    try {
      meta = await Assets.loadJson('characters_meta.json');
      for (const op of Object.keys(meta.operators || {})) names.push('char_' + op);
    } catch (e) {
      console.warn('لم يُحمّل characters_meta.json', e);
    }
    // أطالس البلاطات المولّدة بالذكاء الاصطناعي: تُحمّل إن وُجدت فقط (اختيارية)
    let tileThemes = [];
    try {
      const man = await Assets.loadJson('tiles_manifest.json');
      tileThemes = (man || []).map((t) => 'tiles_' + t.theme);
      for (const t of tileThemes) names.push(t);
    } catch (e) { /* لا يوجد ملف — نكمل بالأطالس البرمجية */ }
    Assets.onProgress = (n, total, name) => setProgress(0.05 + (n / total) * 0.7, `تحميل الرسوم (${n}/${total})…`);
    await Assets.load(names);

    // لوحتا المنظر المولّدتان (اختياريتان — لو غابت الصورة تعمل اللعبة بالطبقات البرمجية فقط)
    await loadBackdrops(Assets, (name) => console.warn('لوحة المنظر غير متوفرة:', name));
    this.charMeta = meta;
    setProgress(0.8, 'تحميل الصوت…');
    // الصوت يحتاج تفاعل المستخدم — نجهّزه عند أول نقرة
    setProgress(0.95, 'الاستعداد…');

    this.input = new Input(this.canvas, this.controls);
    this.renderer = new Renderer(this.canvas, Assets);
    this.hud = new HUD(Assets);
    this.menus = new MenuSystem(Assets, this);
    this.applyQuality();
    this.applyColorblind();
    this.resize();
    addEventListener('resize', () => this.resize());
    document.addEventListener('visibilitychange', () => {
      if (document.hidden && this.state === 'playing') this.pause();
    });
    // صوت: أول تفاعل يفتح السياق
    const unlock = async () => {
      await audio.init();
      audio.applySettings(this.audioSettings);
      audio.preloadCore && audio.preloadCore();
      audio.setMusic && audio.setMusic('menu_theme');
      removeEventListener('pointerdown', unlock);
      removeEventListener('keydown', unlock);
    };
    addEventListener('pointerdown', unlock);
    addEventListener('keydown', unlock);

    // إنشاء عالم معاينة في الخلفية للقائمة (جو حربي متحرك)
    this.menuWorld = new GameWorld({ mode: 'dm', mapDef: MAP_BY_ID[this.settings.map], seed: 777, warmup: 999, difficulty: 1 });
    for (let i = 0; i < 5; i++) {
      this.menuWorld.addActor({ isBot: true, team: 0, name: BOT_NAMES[i], difficulty: 2, seed: 900 + i, opKey: Object.keys(this.charMeta.operators)[i % 10] });
    }
    this.camera.setBounds(this.menuWorld.level);
    setProgress(1, 'جاهز');
    setTimeout(() => {
      document.getElementById('loading')?.classList.add('hidden');
      this.state = 'menu';
      this.lastTime = performance.now();
      requestAnimationFrame((t) => this.loop(t));
    }, 220);
  }

  applyQuality() {
    const q = this.settings.powerSaving ? 0 : this.settings.quality;
    if (this.renderer) {
      this.renderer.quality = q;
      this.renderer.postfx.applyQuality(q);
      this.renderer.enableLighting = this.settings.lighting && !this.settings.powerSaving;
      this.renderer.enablePost = this.settings.postFx && !this.settings.powerSaving;
      this.renderer.postfx.grain = this.settings.grain;
      this.renderer.lighting.normalStrength = q >= 2 ? 0.35 : 0.2;
      this.hud && (this.hud.settings = this.settings);
    }
  }

  applyColorblind() {
    const map = {
      none: null,
      deuter: ['#4FD1C5', '#F2C14E'],
      prot: ['#7FD2F5', '#F2C14E'],
      trit: ['#4FD1C5', '#E85D9B'],
    };
    this.teamColorOverride = map[this.settings.colorblind] || null;
  }

  applyAudio() {
    audio.applySettings(this.audioSettings);
  }

  resize() {
    const info = this.renderer.resize(innerWidth, innerHeight, this.settings.integerScaling);
    this.cssInfo = info;
    // تكبير الأزرار اللمسية تبعًا لحجم الشاشة
    this.rebuildTouchButtons();
  }

  rebuildTouchButtons() {
    if (!this.input) return;
    this.input.buttons.clear();
    const S = this.controls;
    const R = 21;
    const add = (name, x, y, r = R) => this.input.buttons.set(name, { x, y, r });
    const left = S.leftHanded;
    const mx = left ? 92 : CONFIG.internalWidth - 92;
    const jx = left ? CONFIG.internalWidth - 76 : 76;
    // زر الإطلاق (أيمن/أيسر حسب اليد)
    add('fire', mx, CONFIG.internalHeight - 62, R + 4);
    add('jump', mx - 46, CONFIG.internalHeight - 40, R - 2);
    add('jetpack', mx + 6, CONFIG.internalHeight - 108, R - 4);
    add('reload', mx - 52, CONFIG.internalHeight - 92, R - 5);
    add('crouch', mx + 44, CONFIG.internalHeight - 46, R - 6);
    add('prone', mx + 76, CONFIG.internalHeight - 70, R - 6);
    add('melee', mx + 58, CONFIG.internalHeight - 108, R - 6);
    add('heal', mx + 76, CONFIG.internalHeight - 20, R - 7);
    add('grenade', mx - 76, CONFIG.internalHeight - 20, R - 7);
    add('swap', mx - 90, CONFIG.internalHeight - 62, R - 8);
    // تخطيط Claw: أزرار إضافية بأعلى الشاشة
    if (S.clawLayout >= 3) {
      add('fire2', mx - 10, 46, R - 3);
      add('jump2', mx - 62, 40, R - 5);
    }
    if (S.clawLayout >= 4) {
      add('fire3', mx + 44, 62, R - 5);
      add('melee2', mx - 108, 46, R - 6);
    }
  }

  // ------------------------------------------------------------- الحفظ
  saveProfile() { Storage.saveProfile(this.profile); }
  saveSettings() { Storage.saveSettings(this.settings); }
  saveControls() { Storage.saveControls(this.controls); }
  resetSettings() {
    this.settings = { ...DEFAULT_SETTINGS };
    this.saveSettings();
    this.applyQuality();
  }
  wipeData() {
    try {
      localStorage.clear();
    } catch (e) { /* تجاهل */ }
    this.profile = Storage.loadProfile();
    this.progression = new Progression(this.profile);
    this.settings = { ...DEFAULT_SETTINGS };
    this.controls = { ...DEFAULT_CONTROLS };
    this.audioSettings = { ...DEFAULT_AUDIO };
    this.applyQuality();
  }

  primaryOptions() {
    return Object.keys(WEAPONS).filter((id) => ['ar', 'smg', 'sr', 'shotgun', 'lmg'].includes(WEAPONS[id].cls))
      .map((id) => ({ id, label: WEAPONS[id].nameAr }));
  }
  secondaryOptions() {
    return Object.keys(WEAPONS).filter((id) => ['pistol', 'melee'].includes(WEAPONS[id].cls))
      .map((id) => ({ id, label: WEAPONS[id].nameAr }));
  }

  // ------------------------------------------------------------- المباريات
  startMatch(opts = {}) {
    const modeId = opts.mode || this.settings.mode || 'dm';
    const mode = MODES[modeId];
    const seed = opts.seed != null ? opts.seed : (Math.random() * 1e9) | 0;
    this.world = new GameWorld({
      mode: modeId,
      mapDef: MAP_BY_ID[opts.map || this.settings.map],
      seed,
      warmup: opts.warmup != null ? opts.warmup : 3,
      difficulty: this.settings.difficulty,
      friendlyFire: opts.friendlyFire != null ? opts.friendlyFire : this.settings.friendlyFire,
      weather: opts.weather || (MAP_BY_ID[opts.map || this.settings.map] || {}).weather,
      replay: this.settings.recordReplays !== false,
      hooks: {
        onKill: (a, v, o) => this.onKill(a, v, o),
        onMatchEnd: (r) => this.onMatchEnd(r),
      },
    });
    this.world.hud = this.hud;
    this.renderer.setLevel(this.world.level, this.charMeta);
    this.camera.setBounds(this.world.level);
    this.hud.hitMarker = 0;
    this.hud.killcam = null;
    this.killcam = null;
    this.hud.net.mode = this.net ? 'شبكة محلية' : 'بوتات';
    // اللاعب
    const teamSize = mode.teams > 1 ? Math.max(1, Math.floor((this.settings.botCount + 1) / 2)) : 0;
    this.player = this.world.addActor({
      team: 0, name: this.profile.name, opKey: this.settings.opKey,
      startWeapons: mode.loadout === 'none' ? null : this.settings.loadout,
      throwable: this.settings.throwable,
      isPlayer: true,
    });
    if (this.player) {
      this.player.worldHud = this.hud;
      this.player.opKey = this.settings.opKey;
    }
    // البوتات
    let botCount = clamp(this.settings.botCount, 0, 11);
    if (mode.cooperative) botCount = 3;
    for (let i = 0; i < botCount; i++) {
      const team = mode.teams > 1 ? (mode.teamMode === 'solo' ? 0 : (i % 2 === 0 ? 0 : 1)) : 0;
      const b = this.world.addActor({
        isBot: true, team, name: BOT_NAMES[i % BOT_NAMES.length],
        difficulty: this.settings.difficulty, seed: (seed + i * 913) | 0,
        opKey: Object.keys(this.charMeta.operators)[(i + 3) % 10],
        startWeapons: mode.loadout === 'none' ? null : null,
      });
      b.serverBots = true;
    }
    if (mode.vip) this.world.attackTeam = 0;
    this.hud.toast(`الوضع: ${mode.nameAr} — ${this.world.level.def.nameAr}`, '#F2C14E', 3.4);
    this.hud.toast(`عدد المقاتلين: ${this.world.actors.length}`, '#9BB8C4', 3.0);
    audio.setMusic && audio.setMusic(modeId === 'br' ? 'br_calm' : 'dm_fast');
    this.state = 'playing';
    this.menus.home();
    return this.world;
  }

  restartMatch() {
    if (this.world) this.startMatch({ mode: this.world.modeId, seed: (Math.random() * 1e9) | 0 });
  }

  toMenu() {
    this.state = 'menu';
    audio.setMusic && audio.setMusic('menu_theme');
  }

  pause() {
    if (this.state !== 'playing') return;
    this.state = 'paused';
    this.menus.push('pause');
  }

  resume() {
    this.state = 'playing';
    this.menus.stack.length = 1;
  }

  onKill(attacker, victim, opts) {
    if (attacker === this.player && attacker !== victim) {
      this.hud.showHit(true, !!opts.headshot);
      audio.ui && audio.ui(opts.headshot ? 'headshot' : 'kill');
      const mode = this.world.mode;
      if (mode.randomWeaponPerKill && attacker.isPlayer !== false) { /* يُدار داخل الوضع */ }
    }
    if (victim === this.player) {
      // إعادة مشهد القتل (Killcam)
      const killer = attacker && attacker !== victim ? attacker : null;
      const w = opts.weaponId && WEAPONS[opts.weaponId] ? WEAPONS[opts.weaponId].nameAr : 'بيئة';
      this.hud.killcam = {
        killerId: killer ? killer.id : null,
        dist: killer ? Math.hypot(killer.cx - victim.cx, killer.cy - victim.cy) : 0,
        weaponName: w,
      };
      if (killer) {
        this.killcam = new KillCam(killer, victim);
        this.spectateIndex = 0;
        victim.spectate = killer.id;
      }
      audio.ui && audio.ui('error');
      this.hud.toast(`قتلك ${killer ? killer.name : 'شيء ما'}`, '#E8523F', 2.6);
    }
  }

  onMatchEnd(results) {
    this.state = 'results';
    this.results = results;
    audio.setMusic && audio.setMusic(results.standings[0] && results.standings[0].isBot === false ? 'victory' : 'defeat');
    if (this.progression) {
      const me = results.standings.find((s) => s.name === this.profile.name);
      this.progression.recordMatch({
        kills: me ? me.kills : 0, deaths: me ? me.deaths : 0, assists: me ? me.assists : 0,
        headshots: me ? me.headshots : 0, damage: me ? me.damage : 0,
        placement: me ? me.placement : results.standings.length,
        accuracy: me ? me.accuracy : 0, revives: me ? me.revives : 0,
        longestKill: me ? me.longestKill : 0, won: results.standings[0] && results.standings[0].name === this.profile.name,
      });
      const gained = this.progression.checkAchievements({
        kills: me ? me.kills : 0, headshots: me ? me.headshots : 0,
        placement: me ? me.placement : 0, accuracy: me ? me.accuracy : 0,
        longestKill: me ? me.longestKill : 0, revives: me ? me.revives : 0,
        damage: me ? me.damage : 0,
      });
      for (const a of gained) this.hud.toast('إنجاز: ' + a.nameAr, '#F2C14E', 4);
      Storage.saveProfile(this.profile);
    }
    if (this.world && this.world.replay && this.world.replay.length) {
      const replays = Storage.loadReplays();
      replays.push({
        mode: this.world.modeId, map: this.world.level.def.id, time: Date.now(),
        duration: Math.round(results.duration), standings: results.standings.slice(0, 3),
        frames: this.world.replay.slice(-900),
      });
      Storage.saveReplays(replays);
    }
  }

  // ------------------------------------------------------------- الشبكة المحلية (واجهة)
  async hostLan() {
    this.net = new NetSession({ mode: 'host', port: this.settings.port, game: this });
    const ok = await this.net.startHost();
    this.hud.toast(ok ? `استضافة على المنفذ ${this.settings.port} — بانتظار اللاعبين` : 'تعذّر إنشاء الغرفة في هذه النسخة', ok ? 'ok' : 'error');
    if (ok) this.startMatch({ mode: this.settings.mode || 'tdm', warmup: 20 });
  }

  async joinLanAuto() {
    this.net = new NetSession({ mode: 'client', port: this.settings.port, game: this });
    const hosts = await this.net.discover(3000);
    if (!hosts.length) this.hud.toast('لم يُعثر على مضيف — تأكد من نقطة الاتصال أو أدخل IP يدويًا', 'error');
    else { await this.net.join(hosts[0]); this.state = 'playing'; }
  }

  async joinLanManual(addr) {
    this.net = new NetSession({ mode: 'client', port: this.settings.port, game: this });
    const ok = await this.net.joinAddress(addr);
    this.hud.toast(ok ? 'تم الاتصال بالمضيف' : 'فشل الاتصال — تحقق من العنوان', ok ? 'ok' : 'error');
    if (ok) this.state = 'playing';
  }

  // ------------------------------------------------------------- المحرر
  openEditor() {
    this.state = 'editor';
    this.editor = this.editor || new MapEditor(this);
    this.editor.open(this.world ? this.world.level.def : MAPS[0]);
  }

  // ------------------------------------------------------------- الحلقة
  loop(now) {
    requestAnimationFrame((t) => this.loop(t));
    const raw = Math.min(0.1, (now - this.lastTime) / 1000 || 0.016);
    this.lastTime = now;
    this.fpsSamples.push(raw);
    if (this.fpsSamples.length > 30) this.fpsSamples.shift();
    const avg = this.fpsSamples.reduce((a, b) => a + b, 0) / this.fpsSamples.length;
    this.hud.fps = 1 / Math.max(0.0001, avg);

    // حد الإطارات
    if (this.settings.fpsLimit) {
      const minDelta = 1 / this.settings.fpsLimit - 0.001;
      if (raw < minDelta) return;
    }
    const dt = clamp(raw, 0.001, 0.05);
    if (this.state === 'menu') this.updateMenu(dt);
    else if (this.state === 'playing') this.updatePlaying(dt);
    else if (this.state === 'paused') this.updatePaused(dt);
    else if (this.state === 'results') this.updateResults(dt);
    else if (this.state === 'editor') this.updateEditor(dt);
    this.input.endFrame();
  }

  updateMenu(dt) {
    // خلفية حية: عالم معاينة يعمل بالبوتات
    this.menuWorld.update(dt);
    const cam = this.camera;
    const t = performance.now() / 1000;
    cam.free = true;
    cam.x = (this.menuWorld.level.width / 2) + Math.sin(t * 0.06) * 240;
    cam.y = 220 + Math.cos(t * 0.09) * 40;
    cam.targetZoom = 1;
    cam.update(dt, null);
    this.renderer.settings = this.settings;
    this.renderer.draw(this.menuWorld, cam, null, dt);
    const ctx = this.renderer.main;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = 1;
    this.menus.update(dt, this.input);
    this.menus.draw(ctx, this.settings);
    // معالجة مفاتيح القوائم
    this.handleMenuInput();
    // تصميم إضافي: شعار
    this.drawLogo(ctx);
  }

  drawLogo(ctx) {
    if (this.menus.current.name !== 'main') return;
    ctx.save();
    ctx.textAlign = 'right';
    ctx.direction = 'rtl';
    ctx.font = `700 22px ${this.menus.fontStack}`;
    ctx.fillStyle = 'rgba(0,0,0,0.7)';
    ctx.fillText('ميكا ١١', W_() - 23, 61);
    ctx.fillStyle = '#F2C14E';
    ctx.fillText('ميكا ١١', W_() - 24, 60);
    ctx.font = `700 8px ${this.menus.fontStack}`;
    ctx.fillStyle = '#9BB8C4';
    ctx.fillText('M11 — ساحة النار المحلية', W_() - 24, 72);
    ctx.restore();
    function W_() { return CONFIG.internalWidth; }
  }

  updatePlaying(dt) {
    const world = this.world;
    if (!world) return;
    // وقت بطيء أثناء إعادة مشهد القتل
    let simDt = dt;
    if (this.killcam) {
      const alive = this.killcam.update(dt, this.camera);
      simDt = dt * this.killcam.slowmo;
      if (!alive) { this.killcam = null; this.hud.killcam = null; }
    }
    const cmd = this.buildCommand();
    if (this.player && this.player.alive) {
      this.player.update(simDt, world, cmd);
      if (this.net && this.net.mode === 'client') this.net.sendInput(cmd);
    } else if (this.player && world.mode.respawn !== false) {
      // مشاهدة أثناء الانتظار
      this.updateSpectate(dt);
    }
    world.update(simDt);
    // إعادة الإحياء بعد الموت (فريق متعدد)
    if (this.player && !this.player.alive && world.mode.respawn === false && !this.killcam) {
      this.updateSpectate(dt);
    }
    if (this.net) this.net.update(dt);
    this.handleAudioEvents(world);
    // كاميرا
    if (!this.killcam) {
      const target = this.player;
      if (target) this.camera.update(dt, target, { aimLead: this.player.ads ? 56 : 46 });
    } else {
      this.camera.update(dt, null);
    }
    this.renderer.weather = world.weather || (world.level.def.weather === 'rain' ? 'rain' : 'clear');
    this.renderer.draw(world, this.camera, this.player, dt);
    const ctx = this.renderer.main;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    this.hud.netOverlay = this.settings.netOverlay;
    this.hud.settings = this.settings;
    this.hud.spectate = this.player && !this.player.alive ? this.player.spectate : null;
    this.hud.update(dt);
    this.hud.draw(ctx, world, this.player, {
      renderer: this.renderer, cam: this.camera, inputMode: this.input._usedTouch ? 'touch' : 'desktop',
      settings: this.settings, showTouchControls: this.showTouch,
    });
    if (this.showTouch) this.drawTouchControls(ctx);
    // معالجة المفاتيح
    this.handleGameKeys();
    // إعادة المشهد بعد انتهاء المباراة
    if (this.state === 'playing' && world.matchState === 'ended' && world.results) {
      this.state = 'results';
      this.results = world.results;
    }
  }

  updateSpectate(dt) {
    const world = this.world;
    const alive = world.actors.filter((a) => a.alive && a.team === (this.player ? this.player.team : 0));
    if (alive.length) {
      this.spectateIndex = clamp(this.spectateIndex, 0, alive.length - 1);
      const t = alive[this.spectateIndex];
      this.player.spectate = t.id;
      this.camera.free = false;
      this.camera.followTarget = t;
    }
    // نُحرّك الكاميرا نحو اللاعب المراقَب
    const t = world.actors.find((a) => a.id === this.player.spectate);
    if (t) {
      this.camera.x = damp(this.camera.x, t.cx, 3, dt);
      this.camera.y = damp(this.camera.y, t.cy, 3, dt);
      this.camera.clampToBounds();
    }
  }

  handleAudioEvents(world) {
    const evs = world.events;
    if (!evs.length) return;
    for (const e of evs) {
      switch (e.type) {
        case 'shot': audio.weapon && audio.weapon(e.weaponId, e.shooter ? dist2d(e.shooter, this.player) : 0, e.x, e.y); break;
        case 'explosion': audio.explosion && audio.explosion(e.big ? 'big' : 'explosion', e.x, e.y); break;
        case 'impact': audio.impact && audio.impact(e.material, e.x, e.y); break;
        case 'footstep_vfx': if (Math.random() < 0.6) audio.footstep && audio.footstep(e.water ? 'water_0' : 'dirt_0', e.x, e.y); break;
        case 'hit':
          if (e.target === this.player) {
            this.hud.damageFrom(angleFrom(this.player, e.attacker), e.damage);
            this.renderer.postfx.hit(0.35 + clamp(e.damage / 60, 0, 0.5));
            if (this.settings.shakeScale > 0) this.camera.addTrauma(0.16 * this.settings.shakeScale);
            this.input.vibrate && this.input.vibrate(18);
          } else if (e.attacker === this.player) {
            this.hud.showHit(!!e.killed, !!e.headshot);
            this.renderer.particles.hitMarker(0, 0, e.killed, e.headshot);
            audio.ui && audio.ui('hitmarker');
          }
          break;
        case 'pickup': if (e.actor === this.player) { this.hud.toast('حصلت على: ' + e.label, '#5ED67B'); audio.ui && audio.ui('pickup'); } break;
        case 'kill': if (e.attacker === this.player && this.settings.shakeScale > 0) this.camera.addTrauma(0.1); break;
        case 'revive': this.hud.toast(`${e.rescuer.name} أنعش ${e.actor.name}`, '#8CE99A'); break;
        case 'bombPlanted': this.hud.toast('زُرعت القنبلة!', '#E8523F', 3); break;
        case 'wave': this.hud.toast(`الموجة ${e.wave} — ${e.count} أعداء`, '#E8734A'); break;
        case 'airdropIncoming': this.hud.toast('إسقاط جوي قادم!', '#F2C14E', 3); break;
        default: break;
      }
    }
    evs.length = 0;
  }

  /** يبني أمر التحكم للاعب من المدخلات (كيبورد/لمس/يد) */
  buildCommand() {
    const cmd = this.input.update(this.fixedDt);
    const cam = this.camera;
    // التصويب بالفأرة (سطح المكتب)
    if (cmd.pointer && this.player) {
      const world = screenToWorld(cam, cmd.pointer.x, cmd.pointer.y);
      const dx = world.x - this.player.cx;
      const dy = world.y - this.player.cy;
      const mag = Math.hypot(dx, dy) || 1;
      cmd.aimX = dx / mag;
      cmd.aimY = dy / mag;
      cmd.aimMag = 1;
      cmd.aimActive = true;
      cmd.fire = cmd.pointer.down;
      cmd.ads = cmd.pointer.rightDown;
    } else if (cmd.aimMag > 0.25) {
      cmd.ads = this.settings.adsMode === 'toggle' ? this.input.adsToggled : (this.controls.holdToAim ? true : this.input.aimAds || false);
    }
    if (this.settings.autoFire && cmd.aimActive && cmd.aimMag > 0.9) cmd.fire = cmd.fire || true;
    // مساعد التصويب: نُقرّب الاتجاه قليلًا نحو أقرب عدو مرئي
    if (this.player && this.settings.aimAssist > 0 && (cmd.fire || cmd.aimActive)) {
      const world = this.world;
      const enemy = world.findVisibleEnemy(this.player, 620);
      if (enemy) {
        const want = Math.atan2(enemy.cy - this.player.cy, enemy.cx - this.player.cx);
        const cur = Math.atan2(cmd.aimY, cmd.aimX);
        const k = clamp(this.settings.aimAssist * 0.35, 0, 0.35);
        const diff = Math.atan2(Math.sin(want - cur), Math.cos(want - cur));
        const ang = cur + diff * k;
        cmd.aimX = Math.cos(ang);
        cmd.aimY = Math.sin(ang);
      }
    }
    return cmd;
  }

  handleMenuInput() {
    const pressed = [...this.input.pressed];
    for (const code of pressed) {
      if (this.menus.key(code)) break;
    }
  }

  handleGameKeys() {
    const p = this.input.pressed;
    if (p.has('Escape')) { this.pause(); return; }
    if (p.has('KeyM')) { this.hud.showBigMap = !this.hud.showBigMap; }
    if (p.has('KeyN')) { this.settings.netOverlay = !this.settings.netOverlay; this.saveSettings(); }
    if (p.has('KeyH')) { this.showTouch = !this.showTouch; }
    if (p.has('KeyV')) { this.hud.pingWheel.open = true; }
    if (this.hud.pingWheel.open) {
      if (p.has('Enter') || p.has('Space')) {
        this.hud.pingWheel.open = false;
        this.placePing(PING_TYPES[this.hud.pingWheel.index].id);
      }
      if (p.has('ArrowLeft') || p.has('KeyA')) this.hud.pingWheel.index = (this.hud.pingWheel.index + 1) % PING_TYPES.length;
      if (p.has('ArrowRight') || p.has('KeyD')) this.hud.pingWheel.index = (this.hud.pingWheel.index + PING_TYPES.length - 1) % PING_TYPES.length;
      if (p.has('Escape')) this.hud.pingWheel.open = false;
    }
    // المشاهدة: تبديل اللاعبين
    if (this.player && !this.player.alive) {
      if (p.has('ArrowRight')) this.spectateIndex++;
      if (p.has('ArrowLeft')) this.spectateIndex = Math.max(0, this.spectateIndex - 1);
    }
    if (p.has('F1')) { this.settings.netOverlay = !this.settings.netOverlay; this.saveSettings(); }
    if (p.has('F2')) { this.settings.postFx = !this.settings.postFx; this.saveSettings(); this.applyQuality(); }
    if (p.has('F3')) { this.settings.lighting = !this.settings.lighting; this.saveSettings(); this.applyQuality(); }
    if (p.has('F4')) { this.settings.quality = (this.settings.quality + 1) % 4; this.saveSettings(); this.applyQuality(); this.hud.toast('جودة الرسم: ' + ['منخفضة', 'متوسطة', 'عالية', 'قصوى'][this.settings.quality], '#F2C14E'); }
  }

  placePing(kind) {
    const world = this.world;
    if (!world || !this.player) return;
    const cam = this.camera;
    const p = { x: this.player.cx + Math.cos(this.player.aimAngle) * 120, y: this.player.cy + Math.sin(this.player.aimAngle) * 120, kind, t: 3 };
    this.hud.pings.push(p);
    this.hud.toast(`أرسلت: ${(PING_TYPES.find((q) => q.id === kind) || {}).label}`, '#7FD2F5', 1.6);
    this.net && this.net.sendPing && this.net.sendPing(p);
  }

  drawTouchControls(ctx) {
    const S = this.controls;
    const inp = this.input;
    ctx.save();
    ctx.globalAlpha = S.buttonAlpha;
    // عصا الحركة
    this.drawStick(ctx, inp.move, S.stickAlpha);
    // عصا التصويب
    this.drawStick(ctx, inp.aim, S.stickAlpha * 0.9);
    // أزرار
    for (const [name, b] of inp.buttons) {
      const active = !!inp.actions[name];
      const label = {
        fire: 'إطلاق', jump: 'قفز', jetpack: 'جيت', reload: 'تعبئة', crouch: 'انخفاض',
        prone: 'انبطاح', melee: 'مشاجرة', heal: 'علاج', grenade: 'قنبلة', swap: 'سلاح',
        fire2: 'إطلاق', jump2: 'قفز', fire3: 'إطلاق', melee2: 'مشاجرة',
      }[name] || name;
      const r = b.r;
      const x = S.leftHanded ? CONFIG.internalWidth - b.x : b.x;
      ctx.beginPath();
      ctx.arc(x, b.y, r, 0, TAU);
      ctx.fillStyle = active ? 'rgba(242,193,78,0.42)' : 'rgba(16,20,26,0.55)';
      ctx.fill();
      ctx.strokeStyle = active ? '#F2C14E' : 'rgba(234,242,246,0.4)';
      ctx.lineWidth = 1.5;
      ctx.stroke();
      ctx.save();
      ctx.globalAlpha = 1;
      this.hud.text(ctx, label, x + 0, b.y + 3, { size: 8, bold: true, color: active ? '#F2C14E' : '#EAF2F6', align: 'center' });
      ctx.restore();
    }
    ctx.restore();
  }

  drawStick(ctx, s, alpha) {
    if (!s.active) return;
    const r = this.controls.stickSize / 2;
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.beginPath();
    ctx.arc(s.ox, s.oy, r, 0, TAU);
    ctx.fillStyle = 'rgba(16,20,26,0.35)';
    ctx.fill();
    ctx.strokeStyle = 'rgba(234,242,246,0.35)';
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(s.cx, s.cy, r * 0.46, 0, TAU);
    ctx.fillStyle = 'rgba(242,193,78,0.55)';
    ctx.fill();
    ctx.strokeStyle = '#0B0D10';
    ctx.stroke();
    ctx.restore();
  }

  updatePaused(dt) {
    this.renderer.draw(this.world, this.camera, this.player, 0);
    const ctx = this.renderer.main;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = 'rgba(5,7,10,0.6)';
    ctx.fillRect(0, 0, CONFIG.internalWidth, CONFIG.internalHeight);
    this.menus.update(dt, this.input);
    this.menus.draw(ctx, this.settings);
    this.handleMenuInput();
    if (this.state === 'playing') this.menus.stack.length = 1;
  }

  updateResults(dt) {
    const ctx = this.renderer.main;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    if (this.world) this.renderer.draw(this.world, this.camera, this.player, dt * 0.2);
    this.hud.drawResults(ctx, this.results || (this.world && this.world.results) || { standings: [] });
    this.hud.update(dt);
    if (this.input.pressed.has('Enter') || this.input.pressed.has('Space') || this.input.pressed.has('Escape')) {
      this.state = 'menu';
      this.menus.home();
    }
  }

  updateEditor(dt) {
    const ctx = this.renderer.main;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = '#0B0D10';
    ctx.fillRect(0, 0, CONFIG.internalWidth, CONFIG.internalHeight);
    this.editor.update(dt, this.input, ctx);
    if (this.editor.closed) this.toMenu();
  }
}

function dist2d(a, b) {
  if (!b) return 0;
  return Math.hypot(a.cx - b.cx, a.cy - b.cy);
}

function angleFrom(target, source) {
  if (!source) return 0;
  return Math.atan2(source.cy - target.cy, source.cx - target.cx);
}

// ---------------------------------------------------------------------------
// محرّر الخرائط — يبني خريطة بالكود ويصدّرها JSON مضغوطًا (القسم 9)
// ---------------------------------------------------------------------------
export class MapEditor {
  constructor(game) {
    this.game = game;
    this.closed = true;
    this.tool = 'solid';
    this.tools = ['solid', 'top', 'platform', 'crate', 'glass', 'sandbag', 'ladder', 'water', 'hazard', 'erase', 'spawn', 'loot'];
    this.toolIndex = 0;
    this.cam = { x: 0, y: 0 };
    this.name = 'خريطتي';
    this.brush = 2;
  }

  open(def) {
    this.closed = false;
    this.def = { ...def, id: 'custom_' + Date.now().toString(36), nameAr: this.name, w: def.w || 2400, h: def.h || 800 };
    const { generateMap } = window.__M11W || {};
    this.map = null;
    this.level = null;
    this.status = 'اختر أداة ثم ارسم — الأسهم للتنقل، [ ] للفرشاة، S للحفظ، Q للخروج';
  }

  update(dt, input, ctx) {
    const W = CONFIG.internalWidth, H = CONFIG.internalHeight;
    ctx.save();
    ctx.textAlign = 'right';
    ctx.direction = 'rtl';
    ctx.font = `700 12px ${'"Cairo", Tahoma, sans-serif'}`;
    ctx.fillStyle = '#F2C14E';
    ctx.fillText('محرّر الخرائط — وضع مبسّط', W - 16, 26);
    ctx.font = `700 9px "Cairo", Tahoma, sans-serif`;
    ctx.fillStyle = '#9BB8C4';
    ctx.fillText(`الأداة: ${this.tool} | الفرشاة: ${this.brush} | ${this.status}`, W - 16, 42);
    ctx.textAlign = 'left';
    ctx.fillStyle = '#7E8C99';
    ctx.fillText('[ ] حجم الفرشاة • 1..9 أدوات • S حفظ/تصدير • Q خروج', 16, H - 14);
    ctx.restore();
    if (input.pressed.has('KeyQ')) this.closed = true;
    if (input.pressed.has('KeyS')) {
      const json = JSON.stringify({ id: this.def.id, nameAr: this.name, theme: this.def.theme, w: this.def.w, h: this.def.h, layout: this.def.layout, ops: [] });
      const blob = new Blob([json], { type: 'application/json' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = this.def.id + '.m11map.json';
      a.click();
      this.status = 'تم تصدير الخريطة JSON';
    }
    for (let i = 1; i <= 9; i++) if (input.pressed.has('Digit' + i)) { this.toolIndex = i - 1; this.tool = this.tools[this.toolIndex]; }
    if (input.pressed.has('BracketLeft')) this.brush = Math.max(1, this.brush - 1);
    if (input.pressed.has('BracketRight')) this.brush = Math.min(6, this.brush + 1);
    if (input.keys.has('ArrowLeft')) this.cam.x -= 200 * dt;
    if (input.keys.has('ArrowRight')) this.cam.x += 200 * dt;
    if (input.keys.has('ArrowUp')) this.cam.y -= 160 * dt;
    if (input.keys.has('ArrowDown')) this.cam.y += 160 * dt;
  }
}

// ---------------------------------------------------------------------------
const game = new Game();
window.__M11 = game;
game.boot().catch((e) => {
  console.error(e);
  const el = document.getElementById('progress-label');
  if (el) el.textContent = 'خطأ في التحميل: ' + e.message;
});
