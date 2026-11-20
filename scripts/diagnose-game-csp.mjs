// Exact exported artifact, private browser, read-only DOM/CSP observations.
// A maintainer diagnostic, never a production quality/authority receipt.
import assert from 'node:assert/strict';
import {readFile,lstat,mkdir,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import production from '../dist-tests/packages/contracts/src/game-production.js';
import {openInstalledBrowserPreview} from './game-qualification/installed-browser.mjs';
const args=process.argv.slice(2);assert.equal(args.length,2);const attempt=args.find(x=>x.startsWith('--attempt='))?.slice(10),name=args.find(x=>x.startsWith('--browser='))?.slice(10);assert.ok(attempt);assert.ok(name==='webkit'||name==='firefox');
const input=path.resolve(attempt),evidence=JSON.parse(await readFile(path.join(input,'evidence.json'),'utf8')),artifact=production.gameArtifact.parse(evidence.artifact),sha=x=>createHash('sha256').update(x).digest('hex');
const output=path.resolve('output/playwright/game-csp',new Date().toISOString().replace(/[:.]/g,'-')+'-'+randomUUID().slice(0,8));await mkdir(output,{recursive:true});
const read=async name=>{const file=artifact.files.find(x=>x.path===name);assert.ok(file);const p=path.join(input,'build',name),stat=await lstat(p);assert.ok(stat.isFile()&&!stat.isSymbolicLink());const b=await readFile(p);assert.equal(b.length,file.size);assert.equal(sha(b),file.sha256);return b;};
let preview,receipt;const consoleErrors=[];
try{
 preview=await openInstalledBrowserPreview({name,artifact,readFile:read,signal:new AbortController().signal});const page=preview.page;
 page.on('console',message=>{if(message.type()==='error'&&consoleErrors.length<16){const location=message.location();consoleErrors.push({text:message.text().slice(0,1000),file:location.url?new URL(location.url).pathname:'',line:location.lineNumber,column:location.columnNumber});}});
 await page.getByRole('button',{name:'Jogar',exact:true}).click();await page.locator('#hud').waitFor();
 const violations=await page.evaluate(()=>new Promise(resolve=>{const values=[];const record=event=>{if(values.length<16)values.push({effectiveDirective:event.effectiveDirective,violatedDirective:event.violatedDirective,blockedURI:event.blockedURI,sourceFile:event.sourceFile?new URL(event.sourceFile).pathname:'',line:event.lineNumber,column:event.columnNumber});};document.addEventListener('securitypolicyviolation',record);setTimeout(()=>{document.removeEventListener('securitypolicyviolation',record);resolve(values);},2000);}));
 const visible=await page.evaluate(()=>({policies:[...document.querySelectorAll('meta[http-equiv="Content-Security-Policy"]')].map(node=>node.content),inlineStyles:document.querySelectorAll('style').length,progressAttribute:document.getElementById('progress').getAttribute('style'),progressWidth:getComputedStyle(document.getElementById('progress')).width,hintOpacity:getComputedStyle(document.getElementById('hint')).opacity}));
 const beforeScreenshots=[...preview.errors];await page.screenshot({path:path.join(output,'game.png')});const afterFirstScreenshot=[...preview.errors];await page.screenshot({path:path.join(output,'game-2.png')});const afterSecondScreenshot=[...preview.errors];
 await writeFile(path.join(output,'report.json'),JSON.stringify({scope:'Read-only CSS/CSP diagnostic of the exact artifact, normal Play button; not game/physical acceptance',artifactHash:artifact.artifactHash,sourceHash:artifact.sourceHash,consoleErrors,violations,visible,beforeScreenshots,afterFirstScreenshot,afterSecondScreenshot,capturedErrors:preview.errors,blocked:preview.blocked,browser:preview.browserMetadata},null,2)+'\n');console.log('GAME_CSP_DIAGNOSTIC '+output);
}catch(error){await writeFile(path.join(output,'failure.json'),JSON.stringify({message:error.message},null,2)+'\n');throw error;}
finally{if(preview)receipt=await preview.close();await writeFile(path.join(output,'closure.json'),JSON.stringify(receipt??{previewReturned:false},null,2)+'\n');}
