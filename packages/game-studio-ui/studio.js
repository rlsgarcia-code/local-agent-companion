(() => {
  "use strict";
  const el=(id)=>document.getElementById(id),pending=new Map();
  const vscode=typeof acquireVsCodeApi==="function"?acquireVsCodeApi():null;
  let snapshot=null,busy=false,tab="overview",assetLimit=30,projectCursor=0,editing=false,editRevision=0,captureKey="",editDesign=null,editProjectId="",refreshError="";
  let candidate=null,candidateEpoch=0,mediaProjectId="",imageEdit=null;
  let audioEncodeDraft=null,restoredAudioEncode=false;
  let deliveryDraft=null,deliveryCatalog=null,restoredDelivery=false,deliveryLoading=false,deliveryLimit=30;
  const libraryStorageKey="companion.gameStudio.libraryImport.v1";
  let libraryPage=null,libraryProjectId="",libraryDraft=null,libraryRestored=false;
  let playtestPage=null,playtestProjectId="",playtestStudy=null,playtestDraft=null,restoredPlaytest=false,playtestLoading=false,playtestSubmitting=false,playtestCorrectionHistory=null;
  let comparison=null,comparisonProjectId="",comparisonLoading=false,comparisonQuery=null;
  let fileComparison=null,fileComparisonQuery=null,fileComparisonLoading=false,fileComparisonEpoch=0;
  let revisionMediaEpoch=0,revisionMediaLoading=false;
  let restoreDraft=null,restoredRestore=false;
  // UI draft only. Hosts/service validate all restored content and authority;
  // restoring never dispatches an import or changes its durable request identity.
  function readLibraryDraft(saved){
    try{
      const raw=saved===undefined?(typeof vscode?.getState==="function"?vscode.getState()?.libraryImport:JSON.parse(sessionStorage.getItem(libraryStorageKey)??"null")):saved;
      if(!raw||JSON.stringify(raw).length>512*1024||raw.schemaVersion!==1)return null;
      const value=structuredClone(raw),spec=value.command?.spec??value.spec,selection=spec?.operation?.selection,entry=selection?.entry,library=selection?.library;
      if(spec?.operation?.type!=="library.copy"||![value.projectId,value.projectTitle,value.requestId,spec.processorId,spec.target?.id,spec.target?.role,spec.operation.outputBase].every(item=>typeof item==="string")||!Number.isInteger(value.expectedRevision)||value.expectedRevision<1)return null;
      if(!entry||!library||![entry.id,entry.title,library.id,library.title,library.author,library.version,library.source,library.spdx].every(item=>typeof item==="string")||!Array.isArray(entry.files)||entry.files.length>16||!entry.files.every(file=>typeof file.path==="string"&&typeof file.mime==="string"&&Number.isInteger(file.size)&&file.size>0&&file.size<=64*1024*1024)||!Array.isArray(entry.animations)||entry.animations.length>128||!entry.animations.every(name=>typeof name==="string"))return null;
      if(value.command&&(value.command.action!=="import-library"||value.command.projectId!==value.projectId||value.command.requestId!==value.requestId||value.command.expectedRevision!==value.expectedRevision))return null;
      value.spec=spec;return value;
    }catch{return null;}
  }
  let draftReady=false,draftRevision=0,draftQueue=Promise.resolve(),restoredMedia=false,restoredDesign=false,designRequestId="",designCommand=null,draftSaveSerial=0;
  function draftState(){
    const designEdit=editing?{projectId:editProjectId,expectedRevision:editRevision,requestId:designRequestId,design:editDesign,command:designCommand,
      values:Object.fromEntries([...el("design-fields").querySelectorAll("textarea")].map(input=>[input.dataset.field,input.value]))}:null;
    // JSON roundtrip freezes data at this keystroke, not after later queued edits.
    return JSON.parse(JSON.stringify({schemaVersion:1,libraryImport:libraryDraft,mediaEdit:imageEdit,designEdit,playtestEdit:playtestDraft,...(restoreDraft?{restoreEdit:restoreDraft}:{}),...(audioEncodeDraft?{audioEncodeEdit:audioEncodeDraft}:{}),...(deliveryDraft?{deliveryEdit:deliveryDraft}:{})}));
  }
  function persistDrafts(){
    if(!draftReady)return Promise.reject(new Error("Recupere os rascunhos preservados antes de enviar um pedido."));
    const value=draftState(),serial=++draftSaveSerial;el("draft-status").textContent="Salvando rascunho neste computador…";el("draft-status").dataset.state="saving";
    const next=draftQueue.then(async()=>{const record=await request({action:"draft-write",expectedRevision:draftRevision,value});draftRevision=record.revision;if(serial===draftSaveSerial){el("draft-status").textContent="Rascunho salvo neste computador.";el("draft-status").dataset.state="saved";}return record;});
    // A failed/unknown save must not let a different snapshot overwrite it.
    draftQueue=next;void next.catch(error=>{el("draft-status").textContent="Última edição ainda não confirmada.";el("draft-status").dataset.state="error";notice(`Não foi possível preservar o rascunho: ${error.message}`,true);});return next;
  }
  function persistLibraryDraft(){return persistDrafts();}
  function saveLocalDraft(){void persistDrafts().catch(()=>{});}
  async function initializeDrafts(){
    let initializationError="";
    try{
      const record=await request({action:"draft-read"});draftRevision=record.revision;const state=record.value;
      if(state){
        if(state.deliveryEdit){deliveryDraft=readDeliveryDraft(state.deliveryEdit);restoredDelivery=true;}
        if(state.audioEncodeEdit){audioEncodeDraft=readAudioEncodeDraft(state.audioEncodeEdit);restoredAudioEncode=true;}
        if(state.restoreEdit!==undefined&&state.restoreEdit!==null){restoreDraft=readRestoreDraft(state.restoreEdit);restoredRestore=true;}
        if(state.playtestEdit){playtestDraft=readPlaytestDraft(state.playtestEdit);restoredPlaytest=true;}
        if(state.libraryImport){libraryDraft=readLibraryDraft(state.libraryImport);if(!libraryDraft)throw new Error("A importação preservada precisa de recuperação; não será sobrescrita.");}
        if(state.mediaEdit){const edit=state.mediaEdit,op=edit.operation;
          if(![edit.projectId,edit.jobId,edit.requestId].every(value=>typeof value==="string")||!Number.isInteger(edit.expectedRevision)||edit.expectedRevision<1||!op||!["image.compose","image.vector","audio.render","model.scene"].includes(op.type))throw new Error("Os ajustes preservados precisam de recuperação; não serão sobrescritos.");
          if(edit.command&&(edit.command.projectId!==edit.projectId||edit.command.jobId!==edit.jobId||edit.command.requestId!==edit.requestId||edit.command.expectedRevision!==edit.expectedRevision))throw new Error("O vínculo do pedido preservado é inválido.");
          imageEdit=edit;restoredMedia=true;
        }
        if(state.designEdit){const edit=state.designEdit;if(typeof edit.projectId!=="string"||typeof edit.requestId!=="string"||!Number.isInteger(edit.expectedRevision)||!edit.design||!edit.values||typeof edit.values!=="object")throw new Error("O design preservado precisa de recuperação; não será sobrescrito.");
          editing=true;editProjectId=edit.projectId;editRevision=edit.expectedRevision;editDesign=edit.design;designRequestId=edit.requestId;designCommand=edit.command??null;
          if(designCommand&&(designCommand.action!=="design"||designCommand.projectId!==editProjectId||designCommand.requestId!==designRequestId||designCommand.expectedRevision!==editRevision))throw new Error("O vínculo do design preservado é inválido.");restoredDesign=edit.values;
        }
      }else libraryDraft=readLibraryDraft();
      draftReady=true;if(!state&&libraryDraft)await persistDrafts();
    }catch(error){initializationError=`Não foi possível recuperar os rascunhos: ${error.message}`;}
    await refresh();if(initializationError||!draftReady){if(initializationError)notice(initializationError,true);el("draft-status").textContent="Rascunho preservado; recuperação necessária.";el("draft-status").dataset.state="error";}else if(!draftSaveSerial){el("draft-status").textContent=libraryDraft||imageEdit||audioEncodeDraft||deliveryDraft||editing||playtestDraft||restoreDraft?"Rascunho recuperado. Confira antes de enviar.":"Rascunhos locais prontos.";el("draft-status").dataset.state="ready";}
  }
  window.addEventListener("message",(event)=>{
    // The VS Code host does not promise the DOM event's source identity. Only
    // this nonce-loaded UI exists here; games run in a separate browser, with
    // no bridge. Correlate replies against unpredictable pending request IDs.
    if(event.data?.type!=="game-studio-response")return;
    const waiter=pending.get(event.data.id);if(!waiter)return;pending.delete(event.data.id);clearTimeout(waiter.timer);
    event.data.error?waiter.reject(new Error(event.data.error)):waiter.resolve(event.data.value);
  });
  function request(command){
    if(!["refresh","select","draft-read","draft-write"].includes(command.action))command={projectId:snapshot?.project?.id,...command};
    if(window.gameStudioHost)return window.gameStudioHost.request(command);
    if(!vscode)return Promise.reject(new Error("Abra o Game Studio pelo Companion ou VS Code."));
    const id=crypto.randomUUID();return new Promise((resolve,reject)=>{
      const timer=setTimeout(()=>{pending.delete(id);reject(new Error("A operação ainda pode estar no serviço. Atualize o projeto antes de tentar novamente."));},120000);
      pending.set(id,{resolve,reject,timer});vscode.postMessage({type:"game-studio-request",id,command});
    });
  }
  function node(tag,text,cls){const item=document.createElement(tag);if(text!==undefined)item.textContent=String(text);if(cls)item.className=cls;return item;}
  function notice(text,error=false){if(el("notice").textContent!==text)el("notice").textContent=text;el("notice").classList.toggle("error",error);}
  const time=(value)=>new Date(value).toLocaleString("pt-BR");
  const states={admitting:"Confirmando cota",queued:"Na fila",running:"Em execução",cancelling:"Encerrando",cancelled:"Cancelado",completed:"Concluído",failed:"Falhou",awaiting_reconciliation:"Precisa de reconciliação"};
  const kinds={build:"Build",validate:"Verificação",assets:"Processamento de asset"};
  const words={desktop:"Computador",tablet:"Tablet",mobile:"Celular",keyboard:"Teclado",pointer:"Mouse",touch:"Toque",gamepad:"Controle",runtime:"Jogabilidade e recuperação",content:"Conteúdo e progressão",visual:"Arte e animação",audio:"Som e mixagem",performance:"Desempenho",license:"Origem e licenças",human:"Playtests com jogadores"};
  function button(text,callback,disabled=false){const item=node("button",text);item.type="button";item.disabled=disabled;item.addEventListener("click",callback);return item;}
  function row(title,detail,actions=[]){const item=node("div",undefined,"row"),copy=node("div"),controls=node("div",undefined,"row-actions");copy.append(node("strong",title),node("small",detail));controls.append(...actions);item.append(copy,controls);return item;}
  async function act(command,silent=false){
    if(busy)return;busy=true;
    // Buttons must reflect the same gate as act/openCandidate. Otherwise a
    // slow background refresh leaves an enabled control whose click is lost.
    // Release old controls before rendering a new snapshot, so its permission
    // and revision decisions cannot be overwritten by a former enabled state.
    const busyButtons=[...document.querySelectorAll("button")].filter(button=>!button.disabled);
    for(const button of busyButtons)button.disabled=true;
    const releaseButtons=()=>{for(const button of busyButtons.splice(0))if(button.isConnected)button.disabled=false;};
    el("refresh").classList.add("loading");el("candidate-file").disabled=true;el("candidate-model").disabled=true;el("apply-candidate").disabled=true;el("export-candidate").disabled=true;el("adjust-image").disabled=true;renderImageEditState();renderAudioEncodeState();renderDeliveryState();renderLibraryState();renderDesignEditState();renderPlaytestState();renderComparisonState();renderFileComparisonState();renderRestoreState();if(!silent)notice("");
    try{
      const value=await request(command);
      if(value?.capabilities){if(refreshError&&el("notice").textContent===refreshError)notice("");refreshError="";snapshot=value;releaseButtons();render();}
      else if(value?.cancelled)notice("Operação cancelada.");
      else if(value?.imageAdjustmentRejected)notice(value.message,true);
      else if(value?.audioEncodeRejected)notice(value.message,true);
      else if(value?.deliveryEditRejected)notice(value.message,true);
      else if(value?.libraryImportRejected)notice(value.message,true);
      else if(value?.designEditRejected)notice(value.message,true);
      else if(value?.restoreRejected)notice(value.message,true);
      else if(value?.playtestEditRejected)notice(value.message,true);
      else if(value?.exported)notice("Exportação concluída na pasta escolhida.");
      else if(value?.exported===false)notice("Exportação cancelada.");
      else if(value?.modelPreviewOpened)notice("Visor 3D aberto. O candidato permanece sem aplicação automática.");
      else if(value?.opened)notice(`Preview da revisão ${value.revision} aberto. Os saves dessa janela são temporários.`);
      return value;
    }catch(error){if(command.action==="refresh")refreshError=error.message;notice(error.message,true);el("sync").textContent="Sem atualização · os dados exibidos podem estar antigos.";}
    finally{busy=false;releaseButtons();el("refresh").classList.remove("loading");el("candidate-file").disabled=!candidate||!el("candidate-file").options.length;renderCandidateState();renderImageEditState();renderAudioEncodeState();renderDeliveryState();renderLibraryState();renderDesignEditState();renderPlaytestState();renderComparisonState();renderFileComparisonState();renderRestoreState();if(tab==="playtests"&&snapshot?.canManagePlaytests&&!playtestLoading&&!playtestSubmitting&&playtestProjectId!==snapshot.project?.id)void loadPlaytests();}
  }
  const refresh=(silent=false)=>act({action:"refresh",projectCursor},silent===true);
  function readDeliveryDraft(raw){
    const d=structuredClone(raw);
    if(d.schemaVersion!==1||![d.projectId,d.projectTitle,d.requestId].every(v=>typeof v==='string')||!Number.isInteger(d.expectedRevision)||d.expectedRevision<1||!/^([a-f0-9]{64})$/.test(d.configSha256)||!['all','selected'].includes(d.mode)||!Array.isArray(d.files)||d.files.length>20000||!d.files.every(p=>typeof p==='string'&&p.length<=400)||new Set(d.files).size!==d.files.length||typeof d.query!=='string'||d.query.length>200)throw Error('A seleção de recursos preservada precisa de recuperação; o original não será sobrescrito.');
    if(d.command){const c=d.command;if(c.action!=='set-delivery'||c.projectId!==d.projectId||c.requestId!==d.requestId||c.expectedRevision!==d.expectedRevision||c.configSha256!==d.configSha256||c.delivery!==null&&(c.delivery?.schemaVersion!==1||!Array.isArray(c.delivery.files)||c.delivery.files.length>20000||!c.delivery.files.every(p=>typeof p==='string'&&p.length<=400)))throw Error('O vínculo do pedido de recursos foi preservado para conferência.');d.mode=c.delivery===null?'all':'selected';if(c.delivery)d.files=[...c.delivery.files];}
    return d;
  }
  const deliveryCurrent=()=>deliveryDraft&&snapshot?.project?.id===deliveryDraft.projectId&&snapshot.project.revision===deliveryDraft.expectedRevision;
  async function loadDeliveryCatalog(d){
    if(!d||deliveryLoading)return;deliveryLoading=true;renderDeliveryState();
    try{const result=await request({action:'delivery-settings',projectId:d.projectId,revision:d.expectedRevision});
      if(deliveryDraft!==d)return;const data=result?.deliverySettings;
      if(!data||data.projectId!==d.projectId||data.revision!==d.expectedRevision||data.configSha256!==d.configSha256||!Array.isArray(data.files))throw Error(result?.message??'Os arquivos originais não puderam ser conferidos. O pedido continua preservado.');
      deliveryCatalog=data;renderDeliveryFiles();
    }catch(error){if(deliveryDraft===d)notice(error.message,true);}finally{deliveryLoading=false;renderDeliveryState();}
  }
  function showDelivery(){
    if(!deliveryDraft)return;el('delivery-editor').hidden=false;el('delivery-origin').textContent=`${deliveryDraft.projectTitle} · revisão ${deliveryDraft.expectedRevision}`;
    el('delivery-mode').value=deliveryDraft.mode;el('delivery-filter').value=deliveryDraft.query;renderDeliveryFiles();renderDeliveryState();
  }
  function renderDeliveryFiles(){
    const d=deliveryDraft;if(!d)return;el('delivery-selection').hidden=d.mode!=='selected';
    const files=deliveryCatalog?.projectId===d.projectId&&deliveryCatalog.revision===d.expectedRevision?deliveryCatalog.files:d.files.map(path=>({path,size:null}));
    const focusedPath=document.activeElement?.dataset?.deliveryPath;
    const query=d.query.toLocaleLowerCase('pt-BR'),matches=files.filter(f=>f.path.toLocaleLowerCase('pt-BR').includes(query)),chosen=new Set(d.files);
    el('delivery-files').replaceChildren(...matches.slice(0,deliveryLimit).map((file,index)=>{
      const label=node('label',undefined,'delivery-file'),input=node('input');input.type='checkbox';input.checked=chosen.has(file.path);input.dataset.deliveryPath=file.path;input.setAttribute('aria-label',file.path);
      const text=node('span',file.path),size=node('small',file.size===null?'Tamanho ainda não conferido':`${file.size.toLocaleString('pt-BR')} bytes`,'muted');text.append(size);label.append(input,text);return label;
    }));
    const picked=files.filter(f=>chosen.has(f.path)),bytes=picked.reduce((sum,f)=>sum+(f.size??0),0);
    el('delivery-count').textContent=`${d.files.length} arquivos pedidos · ${bytes.toLocaleString('pt-BR')} bytes conferidos, sem runtime e avisos adicionais. Mostrando ${Math.min(deliveryLimit,matches.length)} de ${matches.length} arquivos do filtro.`;
    el('delivery-more').hidden=deliveryLimit>=matches.length;renderDeliveryState();
    if(focusedPath)[...el('delivery-files').querySelectorAll('input')].find(input=>input.dataset.deliveryPath===focusedPath)?.focus();
  }
  function renderDeliveryState(){
    const d=deliveryDraft,current=deliveryCurrent(),same=d&&snapshot?.project?.id===d.projectId,frozen=Boolean(d?.command);
    el('choose-delivery').disabled=busy||deliveryLoading||Boolean(d)||!draftReady||!snapshot?.canWrite||!snapshot?.canChooseDelivery||!['phaser','babylon'].includes(snapshot?.project?.engine);
    el('choose-delivery').title=snapshot?.canChooseDelivery?'Escolher arquivos sem remover os originais':'O motor precisa oferecer a seleção de recursos web.';
    el('delivery-editor').hidden=!d;if(!d)return;
    const locked=busy||deliveryLoading||frozen||!current||!snapshot?.canWrite;
    el('delivery-fields').disabled=locked;el('delivery-more').disabled=busy||deliveryLoading;
    el('cancel-delivery').disabled=busy||deliveryLoading||frozen;el('delivery-reload').disabled=busy||deliveryLoading||!same;
    el('submit-delivery').textContent=frozen?'Conferir pedido':'Salvar recursos';el('submit-delivery').disabled=busy||deliveryLoading||!draftReady||!same||!frozen&&(!current||!snapshot?.canWrite||!snapshot?.canChooseDelivery||!deliveryCatalog);
    el('delivery-state').textContent=deliveryLoading?'Conferindo os arquivos da revisão original…':frozen?'Pedido preservado. Conferir consulta o recibo original; nenhum pedido substituto será criado.':!current?'A revisão ou o projeto mudou. Sua escolha permanece vinculada à fonte original.':d.mode==='all'?'Todos os recursos voltam ao build; os fontes permanecem completos.':'Escolha local. Salvar pede confirmação e cria uma revisão; ainda será necessário gerar e testar o build.';
  }
  el('choose-delivery').addEventListener('click',async()=>{
    if(busy||deliveryDraft||!draftReady||!snapshot?.canWrite||!snapshot.canChooseDelivery)return;
    const result=await act({action:'delivery-settings',projectId:snapshot.project.id,revision:snapshot.project.revision}),data=result?.deliverySettings;if(!data)return;
    deliveryCatalog=data;deliveryLimit=30;deliveryDraft={schemaVersion:1,projectId:data.projectId,projectTitle:data.projectTitle,expectedRevision:data.revision,requestId:crypto.randomUUID(),configSha256:data.configSha256,
      mode:data.delivery?'selected':'all',files:data.delivery?[...data.delivery.files]:data.files.map(f=>f.path),query:'',command:null};
    showDelivery();saveLocalDraft();el('delivery-title').focus();
  });
  el('delivery-mode').addEventListener('change',()=>{if(!deliveryDraft||deliveryDraft.command)return;deliveryDraft.mode=el('delivery-mode').value;renderDeliveryFiles();saveLocalDraft();});
  el('delivery-filter').addEventListener('input',()=>{if(!deliveryDraft||deliveryDraft.command)return;deliveryDraft.query=el('delivery-filter').value;deliveryLimit=30;renderDeliveryFiles();saveLocalDraft();});
  el('delivery-files').addEventListener('change',event=>{const input=event.target,d=deliveryDraft;if(!d||d.command||!input.dataset.deliveryPath)return;const selected=new Set(d.files);input.checked?selected.add(input.dataset.deliveryPath):selected.delete(input.dataset.deliveryPath);d.files=[...selected];renderDeliveryFiles();saveLocalDraft();});
  el('delivery-clear').addEventListener('click',()=>{if(!deliveryDraft||deliveryDraft.command)return;deliveryDraft.files=[];renderDeliveryFiles();saveLocalDraft();});
  el('delivery-more').addEventListener('click',()=>{deliveryLimit+=30;renderDeliveryFiles();});
  el('delivery-reload').addEventListener('click',()=>loadDeliveryCatalog(deliveryDraft));
  el('cancel-delivery').addEventListener('click',async()=>{if(!deliveryDraft||deliveryDraft.command||busy)return;const original=deliveryDraft;deliveryDraft=null;try{await persistDrafts();deliveryCatalog=null;}catch{deliveryDraft=original;}showDelivery();renderDeliveryState();});
  el('delivery-editor').addEventListener('submit',async event=>{
    event.preventDefault();if(busy||!deliveryDraft)return;const d=deliveryDraft,resuming=Boolean(d.command);
    if(!d.command)d.command={action:'set-delivery',projectId:d.projectId,expectedRevision:d.expectedRevision,requestId:d.requestId,configSha256:d.configSha256,delivery:d.mode==='all'?null:{schemaVersion:1,files:[...d.files]}};
    renderDeliveryState();try{await persistDrafts();}catch{return;}
    const value=await act(resuming?{...d.command,action:'resume-delivery'}:d.command);if(deliveryDraft!==d)return;
    if(value?.deliveryMutationAcknowledged){deliveryDraft=null;try{await persistDrafts();deliveryCatalog=null;}catch{deliveryDraft=d;}renderDeliveryState();if(!deliveryDraft)notice('Escolha confirmada. Gere e teste um novo build para conferir o resultado.');}
    else if((value?.cancelled||value?.deliveryEditRejected)&&!resuming){d.command=null;saveLocalDraft();renderDeliveryState();}
  });
  const newestBuild=()=>snapshot?.jobs?.jobs.find((job)=>job.kind==="build"&&job.state==="completed");
  function switchTab(next){tab=next;if(next!=="history")pauseRevisionMedia();if(next!=="assets"){el("asset-audio").pause();el("candidate-audio").pause();}document.querySelectorAll(".view").forEach((view)=>{view.hidden=view.id!==tab;});document.querySelectorAll("[data-tab]").forEach((button)=>{if(button.dataset.tab===tab)button.setAttribute("aria-current","page");else button.removeAttribute("aria-current");});if(next==="playtests"&&snapshot?.canManagePlaytests&&!playtestLoading&&playtestProjectId!==snapshot.project?.id&&!busy)void loadPlaytests();}
  function render(){
    if(!snapshot)return;
    renderImageEditState();
    const project=snapshot.project,doc=snapshot.revision?.document,build=newestBuild();
    if(libraryProjectId&&libraryProjectId!==project?.id){libraryPage=null;libraryProjectId="";el("library-list").replaceChildren();el("more-library").hidden=true;el("library-status").textContent="A seleção mudou. Consulte os recursos deste projeto novamente.";}
    if(candidate&&candidate.projectId!==project?.id)clearCandidate();
    if(mediaProjectId&&mediaProjectId!==project?.id){el("asset-preview").hidden=true;el("asset-audio").pause();el("asset-audio").removeAttribute("src");el("asset-image").removeAttribute("src");mediaProjectId="";}
    if(editing&&editProjectId!==project?.id)notice("A seleção mudou em outra janela. Sua edição continua no jogo original; volte a ele ou cancele a edição.",true);
    el("projects").replaceChildren(...snapshot.projects.projects.map((project)=>{
      const item=button("",()=>{el("asset-preview").hidden=true;el("asset-audio").pause();captureKey="";assetLimit=30;return act({action:"select",projectId:project.id});});item.className="project-item";item.setAttribute("aria-current",String(project.id===snapshot.project?.id));item.append(node("strong",project.title),node("small",`${project.engine} · revisão ${project.revision}`));return item;
    }));
    el("more-projects").hidden=!snapshot.projects.hasMore;
    el("empty").hidden=Boolean(project);el("project").hidden=!project;
    el("title").textContent=project?.title??"Seu próximo jogo";el("engine").textContent=project?`${project.engine.toUpperCase()} · ${doc.brief.dimension.toUpperCase()}`:"PROJETO LOCAL";
    el("revision").textContent=project?`Revisão ${project.revision} · ${doc.brief.genre}`:"Selecione um projeto ou comece pela conversa.";
    el("sync").textContent=`Atualizado em ${time(snapshot.updatedAt)}`;
    if(!project)return;
    const adapter=snapshot.capabilities.adapters.find((adapter)=>adapter.engine===project.engine);
    el("build").disabled=!snapshot.canWrite||!adapter?.available||snapshot.workflow?.budget?.exhausted||snapshot.workflow?.workflow?.state==="completed";el("build").title=adapter?.reason??(snapshot.canWrite?"":"Ative um modo de edição para produzir.");
    el("play").disabled=!build;el("build-export").disabled=!build;el("edit-design").disabled=!snapshot.canWrite||!doc.design;
    el("build-note").textContent=build?`Build disponível: revisão ${build.revision}${build.sourceHash!==project.contentHash?" · há alterações posteriores no projeto":build.revision!==project.revision?" · mesma fonte, gerado em outra revisão":""}. ${adapter?.reason??""}`:(adapter?.reason??"Gere um build para jogar e exportar.");
    if(snapshot.workflow?.budget?.exhausted)el("build-note").textContent+=" Limite da etapa atingido; autorize a continuação em Builds e testes.";
    else if(snapshot.workflow?.workflow?.state==="completed")el("build-note").textContent+=" O ciclo está concluído; alterações posteriores exigem nova produção em Builds e testes.";
    el("premise").textContent=doc.design?.premise??doc.brief.request;
    el("brief").replaceChildren();for(const [key,value] of [["Público",doc.brief.audience],["Jogadores",`${doc.brief.players.min}–${doc.brief.players.max}`],["Dispositivos",doc.brief.devices.map((x)=>words[x]??x).join(", ")],["Controles",doc.brief.inputs.map((x)=>words[x]??x).join(", ")]])el("brief").append(node("dt",key),node("dd",value));
    const current=snapshot.quality?.sourceHash===project.contentHash;
    el("quality-state").textContent=current&&snapshot.quality.ready?"Critérios registrados atendidos.":"Aceite integral pendente.";
    renderBlockers(current?snapshot.quality.blockers:["stale-source-revision"]);
    renderDeliveryState();renderDesign(doc.design);renderAssets();renderCandidates();renderJobs();renderWorkflow();renderHistory();renderReports();renderCapture(build);renderLibraryState();
    if(!libraryRestored&&libraryDraft){libraryRestored=true;showLibraryDraft(false);tab="assets";}
    if(restoredMedia){restoredMedia=false;try{showImageEditor();tab="assets";}catch{draftReady=false;notice("Os ajustes preservados não puderam ser exibidos. O original foi conservado; não envie outro pedido.",true);}}
    if(restoredDelivery){restoredDelivery=false;tab='overview';showDelivery();void loadDeliveryCatalog(deliveryDraft);}
    if(restoredAudioEncode){restoredAudioEncode=false;try{showAudioEncode();tab='assets';}catch{draftReady=false;notice('As variantes preservadas precisam de recuperação; o pedido original não foi descartado.',true);}}
    if(restoredDesign){const values=restoredDesign;restoredDesign=false;try{showDesignEditor(values);tab="design";}catch{draftReady=false;notice("O design preservado não pôde ser exibido. O original foi conservado; não envie outro pedido.",true);}}
    if(restoredPlaytest){restoredPlaytest=false;try{showPlaytestEditor();tab="playtests";}catch{draftReady=false;notice("O playtest preservado precisa de recuperação. O original não será sobrescrito.",true);}}
    renderDesignEditState();renderPlaytests();
    if(restoredRestore){restoredRestore=false;tab="history";}
    renderRestoreState();switchTab(tab);
  }
  function renderWorkflow(){
    const area=el("workflow"),state=snapshot.workflow,workflow=state?.workflow;area.hidden=!workflow;if(!workflow)return;
    const labels={design:"Design",core:"Experiência central",systems:"Sistemas",content:"Conteúdo",polish:"Acabamento",testing:"Testes",corrections:"Correções",candidate:"Candidato de entrega"};
    const current=state.sourceHash===snapshot.project.contentHash&&state.revision===snapshot.project.revision;
    const request={expectedVersion:workflow.version,expectedRevision:state.revision,requestId:crypto.randomUUID()},controls=[];
    if(workflow.state==="active"){
      controls.push(button("Avançar etapa",()=>act({action:"advance-stage",...request}),!snapshot.canWrite||!current||!state.canAdvance));
      if(state.budget?.exhausted)controls.push(button("Autorizar continuação",()=>act({action:"continue-production",...request}),!snapshot.canWrite||!current||!state.budget.canContinue));
    }else if(!state.qualityReady||workflow.lastAccepted?.sourceHash!==snapshot.project.contentHash)controls.push(button("Nova produção",()=>act({action:"reopen-production",...request}),!snapshot.canWrite||!current));
    const detail=!current?"O projeto mudou; atualize as etapas.":workflow.state==="completed"?"Ciclo concluído com as evidências da revisão aceita.":
      `Builds, testes e mídia: ${state.budget.usedRequests} de ${state.budget.authorizedRequests} pedidos. ${state.budget.exhausted?"A continuação precisa ser autorizada.":state.gates.some((gate)=>gate.blockers.includes("production-work-pending"))?"Aguarde os trabalhos pendentes ou reconcilie seus resultados.":state.canAdvance?"Verificações desta etapa atendidas.":"Há verificações pendentes na Visão geral."}`;
    area.replaceChildren(row(`Produção · ${labels[workflow.stage]}`,detail,controls));
    for(const budget of snapshot.inference?.budgets??[]){
      const name=budget.scope.kind==="namespace"?"IA · Ambiente compartilhado":`IA · ${labels[budget.scope.stage]}`;
      const waiting=budget.exhausted?" Limite atingido; a conversa solicitará autorização para continuar.":"";
      area.append(row(name,`${budget.calls} de ${budget.authorizedCalls} chamadas aos modelos. ${budget.chargedTokens.toLocaleString("pt-BR")} tokens contabilizados, incluindo reservas sem medição.${waiting}`,[]));
    }
  }
  function renderBlockers(blockers){
    const checks={boots:"Início do jogo",controls:"Controles",pause:"Pausa",restart:"Reinício",resize:"Redimensionamento",save:"Save e recuperação",focus:"Perda de foco",console:"Erros de execução",scope:"Escopo aprovado",progression:"Progressão",completion:"Conclusão",coherence:"Consistência visual",animation:"Animação",readability:"Legibilidade",composition:"Composição",music:"Música",effects:"Efeitos",mute:"Silenciar",mix:"Mixagem","frame-rate":"Fluidez","loading":"Carregamento",provenance:"Origem dos assets",licenses:"Condições de licença",onboarding:"Primeiro contato",enjoyment:"Avaliação da experiência",assessment:"Revisão independente",checks:"Verificações com falha ou pendentes"};
    const groups=new Map();const add=(name,text)=>{if(!groups.has(name))groups.set(name,new Set());groups.get(name).add(text);};
    for(const value of blockers){
      const match=/^(?:missing|unresolved)-(runtime|content|visual|audio|performance|license|human)-(.+)$/.exec(value);
      if(match){add(words[match[1]],checks[match[2]]??"Verificação adicional");continue;}
      if(value.startsWith("unverified-content:")){add(words.content,"Percursos do conteúdo ainda não observados");continue;}
      if(value.startsWith("unverified-scenario:")){add("Cenários de teste","Há cenários previstos sem evidência independente");continue;}
      if(/^unverified-(desktop|mobile)-performance$/.test(value)){add(words.performance,value.includes("desktop")?"Teste físico no computador":"Teste físico em dispositivo móvel");continue;}
      if(value==="human-playtest-targets-unverified"){add(words.human,"Metas com jogadores e consentimento ainda não comprovadas");continue;}
      const labels={"stale-source-revision":["Revisão","Atualize para conferir as evidências da fonte atual"],"build-not-produced":["Build","Gerar um build desta revisão"],"design-missing":["Design","Consolidar o design do jogo"],"legacy-design-review-required":["Design","Revisar o design importado"],"placeholder-assets":["Assets temporários","Substituir e revisar os recursos temporários"],"local-multiplayer-unverified":["Multiplayer local","Testar os controles e a partida entre jogadores"]};
      const [name,text]=labels[value]??["Verificações adicionais","Há requisitos ainda não comprovados"];add(name,text);
    }
    el("blockers").replaceChildren(...[...groups].map(([name,texts])=>{const item=node("li"),details=node("details"),list=node("ul");details.append(node("summary",name));for(const text of texts)list.append(node("li",text));details.append(list);item.append(details);return item;}));
  }
  function renderDesign(design){
    if(editing)return;
    const labels={structure:"Estrutura",premise:"Premissa",coreLoop:"Experiência central",mechanics:"Mecânicas",rules:"Regras",controls:"Controles",camera:"Câmera",progression:"Progressão",narrative:"Narrativa",art:"Direção de arte",audio:"Direção de áudio",content:"Conteúdo",save:"Save e recuperação",playtests:"Cenários de teste"};
    el("design-content").replaceChildren(...Object.entries(labels).filter(([key])=>design?.[key]!==undefined).map(([key,label])=>{const section=node("details",undefined,"design-section");section.append(node("summary",label));let loaded=false;section.addEventListener("toggle",()=>{if(section.open&&!loaded){loaded=true;section.append(describe(design[key]));}});return section;}));
  }
  function describe(value){
    const labels={name:"Nome",description:"Descrição",actions:"Ações",feedback:"Resposta ao jogador",mastery:"Domínio",input:"Entrada",action:"Ação",expected:"Resultado esperado",objective:"Objetivo",challenge:"Desafio",completion:"Conclusão",stages:"Etapas",type:"Tipo",direction:"Direção",palette:"Paleta",animation:"Animação",music:"Música",effects:"Efeitos",mix:"Mixagem",kind:"Categoria",mode:"Modo",strategy:"Estratégia",version:"Versão",steps:"Percurso",category:"Categoria"};
    if(value===null||value===undefined)return node("p","Ainda não definido.","muted");
    if(typeof value!=="object"){const names={campaign:"Campanha",levels:"Fases",endless:"Ciclo contínuo",sandbox:"Exploração livre",competitive:"Competitivo",ending:"Desfecho",score:"Pontuação","open-ended":"Aberto",persistent:"Persistente","session-only":"Durante a sessão"};return node("p",names[value]??String(value));}
    if(Array.isArray(value)){const wrapper=node("div"),list=node("ul");let cursor=0;const more=button("Mostrar mais",()=>append());function append(){const next=Math.min(value.length,cursor+20);for(;cursor<next;cursor++){const li=node("li");li.append(describe(value[cursor]));list.append(li);}more.hidden=cursor===value.length;more.textContent=`Mostrar mais · ${cursor} de ${value.length}`;}wrapper.append(list,more);append();return wrapper;}
    const list=node("dl");for(const [key,item] of Object.entries(value)){if(["id","mechanicIds","schemaVersion"].includes(key))continue;const dd=node("dd");dd.append(describe(item));list.append(node("dt",labels[key]??key),dd);}return list;
  }
  function renderAssets(){
    const assets=snapshot.revision.document.assets;el("asset-list").replaceChildren(...assets.slice(0,assetLimit).map((asset)=>{
      const file=asset.files.map((name)=>snapshot.revision.document.files.find((file)=>file.path===name)).find((file)=>file&&["image/png","image/jpeg","image/webp","audio/wav","audio/mp4","image/svg+xml"].includes(file.mime));
      const controls=[button("Inspecionar",async()=>{
        mediaProjectId=snapshot.project.id;
        el("asset-preview").hidden=false;el("asset-title").textContent=asset.role;el("asset-provenance").replaceChildren();for(const [label,value] of [["Origem",asset.origin.source],["Autor",asset.origin.author],["Licença declarada",asset.origin.license],["Arquivos",asset.files.join("\n")]])el("asset-provenance").append(node("dt",label),node("dd",value));
        el("asset-image").hidden=true;el("asset-audio").pause();el("asset-audio").hidden=true;el("asset-audio").removeAttribute("src");
        if(!file)return;const result=await act({action:"media",path:file.path});if(!result?.data||result.projectId!==snapshot.project.id||result.revision!==snapshot.project.revision)return;
        const element=el(result.mime.startsWith("audio/")?"asset-audio":"asset-image");element.src=`data:${result.mime};base64,${result.data}`;element.hidden=false;
      })];
      const hasWav=asset.kind==='audio'&&asset.files.some(name=>snapshot.revision.document.files.some(file=>file.path===name&&file.mime==='audio/wav'&&name.endsWith('.wav')));
      if(hasWav){const displayed={projectId:snapshot.project.id,revision:snapshot.project.revision},open=button('Criar variantes de áudio',()=>openAudioEncode(asset.id,displayed));open.dataset.audioEncodeOpen='true';controls.push(open);}
      const unavailable=hasWav?(!snapshot.canEncodeAudio?' · Atualize o motor para criar variantes.':!audioEncoderAvailable()?' · Codificador indisponível neste computador.':''):'';
      return row(asset.role,`${asset.kind} · ${asset.placeholder?"Temporário":"Final declarado"} · ${asset.id}${unavailable}`,controls);
    }));el("more-assets").hidden=assets.length<=assetLimit;
    if(!assets.length)el("asset-list").append(node("p","Os assets registrados aparecerão aqui.","muted"));
    renderAudioEncodeState();
  }
  const audioQualitySlots=[['compact','Compacta',64],['standard','Padrão',128],['high','Alta',192]];
  function audioEncoderAvailable(){return Boolean(snapshot?.capabilities.assetProcessors?.some(p=>p.id==='audio-codec-isolated-v1'&&p.available&&p.operations.includes('audio.encode')));}
  function readAudioEncodeDraft(raw){
    if(!raw||raw.schemaVersion!==1||JSON.stringify(raw).length>512*1024)throw Error('Rascunho de áudio inválido');const d=structuredClone(raw),op=d.spec?.operation,source=d.source;
    if(![d.projectId,d.projectTitle,d.requestId,d.sourceRole,d.spec?.target?.id,d.spec?.target?.role,op?.outputBase,source?.assetId,source?.path].every(v=>typeof v==='string'&&v.length<=512)||!Number.isInteger(d.expectedRevision)||d.expectedRevision<1||!source||!Number.isSafeInteger(source.size)||source.size<1||!/^[a-f0-9]{64}$/.test(source.sha256)||op?.type!=='audio.encode'||op.codec!=='aac-lc'||d.spec.processorId!=='audio-codec-isolated-v1'||op.source?.assetId!==source.assetId||op.source?.path!==source.path||!Array.isArray(op.variants)||op.variants.length>3||new Set(op.variants.map(v=>v.id)).size!==op.variants.length||op.variants.some(v=>!audioQualitySlots.some(([id])=>id===v.id)||![64,96,128,192].includes(v.bitrateKbps)))throw Error('As variantes preservadas precisam de recuperação.');
    d.bitrates??=Object.fromEntries(audioQualitySlots.map(([id,,rate])=>[id,op.variants.find(v=>v.id===id)?.bitrateKbps??rate]));if(audioQualitySlots.some(([id])=>![64,96,128,192].includes(d.bitrates[id])))throw Error('As qualidades preservadas precisam de recuperação.');
    if(d.command&&(d.command.action!=='encode-audio'||d.command.projectId!==d.projectId||d.command.expectedRevision!==d.expectedRevision||d.command.requestId!==d.requestId||d.command.sourceSha256!==source.sha256||JSON.stringify(d.command.spec)!==JSON.stringify(d.spec)))throw Error('O vínculo do pedido de áudio preservado é inválido.');return d;
  }
  function openAudioEncode(assetId,displayed){
    if(busy||imageEdit||audioEncodeDraft||!draftReady||!snapshot?.canWrite||!snapshot.canEncodeAudio||!audioEncoderAvailable())return;
    if(snapshot.project.id!==displayed.projectId||snapshot.project.revision!==displayed.revision){notice('A seleção mudou. Confira o WAV antes de criar variantes.',true);return;}
    const asset=snapshot.revision.document.assets.find(a=>a.id===assetId&&a.kind==='audio'),file=asset?.files.map(name=>snapshot.revision.document.files.find(f=>f.path===name&&f.mime==='audio/wav'&&name.endsWith('.wav'))).find(Boolean);if(!file)return;
    const targetId='audio-'+crypto.randomUUID();audioEncodeDraft={schemaVersion:1,projectId:snapshot.project.id,projectTitle:snapshot.project.title,expectedRevision:snapshot.project.revision,requestId:crypto.randomUUID(),sourceRole:asset.role,source:{assetId,path:file.path,sha256:file.sha256,size:file.size},spec:{processorId:'audio-codec-isolated-v1',target:{id:targetId,role:(asset.role+' · distribuição').slice(0,300),placeholder:asset.placeholder},operation:{type:'audio.encode',codec:'aac-lc',source:{assetId,path:file.path},outputBase:'assets/'+targetId,variants:[{id:'compact',bitrateKbps:64},{id:'standard',bitrateKbps:128}]}},command:null};
    audioEncodeDraft.bitrates={compact:64,standard:128,high:192};showAudioEncode();saveLocalDraft();el('audio-encode-title').focus();
  }
  function showAudioEncode(){
    const d=audioEncodeDraft;if(!d)return;el('audio-encode-editor').hidden=false;el('audio-encode-origin').textContent=`${d.sourceRole} · ${d.projectTitle} · revisão ${d.expectedRevision}`;
    const select=el('audio-encode-source');select.replaceChildren();const current=snapshot?.project?.id===d.projectId&&snapshot.project.revision===d.expectedRevision,asset=current?snapshot.revision.document.assets.find(a=>a.id===d.source.assetId):null;
    const sources=asset?asset.files.map(name=>snapshot.revision.document.files.find(f=>f.path===name&&f.mime==='audio/wav'&&name.endsWith('.wav'))).filter(Boolean):[d.source];
    for(const file of sources){const option=node('option',file.path);option.value=file.path;select.append(option);}select.value=d.source.path;
    el('audio-encode-role').value=d.spec.target.role;el('audio-encode-output').value=d.spec.operation.outputBase;
    const variants=el('audio-encode-variants');variants.replaceChildren();
    for(const [id,title,bitrate]of audioQualitySlots){const group=node('fieldset',undefined,'image-layer'),legend=node('legend',title),label=node('label','Gerar '+title.toLowerCase()),check=node('input'),qualityLabel=node('label','Taxa · '+title.toLowerCase()),quality=node('select');check.type='checkbox';check.id='audio-quality-'+id;label.htmlFor=check.id;check.checked=d.spec.operation.variants.some(v=>v.id===id);quality.id='audio-bitrate-'+id;qualityLabel.htmlFor=quality.id;
      for(const value of [64,96,128,192]){const option=node('option',value+' kb/s');option.value=String(value);quality.append(option);}quality.value=String(d.bitrates?.[id]??d.spec.operation.variants.find(v=>v.id===id)?.bitrateKbps??bitrate);group.append(legend,label,check,qualityLabel,quality);variants.append(group);}
    renderAudioEncodeState();renderCandidateState();
  }
  function captureAudioEncode(){
    const d=audioEncodeDraft;if(!d||d.command)return;const path=el('audio-encode-source').value,file=snapshot?.project?.id===d.projectId&&snapshot.project.revision===d.expectedRevision?snapshot.revision.document.files.find(f=>f.path===path&&f.mime==='audio/wav'):null;
    if(file){d.source={...d.source,path:file.path,sha256:file.sha256,size:file.size};d.spec.operation.source.path=file.path;}d.spec.target.role=el('audio-encode-role').value;d.spec.operation.outputBase=el('audio-encode-output').value;
    d.bitrates=Object.fromEntries(audioQualitySlots.map(([id])=>[id,Number(el('audio-bitrate-'+id).value)]));d.spec.operation.variants=audioQualitySlots.filter(([id])=>el('audio-quality-'+id).checked).map(([id])=>({id,bitrateKbps:d.bitrates[id]}));
  }
  function renderAudioEncodeState(){
    const d=audioEncodeDraft,same=d&&snapshot?.project?.id===d.projectId,current=same&&snapshot.project.revision===d.expectedRevision,canStart=Boolean(snapshot?.canWrite&&snapshot.canEncodeAudio&&audioEncoderAvailable()&&draftReady);
    document.querySelectorAll('[data-audio-encode-open]').forEach(button=>{button.disabled=busy||!canStart||Boolean(d)||Boolean(imageEdit);});
    el('audio-encode-editor').hidden=!d;if(!d)return;
    const disabled=busy||!draftReady||Boolean(d.command)||!current||!canStart;el('audio-encode-fields').disabled=disabled;
    for(const [id]of audioQualitySlots){const check=el('audio-quality-'+id),select=el('audio-bitrate-'+id);if(check&&select)select.disabled=disabled||!check.checked;}
    el('cancel-audio-encode').disabled=busy||Boolean(d.command);el('audio-encode-jobs').disabled=busy;
    el('submit-audio-encode').disabled=busy||!draftReady||!same||!snapshot.canEncodeAudio||!d.command&&(!current||!canStart);el('submit-audio-encode').textContent=d.command?'Conferir pedido':'Preparar variantes';
    el('audio-encode-state').textContent=!snapshot?.canEncodeAudio?'Atualize o motor para preparar ou conferir as variantes preservadas.':d.command?'Pedido preservado. Conferir consulta o trabalho original; uma resposta perdida não autoriza outra codificação.':!same?'Volte ao projeto original para continuar.':!current?'A revisão mudou. Cancele este rascunho para preparar variantes da versão atual.':!audioEncoderAvailable()?'O codificador está indisponível. Seus ajustes continuam preservados.':'Selecione as qualidades. O processamento criará um candidato sem aplicar mudanças.';
  }
  el('audio-encode-fields').addEventListener('input',()=>{captureAudioEncode();renderAudioEncodeState();saveLocalDraft();});
  el('audio-encode-jobs').addEventListener('click',()=>switchTab('builds'));
  el('cancel-audio-encode').addEventListener('click',async()=>{if(busy||!audioEncodeDraft||audioEncodeDraft.command)return;const original=audioEncodeDraft;audioEncodeDraft=null;try{await persistDrafts();}catch{audioEncodeDraft=original;}renderAudioEncodeState();renderCandidateState();});
  el('audio-encode-editor').addEventListener('submit',async event=>{
    event.preventDefault();if(busy||!audioEncodeDraft)return;const d=audioEncodeDraft,resuming=Boolean(d.command);
    if(!resuming){captureAudioEncode();if(!d.spec.operation.variants.length){notice('Selecione ao menos uma qualidade de áudio.',true);return;}d.command={action:'encode-audio',projectId:d.projectId,expectedRevision:d.expectedRevision,requestId:d.requestId,sourceSha256:d.source.sha256,spec:structuredClone(d.spec)};}
    renderAudioEncodeState();try{await persistDrafts();}catch{if(!resuming)d.command=null;renderAudioEncodeState();return;}
    const value=await act(resuming?{action:'resume-encode-audio',projectId:d.projectId,command:d.command}:d.command);if(audioEncodeDraft!==d)return;
    if(value?.assetRequestAcknowledged){audioEncodeDraft=null;try{await persistDrafts();}catch{audioEncodeDraft=d;}renderAudioEncodeState();renderCandidateState();if(!audioEncodeDraft)notice('Pedido localizado. Revise o candidato quando o processamento terminar; aplicar continua sendo uma ação separada.');}
    else if((value?.cancelled||value?.audioEncodeRejected)&&!resuming){d.command=null;saveLocalDraft();renderAudioEncodeState();}
  });
  function clearCandidate(){el("candidate-waveform").hidden=true;el("candidate-waveform").replaceChildren();candidate=null;candidateEpoch++;el("candidate-preview").hidden=true;el("candidate-audio").pause();el("candidate-audio").removeAttribute("src");el("candidate-image").removeAttribute("src");el("candidate-text").hidden=true;el("candidate-text").textContent="";}
  function renderCandidateState(){
    if(!candidate)return;
    const current=candidate.projectId===snapshot.project?.id&&candidate.expectedRevision===snapshot.project.revision;
    const applied=snapshot.revision.document.assets.some(asset=>asset.processing?.jobId===candidate.result.jobId);
    el("candidate-state").textContent=applied?"Aplicado nesta revisão do projeto.":current?"Candidato preservado; a aplicação criará uma nova revisão.":"O projeto mudou. Confira o candidato novamente antes de aplicar.";
    el("apply-candidate").disabled=busy||!snapshot.canWrite||!current||applied;
    el("export-candidate").disabled=busy||candidate.projectId!==snapshot.project?.id;
    el("preview-model").disabled=busy||candidate.projectId!==snapshot.project?.id||!snapshot.canPreviewModels||!el("candidate-model").options.length;el("candidate-model").disabled=busy;
    const operation=candidate.result.spec.operation,editable=candidate.result.processorId==="local-media-v1"&&["image.compose","image.vector","audio.render"].includes(operation.type)||candidate.result.processorId==="blender-model-isolated-v1"&&operation.type==="model.scene";
    el("adjust-image").textContent=operation.type==="model.scene"?"Ajustar modelo 3D":operation.type==="audio.render"?"Ajustar áudio":operation.type==="image.vector"?"Ajustar ilustração":"Ajustar imagem";
    el("adjust-image").hidden=!editable;el("adjust-image").disabled=busy||!snapshot.canWrite||!current||Boolean(imageEdit)||Boolean(audioEncodeDraft)||!snapshot.capabilities.assetProcessors?.some(processor=>processor.id===candidate.result.processorId&&processor.available&&processor.operations.includes(operation.type));
    el("candidate-revision").textContent=`Produzido a partir da revisão ${candidate.result.revision} · conferido na revisão ${candidate.expectedRevision}`;
  }
  function renderCandidates(){
    const jobs=snapshot.jobs.jobs.filter(job=>job.kind==="assets"&&job.state==="completed");
    el("candidate-list").replaceChildren(...jobs.map(job=>row(job.assetSpec?.target?.role??"Candidato",`Revisão ${job.revision} · ${time(job.updatedAt)} · ${snapshot.revision.document.assets.some(asset=>asset.processing?.jobId===job.id)?"Aplicado ao projeto":"Aguardando revisão"}`,[button("Revisar candidato",()=>openCandidate(job))])));
    if(!jobs.length)el("candidate-list").append(node("p","Os candidatos concluídos aparecerão aqui; processamento não aplica mudanças sozinho.","muted"));
    el("more-candidates").hidden=!snapshot.jobs.hasMore;renderCandidateState();
  }
  async function openCandidate(job){
    if(busy||job.projectId!==snapshot.project?.id)return;
    const projectId=snapshot.project.id;clearCandidate();const epoch=candidateEpoch;
    const value=await act({action:"asset-result",projectId,jobId:job.id});
    if(!value?.result||candidateEpoch!==epoch||value.projectId!==snapshot.project?.id)return;
    candidate={...value,requestId:crypto.randomUUID()};const result=value.result;
    el("candidate-preview").hidden=false;el("candidate-title").textContent=result.asset.role;
    el("candidate-provenance").replaceChildren();
    for(const [label,text] of [["Origem",result.asset.origin.source],["Autor",result.asset.origin.author],["Licença declarada",result.asset.origin.license],["Estado",result.asset.placeholder?"Temporário":"Final declarado"],["Arquivos preservados",result.files.map(file=>file.path).join("\n")]])el("candidate-provenance").append(node("dt",label),node("dd",text));
    const operation=result.spec.operation;
    const models=result.files.filter(file=>file.mime==="model/gltf-binary"&&file.path.endsWith(".glb")&&file.size<=64*1024*1024);
    el("candidate-model-review").hidden=!models.length;el("candidate-model").replaceChildren(...models.map(file=>{const option=node("option",file.path);option.value=file.path;return option;}));
    const files=result.files.filter(file=>["image/png","image/jpeg","image/webp","audio/wav","audio/mp4","image/svg+xml"].includes(file.mime)&&file.size<=4*1024*1024||operation.type==="library.copy"&&file.mime==="text/plain"&&file.size<=256*1024&&operation.selection.library.licenseFiles.some(name=>`${operation.outputBase}/${name}`===file.path));
    el("candidate-file").replaceChildren(...files.map(file=>{const option=node("option",file.path);option.value=file.path;return option;}));
    el("candidate-file").disabled=!files.length;renderCandidateState();el("candidate-title").focus();
    if(files.length)await showCandidateFile();
  }
  async function showCandidateFile(){
    if(busy||!candidate)return;
    const inspected=candidate,epoch=candidateEpoch,path=el("candidate-file").value;
    el("candidate-waveform").hidden=true;el("candidate-waveform").replaceChildren();
    el("candidate-text").hidden=true;el("candidate-text").textContent="";
    el("candidate-image").hidden=true;el("candidate-image").removeAttribute("src");el("candidate-audio").pause();el("candidate-audio").hidden=true;el("candidate-audio").removeAttribute("src");
    const value=await act({action:"asset-media",projectId:inspected.projectId,jobId:inspected.result.jobId,path});
    if(!value||candidate!==inspected||candidateEpoch!==epoch||value.projectId!==snapshot.project?.id||value.jobId!==inspected.result.jobId||value.path!==el("candidate-file").value)return;
    if(value.mime==="text/plain"&&typeof value.text==="string"){el("candidate-text").textContent=value.text;el("candidate-text").hidden=false;return;}
    if(!value.data)return;
    const media=el(value.mime.startsWith("audio/")?"candidate-audio":"candidate-image");media.src=`data:${value.mime};base64,${value.data}`;media.hidden=false;
    if(value.mime==="audio/wav"&&inspected.result.spec.operation.type==="audio.render"&&inspected.result.spec.operation.waveformBins!==undefined){
      const measured=await act({action:"asset-audio-analysis",projectId:inspected.projectId,jobId:inspected.result.jobId});
      if(measured&&candidate===inspected&&candidateEpoch===epoch&&measured.projectId===snapshot.project?.id&&measured.jobId===inspected.result.jobId&&value.path===el("candidate-file").value)renderCandidateWaveform(measured.analysis);
    }
  }
  function renderCandidateWaveform(analysis){
    const area=el("candidate-waveform");area.replaceChildren(node("h4","Forma de onda"));area.hidden=false;
    const ms=frames=>`${(frames*1000/analysis.sampleRate).toFixed(1)} ms`,db=value=>value===null?"silêncio digital":`${value.toFixed(1)} dBFS`;
    area.append(node("p",`Trechos abaixo de −60 dBFS: ${ms(analysis.quietFrames)} · início ${ms(analysis.leadingQuietFrames)} · fim ${ms(analysis.trailingQuietFrames)}`,"muted"));
    const svgNode=name=>document.createElementNS("http://www.w3.org/2000/svg",name);
    for(const channel of analysis.channels){
      const title=`Canal ${channel.index+1}`,figure=node("figure"),caption=node("figcaption",`${title} · pico ${db(channel.peakDbfs)} · RMS ${db(channel.rmsDbfs)}`),svg=svgNode("svg");
      svg.setAttribute("viewBox","0 0 1000 128");svg.setAttribute("role","img");svg.setAttribute("aria-label",`${title}: amplitude mínima e máxima por bloco de amostras`);
      const axis=svgNode("path");axis.setAttribute("d","M0 64H1000");axis.setAttribute("class","audio-waveform-axis");svg.append(axis);
      const shape=svgNode("path"),upper=channel.bins.map((bin,i)=>`${(i+.5)*1000/channel.bins.length},${64-bin.max*56}`),lower=[...channel.bins].reverse().map((bin,i)=>`${(channel.bins.length-i-.5)*1000/channel.bins.length},${64-bin.min*56}`);
      shape.setAttribute("d",`M${upper.join("L")}L${lower.join("L")}Z`);shape.setAttribute("class","audio-waveform-shape");svg.append(shape);const axisLabels=node("div",undefined,"audio-waveform-time");axisLabels.append(node("span","0 ms"),node("span",`${analysis.durationMs.toFixed(1)} ms`));figure.append(caption,svg,axisLabels,node("p",`DC ${channel.dc.toFixed(5)} · ${channel.fullScaleSamples.toLocaleString("pt-BR")} amostras no limite PCM`,"muted"));area.append(figure);
    }
    area.append(node("p","Medições digitais do WAV produzido. Amostras no limite podem indicar saturação; a revisão sonora exige ouvir o resultado.","muted"));
  }
  function renderImageEditState(){
    if(!imageEdit)return;
    const current=imageEdit.projectId===snapshot?.project?.id&&imageEdit.expectedRevision===snapshot.project.revision;
    el("image-editor-fields").disabled=busy||Boolean(imageEdit.command);
    for(const timeline of el("image-editor-fields").querySelectorAll('.model-timeline'))timeline.dispatchEvent(new Event('rangechange'));
    el("submit-image").disabled=!draftReady||busy||!current||!snapshot.canWrite||snapshot.workflow?.budget?.exhausted;
    el("submit-image").textContent=imageEdit.command?"Retomar pedido":"Gerar variante";
    el("cancel-image-editor").disabled=busy||Boolean(imageEdit.command);
    el("image-editor-state").textContent=imageEdit.command?"Pedido preservado. Se a resposta se perdeu, retome o mesmo pedido ou confira os trabalhos; não será criada outra identidade.":current?"Ajustes locais; nenhuma mudança foi enviada ao serviço.":"O projeto ou a revisão mudou. Seus ajustes permanecem no projeto original; cancele-os e confira o candidato antes de gerar uma variante.";
  }
  function closeImageEditor(){imageEdit=null;saveLocalDraft();el("image-editor").hidden=true;el("image-editor-fields").replaceChildren();renderCandidateState();}
  function renderLibraryState(){
    const processors=snapshot?.capabilities.assetProcessors?.filter(item=>item.operations.includes("library.copy"))??[],select=el("library-processor"),previous=select.value;
    if(JSON.stringify([...select.options].map(option=>[option.value,option.disabled]))!==JSON.stringify(processors.map(item=>[item.id,!item.available]))){
      select.replaceChildren(...processors.map(item=>{const option=node("option",item.id==="licensed-libraries-v1"?"Recursos licenciados":item.id);option.value=item.id;option.disabled=!item.available;return option;}));if(processors.some(item=>item.id===previous&&item.available))select.value=previous;
    }
    const available=processors.some(item=>item.available),frozen=Boolean(libraryDraft?.command);
    el("browse-libraries").disabled=busy||!snapshot?.project||!available;
    el("browse-libraries").title=available?"Explorar recursos locais e suas licenças":processors[0]?.reason??"Nenhuma biblioteca instalada neste ambiente.";
    el("library-search-fields").disabled=busy||frozen||!available;el("more-library").disabled=busy||frozen;
    for(const item of el("library-list").querySelectorAll("button"))item.disabled=busy||frozen;
    if(!libraryDraft)return;
    const current=libraryDraft.projectId===snapshot?.project?.id&&libraryDraft.expectedRevision===snapshot.project.revision;
    el("library-import-fields").disabled=busy||frozen;el("cancel-library-import").disabled=busy||frozen;
    el("submit-library").disabled=!draftReady||busy||!current||!snapshot.canWrite||snapshot.workflow?.budget?.exhausted||snapshot.workflow?.workflow?.state==="completed"||!available;
    el("submit-library").textContent=frozen?"Retomar pedido":"Preparar candidato";
    el("library-import-state").textContent=!current?`O projeto ou a revisão mudou. Esta importação pertence a “${libraryDraft.projectTitle}”, revisão ${libraryDraft.expectedRevision}. Preserve o pedido e confira seus trabalhos.`:frozen?"Pedido preservado. Retome a mesma solicitação ou confira os trabalhos; nenhuma outra cópia será solicitada automaticamente.":"A preparação cria um candidato. Revise os arquivos e a licença antes de aplicar ao projeto.";
  }
  async function loadLibraries(more=false){
    if(busy||libraryDraft?.command||!snapshot?.project)return;
    const projectId=snapshot.project.id,query=more?{...libraryPage.query,cursor:libraryPage.cursor}:{processorId:el("library-processor").value,query:el("library-query").value.trim(),cursor:0,limit:10};
    const value=await act({action:"libraries",projectId,query});
    if(!value?.entries||value.projectId!==snapshot.project?.id)return;
    libraryProjectId=projectId;libraryPage={...value,entries:more?[...libraryPage.entries,...value.entries]:value.entries};
    el("library-status").textContent=libraryPage.entries.length?`${libraryPage.entries.length} ${libraryPage.entries.length===1?"recurso exibido":"recursos exibidos"}${value.hasMore?" · há mais resultados":""}.` :"Nenhum recurso encontrado. Tente outro nome ou animação.";
    el("library-list").replaceChildren(...libraryPage.entries.map(selection=>row(selection.entry.title,`${selection.library.title} · ${selection.entry.kind==="model"?"Modelo 3D":selection.entry.kind} · ${selection.library.spdx}${selection.entry.animations.length?` · ${selection.entry.animations.length} animações`:""}`,[button("Detalhes",()=>{
      if(busy||libraryDraft?.command)return;
      const id=crypto.randomUUID();libraryDraft={schemaVersion:1,projectId:snapshot.project.id,projectTitle:snapshot.project.title,expectedRevision:snapshot.project.revision,requestId:crypto.randomUUID(),command:null,
        spec:{processorId:value.query.processorId,target:{id:`library-${id}`,role:selection.entry.title,placeholder:true},operation:{type:"library.copy",selection:structuredClone(selection),outputBase:`assets/library/${selection.entry.id}-${id.slice(0,8)}`}}};
      saveLocalDraft();showLibraryDraft(true);
    })])));
    el("more-library").hidden=!value.hasMore;renderLibraryState();
  }
  function showLibraryDraft(focus){
    if(!libraryDraft)return;const {selection}=libraryDraft.spec.operation;
    el("library-browser").hidden=false;el("library-import").hidden=false;el("library-entry-title").textContent=selection.entry.title;
    el("library-entry-origin").textContent=`${selection.library.title} · ${libraryDraft.projectTitle} · revisão ${libraryDraft.expectedRevision}`;
    el("library-entry-metadata").replaceChildren();
    for(const [title,value]of [["Autor",selection.library.author],["Licença declarada",selection.library.spdx],["Origem",selection.library.source],["Versão",selection.library.version],["Arquivos incluídos",selection.entry.files.map(file=>`${file.path} · ${file.size.toLocaleString("pt-BR")} bytes`).join("\n")]])el("library-entry-metadata").append(node("dt",title),node("dd",value));
    el("library-animations").hidden=!selection.entry.animations.length;el("library-animation-title").textContent=`${selection.entry.animations.length} animações incluídas`;
    el("library-animation-list").replaceChildren(...selection.entry.animations.map(name=>node("li",name)));
    el("library-role").value=libraryDraft.spec.target.role;el("library-folder").value=libraryDraft.spec.operation.outputBase;el("library-placeholder").checked=libraryDraft.spec.target.placeholder;
    renderLibraryState();if(focus)el("library-entry-title").focus();
  }
  el("browse-libraries").addEventListener("click",async()=>{el("library-browser").hidden=false;if(!libraryPage)await loadLibraries();if(libraryDraft)showLibraryDraft(false);});
  el("close-libraries").addEventListener("click",()=>{el("library-browser").hidden=true;});
  el("library-search").addEventListener("submit",event=>{event.preventDefault();void loadLibraries();});
  el("more-library").addEventListener("click",()=>loadLibraries(true));el("library-jobs").addEventListener("click",()=>switchTab("builds"));
  el("cancel-library-import").addEventListener("click",()=>{if(busy||libraryDraft?.command)return;libraryDraft=null;saveLocalDraft();el("library-import").hidden=true;renderLibraryState();});
  for(const id of ["library-role","library-folder","library-placeholder"])el(id).addEventListener("input",()=>{
    if(!libraryDraft||libraryDraft.command)return;
    libraryDraft.spec.target.role=el("library-role").value;libraryDraft.spec.operation.outputBase=el("library-folder").value;libraryDraft.spec.target.placeholder=el("library-placeholder").checked;
    saveLocalDraft();
  });
  el("library-import").addEventListener("submit",async event=>{
    event.preventDefault();if(busy||!libraryDraft)return;const draft=libraryDraft,resuming=Boolean(draft.command);
    if(!draft.command)draft.command={action:"import-library",projectId:draft.projectId,expectedRevision:draft.expectedRevision,requestId:draft.requestId,spec:structuredClone(draft.spec)};
    renderLibraryState();
    try{await persistLibraryDraft();}catch{if(!resuming)draft.command=null;notice("Não foi possível preservar o pedido neste Studio. Nenhuma nova solicitação foi enviada. Confira os trabalhos antes de continuar.",true);renderLibraryState();return;}
    const value=await act(draft.command);if(libraryDraft!==draft)return;
    if(value?.cancelled||value?.libraryImportRejected){if(!resuming){draft.command=null;saveLocalDraft();}renderLibraryState();return;}
    if(value?.requestedAssetJobId){libraryDraft=null;saveLocalDraft();el("library-import").hidden=true;notice("Recurso solicitado. Revise o candidato e seus documentos antes de aplicar ao projeto.");}
    renderLibraryState();
  });
  // Form state is typed geometry only. The service worker remains the sole SVG
  // serializer; this renderer neither assembles markup nor runs a second codec.
  function renderVectorEditor(operation,root){
    const grid=parent=>{const value=node("div",undefined,"image-fields-grid");parent.append(value);return value;};
    function field(parent,label,value,change,kind="number",min=-8192,max=8192,step="any"){
      const wrap=node("div",undefined,"image-field"),title=node("label",label),input=node("input");input.id=`vector-${crypto.randomUUID()}`;title.htmlFor=input.id;
      input.type=kind==="boolean"?"checkbox":kind==="color"?"text":"number";
      if(kind==="boolean")input.checked=value;else{input.value=value;input.required=true;if(kind==="color"){input.pattern="#[a-fA-F0-9]{8}";input.maxLength=9;input.title="Cor com transparência: #RRGGBBAA";}else{input.min=min;input.max=max;input.step=step;}}
      input.addEventListener("input",()=>change(kind==="boolean"?input.checked:kind==="color"?input.value:input.valueAsNumber));wrap.append(title,input);parent.append(wrap);return input;
    }
    function select(parent,label,options,value,change){
      const wrap=node("div",undefined,"image-field"),title=node("label",label),input=node("select");input.id=`vector-${crypto.randomUUID()}`;title.htmlFor=input.id;
      for(const [key,text] of options){const option=node("option",text);option.value=key;input.append(option);}input.value=value;input.addEventListener("change",()=>change(input.value));wrap.append(title,input);parent.append(wrap);return input;
    }
    function coordinates(parent,value,entries){const fields=grid(parent);for(const [key,label,min=-8192,max=8192] of entries)field(fields,label,value[key],next=>{value[key]=next;},"number",min,max);}
    function paint(parent,label,get,set,nullable){
      const section=node("fieldset",undefined,"vector-paint"),legend=node("legend",label),body=node("div");section.append(legend);parent.append(section);
      const options=[...(nullable?[["none","Sem preenchimento"]]:[]),["solid","Cor única"],["linear","Gradiente linear"],["radial","Gradiente radial"]];
      const current=get(),type=select(section,"Tipo de pintura",options,current===null?"none":typeof current==="string"?"solid":current.type,next=>{
        set(next==="none"?null:next==="solid"?"#91b9a4ff":next==="linear"?{type:"linear",x1:0,y1:0,x2:128,y2:128,stops:[{offset:0,color:"#b4dac8ff"},{offset:1,color:"#294f4bff"}]}:{type:"radial",cx:64,cy:64,r:64,stops:[{offset:0,color:"#b4dac8ff"},{offset:1,color:"#294f4b00"}]});render();
      });section.append(body);
      function render(){
        body.replaceChildren();const value=get();if(value===null)return;
        if(typeof value==="string"){field(body,"Cor · RGBA",value,set,"color");return;}
        coordinates(body,value,value.type==="linear"?[["x1","Início horizontal"],["y1","Início vertical"],["x2","Fim horizontal"],["y2","Fim vertical"]]:[["cx","Centro horizontal"],["cy","Centro vertical"],["r","Raio",.01,8192]]);
        body.append(node("p","Os pontos seguem do início ao fim, com posições entre 0 e 1.","muted"));
        value.stops.forEach((stop,index)=>{const item=node("fieldset",undefined,"vector-stop");item.append(node("legend",`Ponto de cor ${index+1}`));const fields=grid(item);
          field(fields,"Posição · 0 a 1",stop.offset,next=>{stop.offset=next;},"number",0,1);field(fields,"Cor · RGBA",stop.color,next=>{stop.color=next;},"color");
          item.append(button("Remover ponto de cor",()=>{value.stops.splice(index,1);render();},value.stops.length<=2));body.append(item);
        });
        body.append(button("Adicionar ponto de cor",()=>{const before=value.stops.at(-2),after=value.stops.at(-1);value.stops.splice(value.stops.length-1,0,{offset:(before.offset+after.offset)/2,color:before.color});render();},value.stops.length>=16));
      }
      render();return type;
    }
    const canvas=grid(root);field(canvas,"Largura da ilustração",operation.width,value=>{operation.width=value;},"number",1,4096,"1");field(canvas,"Altura da ilustração",operation.height,value=>{operation.height=value;},"number",1,4096,"1");field(canvas,"Cor do fundo · RGBA",operation.background,value=>{operation.background=value;},"color");
    select(canvas,"Formato da variante",[["svg","SVG · vetorial"],["png","PNG · sprites e atlas"]],operation.output.endsWith(".png")?"png":"svg",value=>{operation.output=operation.output.slice(0,-4)+`.${value}`;});
    const count=node("p",undefined,"muted"),list=node("div"),actions=node("div",undefined,"actions"),more=button("Mostrar mais formas",()=>{limit+=20;renderShapes();});list.id="vector-shapes";root.append(count,actions,list,more);let limit=20;const open=new Set();
    const commandCount=()=>operation.shapes.reduce((total,shape)=>total+(shape.kind==="path"?shape.commands.length:0),0);
    const pathValid=commands=>{if(commands.length<2)return false;let started=false;for(const command of commands){if(command.op==="M")started=true;else if(!started)return false;if(command.op==="Z")started=false;}return true;};
    const freshId=()=>`shape-${crypto.randomUUID()}`;
    function renderShape(section,shape){
      const fields=grid(section);field(fields,"Opacidade · 0 a 1",shape.opacity,value=>{shape.opacity=value;},"number",0,1);
      if(shape.kind==="rect")coordinates(section,shape,[["x","Posição horizontal"],["y","Posição vertical"],["width","Largura",.01,8192],["height","Altura",.01,8192],["radius","Arredondamento",0,4096]]);
      else if(shape.kind==="ellipse")coordinates(section,shape,[["cx","Centro horizontal"],["cy","Centro vertical"],["rx","Raio horizontal",.01,8192],["ry","Raio vertical",.01,8192]]);
      else{
        select(section,"Preenchimento das curvas",[["nonzero","Contínuo"],["evenodd","Alternar áreas internas"]],shape.fillRule,value=>{shape.fillRule=value;});
        const points=node("div"),tools=node("div",undefined,"actions");let shown=16,next=shape.commands.at(-1).op==="Z"?"M":"L";
        const kinds=[["M","Começar traço"],["L","Linha"],["Q","Curva com um controle"],["C","Curva com dois controles"],["Z","Fechar traço"]];
        const chooser=select(section,"Adicionar à curva",kinds,next,value=>{next=value;});
        const add=button("Adicionar à curva",()=>{if(shape.commands.length>=256||commandCount()>=4096){notice("O limite de pontos desta ilustração foi atingido. Preserve a forma ou divida a arte em outro recurso.",true);return;}const last=shape.commands.at(-1);if(last.op==="Z"&&next!=="M"){notice("Comece um novo traço antes de acrescentar outra curva.",true);return;}
          const command=next==="Z"?{op:"Z"}:next==="Q"?{op:"Q",cx:40,cy:20,x:80,y:60}:next==="C"?{op:"C",x1:20,y1:20,x2:60,y2:60,x:80,y:80}:{op:next,x:40,y:40};
          shape.commands.push(command);if(next==="Z"){next="M";chooser.value=next;}shown=shape.commands.length;renderPoints();count.textContent=`${operation.shapes.length} formas · ${commandCount()} pontos de curva`;
        });tools.append(add);section.append(points,tools);
        function renderPoints(){
          points.replaceChildren();shape.commands.slice(0,shown).forEach((command,index)=>{const item=node("fieldset",undefined,"vector-command");item.dataset.commandIndex=index;item.append(node("legend",`${index+1} · ${kinds.find(kind=>kind[0]===command.op)[1]}`));
            const entries=Object.keys(command).filter(key=>key!=="op").map(key=>[key,({x:"Destino horizontal",y:"Destino vertical",cx:"Controle horizontal",cy:"Controle vertical",x1:"Controle 1 horizontal",y1:"Controle 1 vertical",x2:"Controle 2 horizontal",y2:"Controle 2 vertical"})[key]]);if(entries.length)coordinates(item,command,entries);
            const without=shape.commands.filter((_value,at)=>at!==index);item.append(button("Remover ponto",()=>{shape.commands.splice(index,1);renderPoints();count.textContent=`${operation.shapes.length} formas · ${commandCount()} pontos de curva`;},!pathValid(without)));points.append(item);
          });
          if(shown<shape.commands.length)points.append(button("Mostrar mais pontos",()=>{shown+=16;renderPoints();}));add.disabled=shape.commands.length>=256||commandCount()>=4096;
        }
        renderPoints();
      }
      paint(section,"Preenchimento",()=>shape.fill,value=>{shape.fill=value;},true);
      const strokeFields=node("fieldset",undefined,"vector-option"),stroke=field(section,"Usar contorno",Boolean(shape.stroke),enabled=>{
        if(enabled){shape.stroke={paint:"#294f4bff",width:2,cap:"round",join:"round"};renderStroke();}else{delete shape.stroke;strokeFields.replaceChildren();}strokeFields.hidden=!enabled;
      },"boolean");section.append(strokeFields);strokeFields.hidden=!stroke.checked;
      function renderStroke(){const value=shape.stroke;strokeFields.replaceChildren();if(!value)return;const fields=grid(strokeFields);field(fields,"Espessura do contorno",value.width,next=>{value.width=next;},"number",.01,256);
        select(fields,"Pontas do contorno",[["butt","Reta"],["round","Arredondada"],["square","Quadrada"]],value.cap,next=>{value.cap=next;});select(fields,"Encontros do contorno",[["round","Arredondados"],["bevel","Chanfrados"],["miter","Pontiagudos"]],value.join,next=>{value.join=next;});paint(strokeFields,"Cor do contorno",()=>value.paint,next=>{value.paint=next;},false);
      }renderStroke();
      const transformFields=node("fieldset",undefined,"vector-option"),transform=field(section,"Mover, girar ou escalar",Boolean(shape.transform),enabled=>{
        if(enabled){shape.transform={x:0,y:0,rotation:0,scaleX:1,scaleY:1,pivotX:0,pivotY:0};renderTransform();}else{delete shape.transform;transformFields.replaceChildren();}transformFields.hidden=!enabled;
      },"boolean");section.append(transformFields);transformFields.hidden=!transform.checked;
      function renderTransform(){transformFields.replaceChildren();if(shape.transform)coordinates(transformFields,shape.transform,[["x","Deslocamento horizontal"],["y","Deslocamento vertical"],["rotation","Rotação · graus",-360,360],["scaleX","Escala horizontal",.01,16],["scaleY","Escala vertical",.01,16],["pivotX","Eixo horizontal de rotação"],["pivotY","Eixo vertical de rotação"]]);}renderTransform();
    }
    function renderShapes(){
      count.textContent=`${operation.shapes.length} formas · ${commandCount()} pontos de curva`;actions.replaceChildren();
      for(const [kind,label] of [["rect","Adicionar retângulo"],["ellipse","Adicionar elipse"],["path","Adicionar curva"]])actions.append(button(label,()=>{
        const shape={kind,id:freshId(),fill:"#91b9a4ff",opacity:1,...(kind==="rect"?{x:20,y:20,width:80,height:60,radius:8}:kind==="ellipse"?{cx:64,cy:64,rx:40,ry:30}:{fillRule:"nonzero",commands:[{op:"M",x:20,y:20},{op:"L",x:80,y:80}]})};operation.shapes.push(shape);open.add(shape.id);limit=operation.shapes.length;renderShapes();
      },operation.shapes.length>=512||(kind==="path"&&commandCount()>4094)));
      list.replaceChildren();operation.shapes.slice(0,limit).forEach((shape,index)=>{
        const section=node("details",undefined,"image-layer vector-shape"),summary=node("summary",`${index+1} · ${{rect:"Retângulo",ellipse:"Elipse",path:"Curva"}[shape.kind]} · ${shape.id}`),controls=node("div",undefined,"actions");section.dataset.shapeId=shape.id;section.append(summary,controls);section.open=open.has(shape.id);let loaded=false;
        const show=()=>{if(section.open&&!loaded){loaded=true;renderShape(section,shape);}section.open?open.add(shape.id):open.delete(shape.id);};section.addEventListener("toggle",show);
        controls.append(button("Recuar forma",()=>{[operation.shapes[index-1],operation.shapes[index]]=[operation.shapes[index],operation.shapes[index-1]];renderShapes();},index===0),button("Avançar forma",()=>{[operation.shapes[index],operation.shapes[index+1]]=[operation.shapes[index+1],operation.shapes[index]];renderShapes();},index===operation.shapes.length-1),
          button("Duplicar forma",()=>{if(operation.shapes.length>=512||commandCount()+(shape.kind==="path"?shape.commands.length:0)>4096){notice("O limite de formas ou pontos desta ilustração foi atingido.",true);return;}const copy={...structuredClone(shape),id:freshId()};operation.shapes.splice(index+1,0,copy);open.add(copy.id);limit=Math.max(limit,index+2);renderShapes();},operation.shapes.length>=512||commandCount()+(shape.kind==="path"?shape.commands.length:0)>4096),button("Remover forma",()=>{operation.shapes.splice(index,1);open.delete(shape.id);renderShapes();},operation.shapes.length<=1));
        list.append(section);show();
      });more.hidden=limit>=operation.shapes.length;
    }
    renderShapes();
  }
  function renderAudioEditor(operation,root){
    const grid=parent=>{const item=node("div",undefined,"image-fields-grid");parent.append(item);return item;};
    const editable=()=>!busy&&!imageEdit?.command;
    function numeric(parent,label,value,change,min,max,step="1"){
      const wrap=node("div",undefined,"image-field"),title=node("label",label),input=node("input");input.id=`audio-${crypto.randomUUID()}`;title.htmlFor=input.id;input.type="number";input.required=true;input.min=min;input.max=max;input.step=step;input.value=value;
      input.addEventListener("input",()=>{if(editable())change(input.valueAsNumber);});wrap.append(title,input);parent.append(wrap);return input;
    }
    function select(parent,label,value,options,change){
      const wrap=node("div",undefined,"image-field"),title=node("label",label),input=node("select");input.id=`audio-${crypto.randomUUID()}`;title.htmlFor=input.id;
      for(const [key,text]of options){const item=node("option",text);item.value=key;input.append(item);}input.value=value;input.addEventListener("change",()=>{if(editable())change(input.value);});wrap.append(title,input);parent.append(wrap);return input;
    }
    function toggle(parent,label,checked,change){
      const wrap=node("div",undefined,"image-field"),title=node("label",label),input=node("input");input.id=`audio-${crypto.randomUUID()}`;title.htmlFor=input.id;input.type="checkbox";input.checked=checked;input.addEventListener("change",()=>{if(editable())change(input.checked);});wrap.append(title,input);parent.append(wrap);return input;
    }
    const global=grid(root);numeric(global,"Duração total · ms",operation.durationMs,value=>{operation.durationMs=value;},10,180000);
    select(global,"Qualidade do áudio",String(operation.sampleRate),[["22050","22.050 Hz"],["44100","44.100 Hz"],["48000","48.000 Hz"]],value=>{operation.sampleRate=Number(value);});
    select(global,"Canais",String(operation.channels),[["1","Mono"],["2","Estéreo"]],value=>{operation.channels=Number(value);});
    let peak;const normalize=toggle(global,"Normalizar volume",operation.normalizePeak!==undefined,value=>{peak.disabled=!value;if(value)operation.normalizePeak=peak.valueAsNumber;else delete operation.normalizePeak;});
    peak=numeric(global,"Pico normalizado · 0,05 a 0,99",operation.normalizePeak??.9,value=>{if(normalize.checked)operation.normalizePeak=value;},.05,.99,".01");peak.disabled=!normalize.checked;
    if(snapshot?.canAnalyzeAudio||operation.waveformBins!==undefined){
      const bins=select(global,"Forma de onda e medições",String(operation.waveformBins??""),[["","Não gerar"],["128","128 blocos"],["256","256 blocos"],["512","512 blocos"],["1024","1.024 blocos"]],value=>{if(value)operation.waveformBins=Number(value);else delete operation.waveformBins;});bins.disabled=!snapshot?.canAnalyzeAudio;
      if(!snapshot?.canAnalyzeAudio)root.append(node("p","Atualize o motor para gerar a forma de onda. A escolha anterior foi preservada.","muted"));
    }
    root.append(node("p","Os tempos usam milissegundos. O panorama vai de −1 (esquerda) a 1 (direita). A variante só poderá ser ouvida depois do processamento; nada toca automaticamente.","muted"));
    const clips=node("div"),notes=node("div"),count=node("p",undefined,"muted"),actions=node("div",undefined,"actions");let limit=20;root.append(count,clips,actions,notes);
    const more=button("Mostrar mais notas",()=>{limit+=20;renderNotes();});root.append(more);
    const counts=()=>{count.textContent=`${operation.clips.length} faixas de origem · ${operation.notes.length} notas`;};
    function segmentFields(parent,value,kind){
      const fields=grid(parent);numeric(fields,"Início na mistura · ms",value.startMs,next=>{value.startMs=next;},0,180000);numeric(fields,"Duração · ms",value.durationMs,next=>{value.durationMs=next;},1,180000);
      numeric(fields,"Ganho",value.gain,next=>{value.gain=next;},0,kind==="clip"?4:1,".01");numeric(fields,"Panorama",value.pan,next=>{value.pan=next;},-1,1,".01");return fields;
    }
    function renderClips(){
      counts();clips.replaceChildren();
      operation.clips.forEach((clip,index)=>{
        const section=node("details",undefined,"image-layer"),summary=node("summary",`Faixa ${index+1} · ${clip.source.path}`);section.dataset.clipIndex=index;section.append(summary);let loaded=false;
        section.addEventListener("toggle",()=>{if(!section.open||loaded)return;loaded=true;section.append(node("p",`Fonte preservada: ${clip.source.assetId} · ${clip.source.path}`,"muted"));
          const controls=node("div",undefined,"actions");controls.append(button("Duplicar faixa",()=>{if(!editable()||operation.clips.length>=32)return;operation.clips.splice(index+1,0,structuredClone(clip));renderClips();}),button("Remover faixa",()=>{if(!editable())return;operation.clips.splice(index,1);renderClips();}));section.append(controls);
          const fields=segmentFields(section,clip,"clip");numeric(fields,"Corte inicial na fonte · ms",clip.offsetMs,value=>{clip.offsetMs=value;},0,180000);numeric(fields,"Entrada gradual · ms",clip.fadeInMs,value=>{clip.fadeInMs=value;},0,10000);numeric(fields,"Saída gradual · ms",clip.fadeOutMs,value=>{clip.fadeOutMs=value;},0,10000);
        });clips.append(section);
      });
    }
    function renderNotes(){
      counts();notes.replaceChildren();more.hidden=limit>=operation.notes.length;add.disabled=operation.notes.length>=256;
      operation.notes.slice(0,limit).forEach((note,index)=>{
        const section=node("details",undefined,"image-layer"),summary=node("summary",`Nota ${index+1} · ${note.frequency} Hz`);section.dataset.noteIndex=index;section.append(summary);let loaded=false;
        section.addEventListener("toggle",()=>{if(!section.open||loaded)return;loaded=true;
          const controls=node("div",undefined,"actions");controls.append(button("Duplicar nota",()=>{if(!editable()||operation.notes.length>=256)return;operation.notes.splice(index+1,0,structuredClone(note));renderNotes();}),button("Remover nota",()=>{if(!editable())return;operation.notes.splice(index,1);renderNotes();}));section.append(controls);
          const fields=segmentFields(section,note,"note");select(fields,"Forma do som",note.waveform,[["sine","Senoidal"],["triangle","Triangular"],["square","Quadrada"],["saw","Dente de serra"],["noise","Ruído"]],value=>{note.waveform=value;});
          numeric(fields,"Frequência inicial · Hz",note.frequency,value=>{note.frequency=value;},20,20000,"any");
          let end;const glide=toggle(fields,"Deslizar frequência",note.endFrequency!==undefined,value=>{end.disabled=!value;if(value)note.endFrequency=end.valueAsNumber;else delete note.endFrequency;});
          end=numeric(fields,"Frequência final · Hz",note.endFrequency??note.frequency,value=>{if(glide.checked)note.endFrequency=value;},20,20000,"any");end.disabled=!glide.checked;
          numeric(fields,"Ataque · ms",note.attackMs,value=>{note.attackMs=value;},0,10000);numeric(fields,"Liberação · ms",note.releaseMs,value=>{note.releaseMs=value;},0,10000);numeric(fields,"Variação do ruído",note.seed,value=>{note.seed=value;},0,4294967295);
        });notes.append(section);
      });
    }
    const add=button("Adicionar nota",()=>{if(!editable()||operation.notes.length>=256)return;const duration=Math.min(200,operation.durationMs),attack=Math.min(5,duration);operation.notes.push({waveform:"sine",frequency:440,startMs:0,durationMs:duration,gain:.2,pan:0,attackMs:attack,releaseMs:Math.min(30,duration-attack),seed:1});limit=Math.max(limit,operation.notes.length);renderNotes();});actions.append(add);
    renderClips();renderNotes();
  }
  // Frame positions are draft presentation only: no interpolation, deformation,
  // codec, graph or host operation is evaluated by this timeline.
  function renderKeyTimeline(parent,clip,track,editable,totalKeys,onSelect,onChange){
    const root=node("section",undefined,"model-timeline"),heading=node("p","Linha do tempo","model-timeline-title"),status=node("p",undefined,"muted"),actions=node("div",undefined,"actions");
    const ns="http://www.w3.org/2000/svg",svg=document.createElementNS(ns,"svg"),ruler=node("input"),label=node("label","Quadro para nova chave");
    const id=`timeline-${crypto.randomUUID()}`;label.htmlFor=id;ruler.id=id;ruler.type="range";ruler.min="0";ruler.step="1";
    svg.setAttribute("viewBox","0 0 640 104");svg.setAttribute("tabindex","-1");svg.setAttribute("aria-label",`Chaves de ${track.target.id} · ${track.channel}`);svg.classList.add("model-key-ruler");
    status.setAttribute("role","status");root.append(heading,node("p","Selecione uma chave. Arraste ou use ←/→ para mudar o quadro; Shift move dez. Os valores são editados abaixo.","muted"),svg,label,ruler,status,actions);parent.append(root);
    let selected=track.keys[0],cursor=Number.isInteger(selected?.frame)?selected.frame:0,drag=null,message="";
    const validRange=()=>Number.isInteger(clip.frames)&&clip.frames>=1&&clip.frames<=600;
    const validFrame=value=>validRange()&&Number.isInteger(value)&&value>=0&&value<=clip.frames;
    const canMove=(key,frame)=>validFrame(frame)&&!track.keys.some(other=>other!==key&&other.frame===frame);
    function element(name,attrs,text){const value=document.createElementNS(ns,name);for(const [key,data]of Object.entries(attrs))value.setAttribute(key,String(data));if(text!==undefined)value.textContent=text;return value;}
    function select(key,focus=false){selected=key;cursor=validFrame(key.frame)?key.frame:cursor;message="";onSelect(key);draw();if(focus)svg.querySelector('[tabindex="0"]')?.focus();}
    function changed(){onChange();saveLocalDraft();draw();}
    function move(key,frame,focus=false){
      if(!editable())return;
      if(!canMove(key,frame)){message="Quadro ocupado ou fora da duração. Nenhuma chave foi alterada.";draw();return;}
      if(key.frame!==frame){key.frame=frame;cursor=frame;message="";changed();}else draw();
      if(focus)svg.querySelector('[tabindex="0"]')?.focus();
    }
    function draw(){
      if(drag&&!editable()){const pointer=drag.pointer;drag=null;cursor=selected.frame;message="Movimento cancelado: o pedido está bloqueado para edição.";if(svg.hasPointerCapture(pointer))svg.releasePointerCapture(pointer);}
      if(!track.keys.includes(selected))selected=track.keys[0];
      const duration=validRange()?clip.frames:1,x=frame=>20+600*frame/duration;
      ruler.max=String(duration);ruler.value=String(Math.max(0,Math.min(duration,cursor)));ruler.disabled=!editable()||!validRange();
      svg.replaceChildren(element("line",{x1:20,x2:620,y1:54,y2:54,class:"model-timeline-axis"}));
      for(let i=0;i<=4;i++){const frame=Math.round(duration*i/4);svg.append(element("line",{x1:x(frame),x2:x(frame),y1:48,y2:68,class:"model-timeline-axis"}),element("text",{x:x(frame),y:90,"text-anchor":"middle",class:"model-timeline-tick"},String(frame)));}
      svg.append(element("line",{x1:x(Math.max(0,Math.min(duration,cursor))),x2:x(Math.max(0,Math.min(duration,cursor))),y1:12,y2:71,class:"model-timeline-cursor"}));
      for(const [index,key]of track.keys.entries()){
        if(!validFrame(key.frame))continue;
        const marker=element("g",{transform:`translate(${x(key.frame)} 54)`,role:"slider",tabindex:key===selected?0:-1,"aria-label":`Chave ${index+1} · quadro`,"aria-valuemin":0,"aria-valuemax":duration,"aria-valuenow":key.frame,"aria-disabled":!editable(),"data-key-index":index,class:"model-key"+(key===selected?" selected":"")});
        marker.append(element("rect",{x:-12,y:-19,width:24,height:38,class:"model-key-hit"}),element("path",{d:"M 0 -9 L 7 0 L 0 9 L -7 0 Z"}));
        marker.addEventListener("focus",()=>{if(key!==selected)select(key,true);});
        marker.addEventListener("pointerdown",event=>{
          if(event.button!==0||!editable()||!validRange())return;event.preventDefault();select(key);drag={key,pointer:event.pointerId,frame:key.frame};svg.setPointerCapture(event.pointerId);svg.focus();
        });
        marker.addEventListener("keydown",event=>{
          if(!editable())return;let frame;
          if(event.key==="ArrowLeft"||event.key==="ArrowRight")frame=key.frame+(event.key==="ArrowLeft"?-1:1)*(event.shiftKey?10:1);
          else if(event.key==="Home")frame=0;else if(event.key==="End")frame=clip.frames;
          else if(event.key==="Escape"&&drag){event.preventDefault();drag=null;message="Movimento cancelado.";draw();return;}else return;
          event.preventDefault();move(key,frame,true);
        });svg.append(marker);
      }
      const invalid=track.keys.some(key=>!validFrame(key.frame))||new Set(track.keys.map(key=>key.frame)).size!==track.keys.length;
      status.textContent=message||(invalid?"Há quadros inválidos ou repetidos. Corrija os campos; os dados originais foram preservados.":`Quadro ${cursor} · ${track.keys.length} chaves · selecionada ${track.keys.indexOf(selected)+1}`);
      const blocked=!editable()||!validRange();previous.disabled=next.disabled=blocked||track.keys.length<2;
      add.disabled=blocked||track.keys.length>=256||totalKeys()>=8192||track.keys.some(key=>key.frame===cursor)||!selected?.value?.every(Number.isFinite);
      remove.disabled=blocked||track.keys.length<=1;
    }
    const previous=button("Selecionar chave anterior",()=>{const index=track.keys.indexOf(selected);select(track.keys[(index-1+track.keys.length)%track.keys.length],true);});
    const next=button("Selecionar próxima chave",()=>select(track.keys[(track.keys.indexOf(selected)+1)%track.keys.length],true));
    const add=button("Copiar chave neste quadro",()=>{
      if(!editable()||!canMove(null,cursor)||track.keys.length>=256||totalKeys()>=8192||!selected?.value?.every(Number.isFinite))return;
      const key={frame:cursor,value:[...selected.value]};track.keys.push(key);select(key);changed();
    });
    const remove=button("Remover chave selecionada",()=>{if(!editable()||track.keys.length<=1)return;track.keys.splice(track.keys.indexOf(selected),1);selected=track.keys[0];select(selected);changed();});
    actions.append(previous,next,add,remove);
    ruler.addEventListener("input",()=>{if(!editable()||!validRange())return;cursor=ruler.valueAsNumber;message="";draw();});
    svg.addEventListener("pointermove",event=>{if(!drag||drag.pointer!==event.pointerId)return;const bounds=svg.getBoundingClientRect();if(!bounds.width)return;drag.frame=Math.round(((event.clientX-bounds.left)*640/bounds.width-20)/600*clip.frames);cursor=Math.max(0,Math.min(clip.frames,drag.frame));message=`Mover para quadro ${drag.frame}`;draw();});
    svg.addEventListener("pointerup",event=>{if(!drag||drag.pointer!==event.pointerId)return;const value=drag;drag=null;if(svg.hasPointerCapture(event.pointerId))svg.releasePointerCapture(event.pointerId);move(value.key,value.frame,true);});
    const cancel=()=>{if(drag){drag=null;cursor=selected.frame;message="Movimento cancelado.";draw();}};
    svg.addEventListener("keydown",event=>{if(event.key==="Escape"&&drag){event.preventDefault();const pointer=drag.pointer;cancel();if(svg.hasPointerCapture(pointer))svg.releasePointerCapture(pointer);svg.querySelector('[tabindex="0"]')?.focus();}});
    svg.addEventListener("pointercancel",cancel);svg.addEventListener("lostpointercapture",cancel);root.addEventListener("rangechange",draw);draw();return {refresh:draw};
  }
  // Typed recipe controls only; evaluation, armature deformation and export
  // remain in the installed processor. No project code or model loop runs here.
  function renderModelEditor(operation,root){
    if(!Array.isArray(operation.objects)||!Array.isArray(operation.materials)||!Array.isArray(operation.clips)||!operation.preview)throw Error("Receita 3D incompatível; preserve o rascunho original.");
    const editable=()=>!busy&&!imageEdit?.command;
    const grid=parent=>{const value=node("div",undefined,"image-fields-grid");parent.append(value);return value;};
    function field(parent,label,value,change,min=-10000,max=10000,kind="number"){
      const wrap=node("div",undefined,"image-field"),title=node("label",label),input=node("input");input.id=`model-${crypto.randomUUID()}`;title.htmlFor=input.id;input.type=kind==="boolean"?"checkbox":kind==="color"?"text":"number";
      if(kind==="boolean")input.checked=value;else{input.required=true;input.value=value??"";if(kind==="color"){input.pattern="#[a-fA-F0-9]{8}";input.maxLength=9;input.title="Cor com transparência: #RRGGBBAA";}else{input.min=min;input.max=max;input.step="any";}}
      input.addEventListener("input",()=>{if(editable())change(kind==="boolean"?input.checked:kind==="color"?input.value:Number.isFinite(input.valueAsNumber)?input.valueAsNumber:null);});wrap.append(title,input);parent.append(wrap);return input;
    }
    function choose(parent,label,options,value,change){
      const wrap=node("div",undefined,"image-field"),title=node("label",label),input=node("select");input.id=`model-${crypto.randomUUID()}`;title.htmlFor=input.id;
      for(const [key,text]of options){const option=node("option",text);option.value=key;input.append(option);}input.value=value;
      input.addEventListener("change",()=>{if(editable())change(input.value);});wrap.append(title,input);parent.append(wrap);return input;
    }
    function vector(parent,label,value,min=-10000,max=10000){const fields=grid(parent);for(const [axis,index]of [["X",0],["Y",1],["Z",2]])field(fields,`${label} ${axis}`,value[index],next=>{value[index]=next;},min,max);}
    function section(parent,title,render){const details=node("details",undefined,"image-layer"),summary=node("summary",title);details.dataset.modelSection=title;let loaded=false;details.append(summary);details.addEventListener("toggle",()=>{if(details.open&&!loaded){loaded=true;render(details);}});parent.append(details);return details;}
    function page(parent,label,values,render,size=12){
      const list=node("div"),controls=node("div",undefined,"actions");let offset=0;parent.append(list,controls);
      const show=()=>{list.replaceChildren();controls.replaceChildren();for(let i=offset;i<Math.min(offset+size,values.length);i++)render(list,values[i],i);
        controls.append(button("Anterior",()=>{offset=Math.max(0,offset-size);show();},offset===0),node("span",`${label}: ${values.length?offset+1:0}–${Math.min(offset+size,values.length)} de ${values.length}`,"muted"),button("Próximo",()=>{offset+=size;show();},offset+size>=values.length));};show();
    }
    root.append(node("p","Edite a receita preservada. Use metros, eixo Z para cima e rotações em graus. A variante será inspecionada no visor após o processamento.","muted"));
    const global=grid(root);choose(global,"Quadros por segundo",[["24","24"],["30","30"],["60","60"]],String(operation.fps),value=>{operation.fps=Number(value);});
    section(root,`Objetos · ${operation.objects.length}`,parent=>page(parent,"Objetos",operation.objects,(list,object)=>{
      section(list,`Objeto ${object.id}`,body=>{
        vector(body,`Objeto ${object.id} · Posição`,object.position);vector(body,`Objeto ${object.id} · Rotação em graus`,object.rotation);vector(body,`Objeto ${object.id} · Escala`,object.scale,.001,1000);
        choose(body,`Objeto ${object.id} · Material`,[["","Sem material"],...operation.materials.map(material=>[material.id,material.id])],object.material??"",value=>{if(value)object.material=value;else delete object.material;});
        field(body,`Objeto ${object.id} · Suavizar`,object.smooth,value=>{object.smooth=value;},0,1,"boolean");
        body.append(node("p",`Geometria: ${object.geometry.kind}${object.parent?` · pai ${object.parent}`:""}${object.bindBone?` · vínculo rígido ${object.bindBone}`:""}`,"muted"));
        if(object.geometry.kind==="glb")body.append(node("p",`Fonte preservada: ${object.geometry.source.assetId} · ${object.geometry.source.path}`,"muted"));
        else if(!object.skin){field(body,`Objeto ${object.id} · Chanfro`,object.bevel,value=>{object.bevel=value;},0,.5);field(body,`Objeto ${object.id} · Subdivisão`,object.subdivision,value=>{object.subdivision=value;},0,2);}
        if(object.geometry.kind==="mesh")section(body,`Vértices · ${object.geometry.vertices.length}`,vertices=>page(vertices,"Vértices",object.geometry.vertices,(items,vertex,index)=>{
          section(items,`Vértice ${index} · ${object.id}`,item=>{
            vector(item,`${object.id} · Vértice ${index} · Posição`,vertex);
            if(!object.skin)return;
            const influences=object.skin.weights[index],rows=node("div"),status=node("p",undefined,"muted"),actions=node("div",undefined,"actions");
            const bones=operation.rig?.bones??[];item.append(node("p","Até quatro ossos distintos por vértice. A soma deve ser 1; normalize apenas quando desejar redistribuir os pesos.","muted"),rows,status,actions);
            function weights(){
              rows.replaceChildren();influences.forEach((influence,at)=>{
                const fields=grid(rows);choose(fields,`${object.id} · Vértice ${index} · Osso ${at+1}`,bones.map(bone=>[bone.id,bone.id]),influence.bone,value=>{influence.bone=value;});
                field(fields,`${object.id} · Vértice ${index} · Peso ${at+1}`,influence.weight,value=>{influence.weight=value;update();},.000001,1);
                fields.append(button("Remover influência",()=>{if(!editable()||influences.length<=1)return;influences.splice(at,1);weights();},influences.length<=1));
              });update();
            }
            function update(){const sum=influences.reduce((total,entry)=>total+(entry.weight??0),0);status.textContent=`Soma dos pesos: ${sum.toFixed(6)}`;add.disabled=influences.length>=4||!bones.some(bone=>!influences.some(entry=>entry.bone===bone.id));}
            const add=button("Adicionar influência",()=>{if(!editable()||influences.length>=4)return;const bone=bones.find(bone=>!influences.some(entry=>entry.bone===bone.id));if(bone){influences.push({bone:bone.id,weight:.1});weights();}});
            actions.append(add,button("Normalizar pesos",()=>{if(!editable())return;const sum=influences.reduce((total,entry)=>total+entry.weight,0);if(!influences.every(entry=>Number.isFinite(entry.weight)&&entry.weight>0)||!Number.isFinite(sum)||sum<=0){notice("Preencha pesos positivos antes de normalizar.",true);return;}for(const entry of influences)entry.weight/=sum;weights();}));weights();
          });
        }));
      });
    }));
    section(root,`Materiais · ${operation.materials.length}`,parent=>page(parent,"Materiais",operation.materials,(list,material)=>{
      section(list,`Material ${material.id}`,body=>{
        const fields=grid(body);field(fields,`Material ${material.id} · Cor RGBA`,material.color,value=>{material.color=value;},0,1,"color");field(fields,`Material ${material.id} · Emissão RGBA`,material.emission,value=>{material.emission=value;},0,1,"color");
        field(fields,`Material ${material.id} · Metalicidade`,material.metallic,value=>{material.metallic=value;},0,1);field(fields,`Material ${material.id} · Rugosidade`,material.roughness,value=>{material.roughness=value;},0,1);
        if(material.texture)body.append(node("p",`Textura preservada: ${material.texture.assetId} · ${material.texture.path}`,"muted"));
      });
    }));
    if(operation.rig)section(root,`Ossos · ${operation.rig.bones.length}`,parent=>page(parent,"Ossos",operation.rig.bones,(list,bone)=>{
      section(list,`Osso ${bone.id}`,body=>{body.append(node("p",bone.parent?`Pai: ${bone.parent}`:"Raiz da armadura","muted"));vector(body,`Osso ${bone.id} · Início`,bone.head);vector(body,`Osso ${bone.id} · Fim`,bone.tail);});
    }));
    section(root,`Animações · ${operation.clips.length}`,parent=>page(parent,"Animações",operation.clips,(list,clip)=>{
      section(list,`Animação ${clip.id}`,body=>{
        field(body,`Animação ${clip.id} · Duração em quadros`,clip.frames,value=>{clip.frames=value;for(const timeline of body.querySelectorAll('.model-timeline'))timeline.dispatchEvent(new Event('rangechange'));},1,600);
        page(body,"Trilhas",clip.tracks,(tracks,track,trackIndex)=>section(tracks,`Trilha ${trackIndex+1} · ${track.target.id} · ${track.channel}`,keys=>{
          let offset=0,timeline;const values=node("div"),controls=node("div",undefined,"actions");
          const total=()=>operation.clips.reduce((sum,value)=>sum+value.tracks.reduce((count,entry)=>count+entry.keys.length,0),0);
          timeline=renderKeyTimeline(keys,clip,track,editable,total,key=>{offset=Math.floor(track.keys.indexOf(key)/12)*12;render();},()=>render());keys.append(values,controls);
          const render=()=>{
            values.replaceChildren();controls.replaceChildren();offset=Math.min(offset,Math.max(0,Math.ceil(track.keys.length/12)-1)*12);
            track.keys.slice(offset,offset+12).forEach((key,index)=>{const at=offset+index,fields=node("fieldset",undefined,"vector-command");fields.append(node("legend",`Chave ${at+1}`));
              const name=`${clip.id} · Trilha ${trackIndex+1} · Chave ${at+1}`;field(fields,`${name} · Quadro`,key.frame,value=>{key.frame=value;timeline.refresh();},0,600);vector(fields,`${name} · Valor`,key.value,track.channel==="scale"?.001:-10000,10000);
              fields.append(button("Remover chave",()=>{if(!editable()||track.keys.length<=1)return;track.keys.splice(at,1);render();timeline.refresh();},track.keys.length<=1));values.append(fields);
            });
            controls.append(button("Chaves anteriores",()=>{offset=Math.max(0,offset-12);render();},offset===0),node("span",`${offset+1}–${Math.min(offset+12,track.keys.length)} de ${track.keys.length}`,"muted"),button("Próximas chaves",()=>{offset+=12;render();},offset+12>=track.keys.length),button("Adicionar chave",()=>{
              if(!editable()||track.keys.length>=256||total()>=8192)return;const frame=Array.from({length:Math.min(600,clip.frames)+1},(_,i)=>i).find(frame=>!track.keys.some(key=>key.frame===frame));
              if(frame===undefined){notice("Todos os quadros desta trilha já têm chave. Amplie a duração para acrescentar outra.",true);return;}track.keys.push({frame,value:[...track.keys.at(-1).value]});offset=Math.floor((track.keys.length-1)/12)*12;render();timeline.refresh();
            },track.keys.length>=256||total()>=8192));
          };keys.addEventListener("input",()=>timeline.refresh());render();
        }));
      });
    }));
    section(root,"Imagem de inspeção",parent=>{
      vector(parent,"Câmera · Posição",operation.preview.position);vector(parent,"Câmera · Alvo",operation.preview.target);field(parent,"Câmera · Escala ortográfica",operation.preview.orthographicScale,value=>{operation.preview.orthographicScale=value;},.1,1000);
      field(parent,"Fundo RGBA",operation.preview.background,value=>{operation.preview.background=value;},0,1,"color");field(parent,"Fundo transparente",operation.preview.transparent,value=>{operation.preview.transparent=value;},0,1,"boolean");
      page(parent,"Luzes",operation.preview.lights,(list,light,index)=>section(list,`Luz ${index+1}`,body=>{vector(body,`Luz ${index+1} · Posição`,light.position);vector(body,`Luz ${index+1} · Alvo`,light.target);field(body,`Luz ${index+1} · Potência`,light.power,value=>{light.power=value;},0,5000);field(body,`Luz ${index+1} · Tamanho`,light.size,value=>{light.size=value;},.1,30);}));
    });
  }
  function openImageEditor(){
    if(busy||!candidate||imageEdit||audioEncodeDraft||!["image.compose","image.vector","audio.render","model.scene"].includes(candidate.result.spec.operation.type))return;
    imageEdit={projectId:candidate.projectId,jobId:candidate.result.jobId,expectedRevision:candidate.expectedRevision,requestId:crypto.randomUUID(),operation:structuredClone(candidate.result.spec.operation),command:null};
    saveLocalDraft();showImageEditor();
  }
  function showImageEditor(){
    renderCandidateState();
    const operation=imageEdit.operation,root=el("image-editor-fields");root.replaceChildren();el("image-editor").hidden=false;
    el("image-editor-origin").textContent=`${candidate?.result.asset.role??"Ajustes preservados"} · revisão ${imageEdit.expectedRevision}`;
    el("image-editor-title").textContent=operation.type==="model.scene"?"Ajustar modelo 3D":operation.type==="audio.render"?"Ajustar áudio":operation.type==="image.vector"?"Ajustar ilustração":"Ajustar composição";
    if(operation.type==="model.scene"){renderModelEditor(operation,root);renderImageEditState();root.querySelector("input,select")?.focus();return;}
    if(operation.type==="audio.render"){renderAudioEditor(operation,root);renderImageEditState();root.querySelector("input").focus();return;}
    if(operation.type==="image.vector"){renderVectorEditor(operation,root);renderImageEditState();root.querySelector("input").focus();return;}
    function field(parent,label,path,value,kind,min,max){
      const wrap=node("div",undefined,"image-field"),id=`image-control-${root.querySelectorAll("input,select").length}`,title=node("label",label),input=node("input");title.htmlFor=id;input.id=id;input.dataset.path=path;input.dataset.kind=kind;
      if(kind==="boolean"){input.type="checkbox";input.checked=value;}
      else{input.type=kind==="number"?"number":"text";input.value=value;input.required=true;if(kind==="number"){input.step=max===1?"any":"1";if(min!==undefined)input.min=min;if(max!==undefined)input.max=max;}else{input.pattern="#[a-fA-F0-9]{8}";input.maxLength=9;input.title="Cor hexadecimal com alfa: #RRGGBBAA";}}
      wrap.append(title,input);parent.append(wrap);return input;
    }
    const canvas=node("div",undefined,"image-fields-grid");root.append(canvas);field(canvas,"Largura da imagem","width",operation.width,"number",1,4096);field(canvas,"Altura da imagem","height",operation.height,"number",1,4096);field(canvas,"Cor do fundo · RGBA","background",operation.background,"color");
    if(snapshot?.canOptimizePng||operation.pngEncoding!==undefined){
      const wrap=node("div",undefined,"image-field"),label=node("label","Tamanho do PNG"),select=node("select");label.htmlFor="image-png-encoding";select.id="image-png-encoding";select.dataset.path="pngEncoding";select.dataset.kind="text";
      for(const [value,text]of [[operation.pngEncoding==="rgba8"?"rgba8":"","Padrão"],["lossless-smallest","Menor, sem perda de pixels"]]){const option=node("option",text);option.value=value;select.append(option);}select.value=operation.pngEncoding??"";select.disabled=!snapshot?.canOptimizePng;wrap.append(label,select);canvas.append(wrap);
      if(!snapshot?.canOptimizePng)root.append(node("p","Este ajuste exige atualização do motor. A escolha anterior foi preservada.","muted"));
    }
    operation.layers.forEach((layer,index)=>{
      const section=node("fieldset",undefined,"image-layer"),legend=node("legend",`Camada ${index+1}`),source=node("p",layer.source.path,"muted"),grid=node("div",undefined,"image-fields-grid");section.append(legend,source,grid);root.append(section);const prefix=`layers.${index}.`;
      for(const [name,label,min,max] of [["x","Posição horizontal",-8192,8192],["y","Posição vertical",-8192,8192],["width","Largura",1,4096],["height","Altura",1,4096],["opacity","Opacidade · 0 a 1",0,1]])field(grid,label,prefix+name,layer[name],"number",min,max);
      field(grid,"Cor da camada · RGBA",prefix+"tint",layer.tint,"color");field(grid,"Espelhar horizontalmente",prefix+"flipX",layer.flipX,"boolean");field(grid,"Espelhar verticalmente",prefix+"flipY",layer.flipY,"boolean");
      const filterWrap=node("div",undefined,"image-field"),filter=node("select"),label=node("label","Escala"),id=`image-filter-${index}`;filter.id=id;label.htmlFor=id;filter.dataset.path=prefix+"filter";filter.dataset.kind="text";
      for(const [value,text] of [["bilinear","Suave"],["nearest","Pixels nítidos"]]){const option=node("option",text);option.value=value;filter.append(option);}filter.value=layer.filter;filterWrap.append(label,filter);grid.append(filterWrap);
      const crop=field(grid,"Recortar a fonte",prefix+"cropEnabled",Boolean(layer.crop),"boolean"),cropFields=node("fieldset",undefined,"image-fields-grid image-crop");section.append(cropFields);cropFields.disabled=!crop.checked;crop.addEventListener("change",()=>{cropFields.disabled=!crop.checked;});
      for(const [name,text,min,max] of [["x","Início horizontal",0,8192],["y","Início vertical",0,8192],["width","Largura do recorte",1,4096],["height","Altura do recorte",1,4096]])field(cropFields,text,prefix+"crop."+name,layer.crop?.[name]??(name==="width"?layer.width:name==="height"?layer.height:0),"number",min,max);
    });
    renderImageEditState();root.querySelector("input").focus();
  }
  function captureComposition(){
    if(!imageEdit||imageEdit.command||imageEdit.operation.type!=="image.compose")return;
    const operation=imageEdit.operation,cropEnabled=new Set();
    for(const input of el("image-editor-fields").querySelectorAll("input,select")){
      const keys=input.dataset.path.split("."),last=keys.pop();if(last==="cropEnabled"){if(input.checked)cropEnabled.add(Number(keys[1]));continue;}
      if(last==="pngEncoding"&&input.value===""){delete operation.pngEncoding;continue;}
      if(keys.includes("crop")&&input.closest("fieldset.image-crop").disabled)continue;
      const parent=keys.reduce((object,key)=>object[key]??(object[key]={}),operation);parent[last]=input.dataset.kind==="number"?input.valueAsNumber:input.dataset.kind==="boolean"?input.checked:input.value;
    }
    operation.layers.forEach((layer,index)=>{if(!cropEnabled.has(index))delete layer.crop;});
  }
  for(const type of ["input","change","click"])el("image-editor-fields").addEventListener(type,()=>{if(!imageEdit?.command){captureComposition();saveLocalDraft();}});
  el("adjust-image").addEventListener("click",openImageEditor);
  el("cancel-image-editor").addEventListener("click",()=>{if(!busy&&!imageEdit?.command)closeImageEditor();});
  el("image-editor-jobs").addEventListener("click",()=>switchTab("builds"));
  el("image-editor").addEventListener("submit",async(event)=>{
    event.preventDefault();if(busy||!imageEdit)return;const edit=imageEdit,resuming=Boolean(edit.command);
    if(!edit.command){
      const operation=structuredClone(edit.operation),cropEnabled=new Set();
      if(operation.type==="image.compose")for(const input of el("image-editor-fields").querySelectorAll("input,select")){
        const keys=input.dataset.path.split("."),last=keys.pop();if(last==="cropEnabled"){if(input.checked)cropEnabled.add(Number(keys[1]));continue;}
        if(last==="pngEncoding"&&input.value===""){delete operation.pngEncoding;continue;}
        if(keys.includes("crop")&&input.closest("fieldset.image-crop").disabled)continue;
        const parent=keys.reduce((object,key)=>object[key]??(object[key]={}),operation);parent[last]=input.dataset.kind==="number"?Number(input.value):input.dataset.kind==="boolean"?input.checked:input.value;
      }
      if(operation.type==="image.compose")operation.layers.forEach((layer,index)=>{if(!cropEnabled.has(index))delete layer.crop;});
      edit.command={action:operation.type==="model.scene"?"adjust-model":operation.type==="audio.render"?"adjust-audio":operation.type==="image.vector"?"adjust-vector":"adjust-image",projectId:edit.projectId,jobId:edit.jobId,expectedRevision:edit.expectedRevision,requestId:edit.requestId,operation};
    }
    renderImageEditState();
    try{await persistDrafts();}catch{renderImageEditState();return;}
    const result=await act(edit.command);
    if(imageEdit!==edit)return;
    if(result?.cancelled||result?.imageAdjustmentRejected){if(!resuming)edit.command=null;saveLocalDraft();renderImageEditState();return;}
    if(result?.requestedAssetJobId){closeImageEditor();notice("Nova variante solicitada. Acompanhe o processamento em Builds e testes; o projeto ainda não foi alterado.");}
    else renderImageEditState();
  });
  function renderJobs(){
    el("job-list").replaceChildren(...snapshot.jobs.jobs.map((job)=>{
      const controls=[];
      if(["admitting","queued","running","cancelling"].includes(job.state))controls.push(button("Encerrar",()=>act({action:"cancel",jobId:job.id}),!snapshot.canWrite||job.state==="cancelling"));
      if(job.state==="awaiting_reconciliation")controls.push(button("Inspecionar resultado",()=>act({action:"reconcile",jobId:job.id}),!snapshot.canWrite));
      if(job.kind==="build"&&job.state==="completed"){
        controls.push(button("Jogar",()=>act({action:"preview",buildId:job.id})),button("Exportar",()=>act({action:"export-build",buildId:job.id})));
        for(const collector of snapshot.capabilities.collectors.filter((item)=>item.available!==false&&item.engines.includes(job.engine)))controls.push(button(`Verificar · ${collector.categories.join(", ")}`,()=>act({action:"validate",buildId:job.id,collectorId:collector.id,requestId:crypto.randomUUID()}),!snapshot.canWrite));
      }
      if(job.kind==="assets"&&job.state==="completed")controls.push(button("Revisar mídia",()=>{switchTab("assets");return openCandidate(job);}));
      return row(`${kinds[job.kind]??job.kind} · revisão ${job.revision}`,`${states[job.state]??job.state} · ${time(job.updatedAt)}\n${job.waitingReason==="resources"?"Aguardando recursos de produção disponíveis neste computador.":job.error??job.toolchain.version}`,controls);
    }));el("more-jobs").hidden=!snapshot.jobs.hasMore;
    if(!snapshot.jobs.jobs.length)el("job-list").append(node("p","Nenhum trabalho de produção neste projeto.","muted"));
  }
  function renderHistory(){
    if(comparisonProjectId!==snapshot.project.id){comparisonProjectId=snapshot.project.id;comparison=null;comparisonQuery=null;clearFileComparison();el("comparison-base").value=String(Math.max(1,snapshot.project.revision-1));el("comparison-target").value=String(snapshot.project.revision);el("comparison-section").value="all";}
    for(const id of ["comparison-base","comparison-target"])el(id).max=String(snapshot.project.revision);
    renderComparison();renderFileComparison();
    const displayed={projectId:snapshot.project.id,expectedRevision:snapshot.project.revision};
    el("revision-list").replaceChildren(...snapshot.history.revisions.map((revision)=>{
      const control=button("Restaurar",()=>startRestore(revision.revision,displayed));control.dataset.restoreRevision=String(revision.revision);
      return row(`Revisão ${revision.revision}${revision.revision===snapshot.project.revision?" · atual":""}`,`${revision.message}\n${time(revision.createdAt)} · ${revision.contentHash.slice(0,12)}`,[control]);
    }));renderRestoreState();
    el("more-history").hidden=!snapshot.history.hasMore;
  }
  function readRestoreDraft(raw){
    if(!raw||typeof raw!=="object"||Array.isArray(raw)||Object.keys(raw).sort().join(",")!=="action,expectedRevision,projectId,requestId,revision"||raw.action!=="restore"||
      ![raw.projectId,raw.requestId].every(value=>typeof value==="string"&&value.length>0&&value.length<=160)||
      ![raw.revision,raw.expectedRevision].every(value=>Number.isSafeInteger(value)&&value>0))throw new Error("A restauração preservada precisa de recuperação; o original não será sobrescrito.");
    return structuredClone(raw);
  }
  function renderRestoreState(){
    el("restore-request").hidden=!restoreDraft;
    const same=restoreDraft?.projectId===snapshot?.project?.id;
    el("restore-state").textContent=restoreDraft?`Pedido preservado: restaurar a revisão ${restoreDraft.revision} sobre a revisão ${restoreDraft.expectedRevision}. ${same?"Confira o resultado antes de enviar outra restauração.":"Volte ao projeto original para conferir esse pedido."}`:"";
    el("resume-restore").disabled=busy||!draftReady||!same||!restoreDraft;
    document.querySelectorAll("[data-restore-revision]").forEach(control=>{control.disabled=busy||!draftReady||Boolean(restoreDraft)||!snapshot?.canWrite||Number(control.dataset.restoreRevision)===snapshot?.project?.revision;});
  }
  async function startRestore(revision,displayed){
    if(busy||!draftReady||restoreDraft||!snapshot?.canWrite)return;
    if(snapshot.project.id!==displayed.projectId||snapshot.project.revision!==displayed.expectedRevision){notice("A seleção mudou. Confira a revisão exibida antes de restaurar.",true);return;}
    restoreDraft={action:"restore",...displayed,revision,requestId:crypto.randomUUID()};
    await submitRestore(false);
  }
  async function submitRestore(resuming){
    if(busy||!draftReady||!restoreDraft)return;
    const frozen=restoreDraft;renderRestoreState();
    try{await persistDrafts();}catch{renderRestoreState();return;}
    const result=await act(resuming?{...frozen,action:"resume-restore"}:frozen);
    if(restoreDraft!==frozen)return;
    if(result?.project||!resuming&&(result?.cancelled||result?.restoreRejected)){
      restoreDraft=null;
      try{await persistDrafts();}catch{restoreDraft=frozen;renderRestoreState();notice("Não foi possível confirmar a limpeza do pedido. Reabra o Studio para conferir o estado preservado.",true);return;}
      if(result?.project)notice(result.recoveredRestoreCommit?`Restauração confirmada na revisão ${result.recoveredRestoreCommit.revision}. As alterações posteriores foram preservadas.`:"Restauração salva como nova revisão.");
    }
    renderRestoreState();
  }
  el("resume-restore").addEventListener("click",()=>submitRestore(true));
  const comparisonAreas={all:"Todas as áreas",overview:"Briefing",design:"Design",files:"Arquivos",assets:"Assets",legacy:"Legado"};
  function comparisonValue(value){
    if(value.kind==="absent")return "Ausente nesta revisão";
    if(value.kind==="null")return "Sem valor";
    if(value.kind==="string"||value.kind==="number")return String(value.value);
    if(value.kind==="boolean")return value.value?"Sim":"Não";
    if(value.kind==="file")return `${value.path}\n${value.size.toLocaleString("pt-BR")} bytes · ${value.mime}\nSHA-256 ${value.sha256}`;
    if(value.kind==="opaque")return `Metadados legados preservados · ${value.bytes.toLocaleString("pt-BR")} bytes\nSHA-256 ${value.sha256}\nO conteúdo integral continua na exportação do histórico.`;
    return `${value.kind==="array"?"Lista":"Grupo"} com ${value.count} ${value.kind==="array"?"itens":"campos"}`;
  }
  function renderComparisonState(){
    const locked=busy||comparisonLoading;for(const id of ["compare-revisions","comparison-base","comparison-target","comparison-section","more-comparison"])el(id).disabled=locked||!snapshot?.project;
    el("comparison-status").textContent=comparisonLoading?"Conferindo as revisões selecionadas…":comparison?"Comparação somente de leitura. Escolha outras revisões ou áreas para uma nova consulta.":"Escolha duas revisões para conferir as diferenças.";
  }
  function renderComparison(){
    el("comparison-result").hidden=!comparison;
    if(comparison){const c=comparison;el("comparison-title").textContent=`Revisão ${c.base.revision} → revisão ${c.target.revision} · ${comparisonAreas[c.section]}`;
      el("comparison-summary").textContent=c.sourceEqual?"As duas revisões têm o mesmo conteúdo de origem.":`${c.counts.total} diferenças estruturais no conjunto · ${c.counts.design} em design · ${c.counts.files} em arquivos · ${c.counts.assets} em assets. Não é uma revisão de qualidade ou uma comparação visual dos builds.`;
      el("comparison-binding").textContent=`Origem ${c.base.contentHash.slice(0,12)} · destino ${c.target.contentHash.slice(0,12)} · projeto atualmente na revisão ${snapshot.project.revision}.`;
      el("comparison-changes").replaceChildren(...c.changes.map(entry=>{
        const item=node("section",undefined,"comparison-change"),labels={added:"Adicionado",removed:"Removido",modified:"Alterado",moved:"Posição alterada"};
        item.append(node("h4",`${comparisonAreas[entry.section]} · ${entry.path.join(" › ")||"Estrutura"}`),node("p",labels[entry.change],"muted"));
        const values=node("div",undefined,"comparison-values");for(const [label,value]of [[`Origem · revisão ${c.base.revision}`,entry.before],[`Destino · revisão ${c.target.revision}`,entry.after]]){
          const column=node("div");column.append(node("strong",label),node("pre",comparisonValue(value)));values.append(column);}item.append(values);
        if(entry.section==="files"&&entry.change!=="moved"&&entry.path.length===1){const control=button("Comparar conteúdo",()=>loadFileComparison({projectId:c.projectId,baseRevision:c.base.revision,targetRevision:c.target.revision,path:entry.path[0],context:3}));control.dataset.compareFile=entry.path[0];item.append(control);}return item;
      }));
      if(!c.changes.length)el("comparison-changes").append(node("p","Nenhuma diferença nesta seleção.","muted"));
      const total=c.section==="all"?c.counts.total:c.counts[c.section];el("comparison-page").textContent=`${c.changes.length} de ${total} diferenças exibidas.`;el("more-comparison").hidden=!c.hasMore;
    }
    renderComparisonState();
  }
  async function loadComparison(append=false){
    if(busy||comparisonLoading||!snapshot?.project)return;
    if(!append&&!el("comparison-form").reportValidity())return;
    const query=append?comparisonQuery:{projectId:snapshot.project.id,baseRevision:Number(el("comparison-base").value),targetRevision:Number(el("comparison-target").value),section:el("comparison-section").value};
    if(!query||query.projectId!==snapshot.project.id)return;comparisonLoading=true;renderComparisonState();
    try{const result=await act({action:"compare",...query,cursor:append?comparison.cursor:0,limit:30});
      if(result?.projectId===snapshot?.project?.id&&result.comparison){const next=result.comparison;
        if(append&&(comparison.base.contentHash!==next.base.contentHash||comparison.target.contentHash!==next.target.contentHash||comparison.section!==next.section))throw new Error("As identidades das revisões divergiram. Preserve a comparação anterior e consulte novamente.");
        if(!append)clearFileComparison();comparison={...next,changes:append?[...comparison.changes,...next.changes]:next.changes};comparisonQuery=query;renderComparison();if(!append)el("comparison-title").focus();}}
    catch(error){notice(error.message,true);}finally{comparisonLoading=false;renderComparisonState();}
  }
  el("comparison-form").addEventListener("submit",event=>{event.preventDefault();void loadComparison();});
  el("more-comparison").addEventListener("click",()=>loadComparison(true));
  function pauseRevisionMedia(){for(const audio of el("revision-media-pair").querySelectorAll("audio"))audio.pause();}
  function clearRevisionMedia(){
    revisionMediaEpoch++;revisionMediaLoading=false;pauseRevisionMedia();
    for(const media of el("revision-media-pair").querySelectorAll("img,audio")){media.removeAttribute("src");if(media.tagName==="AUDIO")media.load();}
    el("revision-media-pair").replaceChildren();el("revision-media").hidden=true;el("revision-media-status").textContent="";
    el("revision-media-native").checked=false;el("revision-media-pair").classList.remove("native-size");el("revision-media-native-control").hidden=true;el("revision-media-note").textContent="";
  }
  async function loadRevisionMedia(){
    if(busy||revisionMediaLoading||!fileComparison)return;
    clearRevisionMedia();const comparison=fileComparison,epoch=revisionMediaEpoch;
    const current=()=>epoch===revisionMediaEpoch&&fileComparison===comparison&&snapshot?.project?.id===comparison.projectId;
    revisionMediaLoading=true;el("revision-media").hidden=false;el("revision-media-status").textContent="Conferindo os arquivos das revisões selecionadas…";renderFileComparisonState();
    try{
      for(const [key,title]of [["base","Origem"],["target","Destino"]]){
        const side=comparison[key],file=side.file,figure=node("figure"),caption=node("figcaption",`${title} · revisão ${side.revision}`);
        figure.dataset.mediaSide=key;figure.append(caption);
        if(!file){figure.append(node("p","Arquivo ausente nesta revisão.","muted"));el("revision-media-pair").append(figure);continue;}
        if(!["image/png","image/jpeg","image/webp","audio/wav","audio/mp4"].includes(file.mime)||file.size>4*1024*1024){figure.append(node("p","Formato ou tamanho fora da prévia. Use Exportar para conferir o arquivo integral.","muted"));el("revision-media-pair").append(figure);continue;}
        const value=await act({action:"revision-media",projectId:comparison.projectId,revision:side.revision,path:comparison.path,sha256:file.sha256});
        if(!current())return;
        if(value?.projectId!==comparison.projectId||value.revision!==side.revision||value.contentHash!==side.contentHash||value.path!==comparison.path||value.sha256!==file.sha256||value.size!==file.size||value.mime!==file.mime)throw Error("A mídia recebida divergiu da comparação original. Consulte novamente.");
        const viewport=node("div",undefined,"revision-media-viewport"),audio=file.mime.startsWith("audio/"),media=document.createElement(audio?"audio":"img"),detail=node("p",`${file.size.toLocaleString("pt-BR")} bytes · ${file.mime}`,"muted");
        if(audio){media.controls=true;media.preload="metadata";media.setAttribute("aria-label",`Áudio de ${title.toLowerCase()}, revisão ${side.revision}`);
          media.addEventListener("play",()=>{if(!current()||document.hidden||tab!=="history"){media.pause();return;}for(const other of el("revision-media-pair").querySelectorAll("audio"))if(other!==media)other.pause();});
          media.addEventListener("loadedmetadata",()=>{if(current()&&Number.isFinite(media.duration))detail.textContent+=` · ${media.duration.toFixed(2)} s`;});
        }else{media.alt=`${title}, revisão ${side.revision}: ${comparison.path}`;media.addEventListener("load",()=>{if(current())detail.textContent+=` · ${media.naturalWidth} × ${media.naturalHeight} pixels`;});}
        media.addEventListener("error",()=>{if(current())detail.textContent="O navegador não conseguiu decodificar este arquivo. Os bytes originais foram preservados; exporte para inspecionar.";});
        media.src=`data:${file.mime};base64,${value.data}`;viewport.append(media);figure.append(viewport,detail);el("revision-media-pair").append(figure);
      }
      if(current()){
        const hasImages=Boolean(el("revision-media-pair").querySelector("img")),hasAudio=Boolean(el("revision-media-pair").querySelector("audio"));
        el("revision-media-native-control").hidden=!hasImages;
        el("revision-media-note").textContent=[hasImages?"Use o tamanho original para conferir detalhes.":"",hasAudio?"Ao iniciar uma versão, a outra é pausada.":""].filter(Boolean).join(" ");
        el("revision-media-status").textContent=`Arquivos das revisões ${comparison.base.revision} e ${comparison.target.revision}. Nenhuma alteração aplicada.`;
      }
    }catch(error){if(current()){pauseRevisionMedia();el("revision-media-status").textContent=error.message;notice(error.message,true);}}
    finally{if(current()){revisionMediaLoading=false;renderFileComparisonState();}}
  }
  el("compare-media").addEventListener("click",loadRevisionMedia);
  el("close-revision-media").addEventListener("click",()=>{clearRevisionMedia();renderFileComparisonState();});
  el("revision-media-native").addEventListener("change",()=>el("revision-media-pair").classList.toggle("native-size",el("revision-media-native").checked));
  document.addEventListener("visibilitychange",()=>{if(document.hidden)pauseRevisionMedia();});
  function clearFileComparison(){clearRevisionMedia();fileComparisonEpoch++;fileComparison=null;fileComparisonQuery=null;fileComparisonLoading=false;el("file-comparison").hidden=true;}
  function renderFileComparisonState(){
    for(const id of ["recompare-file","file-comparison-context","export-file-base","export-file-target","more-file-comparison"])el(id).disabled=busy||fileComparisonLoading||!fileComparison;
    el("close-file-comparison").disabled=busy||fileComparisonLoading;
    // Local dismissal invalidates a late read; it does not cancel a service job.
    el("close-revision-media").disabled=false;
    const supported=side=>side?.file&&["image/png","image/jpeg","image/webp","audio/wav","audio/mp4"].includes(side.file.mime)&&side.file.size<=4*1024*1024;
    el("compare-media").hidden=!fileComparison||![fileComparison.base,fileComparison.target].some(supported);
    el("compare-media").disabled=busy||fileComparisonLoading||revisionMediaLoading;
  }
  const fileDiffReasons={"file-size":"O arquivo ultrapassa 512 KiB por versão.","line-size":"Uma linha ultrapassa 16 KiB.","line-count":"As versões ultrapassam 16.000 linhas no conjunto.","binary-or-encoding":"O conteúdo é binário ou não está em UTF-8.","edit-limit":"A alteração ultrapassa o limite de 512 linhas adicionadas e removidas."};
  function renderFileComparison(){
    const c=fileComparison;el("file-comparison").hidden=!c;if(!c){renderFileComparisonState();return;}
    el("file-comparison-title").textContent=c.path;
    el("file-comparison-binding").textContent=`Revisão ${c.base.revision} → revisão ${c.target.revision} · origem ${c.base.contentHash.slice(0,12)} · destino ${c.target.contentHash.slice(0,12)} · contexto ${c.context}`;
    el("file-comparison-summary").textContent=c.state==="unavailable"?`${fileDiffReasons[c.reason]} Exporte a origem ou o destino para conferir o conteúdo integral.`:
      c.counts.added+c.counts.removed===0?"Sem alterações de texto neste arquivo.":`${c.counts.added} linhas adicionadas · ${c.counts.removed} removidas · ${c.counts.unchanged} iguais.`;
    el("file-comparison-details").textContent=[['Origem',c.base],['Destino',c.target]].map(([name,side])=>side.file?`${name}: ${side.file.size.toLocaleString("pt-BR")} bytes · SHA-256 ${side.file.sha256}${side.utf8Bom?" · BOM UTF-8 preservado":""}`:`${name}: arquivo ausente`).join("\n");
    el("file-comparison-rows").replaceChildren(...c.rows.map(entry=>{const row=node("tr");row.dataset.kind=entry.kind;
      if(entry.kind==="omitted"){const cell=node("td",`${entry.count} linhas iguais omitidas · origem ${entry.baseLine} / destino ${entry.targetLine}`);cell.colSpan=5;row.append(cell);return row;}
      const labels={context:"= Igual",added:"+ Adicionada",removed:"− Removida"},endings={lf:"LF",crlf:"CRLF",cr:"CR",none:"Sem quebra final"};
      row.append(node("td",entry.baseLine??""),node("td",entry.targetLine??""),node("td",labels[entry.kind]));const code=node("code",entry.text),content=node("td");content.append(code);row.append(content,node("td",endings[entry.ending]));return row;}));
    el("file-comparison-page").textContent=c.state==="text"?`${c.rows.length} de ${c.totalRows} linhas e intervalos exibidos. Espaços e quebras são preservados.`:"Os arquivos originais permanecem intactos.";
    el("more-file-comparison").hidden=!c.hasMore;renderFileComparisonState();
  }
  async function loadFileComparison(query,append=false){
    if(busy||fileComparisonLoading||!snapshot?.project||query.projectId!==snapshot.project.id)return;
    if(!append)clearRevisionMedia();
    const epoch=++fileComparisonEpoch;fileComparisonLoading=true;renderFileComparisonState();
    try{const result=await act({action:"compare-file",...query,cursor:append?fileComparison.cursor:0,limit:50,...(append?{bindingHash:fileComparison.bindingHash}:{})});
      if(epoch!==fileComparisonEpoch||result?.projectId!==snapshot?.project?.id||!result.fileComparison)return;
      const next=result.fileComparison;
      if(append&&next.bindingHash!==fileComparison.bindingHash)throw Error("A comparação divergiu. Os dados anteriores foram preservados; consulte novamente.");
      fileComparison={...next,rows:append?[...fileComparison.rows,...next.rows]:next.rows};fileComparisonQuery=query;
      el("file-comparison-context").value=String(query.context);renderFileComparison();if(!append)el("file-comparison-title").focus();
    }catch(error){notice(error.message,true);}finally{if(epoch===fileComparisonEpoch){fileComparisonLoading=false;renderFileComparisonState();}}
  }
  el("close-file-comparison").addEventListener("click",clearFileComparison);
  el("recompare-file").addEventListener("click",()=>{if(fileComparisonQuery)void loadFileComparison({...fileComparisonQuery,context:Number(el("file-comparison-context").value)});});
  el("more-file-comparison").addEventListener("click",()=>{if(fileComparisonQuery)void loadFileComparison(fileComparisonQuery,true);});
  for(const side of ["base","target"])el(`export-file-${side}`).addEventListener("click",()=>{if(fileComparison)void act({action:"export-source",projectId:fileComparison.projectId,revision:fileComparison[side].revision,expectedRevision:snapshot.project.revision});});
  function renderReports(){
    const reports=snapshot.quality?.reports??[];el("reports").replaceChildren(...reports.map((report)=>{const view=node("div",undefined,"report");view.append(node("h3",`${report.category} · revisão ${report.revision}`),node("p",`${report.environment.device} · ${report.environment.scope}`));for(const check of report.checks)view.append(node("p",`${check.status==="passed"?"Verificado":check.status==="failed"?"Falhou":"Pendente"} · ${check.detail}`));return view;}));
    if(!reports.length)el("reports").append(node("p","Sem evidências para esta revisão. Um build concluído não comprova qualidade ou playtest.","muted"));
  }
  async function renderCapture(build){
    const report=snapshot.quality?.reports.find((report)=>report.buildId===build?.id&&report.evidence?.some((file)=>file.path==="boot.png")),file=report?.evidence?.find((file)=>file.path==="boot.png");
    const key=file?`${report.id}:${file.sha256}`:"";
    if(!key){captureKey="";el("capture").hidden=true;el("preview-empty").hidden=false;el("capture-label").textContent="";el("preview-empty").querySelector("p").textContent=build?"Build pronto para jogar. Execute uma verificação para obter uma captura.":"O preview estará disponível após um build.";return;}
    if(captureKey===key)return;captureKey=key;
    try{const result=await request({action:"capture",buildId:build.id,reportId:report.id,path:file.path});if(captureKey!==key)return;el("capture").src=`data:image/png;base64,${result.data}`;el("capture").hidden=false;el("preview-empty").hidden=true;el("capture-label").textContent=`Captura observada · revisão ${result.revision}`;}catch{if(captureKey===key)captureKey="";}
  }
  el("tabs").addEventListener("click",(event)=>{const next=event.target.closest("[data-tab]");if(next)switchTab(next.dataset.tab);});
  el("refresh").addEventListener("click",refresh);
  el("more-projects").addEventListener("click",()=>{projectCursor=snapshot.projects.cursor;return refresh();});
  el("build").addEventListener("click",()=>act({action:"build",expectedRevision:snapshot.project.revision,requestId:crypto.randomUUID()}));
  el("play").addEventListener("click",()=>act({action:"preview",buildId:newestBuild().id}));
  el("source-export").addEventListener("click",()=>act({action:"export-source",expectedRevision:snapshot.project.revision}));
  el("build-export").addEventListener("click",()=>act({action:"export-build",buildId:newestBuild().id}));
  el("more-assets").addEventListener("click",()=>{assetLimit+=30;renderAssets();});
  el("more-history").addEventListener("click",async()=>{const result=await act({action:"history",cursor:snapshot.history.cursor});if(result?.projectId!==snapshot.project.id)return;snapshot.history={...result,revisions:[...snapshot.history.revisions,...result.revisions]};renderHistory();});
  async function moreJobs(){const result=await act({action:"jobs",cursor:snapshot.jobs.cursor});if(result?.projectId!==snapshot.project.id)return;snapshot.jobs={...result,jobs:[...snapshot.jobs.jobs,...result.jobs]};renderJobs();renderCandidates();}
  el("more-jobs").addEventListener("click",moreJobs);el("more-candidates").addEventListener("click",moreJobs);
  el("close-candidate").addEventListener("click",clearCandidate);el("candidate-file").addEventListener("change",showCandidateFile);
  el("refresh-candidate").addEventListener("click",()=>{if(candidate)return openCandidate({id:candidate.result.jobId,projectId:candidate.projectId});});
  el("preview-model").addEventListener("click",()=>{if(candidate)return act({action:"preview-model",projectId:candidate.projectId,jobId:candidate.result.jobId,path:el("candidate-model").value});});
  el("export-candidate").addEventListener("click",()=>{if(candidate)return act({action:"export-asset",projectId:candidate.projectId,jobId:candidate.result.jobId});});
  el("apply-candidate").addEventListener("click",async()=>{if(!candidate)return;const inspected=candidate;const value=await act({action:"apply-asset",projectId:inspected.projectId,jobId:inspected.result.jobId,expectedRevision:inspected.expectedRevision,requestId:inspected.requestId});if(value?.project)renderCandidateState();});
  const fields=[["premise","Premissa"],["coreLoop.actions","Ações do jogador · uma por linha"],["coreLoop.feedback","Resposta às ações"],["coreLoop.mastery","O que o jogador aprende a dominar"],["camera","Câmera"],["progression.description","Progressão"],["art.direction","Direção de arte"],["art.animation","Animação"],["audio.music","Música"],["audio.effects","Efeitos sonoros"],["audio.mix","Mixagem"],["save.strategy","Save e recuperação"]];
  function renderDesignEditState(){
    if(!editing)return;const frozen=Boolean(designCommand),sameProject=editProjectId===snapshot?.project?.id,current=sameProject&&editRevision===snapshot.project.revision;
    for(const input of el("design-fields").querySelectorAll("textarea"))input.disabled=busy||frozen;
    const submit=el("design-form").querySelector('button[type="submit"]');submit.textContent=frozen?"Retomar pedido":"Salvar design";submit.disabled=!draftReady||busy||!sameProject||!frozen&&(!current||!snapshot?.canWrite);
    el("cancel-design").disabled=busy||frozen;
    el("design-edit-state").textContent=!current?`A edição pertence à revisão ${editRevision} do projeto original. Retomar confere primeiro o recibo preservado; uma alteração confirmada não será repetida.`:frozen?"Pedido preservado. Retome a mesma solicitação ou confira as revisões; uma recusa na retomada não apaga um efeito anterior.":"Ajustes locais; salvar pede confirmação e cria uma nova revisão.";
  }
  function showDesignEditor(values={}){
    el("design-form").hidden=false;el("design-content").hidden=true;
    el("design-fields").replaceChildren(...fields.map(([path,label],i)=>{const wrapper=node("div"),input=node("textarea"),name=`design-field-${i}`,value=path.split(".").reduce((value,key)=>value[key],editDesign);input.id=name;input.dataset.field=path;input.value=typeof values[path]==="string"?values[path]:Array.isArray(value)?value.join("\n"):value;input.required=true;input.maxLength=path==="coreLoop.actions"?9030:8000;input.rows=3;const title=node("label",label);title.htmlFor=name;wrapper.append(title,input);return wrapper;}));renderDesignEditState();
  }
  el("edit-design").addEventListener("click",()=>{
    if(editing){switchTab("design");return;}
    editing=true;editRevision=snapshot.project.revision;editProjectId=snapshot.project.id;editDesign=structuredClone(snapshot.revision.document.design);designRequestId=crypto.randomUUID();designCommand=null;
    showDesignEditor();saveLocalDraft();el("design-field-0").focus();
  });
  el("design-fields").addEventListener("input",saveLocalDraft);
  el("cancel-design").addEventListener("click",()=>{if(designCommand)return;editing=false;saveLocalDraft();el("design-form").hidden=true;el("design-content").hidden=false;render();});
  el("design-form").addEventListener("submit",async(event)=>{
    event.preventDefault();if(busy||!editing)return;const resuming=Boolean(designCommand);
    if(!designCommand){
      const design=structuredClone(editDesign);
      for(const input of el("design-fields").querySelectorAll("textarea")){const keys=input.dataset.field.split("."),key=keys.pop(),parent=keys.reduce((value,key)=>value[key],design);parent[key]=input.dataset.field==="coreLoop.actions"?input.value.split("\n").map((text)=>text.trim()).filter(Boolean):input.value.trim();}
      if(design.coreLoop.actions.length>30||design.coreLoop.actions.some((text)=>text.length>300)){notice("Use até 30 ações, com no máximo 300 caracteres por ação. Sua edição foi preservada.",true);return;}
      designCommand={action:"design",projectId:editProjectId,design,expectedRevision:editRevision,requestId:designRequestId};
    }
    renderDesignEditState();
    try{await persistDrafts();}catch{renderDesignEditState();return;}
    const result=await act(resuming?{...designCommand,action:"resume-design"}:designCommand);
    if(result?.project){editing=false;designCommand=null;saveLocalDraft();el("design-form").hidden=true;el("design-content").hidden=false;render();if(result.recoveredDesignCommit)notice(`Pedido confirmado na revisão ${result.recoveredDesignCommit.revision}. Nenhuma alteração foi repetida.`);}
    else if((result?.cancelled||result?.designEditRejected)&&!resuming){designCommand=null;saveLocalDraft();}
    renderDesignEditState();
  });
  function readPlaytestDraft(raw){
    const d=structuredClone(raw);
    if(d.schemaVersion!==1||!["create","record","withdraw","correct"].includes(d.kind)||![d.projectId,d.projectTitle,d.requestId].every(value=>typeof value==="string")||!d.values||typeof d.values!=="object"||Array.isArray(d.values))throw new Error("O playtest preservado precisa de recuperação; não será sobrescrito.");
    if(d.kind!=="create"&&(!d.study||typeof d.study.id!=="string"||typeof d.study.artifactHash!=="string"||typeof d.participantId!=="string"))throw new Error("O vínculo da rodada preservada é inválido.");
    if(d.command){const c=d.command,request=c.action==="create-playtest"?c:c.request;
      if(c.projectId!==d.projectId||request?.requestId!==d.requestId||c.action!==`${d.kind}-playtest`||d.kind!=="create"&&(request.studyId!==d.study.id||request.participantId!==d.participantId||c.artifactHash!==d.study.artifactHash))throw new Error("O pedido original do playtest foi preservado para conferência.");
      if(d.kind==="create"){d.buildId=c.buildId;d.values={title:c.title,audience:c.audience};}
      else if(d.kind==="withdraw")d.values={withdrawal:request.consentWithdrawalConfirmed};
      else{const answer=d.kind==="correct"?request.answers:request;if(!answer.environment||!Array.isArray(answer.environment.input))throw new Error("O ambiente do pedido preservado precisa de recuperação.");d.values={understood:answer.understoodWithoutHelp?"yes":"no",seconds:answer.actionSeconds===null?"":String(answer.actionSeconds),score:String(answer.experienceScore),
        platform:answer.environment.platform,device:answer.environment.device,browser:answer.environment.browser,input:[...answer.environment.input],notes:answer.notes??"",consent:answer.consentConfirmed,distinct:answer.distinctParticipantConfirmed,...(d.kind==="correct"?{reason:request.reason,correction:request.correctionConfirmed}:{})};if(d.kind==="correct")d.expectedResponseHash=request.expectedResponseHash;}}
    const v=d.values;
    if(d.kind==="create"){
      if(typeof d.buildId!=="string"||typeof v.title!=="string"||typeof v.audience!=="string")throw new Error("Os campos da rodada preservada são incompatíveis.");
    }else if(d.kind==="record"||d.kind==="correct"){
      if(!["","yes","no"].includes(v.understood)||!["seconds","score","platform","device","browser","notes"].every(key=>typeof v[key]==="string")||!Array.isArray(v.input)||v.input.length>4||!v.input.every(value=>["keyboard","pointer","touch","gamepad"].includes(value))||typeof v.consent!=="boolean"||typeof v.distinct!=="boolean")throw new Error("As observações preservadas precisam de recuperação.");
    }else if(typeof v.withdrawal!=="boolean")throw new Error("A confirmação preservada precisa de recuperação.");
    if(d.kind==="correct"&&(!/^[a-f0-9]{64}$/.test(d.expectedResponseHash)||typeof v.reason!=="string"||typeof v.correction!=="boolean"))throw new Error("A correção preservada precisa de recuperação.");
    return d;
  }
  async function loadPlaytests(append=false){
    if(busy||playtestLoading||!snapshot?.canManagePlaytests)return;
    const projectId=snapshot.project.id;playtestLoading=true;renderPlaytestState();
    try{const result=await act({action:"playtests",projectId,cursor:append?playtestPage?.cursor??0:0});
      if(result?.projectId===snapshot?.project?.id&&result.playtestStudies){playtestProjectId=projectId;const page=result.playtestStudies;
        playtestPage={...page,studies:append?[...(playtestPage?.studies??[]),...page.studies]:page.studies};renderPlaytests();}}
    finally{playtestLoading=false;renderPlaytestState();}
  }
  async function loadPlaytest(studyId,append=false){
    if(busy||playtestLoading)return;const projectId=snapshot.project.id;playtestLoading=true;renderPlaytestState();
    try{const result=await act({action:"playtest",projectId,studyId,cursor:append?playtestStudy?.cursor??0:0});
      if(result?.projectId===snapshot?.project?.id&&result.playtestStudy){const page=result.playtestStudy;
        playtestStudy={...page,responses:append&&playtestStudy?.study.id===studyId?[...playtestStudy.responses,...page.responses]:page.responses,updatedAt:Date.now()};
        playtestProjectId=projectId;playtestCorrectionHistory=null;el("playtest-correction-history").hidden=true;renderPlaytests();if(!append)el("playtest-title").focus();}}
    finally{playtestLoading=false;renderPlaytestState();}
  }
  async function loadPlaytestCorrections(participantId,append=false){
    if(busy||playtestLoading||!snapshot?.canCorrectPlaytests||!playtestStudy)return;
    const projectId=snapshot.project.id,studyId=playtestStudy.study.id;playtestLoading=true;renderPlaytestState();
    try{const result=await act({action:'playtest-corrections',projectId,studyId,participantId,cursor:append?playtestCorrectionHistory?.cursor??0:0});
      if(result?.projectId!==snapshot?.project?.id||studyId!==playtestStudy?.study.id||!result.playtestCorrections)return;
      const data=result.playtestCorrections;
      playtestCorrectionHistory={...data,entries:append&&!data.current.withdrawn&&playtestCorrectionHistory?.participantId===participantId?[...playtestCorrectionHistory.entries,...data.entries]:data.entries};
      const section=el('playtest-correction-history');section.hidden=false;el('playtest-correction-title').textContent=`Correções · código ${participantId.slice(0,8)}`;
      el('playtest-correction-entries').replaceChildren(...playtestCorrectionHistory.entries.map(entry=>{
        const item=node('article',undefined,'playtest-detail');item.append(node('h4',`Correção ${entry.sequence} · ${time(entry.correctedAt)}`));
        if(entry.withdrawn)item.append(node('p','Consentimento retirado. Respostas e motivo não estão mais disponíveis.'));
        else{item.append(node('p',`Motivo: ${entry.reason}`));for(const [label,value] of [['Antes',entry.before],['Depois',entry.after]]){
          item.append(node('p',`${label}: ${value.understoodWithoutHelp?`compreendeu sem ajuda em ${value.actionSeconds} s`:'não compreendeu sem ajuda'} · nota ${value.experienceScore}/5 · ${value.environment.platform} · ${value.environment.device} · ${value.environment.browser} · ${value.environment.input.map(input=>words[input]).join(', ')}`));
          if(value.notes)item.append(node('p',`${label}, observações: ${value.notes}`));}}
        return item;
      }));
      if(!playtestCorrectionHistory.entries.length)el('playtest-correction-entries').append(node('p','Nenhuma correção registrada.'));
      el('more-playtest-corrections').hidden=!data.hasMore;
      return playtestCorrectionHistory;
    }finally{playtestLoading=false;renderPlaytestState();}
  }
  async function startPlaytestCorrection(participantId){
    if(playtestDraft||!draftReady||!snapshot?.canWrite)return;
    const history=await loadPlaytestCorrections(participantId);
    if(!history||history.current.withdrawn||playtestDraft||!snapshot?.canWrite||!snapshot?.canCorrectPlaytests||playtestStudy?.study.id!==history.studyId)return;
    const value=history.current,project=snapshot.project;
    playtestDraft={schemaVersion:1,kind:'correct',projectId:project.id,projectTitle:project.title,requestId:crypto.randomUUID(),command:null,
      study:structuredClone(playtestStudy.study),participantId,expectedResponseHash:history.currentResponseHash,
      values:{understood:value.understoodWithoutHelp?'yes':'no',seconds:value.actionSeconds===null?'':String(value.actionSeconds),score:String(value.experienceScore),
        platform:value.environment.platform,device:value.environment.device,browser:value.environment.browser,input:[...value.environment.input],notes:value.notes,
        consent:false,distinct:false,reason:'',correction:false}};
    showPlaytestEditor();saveLocalDraft();
  }
  el('more-playtest-corrections').addEventListener('click',()=>{if(playtestCorrectionHistory)void loadPlaytestCorrections(playtestCorrectionHistory.participantId,true);});
  function renderPlaytests(){
    if(playtestProjectId&&playtestProjectId!==snapshot?.project?.id){playtestProjectId="";playtestPage=null;playtestStudy=null;playtestCorrectionHistory=null;el("playtest-correction-history").hidden=true;}
    el("playtest-list").replaceChildren(...(playtestPage?.studies??[]).map(value=>{const open=button("Abrir rodada",()=>loadPlaytest(value.study.id));open.dataset.playtestOpen="true";return row(value.study.title,`Revisão ${value.study.revision} · ${value.summary.active} registros ativos${value.stale?" · revisão anterior":""}`,[open]);}));
    if(!playtestPage?.studies.length)el("playtest-list").append(node("p",playtestPage?"Nenhuma rodada registrada para este projeto.":"Consulte as rodadas deste projeto para começar.","muted"));
    el("more-playtests").hidden=!playtestPage?.hasMore;el("playtest-detail").hidden=!playtestStudy;
    if(playtestStudy){const {study,summary}=playtestStudy;el("playtest-title").textContent=study.title;
      el("playtest-build").textContent=`Revisão ${study.revision}${playtestStudy.stale?` · o projeto já está na revisão ${snapshot.project.revision}`:""} · conferida em ${time(playtestStudy.updatedAt)}`;
      el("playtest-summary").textContent=`${summary.active} registros ativos · ${summary.understoodWithin30Seconds} compreenderam em até 30 s · ${summary.ratedAtLeastFour} deram nota 4 ou 5 · ${summary.withdrawn} retirados.`;
      el("playtest-source").textContent=summary.numericalTargetsMet?"Metas numéricas atingidas. São declarações do operador; a rodada e a qualidade ainda exigem revisão.":"Metas numéricas pendentes. São declarações do operador, não aprovação de qualidade.";
      el("playtest-responses").replaceChildren(...playtestStudy.responses.map(value=>{
        const detail=value.withdrawn?`Consentimento retirado em ${time(value.withdrawnAt)}`:`${value.understoodWithoutHelp?`Ação compreendida em ${value.actionSeconds} s`:"Não compreendeu sem ajuda"} · nota ${value.experienceScore}/5 · ${value.environment.device} · ${value.environment.input.map(input=>words[input]).join(", ")}`;
        const withdraw=value.withdrawn?null:button("Retirada de consentimento",()=>startPlaytest("withdraw",value));if(withdraw)withdraw.dataset.playtestWithdraw="true";
        const actions=withdraw?[withdraw]:[];if(snapshot.canCorrectPlaytests){const history=button("Histórico de correções",()=>loadPlaytestCorrections(value.participantId));history.dataset.playtestHistory="true";actions.push(history);if(!value.withdrawn){const correct=button("Corrigir registro",()=>startPlaytestCorrection(value.participantId));correct.dataset.playtestCorrect="true";actions.unshift(correct);}}
        const item=row(`Código ${value.participantId.slice(0,8)}`,detail,actions);
        if(!value.withdrawn&&value.notes){const notes=node("details"),text=node("p",value.notes);notes.append(node("summary","Ver observações"),text);item.firstChild.append(notes);}return item;
      }));
      if(!playtestStudy.responses.length)el("playtest-responses").append(node("p","Os registros consentidos aparecerão aqui.","muted"));
      el("more-playtest-responses").hidden=!playtestStudy.hasMore;
    }
    renderPlaytestState();
  }
  function renderPlaytestState(){
    const current=Boolean(snapshot?.canManagePlaytests),locked=busy||playtestLoading||playtestSubmitting;
    el("playtest-availability").textContent=current?"Os registros ficam neste produto e perfil; nada é enviado ao modelo.":"Este motor precisa de atualização para gerenciar playtests neste Studio.";
    el("new-playtest").disabled=locked||!draftReady||!current||!snapshot?.canWrite||Boolean(playtestDraft)||!newestBuild();
    for(const id of ["record-playtest","play-playtest","refresh-playtest","export-playtest-summary","export-playtest-records","more-playtests","more-playtest-responses"])el(id).disabled=locked||!current||id!=="more-playtests"&&!playtestStudy;
    el("record-playtest").disabled||=!draftReady||!snapshot?.canWrite||Boolean(playtestDraft);
    for(const id of ["export-playtest-summary","export-playtest-records"])el(id).disabled||=!snapshot?.canExportPlaytests;
    document.querySelectorAll("[data-playtest-open]").forEach(button=>{button.disabled=locked||!current;});
    document.querySelectorAll("[data-playtest-withdraw]").forEach(button=>{button.disabled=locked||!current||!draftReady||!snapshot?.canWrite||Boolean(playtestDraft);});
    document.querySelectorAll("[data-playtest-history]").forEach(button=>{button.disabled=locked||!snapshot?.canCorrectPlaytests;});
    document.querySelectorAll("[data-playtest-correct]").forEach(button=>{button.disabled=locked||!snapshot?.canCorrectPlaytests||!draftReady||!snapshot?.canWrite||Boolean(playtestDraft);});
    el("more-playtest-corrections").disabled=locked;
    if(!playtestDraft)return;const d=playtestDraft,same=d.projectId===snapshot?.project?.id,frozen=Boolean(d.command);
    el("playtest-fields").disabled=locked||frozen||!same||!snapshot?.canWrite;
    if(["record","correct"].includes(d.kind)&&el("pt-seconds"))el("pt-seconds").disabled=d.values.understood!=="yes";
    el("submit-playtest").disabled=locked||!draftReady||!current||!same||!frozen&&(!snapshot?.canWrite||d.kind==="correct"&&!snapshot?.canCorrectPlaytests);
    el("submit-playtest").textContent=frozen?"Retomar pedido":d.kind==="create"?"Criar rodada":d.kind==="record"?"Registrar observações":d.kind==="correct"?"Salvar correção":"Registrar retirada";
    el("cancel-playtest-edit").disabled=locked||frozen;
    el("playtest-edit-state").textContent=!same?"Este rascunho pertence a outro projeto. Volte a ele para conferir.":frozen?"Pedido preservado com seu conteúdo original. Retomar confere o recibo antes de qualquer gravação.":"Rascunho local. A gravação será confirmada também na janela do aplicativo.";
  }
  function startPlaytest(kind,response){
    if(busy||playtestLoading||playtestSubmitting||playtestDraft||!draftReady)return;
    const project=snapshot.project;
    playtestDraft={schemaVersion:1,kind,projectId:project.id,projectTitle:project.title,requestId:crypto.randomUUID(),command:null,
      values:kind==="create"?{title:"",audience:""}:kind==="record"?{understood:"",seconds:"",score:"",platform:"",device:"",browser:"",input:[],notes:"",consent:false,distinct:false}:{withdrawal:false}};
    if(kind==="create")playtestDraft.buildId=newestBuild()?.id;
    else{playtestDraft.study=structuredClone(playtestStudy.study);playtestDraft.participantId=response?.participantId??crypto.randomUUID();}
    showPlaytestEditor();saveLocalDraft();
  }
  function showPlaytestEditor(){
    const d=playtestDraft;if(!d)return;const v=d.values,fields=el("playtest-fields");fields.replaceChildren();el("playtest-form").hidden=false;
    el("playtest-form-title").textContent=d.kind==="create"?"Nova rodada":d.kind==="record"?"Observações de uma pessoa":d.kind==="correct"?"Corrigir observações":"Retirada de consentimento";
    el("playtest-form-origin").textContent=d.kind==="create"?d.projectTitle:`${d.study.title} · revisão ${d.study.revision} · código ${d.participantId}`;
    const changed=(key,value)=>{if(d.command||busy||playtestSubmitting)return;v[key]=value;if(key==="understood"&&value!=="yes"){v.seconds="";if(el("pt-seconds"))el("pt-seconds").value="";}saveLocalDraft();renderPlaytestState();};
    function field(key,label,{type="text",options,required=true,max=300}={}){
      const group=node("div",undefined,"image-field"),id=`pt-${key}`,input=options?node("select"):node(type==="textarea"?"textarea":"input");
      if(type==="textarea"||type==="checkbox")group.classList.add("playtest-wide");
      input.id=id;input.required=required;if(options){for(const [value,text] of options){const opt=node("option",text);opt.value=value;input.append(opt);}}else if(type!=="textarea")input.type=type;
      if(!options&&type!=="checkbox"){input.maxLength=max;if(type==="number"){input.min="0";input.max="3600";input.step="0.1";}}
      if(type==="checkbox"){input.checked=v[key]===true;const wrap=node("label",undefined,"playtest-check");wrap.htmlFor=id;wrap.append(input,node("span",label));group.append(wrap);}
      else{const title=node("label",label);title.htmlFor=id;input.value=v[key]??"";group.append(title,input);}
      input.addEventListener(type==="checkbox"||options?"change":"input",()=>changed(key,type==="checkbox"?input.checked:input.value));fields.append(group);return input;
    }
    if(d.kind==="create"){
      const group=node("div",undefined,"image-field"),label=node("label","Build da rodada"),select=node("select");label.htmlFor="pt-build";select.id="pt-build";select.required=true;
      const builds=snapshot.jobs.jobs.filter(job=>job.kind==="build"&&job.state==="completed");for(const job of builds){const option=node("option",`Revisão ${job.revision} · ${time(job.updatedAt)}`);option.value=job.id;select.append(option);}
      if(!builds.some(job=>job.id===d.buildId)){const option=node("option","Build preservado no rascunho");option.value=d.buildId;select.append(option);}select.value=d.buildId;
      select.addEventListener("change",()=>{if(!d.command){d.buildId=select.value;saveLocalDraft();}});group.append(label,select);fields.append(group);
      field("title","Nome da rodada",{max:200});field("audience","Público-alvo, sem nomes ou contatos",{type:"textarea",max:500});
    }else if(d.kind==="record"||d.kind==="correct"){
      field("understood","Compreendeu a ação principal sem ajuda?",{options:[["","Selecione"],["yes","Sim"],["no","Não"]]});field("seconds","Tempo observado até compreender (segundos)",{type:"number"});
      field("score","Nota da pessoa para a experiência",{options:[["","Selecione"],...Array.from({length:5},(_,index)=>[String(index+1),String(index+1)])]});
      field("platform","Sistema usado");field("device","Dispositivo usado");field("browser","Navegador e versão");
      const inputs=node("fieldset",undefined,"playtest-inputs");inputs.append(node("legend","Formas de entrada usadas"));
      for(const kind of ["keyboard","pointer","touch","gamepad"]){const label=node("label",undefined,"playtest-check"),input=node("input");input.type="checkbox";input.checked=v.input.includes(kind);input.id=`pt-input-${kind}`;input.addEventListener("change",()=>changed("input",[...inputs.querySelectorAll("input:checked")].map(item=>item.dataset.kind)));input.dataset.kind=kind;label.append(input,node("span",words[kind]));inputs.append(label);}fields.append(inputs);
      field("notes","Observações, sem dados identificáveis",{type:"textarea",required:false,max:2000});
      field("consent","O consentimento para registrar estas observações foi confirmado.",{type:"checkbox"});field("distinct",d.kind==="correct"?"Confirmei que este código representa uma pessoa distinta nesta rodada.":"Esta pessoa ainda não participou desta rodada.",{type:"checkbox"});
      if(d.kind==="correct"){field("reason","Motivo da correção, sem dados identificáveis",{type:"textarea",max:1000});field("correction","Conferi as observações da sessão. Esta é uma correção do mesmo registro, sem novo participante.",{type:"checkbox"});}
    }else{
      fields.append(node("p","Use esta ação quando o consentimento desta pessoa for retirado. Respostas e notas deixarão o registro consultável; cópias já exportadas não serão apagadas."));
      field("withdrawal","Confirmo que o consentimento desta pessoa foi retirado.",{type:"checkbox"});
    }
    renderPlaytestState();el("playtest-form-title").focus();
  }
  function playtestCommand(d){
    const v=d.values;
    if(d.kind==="create")return {action:"create-playtest",projectId:d.projectId,requestId:d.requestId,buildId:d.buildId,title:v.title,audience:v.audience};
    if(d.kind==="withdraw")return {action:"withdraw-playtest",projectId:d.projectId,artifactHash:d.study.artifactHash,request:{requestId:d.requestId,studyId:d.study.id,participantId:d.participantId,consentWithdrawalConfirmed:v.withdrawal}};
    if(!v.input.length)throw new Error("Informe pelo menos uma forma de entrada usada.");
    const answers={consentConfirmed:v.consent,distinctParticipantConfirmed:v.distinct,understoodWithoutHelp:v.understood==="yes",actionSeconds:v.understood==="yes"?Number(v.seconds):null,experienceScore:Number(v.score),environment:{platform:v.platform,device:v.device,browser:v.browser,input:[...v.input]},notes:v.notes};
    return {action:`${d.kind}-playtest`,projectId:d.projectId,artifactHash:d.study.artifactHash,request:{requestId:d.requestId,studyId:d.study.id,participantId:d.participantId,...(d.kind==="correct"?{expectedResponseHash:d.expectedResponseHash,reason:v.reason,correctionConfirmed:v.correction,answers}:answers)}};
  }
  el("new-playtest").addEventListener("click",()=>startPlaytest("create"));
  el("record-playtest").addEventListener("click",()=>startPlaytest("record"));
  el("more-playtests").addEventListener("click",()=>loadPlaytests(true));
  el("more-playtest-responses").addEventListener("click",()=>loadPlaytest(playtestStudy.study.id,true));
  el("refresh-playtest").addEventListener("click",()=>loadPlaytest(playtestStudy.study.id));
  el("play-playtest").addEventListener("click",()=>act({action:"preview",buildId:playtestStudy.study.buildId}));
  for(const [id,includeResponses] of [["export-playtest-summary",false],["export-playtest-records",true]])el(id).addEventListener("click",()=>act({action:"export-playtest",studyId:playtestStudy.study.id,includeResponses}));
  el("cancel-playtest-edit").addEventListener("click",()=>{if(playtestDraft?.command||busy||playtestSubmitting)return;playtestDraft=null;el("playtest-form").hidden=true;saveLocalDraft();renderPlaytestState();});
  el("playtest-form").addEventListener("submit",async event=>{
    event.preventDefault();if(busy||playtestSubmitting||!playtestDraft)return;const d=playtestDraft,resuming=Boolean(d.command);
    if(!resuming&&!el("playtest-form").reportValidity())return;
    try{if(!d.command)d.command=playtestCommand(d);}catch(error){notice(error.message,true);return;}
    playtestSubmitting=true;renderPlaytestState();
    try{
      try{await persistDrafts();}catch{if(!resuming)d.command=null;notice("Não foi possível preservar o pedido. Nenhuma nova gravação foi enviada.",true);return;}
      const value=await act(resuming?{action:"resume-playtest",projectId:d.projectId,command:d.command}:d.command);if(playtestDraft!==d)return;
      if(value?.playtestMutationAcknowledged){playtestDraft=null;el("playtest-form").hidden=true;await persistDrafts();
        playtestPage=null;playtestProjectId="";await loadPlaytests();await loadPlaytest(value.studyId);notice(value.withdrawn?"Retirada confirmada; as respostas não foram recriadas.":"Pedido confirmado na rodada selecionada.");}
      else if((value?.cancelled||value?.playtestEditRejected)&&!resuming){d.command=null;saveLocalDraft();}
    }catch(error){notice(error.message,true);}finally{playtestSubmitting=false;renderPlaytestState();}
  });
  setInterval(()=>{
    const localForm=Boolean(restoreDraft)||tab==='overview'&&deliveryDraft&&!deliveryDraft.command||tab==="history"&&Boolean(document.activeElement?.closest("#comparison-form"))||editing&&!el("design").hidden||!el("assets").hidden&&(
      imageEdit&&!imageEdit.command||audioEncodeDraft&&!audioEncodeDraft.command||libraryDraft&&!libraryDraft.command&&!el("library-import").hidden&&!el("library-browser").hidden);
    // Do not disable focused form controls every polling interval. An explicit
    // refresh/submission still rechecks selection, revision and permissions;
    // frozen requests and the jobs view may continue to receive updates.
    if(!document.hidden&&!busy&&!localForm&&!(playtestDraft&&!playtestDraft.command&&tab==="playtests"))void refresh(true);
  },5000);
  void initializeDrafts();
})();
