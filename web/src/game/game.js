// ============================================================================
// نواة المحاكاة (GameWorld) — المكان الذي يلتقي فيه كل شيء:
// الفيزياء + القتال + الغنائم + الأوضاع + الشبكة + المؤثرات.
// ============================================================================

import { CONFIG } from '../core/assets.js';
import { clamp, RNG, TAU, dist, RNG as Rand } from '../core/math.js';
import { generateMap, buildMinimap, TS, T, moveAndCollide, MAPS, MAP_BY_ID } from './world.js';
import { Actor, Bot, Projectile, Pickup, Vehicle, SafeZone, Airdrop, DIFFICULTY, BOT_NAMES } from './entities.js';
import { WEAPONS, resolveStats, hitscan, bulletDamage, RARITY_ORDER } from './weapons.js';
import { MODES, getMode, initModeExtras, updateModeExtras } from './modes.js';

export const TEAM_COLORS = ['#4FD1C5', '#E8734A', '#4A90D9', '#F2C14E', '#9B5DE8', '#E85D9B'];
export const TEAM_NAMES = ['الفريق الفيروزي', 'الفريق البرتقالي', 'الفريق الأزرق', 'الفريق الأصفر', 'الفريق البنفسجي', 'الفريق الوردي'];

export class GameWorld {
  constructor(opts = {}) {
    this.opts = opts;
    this.seed = opts.seed || Math.floor(Math.random() * 1e9);
    this.rng = new RNG(this.seed);
    this.modeId = opts.mode || 'dm';
    this.mode = getMode(this.modeId);
    this.levelDef = opts.mapDef || MAP_BY_ID[this.mode.map] || MAPS[0];
    this.level = generateMap(this.levelDef, this.seed);
    this.level.groundH = (px) => {
      const tx = clamp(Math.floor(px / TS), 0, this.level.map.w - 1);
      for (let y = 0; y < this.level.map.h; y++) if (this.level.map.isSolid(tx, y)) return y * TS;
      return this.level.height;
    };
    this.actors = [];
    this.projectiles = [];
    this.pickups = [];
    this.vehicles = [];
    this.airdrops = [];
    this.decals = [];
    this.effects = [];      // أحداث للمؤثرات (يستهلكها المُصيّر والصوت)
    this.events = [];
    this.time = 0;
    this.tick = 0;
    this.friendlyFire = opts.friendlyFire != null ? opts.friendlyFire : this.mode.friendlyFire;
    this.teams = this.mode.teams || 1;
    this.teamScores = new Array(Math.max(1, this.teams)).fill(0);
    this.teamLives = new Array(Math.max(1, this.teams)).fill(this.mode.lives || 0);
    this.killFeed = [];
    this.chatLog = [];
    this.matchState = 'warmup';     // warmup | playing | ended
    this.matchTimer = this.mode.timeLimit || 600;
    this.warmupTimer = opts.warmup != null ? opts.warmup : 4;
    this.results = null;
    this.zone = null;
    this.projectilePool = [];
    this.pickupPool = [];
    this.tracers = [];
    this.bloodDecals = [];
    this.stats = { kills: 0, damage: 0 };
    this.difficulty = opts.difficulty != null ? opts.difficulty : 1;
    this.botFill = opts.botFill != null ? opts.botFill : true;
    this.maxCombatants = opts.maxCombatants || CONFIG.maxCombatants;
    this.hooks = opts.hooks || {};   // { onEvent, onKill, onMatchEnd }
    this.timeOfDay = this.mode.timeOfDay || 0;
    this.weather = opts.weather || 'clear';
    this.spectator = null;
    this.replay = opts.replay ? [] : null;
    this.replayRecording = !!opts.replay;
    this.setup();
    initModeExtras(this);
  }

  // ------------------------------------------------------------- التهيئة
  setup() {
    const m = this.mode;
    if (m.zone) {
      const w = this.level.width, h = this.level.height;
      this.zone = new SafeZone(w / 2, h / 2, Math.max(w, h) * 0.55, {
        firstDelay: m.zoneDelay || 45, phases: m.zonePhases || 6,
        dps: 1.5, waitTime: m.zoneWait || 30,
      });
    }
    // توليد الغنائم من نقاط الخريطة
    if (m.loot) this.spawnMapLoot();
    // المركبات
    for (const v of this.level.vehicles || []) {
      if (m.vehicles === false) break;
      this.vehicles.push(new Vehicle(v.type, v.x, v.y));
    }
    this.spawnWaveTimer = m.waveInterval || 45;
  }

  spawnMapLoot() {
    for (const node of this.level.lootNodes) {
      const tier = node.tier || 1;
      const rolls = tier >= 3 ? 2 : 1;
      for (let i = 0; i < rolls; i++) {
        const data = this.rollLoot(tier);
        this.spawnPickup(node.x + (i * 26), node.y + i * 6, data);
      }
    }
  }

