import type {VoyageSave} from './state';
export type RecordResult={status:string;stamp?:string|null;data?:VoyageSave;code?:string};
export type SavePort={load():Promise<RecordResult>;save(data:VoyageSave,request:{expected:string|null}):Promise<RecordResult>;discard(request:{expected:string|null;confirm:true}):Promise<RecordResult>;close():Promise<void>};
export type SaveNotice={phase:'loading'|'ready'|'saving'|'saved'|'error'|'volatile'|'closed';result?:RecordResult;data?:VoyageSave};

/** Serialize/coalesce checkpoints. A conflict never authorizes a fresh overwrite. */
export class VoyageSaveCoordinator{
  private stamp:string|null|undefined;private dirty=false;private task?:Promise<void>;
  private getData?:()=>VoyageSave;private closed=false;private writable=false;
  private lastError?:RecordResult;
  constructor(private readonly port:SavePort,private readonly notify:(notice:SaveNotice)=>void){}
  async load(){
    this.notify({phase:'loading'});const result=await this.port.load();if(this.closed)return {status:'unavailable',code:'closed'};
    this.stamp=result.stamp;this.writable=['loaded','empty'].includes(result.status);this.lastError=this.writable?undefined:result;
    this.notify({phase:this.writable?'ready':'error',result,...(result.data?{data:result.data}:{})});return result;
  }
  checkpoint(getData:()=>VoyageSave){
    if(this.closed||!this.writable)return this.task??Promise.resolve();
    this.getData=getData;this.dirty=true;this.notify({phase:'saving'});
    if(!this.task){this.task=this.pump().finally(()=>{this.task=undefined;});}
    return this.task;
  }
  private async pump(){
    while(this.dirty&&!this.closed&&this.writable){
      this.dirty=false;const data=this.getData!();let result:RecordResult;
      try{result=await this.port.save(data,{expected:this.stamp!});}catch{result={status:'unavailable',code:'save-response-missing'};}
      if(this.closed||!this.writable)return;
      if(!['saved','unchanged'].includes(result.status)||typeof result.stamp!=='string'){
        this.writable=false;this.dirty=false;this.lastError=result;this.notify({phase:'error',result});return;
      }
      this.stamp=result.stamp;if(!this.dirty)this.notify({phase:'saved',result,data});
    }
  }
  async retry(){
    if(this.closed)return {status:'unavailable',code:'closed'};
    const current=await this.port.load();
    if(!['loaded','empty'].includes(current.status)||current.stamp!==this.stamp){const result=current.stamp!==this.stamp?{status:'conflict',code:'record-changed'}:current;this.lastError=result;this.notify({phase:'error',result});return result;}
    this.writable=true;this.lastError=undefined;if(this.getData)await this.checkpoint(this.getData);return this.writable?{status:'ready'}:this.lastError!;
  }
  withoutSaving(){if(this.closed)return;this.writable=false;this.dirty=false;this.notify({phase:'volatile'});}
  async discard(){
    if(this.closed||this.stamp===undefined)return {status:'blocked',code:'missing-read'};
    await this.task;const result=await this.port.discard({expected:this.stamp,confirm:true});
    if(result.status==='discarded'){this.stamp=null;this.writable=true;this.notify({phase:'ready',result});}
    else this.notify({phase:'error',result});return result;
  }
  async close(){this.closed=true;this.writable=false;this.dirty=false;await Promise.allSettled([this.port.close(),this.task]);this.notify({phase:'closed'});}
}
