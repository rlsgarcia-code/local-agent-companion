export type Progress={version:1;unlocked:number;stars:number[];bestSeconds:(number|null)[];current:{level:number;checkpoint:boolean;seeds:string[];elapsed:number;deaths:number}|null;muted:boolean};
const KEY="companion.game.lume.v1";
export const fresh=():Progress=>({version:1,unlocked:0,stars:Array(12).fill(0),bestSeconds:Array(12).fill(null),current:null,muted:false});
export function valid(value:unknown):value is Progress{
  const v=value as Progress;
  return Boolean(v&&v.version===1&&Number.isInteger(v.unlocked)&&v.unlocked>=0&&v.unlocked<12&&typeof v.muted==="boolean"&&Array.isArray(v.stars)&&v.stars.length===12&&v.stars.every(n=>Number.isInteger(n)&&n>=0&&n<=3)&&Array.isArray(v.bestSeconds)&&v.bestSeconds.length===12&&v.bestSeconds.every(n=>n===null||typeof n==="number"&&Number.isFinite(n)&&n>0&&n<86400)&&
    (v.current===null||v.current&&Number.isInteger(v.current.level)&&v.current.level>=0&&v.current.level<=v.unlocked&&typeof v.current.checkpoint==="boolean"&&typeof v.current.elapsed==="number"&&Number.isFinite(v.current.elapsed)&&v.current.elapsed>=0&&v.current.elapsed<86400&&Number.isInteger(v.current.deaths)&&v.current.deaths>=0&&v.current.deaths<100000&&Array.isArray(v.current.seeds)&&v.current.seeds.length<=3&&new Set(v.current.seeds).size===v.current.seeds.length&&v.current.seeds.every(s=>["a","b","c"].includes(s))));
}
export class Save{
  value=fresh();available=true;
  constructor(private storage:Pick<Storage,"getItem"|"setItem">|undefined){try{const text=storage?.getItem(KEY);if(text){const parsed:unknown=JSON.parse(text);if(valid(parsed))this.value=parsed;else this.available=false;}if(!storage)this.available=false;}catch{this.available=false;}}
  write(){if(!this.available)return;try{this.storage!.setItem(KEY,JSON.stringify(this.value));}catch{this.available=false;}}
  finish(level:number,stars:number,seconds:number){this.value.stars[level]=Math.max(this.value.stars[level]??0,stars);const previous=this.value.bestSeconds[level];this.value.bestSeconds[level]=previous===null||previous===undefined?seconds:Math.min(previous,seconds);this.value.unlocked=Math.min(11,Math.max(this.value.unlocked,level+1));this.value.current=null;this.write();}
}
