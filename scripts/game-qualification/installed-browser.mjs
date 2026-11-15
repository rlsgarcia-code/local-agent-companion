// Maintainer qualification only. Uses the exact existing Playwright installation;
// does not register a collector/preview capability or download/update a browser.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {createReadStream} from 'node:fs';
import {readFile as readDiskFile,readdir,lstat,realpath,mkdtemp,rm} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {firefox,webkit} from 'playwright-core';
import resourcesModule from '../../dist-tests/packages/adapter-game-browser/src/resources.js';
import isolationModule from '../../dist-tests/packages/adapter-game-browser/src/isolation.js';
const require=createRequire(import.meta.url),packageRoot=path.dirname(require.resolve('playwright-core/package.json'));
const digest=async file=>{const hash=createHash('sha256');for await(const bytes of createReadStream(file))hash.update(bytes);return hash.digest('hex');};
async function inventory(root){
 const entries=[];let bytes=0;
 async function walk(folder){
  for(const name of (await readdir(folder)).sort()){
   const file=path.join(folder,name),stat=await lstat(file),relative=path.relative(root,file).split(path.sep).join('/');
   assert.ok(entries.length<20000,'Browser inventory exceeds the qualification limit');
   if(stat.isSymbolicLink()){
    const target=await realpath(file);assert.ok(target.startsWith(root+path.sep),'Browser link escapes the installed distribution');entries.push({path:relative,kind:'link',target:path.relative(root,target).split(path.sep).join('/')});
   }else if(stat.isDirectory())await walk(file);
   else{assert.ok(stat.isFile(),'Unexpected browser distribution entry');bytes+=stat.size;assert.ok(bytes<=1024*1024*1024,'Browser distribution exceeds 1 GiB');entries.push({path:relative,kind:'file',size:stat.size,sha256:await digest(file)});}
  }
 }
 await walk(root);return {entries,bytes,sha256:createHash('sha256').update(JSON.stringify(entries)).digest('hex')};
}
export async function openInstalledBrowserPreview({name,artifact,readFile,signal}){
 assert.ok(name==='firefox'||name==='webkit','Select Firefox or WebKit explicitly');assert.equal(process.platform,'darwin','This qualification inventory currently targets macOS');
 const type=name==='firefox'?firefox:webkit,metadata=JSON.parse(await readDiskFile(path.join(packageRoot,'browsers.json'),'utf8')).browsers.find(browser=>browser.name===name);
 assert.ok(metadata?.revision&&metadata.browserVersion);const executable=await realpath(type.executablePath());
 let root=path.dirname(type.executablePath());while(path.basename(root)!==`${name}-${metadata.revision}`&&path.dirname(root)!==root)root=path.dirname(root);
 assert.equal(path.basename(root),`${name}-${metadata.revision}`,'Browser does not match the pinned Playwright distribution');root=await realpath(root);assert.ok(executable.startsWith(root+path.sep));
 assert.ok((await lstat(path.join(root,'INSTALLATION_COMPLETE'))).isFile(),'An installed browser is required; no download fallback');
 const before=await inventory(root),home=await mkdtemp(path.join(tmpdir(),'game-browser-qualification-'));
 let resources,browser,closing;const errors=[],blocked=[];
 const close=()=>closing??=(async()=>{try{await browser?.close();assert.ok(!browser?.isConnected(),'Owned browser did not acknowledge close');}finally{await resources?.close();signal.removeEventListener('abort',stop);}const after=await inventory(root);assert.equal(after.sha256,before.sha256,'Browser distribution changed during qualification');await rm(home,{recursive:true,force:true});return {browserDisconnected:true,resourcesClosed:true,privateHomeRemoved:true,distributionUnchanged:true,distributionSha256:after.sha256};})();
 const stop=()=>{void close().catch(()=>{});};
 try{
  signal.throwIfAborted();resources=await resourcesModule.serveArtifactResources({artifact,readFile,signal});
  const env=Object.fromEntries(['PATH','TMPDIR','LANG','TZ'].filter(key=>process.env[key]!==undefined).map(key=>[key,process.env[key]]));env.HOME=home;
  browser=await type.launch({headless:true,timeout:10000,env});assert.equal(browser.version(),metadata.browserVersion,'Running browser version differs from its pinned metadata');
  signal.addEventListener('abort',stop,{once:true});signal.throwIfAborted();
  const opened=await isolationModule.openGameArtifactPage(browser,{artifact,readFile},{width:960,height:540},errors,blocked,signal,resources);signal.throwIfAborted();
  return {page:opened.page,errors,blocked,close,browserMetadata:{name,version:browser.version(),playwrightVersion:JSON.parse(await readDiskFile(path.join(packageRoot,'package.json'),'utf8')).version,revision:metadata.revision,distribution:before,headless:true,patchedPlaywrightBrowser:true,consumerSafariOrFirefoxAcceptance:false}};
 }catch(error){await close();throw error;}
}
