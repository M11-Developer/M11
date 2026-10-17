// ============================================================================
// الكيانات: المقاتلون (لاعب/بوت)، الرصاص، القنابل، الغنائم، المركبات، المنطقة
// روح Mini Militia: جيت باك، تشبّت بالحواف، انزلاق، تدحرج، Double Jump
// + روح PUBG: منطقة آمنة، غنائم، طرح وإنعاش (DBNO)، إسقاط جوي.
// ============================================================================

import { CONFIG } from '../core/assets.js';
import { clamp, damp, RNG, TAU, normAngle, angleDelta } from '../core/math.js';
import { moveAndCollide, TS, T, SOLID_TILES } from './world.js';
import { WEAPONS, resolveStats, isMelee, currentSpread, bulletDamage, recoilOffset } from './weapons.js';

let nextId = 1;

export class Entity {
  constructor(x, y, w, h) {
    this.id = nextId++;
    this.x = x; this.y = y; this.w = w; this.h = h;
    this.vx = 0; this.vy = 0;
    this.alive = true;
    this.remove = false;
  }
  get cx() { return this.x + this.w / 2; }
  get cy() { return this.y + this.h / 2; }
  rect() { return { x: this.x, y: this.y, w: this.w, h: this.h }; }
}

// ---------------------------------------------------------------- المقاتل
export const STATE = {
  IDLE: 'idle', RUN: 'run', SPRINT: 'sprint', JUMP: 'jump', FALL: 'fall', JET: 'jetpack',
  PRONE: 'prone', CRAWL: 'crawl', SLIDE: 'slide', ROLL: 'roll', CLIMB: 'climb',
  LEDGE: 'ledge', DBNO: 'dbno', DEAD: 'dead', DRIVE: 'drive', SWIM: 'swim', MELEE: 'melee',
  THROW: 'throw', RELOAD: 'reload', HEAL: 'heal', REVIVE: 'revive', TAUNT: 'taunt', WIN: 'win',
};

export class Actor extends Entity {
  constructor(x, y, opts = {}) {
    const h = CONFIG.playerHeight;
    super(x, y, CONFIG.playerWidth, h);
    this.type = opts.type || 'player';
    this.name = opts.name || 'مقاتل';
    this.team = opts.team != null ? opts.team : 0;
    this.opKey = opts.opKey || 'rashid';
    this.isBot = !!opts.isBot;
    this.difficulty = opts.difficulty || 1;
    // المظهر والتخصيص
    this.skin = opts.skin || 'default';
    this.camo = opts.camo || 'none';
    this.charm = opts.charm || null;
    // الصحة والعتاد
    this.hp = 100; this.maxHp = 100;
    this.armor = 0; this.armorLevel = 0;
    this.helmet = 0; this.helmetLevel = 0;
    this.backpackLevel = 0;
    this.dbno = false; this.dbnoTimer = 0; this.bleedOut = CONFIG.dbnoTime;
    this.reviveProgress = 0;
    this.deathTimer = 0;
    // الجيت باك
    this.jetFuel = CONFIG.jetpackFuel;
    this.jetpackLevel = 1;
    // الحركة
    this.state = STATE.IDLE;
    this.facing = 1;
    this.aimAngle = 0;
    this.grounded = false;
    this.coyote = 0;
    this.jumpsLeft = 2;
    this.jetActive = false;
    this.ledgeTile = null;
    this.wallSlide = 0;
    this.slideTimer = 0;
    this.rollTimer = 0;
    this.stateTimer = 0;
    this.crouch = false; this.prone = false;
    this.eyeHeight = 0;
    // القتال
    this.weapons = [null, null];     // خانتان أساسيتان
    this.slot = 0;
    this.melee = opts.melee || 'shafra';
    this.throwable = { id: 'grenade', count: 2 };
    this.heals = { bandage: 2, medkit: 0, adrenaline: 0 };
    this.ammo = {};                  // ذخيرة احتياطية لكل فئة
    this.fireCooldown = 0;
    this.reloadTimer = 0;
    this.reloading = false;
    this.shotIndex = 0;
    this.recoil = { x: 0, y: 0 };
    this.ads = false;
    this.attachments = [[], []];
    this.lastHitBy = null;
    this.lastDamageTime = -99;
    this.assistList = [];
    // إحصائيات الجلسة
    this.kills = 0; this.deaths = 0; this.headshots = 0; this.shotsFired = 0; this.shotsHit = 0;
    this.damage = 0; this.assists = 0; this.longestKill = 0; this.revives = 0;
    this.weaponKills = {}; this.weaponShots = {};
    this.survivalTime = 0;
    // مؤثرات وإحصاءات أخرى
    this.footstepTimer = 0;
    this.lastGroundY = y;
    this.hitFlash = 0;
    this.muzzleFlash = 0;
    this.recoilKick = 0;
    this.pingTarget = null;
    this.vehicle = null;
    this.mountSlot = null;           // لمركبة بمدفع
    this.flying = false;
    this.wasGrounded = false;
    this.airTime = 0;
    this.spawnProtect = 1.5;
    this.netInterp = null;
  }

  get weapon() {
    const w = this.weapons[this.slot];
    return w ? w.stats : null;
  }
  get weaponId() {
    const w = this.weapons[this.slot];
    return w ? w.id : null;
  }
  get speedMul() {
    let m = 1;
    if (this.prone) m *= 0.22;
    else if (this.crouch) m *= 0.6;
    const w = this.weapons[this.slot];
    if (w) m *= 1 - clamp((w.stats.weight - 1) * 0.14, 0, 0.4);
    if (this.ads) m *= 0.62;
    if (this.hp < 35) m *= 0.92;
    return m;
  }
  get height() {
    return this.prone ? CONFIG.proneHeight : this.crouch ? CONFIG.playerCrouchHeight : CONFIG.playerHeight;
  }

  /** ضبط الارتفاع (انبطاح/قرفصاء) مع الحفاظ على القدمين */
  setHeight(h) {
    const bottom = this.y + this.h;
    this.h = h;
    this.y = bottom - h;
  }

  giveWeapon(id, slot = null, attachments = null) {
    const s = resolveStats(id, attachments || []);
    if (!s) return false;
    const def = { id, stats: s, attachments: attachments || [], ammo: s.magSize };
    if (slot == null) {
      const empty = this.weapons.findIndex((w) => !w);
      slot = empty >= 0 ? empty : this.slot;
    }
    this.weapons[slot] = def;
    this.slot = slot;
    this.reloading = false;
    this.reloadTimer = 0;
    this.shotIndex = 0;
    return true;
  }

  heal(amount) {
    this.hp = clamp(this.hp + amount, 0, this.maxHp);
  }

