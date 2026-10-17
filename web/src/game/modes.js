// ============================================================================
// أوضاع اللعب — 18 وضعًا (15 من الجدول + 3 من اختراعنا — القسم 8)
// كل وضع = قواعد + فحص فوز + تحديثات خاصة.
// ============================================================================

import { clamp, dist, TAU, RNG } from '../core/math.js';
import { WEAPONS } from './weapons.js';

const ALL = 'all';

export const MODES = {
  // 1) معركة البقاء (Battle Royale)
  br: {
    id: 'br', nameAr: 'معركة البقاء', descAr: '12 مقاتلًا، إنزال بالمظلة، منطقة تتقلّص، آخر من يبقى يفوز.',
    teams: 1, teamMode: 'solo', respawn: false, loadout: 'br', loot: true, zone: true,
    dbno: true, airdrops: true, map: 'valleys', timeLimit: 900, vehicle: true,
    icon: 'star', squadSize: 1, zoneDelay: 50, zoneWait: 32, zonePhases: 7,
  },
  // 2) الكل ضد الكل
  dm: {
    id: 'dm', nameAr: 'الكل ضد الكل', descAr: 'أول من يصل إلى 50 قتلة يفوز.',
    teams: 1, respawn: true, loadout: 'standard', loot: false, scoreLimit: 50,
    dbno: false, map: 'oasis', timeLimit: 480, icon: 'skull',
  },
  // 3) فريق ضد فريق
  tdm: {
    id: 'tdm', nameAr: 'فريق ضد فريق', descAr: 'فريقان حتى 75 قتلة.',
    teams: 2, respawn: true, loadout: 'standard', scoreLimit: 75, dbno: true,
    map: 'ruinedcity', timeLimit: 600, icon: 'team', teamSpawns: true,
  },
  // 4) زرع وتفجير
  snd: {
    id: 'snd', nameAr: 'زرع وتفجير', descAr: 'فريقان، 7 جولات: زرع القنبلة أو تفكيكها، بلا إحياء.',
    teams: 2, respawn: false, loadout: 'standard', rounds: 7, dbno: false,
    map: 'nightbase', timeLimit: 120, icon: 'warning', teamSpawns: true,
  },
  // 5) استيلاء على العلم
  ctf: {
    id: 'ctf', nameAr: 'الاستيلاء على العلم', descAr: 'اسرق علم العدو وأعده لقاعدتك.',
    teams: 2, respawn: true, loadout: 'standard', scoreLimit: 5, dbno: true,
    map: 'bridge', timeLimit: 720, icon: 'flag', teamSpawns: true,
  },
  // 6) ملك التل
  kotc: {
    id: 'kotc', nameAr: 'ملك التل', descAr: 'سيطروا على المنطقة المتحركة حتى 300 نقطة.',
    teams: 2, respawn: true, loadout: 'standard', scoreLimit: 300, dbno: true,
    map: 'factory', timeLimit: 600, icon: 'crown', teamSpawns: true,
  },
  // 7) سباق الأسلحة
  gun: {
    id: 'gun', nameAr: 'سباق الأسلحة', descAr: 'ترقية تلقائية للسلاح مع كل قتلة — السكين أخيرًا.',
    teams: 1, respawn: true, loadout: 'none', gunGame: true, dbno: false,
    map: 'village', timeLimit: 600, icon: 'star',
    gunGameLadder: ['n9', 'scorpion', 'zarqa', 'harrasa', 'timsah', 'mitraqa', 'jabha', 'fahd',
      'uqab', 'minjal', 'raad', 'shuaa', 'shaheen', 'shafra'],
  },
  // 8-10) أوضاع أسلحة مقيدة
  snipers: {
    id: 'snipers', nameAr: 'القنّاصة فقط', descAr: 'لا شيء إلا بنادق القنص.',
    teams: 2, respawn: true, loadout: 'standard', weaponPool: ['shaheen', 'uqab', 'thuban'],
    dbno: true, map: 'ruinedcity', timeLimit: 480, icon: 'sniper', teamSpawns: true,
  },
  meleeOnly: {
    id: 'meleeOnly', nameAr: 'المشاجرة فقط', descAr: 'سكاكين وفؤوس وسواطير. لا رصاص.',
    teams: 1, respawn: true, loadout: 'none', weaponPool: ['shafra', 'fas', 'minjal_melee', 'hirrawa'],
    dbno: false, map: 'village', timeLimit: 420, icon: 'melee',
  },
  pistols: {
    id: 'pistols', nameAr: 'المسدسات فقط', descAr: 'مسدسات وذخيرة لا نهائية.',
    teams: 2, respawn: true, loadout: 'standard', weaponPool: ['n9', 'scorpion', 'handcannon'],
    dbno: true, map: 'port', timeLimit: 420, icon: 'pistol', teamSpawns: true,
  },
  // 11) العدوى
  infection: {
    id: 'infection', nameAr: 'العدوى', descAr: 'واحد زومبي يعدي البقية. آخر الناجين يفوز.',
    teams: 2, respawn: true, loadout: 'standard', infection: true, dbno: false,
    map: 'darkforest', timeLimit: 420, icon: 'enemy', teamSpawns: false,
  },
  // 12) موجات البقاء (تعاوني)
  survival: {
    id: 'survival', nameAr: 'موجات البقاء', descAr: 'موجات متزايدة من الأعداء، دافعوا معًا.',
    teams: 1, cooperative: true, respawn: true, loadout: 'standard', waveInterval: 30,
    waves: true, dbno: true, map: 'nightbase', timeLimit: 1200, icon: 'skull',
  },
  // 13) سباق التسلح
  armsRace: {
    id: 'armsRace', nameAr: 'سباق التسلح', descAr: 'ترقية عشوائية ممتعة مع كل قتلة.',
    teams: 2, respawn: true, loadout: 'none', randomWeaponPerKill: true, dbno: false,
    map: 'factory', timeLimit: 600, icon: 'star', teamSpawns: true,
  },
  // 14) ساحة التدريب
  training: {
    id: 'training', nameAr: 'ساحة التدريب', descAr: 'أهداف متحركة وقياس DPS وتعلّم التحكم.',
    teams: 0, respawn: true, loadout: 'all', targets: true, dbno: false,
    map: 'oasis', timeLimit: 0, icon: 'settings', friendlyFire: false,
  },
  // 15) غرفة مخصصة
  custom: {
    id: 'custom', nameAr: 'غرفة مخصصة', descAr: 'قواعد يعدّلها المضيف كما يشاء.',
    teams: 1, respawn: true, loadout: 'standard', dbno: true, map: 'oasis',
    timeLimit: 900, icon: 'settings', custom: true,
  },
  // 16) بطولة
  tournament: {
    id: 'tournament', nameAr: 'بطولة', descAr: 'جدول مباريات 4/8 لاعبين مع ترتيب نهائي.',
    teams: 1, respawn: false, loadout: 'br', loot: true, dbno: true, tournament: true,
    map: 'bridge', timeLimit: 480, icon: 'crown',
  },
  // 17) اغتيال الشخصية المهمة (من اختراعنا)
  vip: {
    id: 'vip', nameAr: 'اغتيال الشخصية المهمة', descAr: 'احموا قائدكم واقتلوا قائد العدو.',
    teams: 2, respawn: true, loadout: 'standard', vip: true, dbno: true,
    map: 'ruinedcity', timeLimit: 600, icon: 'star', teamSpawns: true,
  },
  // 18) الكرت الذهبي (من اختراعنا)
  goldenCard: {
    id: 'goldenCard', nameAr: 'الكرت الذهبي', descAr: 'صندوق واحد يتنقّل — أمسكوا به أطول وقت.',
    teams: 2, respawn: true, loadout: 'standard', golden: true, dbno: true,
    map: 'port', timeLimit: 600, icon: 'gold', teamSpawns: true,
  },
  // 19) المصعد (من اختراعنا)
  elevator: {
    id: 'elevator', nameAr: 'المصعد', descAr: 'خريطة عمودية تُعاد بناؤها كل دقيقة.',
    teams: 1, respawn: true, loadout: 'standard', elevator: true, dbno: false,
    map: 'factory', timeLimit: 600, icon: 'map',
  },
};

