import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {AgentService} from '../packages/agent-service/src/service';
import {Store} from '../packages/agent-service/src/store';
import {Transfers} from '../packages/agent-service/src/transfers';
import {createGameLibraryProcessor} from '../packages/adapter-game-library/src/index';
import type {Registration} from '../packages/contracts/src/index';
import type {GameAssetResult} from '../packages/contracts/src/game-assets';
import type {GameProductionJob} from '../packages/contracts/src/game-production';
import type {GameProject} from '../packages/contracts/src/games';
import type {Transfer} from '../packages/contracts/src/transfers';
import {fixtureGameDocument} from './game-fixtures';

/** Real offline processor and transactional candidate; no provider or installed data. */
export async function modelPreviewFixture(query='character-soldier'){
  const directory=await mkdtemp(path.join(tmpdir(),'game-model-viewer-'));
  const registration:Registration={id:'model-preview',product:'companion-mac',profile:'fixture',workspace:'',providers:['ollama'],hostTools:[]};
  const processor=await createGameLibraryProcessor({directory:path.resolve('packages/adapter-game-library/libraries')});
  const service=new AgentService(new Store(path.join(directory,'metadata.sqlite')),directory,undefined,{}, {gameAssetProcessors:[processor]});
  const call=<T>(method:string,input:unknown={})=>service.dispatch(registration,method,input,'fixture') as Promise<T>;
  try{
    const selection=(await processor.libraries!({query})).entries[0]!;
    const project=await call<GameProject>('games.projects.create',{requestId:'model-viewer-project',document:fixtureGameDocument()});
    const job=await call<GameProductionJob>('games.assets.process',{requestId:'model-viewer-copy',projectId:project.id,revision:1,spec:{processorId:processor.id,target:{id:'hero',role:selection.entry.title+' · biblioteca offline',placeholder:true},operation:{type:'library.copy',selection,outputBase:'assets/hero'}}});
    for(let i=0;i<1000;i++){
      const current=await call<GameProductionJob>('games.production.get',{id:job.id});
      if(current.state==='completed')break;
      if(!['queued','running'].includes(current.state))throw Error('Model preview fixture job failed: '+current.state);
      await new Promise(resolve=>setTimeout(resolve,5));
      if(i===999)throw Error('Original model preview fixture job not yet terminal; do not repeat it.');
    }
    const transfers=new Transfers(service.store),transfer=await call<Transfer>('games.assets.result',{id:job.id}),result=transfers.json(registration,transfer.id) as GameAssetResult;
    const model=result.files.find(file=>file.mime==='model/gltf-binary')!;
    return {result,modelPath:model.path,project,service,call,quality:async()=>transfers.json(registration,(await call<Transfer>('games.quality.get',{projectId:project.id})).id) as {ready:boolean},readFile:async(name:string)=>{const file=result.files.find(file=>file.path===name);if(!file)throw Error('No candidate file');return transfers.bytes(registration,file.transferId);},
      async close(){await service.close();await rm(directory,{recursive:true,force:true});}};
  }catch(error){await service.close();await rm(directory,{recursive:true,force:true});throw error;}
}
