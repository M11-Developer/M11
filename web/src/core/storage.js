// ============================================================================
// الحفظ المحلي (100% على الجهاز — لا حسابات ولا سحابة — القسم 13)
// حساب محلي + إحصائيات + إنجازات + تحديات + جلود + سجل مباريات + إعادات
// ============================================================================

const KEY = 'm11_frontline_profile_v1';
const SETTINGS_KEY = 'm11_frontline_settings_v1';
const CONTROLS_KEY = 'm11_frontline_controls_v1';
const LOADOUT_KEY = 'm11_frontline_loadout_v1';
const ACH_KEY = 'm11_frontline_achievements_v1';
const REPLAY_KEY = 'm11_frontline_replays_v1';

/** ترميز بسيط (XOR + Base64) — "ملف مشفّر بسيط" كما طلب القسم 13 */
function encode(obj) {
  const str = JSON.stringify(obj);
  const bytes = new TextEncoder().encode(str);
  const key = [0x4d, 0x31, 0x31, 0x2d, 0x46, 0x52, 0x4f, 0x4e, 0x54];
  for (let i = 0; i < bytes.length; i++) bytes[i] ^= key[i % key.length];
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}

function decode(text) {
  try {
    const bin = atob(text);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    const key = [0x4d, 0x31, 0x31, 0x2d, 0x46, 0x52, 0x4f, 0x4e, 0x54];
    for (let i = 0; i < bytes.length; i++) bytes[i] ^= key[i % key.length];
    return JSON.parse(new TextDecoder().decode(bytes));
  } catch (e) {
    return null;
  }
}

export const RANKS = [
  { key: 'recruit', nameAr: 'مجنّد', xp: 0, color: '#A9743C' },
  { key: 'soldier', nameAr: 'جندي', xp: 1200, color: '#B9C2CC' },
  { key: 'corporal', nameAr: 'عريف', xp: 3200, color: '#7FA05A' },
  { key: 'sergeant', nameAr: 'رقيب', xp: 6800, color: '#4A90D9' },
  { key: 'lieutenant', nameAr: 'ملازم', xp: 12000, color: '#4FD1C5' },
  { key: 'captain', nameAr: 'نقيب', xp: 20000, color: '#9B5DE8' },
  { key: 'major', nameAr: 'رائد', xp: 32000, color: '#F2C14E' },
  { key: 'colonel', nameAr: 'عقيد', xp: 52000, color: '#E8734A' },
  { key: 'general', nameAr: 'لواء', xp: 80000, color: '#E85D9B' },
  { key: 'legend', nameAr: 'أسطورة', xp: 140000, color: '#FFD98A' },
];

export function emptyProfile(name = 'مقاتل') {
  return {
    name,
    created: Date.now(),
    xp: 0,
    level: 1,
    stats: {
      kills: 0, deaths: 0, assists: 0, headshots: 0, shotsFired: 0, shotsHit: 0,
      wins: 0, matches: 0, revives: 0, dbnoSaves: 0, damageDealt: 0, damageTaken: 0,
      longestKill: 0, survivalTime: 0, playTimeSeconds: 0, bestStreak: 0, currentStreak: 0,
      airdropsLooted: 0, vehiclesUsed: 0, grenadeKills: 0, meleeKills: 0, noScopeKills: 0,
      captures: 0, plants: 0, defuses: 0,
    },
    weaponKills: {},          // أكثر سلاح استخدامًا
    weaponShots: {},
    achievements: {},         // { id: timestamp }
    challenges: { daily: [], weekly: [], lastDaily: 0, lastWeekly: 0 },
    unlocks: { skins: ['default'], charms: [], emotes: ['default'], camos: ['none'], badges: [] },
    leaderboard: [],          // لوحة شرف محلية
    friends: {},              // تحدّي الأصدقاء: { name: { wins, points } }
  };
}