  /** استقبال ضرر؛ يعيد true إذا أدّى للطرح أو الموت */
  takeDamage(amount, opts = {}) {
    if (!this.alive || this.spawnProtect > 0 && !opts.ignoreProtect) return false;
    if (!(amount > 0)) return false;
    let dmg = amount;
    // الخوذة تمتصّ جزءًا من ضرر الرأس، والدرع يمتصّ جزءًا من كل ضرر (نفس أرقام نسخة Godot)
    if (opts.headshot && this.helmetLevel > 0) dmg *= 1 - [0, 0.15, 0.25, 0.35][clamp(this.helmetLevel, 0, 3)];
    if (this.armor > 0 && this.armorLevel > 0) {
      this.armorHit = 0.2;
      const absorb = dmg * [0, 0.3, 0.42, 0.55][clamp(this.armorLevel, 0, 3)];
      const taken = Math.min(this.armor, absorb);
      this.armor -= taken;
      dmg -= taken;
      if (this.armor <= 0.01) { this.armor = 0; this.armorLevel = 0; }
    }
    this.hp -= dmg;
    this.hitFlash = 0.18;
    this.lastDamageTime = opts.time || 0;
    if (opts.attacker) {
      this.lastHitBy = opts.attacker;
      this.damageLog = this.damageLog || [];
      if (opts.attacker !== this && !this.damageLog.includes(opts.attacker)) this.damageLog.push(opts.attacker);
    }
    if (this.hp <= 0) {
      this.hp = 0;
      if (opts.instantKill || this.team < 0) return this.die(opts);
      return this.enterDbno(opts);
    }
    return false;
  }

  enterDbno(opts = {}) {
    if (this.dbno) return false;
    this.dbno = true;
    this.dbnoTimer = 0;
    this.bleedOut = opts.bleedOut || CONFIG.dbnoTime;
    this.setState(STATE.DBNO);
    this.setHeight(CONFIG.proneHeight + 6);
    this.weapons.forEach((w) => { if (w) w.dropped = true; });
    return true;
  }

  die(opts = {}) {
    if (!this.alive) return true;
    this.alive = false;
    this.deaths++;
    this.dbno = false;
    this.setState(opts.variant != null ? `death${opts.variant}` : STATE.DEAD);
    this.deathTimer = 0;
    return true;
  }

  setState(s) {
    if (this.state !== s) {
      this.state = s;
      this.stateTimer = 0;
    }
  }

  // ------------------------------------------------------------- الحركة
  updateMovement(dt, world, cmd) {
    const c = cmd || {};
    const map = world.level.map;
    const wasGrounded = this.grounded;
    // القرفصاء/الانبطاح
    if (c.prone != null) {
      if (c.prone) { this.prone = !this.prone; this.crouch = false; }
    }
    if (c.crouch != null) {
      this.crouch = !!c.crouch;
      if (this.crouch) this.prone = false;
    }
    const targetH = this.prone ? CONFIG.proneHeight : this.crouch ? CONFIG.playerCrouchHeight : CONFIG.playerHeight;
    if (Math.abs(this.h - targetH) > 0.5) {
      const bottom = this.y + this.h;
      const dy = (bottom - targetH) - this.y;
      const res = moveAndCollide(map, this, 0, dy, { ignorePlatforms: true });
      if (res.hitY && targetH > this.h) {
        // لا يمكن الوقوف (سقف منخفض) → نبقى منبطحين/قرفصاء
        this.crouch = true;
        this.prone = this.prone;
      }
    }
    // الماء يبطئ
    const inWater = map.get(Math.floor(this.cx / TS), Math.floor((this.y + this.h * 0.6) / TS)) === T.WATER;
    const waterMul = inWater ? 0.55 : 1;
    // الحالة المزدحمة: انزلاق/تدحرج
    if (this.slideTimer > 0) {
      this.slideTimer -= dt;
      const dir = this.facing;
      this.vy += 0;
      this.vx = dir * CONFIG.slideSpeed * (0.5 + 0.5 * clamp(this.slideTimer / CONFIG.slideTime, 0, 1));
      this.setState(STATE.SLIDE);
    } else if (this.rollTimer > 0) {
      this.rollTimer -= dt;
      this.vx = this.facing * CONFIG.rollSpeed * (0.6 + 0.4 * clamp(this.rollTimer / CONFIG.rollTime, 0, 1));
      this.setState(STATE.ROLL);
    } else {
      // الحركة الأفقية العادية
      let wish = clamp(c.moveX || 0, -1, 1);
      if (this.isBot && c.autoRun) wish = this.facing;
      const isSprint = (c.sprint || (Math.abs(wish) > 0.65 && !this.ads)) && this.grounded && !this.prone && !this.crouch;
      let target = wish * (isSprint ? CONFIG.sprintSpeed : CONFIG.moveSpeed) * this.speedMul * waterMul;
      if (this.jetActive) target *= 1.08;
      const accel = this.grounded ? (isSprint ? 1900 : 1500) : CONFIG.airControl * 1400;
      const friction = this.grounded ? (this.prone ? 12 : 9) : 1.2;
      if (Math.abs(wish) > 0.05) {
        this.vx += clamp(target - this.vx, -accel * dt, accel * dt);
        if (Math.abs(wish) > 0.4) this.facing = wish > 0 ? 1 : -1;
      } else {
        this.vx = damp(this.vx, 0, friction, dt);
      }
    }
    // القفز والجيت باك
    this.jetActive = false;
    if (c.jump) {
      if (this.grounded || this.coyote > 0) {
        this.vy = -CONFIG.jumpSpeed;
        this.jumpsLeft = 1;
        this.grounded = false;
        this.coyote = 0;
        world.onActorEvent(this, 'jump');
      } else if (this.ledgeTile) {
        this.startClimb(world);
      } else if (this.jumpsLeft > 0) {
        this.vy = -CONFIG.doubleJumpSpeed;
        this.jumpsLeft--;
        this.jetFuel = Math.max(0, this.jetFuel - 6);
        world.onActorEvent(this, 'doubleJump');
      } else if (this.wallSlide > 0) {
        this.vy = -CONFIG.jumpSpeed * 0.92;
        this.vx = -this.facing * CONFIG.moveSpeed * 1.5;
        this.jumpsLeft = 1;
        world.onActorEvent(this, 'wallJump');
      }
    }
    // الجيت باك: استمرار الضغط في الهواء
    if (c.jet && !this.grounded && this.jetFuel > 0.5 && this.vy > -CONFIG.jetpackMaxRise) {
      this.vy -= CONFIG.jetpackForce * dt;
      this.jetFuel = Math.max(0, this.jetFuel - CONFIG.jetpackDrain * dt * (1 / (1 + (this.jetpackLevel - 1) * 0.25)));
      this.jetActive = true;
      this.setState(STATE.JET);
    }
    if (this.grounded) {
      this.jetFuel = Math.min(CONFIG.jetpackFuel, this.jetFuel + CONFIG.jetpackRefill * dt);
      this.jumpsLeft = 2;
      this.coyote = 0.12;
    } else {
      this.coyote = Math.max(0, this.coyote - dt);
    }
    // الجاذبية
    const gravity = inWater ? CONFIG.gravity * 0.35 : CONFIG.gravity;
    if (!this.jetActive) this.vy += gravity * dt;
    this.vy = clamp(this.vy, -CONFIG.maxFallSpeed * 1.1, CONFIG.maxFallSpeed * (inWater ? 0.4 : 1));
    // مقاومة الهواء (سقوط حر أسرع قليلًا — تحكم أدق)
    if (!this.grounded && !this.jetActive && Math.abs(c.moveX || 0) < 0.05) {
      this.vy = Math.min(this.vy + 40 * dt, CONFIG.maxFallSpeed);
    }
    // تصادم
    const res = moveAndCollide(map, this, this.vx * dt, this.vy * dt, { canStep: true });
    if (res.hitX) {
      const againstWall = Math.abs(this.vx) > 40;
      this.wallSlide = againstWall && !this.grounded ? 0.18 : Math.max(0, this.wallSlide - dt);
      this.vx = 0;
    } else {
      this.wallSlide = Math.max(0, this.wallSlide - dt);
    }
    if (res.grounded) {
      if (!wasGrounded && this.vy > 240) {
        world.onActorEvent(this, 'land', { speed: this.vy });
        if (this.vy > 520) {
          const dmg = (this.vy - 520) * 0.14;
          if (dmg > 5) this.takeDamage(dmg, { attacker: null, fall: true });
        }
      }
      this.vy = 0;
      this.grounded = true;
      this.airTime = 0;
    } else {
      this.grounded = false;
      this.airTime += dt;
    }
    if (res.hitY && this.vy < 0) this.vy = 0;
    // أثر الأقدام
    if (this.grounded && Math.abs(this.vx) > 25) {
      this.footstepTimer -= dt * (Math.abs(this.vx) / CONFIG.moveSpeed);
      if (this.footstepTimer <= 0) {
        this.footstepTimer = 0.42;
        world.onActorEvent(this, 'footstep', { water: inWater });
      }
    }
    // التشبّت بالحواف
    this.updateLedgeGrab(world, c);
    // حالة الأنيميشن
    if (!this.dbno && this.state !== STATE.CLIMB && this.state !== STATE.ROLL && this.state !== STATE.SLIDE) {
      if (this.vy < -30 && !this.jetActive) this.setState(STATE.JUMP);
      else if (this.jetActive) this.setState(STATE.JET);
      else if (!this.grounded) this.setState(STATE.FALL);
      else if (this.prone) this.setState(Math.abs(this.vx) > 12 ? STATE.CRAWL : STATE.PRONE);
      else if (Math.abs(this.vx) > CONFIG.moveSpeed * 1.25) this.setState(STATE.SPRINT);
      else if (Math.abs(this.vx) > 12) this.setState(STATE.RUN);
      else this.setState(STATE.IDLE);
    }
    // التصويب
    this.updateAim(c, dt);
    this.wasGrounded = wasGrounded;
  }

