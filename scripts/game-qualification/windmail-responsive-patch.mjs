// Authored UI integration. Exact save revision52; never a physics/test repair.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import path from 'node:path';
const sha=b=>createHash('sha256').update(b).digest('hex');
export async function windmailResponsiveIntegration(original){
 const before=original.get('src/main.ts');assert.ok(before);assert.equal(sha(before),'dafe333130596dafe6ba5e42c0e16f74d8a33364cd740285e970de31cabcd1c8');
 assert.equal(sha(original.get('src/world.ts')),'05509bd1a6160b09bb991767e8800a6d5b80181a6d9ee4a1d2bb3fd1c7445d4e');
 assert.equal(sha(original.get('src/ui.ts')),'a932759ee2cd175d7725a8859ea1631339f39d3f873ef1de7430fa1d79948975');
 let main=Buffer.from(before).toString('utf8');const replace=(a,b)=>{assert.equal(main.split(a).length,2,'Exact responsive integration anchor required');main=main.replace(a,b);};
 const method=(name,next,body)=>{const a=main.indexOf('\n private '+name+'('),b=main.indexOf('\n '+(next==='update'?'':'private ')+next+'(',a);assert.ok(a>=0&&b>a);main=main.slice(0,a)+'\n'+body+main.slice(b);};
 replace("import {Soundscape} from './sound';","import {Soundscape} from './sound';\nimport {VoyageChrome} from './chrome';");
 replace("private touch={left:false,right:false,drive:false}","private touch={left:false,right:false,drive:false,reverse:false}");
 replace("private recoveryUi!:VoyageRecoveryUI;","private view=layout;private recoveryUi!:VoyageRecoveryUI;");
 replace("this.add.rectangle(W/2,36,W,72,0x092f42,.91).setDepth(9);",'');
 replace("this.windArrow=this.add.graphics().setDepth(11);","this.windArrow=this.add.graphics().setDepth(11).setVisible(false);");
 replace("}).setDepth(12);\n  this.banner=","}).setDepth(12).setVisible(false);\n  this.banner=");
 replace("}).setOrigin(.5,0).setDepth(12);","}).setOrigin(.5,0).setDepth(12).setVisible(false);");
 const buttonStart=main.indexOf("  this.makeButton(840,34,"),buttonEnd=main.indexOf("  this.overlay=this.add.container",buttonStart);assert.ok(buttonStart>=0&&buttonEnd>buttonStart);main=main.slice(0,buttonStart)+main.slice(buttonEnd);
 replace('this.recoveryUi=new VoyageRecoveryUI();',`this.view.connect({geometry:()=>{this.scale.getParentBounds();this.scale.refresh()},held:(action,active)=>{if(!active||this.mode==='sailing')this.touch[action]=active;},action:action=>{if(action==='pause')this.pause();else if(action==='mute')this.mute();else if(action==='restart')this.restart();else this.toggleSail();}});
  this.recoveryUi=new VoyageRecoveryUI(open=>{this.releaseInput();this.view.setModal(open)},this.view.saveHome);`);
 replace('this.recoveryUi.destroy())','{this.recoveryUi.destroy();this.view.destroy()})');
 replace('this.journeyStarted=false;this.touch.left=this.touch.right=this.touch.drive=false;', 'this.journeyStarted=false;this.releaseInput();');
 replace("this.banner.setText('Próxima entrega: '+islands[this.leg].name);this.queueSave();","this.banner.setText('Próxima entrega: '+islands[this.leg].name);this.refresh();this.queueSave();");
 // DOM labels remain readable independently of world scale.
 const labelStart=main.indexOf('this.add.text(a.x,a.y-53,'),labelEnd=main.indexOf('.setOrigin(.5).setDepth(5)',labelStart);assert.ok(labelStart>=0&&labelEnd>labelStart);main=main.slice(0,labelStart)+main.slice(labelEnd+'.setOrigin(.5).setDepth(5)'.length);
 replace("  this.input.on('pointerup',()=>{this.touch.left=this.touch.right=this.touch.drive=false});",'');
 const release=` private releaseInput(){this.touch.left=this.touch.right=this.touch.drive=this.touch.reverse=false;this.view.releaseInputs();for(const key of Object.values(this.keys??{}))key.reset();}`;
 method('makeButton','layoutControls',release);
 method('layoutControls','showOverlay',' private layoutControls(){}');
 method('showOverlay','pause',` private showOverlay(title:string,description:string,button:string,action:()=>void){
  this.overlay.setVisible(false);const choices=[{label:button,run:()=>{this.recoveryUi.hide();this.soundscape.unlock();action()}}];
  if(this.mode==='paused')choices.push({label:'Nova viagem',run:()=>{this.recoveryUi.hide();this.restart()}});
  this.recoveryUi.show(title,description,choices,this.mode==='paused'?()=>this.resume():undefined);
 }`);
 method('pause','resume',` private pause(){
  if(!this.recoveryReady)return;if(this.mode==='paused'&&!this.recoveryUi.isOpen){this.resume();return}if(this.mode!=='sailing'||this.recoveryUi.isOpen)return;
  this.mode='paused';this.releaseInput();this.showOverlay('Viagem em pausa','A viagem e o vento aguardam você. Continue pelo botão, P ou Esc.','Continuar',()=>this.resume());this.refresh();this.queueSave();
 }`);
 replace("private onBlur(){this.touch.left=this.touch.right=this.touch.drive=false;","private onBlur(){this.releaseInput();");
 method('refresh','update',` private refresh(){this.view.update({leg:this.leg,score:this.score,best:this.best,target:islands[this.leg]?.name??'Rota concluída',wind:Math.round((this.wind*180/Math.PI+360)%360),changing:this.windClock<15&&this.windClock>0,sail:this.sail,hits:this.hits,muted:this.soundscape.isMuted,mode:this.mode,message:this.banner.text});}`);
 replace('Number(this.keys.DOWN.isDown)','Number(this.keys.DOWN.isDown||this.touch.reverse)');
 replace("this.mode='finished';this.marker.setVisible(false);this.showOverlay", "this.mode='finished';this.marker.setVisible(false);this.banner.setText('Cinco cartas entregues. Viagem concluída.');this.refresh();this.showOverlay");
 const ending="new Phaser.Game({type:Phaser.CANVAS,canvas:";replace(ending,"const layout=new VoyageChrome(document.querySelector('#game') as HTMLCanvasElement);\nnew Phaser.Game({type:Phaser.CANVAS,parent:layout.board,canvas:");
 // Only the input OR changes inside simulation, with exactly the same formulas.
 const simulation=s=>s.slice(s.indexOf(' update(_time:'),s.indexOf('\n private deliver(){'));
 assert.equal(simulation(main).replace('this.keys.DOWN.isDown||this.touch.reverse','this.keys.DOWN.isDown'),simulation(Buffer.from(before).toString('utf8')),'Physics must remain byte-identical after normalizing touch reverse input');
 const files=new Map([['src/main.ts',Buffer.from(main)]]);
 const dir=path.resolve('examples/game-integrations/windmail-responsive');
 for(const [source,target]of [['chrome.ts','src/chrome.ts'],['chrome.css','src/chrome.css'],['input.ts','src/input.ts'],['recovery.ts','src/ui.ts']]){if(target!=='src/ui.ts')assert.ok(!original.has(target));files.set(target,await readFile(path.join(dir,source)));}
 return files;
}