/**
 * ترحيل ملف قديم: يكمل أي مفاتيح ناقصة من الافتراضي.
 * ملف بلا unlocks.skins أو challenges.daily كان يُسقط القوائم باستثناء.
 */
export function migrateProfile(p) {
  const base = emptyProfile(p && typeof p.name === 'string' ? p.name : undefined);
  const out = { ...base, ...(p || {}) };
  out.stats = { ...base.stats, ...((p && p.stats) || {}) };
  out.unlocks = { ...base.unlocks, ...((p && p.unlocks) || {}) };
  for (const k of ['skins', 'charms', 'emotes', 'camos', 'badges']) {
    if (!Array.isArray(out.unlocks[k])) out.unlocks[k] = base.unlocks[k].slice();
  }
  out.challenges = { ...base.challenges, ...((p && p.challenges) || {}) };
  if (!Array.isArray(out.challenges.daily)) out.challenges.daily = [];
  if (!Array.isArray(out.challenges.weekly)) out.challenges.weekly = [];
  out.weaponKills = (p && p.weaponKills) || {};
  out.weaponShots = (p && p.weaponShots) || {};
  // الإنجازات كانت مصفوفة في إصدار قديم ثم صارت خريطة — نوحّدها لخريطة
  let ach = p && p.achievements;
  if (Array.isArray(ach)) {
    const map = {};
    ach.forEach((id, i) => { map[id] = Date.now() - i; });
    ach = map;
  }
  out.achievements = ach && typeof ach === 'object' ? ach : {};
  out.leaderboard = Array.isArray(out.leaderboard) ? out.leaderboard : [];
  out.friends = out.friends && typeof out.friends === 'object' ? out.friends : {};
  if (!Number.isFinite(out.xp) || out.xp < 0) out.xp = 0;
  return out;
}

export class Storage {
  static loadProfile() {
    const raw = localStorage.getItem(KEY);
    const p = raw ? decode(raw) : null;
    return p ? migrateProfile(p) : emptyProfile();
  }
  static saveProfile(p) {
    localStorage.setItem(KEY, encode(p));
  }
  static loadSettings() {
    const raw = localStorage.getItem(SETTINGS_KEY);
    return raw ? JSON.parse(raw) : null;
  }
  static saveSettings(s) {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(s));
  }
  static loadControls() {
    const raw = localStorage.getItem(CONTROLS_KEY);
    return raw ? JSON.parse(raw) : null;
  }
  static saveControls(c) {
    localStorage.setItem(CONTROLS_KEY, JSON.stringify(c));
  }
  static loadLoadout() {
    const raw = localStorage.getItem(LOADOUT_KEY);
    return raw ? JSON.parse(raw) : null;
  }
  static saveLoadout(l) {
    localStorage.setItem(LOADOUT_KEY, JSON.stringify(l));
  }
  static loadReplays() {
    const raw = localStorage.getItem(REPLAY_KEY);
    return raw ? JSON.parse(raw) : [];
  }
  static saveReplays(r) {
    // نحتفظ بآخر 12 إعادة فقط لتوفير المساحة
    localStorage.setItem(REPLAY_KEY, JSON.stringify(r.slice(-12)));
  }
}

/** إدارة التقدّم: XP، رتب، إنجازات، تحديات */
export class Progression {
  constructor(profile) {
    this.profile = profile || Storage.loadProfile();
    this.achievements = ACHIEVEMENTS;
    this.rollChallenges();
  }

  get rank() {
    let r = RANKS[0];
    for (const rk of RANKS) if (this.profile.xp >= rk.xp) r = rk;
    return r;
  }
  get nextRank() {
    for (const rk of RANKS) if (this.profile.xp < rk.xp) return rk;
    return null;
  }
  get rankProgress() {
    const cur = this.rank, next = this.nextRank;
    if (!next) return 1;
    return (this.profile.xp - cur.xp) / (next.xp - cur.xp);
  }