  updateAim(c, dt) {
    let target = this.aimAngle;
    const stickAim = c.aimActive && c.aimMag > 0.22;
    if (stickAim) {
      target = Math.atan2(c.aimY, c.aimX);
    } else if (c.tapTarget) {
      target = Math.atan2(c.tapTarget.y - this.cy, c.tapTarget.x - this.cx);
    } else if (c.aimX || c.aimY) {
      target = Math.atan2(c.aimY || 0, c.aimX || 1);
    } else if (this.isBot) {
      target = this.aimAngle;
    } else if (this.grounded) {
      // الافتراضي: أفقي في اتجاه الوجه مع ميل بسيط للحركة
      target = this.facing > 0 ? 0 : Math.PI;
    }
    if (Math.abs(c.moveY || 0) > 0.6 && !stickAim && !c.tapTarget) {
      target = this.facing > 0 ? Math.PI / 2 * Math.sign(c.moveY) : Math.PI - Math.PI / 2 * Math.sign(c.moveY);
    }
    const sens = (c.sensitivity || 1) * (this.ads ? 0.6 : 1);
    const speed = (stickAim || c.tapTarget) ? 16 * sens : 9;
    this.aimAngle = this.aimAngle + angleDelta(this.aimAngle, target) * clamp(speed * dt, 0, 1);
    this.aimAngle = normAngle(this.aimAngle);
    // الوجه يتبع التصويب عند التصويب النشط
    if (stickAim || c.tapTarget || this.isBot) {
      const a = this.aimAngle;
      if (Math.abs(Math.cos(a)) > 0.25) this.facing = Math.cos(a) > 0 ? 1 : -1;
    }
    this.ads = !!(c.ads);
    // ارتداد يتلاشى
    this.recoil.x = damp(this.recoil.x, 0, this.weapon ? this.weapon.recoilRecover : 8, dt);
    this.recoil.y = damp(this.recoil.y, 0, this.weapon ? this.weapon.recoilRecover : 8, dt);
  }

  updateLedgeGrab(world, c) {
    const map = world.level.map;
    this.ledgeTile = null;
    if (this.grounded || this.jetActive || this.state === STATE.CLIMB) return;
    const headY = this.y + 4;
    const tx1 = Math.floor((this.x - 2) / TS);
    const tx2 = Math.floor((this.x + this.w + 2) / TS);
    const ty = Math.floor(headY / TS);
    for (const tx of [tx1, tx2]) {
      if (map.isSolid(tx, ty + 1) && !map.isSolid(tx, ty) && !map.isSolid(tx, ty - 1)) {
        const dir = tx > Math.floor(this.cx / TS) ? 1 : -1;
        // التشبّت فقط إذا كنا نتحرك نحو الجدار أو نسقط
        if (dir === Math.sign(c.moveX || this.facing) || this.vy > 0) {
          this.ledgeTile = { tx, ty: ty + 1, dir };
          this.vy = Math.min(this.vy, 40);
          if (this.state !== STATE.LEDGE) this.setState(STATE.LEDGE);
          return;
        }
      }
    }
  }

  startClimb(world) {
    if (!this.ledgeTile) return;
    const map = world.level.map;
    const { tx, ty, dir } = this.ledgeTile;
    // نقل الجسم إلى أعلى الحافة
    const nx = dir > 0 ? (tx + 1) * TS + 2 : tx * TS - this.w - 2;
    this.x = clamp(nx, 0, map.w * TS - this.w - 1);
    this.setHeight(CONFIG.playerHeight);
    this.y = (ty - 1) * TS - this.h;
    this.vx = dir * 60;
    this.vy = -160;
    this.setState(STATE.CLIMB);
    this.stateTimer = 0;
    this.jumpsLeft = 2;
    world.onActorEvent(this, 'climb');
  }

