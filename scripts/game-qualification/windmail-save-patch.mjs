// Authored source integration, not generated-model output. Exact old source only.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import path from 'node:path';
const directory=path.resolve('examples/game-integrations/windmail-save');
const hash=data=>createHash('sha256').update(data).digest('hex');
export async function windmailSaveIntegration(original){
  const before=original.get('src/main.ts');assert.ok(before);assert.equal(hash(before),'4660b9a9980dc5258708371f934293c506efb0af306fc72d37525a4e2b7b1d17','Original Luna51 main source required; never patch a changed game blindly');
  let main=Buffer.from(before).toString('utf8');
  const replace=(before,after)=>{assert.equal(main.split(before).length,2,'Integration anchor must occur once');main=main.replace(before,after);};
  replace("import {Soundscape} from './sound';",`import {Soundscape} from './sound';
import {createGameSave} from '@companion/game-save';
import {VoyageSaveCoordinator,type SaveNotice,type RecordResult} from './coordinator';
import {VoyageRecoveryUI} from './ui';
import {validVoyageSave,legacyBest,type VoyageSave} from './state';`);
  replace("private mode:'intro'|'sailing'|'paused'|'finished'='intro';","private mode:'loading'|'intro'|'sailing'|'paused'|'finished'='loading';");
  replace(" constructor(){super('voyage')}",` private recoveryUi!:VoyageRecoveryUI;private recovery!:VoyageSaveCoordinator;private recoveryReady=false;private journeyStarted=false;private saveClock=0;
 constructor(){super('voyage')}`);
  replace("this.best=Math.max(0,Number(localStorage.getItem('correio-correntes-best-v1'))||0)","this.best=legacyBest(localStorage.getItem('correio-correntes-best-v1'))");
  const menu=main.indexOf("  this.showOverlay('CORREIO DAS CORRENTES'"),draw=main.indexOf('\n private drawWorld(){',menu);assert.ok(menu>=0&&draw>menu);
  const methods=await readFile(path.join(directory,'methods.ts.txt'),'utf8');
  main=main.slice(0,menu)+`  this.overlay.setVisible(false);this.recoveryUi=new VoyageRecoveryUI();
  this.recovery=new VoyageSaveCoordinator(createGameSave({gameId:'correio-das-correntes',slot:'journey',version:2,validate:validVoyageSave}),notice=>this.saveNotice(notice));
  this.events.once(Phaser.Scenes.Events.SHUTDOWN,()=>{void this.recovery.close().then(()=>this.recoveryUi.destroy())});
  this.refresh();void this.loadJourney();
 }
`+methods+main.slice(draw);
  // Remove only the original definitions; the integrated versions precede drawWorld.
  const legacyStart=main.indexOf("\n private start(){this.mode='sailing'");assert.ok(legacyStart>=0);const pause=main.indexOf('\n private pause(){',legacyStart);assert.ok(pause>legacyStart);main=main.slice(0,legacyStart)+main.slice(pause);
  const legacyRestart=main.indexOf('\n private restart(){this.pausePulseTimer');assert.ok(legacyRestart>=0);const sail=main.indexOf('\n private toggleSail(){',legacyRestart);assert.ok(sail>legacyRestart);main=main.slice(0,legacyRestart)+main.slice(sail);
  replace(" private pause(){if(this.mode==='sailing')"," private pause(){if(!this.recoveryReady||this.recoveryUi?.isOpen)return;if(this.mode==='sailing')");
  replace("'CONTINUAR',()=>this.resume())}else if(this.mode==='paused')","'CONTINUAR',()=>this.resume());this.queueSave()}else if(this.mode==='paused')");
  replace(' private resume(){this.pausePulseTimer'," private resume(){if(!this.recoveryReady||this.recoveryUi?.isOpen)return;this.pausePulseTimer");
  replace("private mute(){this.soundscape.toggle();this.refresh()}","private mute(){if(this.recoveryUi?.isOpen)return;this.soundscape.toggle();this.refresh();this.queueSave()}");
  replace("this.bubble=2}\n private refresh()","this.bubble=2;this.queueSave()}\n private refresh()");
  replace("}this.refresh();\n }\n private deliver()","}this.refresh();this.saveClock+=dt;if(this.saveClock>=5){this.saveClock=0;this.queueSave()}\n }\n private deliver()");
  replace("kb.on('keydown-R',()=>this.restart())","kb.on('keydown-R',()=>{if(!this.recoveryUi?.isOpen)this.restart()})");
  replace("kb.on('keydown-ENTER',()=>{if(this.mode==='intro')this.start();else if(this.mode==='finished')this.restart()})","kb.on('keydown-ENTER',()=>{if(this.recoveryUi?.isOpen)return;if(this.mode==='intro')this.start();else if(this.mode==='finished')this.restart()})");
  const deliver=main.indexOf('\n private deliver(){'),end=main.indexOf('\n}\nnew Phaser.Game',deliver);assert.ok(deliver>=0&&end>deliver);
  main=main.slice(0,deliver)+`
 private deliver(){this.streak++;const bonus=100+this.streak*40+Math.max(0,Math.round(120-this.elapsed/8));this.score+=bonus;this.soundscape.effect('mail');this.leg++;this.bubble=3;
  if(this.leg===islands.length){this.mode='finished';if(this.score>this.best){this.best=this.score;try{localStorage.setItem('correio-correntes-best-v1',String(this.best))}catch{}}this.showFinish();this.queueSave();return}
  this.marker.setPosition(islands[this.leg].dock.x,islands[this.leg].dock.y);this.banner.setText(\`Carta entregue! +\${bonus} • sequência \${this.streak} • próxima: \${islands[this.leg].name}\`);this.queueSave();
 }
`+main.slice(end);
  for(const name of ['start','restart','pause','resume','deliver'])assert.equal(main.split(' private '+name+'(){').length,2,'Exactly one active method: '+name);
  const sound=Buffer.from(original.get('src/sound.ts')).toString('utf8');assert.equal(sound.split(' toggle(){').length,2);
  const files=new Map([['src/main.ts',Buffer.from(main)],['src/sound.ts',Buffer.from(sound.replace(' toggle(){'," setMuted(value:boolean){this.muted=value;if(value)this.ctx?.suspend().catch(()=>{});}\n toggle(){"))]]);
  for(const name of ['state.ts','coordinator.ts','ui.ts','recovery.css']){assert.ok(!original.has('src/'+name),'New integration path must not overwrite another file');files.set('src/'+name,await readFile(path.join(directory,name)));}
  return files;
}
