export type Journey = {
  x:number;y:number;angle:number;speed:number;sail:boolean;wind:number;nextWind:number;
  windClock:number;elapsed:number;leg:number;score:number;streak:number;hits:number;
  lastHit:number;phase:'active'|'finished';
};
export type VoyageSave={format:2;best:number;muted:boolean;journey:Journey|null};
const object=(value:unknown):value is Record<string,unknown>=>Boolean(value&&typeof value==='object'&&!Array.isArray(value));
const keys=(value:Record<string,unknown>,names:string[])=>Object.keys(value).sort().join('|')===[...names].sort().join('|');
const number=(value:unknown,min:number,max:number)=>typeof value==='number'&&Number.isFinite(value)&&value>=min&&value<=max;
const integer=(value:unknown,min:number,max:number)=>number(value,min,max)&&Number.isSafeInteger(value);
export function validVoyageSave(value:unknown):value is VoyageSave{
  if(!object(value)||!keys(value,['format','best','muted','journey'])||value.format!==2||!integer(value.best,0,1e9)||typeof value.muted!=='boolean')return false;
  const j=value.journey;if(j===null)return true;
  if(!object(j)||!keys(j,['x','y','angle','speed','sail','wind','nextWind','windClock','elapsed','leg','score','streak','hits','lastHit','phase']))return false;
  return number(j.x,0,1024)&&number(j.y,0,768)&&number(j.angle,-1e6,1e6)&&number(j.speed,-100,250)&&typeof j.sail==='boolean'&&number(j.wind,-1e6,1e6)&&number(j.nextWind,-1e6,1e6)&&number(j.windClock,0,30)&&number(j.elapsed,0,31536000)&&integer(j.leg,0,5)&&integer(j.score,0,1e9)&&integer(j.streak,0,5)&&integer(j.hits,0,1e6)&&number(j.lastHit,0,j.elapsed as number)&&((j.phase==='active'&&(j.leg as number)<5)||(j.phase==='finished'&&j.leg===5));
}
export function legacyBest(value:string|null):number{
  if(value===null||!/^\d{1,10}$/.test(value))return 0;
  const score=Number(value);return integer(score,0,1e9)?score:0;
}
