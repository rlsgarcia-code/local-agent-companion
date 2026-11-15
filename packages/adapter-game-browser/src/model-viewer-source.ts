/** Installed viewer code only. Candidate metadata is loaded as JSON and assigned
 * through textContent; no project HTML, scripts, bridge or tool execution. */
export function modelViewerHtml(engine:string,plugins:string[]){
  const names=[engine,...plugins];if(names.some(name=>!/^[a-zA-Z0-9_.-]+\.js$/.test(name)))throw Error('Invalid model viewer runtime entrypoint.');
  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Companion · Modelo 3D</title><link rel="stylesheet" href="style.css"></head><body>
<header><div><p class="brand">COMPANION <span>· INSPEÇÃO 3D</span></p><h1 id="title">Abrindo modelo…</h1><p id="identity"></p></div><p id="status" role="status">Carregando os arquivos preservados…</p></header>
<main><canvas id="model" tabindex="0" aria-label="Modelo 3D: arraste ou use as setas para girar; roda para ampliar"></canvas><p id="error" role="alert" hidden></p></main>
<section class="controls" aria-label="Controles do modelo"><div class="views"><button id="frame" disabled>Reenquadrar</button><button id="front" disabled>Frente</button><button id="side" disabled>Lado</button><button id="top" disabled>Topo</button></div><div class="animation"><label for="clip">Animação</label><select id="clip" disabled><option value="">Sem animação</option></select><button id="play" disabled>Reproduzir</button><button id="reset" disabled>Voltar ao início</button><label for="speed">Velocidade</label><select id="speed" disabled><option value="0.5">0,5×</option><option value="1" selected>1×</option><option value="2">2×</option></select></div><div class="timeline"><label for="seek">Posição da animação</label><button id="previous-frame" aria-label="Quadro anterior" disabled>−1</button><input id="seek" type="range" min="0" max="1" step="any" value="0" disabled><button id="next-frame" aria-label="Próximo quadro" disabled>+1</button><output id="position" for="seek" aria-live="off">Escolha uma animação</output></div></section>
<footer><p id="geometry"></p><p>Arraste para girar · roda ou pinça para ampliar · setas com o modelo em foco</p><p id="provenance"></p><p>Inspecionar não aplica o candidato ao jogo nem aprova sua qualidade ou licença.</p></footer>
${names.map(name=>`<script src="../runtime/${name}"></script>`).join('')}<script src="viewer.js"></script></body></html>`;
}

export const modelViewerCss=`:root{color-scheme:dark;font-family:system-ui,-apple-system,BlinkMacSystemFont,sans-serif;color:#e4e8ef;background:#161b23;font-size:14px}*{box-sizing:border-box}body{margin:0;min-height:100vh;display:grid;grid-template-rows:auto minmax(320px,1fr) auto auto}header{display:flex;align-items:center;justify-content:space-between;gap:24px;padding:20px 28px;border-bottom:1px solid #323a48}h1{font-size:22px;letter-spacing:-.02em;margin:6px 0;overflow-wrap:anywhere}p{margin:4px 0;color:#aeb9ca;line-height:1.5}.brand{font-size:10px;letter-spacing:.16em;font-weight:700;color:#dce4f2}.brand span{color:#8a9bb3}#status{font-size:12px;text-align:right}main{position:relative;min-height:320px;height:calc(100vh - 270px);background:#1b222d}canvas{display:block;width:100%;height:100%;touch-action:none}button,select{font:inherit;color:inherit;background:#242d3b;border:1px solid #455167;border-radius:5px;min-height:36px;padding:7px 11px}button:hover:enabled,select:hover:enabled{background:#303d51}button:disabled,select:disabled{opacity:.45}button:focus-visible,select:focus-visible,canvas:focus-visible{outline:2px solid #79a6ff;outline-offset:2px}#play{color:#d6e5ff;border-color:#5983cb}label{color:#bfcadd;font-size:12px}.controls{display:flex;flex-wrap:wrap;justify-content:space-between;gap:16px;padding:14px 28px;border-top:1px solid #323a48}.views,.animation{display:flex;align-items:center;gap:8px;flex-wrap:wrap}#clip{max-width:260px}footer{padding:4px 28px 18px;font-size:11px}#geometry{color:#dbe3ef}#error{position:absolute;left:24px;right:24px;top:24px;padding:18px;background:#30262b;color:#ffdce2;border-left:3px solid #e49caa;white-space:pre-wrap;overflow-wrap:anywhere}@media(max-width:760px){header{align-items:flex-start;padding:16px}#status{max-width:38%}.controls{padding:12px 16px;gap:10px}.animation{gap:6px}footer{padding:8px 16px 16px}main{height:52vh}#clip{max-width:190px}}.timeline{display:flex;align-items:center;flex:1 1 100%;gap:8px;flex-wrap:wrap}.timeline input{flex:1;min-width:120px;accent-color:#79a6ff}.timeline input:focus-visible{outline:2px solid #79a6ff;outline-offset:3px}.timeline output{min-width:180px;text-align:right;font-size:12px;font-variant-numeric:tabular-nums;color:#bfcadd}main{height:calc(100vh - 320px)}@media(max-width:760px){.timeline label,.timeline output{flex:1 1 100%;text-align:left}main{height:48vh}}`;

export const modelViewerScript=String.raw`(async()=>{
  'use strict';
  const el=id=>document.getElementById(id),canvas=el('model');let engine,scene,groups=[],active=null,playing=false;
  const stop=()=>{for(const group of groups)group.stop();playing=false;el('play').textContent='Reproduzir';};
  const fail=()=>{stop();el('status').textContent='Inspeção indisponível';el('error').hidden=false;el('error').textContent='Não foi possível carregar este modelo com os recursos locais disponíveis. Preserve o candidato e confira o formato, as dependências e o runtime instalado.';for(const control of document.querySelectorAll('button,select,input'))control.disabled=true;};
  try{
    const response=await fetch('config.json');if(!response.ok)throw Error('Missing viewer metadata');const config=await response.json();
    el('title').textContent=config.title;document.title='Companion · '+config.title;
    el('identity').textContent='Candidato da revisão '+config.revision+(config.placeholder?' · Recurso temporário':' · Final declarado');
    el('provenance').textContent='Origem: '+config.source+' · Licença declarada: '+config.license;
    engine=new BABYLON.Engine(canvas,true,{preserveDrawingBuffer:true,stencil:true});engine.setHardwareScalingLevel(1/Math.min(devicePixelRatio||1,2));
    scene=new BABYLON.Scene(engine);scene.clearColor=new BABYLON.Color4(.105,.133,.176,1);
    const camera=new BABYLON.ArcRotateCamera('viewer-camera',-Math.PI/2.4,Math.PI/2.5,5,BABYLON.Vector3.Zero(),scene);scene.activeCamera=camera;camera.attachControl(canvas,true);camera.inertia=.65;
    const fill=new BABYLON.HemisphericLight('viewer-fill',new BABYLON.Vector3(0,1,0),scene);fill.intensity=1.1;fill.groundColor=new BABYLON.Color3(.24,.27,.32);
    const key=new BABYLON.DirectionalLight('viewer-key',new BABYLON.Vector3(-.5,-1,.4),scene);key.intensity=1.4;
    BABYLON.SceneLoader.OnPluginActivatedObservable.addOnce(plugin=>{if(plugin.name==='gltf'){plugin.animationStartMode=BABYLON.GLTFLoaderAnimationStartMode.NONE;plugin.onExtensionLoadedObservable.add(extension=>{if(['KHR_draco_mesh_compression','EXT_meshopt_compression','KHR_texture_basisu','MSFT_audio_emitter','KHR_interactivity'].includes(extension.name))extension.enabled=false;});}});
    const slash=config.model.lastIndexOf('/'),container=await BABYLON.SceneLoader.LoadAssetContainerAsync(config.model.slice(0,slash+1),config.model.slice(slash+1),scene,undefined,'.glb');
    container.addAllToScene();groups=container.animationGroups;stop();
    const meshes=container.meshes.filter(mesh=>mesh.getTotalVertices()>0);if(!meshes.length)throw Error('No geometry');
    let min=new BABYLON.Vector3(Infinity,Infinity,Infinity),max=new BABYLON.Vector3(-Infinity,-Infinity,-Infinity),vertices=0,triangles=0;
    for(const mesh of meshes){mesh.computeWorldMatrix(true);const box=mesh.getBoundingInfo().boundingBox;min=BABYLON.Vector3.Minimize(min,box.minimumWorld);max=BABYLON.Vector3.Maximize(max,box.maximumWorld);vertices+=mesh.getTotalVertices();triangles+=Math.floor(mesh.getTotalIndices()/3);}
    const size=max.subtract(min),center=min.add(max).scale(.5),diameter=size.length();if(!Number.isFinite(diameter)||diameter<=0)throw Error('Invalid bounds');
    const radius=diameter/(2*Math.tan(camera.fov/2))*1.2;
    const frame=()=>{camera.setTarget(center);camera.radius=radius;};frame();camera.minZ=Math.max(.00001,diameter/1000);camera.maxZ=Math.max(100,diameter*100);camera.lowerRadiusLimit=diameter*.1;camera.upperRadiusLimit=diameter*10;camera.wheelDeltaPercentage=.01;camera.pinchDeltaPercentage=.01;camera.panningSensibility=1000/diameter;
    const floor=BABYLON.MeshBuilder.CreateGround('viewer-floor',{width:diameter*3,height:diameter*3},scene);floor.position.set(center.x,min.y-diameter*.005,center.z);const floorMaterial=new BABYLON.StandardMaterial('viewer-floor-material',scene);floorMaterial.diffuseColor=new BABYLON.Color3(.15,.18,.23);floorMaterial.specularColor=BABYLON.Color3.Black();floor.material=floorMaterial;
    el('geometry').textContent=meshes.length+' malhas · '+vertices.toLocaleString('pt-BR')+' vértices · '+triangles.toLocaleString('pt-BR')+' triângulos · Dimensões '+[size.x,size.y,size.z].map(value=>value.toFixed(2)).join(' × ')+' unidades · '+groups.length+' animações';
    for(const [index,group] of groups.entries()){const option=document.createElement('option');option.value=String(index);option.textContent=group.name||'Animação '+(index+1);el('clip').append(option);}
    for(const id of ['frame','front','side','top'])el(id).disabled=false;
    el('frame').onclick=frame;el('front').onclick=()=>{frame();camera.alpha=-Math.PI/2;camera.beta=Math.PI/2.2;};el('side').onclick=()=>{frame();camera.alpha=0;camera.beta=Math.PI/2.2;};el('top').onclick=()=>{frame();camera.beta=.04;};
    const format=value=>value.toLocaleString('pt-BR',{maximumFractionDigits:2});
    let fps=null;
    const position=frame=>{
      if(!active)return;const value=Math.max(active.from,Math.min(active.to,frame));el('seek').value=String(value);
      const text='Quadro '+format(value)+' de '+format(active.to)+(fps?' · '+format((value-active.from)/fps)+' / '+format((active.to-active.from)/fps)+' s':'');
      el('position').textContent=text;el('seek').setAttribute('aria-valuetext',text);
      el('previous-frame').disabled=value<=active.from;el('next-frame').disabled=value>=active.to;
    };
    const pause=()=>{if(active?.isStarted)active.pause();playing=false;el('play').textContent='Reproduzir';};
    const seek=frame=>{if(!active||!Number.isFinite(frame))return;pause();if(!active.isStarted){active.start(true,Number(el('speed').value));active.pause();}const value=Math.max(active.from,Math.min(active.to,frame));active.goToFrame(value);scene.render();position(value);};
    el('clip').disabled=!groups.length;el('clip').onchange=()=>{
      stop();active=el('clip').value===''?null:groups[Number(el('clip').value)];
      if(active&&(!Number.isFinite(active.from)||!Number.isFinite(active.to)||active.to<active.from))active=null;
      for(const id of ['play','reset','speed','seek','previous-frame','next-frame'])el(id).disabled=!active;
      if(!active){el('seek').value=el('seek').min='0';el('seek').max='1';el('seek').removeAttribute('aria-valuetext');el('position').textContent='Escolha uma animação';return;}
      const rates=active.targetedAnimations.map(target=>target.animation.framePerSecond);fps=rates.length&&rates.every(rate=>Number.isFinite(rate)&&rate>0&&Math.abs(rate-rates[0])<1e-6)?rates[0]:null;
      el('seek').min=String(active.from);el('seek').max=String(active.to);el('seek').disabled=active.to===active.from;seek(active.from);
    };
    el('seek').oninput=()=>seek(Number(el('seek').value));el('seek').onpointerdown=()=>{pause();if(active)position(active.getCurrentFrame());};
    el('previous-frame').onclick=()=>seek(Number(el('seek').value)-1);el('next-frame').onclick=()=>seek(Number(el('seek').value)+1);
    el('play').onclick=()=>{if(!active)return;if(playing)pause();else{if(active.isStarted)active.play(true);else active.start(true,Number(el('speed').value));active.speedRatio=Number(el('speed').value);playing=true;}el('play').textContent=playing?'Pausar':'Reproduzir';};
    el('speed').onchange=()=>{if(active)active.speedRatio=Number(el('speed').value);};
    el('reset').onclick=()=>{if(active)seek(active.from);};
    document.addEventListener('visibilitychange',()=>{if(document.hidden&&active&&playing){pause();position(active.getCurrentFrame());}});
    window.addEventListener('resize',()=>engine.resize());window.addEventListener('pagehide',()=>{stop();scene.dispose();engine.dispose();},{once:true});
    await scene.whenReadyAsync();
    let firstRendered=false;const firstFrame=new Promise(resolve=>engine.onEndFrameObservable.addOnce(resolve));
    engine.runRenderLoop(()=>{if(!firstRendered||!document.hidden){scene.render();firstRendered=true;if(playing&&active)position(active.getCurrentFrame());}});
    await firstFrame;el('status').textContent='Modelo carregado · somente inspeção';
  }catch{fail();scene?.dispose();engine?.dispose();}
})();`;
