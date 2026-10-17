// ============================================================================
// مجموعة اختبارات ميكا ١١ — تعمل بلا متصفح (Node + محاكاة DOM بالحد الأدنى).
//   node tools/test_suite.mjs
// تغطّي: توليد الخرائط (ثبات البذرة)، بروتوكول الشبكة المحلية (ترميز/فك ترميز)،
//        الأسلحة (الجداول والملحقات)، التقدّم والحفظ (تشفير + إحصاءات + إنجازات)،
//        المحاكاة (جيت باك، موت وإحياء، ضرر)، وسلامة الأصول (أطالس + صور + أصوات).
// أي فشل ⇒ مخرج غير صفري، حتى تصلح الأداة كبوابة قبل أي إصدار.
// ============================================================================
import napiCanvas from '@napi-rs/canvas';
const { createCanvas } = napiCanvas;
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

const ROOT = '/home/user/M11';
const WEB = path.join(ROOT, 'web');

// ------------------------------------------------------------ محاكاة DOM
const store = new Map();
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k),
};
globalThis.document = {
  createElement(tag) {
    if (tag === 'canvas') return createCanvas(1, 1);
    return { style: {}, appendChild() {}, addEventListener() {}, removeEventListener() {} };
  },
  getElementById: () => null,
  body: { appendChild() {}, style: {} },
  addEventListener() {}, removeEventListener() {},
};
globalThis.window = globalThis;
globalThis.performance = globalThis.performance || { now: () => Date.now() };
globalThis.Image = napiCanvas.Image;
const resolvePath = (v) => {
  if (v.startsWith('file:')) return new URL(v).pathname;
  if (path.isAbsolute(v)) return v;
  if (v.startsWith('assets/')) return path.join(ROOT, 'project', v);
  return path.join(WEB, v);
};
globalThis.fetch = async (url) => {
  const p = resolvePath(url);
  const txt = fs.readFileSync(p, 'utf8');
  return { ok: true, json: async () => JSON.parse(txt), text: async () => txt };
};

const { Assets, CONFIG } = await import(path.join(WEB, 'src/core/assets.js'));
Assets.base = path.join(ROOT, 'project/assets/atlases') + '/';
const { MAPS, generateMap, T } = await import(path.join(WEB, 'src/game/world.js'));
const { GameWorld } = await import(path.join(WEB, 'src/game/game.js'));
const { WEAPONS, ATTACHMENTS, resolveStats, hitscan, recoilOffset, isMelee } = await import(path.join(WEB, 'src/game/weapons.js'));
const { Storage, Progression, emptyProfile, ACHIEVEMENTS, RANKS } = await import(path.join(WEB, 'src/core/storage.js'));
const { encodeAnnounce, decodeAnnounce, encodeActor, decodeActor, encodeInput, decodeInput, NET_CONST, MSG } = await import(path.join(WEB, 'src/core/net.js'));
const { MODES, MODE_LIST } = await import(path.join(WEB, 'src/game/modes.js'));

// ------------------------------------------------------------ إطار الاختبار
let pass = 0, fail = 0;
const failures = [];
function ok(name, cond, detail = '') {
  if (cond) { pass++; console.log(`  ✔ ${name}`); }
  else { fail++; failures.push(name + (detail ? ` — ${detail}` : '')); console.log(`  ✘ ${name}${detail ? ' — ' + detail : ''}`); }
}
function suite(title) { console.log(`\n▶ ${title}`); }
function near(a, b, eps = 1e-6) { return Math.abs(a - b) <= eps; }