  // ------------------------------------------------------------- القتال
  updateCombat(dt, world, cmd) {
    const c = cmd || {};
    if (this.reloadTimer > 0) {
      this.reloadTimer -= dt;
      if (this.reloadTimer <= 0) {
        this.reloading = false;
        const w = this.weapons[this.slot];
        if (w) {
          const need = w.stats.magSize - w.ammo;
          const have = this.ammo[w.stats.cls] != null ? this.ammo[w.stats.cls] : 999;
          const take = Math.min(need, have === 999 ? need : have);
          w.ammo += take;
          if (have !== 999) this.ammo[w.stats.cls] = have - take;
          world.onActorEvent(this, 'reloadEnd');
        }
      }
    }
    if (this.fireCooldown > 0) this.fireCooldown -= dt;
    if (this.muzzleFlash > 0) this.muzzleFlash -= dt;
    if (this.hitFlash > 0) this.hitFlash -= dt;
    if (this.spawnProtect > 0) this.spawnProtect -= dt;
    if (this.recoilKick > 0) this.recoilKick = Math.max(0, this.recoilKick - dt * 6);
    // تبديل السلاح
    if (c.swap != null && c.swap !== false && !isMelee(this.weaponId)) {
      if (typeof c.swap === 'number') {
        const idx = c.swap - 1;
        if (this.weapons[idx]) this.slot = idx;
      } else {
        this.slot = (this.slot + 1) % 2;
      }
      this.reloading = false;
      this.reloadTimer = 0;
      world.onActorEvent(this, 'switch');
      this.setState(STATE.IDLE);
      this.fireCooldown = Math.max(this.fireCooldown, 0.25);
    }
    // إعادة التعمير
    const w = this.weapons[this.slot];
    if (c.reload && w && !this.reloading && w.ammo < w.stats.magSize && w.stats.magSize > 0) {
      this.reloading = true;
      this.reloadTimer = w.stats.reload;
      this.setState(STATE.RELOAD);
      world.onActorEvent(this, 'reloadStart', { weapon: w.id });
    }
    // الدواء
    if (c.heal && !this.dbno && this.hp < this.maxHp) {
      const kind = this.heals.medkit > 0 ? 'medkit' : this.heals.bandage > 0 ? 'bandage' : null;
      if (kind && !this.healing) {
        this.healing = { kind, t: kind === 'medkit' ? 6 : 3 };
        this.heals[kind]--;
        this.setState(STATE.HEAL);
      }
    }
    if (this.healing) {
      this.healing.t -= dt;
      this.vx *= 0.9;
      if (this.healing.t <= 0) {
        this.heal(this.healing.kind === 'medkit' ? 100 : 22);
        world.onActorEvent(this, 'heal', { kind: this.healing.kind });
        this.healing = null;
      }
    }
    // الإطلاق
    const canFire = c.fire && !this.reloading && !this.dbno && this.alive && this.fireCooldown <= 0 && !this.healing;
    if (canFire) this.fire(world, c);
    if (!c.fire && this.shotIndex > 0 && this.fireCooldown <= 0.06) {
      // إعادة ضبط نمط الارتداد بعد توقف الرش
      this.shotIndex = 0;
    }
    // القنبلة
    if (c.grenade && (!this.throwCooldown || this.throwCooldown <= 0)) {
      if (this.throwable.count > 0 && !this.dbno) {
        this.throwable.count--;
        this.throwCooldown = 0.9;
        this.setState(STATE.THROW);
        this.stateTimer = 0;
        world.spawnThrowable(this, this.throwable.id);
      }
    }
    if (this.throwCooldown > 0) this.throwCooldown -= dt;
    // المشاجرة
    if (c.melee && (!this.meleeCooldown || this.meleeCooldown <= 0) && !this.dbno) {
      this.meleeCooldown = 0.7;
      this.setState(STATE.MELEE);
      this.stateTimer = 0;
      world.performMelee(this, this.melee, this.weaponId);
    }
    if (this.meleeCooldown > 0) this.meleeCooldown -= dt;
    // تغيير المخزن عند نفاد الذخيرة
    if (w && w.ammo <= 0 && !this.reloading) {
      const other = this.weapons[1 - this.slot];
      if (other && other.ammo > 0) this.slot = 1 - this.slot;
      else if (w.stats.magSize > 0) {
        this.reloading = true;
        this.reloadTimer = w.stats.reload;
        world.onActorEvent(this, 'reloadStart', { weapon: w.id });
      }
    }
  }

  fire(world, cmd) {
    const w = this.weapons[this.slot];
    if (!w) {
      // بلا سلاح → مشاجرة
      if (this.meleeCooldown == null || this.meleeCooldown <= 0) {
        this.meleeCooldown = 0.7;
        world.performMelee(this, this.melee, null);
      }
      return;
    }
    const st = w.stats;
    if (st.cls === 'melee') {
      if (this.meleeCooldown == null || this.meleeCooldown <= 0) {
        this.meleeCooldown = 0.6;
        world.performMelee(this, w.id, w.id);
      }
      return;
    }
    if (w.ammo <= 0) {
      world.onActorEvent(this, 'dryFire');
      this.fireCooldown = 0.25;
      return;
    }
    this.fireCooldown = st.fireDelay;
    w.ammo--;
    this.shotsFired++;
    this.weaponShots[w.id] = (this.weaponShots[w.id] || 0) + 1;
    this.setState(STATE.IDLE);
    this.muzzleFlash = 0.06;
    this.recoilKick = 1;
    // الارتداد: نمط ثابت لكل سلاح + عشوائية صغيرة
    const rec = recoilOffset(this.shotIndex, w.id);
    this.recoil.x += rec.x * 0.01;
    this.recoil.y += rec.y * 0.006;
    this.shotIndex++;
    const aim = this.computeAim(true);
    const spread = currentSpread({
      prone: this.prone, crouch: this.crouch, grounded: this.grounded,
      vx: this.vx, vy: this.vy, ads: this.ads,
    }, st, this.shotIndex);
    const pellets = st.pellets || 1;
    const muzzle = aim.muzzle;
    for (let i = 0; i < pellets; i++) {
      const jitter = (world.rng.next() - 0.5) * 2 * spread * (pellets > 1 ? 2.6 : 1);
      const ang = aim.angle + jitter + this.recoil.x;
      if (st.projectile) {
        world.spawnProjectile(this, {
          x: muzzle.x, y: muzzle.y, angle: ang, weapon: st, weaponId: w.id,
        });
      } else {
        world.hitscanShot(this, muzzle.x, muzzle.y, ang, st, w.id);
      }
    }
    world.onActorEvent(this, 'shoot', { weapon: w.id, cls: st.cls });
  }

