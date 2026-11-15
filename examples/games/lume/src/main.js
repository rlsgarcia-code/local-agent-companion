import Phaser from 'phaser';
import {LEVELS,CHAPTERS} from './levels';
import {initial,step,respawn} from './simulation';
import {Save} from './save';
import {Art} from './art';
import {Audio} from './audio';
import './style.css';

document.documentElement.lang='pt-BR';
let storage;try{storage=window.localStorage;}catch{}
const save=new Save(storage),audio=new Audio(),keys=new Set(),pointers=new Map();
audio.muted=save.value.muted;
let mode='title',index=0,state=initial(LEVELS[0]),scene,art,noticeUntil=0,hintUntil=0,autoSave=0;
const input={left:false,right:false,jump:false};
const ui=document.createElement('div');ui.id='lume-ui';
ui.innerHTML=`<section id="panel" class="panel enter" aria-label="Lume"></section>
<div id="hud" hidden><div class="topbar"><div class="level-label"><span class="wordmark">lume</span><span class="level-name" id="level-name"></span></div><span class="status" id="seed-count" aria-live="polite"></span><div class="tools"><button id="mute" aria-label="Alternar áudio"></button><button id="pause" aria-label="Pausar jogo">Pausa Ⅱ</button></div></div><div class="hint" id="hint"></div><div class="notice" id="notice" role="status"></div><div class="progress-line"><span id="progress"></span></div></div>
<div id="touch" hidden><div class="directions"><button data-input="left" aria-label="Andar para a esquerda">‹</button><button data-input="right" aria-label="Andar para a direita">›</button></div><button data-input="jump" aria-label="Saltar">SALTAR</button></div>`;
document.body.append(ui);
const el=id=>document.getElementById(id),panel=el('panel'),canvas=document.querySelector('#game');canvas.tabIndex=0;canvas.setAttribute('aria-label','Lume — Jardim Suspenso. Setas para andar e Espaço para saltar.');
el('touch').classList.toggle('forced',navigator.maxTouchPoints>0);
function syncInput(){input.left=keys.has('arrowleft')||keys.has('a')||[...pointers.values()].includes('left');input.right=keys.has('arrowright')||keys.has('d')||[...pointers.values()].includes('right');input.jump=keys.has(' ')||keys.has('arrowup')||keys.has('w')||[...pointers.values()].includes('jump');}
function release(){keys.clear();pointers.clear();syncInput();for(const button of ui.querySelectorAll('[data-input]'))button.classList.remove('pressed');}
function action(label,id,primary=false){return `<button id="${id}" class="${primary?'primary':'secondary'}">${label}</button>`;}
function show(markup,center=false){panel.innerHTML=markup;panel.className=`panel enter${center?' center':''}`;panel.hidden=false;el('touch').hidden=true;release();const first=panel.querySelector('button');first?.focus({preventScroll:true});}
function storeCurrent(){if(!['play','paused'].includes(mode))return;save.value.current={level:index,checkpoint:state.checkpoint,seeds:[...state.seeds],elapsed:state.time,deaths:state.deaths};save.write();}
function title(){mode='title';audio.stop();el('hud').hidden=true;show(`<span class="eyebrow">UM PEQUENO CAMINHO DE LUZ</span><h1 class="title">lume</h1><p class="subtitle">Jardim Suspenso</p><p class="description">Os jardins perderam seu brilho.<br>Uma pequena semente pode trazê-lo de volta.</p><div class="actions">${action(save.value.current?'Continuar':'Jogar','start',true)}${action('Os jardins','map')}</div><p class="fine">Doze jardins. Nenhuma pressa.<br>Setas ou A/D para andar · Espaço para saltar</p><p class="credit">ARTE, MÚSICA E UMA PEQUENA AVENTURA ORIGINAL</p>`);el('start').onclick=()=>start(save.value.current?.level??save.value.unlocked,true);el('map').onclick=map;}
function map(){storeCurrent();mode='map';audio.stop();el('hud').hidden=true;show(`<span class="eyebrow">O CAMINHO ATÉ AQUI</span><h2 class="subtitle">Os jardins</h2><div class="chapter-list">${CHAPTERS.map((name,c)=>`<div class="chapter"><h3>${name}</h3>${LEVELS.slice(c*4,c*4+4).map((l,j)=>{const n=c*4+j;return `<button class="level-select" data-level="${n}" ${n>save.value.unlocked?'disabled':''}>${String(n+1).padStart(2,'0')} · ${l.name}<span>${'✦'.repeat(save.value.stars[n])||'· · ·'}</span></button>`;}).join('')}</div>`).join('')}</div><p class="fine">Uma semente abre o próximo jardim. As três guardam um brilho especial.</p>${action('Voltar','back')}`,true);for(const b of panel.querySelectorAll('[data-level]'))b.onclick=()=>start(Number(b.dataset.level));el('back').onclick=title;}
async function start(next,resume=false){
  index=next;const current=resume&&save.value.current?.level===index?save.value.current:null;state=initial(LEVELS[index],current?.checkpoint??false,current?.seeds??[]);if(current){state.time=current.elapsed;state.deaths=current.deaths;}
  mode='play';panel.hidden=true;el('hud').hidden=false;el('touch').hidden=false;el('level-name').textContent=`${String(index+1).padStart(2,'0')} · ${LEVELS[index].name}`;el('hint').textContent=LEVELS[index].hint;hintUntil=performance.now()+7000;noticeUntil=0;release();const width=art.viewportWidth??960;art.camera=Math.max(0,Math.min(LEVELS[index].width-width,state.x-width*.36));canvas.focus({preventScroll:true});storeCurrent();
  await audio.unlock();if(mode==='play')audio.start();updateMute();
  if(!save.available)notice('O progresso fica nesta partida: armazenamento indisponível.',5000);
}
function notice(text,ms=2300){el('notice').textContent=text;noticeUntil=performance.now()+ms;}
function pause(){if(mode!=='play')return;storeCurrent();mode='paused';audio.stop();el('hud').hidden=true;show(`<span class="eyebrow">UM INSTANTE PARA RESPIRAR</span><h2>Jardim em pausa</h2><div class="actions">${action('Continuar','resume',true)}${action('Ponto seguro','retry')}</div><div class="actions">${action('Os jardins','map')}${action('Início','home')}</div><p class="fine">P ou Escape para continuar · R para o ponto seguro</p>`,true);el('resume').onclick=resume;el('retry').onclick=()=>{respawn(state,LEVELS[index]);resume();storeCurrent();};el('map').onclick=map;el('home').onclick=title;}
async function resume(){if(mode!=='paused')return;mode='play';panel.hidden=true;el('hud').hidden=false;el('touch').hidden=false;release();canvas.focus({preventScroll:true});await audio.unlock();if(mode==='play')audio.start();}
function completed(){save.finish(index,state.seeds.length,Math.max(.01,state.time));mode='complete';release();audio.stop();audio.effect('complete');el('hud').hidden=true;const last=index===11;show(`<span class="eyebrow">${last?'O CAMINHO FLORESCEU':'MAIS UMA LUZ NO JARDIM'}</span><h2>${last?'O jardim voltou a brilhar.':LEVELS[index].name}</h2><div class="stars" aria-label="${state.seeds.length} de 3 sementes">${'✦'.repeat(state.seeds.length)}${'·'.repeat(3-state.seeds.length)}</div><p class="description">${last?'Lume encontrou seu lugar.<br>Os jardins continuam aqui para você.':`${Math.floor(state.time/60)}:${String(Math.floor(state.time%60)).padStart(2,'0')} de caminho · ${state.deaths} recomeços`}</p><div class="actions">${action(last?'Os jardins':'Próximo jardim','next',true)}${action('Jogar de novo','again')}</div>${last?'<p class="fine">Fim da aventura · Obrigado por trazer a luz.</p>':''}`,true);el('next').onclick=()=>last?map():start(index+1);el('again').onclick=()=>start(index);}
function updateMute(){el('mute').textContent=audio.muted?'Som desligado':'Som ligado';el('mute').setAttribute('aria-pressed',String(!audio.muted));}
el('pause').onclick=pause;el('mute').onclick=async()=>{await audio.unlock();audio.mute(!audio.muted);save.value.muted=audio.muted;save.write();updateMute();};
window.addEventListener('keydown',e=>{
  const key=e.key.toLowerCase();if(['arrowleft','arrowright','arrowup',' ','w','a','d'].includes(key)&&mode==='play'){e.preventDefault();keys.add(key);syncInput();}
  if(e.repeat)return;
  if(key==='escape'||key==='p'){if(mode==='play'){e.preventDefault();pause();}else if(mode==='paused'){e.preventDefault();resume();}}
  if(key==='r'&&mode==='play'){respawn(state,LEVELS[index]);audio.effect('respawn');storeCurrent();}
});
window.addEventListener('keyup',e=>{keys.delete(e.key.toLowerCase());syncInput();});
for(const button of ui.querySelectorAll('[data-input]')){
  button.addEventListener('pointerdown',e=>{if(mode!=='play')return;e.preventDefault();button.setPointerCapture(e.pointerId);pointers.set(e.pointerId,button.dataset.input);button.classList.add('pressed');syncInput();});
  for(const name of ['pointerup','pointercancel','lostpointercapture'])button.addEventListener(name,e=>{pointers.delete(e.pointerId);if(![...pointers.values()].includes(button.dataset.input))button.classList.remove('pressed');syncInput();});
}
document.addEventListener('visibilitychange',()=>{if(document.hidden)pause();});window.addEventListener('blur',()=>{release();pause();});window.addEventListener('pagehide',()=>{storeCurrent();audio.close();});
new Phaser.Game({type:Phaser.CANVAS,canvas,width:window.innerWidth,height:window.innerHeight,backgroundColor:'#091f29',antialias:true,scale:{mode:Phaser.Scale.RESIZE,autoCenter:Phaser.Scale.CENTER_BOTH},scene:{
  create(){scene=this;art=new Art(this);title();updateMute();},
  update(_time,delta){const dt=Math.max(0,Math.min(.06,delta/1000));
    if(mode==='play'){
      const events=step(state,LEVELS[index],input,dt);for(const event of events){if(['jump','seed','checkpoint','respawn'].includes(event))audio.effect(event);if(event==='seed'){art.particles(state.x,state.y,18);storeCurrent();}if(event==='land')art.particles(state.x,state.y+18,4);if(event==='checkpoint'){notice('Ponto seguro aceso');art.particles(state.x,state.y,24);storeCurrent();}if(event==='respawn'){notice('A luz espera por você. Tente outra vez.');storeCurrent();}if(event==='locked')notice('Uma semente acende a saída.');if(event==='complete')completed();}
      autoSave+=dt;if(autoSave>2){autoSave=0;storeCurrent();}
    }
    const visual=mode==='title'?{...state,x:LEVELS[index].width*.65,y:441,vx:0,ground:'title',invulnerable:0}:state;
    art.draw(LEVELS[index],visual,dt,mode==='title');const count=`${'✦'.repeat(state.seeds.length)}${'·'.repeat(3-state.seeds.length)} / 3`;
    // Update live regions only when their value changes, not on every frame.
    if(el('seed-count').textContent!==count)el('seed-count').textContent=count;
    el('progress').style.width=`${Math.max(0,Math.min(100,state.x/LEVELS[index].width*100))}%`;el('hint').style.opacity=performance.now()<hintUntil?'1':'0';if(performance.now()>noticeUntil&&el('notice').textContent)el('notice').textContent='';
  }
}});
