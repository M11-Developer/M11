// لقطة على الخريطة البحرية الجديدة
import napiCanvas from '@napi-rs/canvas';
const { createCanvas, loadImage } = napiCanvas;
import fs from 'node:fs'; import path from 'node:path';
const ROOT='/home/user/M11', WEB=path.join(ROOT,'web');
process.chdir(WEB);
globalThis.document={createElement(t){if(t==='canvas')return createCanvas(1,1);return {style:{},appendChild(){},addEventListener(){},removeEventListener(){}};},getElementById:()=>null,body:{appendChild(){},style:{}},addEventListener(){},removeEventListener(){}};
globalThis.window=globalThis; globalThis.performance=globalThis.performance||{now:()=>Date.now()};
globalThis.requestAnimationFrame=(cb)=>setTimeout(()=>cb(performance.now()),0);
globalThis.Image=napiCanvas.Image;
const resolve=(v)=> path.isAbsolute(v) ? v : path.join(WEB, v);
globalThis.fetch=async(url)=>{const p=resolve(url);const t=fs.readFileSync(p,'utf8');return {ok:true,json:async()=>JSON.parse(t),text:async()=>t};};
const { GameWorld } = await import(path.join(WEB,'src/game/game.js'));
const { Renderer, loadBackdrops } = await import(path.join(WEB,'src/render/renderer.js'));
const { Camera } = await import(path.join(WEB,'src/render/camera.js'));
const { Assets, CONFIG } = await import(path.join(WEB,'src/core/assets.js'));
const { MAPS } = await import(path.join(WEB,'src/game/world.js'));
Assets.base = path.join(ROOT,'project/assets/atlases')+'/';
const names=['world','vfx','ui','weapons','arms',...Object.keys(JSON.parse(fs.readFileSync(Assets.base+'characters_meta.json','utf8')).operators).map(o=>'char_'+o)];
await Assets.load(names);
await loadBackdrops(Assets,()=>{});
const mapId = process.argv[2] || 'harbor';
const world = new GameWorld({ mode:'tdm', mapDef: MAPS.find(m=>m.id===mapId), seed: 31337, warmup: 0, difficulty: 2 });
for (let i=0;i<7;i++) world.addActor({ isBot:true, team:i%2, name:'بوت'+i, difficulty:2, seed: 400+i, opKey:'rashid' });
const cv = createCanvas(CONFIG.internalWidth, CONFIG.internalHeight);
const renderer = new Renderer(cv, Assets);
renderer.setLevel(world.level, null);
const cam = new Camera(); cam.setBounds(world.level);
for (let f=1; f<=420; f++) {
  world.update(1/60);
  const a = world.actors[f % world.actors.length];
  cam.update(1/60, a, { aimX: a.facing, playing: true });
  renderer.draw(world, cam, a, 1/60, { playing:true });
  if (f===300) fs.writeFileSync(`/tmp/map_${mapId}.png`, cv.toBuffer('image/png'));
}
console.log('map', mapId, 'actors', world.actors.length, 'kills', world.actors.reduce((s,a)=>s+a.kills,0));