  /** حساب زاوية ونقطة الفوهة مع الارتداد الحالي */
  computeAim(withRecoil = false) {
    const a = this.aimAngle + (withRecoil ? this.recoil.y * 0.55 : 0);
    const eyeY = this.y + (this.prone ? 8 : this.crouch ? 18 : 24);
    const hand = { x: this.cx + Math.cos(a) * 14, y: eyeY + 2 + Math.sin(a) * 10 };
    const muzzleDist = 26;
    return {
      angle: normAngle(a),
      hand,
      muzzle: { x: hand.x + Math.cos(a) * muzzleDist, y: hand.y + Math.sin(a) * muzzleDist },
    };
  }

  // ------------------------------------------------------------- التحديث
  update(dt, world, cmd) {
    this.stateTimer += dt;
    if (!this.alive) {
      this.deathTimer += dt;
      return;
    }
    if (this.dbno) {
      this.dbnoTimer += dt;
      if (this.dbnoTimer > this.bleedOut) {
        this.die({ variant: 2 });
        return;
      }
      // زحف بطيء
      const c = cmd || {};
      this.vx = damp(this.vx, clamp(c.moveX || 0, -1, 1) * 26, 6, dt);
      this.vy += CONFIG.gravity * dt;
      const res = moveAndCollide(world.level.map, this, this.vx * dt, this.vy * dt, {});
      if (res.grounded) this.vy = 0;
      this.grounded = res.grounded;
      this.setState(STATE.DBNO);
      this.updateAim(c, dt);
      return;
    }
    this.survivalTime += dt;
    const c = cmd || {};
    // بدء الانزلاق والتدحرج
    if (c.roll && this.grounded && this.rollTimer <= 0 && this.slideTimer <= 0) {
      if (Math.abs(this.vx) > CONFIG.moveSpeed * 1.1 && c.sprint) {
        this.slideTimer = CONFIG.slideTime;
        this.setHeight(CONFIG.playerCrouchHeight);
      } else {
        this.rollTimer = CONFIG.rollTime;
        this.setHeight(CONFIG.playerCrouchHeight + 6);
      }
    }
    if (this.slideTimer <= 0 && this.rollTimer <= 0) {
      const targetH = this.prone ? CONFIG.proneHeight : this.crouch ? CONFIG.playerCrouchHeight : CONFIG.playerHeight;
      if (this.h < targetH - 0.5 && this.h !== CONFIG.playerCrouchHeight + 6) {
        // استعادة الارتفاع تدريجيًا
        this.setHeight(Math.min(targetH, this.h + 120 * dt));
      }
    }
    this.updateMovement(dt, world, c);
    this.updateCombat(dt, world, c);
  }

  /** الأشياء التي تُسقط عند الموت */
  dropLoot() {
    const drops = [];
    for (const w of this.weapons) if (w) drops.push({ kind: 'weapon', id: w.id, ammo: w.ammo, attachments: w.attachments });
    if (this.armorLevel > 0) drops.push({ kind: 'armor', level: this.armorLevel });
    if (this.helmetLevel > 0) drops.push({ kind: 'helmet', level: this.helmetLevel });
    if (this.backpackLevel > 0) drops.push({ kind: 'backpack', level: this.backpackLevel });
    if (this.heals.medkit > 0) drops.push({ kind: 'medkit', count: this.heals.medkit });
    if (this.heals.bandage > 0) drops.push({ kind: 'bandage', count: this.heals.bandage });
    if (this.throwable.count > 0) drops.push({ kind: 'grenade', count: this.throwable.count });
    return drops;
  }
}

// ---------------------------------------------------------------- البوتات
export const DIFFICULTY = [
  { key: 0, nameAr: 'سهل', accuracy: 0.35, reaction: 0.55, aggression: 0.5, cover: 0.3, awareness: 0.4, jet: 0.3 },
  { key: 1, nameAr: 'متوسط', accuracy: 0.55, reaction: 0.38, aggression: 0.65, cover: 0.5, awareness: 0.6, jet: 0.5 },
  { key: 2, nameAr: 'صعب', accuracy: 0.72, reaction: 0.26, aggression: 0.75, cover: 0.7, awareness: 0.75, jet: 0.7 },
  { key: 3, nameAr: 'خبير', accuracy: 0.86, reaction: 0.17, aggression: 0.85, cover: 0.85, awareness: 0.9, jet: 0.85 },
  { key: 4, nameAr: 'كابوس', accuracy: 0.95, reaction: 0.1, aggression: 0.95, cover: 0.95, awareness: 1.0, jet: 1.0 },
];

export const BOT_NAMES = [
  'ظل الصحراء', 'رعد', 'صقر الليل', 'خنجر', 'عاصفة', 'غبار', 'نجم الشمال', 'حديد',
  'برق', 'ذئب', 'عقرب', 'شبح', 'حارس', 'سهم', 'فهد', 'جبل', 'شرارة', 'ملّاح',
  'قنّاص', 'قمر', 'ريح', 'فولاذ', 'نمر', 'خفاش',
];

export class Bot extends Actor {
  constructor(x, y, opts = {}) {
    super(x, y, { ...opts, isBot: true });
    this.type = 'bot';
    this.diff = DIFFICULTY[clamp(opts.difficulty != null ? opts.difficulty : 1, 0, 4)];
    this.ai = {
      state: 'patrol', target: null, targetSeen: 0, lastSeen: null, reactionTimer: 0,
      patrolDir: 1, patrolTimer: 0, coverTimer: 0, throwTimer: rngBotRange(opts.seed || 3, 3, 12),
      jumpTimer: 0, aimError: 0, aimTarget: 0, stuckTimer: 0, lastX: x, navGoal: null,
      lootTimer: 0, reviveTarget: null, retreating: false, hearingTimer: 0, hearPos: null,
      climbTimer: 0, stuckDir: 1, huntTarget: null,
    };
    this.rngSeed = (opts.seed || 7) * 7919;
    this.rng = new RNG(this.rngSeed);
    this.thinkTimer = 0;
  }

  update(dt, world, cmdIgnored) {
    if (!this.alive) {
      this.deathTimer += dt;
      return;
    }
    const cmd = this.think(dt, world);
    super.update(dt, world, cmd);
  }

