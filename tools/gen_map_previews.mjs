// ============================================================================
// مولّد مصغّرات الخرائط — يرسم كل خريطة فعلية (تضاريس + عناصر) إلى صورة PNG.
// لماذا؟ لأن صور المصغّرات المولّدة بالذكاء الاصطناعي جميلة لكنها **ليست** الخريطة
// التي سيلعبها اللاعب. هذه الأداة ترسم الخريطة الحقيقية فتكون المعاينة صادقة.
// تُشغَّل: node tools/gen_map_previews.mjs [عرض] [ارتفاع]
// ============================================================================
import fs from 'node:fs';
import path from 'node:path';
import { createCanvas, loadImage, Image } from '@napi-rs/canvas';
import { Assets } from '../web/src/core/assets.js';
import { MAPS, generateMap, T, TS } from '../web/src/game/world.js';

const OW = Number(process.argv[2] || 320);
const OH = Number(process.argv[3] || 180);
const ATL = 'project/assets/atlases';
Assets.base = ATL + '/';

const PK = (p) => path.isAbsolute(p) ? p : path.join(ATL, p);
const load = async (n) => {
  const meta = JSON.parse(fs.readFileSync(PK(n + '.json'), 'utf8'));
  const img = await loadImage(PK(n + '.png'));
  return { meta, img };
};
async function getAtlas(name) {
  const { meta, img } = await load(name);
  return {
    frames: meta.frames || {}, image: img,
    has: (k) => !!meta.frames?.[k],
    frame: (k) => meta.frames?.[k],
    draw(ctx, k, x, y, scale = 1, flip = false) {
      const f = meta.frames?.[k]; if (!f) return false;
      if (flip) { ctx.save(); ctx.translate(x + f.ox * scale, y); ctx.scale(-1, 1);
        ctx.drawImage(img, f.x, f.y, f.w, f.h, 0, 0, f.ox * scale, f.oy * scale); ctx.restore(); }
      else ctx.drawImage(img, f.x, f.y, f.w, f.h, x, y, f.ox * scale, f.oy * scale);
      return true;
    },
  };
}

const list = ['world', 'vfx', 'ui', 'weapons'];
for (const [file, pick] of [['props_manifest.json', (e) => e.atlas], ['tiles_manifest.json', (e) => 'tiles_' + e.theme]]) {
  try { for (const e of JSON.parse(fs.readFileSync(path.join(ATL, file), 'utf8'))) list.push(pick(e)); } catch (e) {}
}
const atlases = {};
for (const n of list) { try { atlases[n] = await getAtlas(n); } catch (e) {} }
console.log('أطالس محمّلة:', Object.keys(atlases).length);

// لوحات المنظر: تُرسم خلف الخريطة فتبدو المصغّرة كصورة من اللعبة لا مخططًا أسود
const BACKDROPS = {};
for (const f of fs.readdirSync('web/assets/backdrops')) {
  if (f.endsWith('.png')) BACKDROPS[f.slice(0, -4)] = await loadImage(path.join('web/assets/backdrops', f));
}
const THEME_BACKDROP = {
  desert: ['bg_parallax_desert', 'bg_parallax_oasis_night'], oasis: ['bg_parallax_desert', 'bg_parallax_oasis_night'],
  village: ['bg_parallax_desert', 'bg_parallax_oasis_night'], ruins: ['bg_parallax_desert', 'bg_parallax_oasis_night'],
  forest: ['bg_parallax_forest_night', 'bg_parallax_forest_night'],
  base: ['bg_parallax_factory', 'bg_parallax_factory'], factory: ['bg_parallax_factory', 'bg_parallax_factory'],
  city: ['bg_parallax_city_dusk', 'bg_parallax_factory'],
  port: ['bg_parallax_naval_base', 'bg_parallax_sea_storm'],
  oil: ['bg_parallax_oil_rig', 'bg_parallax_oil_rig'],
  snow: ['bg_parallax_snow', 'bg_parallax_snow'], mountain: ['bg_parallax_snow', 'bg_parallax_snow'],
  space: ['bg_sky_station', 'bg_sky_station'], cave: ['bg_sky_cave_glow', 'bg_sky_cave_glow'],
};
const WEATHER_BACKDROP = { storm: 'bg_sky_storm', snow: 'bg_sky_snowfall', fog: 'bg_sky_port_fog',
  dust: 'bg_sky_dust', rain: 'bg_sky_storm' };