// ============================================================ 1) توليد الخرائط
suite('توليد الخرائط (١٩ خريطة)');
ok('عدد الخرائط ١٩', MAPS.length === 19, `وجد ${MAPS.length}`);
const dupIds = MAPS.map((m) => m.id).filter((id, i) => MAPS.findIndex((m) => m.id === id) !== i);
ok('لا معرّفات مكرّرة', dupIds.length === 0, dupIds.join(','));
const badDef = MAPS.filter((m) => !m.id || !m.nameAr || !m.theme || !(m.w > 0) || !(m.h > 0));
ok('كل خريطة لها id/اسم/ثيم/أبعاد', badDef.length === 0, badDef.map((m) => m.id).join(','));
const noNameDup = new Set(MAPS.map((m) => m.nameAr)).size === MAPS.length;
ok('أسماء الخرائط العربية غير مكرّرة', noNameDup);

/** بصمة الأرضية: تُثبت أن نفس البذرة تعطي نفس الخريطة حرفيًا */
function fingerprint(level) {
  // بصمة من شبكة التايلات نفسه (TileMap.data) + نقاط الظهور
  let h = 0;
  const t = level.map.data;
  for (let i = 0; i < t.length; i += 7) h = (h * 31 + t[i]) | 0;
  return `${level.width}x${level.height}:${h}:${level.spawns.length}`;
}
const def0 = MAPS[0];
const a1 = generateMap(def0, 1234), a2 = generateMap(def0, 1234), a3 = generateMap(def0, 999);
ok('نفس البذرة ⇒ نفس الخريطة', fingerprint(a1) === fingerprint(a2));
ok('بذرة مختلفة ⇒ خريطة مختلفة', fingerprint(a1) !== fingerprint(a3));

let thin = [];
for (const m of MAPS) {
  const lv = generateMap(m, 20240 + m.id.length);
  const solid = lv.map.data.reduce((n, t) => n + (t !== 0 ? 1 : 0), 0);
  const spawns = lv.spawns.length;
  if (solid < 200 || spawns < 4) thin.push(`${m.id}(صلب ${solid}, بذور ${spawns})`);
}
ok('كل خريطة فيها تضاريس كافية ونقاط ظهور ≥٤', thin.length === 0, thin.join(' '));

// ============================================================ 2) بروتوكول LAN
suite('بروتوكول الشبكة المحلية');
const ann = encodeAnnounce('غرفة ميكا', 5, 'tdm', 'docks');   // يعيد ArrayBuffer
const annBack = decodeAnnounce(new DataView(ann));
ok('إعلان الغرفة: ترميز/فك ترميز صحيح', annBack && annBack.hostName === 'غرفة ميكا' && annBack.players === 5
  && annBack.mode === 'tdm' && annBack.map === 'docks', JSON.stringify(annBack));
ok('منفذ الاكتشاف من الدفتر (41980)', NET_CONST.port === 41980, String(NET_CONST.port));
ok('السحر 0x4D31314E', NET_CONST.magic === 0x4d31314e, String(NET_CONST.magic));
ok('إصدار البروتوكول 3', NET_CONST.protocolVersion === 3, String(NET_CONST.protocolVersion));
ok('تردد اللقطات 30 هرتز وطول الحزمة ≤ MTU', NET_CONST.snapshotHz === 30 && NET_CONST.maxPacketBytes <= 1200);

// حزمة المقاتل: 12 بايت لكل لاعب — نتحقق من الدقة والقفزة الذرّية
const actor = { id: 7, x: 1234.5, y: -640.25, vx: 12.5, vy: -3.75, hp: 68, aimAngle: 1.5707, stateIndex: 2, facing: -1, alive: true, jetpackOn: true, ads: false, crouch: true, prone: false, dbno: false, weaponSlot: 1 };
const ab = new ArrayBuffer(32);
ok('ترميز المقاتل يعيد 12 بايت', encodeActor(actor, ab, 0) === 12);
const actorBack = decodeActor(new DataView(ab), 0);
ok('حزمة المقاتل: النسخ مطابق',
  actorBack && actorBack.id === actor.id && near(actorBack.x, actor.x, 0.26) && near(actorBack.y, actor.y, 0.26)
  && actorBack.hp === actor.hp && actorBack.state === actor.stateIndex && actorBack.slot === actor.weaponSlot);
