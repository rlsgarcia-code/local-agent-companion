import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdtemp,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import test from 'node:test';
import {compareGameFile,GAME_FILE_DIFF_MAX_BYTES} from '../packages/game-design/src/file-comparison';
import {gameFileCompare,gameFileComparison,type GameFileDiffRow} from '../packages/contracts/src/game-file-comparison';
import type {GameDocument,GameRevision,GameFile} from '../packages/contracts/src/games';
import {gameContentHash} from '../packages/game-design/src/project';
import {fixtureGameDocument} from './game-fixtures';
import {AgentService} from '../packages/agent-service/src/service';
import {Store} from '../packages/agent-service/src/store';
import {LocalServer} from '../packages/agent-service/src/server';
import {ensureIdentity,createClientCredential,ipcPath} from '../packages/agent-service/src/security';
import {AgentClient} from '../packages/client-ts/src/index';
import {GameStudioController,type GameStudioHost} from '../packages/client-ts/src/game-studio';
import type {Registration,Session} from '../packages/contracts/src/index';
const filePath='src/pradaria.ts',sha=(data:Uint8Array)=>createHash('sha256').update(data).digest('hex');
function fixture(before:Buffer|null,after:Buffer|null){
 const blobs=new Map<string,Buffer>();
 const rev=(bytes:Buffer|null,revision:number):GameRevision=>{const document=fixtureGameDocument();document.files=bytes===null?[]:[{path:filePath,mime:'text/plain',size:bytes.length,sha256:sha(bytes),transferId:`private-${revision}`}];if(bytes)blobs.set(`private-${revision}`,bytes);
 return {projectId:'fixture',revision,contentHash:gameContentHash(document),parentHash:null,document,message:'Synthetic fixture',createdAt:revision,origin:'edited'};};
 const a=rev(before,1),b=rev(after,2),read=(file:GameFile)=>blobs.get(file.transferId)!;
 return {a,b,read,query:(extra:Record<string,unknown>={})=>gameFileCompare.parse({projectId:'fixture',baseRevision:1,targetRevision:2,path:filePath,...extra})};
}
const ending={lf:'\n',crlf:'\r\n',cr:'\r',none:''};
function reconstruct(rows:GameFileDiffRow[],side:'base'|'target'){
 return rows.map(row=>{assert.notEqual(row.kind,'omitted');if(row.kind==='omitted')throw Error('Unexpanded fixture');return row[`${side}Line`]===null?'':row.text+ending[row.ending];}).join('');
}
test('file comparison preserves Unicode, BOM, CRLF, CR, tabs, whitespace and final newline differences exactly',()=>{
 const before=Buffer.from('\ufeffconst céu = "🌱";\r\n\tgrama  \rúltima\n'),after=Buffer.from('\ufeffconst céu = "🌿";\r\n\tgrama \rúltima');
 const f=fixture(before,after),result=gameFileComparison.parse(compareGameFile(f.a,f.b,f.query({context:20}),f.read));
 assert.equal(result.state,'text');assert.equal(result.base.utf8Bom,true);assert.equal(result.target.utf8Bom,true);
 assert.equal(reconstruct(result.rows,'base'),before.toString());assert.equal(reconstruct(result.rows,'target'),after.toString());
 assert.doesNotMatch(JSON.stringify(result),/private-1|private-2|transferId/);assert.ok(result.rows.some(row=>row.kind!=='omitted'&&row.ending==='none'));
});
test('added, removed, empty, missing and equal files retain distinct identities',()=>{
 for(const [a,b]of [[null,Buffer.from('novo')],[Buffer.from('antigo'),null],[Buffer.alloc(0),Buffer.from('\n')],[Buffer.from('\n'),Buffer.alloc(0)]] as const){const f=fixture(a,b),r=compareGameFile(f.a,f.b,f.query(),f.read);assert.equal(Boolean(r.base.file),a!==null);assert.equal(Boolean(r.target.file),b!==null);assert.equal(reconstruct(r.rows,'base'),a?.toString()??'');assert.equal(reconstruct(r.rows,'target'),b?.toString()??'');}
 const f=fixture(Buffer.from('a\nb\n'),Buffer.from('a\nb\n')),r=compareGameFile(f.a,f.b,f.query(),f.read);assert.deepEqual(r.counts,{added:0,removed:0,unchanged:2});assert.deepEqual(r.rows,[{kind:'omitted',baseLine:1,targetLine:1,count:2}]);
 const missing=fixture(null,null);assert.throws(()=>compareGameFile(missing.a,missing.b,missing.query(),missing.read),/not found/);
});
test('bounded pages preserve whole lines and immutable binding, collapse unchanged intervals and reject changed cursor bindings',()=>{
 const a=Buffer.from(Array.from({length:300},(_,i)=>`linha ${i}\n`).join('')),b=Buffer.from(Array.from({length:300},(_,i)=>i%3===0?`nova ${i}\n`:`linha ${i}\n`).join(''));
 const f=fixture(a,b),full=compareGameFile(f.a,f.b,f.query({context:0,limit:100}),f.read),rows:GameFileDiffRow[]=[];let cursor=0;
 for(;;){const r=compareGameFile(f.a,f.b,f.query({context:0,cursor,limit:7,...(cursor?{bindingHash:full.bindingHash}:{})}),f.read);rows.push(...r.rows);assert.ok(r.rows.length<=7);assert.ok(Buffer.byteLength(JSON.stringify(r.rows))<128*1024);if(!r.hasMore)break;assert.ok(r.cursor>cursor);cursor=r.cursor;}
 assert.equal(rows.length,full.totalRows);assert.equal(rows.filter(row=>row.kind==='omitted').reduce((sum,row)=>sum+row.count,0),200);
 assert.throws(()=>f.query({cursor:1}));assert.throws(()=>compareGameFile(f.a,f.b,f.query({context:8,cursor:7,bindingHash:full.bindingHash}),f.read),/binding changed/);
 assert.throws(()=>compareGameFile(f.a,f.b,f.query({cursor:999,bindingHash:full.bindingHash,context:0}),f.read),/cursor/);
 const large=fixture(Buffer.from('x'.repeat(15000)),Buffer.from(Array.from({length:15},()=>'<script>"'.repeat(1500)+'\n').join(''))),page=compareGameFile(large.a,large.b,large.query({limit:100}),large.read);
 assert.ok(page.hasMore);assert.ok(Buffer.byteLength(JSON.stringify(page.rows))<=128*1024);assert.ok(page.rows.every(row=>row.kind!=='omitted'&&row.text.length>=13500));
});
test('explicit limits and invalid UTF-8 refuse projections without truncating, executing, changing or reading oversized source',()=>{
 const cases:[Buffer,string][]=[[Buffer.from([0,1,2]),'binary-or-encoding'],[Buffer.from([0xc3,0x28]),'binary-or-encoding'],[Buffer.from('x'.repeat(16385)),'line-size'],[Buffer.from('a\n'.repeat(16001)),'line-count'],[Buffer.from(Array.from({length:600},(_,i)=>`${i}\n`).join('')),'edit-limit']];
 for(const [bytes,reason]of cases){const f=fixture(Buffer.alloc(0),bytes),original=Buffer.from(bytes),r=compareGameFile(f.a,f.b,f.query(),f.read);assert.equal(r.reason,reason);assert.equal(r.state,'unavailable');assert.deepEqual(r.rows,[]);assert.equal(r.counts,null);assert.deepEqual(bytes,original);}
 const f=fixture(Buffer.from('a'),Buffer.alloc(GAME_FILE_DIFF_MAX_BYTES+1));assert.equal(compareGameFile(f.a,f.b,f.query(),()=>{throw Error('Must not read oversized source');}).reason,'file-size');
 const lines=fixture(Buffer.from('a\n'.repeat(8001)),Buffer.from('a\n'.repeat(8001)));assert.equal(compareGameFile(lines.a,lines.b,lines.query(),lines.read).reason,'line-count');
});
async function serviceFixture(){
 const directory=await mkdtemp(path.join(tmpdir(),'game-file-diff-')),reg:Registration={id:'file-diff',product:'companion-mac',profile:'fixture',workspace:'',providers:['ollama'],hostTools:[]};
 const service=new AgentService(new Store(path.join(directory,'state.sqlite')),directory,async()=>{throw Error('No inference allowed');}),credential=await createClientCredential(directory,reg);service.store.register(credential);
 const identity=await ensureIdentity(directory),server=new LocalServer(service,directory);await server.listen();const client=new AgentClient({address:ipcPath(directory),certificate:identity.cert,credential});await client.connect();
 return {directory,reg,service,credential,identity,client,async close(){client.close();await server.close();await service.close();await rm(directory,{recursive:true,force:true});}};
}
test('file comparison uses authenticated SDK/TLS/IPC with no effects, exact revision bindings, namespace protection and Python compatibility',async()=>{
 const f=await serviceFixture();try{
 const doc=fixtureGameDocument();doc.files=[await f.client.uploadGameFile(filePath,Buffer.from('antes\r\n'),'text/plain')];const project=await f.client.createGameProject('create',doc),next=structuredClone(doc);next.files=[await f.client.uploadGameFile(filePath,Buffer.from('depois\n'),'text/plain')];await f.client.commitGameRevision(project.id,'change',1,next,'Synthetic edit');
 const state=()=>['game_revisions','game_project_events','game_project_mutations','receipts','transfers'].map(table=>(f.service.store.db.prepare(`SELECT count(*) AS n FROM ${table}`).get() as {n:number}).n),before=state();
 const first=await f.client.compareGameFile(project.id,1,2,filePath,3,0,1);assert.equal(first.hasMore,true);const last=await f.client.compareGameFile(project.id,1,2,filePath,3,first.cursor,1,first.bindingHash);assert.equal(last.hasMore,false);assert.deepEqual(state(),before);
 const later=structuredClone(next);later.title='Later source';await f.client.commitGameRevision(project.id,'later',2,later,'Preserve latest');assert.equal((await f.client.compareGameFile(project.id,1,2,filePath)).bindingHash,first.bindingHash);
 for(const reg of [{...f.reg,profile:'other'},{...f.reg,product:'companion-vscode' as const},{...f.reg,workspace:'other'}])await assert.rejects(f.service.dispatch(reg,'games.revisions.compareFile',{projectId:project.id,baseRevision:1,targetRevision:2,path:filePath},'fixture'),/not found/);
 await assert.rejects(f.client.compareGameFile(project.id,1,999,filePath),/not found/);await assert.rejects(f.client.compareGameFile(project.id,1,2,'src/missing.ts'),/not found/);await assert.rejects(f.client.compareGameFile(project.id,1,2,'../escape.ts'));await assert.rejects(f.client.call('games.revisions.compareFile',{projectId:project.id,baseRevision:1,targetRevision:2,path:filePath,namespace:'forged'}));
 await assert.rejects(f.client.compareGameFile(project.id,1,2,filePath,3,1,50,'f'.repeat(64)),/binding changed/);
 if(process.platform!=='win32'){const auth=path.join(f.directory,'auth.json'),cert=path.join(f.directory,'cert.pem');await writeFile(auth,JSON.stringify(f.credential),{mode:0o600});await writeFile(cert,f.identity.cert);
 const code=`import sys\nsys.path.insert(0,sys.argv[1])\nfrom pathlib import Path\nfrom companion_client import AgentClient\nc=AgentClient(sys.argv[2],Path(sys.argv[3]),Path(sys.argv[4]))\nc.connect()\nr=c.compare_game_file(sys.argv[5],1,2,sys.argv[6],3,0,1)\ns=c.compare_game_file(sys.argv[5],1,2,sys.argv[6],3,r['cursor'],1,r['bindingHash'])\nassert r['hasMore'] and not s['hasMore'] and s['rows'][0]['text']=='depois'\nc.close()\nprint('FILE_DIFF_PYTHON_OK')`;
 const result=await promisify(execFile)('python3',['-I','-c',code,path.resolve('packages/client-python'),ipcPath(f.directory),cert,auth,project.id,filePath],{timeout:30000});assert.match(result.stdout,/FILE_DIFF_PYTHON_OK/);}
 const original=await f.client.downloadGameFile(project.id,filePath,1);f.service.store.db.prepare('UPDATE transfer_parts SET data=? WHERE id=?').run(Buffer.from('corrupt'),doc.files[0]!.transferId);
 await assert.rejects(f.client.compareGameFile(project.id,1,2,filePath),/verified SHA-256/);f.service.store.db.prepare('UPDATE transfer_parts SET data=? WHERE id=?').run(original,doc.files[0]!.transferId);
 assert.equal((await f.client.getGameQuality(project.id)).ready,false);
 }finally{await f.close();}
});
test('Studio text comparison is read-only, selection guarded and version-negotiated; historical export remains pinned',async()=>{
 const f=await serviceFixture();try{
 const doc:GameDocument=fixtureGameDocument();doc.files=[await f.client.uploadGameFile(filePath,Buffer.from('a'),'text/plain')];const project=await f.client.createGameProject('first',doc),other=await f.client.createGameProject('other',doc),next=structuredClone(doc);next.files=[await f.client.uploadGameFile(filePath,Buffer.from('b'),'text/plain')];await f.client.commitGameRevision(project.id,'change',1,next,'Synthetic edit');const session=await f.client.call<Session>('sessions.create',{title:'Compare files'});await f.client.selectGameProject(session.id,project.id);
 let exported:unknown;const host:GameStudioHost={canWrite:()=>false,approve:async()=>{throw Error('No write consent');},preview:async()=>{throw Error('No preview');},exportSource:async(id,revision)=>{exported={id,revision};return true;},exportBuild:async()=>false,exportAsset:async()=>false};
 const controller=new GameStudioController(f.client,session.id,host),command={action:'compare-file',projectId:project.id,baseRevision:1,targetRevision:2,path:filePath};assert.ok((await controller.dispatch(command) as {fileComparison:unknown}).fileComparison);
 const compare=f.client.compareGameFile.bind(f.client);f.client.compareGameFile=async(...args)=>{const result=await compare(...args);await f.client.selectGameProject(session.id,other.id);return result;};await assert.rejects(controller.dispatch(command),/selecionado mudou/);f.client.compareGameFile=compare;await f.client.selectGameProject(session.id,project.id);
 const call=f.client.call.bind(f.client);f.client.call=async(method,input)=>method==='engine.info'?{capabilities:[]} as never:call(method,input);await assert.rejects(controller.dispatch(command),/atualização/);f.client.call=call;
 await controller.dispatch({action:'export-source',projectId:project.id,expectedRevision:2,revision:1});assert.deepEqual(exported,{id:project.id,revision:1});await assert.rejects(controller.dispatch({action:'export-source',projectId:project.id,expectedRevision:1,revision:1}),/Atualize/);
 assert.equal((await f.client.getGameProject(project.id)).revision,2);assert.equal((await f.client.listGameProduction(project.id)).jobs.length,0);
 }finally{await f.close();}
});