export const MODE_LIST = Object.keys(MODES);

export function getMode(id) {
  const m = MODES[id] || MODES.dm;
  return { ...m, ...(m.checkWin ? {} : { checkWin: defaultCheckWin(m) }) };
}

function defaultCheckWin(mode) {
  return (world) => {
    if (world.matchState !== 'playing') return;
    if (mode.scoreLimit) {
      if (mode.teams > 1) {
        for (let t = 0; t < mode.teams; t++) {
          if (world.teamScores[t] >= mode.scoreLimit) return world.endMatch('score');
        }
      } else {
        const best = world.actors.reduce((a, b) => (a.kills > b.kills ? a : b), world.actors[0]);
        if (best && best.kills >= mode.scoreLimit) return world.endMatch('score');
      }
    }
    if (mode.respawn === false) {
      const alive = world.getAliveCount();
      if (alive <= 1 && world.time > 8) return world.endMatch('lastAlive');
    }
  };
}

// ---------------------------------------------------------------- منطق خاص لكل وضع
/** يستدعي تحديثات الأوضاع الخاصة (تُستدعى من GameWorld.update) */
export function initModeExtras(world) {
  const id = world.modeId;
  const w = world;
  if (id === 'kotc') {
    w.kotc = { x: w.level.width / 2, y: 200, r: 90, timer: 0, owner: -1, moveTimer: 12, progress: [0, 0] };
  }
  if (id === 'ctf') {
    w.ctf = {
      flags: [0, 1].map((t) => ({
        team: t, x: t === 0 ? 120 : w.level.width - 120, y: 0,
        homeX: t === 0 ? 120 : w.level.width - 120, carried: null,
      })),
      scores: [0, 0],
    };
  }
  if (id === 'snd') {
    w.snd = { round: 1, bombsite: { x: w.level.width * 0.5, y: 0 }, planted: false, plantTimer: 0, score: [0, 0] };
  }
  if (id === 'infection') w.infection = { zombies: [] };
  if (id === 'survival') w.survival = { wave: 0, spawnTimer: 4, enemiesAlive: 0 };
  if (id === 'vip') w.vipState = { vipByTeam: [null, null] };
  if (id === 'goldenCard') {
    w.golden = { x: w.level.width / 2, y: 220, holder: null, teams: [0, 0], moveTimer: 25 };
  }
  if (id === 'elevator') {
    w.elevatorState = { floor: 0, timer: 60 };
  }
  if (id === 'training') {
    w.trainingTargets = [];
    for (let i = 0; i < 8; i++) {
      w.trainingTargets.push({
        x: 200 + i * 90, y: 180, r: 14, hp: 100, maxHp: 100,
        vx: (i % 2 ? 1 : -1) * 40, damageDealt: 0, respawn: 0,
      });
    }
  }
}