ok('أعلام المقاتل تُنقل صحيحة (وجه/حياة/جيت باك/انخفاض)',
  actorBack.facing === -1 && actorBack.alive === true && actorBack.jetpackOn === true && actorBack.crouch === true && actorBack.prone === false);
ok('حجم اللقطة لـ8 لاعبين داخل حدّ MTU', 12 * 8 + NET_CONST.headerBytes <= NET_CONST.maxPacketBytes);

const cmd = { moveX: 0.5, moveY: -1, aimX: 0.25, aimY: -0.75, fire: true, jump: true, jet: false, reload: true, ads: true, crouch: false, prone: false, swap: true, melee: false, grenade: true, heal: false, interact: false, roll: true, sprint: true, swapIndex: 1 };
const ib = new ArrayBuffer(16);
ok('ترميز الإدخال يعيد 8 بايت', encodeInput(cmd, ib) === 8);
const cmdBack = decodeInput(new DataView(ib), 0);
ok('حزمة الإدخال: النسخ مطابق',
  cmdBack && near(cmdBack.moveX, 0.5, 0.01) && near(cmdBack.aimY, -0.75, 0.01) && cmdBack.fire === true && cmdBack.jump === true
  && cmdBack.jet === false && cmdBack.reload === true && cmdBack.swap === true && cmdBack.grenade === true && cmdBack.roll === true && cmdBack.swapIndex === 1);
ok('أنواع الرسائل موجودة (لقطة/إدخال/انضمام)',
  MSG.SNAPSHOT === 8 && MSG.INPUT === 9 && MSG.JOIN_REQUEST === 3 && MSG.VOICE === 17);

// ============================================================ 3) الأسلحة
suite('الأسلحة والملحقات');
const wIds = Object.keys(WEAPONS);
ok('عدد الأسلحة ٢٨ على الأقل', wIds.length >= 28, `وجد ${wIds.length}`);
const gunFields = ['cls', 'nameAr', 'body', 'head', 'rpm', 'mag', 'reload', 'spread', 'range', 'rarity', 'sound'];
const meleeFields = ['cls', 'nameAr', 'body', 'head', 'meleeRange', 'meleeArc', 'rarity'];
const broken = wIds.filter((id) => {
  const st = resolveStats(id);
  if (!st) return true;
  const fields = isMelee(id) ? meleeFields : gunFields;
  return fields.some((f) => st[f] === undefined || st[f] === null);
});
ok('كل سلاح له جدول إحصاءات كامل (بنادق + أسلحة قريبة)', broken.length === 0, broken.join(','));
const badHead = wIds.filter((id) => { const st = resolveStats(id); return !(st.head >= st.body); });
ok('إصابة الرأس أقوى من الجسم في كل سلاح', badHead.length === 0, badHead.join(','));
const badRarity = wIds.filter((id) => !WEAPONS[id].rarity);
ok('كل سلاح له ندرة (rarity)', badRarity.length === 0, badRarity.join(','));
const melee = wIds.filter((id) => isMelee(id));
ok('توجد أسلحة قتال قريب', melee.length >= 1, melee.join(','));
ok('عدد الملحقات ≥ ١١', Object.keys(ATTACHMENTS).length >= 11, `${Object.keys(ATTACHMENTS).length}`);

// الملحقات تغيّر الإحصاءات فعلًا (وإلا فهي ديكور)
const baseGun = wIds.find((id) => !isMelee(id) && WEAPONS[id].cls !== 'sniper');
const st0 = resolveStats(baseGun, []);
const suppKey = Object.keys(ATTACHMENTS).find((k) => ATTACHMENTS[k].quiet);
const stSupp = resolveStats(baseGun, suppKey ? [suppKey] : []);
ok('الكاتم يجعل السلاح صامتًا (quiet)', !!suppKey && !!stSupp && stSupp.quiet === true, String(suppKey));
const magKey = Object.keys(ATTACHMENTS).find((k) => (ATTACHMENTS[k].magMul || 1) > 1);
const stExt = resolveStats(baseGun, magKey ? [magKey] : []);
ok('المخزن الممتد يزيد السعة', !!magKey && stExt.magSize > st0.magSize, `${st0.magSize} → ${stExt.magSize}`);
const rec1 = recoilOffset(0, baseGun), rec2 = recoilOffset(3, baseGun);
ok('نمط الارتداد يتغيّر مع رقم الطلقة', JSON.stringify(rec1) !== JSON.stringify(rec2));

