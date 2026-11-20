import './chrome.css';
import {HeldInputs,type HeldAction} from './input';
type Action='pause'|'mute'|'restart'|'sail';
type Handlers={held:(action:HeldAction,active:boolean)=>void;action:(action:Action)=>void;geometry:()=>void};
export type VoyageView={leg:number;score:number;best:number;target:string;wind:number;changing:boolean;sail:boolean;hits:number;muted:boolean;mode:string;message:string};
const element=<K extends keyof HTMLElementTagNameMap>(tag:K,className:string,text?:string)=>{const node=document.createElement(tag);node.className=className;if(text!==undefined)node.textContent=text;return node;};
const text=(node:HTMLElement,value:string)=>{if(node.textContent!==value)node.textContent=value;};
export class VoyageChrome{
 readonly root=element('main','wm-game-shell');readonly board=element('div','wm-world-frame');readonly saveHome=element('footer','wm-save-home');
 private readonly hud=element('header','wm-hud');private readonly destination=element('h1','wm-destination');
 private readonly navigation=element('p','wm-navigation');private readonly announcement=element('p','wm-mission');
 private readonly stats=element('dl','wm-stats');private readonly controls=element('section','wm-controls');
 private readonly values=new Map<string,HTMLElement>();private readonly buttons=new Map<Action|HeldAction,HTMLButtonElement>();
 private readonly abort=new AbortController();private handlers?:Handlers;private modal=false;private mode='loading';
 private readonly resize=new ResizeObserver(()=>this.handlers?.geometry());
 private readonly holds=new HeldInputs((action,active)=>{this.buttons.get(action)?.setAttribute('aria-pressed',String(active));this.handlers?.held(action,active);});
 constructor(canvas:HTMLCanvasElement){
  document.documentElement.lang='pt-BR';
  const brand=element('p','wm-brand','CORREIO DAS CORRENTES'),navigation=element('nav','wm-actions');navigation.setAttribute('aria-label','Viagem');
  for(const [key,label]of [['letters','Cartas'],['score','Pontos'],['best','Recorde']] as const){const group=element('div','wm-stat');const value=element('dd','',key==='letters'?'0/5':'0');value.id='wm-'+key;this.values.set(key,value);group.append(element('dt','',label),value);this.stats.append(group);}
  for(const [key,label]of [['pause','Pausar'],['mute','Som ligado'],['restart','Nova viagem']] as const)navigation.append(this.actionButton(key,label));
  this.destination.id='wm-destination';this.navigation.id='wm-navigation';this.announcement.id='wm-mission';
  this.announcement.setAttribute('role','status');this.announcement.setAttribute('aria-live','polite');
  this.hud.append(brand,this.destination,this.stats,this.navigation,navigation);
  const stage=element('section','wm-world-viewport');stage.setAttribute('aria-label','Mapa dos cinco portos');this.board.id='wm-world-frame';this.board.append(canvas);
  const labels=element('div','wm-port-labels');labels.setAttribute('aria-hidden','true');
  ['1 Farol','2 Conchas','3 Leste','4 Garças','5 Sol'].forEach((name,index)=>{const label=element('span','wm-port-label',name);label.id='wm-port-'+index;labels.append(label);});this.board.append(labels);stage.append(this.board);
  this.controls.setAttribute('aria-label','Controles do barco');const movement=element('div','wm-movement');
  movement.append(this.heldButton('left','Virar à esquerda','←'),this.heldButton('right','Virar à direita','→'),this.actionButton('sail','Vela aberta'),this.heldButton('drive','Avançar','Avançar'),this.heldButton('reverse','Dar ré','Ré'));
  this.controls.append(this.announcement,movement,element('p','wm-control-help','Segure para manobrar · Setas no teclado · Espaço: vela · P: pausa'));
  this.root.append(this.hud,stage,this.controls,this.saveHome);document.body.append(this.root);this.resize.observe(this.board);
  window.addEventListener('blur',()=>this.releaseInputs(),{signal:this.abort.signal});window.addEventListener('pagehide',()=>this.releaseInputs(),{signal:this.abort.signal});
  document.addEventListener('visibilitychange',()=>{if(document.hidden)this.releaseInputs();},{signal:this.abort.signal});
 }
 connect(handlers:Handlers){this.handlers=handlers;handlers.geometry();}
 releaseInputs(){this.holds.clear();}
 setModal(open:boolean){this.modal=open;if(open)this.releaseInputs();this.hud.inert=open;this.controls.inert=open;this.applyEnabled();}
 private applyEnabled(){
  const playing=this.mode==='sailing'&&!this.modal;this.holds.setEnabled(playing);
  for(const [key,button]of this.buttons)button.disabled=['left','right','drive','reverse','sail'].includes(key)?!playing:this.modal||!['sailing','paused','finished'].includes(this.mode);
 }
 update(state:VoyageView){
  this.mode=state.mode;this.applyEnabled();text(this.destination,state.target);text(this.values.get('letters')!,`${state.leg}/5`);text(this.values.get('score')!,String(state.score));text(this.values.get('best')!,String(state.best));
  text(this.navigation,`Vento ${state.wind}°${state.changing?' · mudando':''} · ${state.hits} ${state.hits===1?'colisão':'colisões'}`);
  text(this.announcement,state.message);text(this.buttons.get('mute')!,state.muted?'Som mudo':'Som ligado');this.buttons.get('mute')!.setAttribute('aria-pressed',String(state.muted));
  text(this.buttons.get('sail')!,state.sail?'Vela aberta':'Vela recolhida');this.buttons.get('sail')!.setAttribute('aria-pressed',String(state.sail));text(this.buttons.get('pause')!,state.mode==='paused'?'Continuar':'Pausar');
 }
 private actionButton(action:Action,label:string){
  const button=element('button','wm-action wm-'+action,label);button.type='button';button.disabled=true;button.id='wm-'+action;
  button.addEventListener('click',()=>this.handlers?.action(action),{signal:this.abort.signal});
  // Native Space/Enter activates this button once, not Phaser's global binding.
  for(const kind of ['keydown','keyup'] as const)button.addEventListener(kind,event=>{if(event.key===' '||event.key==='Enter')event.stopPropagation();},{signal:this.abort.signal});
  this.buttons.set(action,button);return button;
 }
 private heldButton(action:HeldAction,label:string,glyph:string){
  const button=element('button','wm-held wm-'+action,glyph);button.type='button';button.id='wm-'+action;button.setAttribute('aria-label',label);button.setAttribute('aria-pressed','false');button.disabled=true;
  const pointerTouches=new Set<number>();let pointerMouse=false;
  button.addEventListener('pointerdown',event=>{if(event.button!==0||button.disabled)return;event.preventDefault();if(event.pointerType==='mouse')pointerMouse=true;if(event.pointerType==='touch')pointerTouches.add(event.pointerId);button.setPointerCapture(event.pointerId);this.holds.press(action,'pointer:'+event.pointerId);},{signal:this.abort.signal});
  const release=(event:PointerEvent)=>{pointerTouches.delete(event.pointerId);if(event.pointerType==='mouse')pointerMouse=false;this.holds.release(action,'pointer:'+event.pointerId);};
  for(const kind of ['pointerup','pointercancel','lostpointercapture'] as const)button.addEventListener(kind,release,{signal:this.abort.signal});
  // Some native input paths deliver Mouse/Touch events without Pointer events.
  // Keep those sources separate; a compatibility event must not duplicate a
  // contact already claimed by Pointer Events. No browser-name detection.
  button.addEventListener('mousedown',event=>{if(event.button!==0||button.disabled||pointerMouse)return;event.preventDefault();this.holds.press(action,'mouse');},{signal:this.abort.signal});
  window.addEventListener('mouseup',()=>this.holds.release(action,'mouse'),{signal:this.abort.signal});
  button.addEventListener('touchstart',event=>{if(button.disabled||pointerTouches.size)return;event.preventDefault();for(const touch of Array.from(event.changedTouches))this.holds.press(action,'touch:'+touch.identifier);},{signal:this.abort.signal,passive:false});
  const releaseTouches=(event:TouchEvent)=>{for(const touch of Array.from(event.changedTouches))this.holds.release(action,'touch:'+touch.identifier);};
  window.addEventListener('touchend',releaseTouches,{signal:this.abort.signal});window.addEventListener('touchcancel',releaseTouches,{signal:this.abort.signal});
  button.addEventListener('keydown',event=>{if(event.key!==' '&&event.key!=='Enter')return;event.stopPropagation();event.preventDefault();this.holds.press(action,'key:'+event.key);},{signal:this.abort.signal});
  button.addEventListener('keyup',event=>{if(event.key!==' '&&event.key!=='Enter')return;event.stopPropagation();event.preventDefault();this.holds.release(action,'key:'+event.key);},{signal:this.abort.signal});
  button.addEventListener('blur',()=>this.releaseInputs(),{signal:this.abort.signal});this.buttons.set(action,button);return button;
 }
 destroy(){this.releaseInputs();this.resize.disconnect();this.handlers=undefined;this.abort.abort();this.root.remove();}
}