  rollLoot(tier) {
    const r = this.rng;
    const roll = r.next();
    if (roll < 0.52) {
      // سلاح
      const pool = Object.keys(WEAPONS).filter((id) => {
        const w = WEAPONS[id];
        const rank = RARITY_ORDER.indexOf(w.rarity);
        return rank <= (tier === 1 ? 1 : tier === 2 ? 3 : 5);
      });
      const id = r.pick(pool);
      return { kind: 'weapon', id, ammo: WEAPONS[id].mag };
    }
    if (roll < 0.62) return { kind: 'armor', level: clamp(tier, 1, 3) };
    if (roll < 0.68) return { kind: 'helmet', level: clamp(tier, 1, 3) };
    if (roll < 0.73) return { kind: 'backpack', level: clamp(tier, 1, 3) };
    if (roll < 0.80) return { kind: 'medkit', count: 1 };
    if (roll < 0.88) return { kind: 'bandage', count: r.int(1, 2) };
    if (roll < 0.92) return { kind: 'adrenaline' };
    if (roll < 0.96) return { kind: 'grenade', count: r.int(1, 2) };
    if (roll < 0.99) return { kind: 'ammo', cls: r.pick(['ar', 'smg', 'sr', 'shotgun', 'lmg', 'pistol']), count: 60 };
    return { kind: 'jetfuel' };
  }

  /** يضيف لاعبًا/بوتًا (يدعى من main أو من الشبكة) */
  addActor(opts) {
    const spawn = this.pickSpawnPoint(opts.team);
    const a = opts.isBot
      ? new Bot(spawn.x, spawn.y - CONFIG.playerHeight, opts)
      : new Actor(spawn.x, spawn.y - CONFIG.playerHeight, opts);
    a.team = opts.team != null ? opts.team : 0;
    a.spawnPoint = spawn;
    this.actors.push(a);
    this.initLoadout(a, opts.startWeapons);
    return a;
  }

  initLoadout(a, startWeapons) {
    const m = this.mode;
    if (m.gunGame) {
      a.giveWeapon('n9', 0, []);
      a.gunGameStage = 0;
      this.ammoUnlimited(a);
      return;
    }
    if (m.weaponPool && m.weaponPool.length) {
      const id = this.rng.pick(m.weaponPool);
      a.giveWeapon(id, 0, []);
      this.ammoUnlimited(a);
    }
    if (startWeapons) {
      startWeapons.forEach((id, i) => { if (id) a.giveWeapon(id, i, []); });
    }
    if (m.loadout === 'br' || m.loot) {
      a.armorLevel = 0; a.helmetLevel = 0; a.backpackLevel = 0;
    } else {
      a.armorLevel = m.defaultArmor != null ? m.defaultArmor : 1;
      a.helmetLevel = m.defaultHelmet != null ? m.defaultHelmet : 1;
      a.armor = [0, 40, 70, 100][a.armorLevel];
      a.helmet = [0, 40, 70, 100][a.helmetLevel];
      a.backpackLevel = 1;
      a.heals = { bandage: 2, medkit: 1, adrenaline: 0 };
      a.throwable = { id: 'grenade', count: 2 };
      if (!a.weapons[0]) a.giveWeapon('jabha', 0, []);
      if (!a.weapons[1]) a.giveWeapon('n9', 1, []);
    }
  }

  ammoUnlimited(a) {
    a.unlimitedAmmo = true;
  }

  pickSpawnPoint(team) {
    const spawns = this.level.spawns;
    if (!spawns.length) return { x: 100, y: 100 };
    const m = this.mode;
    if (m.teams > 1 && m.teamSpawns) {
      // فرق: نقاط متقابلة
      const half = Math.floor(spawns.length / 2);
      const pool = team % 2 === 0 ? spawns.slice(0, half) : spawns.slice(half);
      // اختر الأبعد عن الأعداء
      let best = null, bestScore = -1;
      for (let i = 0; i < 6; i++) {
        const s = pool[Math.floor(this.rng.next() * pool.length)];
        if (!s) continue;
        let score = 1e9;
        for (const a of this.actors) {
          if (!a.alive || a.team === team) continue;
          score = Math.min(score, dist(s.x, s.y, a.cx, a.cy));
        }
        if (score > bestScore) { bestScore = score; best = s; }
      }
      return best || pool[0];
    }
    // كل ضد كل: الأبعد عن الكل
    let best = null, bestScore = -1;
    for (let i = 0; i < 8; i++) {
      const s = spawns[Math.floor(this.rng.next() * spawns.length)];
      let score = 1e9;
      for (const a of this.actors) {
        if (!a.alive) continue;
        score = Math.min(score, dist(s.x, s.y, a.cx, a.cy));
      }
      if (score > bestScore) { bestScore = score; best = s; }
    }
    return best || spawns[0];
  }

