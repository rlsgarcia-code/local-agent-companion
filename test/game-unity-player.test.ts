import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import test from 'node:test';
import {createUnityPlayer,UNITY_PLAYER_POLICY,UnityPlayerError,type UnityPlayerNotice,type UnityPlayerErrorCode} from '../packages/adapter-game-unity/src/player';
import {unityOutputFixture} from './unity-output-fixtures';
import {artifactPolicy} from '../packages/adapter-game-browser/src/resources';
const sha=(data:Uint8Array)=>createHash('sha256').update(data).digest('hex');
function fixture(){const native=unityOutputFixture(),data=Buffer.from('SYNTHETIC NOTICE ONLY — not a Unity license.\r\n<script>literal text</script>');const notice:UnityPlayerNotice={path:'fixture.txt',title:'Aviso sintético',size:data.length,sha256:sha(data),data};return {native,notice,input:()=>({archive:native.archive(),diagnostic:native.diagnostic(),settings:native.settings,metadata:{projectId:'stable-game',title:'Game <img src=x> & "🌿"'},notices:[notice]})};}
const refused=(code:UnityPlayerErrorCode)=>(error:unknown)=>error instanceof UnityPlayerError&&error.code===code&&!error.message.includes('PRIVATE_MARKER');
test('Unity player replaces only the native HTML with external code/CSS/config, preserves runtime bytes and binds the original export without granting production authority',()=>{
 const f=fixture(),input=f.input(),archive=Buffer.from(input.archive),candidate=createUnityPlayer(input);assert.equal(candidate.stage,'unqualified-player-candidate');assert.equal(candidate.entrypoint,'index.html');assert.deepEqual(input.archive,archive);
 assert.equal(candidate.source.archiveSha256,sha(archive));assert.equal(candidate.source.originalIndexSha256,sha(f.native.files[0]![1]));assert.deepEqual(candidate.transformation.replaced,['index.html']);
 for(const [name,data]of f.native.files.filter(([name])=>name!=='index.html'))assert.deepEqual(candidate.files.find(file=>file.path===name)!.data,data);
 const html=Buffer.from(candidate.files.find(file=>file.path==='index.html')!.data).toString();assert.match(html,/&lt;img src=x&gt; &amp; &quot;🌿&quot;/);assert.doesNotMatch(html,/<img|MUST_NOT_EXECUTE|onclick=|style=|<script[^>]*>[^<]+/);assert.match(html,/script defer src="companion-player\/player.js"/);
 const config=JSON.parse(Buffer.from(candidate.files.find(file=>file.path==='companion-player/config.json')!.data).toString());assert.equal(config.projectId,'stable-game');assert.deepEqual(config.notices,[{path:'companion-player/notices/fixture.txt',title:'Aviso sintético'}]);assert.deepEqual(candidate.files.find(file=>file.path===config.notices[0].path)!.data,f.notice.data);
 assert.equal('jobId' in candidate,false);assert.equal('artifactHash' in candidate,false);assert.equal('ready' in candidate,false);
});
test('Unity player requires complete bounded UTF-8 notice bytes and hashes, without classifying source declarations as license authority',()=>{
 const f=fixture(),input=f.input();for(const notices of [[],[{...f.notice,size:f.notice.size-1}],[{...f.notice,sha256:'f'.repeat(64)}],[{...f.notice,path:'../PRIVATE_MARKER'}],[{...f.notice,path:'CON.txt'}],[{...f.notice,data:Buffer.from([255]),size:1,sha256:sha(Buffer.from([255]))}],[f.notice,{...f.notice,path:'FIXTURE.txt'}]])assert.throws(()=>createUnityPlayer({...input,notices}),refused('notices-invalid'));
 const full=Buffer.from('a'.repeat(1024*1024)+'\nEND');const notice={...f.notice,data:full,size:full.length,sha256:sha(full)},candidate=createUnityPlayer({...input,notices:[notice]});assert.deepEqual(candidate.files.find(file=>file.path==='companion-player/notices/fixture.txt')!.data,full);
});
test('Unity player refuses namespace conflicts, extra HTML and forged metadata rather than overwriting, dropping source or enabling another engine',()=>{
 for(const name of ['companion-player/config.json','Companion-Player/asset.bin','companion-player']){const f=fixture();f.native.files.push([name,Buffer.from('PRIVATE_MARKER')]);assert.throws(()=>createUnityPlayer(f.input()),refused('reserved-path'));assert.equal(f.native.files.at(-1)![1].toString(),'PRIVATE_MARKER');}
 for(const name of ['StreamingAssets/other.html','TemplateData/page.xhtml','page.HTM']){const f=fixture();f.native.files.push([name,Buffer.from('PRIVATE_MARKER')]);assert.throws(()=>createUnityPlayer(f.input()),refused('extra-html'));}
 const f=fixture();assert.throws(()=>createUnityPlayer({...f.input(),metadata:{...f.input().metadata,provider:'forged'} as never}),refused('metadata-invalid'));
});
test('Unity player and browser policies permit only WASM compilation under the game origin, without unsafe-eval/inline scripts, workers or external endpoints',()=>{
 const browser=artifactPolicy({engine:'unity',entrypoint:'index.html',files:[]});for(const policy of [UNITY_PLAYER_POLICY,browser]){assert.ok(policy.includes("'wasm-unsafe-eval'"));assert.equal(policy.includes("'unsafe-eval'"),false);assert.equal(/script-src[^;]*'unsafe-inline'/.test(policy),false);assert.match(policy,/worker-src 'none'/);assert.match(policy,/connect-src 'self'/);assert.match(policy,/frame-src 'none'/);}
 for(const engine of ['phaser','babylon']as const)assert.equal(artifactPolicy({engine,entrypoint:'index.html',files:[]}).includes("'wasm-unsafe-eval'"),false);
});