  /** يبني أوامر اللعب من عقله (نفس واجهة اللاعب → نفس الفيزياء) */
  think(dt, world) {
    const ai = this.ai;
    const map = world.level.map;
    const cmd = {
      moveX: 0, moveY: 0, jet: false, jump: false, fire: false, reload: false,
      crouch: false, prone: false, grenade: false, heal: false, melee: false,
      aimX: 0, aimY: 0, aimActive: true, aimMag: 1, ads: false, sprint: true, roll: false,
    };
    this.thinkTimer -= dt;
    // اختيار هدف: أقرب عدو مرئي
    const enemy = world.findVisibleEnemy(this, 1500);
    if (enemy) {
      ai.state = 'combat';
      ai.target = enemy;
      ai.lastSeen = { x: enemy.cx, y: enemy.cy };
      ai.targetSeen = 1.2;
      ai.reactionTimer -= dt;
      if (ai.reactionTimer <= 0) {
        // تصويب مع خطأ حسب الصعوبة + استباق الحركة
        const lead = clamp(0.12 + (1 - this.diff.accuracy) * 0.25, 0.05, 0.4);
        const px = enemy.cx + enemy.vx * lead;
        const py = enemy.cy + enemy.vy * lead * 0.6;
        const a = Math.atan2(py - this.cy, px - this.cx);
        const err = (1 - this.diff.accuracy) * 0.32 * (1 + (enemy.jetActive ? 0.6 : 0));
        ai.aimTarget = a + (this.rng.next() - 0.5) * err;
        cmd.aimX = Math.cos(ai.aimTarget);
        cmd.aimY = Math.sin(ai.aimTarget);
        cmd.aimMag = 1;
        cmd.fire = this.canSee(enemy, world) && this.rng.next() < 0.15 + this.diff.aggression * 0.85;
        cmd.ads = world.distance(this, enemy) > 320 && this.rng.next() < 0.6;
      }
      // سلوك قتالي
      const d = world.distance(this, enemy);
      if (this.hp < 40 && this.diff.cover > 0.4 && this.rng.next() < 0.4) ai.retreating = true;
      if (ai.retreating && this.hp > 65) ai.retreating = false;
      if (ai.retreating) {
        cmd.moveX = this.facing * -1;
        cmd.fire = d < 200 && this.rng.next() < 0.4;
      } else if (d > 460) {
        cmd.moveX = Math.sign(enemy.cx - this.cx);
        cmd.jet = this.grounded === false && this.vy > 0 && this.rng.next() < this.diff.jet;
        cmd.jump = this.grounded && this.rng.next() < 0.03;
      } else if (d < 90) {
        cmd.moveX = -Math.sign(enemy.cx - this.cx) * 0.6;
      } else {
        cmd.moveX = Math.sin(world.time * 1.7 + this.id) * 0.7;
      }
      if (this.grounded && enemy.cy < this.y - 40 && this.diff.jet > 0.4 && this.rng.next() < this.diff.jet * 0.35) {
        cmd.jet = true;
      }
      // قنابل على المسافات المتوسطة
      ai.throwTimer -= dt;
      if (ai.throwTimer <= 0 && this.throwable.count > 0 && d > 120 && d < 420 && this.canSee(enemy, world)) {
        cmd.grenade = true;
        ai.throwTimer = this.rng.range(6, 16);
      }
      if (this.weapons[this.slot] && this.weapons[this.slot].ammo <= 0) cmd.reload = true;
      if (this.hp < 45 && (this.heals.medkit > 0 || this.heals.bandage > 0) && d > 260) cmd.heal = true;
      // تصويب لأعلى/لأسفل عند الحاجة
      if (Math.abs(cmd.aimY) > 0.5) cmd.moveY = cmd.aimY > 0 ? 0 : -1;
    } else {
      ai.target = null;
      ai.targetSeen = Math.max(0, ai.targetSeen - dt);
      ai.reactionTimer = this.diff.reaction;
      // دورية: السير في الاتجاه مع القفز على العوائق
      // --- مطاردة: نتحرك نحو أقرب عدو حتى لو لم نره (يمنع مباريات بلا اشتباك) ---
      ai.huntTimer = (ai.huntTimer || 0) - dt;
      const hunt = world.nearestHostile ? world.nearestHostile(this) : null;
      if (ai.hearPos) {
        const dx = ai.hearPos.x - this.cx;
        cmd.moveX = Math.sign(dx);
        if (Math.abs(dx) < 60) { ai.hearPos = null; }
      } else if (hunt) {
        ai.state = 'hunt';
        ai.huntTarget = hunt;
        const dx = hunt.cx - this.cx;
        const dy = hunt.cy - this.cy;
        // ميل بسيط لكل بوت حتى لا يتكدّسوا على خط واحد
        const bias = ((this.id * 977) % 100 / 100 - 0.5) * 0.25;
        const want = Math.sign(Math.abs(dx) > 24 ? dx : (this.rng.next() - 0.5) + bias);
        cmd.moveX = want;
        // الجيت باك للوصول للأعلى أو تجاوز العوائق
        if (dy < -46 && this.grounded && this.jetFuel > 12) cmd.jet = true;
        if (dx > -40 && dx < 40 && Math.abs(dy) > 60) cmd.jump = this.grounded;
        cmd.sprint = true;
      } else {
        ai.state = 'patrol';
        ai.patrolTimer -= dt;
        if (ai.patrolTimer <= 0) {
          ai.patrolDir = this.rng.next() < 0.5 ? -1 : 1;
          ai.patrolTimer = this.rng.range(1.5, 4.5);
        }
        cmd.moveX = ai.patrolDir;
      }
      cmd.aimX = this.facing;
      cmd.aimY = 0.12;
      // الذهاب إلى الغنائم القريبة (الأولوية للغنائم القريبة جدًا فقط كي لا نترك المطاردة)
      const loot = world.findLootNear(this, hunt ? 190 : 400);
      if (loot) {
        cmd.moveX = Math.sign(loot.cx - this.cx);
        if (world.distance(this, loot) < 30) world.pickupFor(this, loot);
      }
      // إنعاش زميل
      const rev = world.findDbnoTeammate(this, 220);
      if (rev) {
        ai.reviveTarget = rev;
        cmd.moveX = Math.sign(rev.cx - this.cx);
        if (world.distance(this, rev) < 26) {
          world.reviveTick(this, rev, dt * 1.2);
          cmd.moveX = 0;
        }
      }
      if (this.weapons[this.slot] && this.weapons[this.slot].ammo < this.weapons[this.slot].stats.magSize * 0.4) {
        cmd.reload = true;
      }
      cmd.sprint = this.rng.next() < 0.6;
      cmd.fire = false;
    }
    // --- معالج العلَق المشترك: قفزة ← جيت باك (تجاوز الجدار) ← انعكاس الاتجاه ---
    // يعمل في كل الحالات (قتال/مطاردة/دورية) وحتى إن لم يكن البوت واقفًا على الأرض،
    // وهو ما يمنع بقاء البوتات تدفع في جدار طوال المباراة (مباريات بلا اشتباك).
    if (ai.climbTimer > 0) {
      ai.climbTimer -= dt;
      cmd.jet = true;              // صعود بالجيت باك فوق العائق
      cmd.moveX = 0;
      if (ai.climbTimer <= 0) { ai.climbTimer = 0; cmd.moveX = ai.stuckDir || 1; }
    } else {
      const movingIntent = Math.abs(cmd.moveX) > 0.25;
      const movedX = Math.abs(this.x - ai.lastX);
      ai.lastX = this.x;
      if (movingIntent && movedX < 2.5) ai.stuckTimer += dt;
      else ai.stuckTimer = Math.max(0, ai.stuckTimer - dt * 2.0);
      if (ai.stuckTimer > 0.35) cmd.jump = true;
      if (ai.stuckTimer > 0.95) {
        ai.climbTimer = 0.8;
        ai.stuckDir = ai.huntTarget && ai.huntTarget.alive
          ? (Math.sign(ai.huntTarget.cx - this.cx) || 1)
          : -(Math.sign(cmd.moveX) || 1);
        ai.stuckTimer = 0;
      }
    }
    this.lastCmd = cmd;
    return cmd;
  }