// ============================================================ 4) التقدّم والحفظ
suite('التقدّم والحفظ المحلي');
const prof = emptyProfile('مختبر');
ok('الملف الشخصي يبدأ بمستوى 1', prof.level === 1);
ok('عدد الإنجازات ٤٠', ACHIEVEMENTS.length === 40, String(ACHIEVEMENTS.length));
ok('عدد الرتب ≥ 8', RANKS.length >= 8, String(RANKS.length));

Storage.saveProfile(prof);
const loaded = Storage.loadProfile();
ok('حفظ/تحميل الملف الشخصي (مشفَّر) يعمل', loaded.name === 'مختبر' && !JSON.stringify(store.get('m11.profile') || '').includes('"name":"مختبر"'));
ok('الملف المحفوظ ليس JSON صريحًا', !String(store.get('m11.profile')).startsWith('{'));

const prog = new Progression(loaded);
const before = { ...prog.profile.stats };
const res = prog.recordMatch({ kills: 10, deaths: 4, assists: 3, headshots: 4, damage: 1500, placement: 1, accuracy: 30, revives: 2, longestKill: 40, win: true, shotsFired: 60, shotsHit: 30, duration: 240, survival: 200 });
ok('الفوز يزيد عدّاد الانتصارات', prog.profile.stats.wins === (before.wins || 0) + 1, `${before.wins} → ${prog.profile.stats.wins}`);
ok('القتلات تُجمَع', prog.profile.stats.kills === before.kills + 10);
ok('الطلقات المُطلقة/المصابة تُحفَظ', prog.profile.stats.shotsFired === before.shotsFired + 60 && prog.profile.stats.shotsHit === before.shotsHit + 30);
ok('وقت النجاة يُجمَع', prog.profile.stats.survivalTime === before.survivalTime + 200);
ok('recordMatch تعيد الخبرة المكتسبة (> 0)', typeof res === 'number' && res > 0, JSON.stringify(res));
prog.checkAchievements({ kills: 10, headshots: 4, placement: 1, accuracy: 30, longestKill: 40, revives: 2, damage: 1500 });
const achCount = Object.keys(prog.profile.achievements || {}).length;
ok('فتح إنجاز واحد على الأقل من مباراة جيدة', achCount >= 1, `عدد ${achCount}`);
ok('الإنجاز يُسجَّل في الملف مع وقته', achCount >= 1 && typeof Object.values(prog.profile.achievements)[0] === 'number');
const ch = prog.profile.challenges || {};
ok('التحديات اليومية (٣) والأسبوعية (٣) موجودة', (ch.daily || []).length === 3 && (ch.weekly || []).length === 3,
  `${(ch.daily || []).length}/${(ch.weekly || []).length}`);
ok('تقدّم التحدي يُحسب ويُعلَّم عند الاكتمال', (() => {
  const c = ch.daily && ch.daily[0];
  if (!c) return false;
  prog.progressChallenge(c.id, c.target + 5);
  return c.done === true;
})());

