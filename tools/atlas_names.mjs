import fs from "node:fs";
import { Assets } from "../web/src/core/assets.js";

// أسماء الأطالس المطلوبة: الأساسية + أطالس العناصر/التايلات المولّدة (إن وُجدت).
// تُقرأ من ملفات المانيفست تمامًا كما يفعل main.js — فلا تختبر الأداة شيئًا آخر غير اللعبة.
export function atlasNames() {
  const base = ['world', 'vfx', 'ui', 'weapons', 'arms'];
  try {
    const meta = JSON.parse(fs.readFileSync(Assets.base + 'characters_meta.json', 'utf8'));
    for (const o of Object.keys(meta.operators || {})) base.push('char_' + o);
  } catch (e) { /* بلا شخصيات: نكمل */ }
  for (const [file, pick] of [['props_manifest.json', (e) => e.atlas],
                              ['tiles_manifest.json', (e) => 'tiles_' + e.theme]]) {
    try {
      const list = JSON.parse(fs.readFileSync(Assets.base + file, 'utf8'));
      for (const e of list) if (e && pick(e)) base.push(pick(e));
    } catch (e) { /* لا مانيفست: نكمل */ }
  }
  return base;
}