  canSee(other, world) {
    if (!other || !other.alive) return false;
    const r = world.level.map.raycast(this.cx, this.cy - 8, other.cx, other.cy - 8);
    return !r.hit;
  }
}

function rngBotRange(seed, a, b) {
  const r = new RNG(seed * 131);
  return r.range(a, b);
}

// ---------------------------------------------------------------- الرصاص والقنابل
export class Projectile extends Entity {
  constructor() {
    super(0, 0, 6, 6);
    this.active = false;
  }
  spawn(opts) {
    this.x = opts.x - 3; this.y = opts.y - 3;
    this.w = opts.size || 6; this.h = opts.size || 6;
    this.vx = Math.cos(opts.angle) * opts.speed;
    this.vy = Math.sin(opts.angle) * opts.speed;
    this.angle = opts.angle;
    this.owner = opts.owner;
    this.weapon = opts.weapon;
    this.weaponId = opts.weaponId;
    this.life = opts.life || 3.2;
    this.gravity = opts.gravity ? (opts.weapon.gravity ? 900 : 900) : 0;
    this.bounce = opts.bounce || 0;
    this.splash = opts.splash || 0;
    this.splashDamage = opts.splashDamage || 0;
    this.kind = opts.kind || 'bullet';
    this.active = true;
    this.alive = true;
    this.trail = [];
    this.armed = this.kind === 'grenade' ? 0.55 : 0.05;
    return this;
  }
  update(dt, world) {
    if (!this.active) return;
    this.life -= dt;
    if (this.life <= 0) { this.explode(world); return; }
    this.armed = Math.max(0, this.armed - dt);
    if (this.gravity) this.vy += this.gravity * dt;
    const steps = Math.max(1, Math.ceil(Math.hypot(this.vx * dt, this.vy * dt) / 5));
    for (let s = 0; s < steps; s++) {
      const nx = this.x + this.vx * dt / steps;
      const ny = this.y + this.vy * dt / steps;
      // تصادم مع الكيانات
      if (this.armed <= 0 && this.kind !== 'flare') {
        for (const e of world.actors) {
          if (!e.alive || e === this.owner || e.hp <= 0) continue;
          if (world.friendlyFire === false && e.team === this.owner.team) continue;
          if (nx + this.w > e.x && nx < e.x + e.w && ny + this.h > e.y && ny < e.y + e.h) {
            world.applyProjectileHit(this, e, { x: nx, y: ny });
            return;
          }
        }
      }
      // تصادم مع التضاريس
      const hitSolid = world.level.map.isSolidAt(nx + this.w / 2, ny + this.h / 2);
      if (hitSolid) {
        if (this.bounce > 0 && this.kind === 'grenade') {
          // ارتداد بسيط: نعكس الزاوية حسب المحور المصطدم
          const testX = world.level.map.isSolidAt(nx + this.w / 2 + Math.sign(this.vx) * 2, this.y + this.h / 2);
          const testY = world.level.map.isSolidAt(this.x + this.w / 2, ny + this.h / 2 + Math.sign(this.vy) * 2);
          if (testX) this.vx *= -0.55;
          if (testY) { this.vy *= -0.55; this.vx *= 0.8; }
          break;
        }
        world.onProjectileImpact(this, nx, ny);
        this.explode(world);
        return;
      }
      this.x = nx; this.y = ny;
    }
    if (this.trail.length < 8) this.trail.push({ x: this.cx, y: this.cy });
    else { this.trail.shift(); this.trail.push({ x: this.cx, y: this.cy }); }
    // ضرر الحرق للشمعة
    if (this.kind === 'flare' && this.armed <= 0) {
      world.areaDamage(this.cx, this.cy, 30, 12 * dt, this.owner, { burn: true });
    }
  }
  explode(world) {
    if (!this.active) return;
    this.active = false;
    if (this.splash > 0) {
      world.explode(this.cx, this.cy, this.splash, this.splashDamage, this.owner, {
        weaponId: this.weaponId, grenade: this.kind === 'grenade',
      });
    }
  }
}

// ---------------------------------------------------------------- الغنائم
export class Pickup extends Entity {
  constructor() {
    super(0, 0, 22, 18);
    this.active = false;
  }
  spawn(x, y, data) {
    this.x = x; this.y = y;
    this.data = data;
    this.active = true;
    this.alive = true;
    this.bob = Math.random() * TAU;
    this.life = data.kind === 'airdrop' ? 999 : 300;
    this.crate = data.kind === 'airdrop' || data.kind === 'crate';
    return this;
  }
  get label() {
    const d = this.data;
    switch (d.kind) {
      case 'weapon': return WEAPONS[d.id] ? WEAPONS[d.id].nameAr : d.id;
      case 'armor': return `درع ${d.level}`;
      case 'helmet': return `خوذة ${d.level}`;
      case 'backpack': return `حقيبة ${d.level}`;
      case 'medkit': return 'حقيبة إسعاف';
      case 'bandage': return 'ضمادة';
      case 'adrenaline': return 'أدرينالين';
      case 'jetfuel': return 'وقود جيت باك';
      case 'ammo': return `ذخيرة ${d.cls || ''}`;
      case 'grenade': return 'قنبلة';
      default: return 'غنيمة';
    }
  }
  update(dt, world) {
    if (!this.active) return;
    this.life -= dt;
    this.bob += dt * 2.2;
    if (this.life <= 0) this.active = false;
    // هبوط بسيط بالجاذبية
    if (this.crate && !this.landed) {
      this.vy = (this.vy || 0) + 420 * dt;
      const res = moveAndCollide(world.level.map, this, 0, this.vy * dt, {});
      if (res.grounded) { this.landed = true; this.vy = 0; }
      else this.y += this.vy * dt * 0;
    }
  }
}