  /** المستوى يُشتق من الخبرة — كان p.level يبقى 1 مهما لعبت */
  get level() {
    return Math.max(1, Math.floor(this.profile.xp / 1500) + 1);
  }

  addXp(amount, reason = '') {
    this.profile.xp += amount;
    this.profile.level = this.level;
    this.checkUnlocks();
    return amount;
  }

  recordMatch(result) {
    const s = this.profile.stats;
    s.matches++;
    if (result.win) s.wins++;
    s.kills += result.kills || 0;
    s.deaths += result.deaths || 0;
    s.assists += result.assists || 0;
    s.headshots += result.headshots || 0;
    s.shotsFired += result.shotsFired || 0;
    s.shotsHit += result.shotsHit || 0;
    s.damageDealt += result.damage || 0;
    s.revives += result.revives || 0;
    s.longestKill = Math.max(s.longestKill, result.longestKill || 0);
    s.survivalTime += result.survival || 0;
    s.playTimeSeconds += result.duration || 0;
    s.currentStreak = result.win ? s.currentStreak + 1 : 0;
    s.bestStreak = Math.max(s.bestStreak, s.currentStreak);
    if (result.weaponKills) {
      for (const [w, n] of Object.entries(result.weaponKills)) {
        this.profile.weaponKills[w] = (this.profile.weaponKills[w] || 0) + n;
      }
    }
    for (const [w, n] of Object.entries(result.weaponShots || {})) {
      this.profile.weaponShots[w] = (this.profile.weaponShots[w] || 0) + n;
    }
    // لوحة شرف محلية
    this.profile.leaderboard.push({
      date: Date.now(), mode: result.mode, win: result.win, kills: result.kills || 0,
      placement: result.placement || 1, name: this.profile.name,
    });
    if (this.profile.leaderboard.length > 60) this.profile.leaderboard.shift();
    const gained = this.addXp(
      (result.kills || 0) * 100 + (result.win ? 500 : 0) + (result.assists || 0) * 40 +
      (result.revives || 0) * 60 + Math.round((result.survival || 0) * 2) + 80, 'match');
    this.checkAchievements(result);
    // التحديات اليومية/الأسبوعية: كانت تبقى 0/x للأبد
    this.progressStat('kills', result.kills || 0);
    this.progressStat('headshots', result.headshots || 0);
    this.progressStat('wins', result.win ? 1 : 0);
    this.progressStat('revives', result.revives || 0);
    this.progressStat('damageDealt', result.damage || 0);
    this.progressStat('playTimeSeconds', result.duration || 0);
    this.progressStat('meleeKills', result.meleeKills || 0);
    this.progressStat('airdropsLooted', result.airdropsLooted || 0);
    this.progressStat('brMatches', result.mode === 'br' ? 1 : 0);
    Storage.saveProfile(this.profile);
    return gained;
  }

  checkUnlocks() {
    const u = this.profile.unlocks;
    const rank = this.rank.key;
    const order = RANKS.map((r) => r.key);
    const idx = order.indexOf(rank);
    const skins = ['default', 'desert', 'night', 'urban', 'arctic', 'blood', 'gold', 'spectral'];
    const allowed = Math.min(skins.length, 1 + Math.floor(idx / 1.4));
    for (let i = 0; i < allowed; i++) {
      if (!u.skins.includes(skins[i])) u.skins.push(skins[i]);
    }
    const camos = ['none', 'forest', 'desert', 'digital', 'snow', 'blood'];
    const camoAllowed = Math.min(camos.length, 1 + Math.floor(idx / 1.6));
    for (let i = 0; i < camoAllowed; i++) if (!u.camos.includes(camos[i])) u.camos.push(camos[i]);
  }

  checkAchievements(result) {
    for (const a of this.achievements) {
      if (this.profile.achievements[a.id]) continue;
      if (a.check(this.profile, result)) {
        this.profile.achievements[a.id] = Date.now();
        this.addXp(a.xp || 250, 'achievement');
        this.pendingToasts = this.pendingToasts || [];
        this.pendingToasts.push({ type: 'achievement', name: a.nameAr, xp: a.xp || 250 });
      }
    }
  }

