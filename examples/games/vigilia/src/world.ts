export const TONES = ['Silêncio', 'Maré', 'Vento', 'Estrela'] as const;
export const SYMBOLS = ['○', 'I', 'II', 'III'] as const;
export const REGIONS = [
  {name:'Jardim das conchas', subtitle:'O que o mar deixou', x:0, color:'#b8c997', tuning:[1,2,3],
    memories:['A pedra escuta a MARÉ. Uma volta acorda a água.', 'A folha escuta o VENTO. Duas voltas abrem o céu.', 'A concha escuta a ESTRELA. Três voltas guardam a noite.', 'A última guardiã plantou este jardim onde antes só havia sal.']},
  {name:'Bosque dos sinos', subtitle:'O que o vento levou', x:50, color:'#789e91', tuning:[3,1,2],
    memories:['Aqui a pedra segue a ESTRELA: três voltas.', 'Aqui a folha segue a MARÉ: uma volta.', 'Aqui a concha segue o VENTO: duas voltas.', 'Os sinos eram cartas. Cada viajante deixava uma nota para quem ainda viria.']},
  {name:'Observatório da aurora', subtitle:'O que ainda podemos cuidar', x:100, color:'#cfb89b', tuning:[2,3,1],
    memories:['Na aurora a pedra guarda o VENTO: duas voltas.', 'Na aurora a folha guarda a ESTRELA: três voltas.', 'Na aurora a concha guarda a MARÉ: uma volta.', 'Ninguém precisa guardar o arquipélago sozinho. A luz é uma promessa de volta.']},
] as const;
export const RING_NAMES = ['Pedra','Folha','Concha'] as const;
export type Site = {id:string;kind:'memory'|'ring'|'beacon'|'home';region:number;x:number;z:number;index:number;name:string};
export const SITES:Site[] = [...REGIONS.flatMap((region,i)=>[
  ...[[-8,-6],[8,-5],[-8,7],[9,8]].map(([x,z],index)=>({id:`memory-${i}-${index}`,kind:'memory' as const,region:i,x:region.x+x!,z:z!,index,name:`Memória ${index+1}`})),
  ...[-4,0,4].map((x,index)=>({id:`ring-${i}-${index}`,kind:'ring' as const,region:i,x:region.x+x,z:2,index,name:RING_NAMES[index]!})),
  {id:`beacon-${i}`,kind:'beacon' as const,region:i,x:region.x,z:7,index:0,name:'Farol'},
]),{id:'home',kind:'home',region:0,x:-7,z:-10,index:0,name:'Cais de casa'}];
// These are actual collision geometry, also used by the renderer. No test-only paths.
export const ROCKS=REGIONS.flatMap(r=>[[-2,-5,1.4],[6,6,1.3],[-11,1,1.1],[11,-10,1.2]].map(([x,z,radius])=>({x:r.x+x!,z:z!,radius:radius!})));
export const POSTS=REGIONS.flatMap(r=>[0,1,2].map(i=>({x:r.x-10+i*2,z:-1,radius:.42})));
export type State={version:1;x:number;z:number;heading:number;time:number;notes:string[];rings:number[][];lit:boolean[];ended:boolean;muted:boolean;reducedMotion:boolean};
export const fresh=():State=>({version:1,x:-7,z:-10,heading:0,time:0,notes:[],rings:[[0,0,0],[0,0,0],[0,0,0]],lit:[false,false,false],ended:false,muted:false,reducedMotion:false});
export const unlocked=(s:State)=>Math.min(2,s.lit.filter(Boolean).length);
export function walkable(x:number,z:number,s:State){
  const shore=REGIONS.some((r,i)=>i<=unlocked(s)&&Math.abs(x-r.x)<=14&&Math.abs(z)<=13&&Math.abs(x-r.x)+Math.abs(z)<=24);
  const bridge=[0,1].some(i=>s.lit[i]&&x>=REGIONS[i]!.x+13&&x<=REGIONS[i+1]!.x-13&&Math.abs(z)<=1.65);
  return (shore||bridge)&&![...ROCKS,...POSTS].some(r=>Math.hypot(x-r.x,z-r.z)<r.radius+.45)&&!SITES.some(p=>p.kind!=='home'&&Math.hypot(x-p.x,z-p.z)<(p.kind==='beacon'?1.4:p.kind==='ring'?1.05:.75));
}
export function move(s:State,dx:number,dz:number,seconds:number){
  const dt=Math.max(0,Math.min(.05,seconds));s.time+=dt;
  const length=Math.hypot(dx,dz);if(!length)return false;
  dx/=Math.max(1,length);dz/=Math.max(1,length);const before=[s.x,s.z];
  const x=s.x+dx*5.5*dt,z=s.z+dz*5.5*dt;
  if(walkable(x,s.z,s))s.x=x;if(walkable(s.x,z,s))s.z=z;
  if(s.x!==before[0]||s.z!==before[1]){s.heading=Math.atan2(dx,dz);return true;}return false;
}
export function nearby(s:State):Site|undefined{return SITES.filter(p=>p.region<=unlocked(s)&&Math.hypot(s.x-p.x,s.z-p.z)<2.2).sort((a,b)=>Math.hypot(s.x-a.x,s.z-a.z)-Math.hypot(s.x-b.x,s.z-b.z))[0];}
export function interact(s:State):{kind:'memory'|'tone'|'lit'|'home'|'ending'|'none';text:string;tone?:number}{
  const p=nearby(s);if(!p)return {kind:'none',text:'Aproxime-se de uma inscrição ou de um sino.'};
  const r=REGIONS[p.region]!;
  if(p.kind==='memory'){if(!s.notes.includes(p.id))s.notes.push(p.id);return {kind:'memory',text:r.memories[p.index]!};}
  if(p.kind==='ring'){
    if(s.lit[p.region])return {kind:'tone',text:'Este farol já canta. Seu caminho continua aberto.',tone:s.rings[p.region]![p.index]};
    const values=s.rings[p.region]!;values[p.index]=(values[p.index]!+1)%4;
    if(values.every((n,i)=>n===r.tuning[i])){s.lit[p.region]=true;return {kind:'lit',text:p.region<2?'O farol acordou. Uma ponte surgiu a leste.':'Os três faróis cantam. Volte ao cais para enviar a luz.',tone:3};}
    return {kind:'tone',text:`${p.name} · ${TONES[values[p.index]!]}. As inscrições revelam a canção.`,tone:values[p.index]};
  }
  if(p.kind==='home'){
    if(s.lit.every(Boolean)){s.ended=true;return {kind:'ending',text:'O arquipélago voltou a encontrar seu caminho.'};}
    return {kind:'home',text:'Encontre as inscrições. Afine Pedra, Folha e Concha para acender cada farol.'};
  }
  return {kind:'none',text:s.lit[p.region]?'A luz está acesa.':'Três sinos guardam este farol. As memórias ensinam suas notas.'};
}
export function valid(value:unknown):value is State{
  if(!value||typeof value!=='object')return false;const s=value as State;
  if(s.version!==1||!['x','z','heading','time'].every(k=>typeof s[k as keyof State]==='number'&&Number.isFinite(s[k as keyof State] as number))||s.time<0||s.time>1e8||typeof s.ended!=='boolean'||typeof s.muted!=='boolean'||typeof s.reducedMotion!=='boolean')return false;
  if(!Array.isArray(s.lit)||s.lit.length!==3||!s.lit.every(v=>typeof v==='boolean')||s.lit.some((v,i)=>v&&i>0&&!s.lit[i-1]))return false;
  if(!Array.isArray(s.rings)||s.rings.length!==3||!s.rings.every((a,i)=>Array.isArray(a)&&a.length===3&&a.every(v=>Number.isInteger(v)&&v>=0&&v<=3)&&(!s.lit[i]||a.every((v,j)=>v===REGIONS[i]!.tuning[j]))))return false;
  if(!Array.isArray(s.notes)||s.notes.length>12||new Set(s.notes).size!==s.notes.length||!s.notes.every(id=>SITES.some(p=>p.id===id&&p.kind==='memory'&&p.region<=unlocked(s))))return false;
  return (!s.ended||s.lit.every(Boolean))&&walkable(s.x,s.z,s);
}