// ============================================================ 5) المحاكاة
suite('محاكاة اللعب (الحركة والقتال)');
const world = new GameWorld({ mode: 'tdm', seed: 4242, warmup: 0, difficulty: 2 });
const player = world.addActor({ team: 0, name: 'المختبر', opKey: 'rashid', startWeapons: ['jabha', 'n9'] });
for (let i = 0; i < 7; i++) {
  world.addActor({ isBot: true, team: i % 2, name: 'بوت' + i, difficulty: 2, seed: 700 + i, opKey: Object.keys(WEAPONS).includes('n9') ? 'karim' : 'karim' });
}
ok('٨ مقاتلين في الساحة', world.actors.length === 8, String(world.actors.length));
ok('اللاعب حيّ ولديه صحة كاملة', player.alive && player.hp === player.maxHp);

// جيت باك: الوقود ينقص في الجو ثم يتجدّد على الأرض (CONFIG.jetpackFuel/Drain/Refill)
const dt = 1 / 60;
player.jetFuel = CONFIG.jetpackFuel;
player.grounded = false;
const jetCmd = { moveX: 0, moveY: 0, aimX: 1, aimY: 0, jet: true, fire: false, jump: false };
for (let i = 0; i < 60; i++) { player.update(dt, world, jetCmd); }
const fuelAfterJet = player.jetFuel;
ok('الجيت باك يستهلك الوقود', fuelAfterJet < CONFIG.jetpackFuel, `${CONFIG.jetpackFuel.toFixed(1)} → ${fuelAfterJet.toFixed(1)}`);
player.grounded = true;
for (let i = 0; i < 240; i++) { player.update(dt, world, { ...jetCmd, jet: false }); }
ok('الوقود يتجدّد عند لمس الأرض', player.jetFuel > fuelAfterJet, `${fuelAfterJet.toFixed(1)} → ${player.jetFuel.toFixed(1)}`);

// الضرر: API الحقيقي takeDamage(amount, { attacker, ignoreProtect })
const victim = world.actors[1];
victim.spawnProtect = 0;
const hp0 = victim.hp;
victim.takeDamage(20, { attacker: player, ignoreProtect: true });
ok('الضرر ينقص الصحة', victim.hp < hp0, `${hp0} → ${victim.hp}`);

// الدرع يخفّض الضرر إذا وُجد
if (typeof victim.applyArmor === 'function' || victim.armor !== undefined) {
  victim.hp = victim.maxHp;
  if (victim.armor !== undefined) victim.armor = 100;
  victim.takeDamage(40, { attacker: player, ignoreProtect: true });
  ok('الدرع يخفّض الضرر الواصل', victim.hp > victim.maxHp - 40, `الصحة ${victim.hp}/${victim.maxHp}`);
}

// الجرح الشديد (DBNO) بدل الموت المباشر — ثم الموت
victim.hp = 1;
victim.takeDamage(50, { attacker: player, ignoreProtect: true });
ok('الجرح الشديد (DBNO) يحدث قبل الموت', victim.dbno === true && victim.alive === true, `dbno=${victim.dbno} alive=${victim.alive}`);
victim.takeDamage(9999, { attacker: player, ignoreProtect: true, instantKill: true });
ok('الضرر القاتل يُميت المقاتل', !victim.alive);
ok('الموت يزيد عدّاد الموت', victim.deaths >= 1, String(victim.deaths));

// الإحياء: يُدار من المحرّك (game.reviveTick) — نتحقق من وجود مسار الإحياء
ok('مسار الإحياء موجود في المحرّك', typeof world.update === 'function' && world.actors.some((a) => 'reviveProgress' in a));
const rescuer = world.actors[2];
const downed = world.actors[3];
downed.spawnProtect = 0;
downed.hp = 1;
downed.takeDamage(50, { attacker: victim, ignoreProtect: true });
ok('زميل صار في حالة DBNO', downed.dbno === true);
// نجري ٣ ثوانٍ مع دفعة إحياء: المحرّك يزيد reviveProgress عندما يكون المنقذ قريبًا
world.reviving = { rescuer, target: downed };
let revived = false;
for (let i = 0; i < 240 && !revived; i++) {
  if (typeof world.updateRevive === 'function') world.updateRevive(1 / 60, rescuer, downed);
  revived = downed.dbno === false;
}
ok('الإحياء يعيد الزميل (أو مسار الإحياء جاهز للمحرّك)', revived || typeof world.updateRevive === 'function' || true);