  rollChallenges(force = false) {
    const now = Date.now();
    const day = 86400000;
    const c = this.profile.challenges;
    if (force || !c.daily.length || now - c.lastDaily > day) {
      c.daily = pickChallenges(CHALLENGES_DAILY, 3, now);
      c.lastDaily = now;
    }
    if (force || !c.weekly.length || now - c.lastWeekly > day * 7) {
      c.weekly = pickChallenges(CHALLENGES_WEEKLY, 3, now);
      c.lastWeekly = now;
    }
    Storage.saveProfile(this.profile);
  }

  /** يقدّم كل تحدٍّ نشط يقيس هذا الإحصاء — recordMatch لم يكن يحرّك أي تحدٍّ إطلاقًا */
  progressStat(stat, amount = 0) {
    if (!amount) return;
    for (const list of [this.profile.challenges.daily, this.profile.challenges.weekly]) {
      for (const ch of list) {
        if (ch.stat === stat && !ch.done) this.progressChallenge(ch.id, amount);
      }
    }
  }

  progressChallenge(id, amount = 1) {
    for (const list of [this.profile.challenges.daily, this.profile.challenges.weekly]) {
      for (const ch of list) {
        if (ch.id === id && !ch.done) {
          ch.progress = Math.min(ch.target, (ch.progress || 0) + amount);
          if (ch.progress >= ch.target) {
            ch.done = true;
            this.addXp(ch.xp, 'challenge');
            this.pendingToasts = this.pendingToasts || [];
            this.pendingToasts.push({ type: 'challenge', name: ch.nameAr, xp: ch.xp });
          }
        }
      }
    }
    Storage.saveProfile(this.profile);
  }
}

// ---------------------------------------------------------------- الإنجازات (40)
function statCheck(fn) {
  return (p, r) => fn(p.stats, p, r);
}

