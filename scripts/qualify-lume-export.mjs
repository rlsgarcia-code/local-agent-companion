// Read an exact completed build from disk. No AgentClient, service process,
// inference provider, personal profile, installation or storage injection.
import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir,lstat} from 'node:fs/promises';
import {createHash,randomUUID} from 'node:crypto';
import path from 'node:path';
import previewModule from '../dist-tests/packages/adapter-game-browser/src/preview.js';
import production from '../dist-tests/packages/contracts/src/game-production.js';
import {observeLumeCampaign,waitForLumePanel} from './lume-campaign-observer.mjs';
import {openInstalledBrowserPreview} from './game-qualification/installed-browser.mjs';

const args=process.argv.slice(2);assert.ok(args.length>=1&&args.length<=2,'Use --attempt=<exact completed Lume qualification> [--browser=chromium|firefox|webkit]');
assert.equal(args.filter(value=>value.startsWith('--attempt=')&&value.slice(10)).length,1);assert.ok(args.every(value=>value.startsWith('--attempt=')||value.startsWith('--browser=')));assert.ok(args.filter(value=>value.startsWith('--browser=')).length<=1);
const selectedBrowser=args.find(value=>value.startsWith('--browser='))?.slice(10)??'chromium';assert.ok(['chromium','firefox','webkit'].includes(selectedBrowser));
const input=path.resolve(args.find(value=>value.startsWith('--attempt=')).slice(10)),evidence=JSON.parse(await readFile(path.join(input,'evidence.json'),'utf8'));
const artifact=production.gameArtifact.parse(evidence.artifact),files=new Map(artifact.files.map(file=>[file.path,file]));
assert.equal(evidence.campaign?.campaign?.length,12,'The original full campaign must be observed first');
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const readBuildFile=async name=>{
 const file=files.get(name);assert.ok(file,'Only exact artifact files may be read');const local=path.join(input,'build',name),stat=await lstat(local);assert.ok(stat.isFile()&&!stat.isSymbolicLink());
 const bytes=await readFile(local);assert.equal(bytes.length,file.size);assert.equal(sha(bytes),file.sha256);return bytes;
};
for(const name of files.keys())await readBuildFile(name);
const output=path.resolve('output/playwright/lume/standalone/runs',new Date().toISOString().replace(/[:.]/g,'-')+'-'+randomUUID().slice(0,8));await mkdir(output,{recursive:true});
let preview,closeReceipt,previewReturned=false;
try{
 const options={artifact,readFile:readBuildFile,signal:new AbortController().signal,headless:true};
 preview=selectedBrowser==='chromium'?await previewModule.openGamePreview(options):await openInstalledBrowserPreview({...options,name:selectedBrowser});const page=preview.page;
 previewReturned=true;
 await writeFile(path.join(output,'browser.json'),JSON.stringify(preview.browserMetadata??{name:'chromium',version:page.context().browser().version(),qualifiedInstalledPreview:true},null,2)+'\n');
 const browserVersion=page.context().browser().version();await page.getByRole('button',{name:'Jogar',exact:true}).waitFor();await waitForLumePanel(page);await page.screenshot({path:path.join(output,'title.png')});
 await page.getByRole('button',{name:'Jogar',exact:true}).click();await page.locator('#hud').waitFor();await page.waitForTimeout(900);
 const campaign=await observeLumeCampaign(page,path.join(output,'campaign'));
 await page.locator('[data-level="0"]').click();await page.getByRole('button',{name:'Pausar jogo',exact:true}).click();await page.getByRole('heading',{name:'Jardim em pausa',exact:true}).waitFor();await waitForLumePanel(page);await page.screenshot({path:path.join(output,'paused.png')});
 await page.getByRole('button',{name:'Continuar',exact:true}).click();await page.setViewportSize({width:390,height:844});await page.screenshot({path:path.join(output,'portrait.png')});assert.equal(await page.locator('body').evaluate(node=>node.scrollWidth>window.innerWidth),false);
 assert.deepEqual(preview.errors,[]);assert.deepEqual(preview.blocked,[]);
 closeReceipt=await preview.close();preview=undefined;
 await writeFile(path.join(output,'report.json'),JSON.stringify({scope:'Exact exported Lume build on disposable '+selectedBrowser+' using disk files only; no Agent Service/Agent API, provider or personal browser. Normal input/PNG/HUD observer, not consumer-browser, physical/human/artistic acceptance.',input,sourceHash:artifact.sourceHash,artifactHash:artifact.artifactHash,originalEvidenceSha256:sha(await readFile(path.join(input,'evidence.json'))),selectedBrowser,browserVersion,verifiedFiles:artifact.files.map(({path,sha256,size})=>({path,sha256,size})),campaign,errors:[],blocked:[],pauseAndPortraitObserved:true,previewCloseAcknowledged:true,agentServiceStarted:false,agentAPIUsed:false,realInferenceCalls:0},null,2)+'\n');
 console.log('LUME_EXPORTED_CAMPAIGN_WITHOUT_AGENT_SERVICE_OK '+output);
}catch(error){await writeFile(path.join(output,'failure.json'),JSON.stringify({message:error instanceof Error?error.message:String(error)},null,2)+'\n');try{await preview?.page.screenshot({path:path.join(output,'failure.png')});}catch{}throw error;}
finally{if(preview)closeReceipt=await preview.close();await writeFile(path.join(output,'closure.json'),JSON.stringify({previewReturned,closeAcknowledged:previewReturned,...(closeReceipt??{})},null,2)+'\n');}