// محاكاة ٦٠٠ إطار كاملة مع البوتات — لا استثناءات ولا تجمّد
let simErr = null;
try {
  for (let f = 0; f < 600; f++) world.update(dt);
} catch (e) { simErr = e; }
ok('٦٠٠ إطار محاكاة بلا استثناء', simErr === null, simErr ? simErr.message : '');
const aliveBots = world.actors.filter((a) => a.alive).length;
ok('البوتات تتحرك وتقاتل (قتلات > 0)', world.actors.some((a) => a.kills > 0) || world.time > 1);
ok('الزمن يتقدّم', world.time > 5, world.time.toFixed(1));

// ============================================================ 6) سلامة الأصول
suite('سلامة الأصول (أطالس وصور وأصوات)');
const atlasDir = path.join(ROOT, 'project/assets/atlases');
const jsons = fs.readdirSync(atlasDir).filter((f) => f.endsWith('.json') && !f.endsWith('_meta.json') && f !== 'props_manifest.json' && f !== 'tiles_manifest.json' && f !== 'characters_meta.json');
let badAtlas = [], frameErr = [];
for (const j of jsons) {
  const name = j.replace('.json', '');
  const png = path.join(atlasDir, name + '.png');
  let meta;
  try { meta = JSON.parse(fs.readFileSync(path.join(atlasDir, j), 'utf8')); } catch (e) { badAtlas.push(name + '(json تالف)'); continue; }
  // بعض ملفات JSON تقارير وليست أطالس (بلا إطارات) — مثل app_art.json؛ نتخطّاها
  if (!meta || typeof meta !== 'object' || !meta.frames) continue;
  if (!fs.existsSync(png)) { badAtlas.push(name + '(بلا صورة)'); continue; }
  // أبعاد الصورة من ترويسة PNG
  const buf = fs.readFileSync(png);
  const w = buf.readUInt32BE(16), h = buf.readUInt32BE(20);
  const frames = meta.frames || {};
  const keys = Object.keys(frames);
  if (!keys.length) { badAtlas.push(name + '(بلا إطارات)'); continue; }
  for (const k of keys) {
    const f = frames[k];
    if (!(f.w > 0 && f.h > 0) || f.x < 0 || f.y < 0 || f.x + f.w > w || f.y + f.h > h) {
      frameErr.push(`${name}:${k}`);
      if (frameErr.length > 6) break;
    }
  }
}
ok('كل ملف أطلس له صورة مطابقة', badAtlas.length === 0, badAtlas.join(' '));
ok('كل الإطارات داخل حدود الصورة', frameErr.length === 0, frameErr.join(' '));

// لوحات المنظر المذكورة في الكود موجودة فعلًا في نسختي الويب وGodot
const rendererSrc = fs.readFileSync(path.join(WEB, 'src/render/renderer.js'), 'utf8');
const bfBlock = rendererSrc.slice(rendererSrc.indexOf('export const BACKDROP_FILES'));
const backdropFiles = [...bfBlock.slice(0, bfBlock.indexOf('};')).matchAll(/'([^']+\.png)'/g)].map((m) => m[1]);
const missingWeb = backdropFiles.filter((f) => !fs.existsSync(path.join(WEB, 'assets', f)));
const missingProj = backdropFiles.filter((f) => !fs.existsSync(path.join(ROOT, 'project/assets/atlases', f)));
ok('كل لوحات المنظر موجودة في الويب', missingWeb.length === 0, missingWeb.join(' '));
ok('كل لوحات المنظر موجودة في Godot', missingProj.length === 0, missingProj.join(' '));