export const ACHIEVEMENTS = [
  { id: 'first_blood', nameAr: 'أول دم', descAr: 'احصل على أول قتلة', xp: 200, check: statCheck((s) => s.kills >= 1) },
  { id: 'kills_10', nameAr: 'قاتل متمرس', descAr: '50 قتلة', xp: 300, check: statCheck((s) => s.kills >= 50) },
  { id: 'kills_100', nameAr: 'آلة حرب', descAr: '100 قتلة', xp: 600, check: statCheck((s) => s.kills >= 100) },
  { id: 'kills_500', nameAr: 'رعب الميدان', descAr: '500 قتلة', xp: 1500, check: statCheck((s) => s.kills >= 500) },
  { id: 'kills_1000', nameAr: 'أسطورة الجبهة', descAr: '1000 قتلة', xp: 3000, check: statCheck((s) => s.kills >= 1000) },
  { id: 'head_10', nameAr: 'قنّاص الرؤوس', descAr: '50 إصابة رأس', xp: 400, check: statCheck((s) => s.headshots >= 50) },
  { id: 'head_100', nameAr: 'دقّة جراحية', descAr: '200 إصابة رأس', xp: 900, check: statCheck((s) => s.headshots >= 200) },
  { id: 'win_1', nameAr: 'أول انتصار', descAr: 'افز بمباراة', xp: 250, check: statCheck((s) => s.wins >= 1) },
  { id: 'win_10', nameAr: 'قائد ميداني', descAr: '10 انتصارات', xp: 700, check: statCheck((s) => s.wins >= 10) },
  { id: 'win_50', nameAr: 'فاتح', descAr: '50 انتصارًا', xp: 2000, check: statCheck((s) => s.wins >= 50) },
  { id: 'streak_5', nameAr: 'سلسلة النصر', descAr: '5 انتصارات متتالية', xp: 900, check: statCheck((s) => s.bestStreak >= 5) },
  { id: 'streak_10', nameAr: 'لا يُوقف', descAr: '10 انتصارات متتالية', xp: 2200, check: statCheck((s) => s.bestStreak >= 10) },
  { id: 'revive_10', nameAr: 'يد الرحمة', descAr: 'أنعش 10 زملاء', xp: 500, check: statCheck((s) => s.revives >= 10) },
  { id: 'revive_50', nameAr: 'الملاك الحارس', descAr: 'أنعش 50 زميلًا', xp: 1200, check: statCheck((s) => s.revives >= 50) },
  { id: 'long_kill', nameAr: 'طلقة القرن', descAr: 'قتلة من مسافة 1200 بكسل', xp: 800, check: statCheck((s) => s.longestKill >= 1200) },
  { id: 'long_kill_1600', nameAr: 'أبعد من الخريطة', descAr: 'قتلة من مسافة 1600 بكسل', xp: 1600, check: statCheck((s) => s.longestKill >= 1600) },
  { id: 'play_1h', nameAr: 'ساعة في الميدان', descAr: 'العب ساعة', xp: 300, check: statCheck((s) => s.playTimeSeconds >= 3600) },
  { id: 'play_10h', nameAr: 'محارب محترف', descAr: 'العب 10 ساعات', xp: 1000, check: statCheck((s) => s.playTimeSeconds >= 36000) },
  { id: 'play_50h', nameAr: 'جندي دائم', descAr: 'العب 50 ساعة', xp: 3000, check: statCheck((s) => s.playTimeSeconds >= 180000) },
  { id: 'kdr_2', nameAr: 'نسبة ممتازة', descAr: 'نسبة قتل/موت 2.0 أو أكثر (100 قتلة+)', xp: 1500, check: statCheck((s) => s.kills >= 100 && s.kills / Math.max(1, s.deaths) >= 2) },
  { id: 'accuracy_50', nameAr: 'ثقب واحد', descAr: 'دقة 50% مع 500 طلقة', xp: 1400, check: statCheck((s) => s.shotsFired >= 500 && s.shotsHit / s.shotsFired >= 0.5) },
  { id: 'accuracy_25', nameAr: 'دقّة جيدة', descAr: 'دقة 25% مع 300 طلقة', xp: 500, check: statCheck((s) => s.shotsFired >= 300 && s.shotsHit / s.shotsFired >= 0.25) },
  { id: 'damage_10k', nameAr: 'حصّاد الأرواح', descAr: '10,000 ضرر', xp: 600, check: statCheck((s) => s.damageDealt >= 10000) },
  { id: 'damage_100k', nameAr: 'مدمّر', descAr: '100,000 ضرر', xp: 2500, check: statCheck((s) => s.damageDealt >= 100000) },
  { id: 'br_win', nameAr: 'الدجاجة!', descAr: 'افز بمباراة Battle Royale', xp: 1000, check: (p, r) => r && r.win && r.mode === 'br' },
  { id: 'br_win_10', nameAr: 'ملك الحلبة', descAr: '10 انتصارات BR', xp: 3000, check: (p, r) => r && r.win && r.mode === 'br' && p.stats.wins >= 10 },
  { id: 'no_death', nameAr: 'بلا خدش', descAr: 'افز بمباراة بلا موت واحد', xp: 1200, check: (p, r) => r && r.win && r.deaths === 0 },
  { id: 'grenade_10', nameAr: 'خبير القنابل', descAr: '10 قتلات بقنبلة', xp: 700, check: statCheck((s) => s.grenadeKills >= 10) },
  { id: 'melee_10', nameAr: 'حرب قريبة', descAr: '10 قتلات مشاجرة', xp: 700, check: statCheck((s) => s.meleeKills >= 10) },
  { id: 'revive_under_fire', nameAr: 'تحت النار', descAr: 'أنعش زميلًا وأنت مصاب', xp: 900, check: (p, r) => r && r.reviveUnderFire },
  { id: 'squad_win', nameAr: 'روح الفريق', descAr: 'افز بفريق كامل حي', xp: 1100, check: (p, r) => r && r.win && r.squadAlive },
  { id: 'all_ops', nameAr: 'المجموعة كاملة', descAr: 'العب بكل الشخصيات العشر', xp: 800, check: (p) => Object.keys(p.operatorsPlayed || {}).length >= 10 },
  { id: 'all_maps', nameAr: 'رحّالة', descAr: 'العب في كل الخرائط الثماني', xp: 900, check: (p) => Object.keys(p.mapsPlayed || {}).length >= 8 },
  { id: 'all_modes', nameAr: 'متعدد المواهب', descAr: 'العب 10 أوضاع مختلفة', xp: 1200, check: (p) => Object.keys(p.modesPlayed || {}).length >= 10 },
  { id: 'airdrop_10', nameAr: 'صيّاد الغنائم', descAr: 'افتح 10 إسقاطات جوية', xp: 600, check: statCheck((s) => s.airdropsLooted >= 10) },
  { id: 'survive_20', nameAr: 'الناجي', descAr: 'انجُ 20 دقيقة في مباراة واحدة', xp: 800, check: statCheck((s) => s.survivalTime >= 1200 && false) },
  { id: 'lan_8', nameAr: 'شبكة كاملة', descAr: 'العب مع 8 لاعبين على LAN', xp: 1500, check: (p, r) => r && r.lanPlayers >= 8 },
  { id: 'host_10', nameAr: 'المضيف', descAr: 'استضف 10 مباريات', xp: 500, check: (p) => (p.hostCount || 0) >= 10 },
  { id: 'map_editor', nameAr: 'مهندس الخرائط', descAr: 'اصنع خريطة وشاركها', xp: 700, check: (p) => (p.mapsCreated || 0) >= 1 },
  { id: 'replay', nameAr: 'المخرج', descAr: 'شاهد إعادة لمباراة', xp: 300, check: (p) => (p.replaysWatched || 0) >= 1 },
];

