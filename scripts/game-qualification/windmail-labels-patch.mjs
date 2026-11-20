// Player-facing label occlusion repair in an exact responsive revision53 copy.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';
const sha=b=>createHash('sha256').update(b).digest('hex');
export async function windmailLabelsIntegration(files){
 const before=files.get('src/main.ts');assert.equal(sha(before),'2927b2bdbd19cf6c7b6e009ee3bfc9147889efa2fdbca3e19a8ad4126d8c215e');
 assert.equal(sha(files.get('src/chrome.ts')),'65d9733bf98e98f2344883e03c7da3a3b4a92f9b679ab8c0f2a5a7655b2742f7');
 assert.equal(sha(files.get('src/world.ts')),'05509bd1a6160b09bb991767e8800a6d5b80181a6d9ee4a1d2bb3fd1c7445d4e');
 let main=before.toString('utf8');const replace=(a,b)=>{assert.equal(main.split(a).length,2);main=main.replace(a,b);};
 replace('private view=layout;','private boatBounds=new Phaser.Geom.Rectangle();private view=layout;');
 replace('mode:this.mode,message:this.banner.text});','mode:this.mode,message:this.banner.text,boatBounds:this.boat.getBounds(this.boatBounds)});');
 const simulation=s=>s.slice(s.indexOf(' update(_time:'),s.indexOf('\n private deliver(){'));
 assert.equal(simulation(main),simulation(before.toString('utf8')),'Simulation must remain byte-identical');
 const chrome=await readFile(new URL('../../examples/game-integrations/windmail-labels/chrome.ts',import.meta.url));
 return new Map([['src/main.ts',Buffer.from(main)],['src/chrome.ts',chrome]]);
}
