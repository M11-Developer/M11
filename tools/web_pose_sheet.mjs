// لوحة فحص: ترسم الشخصية + الأذرع + السلاح بزوايا تصويب مختلفة للتأكد من التركيب.
import napiCanvas from '@napi-rs/canvas';
const { createCanvas, Image } = napiCanvas;
import fs from 'node:fs'; import path from 'node:path';
const ROOT='/home/user/M11', WEB=path.join(ROOT,'web');
globalThis.document={createElement:(t)=>t==='canvas'?createCanvas(1,1):{style:{},appendChild(){},addEventListener(){}},getElementById:()=>null,body:{appendChild(){}},addEventListener(){},removeEventListener(){}};
globalThis.window=globalThis; globalThis.Image=Image;
const resolvePath=(v)=>v.startsWith('file:')?new URL(v).pathname:(path.isAbsolute(v)?v:(v.startsWith('assets/')?path.join(ROOT,'project',v):path.join(WEB,v)));
globalThis.fetch=async(u)=>{const t=fs.readFileSync(resolvePath(u),'utf8');return{ok:true,json:async()=>JSON.parse(t)}};
const { Assets, CONFIG } = await import(path.join(WEB,'src/core/assets.js'));
const { Renderer } = await import(path.join(WEB,'src/render/renderer.js'));
Assets.base = path.join(ROOT,'project/assets/atlases') + '/';
const ops = Object.keys(JSON.parse(fs.readFileSync(Assets.base+'characters_meta.json','utf8')).operators);
await Assets.load(['world','vfx','ui','weapons','arms', ...ops.map(o=>'char_'+o)]);
const charMeta = await Assets.loadJson('characters_meta.json');
const canvas = createCanvas(CONFIG.internalWidth, CONFIG.internalHeight);
const r = new Renderer(canvas, Assets);
const ctx = canvas.getContext('2d');
const W = canvas.width, H = canvas.height;
ctx.fillStyle = '#3A4048'; ctx.fillRect(0,0,W,H);
const angles = [0, 30, 60, -30, -60, 120, 150, 180, -120, 90];
const postures = ['stand','crouch','prone','jet'];
let x = 8, y = 60;
ctx.font = '8px monospace';
for (const op of ['rashid','hala','tariq']) {
  x = 8; y += 78;
  for (const ang of angles) {
    const fake = { id: 1, opKey: op, aimAngle: ang*Math.PI/180, facing: (Math.abs(ang)>90? -1: 1), weaponId: 'jabha',
      prone:false, crouch:false, jetpackOn:false, ads:false, x:0, y:0, w:16, h:62, cx:0, cy:31, alive:true, state:'idle' };
    const pivotX = x + 24, feetY = y + 62;
    r.spritePivot(ctx, Assets.get('char_'+op), `${op}/idle/0`, pivotX, feetY, [charMeta.origin[0], charMeta.baseline], fake.facing<0);
    r.drawArmsAndWeapon(ctx, fake, charMeta, pivotX, feetY, charMeta.origin[0], charMeta.baseline, fake.facing<0);
    ctx.fillStyle='#FFFFFF'; ctx.fillText(`${op} ${ang}`, x, y+74);
    x += 66;
  }
}
// postures row
x = 8; y += 92;
for (const post of postures) {
  for (const ang of [0, 45, -45]) {
    const fake = { id: 1, opKey:'rashid', aimAngle: ang*Math.PI/180, facing:1, weaponId:'shaheen',
      prone: post==='prone', crouch: post==='crouch', jetpackOn: post==='jet', ads:false, x:0,y:0,w:16,h:62,cx:0,cy:31,alive:true,state:'idle' };
    const anim = post==='prone'?'prone':post==='crouch'?'prone':post==='jet'?'jetpack':'idle';
    const pivotX = x + 22, feetY = y + 62;
    r.spritePivot(ctx, Assets.get('char_rashid'), `rashid/${anim}/0`, pivotX, feetY, [charMeta.origin[0], charMeta.baseline], false);
    r.drawArmsAndWeapon(ctx, fake, charMeta, pivotX, feetY, charMeta.origin[0], charMeta.baseline, false);
    ctx.fillStyle='#FFFFFF'; ctx.fillText(`${post} ${ang}`, x, y+74);
    x += 92;
  }
}
fs.writeFileSync('/tmp/pose_sheet.png', canvas.toBuffer('image/png'));
console.log('pose sheet saved');