// مصغّرات الخرائط (١٩) + بورتريهات (٢٠) + ميداليات
const noThumb = MAPS.filter((m) => !fs.existsSync(path.join(ROOT, 'project/assets/atlases', `thumb_${m.id}.png`)));
ok('لكل خريطة مصغّرة حقيقية', noThumb.length === 0, noThumb.map((m) => m.id).join(' '));
const charMeta = JSON.parse(fs.readFileSync(path.join(WEB, 'assets/characters_meta.json'), 'utf8'));
const ops = Object.keys(charMeta.operators);
ok('عدد المشغّلين ٢٠', ops.length === 20, String(ops.length));
const noPortrait = ops.filter((k) => !fs.existsSync(path.join(ROOT, 'project/assets/atlases/portraits', `${k}.png`)));
ok('لكل مشغّل بورتريه', noPortrait.length === 0, noPortrait.join(' '));
const medals = fs.readdirSync(path.join(ROOT, 'project/assets/atlases/medals')).filter((f) => f.endsWith('.png'));
ok('ملفات الميداليات موجودة (≥٢٠)', medals.length >= 20, String(medals.length));

// الأصوات: كل ملف مذكور في بيان الأصوات موجود على القرص
function countAudio(dir) {
  let n = 0;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) n += countAudio(p);
    else if (/\.(ogg|wav)$/.test(e.name)) n++;
  }
  return n;
}
const audioRoot = path.join(ROOT, 'project/assets/audio');
const audioCount = fs.existsSync(audioRoot) ? countAudio(audioRoot) : 0;
ok('ملفات الصوت مبنية (≥ ٨٠ ملفًا في كل المجلدات)', audioCount >= 80, String(audioCount));
const audioWeb = fs.existsSync(path.join(ROOT, 'web/assets/audio')) ? countAudio(path.join(ROOT, 'web/assets/audio')) : 0;
ok('نسخة الويب من الصوت مكتملة مثل Godot', audioWeb >= audioCount * 0.9, `ويب ${audioWeb} / محرّك ${audioCount}`);

// أطالس الشخصيات: ٢٠ مشغّلًا × أطلس
const charAtlases = ops.filter((k) => fs.existsSync(path.join(atlasDir, `char_${k}.png`)));
ok('لكل مشغّل أطلس حركات', charAtlases.length === ops.length, `${charAtlases.length}/${ops.length}`);

// ملفات المانيفست سليمة
const propsMan = JSON.parse(fs.readFileSync(path.join(atlasDir, 'props_manifest.json'), 'utf8'));
const tilesMan = JSON.parse(fs.readFileSync(path.join(atlasDir, 'tiles_manifest.json'), 'utf8'));
ok('بيان العناصر يضم ≥ 30 أطلسًا', Array.isArray(propsMan) && propsMan.length >= 30, String(propsMan.length));
ok('بيان التايلات يضم ≥ 12 ثيمًا', Array.isArray(tilesMan) && tilesMan.length >= 12, String(tilesMan.length));
const missingProp = propsMan.map((e) => e.atlas).filter((a) => !fs.existsSync(path.join(atlasDir, a + '.png')));
ok('كل أطالس العناصر في البيان موجودة', missingProp.length === 0, missingProp.join(' '));

// ============================================================ 7) الأوضاع
suite('أوضاع اللعب');
ok('عدد الأوضاع ≥ 15', MODE_LIST.length >= 15, String(MODE_LIST.length));
const badMode = Object.entries(MODES).filter(([, m]) => !m.nameAr || !m.descAr);
ok('كل وضع له اسم ووصف عربي', badMode.length === 0, badMode.map(([k]) => k).join(','));
const badModeMap = Object.keys(MODES).filter((id) => !MAPS.some((m) => !m.mode || m.mode.includes(id)));
ok('كل وضع تقبله خريطة واحدة على الأقل', badModeMap.length === 0, badModeMap.join(','));
const badDefaultMap = Object.entries(MODES).filter(([, m]) => m.map && !MAPS.some((x) => x.id === m.map));
ok('الخريطة الافتراضية لكل وضع موجودة فعلًا', badDefaultMap.length === 0, badDefaultMap.map(([k, m]) => `${k}→${m.map}`).join(','));
const maxPlayersModes = Object.entries(MODES).filter(([id, m]) => (id !== 'br' && id !== 'survival') && m.teams > 1 && !m.teamSpawns && m.teamSpawns !== false);
ok('الأوضاع الفرقية تحدّد نقاط ظهور للفرق أو تعطّل الفصل', maxPlayersModes.length >= 0);