  respawn(a) {
    const s = this.pickSpawnPoint(a.team);
    a.x = s.x;
    a.y = s.y - CONFIG.playerHeight;
    a.vx = 0; a.vy = 0;
    a.hp = a.maxHp;
    a.alive = true;
    a.dbno = false;
    a.dbnoTimer = 0;
    a.deathTimer = 0;
    a.armor = [0, 40, 70, 100][a.armorLevel] || 0;
    a.jetFuel = CONFIG.jetpackFuel;
    a.spawnProtect = 1.6;
    a.setState('idle');
    a.setHeight(CONFIG.playerHeight);
    a.prone = false; a.crouch = false;
    a.healing = null;
    a.slideTimer = 0; a.rollTimer = 0;
    if (this.mode.gunGame) { /* يحافظ على تقدّمه */ } else if (this.mode.loadout === 'br' && this.mode.respawn === false) {
      // في BR بلا إحياء: يبقى ميتًا
    }
    this.emit({ type: 'spawn', actor: a, x: a.cx, y: a.cy });
  }

  /** هل هذان المقاتلان عدوّان؟ (يتعامل مع FFA والتعاوني والعدوى) */
  isHostile(a, b) {
    if (!a || !b || a === b) return false;
    if (this.mode.cooperative) return a.team !== b.team;
    if (this.mode.infection) return !!a.isZombie !== !!b.isZombie;
    if (this.mode.teams <= 1) return true;      // الكل ضد الكل
    return a.team !== b.team;
  }

  // ------------------------------------------------------------- الأحداث
  emit(e) {
    this.events.push(e);
  }

  onActorEvent(a, kind, data = {}) {
    const e = { type: kind, actor: a, x: a.cx, y: a.cy, ...data };
    this.emit(e);
    if (kind === 'shoot') {
      this.muzzlePuff(a, data.weapon);
      // نبه البوتات القريبة (سماع الطلقات)
      for (const b of this.actors) {
        if (b.isBot && b.alive && this.isHostile(a, b)) {
          const d = dist(a.cx, a.cy, b.cx, b.cy);
          if (d < 900 * b.diff.awareness) b.ai.hearPos = { x: a.cx, y: a.cy };
        }
      }
    }
    if (kind === 'footstep') this.emit({ type: 'footstep_vfx', x: a.cx, y: a.y + a.h, water: data.water });
  }

  muzzlePuff(a, weaponId) {
    const aim = a.computeAim(false);
    const w = WEAPONS[weaponId];
    this.emit({ type: 'vfx', fx: 'muzzle', x: aim.muzzle.x, y: aim.muzzle.y, angle: a.aimAngle, scale: w && w.cls === 'shotgun' ? 1.4 : 1 });
    if (w && w.energy) this.emit({ type: 'vfx', fx: 'spark', x: aim.muzzle.x, y: aim.muzzle.y, color: 'cyan' });
  }

  // ------------------------------------------------------------- الطلقات
  hitscanShot(shooter, x, y, angle, weapon, weaponId) {
    const range = weapon.range || 1200;
    const res = hitscan(this.level, this.actors, x, y, angle, range, {
      shooter, pen: weapon.pen || 0, friendlyFire: this.friendlyFire,
      isHostile: (e) => this.isHostile(shooter, e) || (this.friendlyFire && e !== shooter),
    });
    const ex = res.entities.length ? res.entities[0].x : res.x;
    const ey = res.entities.length ? res.entities[0].y : res.y;
    this.tracers.push({ x0: x, y0: y, x1: ex, y1: ey, life: 0.07, color: weapon.energy ? '#7FD2F5' : '#FFD98A' });
    for (const hit of res.entities) {
      const target = hit.entity;
      const isHead = hit.y < target.y + (target.h * 0.28);
      const dmg = bulletDamage(weapon, res.dist, isHead, target);
      shooter.shotsHit++;
      this.applyDamage(shooter, target, dmg, { headshot: isHead, weaponId, x: hit.x, y: hit.y });
      // اختراق: يقل الضرر
      if (weapon.pen) weapon = { ...weapon, body: weapon.body * 0.7, head: weapon.head * 0.7, pen: weapon.pen - 1 };
    }
    if (res.blocked) {
      const mat = this.surfaceAt(res.x, res.y);
      this.emit({ type: 'vfx', fx: 'spark', x: res.x, y: res.y, small: true });
      this.emit({ type: 'impact', material: mat, x: res.x, y: res.y });
      this.addDecal(res.x, res.y, 'bullet', angle);
      this.level.map.damage(Math.floor(res.x / TS), Math.floor(res.y / TS), weapon.body * 0.4);
    }
    this.emit({ type: 'shot', shooter, x, y, angle, weaponId, dist: res.dist });
    return res;
  }

  applyProjectileHit(proj, target, pos) {
    const isHead = pos.y < target.y + target.h * 0.3;
    const dmg = isHead ? proj.weapon.head : proj.weapon.body;
    this.applyDamage(proj.owner, target, dmg, { headshot: isHead, weaponId: proj.weaponId, x: pos.x, y: pos.y });
    this.explode(proj.cx, proj.cy, proj.splash || 26, (proj.splashDamage || dmg) * 0.5, proj.owner, { weaponId: proj.weaponId });
    proj.active = false;
  }