export function updateModeExtras(world, dt) {
  const id = world.modeId;
  switch (id) {
    case 'kotc': return updateKotc(world, dt);
    case 'ctf': return updateCtf(world, dt);
    case 'snd': return updateSnd(world, dt);
    case 'infection': return updateInfection(world, dt);
    case 'survival': return updateSurvival(world, dt);
    case 'vip': return updateVip(world, dt);
    case 'goldenCard': return updateGolden(world, dt);
    case 'elevator': return updateElevator(world, dt);
    case 'training': return updateTraining(world, dt);
    case 'armsRace': return updateArmsRace(world, dt);
    default: return null;
  }
}

function updateKotc(world, dt) {
  const k = world.kotc;
  let occupants = [0, 0];
  for (const a of world.actors) {
    if (!a.alive) continue;
    if (dist(a.cx, a.cy, k.x, k.y) < k.r) occupants[a.team]++;
  }
  let owner = -1;
  if (occupants[0] > occupants[1]) owner = 0;
  else if (occupants[1] > occupants[0]) owner = 1;
  k.owner = owner;
  if (owner >= 0) {
    k.progress[owner] += dt * (12 + occupants[owner] * 4);
    world.teamScores[owner] = Math.floor(k.progress[owner]);
    if (world.teamScores[owner] >= (world.mode.scoreLimit || 300)) world.endMatch('hill');
  }
  k.moveTimer -= dt;
  if (k.moveTimer <= 0) {
    k.moveTimer = 22;
    k.x = clamp(world.level.width * (0.2 + world.rng.next() * 0.6), 200, world.level.width - 200);
    k.y = clamp(120 + world.rng.next() * (world.level.height * 0.5), 80, world.level.height - 200);
    world.emit({ type: 'hillMove', x: k.x, y: k.y, r: k.r });
  }
}

function updateCtf(world, dt) {
  const c = world.ctf;
  for (const flag of c.flags) {
    if (flag.carried) {
      const carrier = flag.carried;
      if (!carrier.alive) {
        flag.carried = null;
        flag.x = carrier.cx;
      } else {
        flag.x = carrier.cx;
        flag.y = carrier.cy - 20;
        // إعادة العلم للقاعدة = تسجيل
        const homeX = flag.team === 0 ? 120 : world.level.width - 120;
        if (Math.sign(flag.x - homeX) === Math.sign(carrier.team === 0 ? -1 : 1) && Math.abs(flag.x - homeX) < 60) {
          c.scores[carrier.team]++;
          world.teamScores[carrier.team] = c.scores[carrier.team];
          flag.carried = null;
          flag.x = homeX;
          world.emit({ type: 'flagCaptured', team: carrier.team });
          if (c.scores[carrier.team] >= (world.mode.scoreLimit || 5)) world.endMatch('flag');
        }
      }
    } else {
      // التقاط العلم
      for (const a of world.actors) {
        if (!a.alive || a.team === flag.team) continue;
        if (Math.hypot(a.cx - flag.x, a.cy - flag.y) < 26) {
          flag.carried = a;
          world.emit({ type: 'flagTaken', team: a.team, actor: a });
          break;
        }
      }
    }
  }
}