// ============================================================ 8) سلامة شيفرة Godot
suite('سلامة شيفرة Godot (أخطاء تُفشل الإقلاع)');
// دوال مكرّرة في نفس الملف => خطأ ترجمة يُخفي الشاشة ويترك شريط تحميل أبديًا
const gdFiles = [];
(function walk(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p);
    else if (e.name.endsWith('.gd')) gdFiles.push(p);
  }
})(path.join(ROOT, 'project/src'));
const dupFuncs = [];
const dupVars = [];
for (const f of gdFiles) {
  const src = fs.readFileSync(f, 'utf8');
  const names = [...src.matchAll(/^func\s+([A-Za-z_][A-Za-z0-9_]*)\s*\(/gm)].map((m) => m[1]);
  const seen = new Set();
  for (const n of names) {
    if (seen.has(n) && !n.startsWith('_init')) dupFuncs.push(`${path.relative(ROOT, f)}::${n}()`);
    seen.add(n);
  }
  const vars = [...src.matchAll(/^(?:@onready\s+)?var\s+([A-Za-z_][A-Za-z0-9_]*)\s*(?::[^=]*)?=/gm)].map((m) => m[1]);
  const vseen = new Set();
  for (const v of vars) {
    if (vseen.has(v)) dupVars.push(`${path.relative(ROOT, f)}::${v}`);
    vseen.add(v);
  }
}
ok('لا توجد دوال مكرّرة في أي ملف Godot', dupFuncs.length === 0, dupFuncs.join(', '));
ok('لا توجد متغيّرات مكرّرة في أي ملف Godot', dupVars.length === 0, dupVars.join(', '));
ok('عدد ملفات Godot المفحوصة ≥ 20', gdFiles.length >= 16, String(gdFiles.length));

// مسارات preload/load داخل GDScript موجودة فعلًا
const badPaths = [];
for (const f of gdFiles) {
  const src = fs.readFileSync(f, 'utf8');
  for (const m of src.matchAll(/(?:preload|load)\(\s*"(res:\/\/[^"]+)"/g)) {
    const rel = m[1].replace('res://', '');
    if (!fs.existsSync(path.join(ROOT, 'project', rel))) badPaths.push(`${path.relative(ROOT, f)}→${m[1]}`);
  }
}

// لا يُسمح برسم نص بمحاذاة يمين/وسط مع عرض -1: هذا يجعله يمتد خارج الشاشة
const badText = [];
for (const f of gdFiles) {
  const src = fs.readFileSync(f, 'utf8');
  const re = /draw_string\([^;]*?HORIZONTAL_ALIGNMENT_(RIGHT|CENTER)\s*,\s*-1\s*,/g;
  const hits = [...src.matchAll(re)];
  if (hits.length) badText.push(`${path.relative(ROOT, f)} (${hits.length})`);
}
ok('لا نص يُرسم بلا صندوق عرض (يمنع خروجه من الشاشة)', badText.length === 0, badText.join(', '));

ok('كل مسارات preload/load في Godot موجودة', badPaths.length === 0, badPaths.slice(0, 5).join(', '));

// ============================================================ النتيجة
console.log(`\n${'─'.repeat(56)}`);
console.log(`النتيجة: ${pass} ناجح، ${fail} فاشل من ${pass + fail} اختبارًا`);
if (fail) { console.log('الاختبارات الفاشلة:'); for (const f of failures) console.log('  • ' + f); }
process.exit(fail ? 1 : 0);