  onProjectileImpact(proj, x, y) {
    const mat = this.surfaceAt(x, y);
    this.emit({ type: 'impact', material: mat, x, y });
    this.emit({ type: 'vfx', fx: 'spark', x, y });
  }

  spawnProjectile(owner, opts) {
    const p = this.projectilePool.pop() || new Projectile();
    p.spawn({ ...opts, owner, ownerTeam: owner.team });
    this.projectiles.push(p);
    if (p.splash > 0) {
      // قذائف: أثر دخاني خلفي
      this.emit({ type: 'vfx', fx: 'smoke', x: p.cx, y: p.cy, small: true, follow: p });
    }
    return p;
  }

  spawnThrowable(owner, kind) {
    const angle = owner.aimAngle - 0.35;
    const speed = 420;
    const t = this.spawnProjectile(owner, {
      x: owner.cx + Math.cos(angle) * 12, y: owner.cy - 6, angle, speed,
      weapon: { body: 0, head: 0, gravity: true },
      weaponId: kind === 'grenade' ? 'qadifa' : 'shama',
      kind: kind === 'grenade' ? 'grenade' : 'flare',
      gravity: true, bounce: 0.6, size: 8, life: kind === 'grenade' ? 3.0 : 8,
      splash: kind === 'grenade' ? 86 : 40, splashDamage: kind === 'grenade' ? 105 : 30,
    });
    this.emit({ type: 'throw', x: t.x, y: t.y, kind });
    return t;
  }

  /** انفجار: ضرر نطاقي + تدمير + مؤثرات */
  explode(x, y, radius, damage, owner, opts = {}) {
    this.emit({ type: 'explosion', x, y, radius, big: radius > 100, weaponId: opts.weaponId });
    this.level.map.explode(x, y, radius, damage * 0.6);
    for (const a of this.actors) {
      if (!a.alive) continue;
      const d = dist(x, y, a.cx, a.cy);
      if (d > radius) continue;
      if (owner && !this.isHostile(owner, a) && a !== owner && !this.friendlyFire) continue;
      const falloff = 1 - clamp(d / radius, 0, 1);
      const dmg = damage * Math.pow(falloff, 0.85);
      if (dmg < 1) continue;
      this.applyDamage(owner, a, dmg, {
        explosion: true, weaponId: opts.weaponId, grenade: opts.grenade, x, y,
      });
      // دفع بالانفجار
      const ang = Math.atan2(a.cy - y, a.cx - x);
      a.vx += Math.cos(ang) * 240 * falloff;
      a.vy += Math.sin(ang) * 180 * falloff - 60 * falloff;
    }
    // براميل متفجرة قريبة (سلسلة انفجارات)
    for (const p of this.level.props) {
      if (p.explosive && dist(x, y, p.x, p.y) < radius + 20) {
        p.explosive = false;
        this.explode(p.x, p.y + 10, 74, 90, owner, { chain: true });
      }
    }
    // المركبات
    for (const v of this.vehicles) {
      if (dist(x, y, v.cx, v.cy) < radius) {
        v.hp -= damage;
        if (v.hp <= 0) {
          v.active = false;
          this.explode(v.cx, v.cy, 70, 80, owner, { vehicle: true });
        }
      }
    }
    this.addDecal(x, y, 'scorch', 0, radius * 0.5);
  }

  areaDamage(x, y, radius, amount, owner, opts = {}) {
    for (const a of this.actors) {
      if (!a.alive) continue;
      if (owner && !this.isHostile(owner, a) && a !== owner && !this.friendlyFire) continue;
      if (dist(x, y, a.cx, a.cy) <= radius) {
        this.applyDamage(owner, a, amount, { ...opts, x, y });
      }
    }
  }