function updateSnd(world, dt) {
  const s = world.snd;
  if (!s.bombsite.y) {
    const gx = Math.floor(world.level.width / 2);
    s.bombsite.y = world.level.groundH ? world.level.groundH(gx) : world.level.height - 100;
  }
  if (s.planted) {
    s.plantTimer -= dt;
    if (s.plantTimer <= 0) {
      world.explode(s.bombsite.x, s.bombsite.y - 10, 180, 400, null, { instantKill: true });
      s.score[world.attackTeam] = (s.score[world.attackTeam] || 0) + 1;
      world.emit({ type: 'bombExploded', x: s.bombsite.x, y: s.bombsite.y });
      nextRound(world);
    }
  } else {
    // تفكيك/زرع
    for (const a of world.actors) {
      if (!a.alive) continue;
      if (a.team === world.attackTeam && Math.hypot(a.cx - s.bombsite.x, a.cy - s.bombsite.y) < 40) {
        a.plantProgress = (a.plantProgress || 0) + dt / 3.5;
        if (a.plantProgress >= 1) {
          s.planted = true;
          s.plantTimer = 40;
          a.plantProgress = 0;
          a.plants = (a.plants || 0) + 1;
          world.emit({ type: 'bombPlanted', x: s.bombsite.x, y: s.bombsite.y });
        }
      } else if (a.team !== world.attackTeam && Math.hypot(a.cx - s.bombsite.x, a.cy - s.bombsite.y) < 40) {
        // تفكيك فقط بعد الزرع (منطق مبسّط)
        a.plantProgress = 0;
      }
    }
  }
  const aliveA = world.actors.filter((a) => a.alive && a.team === world.attackTeam).length;
  const aliveD = world.actors.filter((a) => a.alive && a.team !== world.attackTeam).length;
  if (!s.planted && (aliveA === 0 || aliveD === 0)) {
    if (aliveA === 0) s.score[1 - world.attackTeam] = (s.score[1 - world.attackTeam] || 0) + 1;
    if (aliveD === 0) s.score[world.attackTeam] = (s.score[world.attackTeam] || 0) + 1;
    nextRound(world);
  }
}

function nextRound(world) {
  const s = world.snd;
  s.round++;
  s.planted = false;
  s.plantTimer = 0;
  world.attackTeam = (world.attackTeam || 0) === 0 ? 1 : 0;
  world.teamScores[0] = s.score[0] || 0;
  world.teamScores[1] = s.score[1] || 0;
  world.emit({ type: 'roundEnd', round: s.round, score: s.score });
  const need = Math.ceil((world.mode.rounds || 7) / 2);
  if ((s.score[0] || 0) >= need || (s.score[1] || 0) >= need) {
    world.endMatch('rounds');
    return;
  }
  // إعادة إحياء الجميع
  for (const a of world.actors) world.respawn(a);
}

function updateInfection(world, dt) {
  const inf = world.infection;
  // في البداية: أحدهم زومبي
  if (!inf.started && world.time > 3 && world.actors.length) {
    inf.started = true;
    const picked = world.actors[world.rng.int(0, world.actors.length - 1)];
    picked.team = 1;         // الفريق 1 = زومبي
    picked.isZombie = true;
    picked.maxHp = 180; picked.hp = 180;
    picked.giveWeapon('shafra', 0, []);
    inf.zombies.push(picked.id);
    world.emit({ type: 'patientZero', actor: picked });
  }
  for (const a of world.actors) {
    if (!a.alive || !a.isZombie) continue;
    a.hp = Math.min(a.maxHp, a.hp + dt * 4);      // يتعافى الزومبي
    for (const t of world.actors) {
      if (t.team === 0 && t.alive && !t.isZombie && Math.hypot(t.cx - a.cx, t.cy - a.cy) < 26) {
        t.team = 1;
        t.isZombie = true;
        t.maxHp = 180; t.hp = 180;
        t.giveWeapon('shafra', 0, []);
        t.jetFuel = 100;
        world.emit({ type: 'infected', actor: t });
      }
    }
  }
  const survivors = world.actors.filter((a) => a.alive && !a.isZombie).length;
  if (inf.started && survivors === 0) world.endMatch('infected');
}

