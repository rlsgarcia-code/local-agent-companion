export type HeldAction='left'|'right'|'drive'|'reverse';
/** A released finger must not cancel another finger/key holding the same action. */
export class HeldInputs{
 private enabled=false;
 private readonly sources=new Map<HeldAction,Set<string>>();
 constructor(private readonly changed:(action:HeldAction,active:boolean)=>void){}
 setEnabled(value:boolean){this.enabled=value;if(!value)this.clear();}
 press(action:HeldAction,source:string){
  if(!this.enabled)return;
  const set=this.sources.get(action)??new Set<string>();const was=set.size>0;
  set.add(source);this.sources.set(action,set);if(!was)this.changed(action,true);
 }
 release(action:HeldAction,source:string){const set=this.sources.get(action);if(!set?.delete(source))return;if(!set.size){this.sources.delete(action);this.changed(action,false);}}
 clear(){const actions=[...this.sources.keys()];this.sources.clear();for(const action of actions)this.changed(action,false);}
}