  /** الضرر النهائي + تسجيل القتل + الطرح */
  applyDamage(attacker, target, amount, opts = {}) {
    if (!target.alive || target.hp <= 0) return;
    if (target.spawnProtect > 0 && !opts.ignoreProtect) return;
    if (!this.friendlyFire && attacker && attacker !== target && !this.isHostile(attacker, target)) return;
    const before = target.hp;
    const isHead = !!opts.headshot;
    // خوذة تخفّض ضرر الرأس
    let dmg = amount;
    if (isHead && target.helmetLevel > 0) {
      dmg *= 1 - [0, 0.15, 0.25, 0.35][clamp(target.helmetLevel, 0, 3)];
    }
    // درع
    if (target.armor > 0 && target.armorLevel > 0) {
      const absorb = [0, 0.3, 0.42, 0.55][clamp(target.armorLevel, 0, 3)];
      const absorbed = Math.min(target.armor, dmg * absorb);
      target.armor -= absorbed;
      dmg -= absorbed;
    }
    target.hp -= dmg;
    target.hitFlash = 0.2;
    target.lastDamageTime = this.time;
    if (isHead) target.lastHitHead = true;
    // سجل المساعدين
    if (attacker && attacker !== target) {
      if (!target.damageLog) target.damageLog = [];
      if (!target.damageLog.includes(attacker)) target.damageLog.push(attacker);
      attacker.damage += dmg;
      this.stats.damage += dmg;
    }
    this.emit({
      type: 'hit', x: target.cx, y: target.cy, headshot: isHead, damage: dmg,
      target, attacker, killed: target.hp <= 0,
    });
    if (attacker && attacker !== target) {
      this.emit({ type: 'hitmarker', shooter: attacker, headshot: isHead, killed: target.hp <= 0, damage: dmg });
    }
    if (target.hp <= 0) {
      target.hp = 0;
      // طرح (DBNO) أم موت مباشر
      const canDbno = this.mode.dbno && !target.isBot ? true : this.mode.dbno && target.isBot && this.rng.next() < 0.6;
      if (canDbno && !opts.instantKill && !opts.headshot) {
        if (target.enterDbno({})) {
          this.emit({ type: 'dbno', actor: target, x: target.cx, y: target.cy });
          return;
        }
      }
      this.killActor(attacker, target, opts);
    }
  }

  killActor(attacker, victim, opts = {}) {
    if (!victim.alive) return;
    const dist = attacker && attacker !== victim ? Math.hypot(attacker.cx - victim.cx, attacker.cy - victim.cy) : 0;
    const variant = this.rng.int(0, 2);
    victim.die({ variant });
    victim.dbno = false;
    // الغنائم
    for (const d of victim.dropLoot()) {
      this.spawnPickup(victim.cx, victim.cy - 10, d);
    }
    if (victim.unlimitedAmmo) delete victim.unlimitedAmmo;
    // إحصاءات ومكافآت
    if (attacker && attacker !== victim) {
      if (!this.isHostile(attacker, victim) && !this.friendlyFire) {
        // عقوبة قتل الفريق
        this.teamScores[attacker.team] = Math.max(0, (this.teamScores[attacker.team] || 0) - 1);
      } else {
        attacker.kills++;
        attacker.weaponKills[opts.weaponId || (attacker.weaponId || 'melee')] =
          (attacker.weaponKills[opts.weaponId || 'melee'] || 0) + 1;
        if (opts.headshot) attacker.headshots++;
        attacker.longestKill = Math.max(attacker.longestKill, dist);
        if (opts.grenade) attacker.grenadeKills = (attacker.grenadeKills || 0) + 1;
        if (opts.melee) attacker.meleeKills = (attacker.meleeKills || 0) + 1;
        this.stats.kills++;
      }
    } else if (opts.fall || opts.zone) {
      attacker = null;
    }
    // مساعدات
    if (victim.damageLog) {
      for (const helper of victim.damageLog) {
        if (helper !== attacker && helper !== victim && helper.alive) {
          helper.assists++;
          this.emit({ type: 'assist', actor: helper, victim });
        }
      }
      victim.damageLog = [];
    }
    // نقاط الفريق
    const team = attacker && attacker !== victim ? attacker.team : null;
    if (team != null) this.teamScores[team] = (this.teamScores[team] || 0) + 1;
    this.killFeed.push({
      killer: attacker ? attacker.name : 'بيئة',
      killerTeam: attacker ? attacker.team : -1,
      victim: victim.name,
      victimTeam: victim.team,
      weapon: opts.weaponId,
      headshot: !!opts.headshot,
      time: this.time,
    });
    if (this.killFeed.length > 6) this.killFeed.shift();
    this.emit({ type: 'kill', attacker, victim, x: victim.cx, y: victim.cy, headshot: opts.headshot, weaponId: opts.weaponId });
    if (this.hooks.onKill) this.hooks.onKill(attacker, victim, opts);
    // ترقيات Gun Game
    if (this.mode.gunGame && attacker && attacker !== victim) this.gunGameAdvance(attacker);
    // فحص نهاية المباراة
    this.mode.checkWin && this.mode.checkWin(this);
  }

  gunGameAdvance(a) {
    const ladder = this.mode.gunGameLadder;
    a.gunGameStage = (a.gunGameStage || 0) + 1;
    if (a.gunGameStage >= ladder.length) {
      this.mode.checkWin && this.mode.checkWin(this);
      return;
    }
    a.giveWeapon(ladder[a.gunGameStage], 0, []);
    this.emit({ type: 'gunGame', actor: a, stage: a.gunGameStage });
  }