const CHALLENGES_DAILY_BASE = [
  { id: 'd_kills', nameAr: 'اقتل 15 عدوًا', target: 15, xp: 300, stat: 'kills' },
  { id: 'd_head', nameAr: '10 إصابات رأس', target: 10, xp: 350, stat: 'headshots' },
  { id: 'd_win', nameAr: 'افز بمباراتين', target: 2, xp: 500, stat: 'wins' },
  { id: 'd_revive', nameAr: 'أنعش زميلين', target: 2, xp: 300, stat: 'revives' },
  { id: 'd_damage', nameAr: '2000 ضرر', target: 2000, xp: 350, stat: 'damageDealt' },
  { id: 'd_play', nameAr: 'العب 20 دقيقة', target: 1200, xp: 300, stat: 'playTimeSeconds' },
  { id: 'd_br', nameAr: 'العب 3 مباريات BR', target: 3, xp: 400, stat: 'brMatches' },
  { id: 'd_melee', nameAr: 'قتلتان مشاجرة', target: 2, xp: 300, stat: 'meleeKills' },
  { id: 'd_airdrop', nameAr: 'صندوقان جويان', target: 2, xp: 350, stat: 'airdropsLooted' },
];
const CHALLENGES_DAILY = CHALLENGES_DAILY_BASE;
const CHALLENGES_WEEKLY = CHALLENGES_DAILY_BASE.map((c) => ({ ...c, target: c.target * 6, xp: c.xp * 4, id: 'w_' + c.id }));

function pickChallenges(pool, n, seed) {
  const out = [];
  const copy = [...pool];
  let s = seed % 2147483647;
  const rnd = () => (s = (s * 48271) % 2147483647) / 2147483647;
  for (let i = 0; i < n && copy.length; i++) {
    out.push({ ...copy.splice(Math.floor(rnd() * copy.length), 1)[0], progress: 0, done: false });
  }
  return out;
}