function updateSurvival(world, dt) {
  const s = world.survival;
  s.spawnTimer -= dt;
  s.enemiesAlive = world.actors.filter((a) => a.isBot && a.team === 1 && a.alive).length;
  if (s.enemiesAlive === 0 || s.spawnTimer <= 0) {
    s.wave++;
    s.spawnTimer = Math.max(18, 34 - s.wave);
    const count = Math.min(10, 2 + Math.floor(s.wave * 0.8));
    for (let i = 0; i < count; i++) {
      const x = world.rng.range(60, world.level.width - 60);
      const y = 60;
      const bot = world.addActor({
        isBot: true, team: 1, name: `موجة ${s.wave}-${i + 1}`,
        difficulty: clamp(1 + Math.floor(s.wave / 3), 0, 4), seed: world.rng.int(1, 9999),
      });
      bot.x = x; bot.y = y;
      bot.hp = 60 + s.wave * 12;
      bot.maxHp = bot.hp;
      bot.giveWeapon(world.rng.pick(['n9', 'zarqa', 'jabha', 'mitraqa', 'harrasa']), 0, []);
    }
    world.emit({ type: 'wave', wave: s.wave, count });
  }
}

function updateVip(world, dt) {
  const v = world.vipState;
  if (!v.vipByTeam[0]) {
    for (let t = 0; t < 2; t++) {
      const members = world.actors.filter((a) => a.team === t);
      if (members.length) {
        const vip = members[world.rng.int(0, members.length - 1)];
        vip.isVip = true;
        vip.maxHp = 150; vip.hp = 150;
        vip.armorLevel = 3; vip.armor = 100;
        v.vipByTeam[t] = vip;
        world.emit({ type: 'vipChosen', actor: vip, team: t });
      }
    }
  }
  for (let t = 0; t < 2; t++) {
    const vip = v.vipByTeam[t];
    if (vip && (!vip.alive || vip.hp <= 0)) {
      world.endMatch('vip');
    }
  }
}

function updateGolden(world, dt) {
  const g = world.golden;
  g.moveTimer -= dt;
  if (g.moveTimer <= 0 && !g.holder) {
    g.moveTimer = 30;
    g.x = world.rng.range(200, world.level.width - 200);
    g.y = world.rng.range(120, world.level.height - 200);
    world.emit({ type: 'goldenMove', x: g.x, y: g.y });
  }
  if (!g.holder) {
    for (const a of world.actors) {
      if (!a.alive) continue;
      if (Math.hypot(a.cx - g.x, a.cy - g.y) < 30) {
        g.holder = a;
        world.emit({ type: 'goldenTaken', actor: a });
        break;
      }
    }
  } else {
    if (!g.holder.alive) {
      g.holder = null;
    } else {
      g.x = g.holder.cx;
      g.y = g.holder.cy - 24;
      g.teams[g.holder.team] += dt * 4;
      world.teamScores[g.holder.team] = Math.floor(g.teams[g.holder.team]);
      if (g.teams[g.holder.team] >= 120) world.endMatch('golden');
    }
  }
}

function updateElevator(world, dt) {
  const e = world.elevatorState;
  e.timer -= dt;
  if (e.timer <= 0) {
    e.timer = 60;
    e.floor++;
    world.emit({ type: 'elevatorShift', floor: e.floor });
    // تغيير بنية الخريطة: نقل المنصات وإزالة/إضافة جدران
    const map = world.level.map;
    const y = 6 + (e.floor % 4) * Math.floor(map.h / 5);
    for (let x = 8; x < map.w - 8; x += 1) {
      if ((x + e.floor) % 3 === 0) {
        map.set(x, y, 3);
        map.set(x, y + 1, 0);
      }
    }
  }
}

function updateTraining(world, dt) {
  for (const t of world.trainingTargets) {
    if (t.respawn > 0) {
      t.respawn -= dt;
      if (t.respawn <= 0) t.hp = t.maxHp;
      continue;
    }
    t.x += t.vx * dt;
    if (t.x < 120 || t.x > world.level.width - 120) t.vx *= -1;
  }
}

function updateArmsRace(world, dt) {
  for (const a of world.actors) {
    if (!a.alive) continue;
    if (a.kills > (a.lastArmsKill || 0)) {
      a.lastArmsKill = a.kills;
      const pool = Object.keys(WEAPONS).filter((id) => WEAPONS[id].cls !== 'melee');
      a.giveWeapon(world.rng.pick(pool), 0, []);
      world.emit({ type: 'armsRace', actor: a });
    }
  }
}