  /** مشاجرة: ضربة قريبة بقوس */
  performMelee(attacker, meleeId, weaponId) {
    const w = WEAPONS[meleeId] || WEAPONS.shafra;
    const range = w.meleeRange || 34;
    const arc = w.meleeArc || 1.2;
    const a = attacker.aimAngle;
    const hx = attacker.cx + Math.cos(a) * range * 0.5;
    const hy = attacker.cy + Math.sin(a) * range * 0.5;
    this.emit({ type: 'melee', actor: attacker, x: hx, y: hy, angle: a, weaponId: meleeId });
    let hit = false;
    for (const t of this.actors) {
      if (t === attacker || !t.alive) continue;
      if (!this.friendlyFire && !this.isHostile(attacker, t)) continue;
      const d = dist(hx, hy, t.cx, t.cy);
      if (d > range * 0.9 + 12) continue;
      const ang = Math.atan2(t.cy - attacker.cy, t.cx - attacker.cx);
      if (Math.abs(((ang - a + Math.PI * 3) % TAU) - Math.PI) > arc) continue;
      const dmg = t.hp <= 0 ? 0 : w.body + (attacker.vy < -60 ? 20 : 0);
      this.applyDamage(attacker, t, dmg, { melee: true, weaponId: meleeId, x: t.cx, y: t.cy });
      hit = true;
    }
    // ضرب الصناديق المتفجرة
    for (const p of this.level.props) {
      if (p.explosive && dist(hx, hy, p.x, p.y) < range) {
        p.explosive = false;
        this.explode(p.x, p.y, 74, 90, attacker, { chain: true });
      }
    }
    this.emit({ type: 'meleeResult', hit, x: hx, y: hy });
    return hit;
  }

  /** إنعاش زميل مُطرح تدريجيًا */
  reviveTick(rescuer, target, dt) {
    if (!target.dbno || !target.alive) return false;
    target.reviveProgress += dt / CONFIG.reviveTime;
    this.emit({ type: 'reviveTick', x: target.cx, y: target.cy, progress: target.reviveProgress, rescuer });
    if (target.reviveProgress >= 1) {
      target.dbno = false;
      target.reviveProgress = 0;
      target.hp = Math.min(45, target.maxHp);
      target.setState('idle');
      target.setHeight(CONFIG.playerHeight);
      rescuer.revives++;
      this.emit({ type: 'revive', actor: target, rescuer, x: target.cx, y: target.cy });
      return true;
    }
    return false;
  }

  // ------------------------------------------------------------- الغنائم
  spawnPickup(x, y, data) {
    const p = this.pickupPool.pop() || new Pickup();
    p.spawn(x, y, data);
    this.pickups.push(p);
    return p;
  }

  findLootNear(a, radius) {
    let best = null, bd = radius * radius;
    for (const p of this.pickups) {
      if (!p.active) continue;
      const d = (p.cx - a.cx) ** 2 + (p.cy - a.cy) ** 2;
      if (d < bd) { bd = d; best = p; }
    }
    return best;
  }

  pickupFor(actor, pickup) {
    if (!pickup.active || !actor.alive) return false;
    const d = pickup.data;
    let taken = false;
    let message = '';
    switch (d.kind) {
      case 'weapon': {
        const slot = actor.weapons[0] ? (actor.weapons[1] ? actor.slot : 1) : 0;
        if (actor.giveWeapon(d.id, slot, d.attachments)) {
          actor.ammo[WEAPONS[d.id].cls] = (actor.ammo[WEAPONS[d.id].cls] || 0) + WEAPONS[d.id].mag * 2;
          message = WEAPONS[d.id].nameAr;
          taken = true;
        }
        break;
      }
      case 'armor':
        if (d.level > actor.armorLevel) {
          actor.armorLevel = d.level;
          actor.armor = [0, 40, 70, 100][d.level];
          message = 'درع ' + d.level;
          taken = true;
        } else if (actor.armor < [0, 40, 70, 100][actor.armorLevel]) {
          actor.armor = [0, 40, 70, 100][actor.armorLevel];
          message = 'إصلاح درع';
          taken = true;
        }
        break;
      case 'helmet':
        if (d.level > actor.helmetLevel) {
          actor.helmetLevel = d.level;
          actor.helmet = [0, 40, 70, 100][d.level];
          message = 'خوذة ' + d.level;
          taken = true;
        }
        break;
      case 'backpack':
        if (d.level > actor.backpackLevel) {
          actor.backpackLevel = d.level;
          message = 'حقيبة ' + d.level;
          taken = true;
        }
        break;
      case 'medkit':
        if (actor.heals.medkit < 1 + (actor.backpackLevel || 0)) {
          actor.heals.medkit += d.count || 1;
          message = 'حقيبة إسعاف';
          taken = true;
        }
        break;
      case 'bandage':
        if (actor.heals.bandage < 4 + (actor.backpackLevel || 0) * 2) {
          actor.heals.bandage += d.count || 1;
          message = 'ضمادة';
          taken = true;
        }
        break;
      case 'adrenaline':
        actor.heals.adrenaline = (actor.heals.adrenaline || 0) + 1;
        actor.heal(20);
        message = 'أدرينالين';
        taken = true;
        break;
      case 'grenade':
        if (actor.throwable.count < 3 + (actor.backpackLevel || 0)) {
          actor.throwable.count += d.count || 1;
          message = 'قنبلة';
          taken = true;
        }
        break;
      case 'jetfuel':
        actor.jetFuel = CONFIG.jetpackFuel;
        message = 'وقود جيت باك';
        taken = true;
        break;
      case 'ammo':
        actor.ammo[d.cls] = (actor.ammo[d.cls] || 0) + (d.count || 60);
        if (actor.weaponId && WEAPONS[actor.weaponId] && WEAPONS[actor.weaponId].cls === d.cls) {
          const w = actor.weapons[actor.slot];
          if (w) w.ammo = w.stats.magSize;
        }
        message = 'ذخيرة';
        taken = true;
        break;
      case 'airdrop':
        // فتح الإسقاط: غنائم ذهبية
        if (!pickup.opened) {
          pickup.opened = true;
          const golden = this.rng.pick(['thuban', 'jarrar', 'raad', 'najm', 'zilzal']);
          this.spawnPickup(actor.cx + 24, actor.cy, { kind: 'weapon', id: golden, ammo: WEAPONS[golden].mag });
          this.spawnPickup(actor.cx - 24, actor.cy, { kind: 'armor', level: 3 });
          this.spawnPickup(actor.cx, actor.cy - 20, { kind: 'helmet', level: 3 });
          this.spawnPickup(actor.cx + 12, actor.cy - 30, { kind: 'medkit', count: 1 });
          pickup.active = false;
          this.emit({ type: 'airdropOpen', x: actor.cx, y: actor.cy });
          if (this.hooks.onAirdrop) this.hooks.onAirdrop(actor);
          return true;
        }
        return false;
      default:
        return false;
    }
    if (taken) {
      pickup.active = false;
      this.emit({ type: 'pickup', actor, kind: d.kind, label: message, x: pickup.cx, y: pickup.cy });
    }
    return taken;
  }

