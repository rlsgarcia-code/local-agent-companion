import {fresh,valid,type State} from './world';
export const KEY='companion.game.vigilia.v1';
export class Save{
  value:State=fresh();available=true;found=false;
  constructor(private storage:Pick<Storage,'getItem'|'setItem'>|undefined){
    if(!storage){this.available=false;return;}
    try{const text=storage.getItem(KEY);if(text!==null){const data:unknown=JSON.parse(text);if(valid(data)){this.value=data;this.found=true;}else this.available=false;}}catch{this.available=false;}
  }
  write(){if(!this.available)return;try{this.storage!.setItem(KEY,JSON.stringify(this.value));this.found=true;}catch{this.available=false;}}
}