const OUT = 'docs/map_previews';
fs.mkdirSync(OUT, { recursive: true });
const canvas = createCanvas(OW, OH);
const ctx = canvas.getContext('2d');
ctx.imageSmoothingEnabled = false;

for (const def of MAPS) {
  const level = generateMap(def, 20260101);
  const m = level.map;
  ctx.fillStyle = '#10141A';
  ctx.fillRect(0, 0, OW, OH);
  // لوحة المنظر خلف الخريطة (نفس ترتيب الأولوية في اللعبة: صريحة ← طقس ← ثيم)
  let bp = def.backdrop && (typeof def.backdrop === 'string' ? def.backdrop : (def.time > 0.62 || def.time < 0.2 ? def.backdrop.night : def.backdrop.day));
  if (!bp && def.weather && WEATHER_BACKDROP[def.weather]) bp = WEATHER_BACKDROP[def.weather];
  if (!bp) bp = (THEME_BACKDROP[def.theme] || [null])[0];
  const bimg = BACKDROPS[bp];
  if (bimg) ctx.drawImage(bimg, 0, 0, bimg.width, bimg.height, 0, 0, OW, OH);
  // نُفضّل منطقة قريبة من المنتصف فيها تضاريس (لا نرسم الطرف الفارغ)
  const viewW = m.w, viewH = 26;
  const ground = level.heights ? level.heights[Math.floor(m.w / 2)] : 8;
  const y0 = Math.max(0, Math.min(m.h - viewH, ground - 12));
  const world = { level: { def, map: m, heights: level.heights, props: level.props } };
  const sx = OW / (viewW * TS), sy = OH / (viewH * TS);
  ctx.save();
  ctx.scale(sx, sy);
  ctx.translate(0, -y0 * TS);
  // البلاطات
  const W = atlases['world'];
  for (let y = y0; y < Math.min(m.h, y0 + viewH); y++) {
    for (let x = 0; x < m.w; x++) {
      const t = m.get(x, y);
      if (t === T.EMPTY || t === T.BACK) continue;
      const theme = def.theme;
      let key = `tile/${theme}/solid`;
      if (t === T.TOP) key = `tile/${theme}/top`;
      else if (t === T.PLATFORM || t === T.GIRDER) key = `tile/${theme}/platform`;
      else if (t === T.WATER) key = 'prop/water';
      else if (t === T.CRATE) key = 'prop/crate';
      else if (t === T.SANDBAG) key = 'prop/sandbag';
      else if (t === T.GLASS) key = 'prop/glass';
      else if (t === T.LADDER) key = 'prop/ladder';
      if (!W.has(key)) key = `tile/${theme}/solid`;
      W.draw(ctx, key, x * TS, y * TS, 1);
    }
  }
  // الديكور
  for (const p of level.props) {
    if (typeof p.type === 'string' && p.type.startsWith('p:')) {
      const [an, fr] = p.type.slice(2).split('/');
      const a = atlases[an]; if (!a) continue;
      const key = a.has(`${an}/${fr}`) ? `${an}/${fr}` : (an.startsWith('tiles_') && a.has(`tile/${an.slice(6)}/${fr}`) ? `tile/${an.slice(6)}/${fr}` : null);
      if (!key) continue;
      const f = a.frame(key); const sc = p.sc || 1;
      a.draw(ctx, key, p.x, p.y - f.h * sc, sc, !!p.flip);
    }
  }
  ctx.restore();
  const file = path.join(OUT, `${def.id}.png`);
  fs.writeFileSync(file, canvas.toBuffer('image/png'));
  console.log('✓', def.id, def.theme);
}
console.log('تم — المصغّرات في', OUT);