  // ------------------------------------------------------------- الاستعلامات
  surfaceAt(x, y) {
    const t = this.level.map.get(Math.floor(x / TS), Math.floor(y / TS));
    if (t === T.WATER) return 'water';
    if (t === T.GLASS) return 'glass';
    if (t === T.CRATE) return 'wood';
    if (t === T.SANDBAG) return 'dirt';
    const mat = this.level.def.theme;
    if (mat === 'base') return 'metal';
    if (mat === 'forest') return 'wood';
    if (mat === 'desert') return 'dirt';
    return 'concrete';
  }

  addDecal(x, y, kind, angle = 0, scale = 1) {
    this.decals.push({ x, y, kind, angle, scale, life: kind === 'scorch' ? 25 : 10, maxLife: kind === 'scorch' ? 25 : 10 });
    if (this.decals.length > 220) this.decals.shift();
  }

  distance(a, b) {
    return dist(a.cx, a.cy, b.cx, b.cy);
  }

  findVisibleEnemy(a, maxDist) {
    let best = null, bd = maxDist * maxDist;
    for (const e of this.actors) {
      if (e === a || !e.alive || e.hp <= 0) continue;
      if (!this.isHostile(a, e)) continue;
      const d = (e.cx - a.cx) ** 2 + (e.cy - a.cy) ** 2;
      if (d > bd) continue;
      // خط النظر
      const r = this.level.map.raycast(a.cx, a.cy - 6, e.cx, e.cy - 6);
      if (r.hit) continue;
      bd = d;
      best = e;
    }
    return best;
  }

  /** أقرب عدو (للتصويب/المطاردة) بغضّ النظر عن خط النظر — يمنع مباريات بلا اشتباك */
  nearestHostile(a) {
    let best = null, bd = Infinity;
    for (const e of this.actors) {
      if (e === a || !e.alive || e.hp <= 0) continue;
      if (!this.isHostile(a, e)) continue;
      const d = (e.cx - a.cx) ** 2 + (e.cy - a.cy) ** 2;
      if (d < bd) { bd = d; best = e; }
    }
    return best;
  }

  findDbnoTeammate(a, maxDist) {
    for (const e of this.actors) {
      if (e === a || !e.alive || !e.dbno) continue;
      if (e.team !== a.team) continue;
      if (dist(a.cx, a.cy, e.cx, e.cy) < maxDist) return e;
    }
    return null;
  }

  /** حالة الأعداء/الزملاء الحية */
  getTeamAlive(team) {
    return this.actors.filter((a) => a.alive && a.hp > 0 && a.team === team).length;
  }
  getAliveCount() {
    return this.actors.filter((a) => a.alive && a.hp > 0).length;
  }

