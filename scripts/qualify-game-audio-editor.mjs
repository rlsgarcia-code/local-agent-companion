// Authored UI/codec fixture only; never supplied to real-model game generation.
import assert from 'node:assert/strict';
import {writeFile} from 'node:fs/promises';
import path from 'node:path';
import {decodeWave} from '../dist-tests/packages/adapter-game-assets/src/audio.js';

export async function qualifyAudioEditor({page,client,controller,product,output,settled,setApproval,enableWaveform=false}){
  const base=await client.getGameRevision((await client.listGameProjects()).projects[0].id);
  const project=await client.createGameProject('audio-editor-fixture',{...base.document,title:`Audio Studio ${product}`,files:[],assets:[]});
  await controller.dispatch({action:'select',projectId:project.id});
  const note={waveform:'sine',frequency:220,startMs:0,durationMs:300,gain:.2,pan:0,attackMs:5,releaseMs:10,seed:1};
  const source=await client.processGameAsset('audio-editor-source',project.id,1,{processorId:'local-media-v1',target:{id:'wave-source',role:'Fonte sonora',placeholder:true},operation:{type:'audio.render',output:'assets/source.wav',durationMs:300,sampleRate:22050,channels:1,notes:[note],clips:[]}});await settled(client,source.id);await client.applyGameAsset('audio-editor-apply-source',source.id,1);
  const operation={type:'audio.render',output:'assets/mix.wav',durationMs:500,sampleRate:22050,channels:1,notes:Array.from({length:25},(_,i)=>({...note,frequency:440+i*8,startMs:i*10,durationMs:50})),clips:[{source:{assetId:'wave-source',path:'assets/source.wav'},startMs:0,offsetMs:0,durationMs:100,gain:.5,pan:0,fadeInMs:0,fadeOutMs:0}]};
  const original=await client.processGameAsset('audio-editor-mix',project.id,2,{processorId:'local-media-v1',target:{id:'mix',role:'Mistura editável',placeholder:true},operation});await settled(client,original.id);
  const originalBytes=await client.downloadGameAssetFile(original.id,'assets/mix.wav');
  await page.getByRole('button',{name:'Atualizar',exact:true}).click();await page.getByRole('heading',{name:project.title,exact:true}).waitFor();await page.locator('[data-tab="assets"]').click();
  await page.locator('#candidate-list .row').filter({hasText:'Mistura editável'}).getByRole('button',{name:'Revisar candidato'}).click();await page.locator('#candidate-audio').waitFor({state:'visible'});
  assert.equal(await page.locator('#candidate-audio').evaluate(audio=>audio.paused),true);
  await page.getByRole('button',{name:'Ajustar áudio',exact:true}).click();await page.getByRole('heading',{name:'Ajustar áudio',exact:true}).waitFor();
  assert.equal(await page.locator('#adjust-image').isDisabled(),true,'an open editor cannot offer a second ignored edit action');
  if(enableWaveform){
    await page.getByLabel('Forma de onda e medições',{exact:true}).selectOption('512');await page.locator('#draft-status[data-state="saved"]').waitFor();
    await page.reload();await page.getByRole('heading',{name:'Ajustar áudio',exact:true}).waitFor();
    assert.equal(await page.getByLabel('Forma de onda e medições',{exact:true}).inputValue(),'512');
  }
  await page.bringToFront();assert.equal(await page.evaluate(()=>document.hidden),false);
  await page.evaluate(()=>{window.__audioRefreshMutations=0;window.__audioRefreshObserver=new MutationObserver(()=>window.__audioRefreshMutations++);window.__audioRefreshObserver.observe(document.querySelector('#refresh'),{attributes:true,attributeFilter:['class']});});
  await page.waitForTimeout(5500);assert.equal(await page.evaluate(()=>window.__audioRefreshMutations),0,'background polling cannot interrupt local form editing');await page.evaluate(()=>window.__audioRefreshObserver.disconnect());
  await page.getByLabel('Duração total · ms',{exact:true}).fill('600');await page.getByLabel('Qualidade do áudio',{exact:true}).selectOption('48000');await page.getByLabel('Canais',{exact:true}).selectOption('2');
  await page.getByLabel('Normalizar volume',{exact:true}).check();await page.getByLabel('Pico normalizado · 0,05 a 0,99',{exact:true}).fill('0.8');
  const clip=page.locator('[data-clip-index="0"]');await clip.locator('summary').click();await clip.getByLabel('Ganho',{exact:true}).fill('0.7');await clip.getByLabel('Panorama',{exact:true}).fill('-0.5');await clip.getByLabel('Corte inicial na fonte · ms',{exact:true}).fill('30');await clip.getByLabel('Entrada gradual · ms',{exact:true}).fill('10');await clip.getByLabel('Saída gradual · ms',{exact:true}).fill('20');await clip.getByRole('button',{name:'Duplicar faixa',exact:true}).click();
  const first=page.locator('[data-note-index="0"]');await first.locator('summary').click();await first.getByLabel('Frequência inicial · Hz',{exact:true}).fill('880');await first.getByLabel('Deslizar frequência',{exact:true}).check();await first.getByLabel('Frequência final · Hz',{exact:true}).fill('660');await first.getByRole('button',{name:'Duplicar nota',exact:true}).click();
  assert.equal(await page.locator('[data-note-index]').count(),20,'unopened notes must remain paginated');await page.getByRole('button',{name:'Mostrar mais notas',exact:true}).click();await page.getByRole('button',{name:'Adicionar nota',exact:true}).click();assert.equal(await page.locator('[data-note-index]').count(),27);
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);await page.locator('#image-editor-title').scrollIntoViewIfNeeded();await page.screenshot({path:path.join(output,`${product}-audio-editor.png`)});
  const originalProcess=client.processGameAsset.bind(client),requests=[];let lose=true;
  client.processGameAsset=async(...args)=>{const value=await originalProcess(...args);requests.push({requestId:args[0],jobId:value.id});if(lose){lose=false;throw Error('Fixture lost audio acknowledgment');}return value;};
  let result;
  try{
    setApproval(false);await page.locator('#submit-image').click();await page.locator('#notice').filter({hasText:'Operação cancelada'}).waitFor();assert.equal((await client.listGameProduction(project.id)).jobs.length,2);
    setApproval(true);await page.locator('#submit-image').click();await page.locator('#notice').filter({hasText:'Fixture lost audio acknowledgment'}).waitFor();assert.equal(await page.getByLabel('Duração total · ms',{exact:true}).isDisabled(),true);assert.equal(await page.getByRole('button',{name:'Adicionar nota',exact:true}).isDisabled(),true);
    if(enableWaveform)assert.equal(await page.getByLabel('Forma de onda e medições',{exact:true}).isDisabled(),true);
    setApproval(false);await page.locator('#submit-image').click();await page.locator('#notice').filter({hasText:'Operação cancelada'}).waitFor();assert.equal(await page.getByLabel('Duração total · ms',{exact:true}).isDisabled(),true);
    setApproval(true);await page.locator('#submit-image').click();await page.locator('#image-editor').waitFor({state:'hidden'});assert.equal(requests.length,2);assert.deepEqual(requests[0],requests[1]);assert.equal((await client.listGameProduction(project.id)).jobs.length,3);
    await settled(client,requests[0].jobId);result=await client.getGameAssetResult(requests[0].jobId);
  }finally{client.processGameAsset=originalProcess;setApproval(true);}
  const edited=result.spec.operation;assert.equal(edited.durationMs,600);assert.equal(edited.sampleRate,48000);assert.equal(edited.channels,2);assert.equal(edited.normalizePeak,.8);assert.equal(edited.notes.length,27);assert.equal(edited.notes[25].frequency,632,'unopened final note was preserved');assert.equal(edited.notes[0].frequency,880);assert.equal(edited.notes[0].endFrequency,660);assert.equal(edited.clips.length,2);assert.equal(edited.clips[0].gain,.7);assert.equal(edited.clips[0].pan,-.5);assert.equal(edited.clips[0].offsetMs,30);assert.equal(edited.clips[0].fadeOutMs,20);
  const bytes=await client.downloadGameAssetFile(result.jobId,'assets/mix.wav'),decoded=decodeWave(bytes);assert.equal(decoded.rate,48000);assert.equal(decoded.channels,2);assert.equal(decoded.frames,28800);assert.ok(Math.max(...decoded.samples.map(Math.abs))<=.801);
  assert.deepEqual(await client.downloadGameAssetFile(original.id,'assets/mix.wav'),originalBytes);assert.equal((await client.getGameProject(project.id)).revision,2);
  await page.getByRole('button',{name:'Atualizar',exact:true}).click();await page.locator('#candidate-list .row').filter({hasText:'Mistura editável'}).first().getByRole('button',{name:'Revisar candidato'}).click();await page.locator('#candidate-audio').waitFor({state:'visible'});assert.equal(await page.locator('#candidate-audio').evaluate(audio=>audio.paused),true);
  if(enableWaveform){
    assert.equal(edited.waveformBins,512);await page.locator('#candidate-waveform').waitFor({state:'visible'});
    assert.equal(await page.locator('#candidate-waveform svg').count(),2);
    const measured=await controller.dispatch({action:'asset-audio-analysis',projectId:project.id,jobId:result.jobId});
    assert.equal(measured.analysis.requestedBins,512);assert.equal(measured.analysis.frames,decoded.frames);assert.equal(measured.analysis.channelCount,2);assert.equal(measured.analysis.channels[0].fullScaleSamples,0);
    await page.locator('#candidate-waveform').screenshot({path:path.join(output,`${product}-waveform.png`)});
    await writeFile(path.join(output,`${product}-audio-analysis.json`),JSON.stringify(measured,null,2));
  }
  await page.locator('#apply-candidate').click();await page.waitForFunction(()=>document.querySelector('#revision').textContent.startsWith('Revisão 3'));assert.equal((await client.getGameQuality(project.id)).ready,false);await page.screenshot({path:path.join(output,`${product}-audio-applied.png`),fullPage:true});
  await page.evaluate(()=>{window.__audioRefreshMutations=0;window.__audioRefreshObserver.observe(document.querySelector('#refresh'),{attributes:true,attributeFilter:['class']});});await page.waitForTimeout(5500);assert.ok(await page.evaluate(()=>window.__audioRefreshMutations>0),'background updates resume after the local form closes');await page.evaluate(()=>window.__audioRefreshObserver.disconnect());
  await writeFile(path.join(output,`${product}-edited.wav`),bytes);await writeFile(path.join(output,`${product}-audio-result.json`),JSON.stringify(result,null,2));
  return {projectId:project.id,sourceJobId:source.id,originalJobId:original.id,variantJobId:result.jobId,canonicalControls:true,unopenedNotesPreserved:true,lostAckRecoveredSameRequest:true,oneNewJob:true,denialPreserved:true,noAutoplay:true,waveform:enableWaveform?{draftRestored:true,frozen:true,channels:2,bins:512,exactEncodedWav:true}:null,explicitlyAppliedRevision:3,physicalAudioAcceptance:false};
}