// ---------------------------------------------------------------- المركبات
export class Vehicle extends Entity {
  constructor(type, x, y) {
    super(x, y, type === 'bike' ? 46 : 34, type === 'bike' ? 24 : 30);
    this.vtype = type;
    this.driver = null;
    this.gunner = null;
    this.hp = 220;
    this.angle = 0;
    this.speed = 0;
    this.revealRadius = type === 'drone' ? 320 : 0;
    this.flightAlt = 0;
    this.cooldown = 0;
    this.active = true;
  }
  get label() {
    return { mg: 'مدفع رشاش ثابت', bike: 'دراجة سريعة', drone: 'طائرة استطلاع' }[this.vtype] || 'مركبة';
  }
  update(dt, world) {
    if (this.vtype === 'mg') {
      this.cooldown = Math.max(0, this.cooldown - dt);
      if (this.gunner && this.gunner.alive) {
        this.gunner.x = this.x + 4;
        this.gunner.y = this.y - 6;
        this.gunner.angle = this.gunner.aimAngle;
      }
    } else if (this.vtype === 'bike') {
      if (this.driver && this.driver.alive) {
        const d = this.driver;
        d.x = this.x + 6;
        d.y = this.y - d.h + 14;
        // قيادة: الحركة بالعجلة
        this.speed = damp(this.speed, d.vx * 1.05, 4, dt);
        const res = moveAndCollide(world.level.map, this, this.speed * dt, 0, {});
        if (res.hitX) this.speed *= -0.2;
        this.vy += CONFIG.gravity * dt;
        const resY = moveAndCollide(world.level.map, this, 0, this.vy * dt, {});
        if (resY.grounded) this.vy = 0;
        if (d.vy < -100) this.vy = d.vy * 0.7;      // قفزة الدراجة
      } else {
        this.speed = damp(this.speed, 0, 3, dt);
      }
    } else if (this.vtype === 'drone') {
      // مسيّرة استطلاع: تحوّم وتكشف الأعداء
      this.vy = damp(this.vy, 0, 4, dt);
      if (this.driver && this.driver.alive) {
        this.x = damp(this.x, this.driver.cx + this.driver.facing * 60, 3, dt);
        this.y = damp(this.y, this.driver.cy - 70, 3, dt);
      }
    }
  }
}

// ---------------------------------------------------------------- المنطقة الآمنة
export class SafeZone {
  constructor(cx, cy, radius, opts = {}) {
    this.cx = cx; this.cy = cy; this.radius = radius;
    this.startRadius = radius;
    this.targetRadius = opts.targetRadius || radius * 0.4;
    this.targetCx = opts.targetCx != null ? opts.targetCx : cx;
    this.targetCy = opts.targetCy != null ? opts.targetCy : cy;
    this.phase = 0;
    this.timeLeft = opts.firstDelay != null ? opts.firstDelay : 40;
    this.shrinking = false;
    this.shrinkSpeed = opts.shrinkSpeed || 7;
    this.dps = opts.dps || 1.5;
    this.phaseCount = opts.phases || 6;
    this.waitTime = opts.waitTime || 30;
    this.active = true;
  }
  contains(x, y) {
    return Math.hypot(x - this.cx, y - this.cy) <= this.radius;
  }
  update(dt, world) {
    if (!this.active) return;
    if (this.phase >= this.phaseCount) return;
    this.timeLeft -= dt;
    if (!this.shrinking) {
      if (this.timeLeft <= 0) {
        this.shrinking = true;
        this.startRadius = this.radius;
        this.targetRadius = Math.max(70, this.radius * 0.62);
        const a = world.rng.range(0, TAU);
        const d = Math.max(0, this.radius - this.targetRadius) * 0.5;
        this.targetCx = this.cx + Math.cos(a) * d;
        this.targetCy = this.cy + Math.sin(a) * d * 0.5;
        this.shrinkTime = Math.max(8, (this.startRadius - this.targetRadius) / this.shrinkSpeed);
        this.shrinkTimer = this.shrinkTime;
      }
    } else {
      const t = 1 - clamp(this.shrinkTimer / this.shrinkTime, 0, 1);
      this.radius = this.startRadius + (this.targetRadius - this.startRadius) * t;
      this.cx = this.cx + (this.targetCx - this.cx) * dt * 0.4;
      this.cy = this.cy + (this.targetCy - this.cy) * dt * 0.4;
      this.shrinkTimer -= dt;
      if (this.shrinkTimer <= 0) {
        this.shrinking = false;
        this.phase++;
        this.timeLeft = this.waitTime;
        this.dps += 1.2;
      }
    }
    // ضرر خارج المنطقة
    for (const a of world.actors) {
      if (!a.alive || a.dbno) continue;
      if (!this.contains(a.cx, a.cy)) {
        a.zoneDamage = (a.zoneDamage || 0) + dt;
        if (a.zoneDamage > 0.5) {
          a.zoneDamage = 0;
          a.takeDamage(this.dps * 0.5, { ignoreProtect: true, zone: true, instantKill: true });
        }
      }
    }
  }
  get nextShrinkIn() {
    return this.shrinking ? this.shrinkTimer : this.timeLeft;
  }
}

// ---------------------------------------------------------------- الإسقاط الجوي
export class Airdrop {
  constructor(x, y, planeDir = 1) {
    this.x = x - planeDir * 900;
    this.y = y - 260;
    this.targetX = x;
    this.targetY = y;
    this.vx = planeDir * 190;
    this.state = 'flying';
    this.chute = 0;
    this.crate = null;
    this.planeY = y - 260;
  }
  update(dt, world) {
    if (this.state === 'flying') {
      this.x += this.vx * dt;
      if ((this.vx > 0 && this.x >= this.targetX) || (this.vx < 0 && this.x <= this.targetX)) {
        this.state = 'falling';
      }
    } else if (this.state === 'falling') {
      this.chute = Math.min(1, this.chute + dt * 2);
      const fall = 90 - this.chute * 55;
      this.y += fall * dt;
      this.x += this.vx * 0.15 * dt;
      if (!this.crate) {
        this.crate = world.spawnPickup(this.x, this.y, {
          kind: 'airdrop', tier: 3, opened: false,
        });
      } else {
        this.crate.x = this.x; this.crate.y = this.y;
      }
      if (this.y >= this.targetY) {
        this.state = 'landed';
        this.crate.x = this.x;
        this.crate.y = this.y - 12;
      }
    }
  }
}