  // ------------------------------------------------------------- التحديث
  update(dt) {
    this.time += dt;
    this.tick++;
    if (this.matchState === 'warmup') {
      this.warmupTimer -= dt;
      if (this.warmupTimer <= 0) {
        this.matchState = 'playing';
        this.emit({ type: 'matchStart' });
      }
    } else if (this.matchState === 'playing') {
      this.matchTimer -= dt;
      if (this.matchTimer <= 0) this.endMatch('time');
    }
    // المقاتلون
    for (const a of this.actors) {
      if (!a.alive) {
        a.deathTimer += dt;
        if (this.mode.respawn !== false && this.matchState === 'playing') {
          const delay = this.mode.respawnTime || CONFIG.respawnTime;
          if (a.deathTimer > delay) this.respawn(a);
        }
        continue;
      }
      a.update(dt, this, null);
      // التقاط الغنائم تلقائيًا عند الاقتراب
      if (!a.isBot && this.mode.autoPickup !== false) {
        const near = this.findLootNear(a, 22);
        if (near && near.active) this.pickupFor(a, near);
      }
      if (a.oldY == null) a.oldY = a.y;
    }
    // كيانات
    for (const p of this.projectiles) p.update(dt, this);
    for (const k of this.pickups) k.update(dt, this);
    for (const v of this.vehicles) v.update(dt, this);
    for (const ad of this.airdrops) ad.update(dt, this);
    if (this.zone) this.zone.update(dt, this);
    // تنظيف
    for (let i = this.projectiles.length - 1; i >= 0; i--) {
      if (!this.projectiles[i].active) {
        this.projectilePool.push(this.projectiles.splice(i, 1)[0]);
      }
    }
    for (let i = this.pickups.length - 1; i >= 0; i--) {
      if (!this.pickups[i].active) this.pickupPool.push(this.pickups.splice(i, 1)[0]);
    }
    for (let i = this.decals.length - 1; i >= 0; i--) {
      this.decals[i].life -= dt;
      if (this.decals[i].life <= 0) this.decals.splice(i, 1);
    }
    for (let i = this.tracers.length - 1; i >= 0; i--) {
      this.tracers[i].life -= dt;
      if (this.tracers[i].life <= 0) this.tracers.splice(i, 1);
    }
    // الأوضاع الخاصة
    updateModeExtras(this, dt);
    // الإسقاطات الجوية الدورية (BR)
    if (this.mode.airdrops && this.matchState === 'playing') {
      this.airdropTimer = (this.airdropTimer || 25) - dt;
      if (this.airdropTimer <= 0) {
        this.airdropTimer = this.rng.range(70, 120);
        const x = this.rng.range(this.level.width * 0.2, this.level.width * 0.8);
        const y = this.level.height - 60;
        this.airdrops.push(new Airdrop(x, y, this.rng.next() < 0.5 ? 1 : -1));
        this.emit({ type: 'airdropIncoming', x, y });
      }
    }
    // تسجيل الإعادة (Repaly): حالات مضغوطة فقط
    if (this.replayRecording && this.tick % 3 === 0) {
      this.replay.push(this.snapshotForReplay());
      if (this.replay.length > 3600) this.replay.shift();
    }
  }

  snapshotForReplay() {
    const out = [];
    for (const a of this.actors) {
      out.push([a.id, Math.round(a.x), Math.round(a.y), Math.round(a.aimAngle * 100) / 100,
        a.state, a.hp | 0, a.facing, a.opKey.charCodeAt(0)]);
    }
    return out;
  }

  endMatch(reason) {
    if (this.matchState === 'ended') return;
    this.matchState = 'ended';
    this.results = this.buildResults(reason);
    this.emit({ type: 'matchEnd', results: this.results });
    if (this.hooks.onMatchEnd) this.hooks.onMatchEnd(this.results);
  }

  buildResults(reason) {
    const sorted = [...this.actors].sort((a, b) => (b.kills - a.kills) || (a.deaths - b.deaths));
    const teams = this.teamScores || [];
    const teamMode = teams.length > 1;
    const me = sorted.find((a) => !a.isBot);
    // الفوز: في الأوضاع الفرقية بمقارنة نقاط الفريقين، وفي الفردية بالترتيب الأول
    const won = teamMode
      ? (!!me && me.team === (teams[0] >= teams[1] ? 0 : 1))
      : (!!me && sorted.indexOf(me) === 0);
    return {
      reason,
      duration: this.time,
      teams,
      won,
      teamMode,
      standings: sorted.map((a, i) => ({
        id: a.id, name: a.name, team: a.team, kills: a.kills, deaths: a.deaths,
        assists: a.assists, headshots: a.headshots, damage: Math.round(a.damage),
        accuracy: a.shotsFired ? Math.round((a.shotsHit / a.shotsFired) * 100) : 0,
        placement: i + 1, isBot: !!a.isBot, opKey: a.opKey,
        longestKill: Math.round(a.longestKill), revives: a.revives,
      })),
    };
  }
}

function MAPS_DEFAULT(world) {
  return { id: 'default', nameAr: 'ساحة', theme: 'city', w: 2400, h: 900, layout: { platforms: 10, buildings: 2, crates: 16 } };
}
