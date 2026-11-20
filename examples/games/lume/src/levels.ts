export type Platform={id:string;x:number;y:number;width:number;height:number;oneWay?:boolean;motion?:{axis:"x"|"y";distance:number;period:number}};
export type Level={id:string;name:string;chapter:number;hint:string;width:number;platforms:Platform[];spikes:{x:number;y:number;width:number;height:number}[];winds:{x:number;y:number;width:number;height:number}[];seeds:{id:string;x:number;y:number}[];checkpoint:{x:number;y:number};exit:{x:number;y:number}};
type Layout={name:string;width:number;gaps:[number,number][];spikes?:number[];terraces?:[number,number,number][];wind?:number[];moving?:[number,number,"x"|"y"][];hint:string};
const layouts:Layout[]=[
  {name:"O primeiro brilho",width:1500,gaps:[[480,100],[1060,100]],terraces:[[290,380,130],[740,380,150]],hint:"Uma semente acende a saída. Espaço para saltar."},
  {name:"Entre as folhas",width:1650,gaps:[[400,120],[970,130]],spikes:[700],terraces:[[640,370,130],[1290,370,150]],hint:"Solte o salto mais cedo para pousar com precisão."},
  {name:"Orvalho",width:1750,gaps:[[510,140],[1190,140]],spikes:[900],terraces:[[300,380,140],[820,370,150],[1470,370,130]],hint:"A lanterna guarda seu caminho. Você pode tentar de novo."},
  {name:"A ponte da lua",width:1800,gaps:[[450,150],[1090,150]],spikes:[780,1480],terraces:[[650,380,130],[1340,370,130]],hint:"As sementes mais altas são desafios opcionais."},
  {name:"O sopro do vale",width:1750,gaps:[[470,130],[1190,140]],wind:[730],terraces:[[720,300,160],[1430,370,140]],hint:"Entre no vento para ganhar altura."},
  {name:"Pólen no ar",width:1900,gaps:[[530,140],[1230,150]],wind:[810],spikes:[1490],terraces:[[800,300,170],[1530,370,130]],hint:"O vento carrega você. Escolha onde pousar."},
  {name:"Caminhos do céu",width:1950,gaps:[[450,145],[1100,150],[1570,130]],wind:[760,1390],terraces:[[750,300,150],[1370,300,150]],hint:"Há mais de um caminho por este jardim."},
  {name:"A canção das folhas",width:2050,gaps:[[570,150],[1260,155]],wind:[900],spikes:[400,1600],terraces:[[880,300,180],[1670,370,130]],hint:"Guarde o ritmo: correr, saltar, respirar."},
  {name:"Pedras que dançam",width:1800,gaps:[[500,140],[1140,140]],moving:[[760,350,"y"]],terraces:[[1440,370,140]],hint:"As pedras em movimento também são um caminho."},
  {name:"Maré de estrelas",width:2050,gaps:[[420,145],[1120,150],[1630,145]],moving:[[720,360,"x"],[1400,350,"y"]],terraces:[[1860,370,100]],hint:"Espere a pedra se aproximar antes de saltar."},
  {name:"O coração suspenso",width:2150,gaps:[[530,150],[1190,155],[1720,150]],spikes:[390,1530],wind:[890],moving:[[1450,340,"y"]],terraces:[[870,300,160],[1940,370,120]],hint:"Tudo o que aprendeu encontra um lugar aqui."},
  {name:"Jardim de luz",width:2300,gaps:[[470,140],[1140,150],[1750,150]],spikes:[780,1480],wind:[940],moving:[[1580,345,"x"]],terraces:[[920,300,160],[2030,370,140]],hint:"Leve a última luz para casa."},
];

export const CHAPTERS=["Raízes de luz","O caminho do vento","Jardim suspenso"];
export const LEVELS:Level[]=layouts.map((layout,i)=>{
  const platforms:Platform[]=[];let start=0;
  for(const [x,gap]of [...layout.gaps,[layout.width,0] as [number,number]]){platforms.push({id:`ground-${start}`,x:start,y:460,width:x-start,height:160});start=x+gap;}
  for(const [j,[x,y,width]]of (layout.terraces??[]).entries())platforms.push({id:`terrace-${j}`,x,y,width,height:22,oneWay:true});
  for(const [j,[x,y,axis]]of (layout.moving??[]).entries())platforms.push({id:`moving-${j}`,x,y,width:125,height:24,oneWay:true,motion:{axis,distance:axis==="x"?75:45,period:4.5+j}});
  const checkpointGround=platforms.filter(p=>p.id.startsWith("ground")&&p.x<layout.width*.7&&p.x+p.width>layout.width*.5).at(-1)!;
  const checkpoint={x:Math.min(checkpointGround.x+checkpointGround.width-85,Math.max(checkpointGround.x+60,layout.width*.56)),y:441};
  const elevated=platforms.find(p=>p.id.startsWith("terrace"))??platforms.find(p=>p.motion)!;
  return {id:`garden-${i+1}`,name:layout.name,chapter:Math.floor(i/4),hint:layout.hint,width:layout.width,platforms,
    spikes:(layout.spikes??[]).map(x=>({x,y:446,width:38,height:14})),winds:(layout.wind??[]).map(x=>({x,y:280,width:85,height:180})),
    seeds:[{id:"a",x:230,y:420},{id:"b",x:elevated.x+elevated.width/2,y:elevated.y-36},{id:"c",x:layout.width-240,y:420}],
    checkpoint,exit:{x:layout.width-90,y:426}};
});
