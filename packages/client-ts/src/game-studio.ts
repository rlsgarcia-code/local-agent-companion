import {gameAudioAnalysis,audioAnalysisPath} from "../../contracts/src/game-audio-analysis";
import type { AgentClient } from "./index";
import { gameStudioCommand } from "../../contracts/src/game-studio";
import { gameRevisionCommit,type GameProject,type GameRevision } from "../../contracts/src/games";
import type { GameArtifact,GameProductionJob } from "../../contracts/src/game-production";
import { assetFingerprint, type GameAssetResult } from "../../contracts/src/game-assets";
import {assetOutputPaths,assetSourceInputs} from "../../contracts/src/game-assets";
import {gameFileTreeConflict} from "../../contracts/src/games";
import {contentHash} from "../../contracts/src/identity";
import {modelSources} from "../../contracts/src/game-models";
import { gamePlaytestCreate, gamePlaytestRecord, gamePlaytestWithdraw,gamePlaytestCorrect } from "../../contracts/src/game-playtests";
import { AgentError, errors } from "../../contracts/src/index";
import {createHash} from "node:crypto";
import {gameWebProjectConfig} from '../../contracts/src/game-web-compiler';

class ImageAdjustmentRejection extends Error {}
class AudioEncodeRejection extends Error {}
class DeliveryEditRejection extends Error {}
class LibraryImportRejection extends Error {}
class DesignEditRejection extends Error {}
class RestoreRejection extends Error {}
class PlaytestEditRejection extends Error {}
const designCommitMessage="Design edited in Game Studio";
const deliveryCommitMessage="Web delivery selection edited in Game Studio";
const isVectorPreview=(result:GameAssetResult,file:{path:string;mime:string;sha256:string})=>result.processorId==="local-media-v1"&&result.spec.operation.type==="image.vector"&&file.path===result.spec.operation.output&&file.mime==="image/svg+xml"&&result.files.some(entry=>entry.path===file.path&&entry.sha256===file.sha256&&entry.mime===file.mime);

export type GameStudioHost={
  canWrite():boolean;
  approve(message:string):Promise<boolean>;
  preview(artifact:GameArtifact,readFile:(name:string)=>Promise<Buffer>):Promise<void>;
  previewModel?(result:GameAssetResult,path:string,readFile:(name:string)=>Promise<Buffer>):Promise<void>;
  exportSource(projectId:string,revision:number):Promise<boolean>;
  exportBuild(artifact:GameArtifact):Promise<boolean>;
  exportAsset(jobId:string):Promise<boolean>;
  exportPlaytest?(studyId:string,includeResponses:boolean):Promise<boolean>;
};

/** Host-side UI coordinator. Intelligence, state and effects remain in the service. */
export class GameStudioController {
  private busy=false;
  private capabilityQuery?:ReturnType<AgentClient["gameProductionCapabilities"]>;
  private capabilityAt=0;
  private async playtestSupport(){try{return (await this.client.call<{capabilities:string[]}>("engine.info")).capabilities.includes("game-playtest-studio-v1");}catch{return false;}}
  private async correctionSupport(){try{return (await this.client.call<{capabilities:string[]}>('engine.info')).capabilities.includes('game-playtest-corrections-v1');}catch{return false;}}
  private async pngSupport(){try{return (await this.client.call<{capabilities:string[]}>("engine.info")).capabilities.includes("game-png-lossless-v1");}catch{return false;}}
  private async audioAnalysisSupport(){try{return (await this.client.call<{capabilities:string[]}>("engine.info")).capabilities.includes("game-audio-analysis-v1");}catch{return false;}}
  private async audioEncodeSupport(){try{return (await this.client.call<{capabilities:string[]}>('engine.info')).capabilities.includes('game-asset-request-inspection-v1');}catch{return false;}}
  private async deliverySupport(){try{return (await this.client.call<{capabilities:string[]}>('engine.info')).capabilities.includes('game-web-delivery-v1');}catch{return false;}}
  private async readDelivery(projectId:string,revision?:number){
    const original=await this.client.getGameRevision(projectId,revision);
    if(!['phaser','babylon'].includes(original.document.engine))throw new DeliveryEditRejection('A seleção de recursos está disponível para projetos Phaser e Babylon.');
    const file=original.document.files.find(file=>file.path==='game.web.json');
    if(!file||file.size>8*1024*1024)throw new DeliveryEditRejection('A configuração web está ausente ou excede 8 MiB. O original foi preservado.');
    const bytes=await this.client.downloadGameFile(projectId,file.path,original.revision);
    if(bytes.length!==file.size||createHash('sha256').update(bytes).digest('hex')!==file.sha256)throw new DeliveryEditRejection('A configuração não corresponde à revisão original. Atualize antes de continuar.');
    let raw:unknown;try{raw=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));}catch{throw new DeliveryEditRejection('A configuração web não contém JSON UTF-8 válido. O original foi preservado.');}
    const settings=gameWebProjectConfig.safeParse(raw);
    if(!settings.success)throw new DeliveryEditRejection('A configuração web contém campos incompatíveis. Nenhum deles foi descartado.');
    const resources=original.document.files.filter(file=>(file.path.startsWith('assets/')||file.path.startsWith('data/'))&&!/\.blend[0-9]*$/i.test(file.path));
    return {original,file,settings:settings.data,resources};
  }
  constructor(private readonly client:AgentClient,private readonly sessionId:string,private readonly host:GameStudioHost){}
  private capabilities(){
    if(!this.capabilityQuery||Date.now()-this.capabilityAt>30000){this.capabilityAt=Date.now();this.capabilityQuery=this.client.gameProductionCapabilities();this.capabilityQuery.catch(()=>{this.capabilityQuery=undefined;});}
    return this.capabilityQuery;
  }
  private async selected():Promise<GameProject>{const project=await this.client.linkedGameProject(this.sessionId);if(!project)throw new Error("Selecione um projeto de jogo nesta conversa.");return project;}
  private async job(id:string):Promise<GameProductionJob>{const project=await this.selected(),job=await this.client.getGameProduction(id);if(job.projectId!==project.id)throw new Error("O trabalho pertence a outro projeto. Atualize a seleção.");return job;}
  private write(){if(!this.host.canWrite())throw new Error("Ative um modo de edição em um projeto confiável antes de alterar o jogo.");}
  async snapshot(cursor=0){
    const [projects,selected,capabilities]=await Promise.all([this.client.listGameProjects(cursor,30),this.client.linkedGameProject(this.sessionId),this.capabilities()]);
    const [canManagePlaytests,canCorrectPlaytests,canOptimizePng,canAnalyzeAudio,canEncodeAudio,canChooseDelivery]=await Promise.all([this.playtestSupport(),this.correctionSupport(),this.pngSupport(),this.audioAnalysisSupport(),this.audioEncodeSupport(),this.deliverySupport()]);
    if(!selected)return {projects,project:null,capabilities,canWrite:this.host.canWrite(),canPreviewModels:Boolean(this.host.previewModel),canManagePlaytests,canCorrectPlaytests,canOptimizePng,canAnalyzeAudio,canEncodeAudio,canChooseDelivery,canExportPlaytests:Boolean(this.host.exportPlaytest),updatedAt:Date.now()};
    const [revision,history,jobs,quality,workflow,inference]=await Promise.all([this.client.getGameRevision(selected.id),this.client.listGameRevisions(selected.id,0,30,"desc"),this.client.listGameProduction(selected.id,0,30,"desc"),this.client.getGameQuality(selected.id),this.client.getGameWorkflow(selected.id),this.client.getInferenceBudgets(this.sessionId)]);
    // The immutable revision is the display's source of truth if another client
    // commits during these independent reads. Never label older evidence current.
    return {projects,project:{...selected,title:revision.document.title,revision:revision.revision,contentHash:revision.contentHash},revision,history,jobs,quality,workflow,inference,capabilities,canWrite:this.host.canWrite(),canPreviewModels:Boolean(this.host.previewModel),canManagePlaytests,canCorrectPlaytests,canOptimizePng,canAnalyzeAudio,canEncodeAudio,canChooseDelivery,canExportPlaytests:Boolean(this.host.exportPlaytest),updatedAt:Date.now()};
  }
  async dispatch(input:unknown):Promise<unknown>{
    const parsed=gameStudioCommand.safeParse(input);
    if(!parsed.success){
      if(input&&typeof input==='object'&&['delivery-settings','set-delivery','resume-delivery'].includes(String((input as {action?:unknown}).action)))return {deliveryEditRejected:true,message:'Confira os arquivos e o vínculo da configuração original. Nenhuma nova revisão foi enviada.'};
      if(input&&typeof input==='object'&&['encode-audio','resume-encode-audio'].includes(String((input as {action?:unknown}).action)))return {audioEncodeRejected:true,message:'Confira a fonte, o nome, a saída e as qualidades do áudio. Nenhum novo processamento foi enviado.'};
      // Known rejection of this invocation only; never settles a lost prior
      // submission bearing the same ID. Do not echo recipe/markup values.
      if(input&&typeof input==="object"&&(input as {action?:unknown}).action==="adjust-vector")return {imageAdjustmentRejected:true,message:"Os ajustes vetoriais contêm valores inválidos. Confira dimensões, cores, curvas e a ordem dos pontos do gradiente."};
      if(input&&typeof input==="object"&&(input as {action?:unknown}).action==="adjust-audio")return {imageAdjustmentRejected:true,message:"Os ajustes de áudio contêm valores inválidos. Confira duração, notas, faixas e envelopes; nenhum novo processamento foi enviado."};
      if(input&&typeof input==="object"&&(input as {action?:unknown}).action==="adjust-model")return {imageAdjustmentRejected:true,message:"Os ajustes 3D contêm valores inválidos. Confira pesos, referências de ossos, transformações e chaves; nenhum novo processamento foi enviado."};
      if(input&&typeof input==="object"&&(input as {action?:unknown}).action==="import-library")return {libraryImportRejected:true,message:"Confira o recurso, o nome e a pasta do projeto antes de preparar o candidato."};
      if(input&&typeof input==="object"&&["design","resume-design"].includes(String((input as {action?:unknown}).action)))return {designEditRejected:true,message:"O design contém valores inválidos. Seus ajustes locais foram preservados; nenhum novo pedido foi enviado."};
      if(input&&typeof input==="object"&&["create-playtest","record-playtest","withdraw-playtest","correct-playtest","resume-playtest"].includes(String((input as {action?:unknown}).action)))return {playtestEditRejected:true,message:"Confira os campos e as confirmações do playtest. O pedido anterior foi preservado; nenhuma nova gravação foi enviada."};
      throw parsed.error;
    }
    const command=parsed.data;
    if(command.action==="refresh")return this.snapshot(command.projectCursor);
    if(this.busy)throw new Error("Aguarde a operação atual do projeto.");
    this.busy=true;
    try{
      if(command.action==="select"){await this.client.selectGameProject(this.sessionId,command.projectId);return this.snapshot();}
      const project=await this.selected();
      if(command.projectId!==project.id){
        if(['delivery-settings','set-delivery','resume-delivery'].includes(command.action))return {deliveryEditRejected:true,message:'O projeto selecionado mudou. Volte ao projeto original para conferir os recursos preservados.'};
        if(command.action==='encode-audio'||command.action==='resume-encode-audio')return {audioEncodeRejected:true,message:'O projeto selecionado mudou. Volte ao original para conferir as variantes preservadas.'};
        if(command.action==="import-library")return {libraryImportRejected:true,message:"O projeto selecionado mudou em outra janela. Confira a importação antes de continuar."};
        if(command.action==="design"||command.action==="resume-design")return {designEditRejected:true,message:"O projeto selecionado mudou em outra janela. Confira o design original antes de continuar."};
        if(["create-playtest","record-playtest","withdraw-playtest","correct-playtest","resume-playtest"].includes(command.action))return {playtestEditRejected:true,message:"O projeto selecionado mudou. Selecione o projeto original para conferir o playtest preservado."};
        throw new Error("O projeto selecionado mudou em outra janela. Atualize antes de continuar.");
      }
      if(command.action==='delivery-settings'||command.action==='set-delivery'||command.action==='resume-delivery'){
        try{
          if(command.action==='delivery-settings'){
            if(!await this.deliverySupport())throw new DeliveryEditRejection('Atualize o motor para escolher recursos neste Studio.');
            const read=await this.readDelivery(project.id,command.revision);
            if((await this.selected()).id!==project.id)throw new DeliveryEditRejection('O projeto selecionado mudou durante a leitura.');
            return {deliverySettings:{projectId:project.id,projectTitle:read.original.document.title,revision:read.original.revision,configSha256:read.file.sha256,delivery:read.settings.delivery??null,
              files:read.resources.map(({path,size,sha256,mime})=>({path,size,sha256,mime}))}};
          }
          const read=await this.readDelivery(project.id,command.expectedRevision);
          if(read.file.sha256!==command.configSha256)throw new DeliveryEditRejection('O hash da configuração não corresponde à revisão original.');
          const available=new Set(read.resources.map(file=>file.path));
          if(command.delivery?.files.some(file=>!available.has(file)))throw new DeliveryEditRejection('Um arquivo selecionado não existe na revisão original.');
          const {delivery:_previous,...base}=read.settings;
          const bytes=Buffer.from(JSON.stringify({...base,...(command.delivery?{delivery:command.delivery}:{})},null,2)+'\n');
          if(bytes.length>8*1024*1024)throw new DeliveryEditRejection('A nova configuração excede 8 MiB. O original foi preservado.');
          const hash=createHash('sha256').update(bytes).digest('hex');
          const document=(file:typeof read.file)=>({...read.original.document,files:read.original.document.files.map(original=>original.path===file.path?file:original)});
          if(command.action==='resume-delivery'){
            const engine=await this.client.call<{capabilities:string[]}>('engine.info');
            if(!engine.capabilities.includes('game-mutation-inspection-v1'))throw new DeliveryEditRejection('Este motor não pode conferir o recibo anterior. O pedido foi preservado, sem repetição.');
            const receipt=await this.client.inspectGameMutation(project.id,command.requestId);
            if(receipt.state==='acknowledged'){
              const acknowledged=await this.client.getGameRevision(project.id,receipt.revision),file=acknowledged.document.files.find(file=>file.path==='game.web.json');
              if(receipt.revision!==command.expectedRevision+1||acknowledged.contentHash!==receipt.contentHash||!file||file.sha256!==hash||file.size!==bytes.length||file.mime!=='application/json')throw new DeliveryEditRejection('O recibo não corresponde à configuração preservada. Nenhuma alteração foi repetida.');
              const binding=contentHash({method:'commit',...gameRevisionCommit.parse({projectId:project.id,requestId:command.requestId,expectedRevision:command.expectedRevision,document:document(file),message:deliveryCommitMessage})});
              if(receipt.bindingHash!==binding)throw new DeliveryEditRejection('O recibo pertence a outro conteúdo. Confira as revisões originais.');
              if((await this.selected()).id!==project.id)throw new DeliveryEditRejection('O projeto selecionado mudou durante a conferência.');
              return {...await this.snapshot(),deliveryMutationAcknowledged:true,recoveredDeliveryCommit:{revision:receipt.revision,contentHash:receipt.contentHash}};
            }
            // Missing never settles an earlier unknown commit. Retry only the
            // same immutable command through fresh consent and normal CAS.
          }
          const check=async()=>{
            if(!await this.deliverySupport())throw new DeliveryEditRejection('Atualize o motor antes de alterar os recursos. O pedido original foi preservado.');
            if(!this.host.canWrite())throw new DeliveryEditRejection('Ative um modo de edição em um projeto confiável antes de salvar.');
            const current=await this.selected();if(current.id!==project.id||current.revision!==command.expectedRevision)throw new DeliveryEditRejection('A revisão ou o projeto mudou. Confira o pedido original antes de continuar.');
          };
          await check();
          if(!await this.host.approve(`Salvar os recursos de distribuição de “${project.title}”? ${command.delivery?`${command.delivery.files.length} arquivos pedidos; avisos e metadados registrados serão conservados.`:'Todos os recursos voltarão ao build.'} Os originais permanecem no projeto. Gerar build continua sendo uma ação separada.`))return {cancelled:true};
          await check();const file=await this.client.uploadGameFile('game.web.json',bytes,'application/json');await check();
          if(file.sha256!==hash||file.size!==bytes.length)throw new DeliveryEditRejection('A transferência não corresponde à configuração confirmada.');
          await this.client.commitGameRevision(project.id,command.requestId,command.expectedRevision,document(file),deliveryCommitMessage);
          return {...await this.snapshot(),deliveryMutationAcknowledged:true};
        }catch(error){if(error instanceof DeliveryEditRejection||error instanceof AgentError&&[errors.invalid,errors.conflict,errors.missing,errors.forbidden].some(code=>code===error.code))return {deliveryEditRejected:true,message:error.message};throw error;}
      }
      if(["playtests","playtest","playtest-corrections","export-playtest","create-playtest","record-playtest","withdraw-playtest","correct-playtest","resume-playtest"].includes(command.action)){
        try{
          if(!await this.playtestSupport())throw new PlaytestEditRejection("Atualize o motor para usar os playtests neste Studio. Os dados locais continuam preservados.");
          const check=async(writable=false)=>{if(writable&&!this.host.canWrite())throw new PlaytestEditRejection("Ative um modo de edição em um projeto confiável antes de registrar observações.");
            if((await this.selected()).id!==project.id)throw new PlaytestEditRejection("O projeto selecionado mudou. Confira a rodada original antes de continuar.");};
          const readStudy=async(studyId:string,artifactHash?:string)=>{const result=await this.client.getGamePlaytest(studyId);
            if(result.study.projectId!==project.id||artifactHash&&result.study.artifactHash!==artifactHash)throw new PlaytestEditRejection("A rodada preservada pertence a outro projeto ou build.");return result;};
          if(command.action==="playtests")return {projectId:project.id,playtestStudies:await this.client.listGamePlaytests(project.id,command.cursor)};
          if(command.action==="playtest"){
            await readStudy(command.studyId);return {projectId:project.id,playtestStudy:await this.client.getGamePlaytest(command.studyId,command.cursor)};
          }
          if(command.action==='playtest-corrections'){
            if(!await this.correctionSupport())throw new PlaytestEditRejection('Atualize o motor para consultar correções; os registros anteriores foram preservados.');
            await readStudy(command.studyId);const history=await this.client.getGamePlaytestCorrections(command.studyId,command.participantId,command.cursor);
            await check();return {projectId:project.id,playtestCorrections:history};
          }
          if(command.action==="export-playtest"){
            const result=await readStudy(command.studyId);if(!this.host.exportPlaytest)throw new PlaytestEditRejection("Este cliente precisa de atualização para exportar playtests.");
            if(!await this.host.approve(`Exportar ${command.includeResponses?"o resumo e os registros individuais, incluindo notas e códigos":"somente o resumo, sem registros individuais"} de “${result.study.title}”, revisão ${result.study.revision}, para uma pasta local? Esses dados não certificam qualidade.`))return {cancelled:true};
            await check();await readStudy(command.studyId,result.study.artifactHash);
            return {exported:await this.host.exportPlaytest(command.studyId,command.includeResponses)};
          }
          if(command.action==="create-playtest"||command.action==="record-playtest"||command.action==="withdraw-playtest"||command.action==="correct-playtest"||command.action==="resume-playtest"){
            const mutation=command.action==="resume-playtest"?command.command:command;
            if(mutation.projectId!==project.id)throw new PlaytestEditRejection("O pedido preservado pertence a outro projeto.");
            const kind=mutation.action==="create-playtest"?"create":mutation.action==="record-playtest"?"record":mutation.action==="correct-playtest"?"correct":"withdraw";
            const request=mutation.action==="create-playtest"?gamePlaytestCreate.parse({requestId:mutation.requestId,buildId:mutation.buildId,title:mutation.title,audience:mutation.audience}):mutation.request;
            if(command.action==="resume-playtest"){
              const receipt=await this.client.inspectGamePlaytest(request.requestId);
              if(receipt.state==="acknowledged"){
                if(receipt.bindingHash!==contentHash({kind,input:request}))throw new PlaytestEditRejection("O recibo pertence a outro conteúdo. O pedido original foi preservado para conferência.");
                const current=await readStudy(receipt.studyId,mutation.action==="create-playtest"?undefined:mutation.artifactHash);
                if(mutation.action==="create-playtest"?current.study.buildId!==mutation.buildId:
                  receipt.studyId!==mutation.request.studyId||receipt.participantId!==mutation.request.participantId)
                  throw new PlaytestEditRejection("O recibo não corresponde à rodada ou pessoa do pedido original.");
                return {playtestMutationAcknowledged:true,studyId:receipt.studyId,withdrawn:receipt.withdrawn??false,recovered:true};
              }
              // Missing is not proof of no prior effect; only this exact frozen
              // request may enter normal permission/consent and server replay.
            }
            if(mutation.action==='correct-playtest'&&!await this.correctionSupport())throw new PlaytestEditRejection('Atualize o motor para corrigir observações. O pedido preservado não foi enviado novamente.');
            await check(true);
            if(mutation.action==="create-playtest"){
              const artifact=await this.client.getGameArtifact(mutation.buildId);
              if(artifact.projectId!==project.id)throw new PlaytestEditRejection("O build pertence a outro projeto.");
              if(!await this.host.approve(`Criar a rodada “${mutation.title}” para “${project.title}”, build da revisão ${artifact.revision}? Registre apenas observações consentidas, sem nomes ou contatos.`))return {cancelled:true};
              await check(true);
              const study=await this.client.createGamePlaytest(gamePlaytestCreate.parse(request));
              return {playtestMutationAcknowledged:true,studyId:study.id,withdrawn:false};
            }
            const current=await readStudy(mutation.request.studyId,mutation.artifactHash);
            const prompt=mutation.action==="record-playtest"?`Registrar as observações consentidas do código ${mutation.request.participantId.slice(0,8)} na rodada “${current.study.title}”, revisão ${current.study.revision}? Os dados ficam neste produto e não são enviados ao modelo.`:
              mutation.action==='correct-playtest'?`Corrigir as observações do código ${mutation.request.participantId.slice(0,8)} na rodada “${current.study.title}”? Os valores anteriores e o motivo ficarão no histórico; o registro continuará contando uma única pessoa. Não use correção para substituir uma nova rodada ou uma retirada de consentimento.`:
              `Registrar a retirada do consentimento do código ${mutation.request.participantId.slice(0,8)} na rodada “${current.study.title}”? As respostas deixarão o registro consultável; a retirada continuará no histórico.`;
            if(!await this.host.approve(prompt))return {cancelled:true};
            await check(true);await readStudy(mutation.request.studyId,mutation.artifactHash);
            const response=mutation.action==="record-playtest"?await this.client.recordGamePlaytest(gamePlaytestRecord.parse(request)):
              mutation.action==='correct-playtest'?await this.client.correctGamePlaytest(gamePlaytestCorrect.parse(request)):
              await this.client.withdrawGamePlaytest(gamePlaytestWithdraw.parse(request));
            return {playtestMutationAcknowledged:true,studyId:response.studyId,withdrawn:response.withdrawn};
          }
        }catch(error){if(error instanceof PlaytestEditRejection||error instanceof AgentError&&[errors.invalid,errors.conflict,errors.missing,errors.forbidden].some(code=>code===error.code))return {playtestEditRejected:true,message:error.message};throw error;}
      }
      if(command.action==='encode-audio'||command.action==='resume-encode-audio'){
        const request=command.action==='resume-encode-audio'?command.command:command;
        try{
          if(request.projectId!==project.id)throw new AudioEncodeRejection('O pedido preservado pertence a outro projeto.');
          if(!(await this.client.call<{capabilities:string[]}>('engine.info')).capabilities.includes('game-asset-request-inspection-v1'))throw new AudioEncodeRejection('Atualize o motor para preparar e recuperar variantes de áudio. O rascunho foi preservado.');
          const original=await this.client.getGameRevision(project.id,request.expectedRevision),source=original.document.files.find(file=>file.path===request.spec.operation.source.path);
          try{assetSourceInputs(original.document,request.spec);}catch{throw new AudioEncodeRejection('A fonte precisa ser um WAV registrado no asset desta revisão.');}
          if(!source||source.sha256!==request.sourceSha256)throw new AudioEncodeRejection('Os bytes da fonte mudaram. Confira o WAV original antes de processar.');
          if(command.action==='resume-encode-audio'){
            const inspected=await this.client.inspectGameAssetRequest(request.requestId,project.id,request.expectedRevision,request.spec);
            if(inspected.state==='acknowledged'){
              const job=await this.client.getGameProduction(inspected.jobId);
              if(job.kind!=='assets'||job.projectId!==project.id||job.revision!==request.expectedRevision||job.sourceHash!==original.contentHash||job.adapterId!==request.spec.processorId||contentHash(job.assetSpec)!==contentHash(request.spec))throw new Error('O trabalho não corresponde ao pedido preservado; ele não será descartado.');
              if((await this.selected()).id!==project.id)throw new AudioEncodeRejection('A seleção mudou durante a consulta. Volte ao projeto original.');
              return {...await this.snapshot(),requestedAssetJobId:job.id,assetRequestAcknowledged:true};
            }
          }
          const check=async()=>{
            if(!this.host.canWrite())throw new AudioEncodeRejection('Ative um modo de edição em um projeto confiável antes de processar áudio.');
            const selected=await this.selected();if(selected.id!==project.id||selected.revision!==request.expectedRevision)throw new AudioEncodeRejection('A revisão mudou. Um pedido não localizado continua preservado; não será reenviado sobre outra versão.');
            if(original.document.assets.some(asset=>asset.id===request.spec.target.id))throw new AudioEncodeRejection('Escolha um novo recurso para preservar o master e as variantes anteriores.');
            const outputs=assetOutputPaths(request.spec.operation);if(outputs.some(name=>original.document.files.some(file=>file.path===name))||gameFileTreeConflict([...original.document.files.map(file=>file.path),...outputs]))throw new AudioEncodeRejection('A saída conflita com arquivos do projeto. Escolha outro nome; os originais serão preservados.');
            if(!(await this.client.gameProductionCapabilities()).assetProcessors?.some(processor=>processor.id===request.spec.processorId&&processor.available&&processor.operations.includes('audio.encode')))throw new AudioEncodeRejection('O codificador isolado não está disponível. O pedido continua preservado.');
          };
          await check();
          if(!await this.host.approve(`Preparar ${request.spec.operation.variants.length} variante(s) de áudio para “${request.spec.target.role}” em “${project.title}”, revisão ${request.expectedRevision}? O WAV original será preservado; aplicar o candidato é uma ação separada.`))return {cancelled:true};
          await check();
        }catch(error){if(error instanceof AudioEncodeRejection)return {audioEncodeRejected:true,message:error.message};throw error;}
        const job=await this.client.processGameAsset(request.requestId,project.id,request.expectedRevision,request.spec);
        return {...await this.snapshot(),requestedAssetJobId:job.id,assetRequestAcknowledged:true};
      }
      if(command.action==="libraries")return {projectId:project.id,query:command.query,...await this.client.listGameLibraries(command.query)};
      if(command.action==="import-library"){
        try{
          const writable=()=>{if(!this.host.canWrite())throw new LibraryImportRejection("Ative um modo de edição em um projeto confiável antes de preparar o recurso.");};
          const check=async()=>{
            writable();const current=await this.selected();
            if(current.id!==project.id||current.revision!==command.expectedRevision)throw new LibraryImportRejection("O projeto ou a revisão mudou. Confira a biblioteca antes de preparar o recurso.");
            const revision=await this.client.getGameRevision(project.id,command.expectedRevision);
            if(revision.document.assets.some(asset=>asset.id===command.spec.target.id))throw new LibraryImportRejection("Esse recurso já existe no projeto. Confira seus assets antes de preparar outra cópia.");
            if(gameFileTreeConflict([...revision.document.files.map(file=>file.path),...assetOutputPaths(command.spec.operation)]))throw new LibraryImportRejection("A pasta escolhida conflita com arquivos do projeto. Escolha outra pasta; os originais serão preservados.");
            const caps=await this.client.gameProductionCapabilities();
            if(!caps.assetProcessors?.some(processor=>processor.id===command.spec.processorId&&processor.available&&processor.operations.includes("library.copy")))throw new LibraryImportRejection("A biblioteca selecionada não está disponível neste ambiente.");
            const selection=command.spec.operation.selection,page=await this.client.listGameLibraries({processorId:command.spec.processorId,libraryId:selection.library.id,entryId:selection.entry.id,limit:30});
            if(!page.entries.some(item=>contentHash(item)===contentHash(selection)))throw new LibraryImportRejection("O recurso difere do catálogo instalado. Consulte a biblioteca novamente, preservando arquivos, créditos e licença.");
          };
          await check();
          if(!await this.host.approve(`Preparar “${command.spec.operation.selection.entry.title}” como “${command.spec.target.role}” em “${project.title}”, revisão ${command.expectedRevision}? Os arquivos, dependências e licença serão copiados para um candidato; aplicar ao jogo será outra decisão.`))return {cancelled:true};
          await check();
        }catch(error){if(error instanceof LibraryImportRejection)return {libraryImportRejected:true,message:error.message};throw error;}
        const next=await this.client.processGameAsset(command.requestId,project.id,command.expectedRevision,command.spec);
        return {...await this.snapshot(),requestedAssetJobId:next.id};
      }
      if(command.action==="history")return {projectId:project.id,...await this.client.listGameRevisions(project.id,command.cursor,30,"desc")};
      if(command.action==="compare"){
        const info=await this.client.call<{capabilities:string[]}>("engine.info");
        if(!info.capabilities.includes("game-revision-comparison-v1"))throw new Error("Este motor precisa de atualização para comparar revisões no Studio.");
        const comparison=await this.client.compareGameRevisions(project.id,command.baseRevision,command.targetRevision,command.section,command.cursor,command.limit);
        if((await this.selected()).id!==project.id)throw new Error("O projeto selecionado mudou. Confira novamente as revisões originais.");
        return {projectId:project.id,comparison};
      }
      if(command.action==="jobs")return {projectId:project.id,...await this.client.listGameProduction(project.id,command.cursor,30,"desc")};
      if(command.action==="compare-file"){
        const info=await this.client.call<{capabilities:string[]}>("engine.info");
        if(!info.capabilities.includes("game-file-comparison-v1"))throw new Error("Este motor precisa de atualização para comparar o conteúdo de arquivos.");
        const fileComparison=await this.client.compareGameFile(project.id,command.baseRevision,command.targetRevision,command.path,command.context,command.cursor,command.limit,command.bindingHash);
        if((await this.selected()).id!==project.id)throw new Error("O projeto selecionado mudou. Confira novamente os arquivos originais.");
        return {projectId:project.id,fileComparison};
      }
      if(command.action==="advance-stage"||command.action==="continue-production"||command.action==="reopen-production"){
        this.write();const state=await this.client.getGameWorkflow(project.id);
        if(project.revision!==command.expectedRevision||state.revision!==command.expectedRevision||state.workflow?.version!==command.expectedVersion)throw new Error("A produção ou a revisão mudou. Atualize antes de continuar.");
        const prompt=command.action==="continue-production"?`Autorizar mais ${state.effectivePolicy.requestsPerBlock} pedidos de build, teste e mídia para esta etapa de “${project.title}”? O progresso atual será preservado.`:
          command.action==="reopen-production"?`Iniciar um novo ciclo de produção de “${project.title}”, preservando o ciclo anterior e a última versão aceita?`:`Avançar a etapa de produção de “${project.title}” com as evidências desta revisão?`;
        if(command.action!=="advance-stage"&&!await this.host.approve(prompt))return {cancelled:true};this.write();
        const method=command.action==="continue-production"?this.client.continueGameProduction:command.action==="reopen-production"?this.client.reopenGameProduction:this.client.advanceGameStage;
        await method.call(this.client,command.requestId,project.id,command.expectedVersion,command.expectedRevision);return this.snapshot();
      }
      if(command.action==="build"){
        this.write();if(project.revision!==command.expectedRevision)throw new Error("O projeto mudou. Atualize antes de gerar o build.");
        if(!await this.host.approve(`Gerar um build de “${project.title}”, revisão ${project.revision}? O código será processado pelo adaptador autorizado.`))return {cancelled:true};
        this.write();
        await this.client.startGameBuild(command.requestId,project.id,command.expectedRevision);return this.snapshot();
      }
      if(command.action==="design"||command.action==="resume-design"){
        let revision:GameRevision;
        try{
          if(command.action==="resume-design"){
            const engine=await this.client.call<{capabilities:string[]}>("engine.info");
            if(!engine.capabilities.includes("game-mutation-inspection-v1"))throw new DesignEditRejection("Este motor precisa de atualização para conferir o recibo do design. O pedido anterior foi preservado; nenhuma alteração foi repetida.");
            const receipt=await this.client.inspectGameMutation(project.id,command.requestId);
            if(receipt.state==="acknowledged"){
              const original=await this.client.getGameRevision(project.id,command.expectedRevision);
              const binding=contentHash({method:"commit",...gameRevisionCommit.parse({projectId:project.id,requestId:command.requestId,expectedRevision:command.expectedRevision,
                document:{...original.document,design:command.design},message:designCommitMessage})});
              if(receipt.bindingHash!==binding||receipt.revision!==command.expectedRevision+1)throw new DesignEditRejection("O recibo preservado pertence a outro conteúdo. Confira as revisões; não será enviado um pedido substituto.");
              const acknowledged=await this.client.getGameRevision(project.id,receipt.revision);
              if(acknowledged.contentHash!==receipt.contentHash)throw new DesignEditRejection("O recibo não corresponde à revisão preservada. O pedido anterior continua disponível para conferência; nenhuma alteração foi repetida.");
              return {...await this.snapshot(),recoveredDesignCommit:{revision:receipt.revision,contentHash:receipt.contentHash}};
            }
            // Missing is not a cancellation/absence proof. Only the same
            // immutable request may proceed through normal consent and server CAS.
          }
          const check=async()=>{if(!this.host.canWrite())throw new DesignEditRejection("Ative um modo de edição em um projeto confiável antes de salvar.");const current=await this.selected();
            if(current.id!==project.id||current.revision!==command.expectedRevision)throw new DesignEditRejection("O projeto ou a revisão mudou. Confira o design original antes de salvar.");};
          await check();revision=await this.client.getGameRevision(project.id,command.expectedRevision);
          if(!await this.host.approve(`Salvar as alterações no design de “${project.title}”?`))return {cancelled:true};
          await check();
        }catch(error){if(error instanceof DesignEditRejection)return {designEditRejected:true,message:error.message};throw error;}
        await this.client.commitGameRevision(project.id,command.requestId,command.expectedRevision,{...revision.document,design:command.design},designCommitMessage);return this.snapshot();
      }
      if(command.action==="restore"||command.action==="resume-restore"){
        let revision:GameRevision;
        const message=`Restore revision ${command.revision}`;
        try{
          if(command.action==="resume-restore"){
            const engine=await this.client.call<{capabilities:string[]}>("engine.info");
            if(!engine.capabilities.includes("game-mutation-inspection-v1"))throw new RestoreRejection("Este motor precisa de atualização para conferir a restauração. O pedido original foi preservado; nenhuma mudança foi repetida.");
            const receipt=await this.client.inspectGameMutation(project.id,command.requestId);
            if(receipt.state==="acknowledged"){
              const original=await this.client.getGameRevision(project.id,command.revision);
              const binding=contentHash({method:"commit",...gameRevisionCommit.parse({projectId:project.id,requestId:command.requestId,
                expectedRevision:command.expectedRevision,document:original.document,message})});
              if(receipt.bindingHash!==binding||receipt.revision!==command.expectedRevision+1)throw new RestoreRejection("O recibo pertence a outra restauração. O pedido original continua preservado; não será enviado um substituto.");
              const acknowledged=await this.client.getGameRevision(project.id,receipt.revision);
              if(acknowledged.contentHash!==receipt.contentHash)throw new RestoreRejection("O recibo da restauração não corresponde à revisão preservada. Confira o histórico antes de continuar.");
              return {...await this.snapshot(),recoveredRestoreCommit:{revision:receipt.revision,contentHash:receipt.contentHash}};
            }
            // A missing receipt cannot settle an earlier unknown effect. Only
            // this frozen request may pass normal consent and server CAS.
          }
          const check=async()=>{
            if(!this.host.canWrite())throw new RestoreRejection("Ative um modo de edição em um projeto confiável antes de restaurar.");
            const current=await this.selected();
            if(current.id!==project.id||current.revision!==command.expectedRevision)throw new RestoreRejection("O projeto ou a revisão mudou. Confira a restauração original antes de continuar.");
          };
          await check();revision=await this.client.getGameRevision(project.id,command.revision);
          if(!await this.host.approve(`Restaurar a revisão ${command.revision} de “${project.title}” como uma nova revisão? O histórico será preservado.`))return {cancelled:true};
          await check();
        }catch(error){if(error instanceof RestoreRejection)return {restoreRejected:true,message:error.message};throw error;}
        await this.client.commitGameRevision(project.id,command.requestId,command.expectedRevision,revision.document,message);return this.snapshot();
      }
      if(command.action==="export-source"){
        if(project.revision!==command.expectedRevision)throw new Error("Atualize o projeto antes de exportar.");
        const revision=command.revision??command.expectedRevision;
        await this.client.getGameRevision(project.id,revision);
        if((await this.selected()).id!==project.id)throw new Error("O projeto selecionado mudou. Confira a revisão antes de exportar.");
        return {exported:await this.host.exportSource(project.id,revision)};
      }
      if(command.action==="asset-result"||command.action==="asset-audio-analysis"||command.action==="asset-media"||command.action==="preview-model"||command.action==="apply-asset"||command.action==="export-asset"||command.action==="adjust-image"||command.action==="adjust-vector"||command.action==="adjust-audio"||command.action==="adjust-model"){
        const job=await this.job(command.jobId);
        if(job.kind!=="assets"||job.state!=="completed")throw new Error("Escolha um candidato de mídia concluído pelo serviço.");
        const result=await this.client.getGameAssetResult(job.id);
        if(result.projectId!==project.id||result.jobId!==job.id)throw new Error("O candidato não pertence a este projeto e trabalho.");
        if(command.action==="asset-audio-analysis"){
          const operation=result.spec.operation;
          if(result.processorId!=="local-media-v1"||operation.type!=="audio.render"||operation.waveformBins===undefined)throw new Error("Este candidato não contém uma análise de áudio reconhecida.");
          const file=result.files.find(file=>file.path===audioAnalysisPath(operation.output)&&file.mime==="application/json"&&file.size<=512*1024),wav=result.files.find(file=>file.path===operation.output&&file.mime==="audio/wav");
          if(!file||!wav)throw new Error("Os arquivos da análise não correspondem a este candidato.");
          const bytes=await this.client.downloadGameAssetFile(job.id,file.path);
          if(bytes.length!==file.size||createHash("sha256").update(bytes).digest("hex")!==file.sha256)throw new Error("Os bytes da análise divergem do arquivo preservado.");
          let analysis;try{analysis=gameAudioAnalysis.parse(JSON.parse(new TextDecoder("utf-8",{fatal:true}).decode(bytes)));}catch{throw new Error("A análise preservada tem formato inválido. Exporte os arquivos para inspecionar.");}
          if(analysis.audioSha256!==wav.sha256||analysis.requestedBins!==operation.waveformBins||analysis.sampleRate!==operation.sampleRate||analysis.channelCount!==operation.channels||analysis.frames!==Math.round(operation.durationMs*operation.sampleRate/1000)||wav.size!==44+analysis.frames*analysis.channelCount*2)throw new Error("A análise não corresponde ao WAV e receita deste candidato.");
          if((await this.selected()).id!==project.id)throw new Error("O projeto selecionado mudou. Confira o candidato original.");
          return {projectId:project.id,jobId:job.id,path:file.path,sha256:file.sha256,analysis};
        }
        if(command.action==="preview-model"){
          const model=result.files.find(file=>file.path===command.path&&file.mime==="model/gltf-binary"&&file.path.endsWith(".glb")&&file.size<=64*1024*1024);
          if(!model)throw new Error("Escolha um modelo GLB preservado neste candidato com até 64 MiB.");
          if(!this.host.previewModel)throw new Error("Este cliente precisa de atualização para inspecionar modelos 3D.");
          if(!await this.host.approve(`Inspecionar “${result.asset.role}”, candidato da revisão ${result.revision}, em um visor isolado? Isso não aplica o recurso ao jogo.`))return {cancelled:true};
          if((await this.selected()).id!==project.id)throw new Error("O projeto selecionado mudou. Confira o candidato novamente.");
          await this.host.previewModel(result,model.path,name=>this.client.downloadGameAssetFile(job.id,name));
          return {modelPreviewOpened:true,projectId:project.id,jobId:job.id,path:model.path};
        }
        if(command.action==="adjust-image"||command.action==="adjust-vector"||command.action==="adjust-audio"||command.action==="adjust-model"){
          try{
            const writable=()=>{if(!this.host.canWrite())throw new ImageAdjustmentRejection("Ative um modo de edição em um projeto confiável antes de processar.");};writable();
            const original=result.spec.operation;
            if(command.action==="adjust-model"){
              if(result.processorId!=="blender-model-isolated-v1"||original.type!=="model.scene")throw new ImageAdjustmentRejection("Os ajustes 3D exigem um candidato do Blender isolado.");
              const sources=modelSources(original);
              if(command.operation.outputBase!==original.outputBase||modelSources(command.operation).some(source=>!sources.some(allowed=>allowed.assetId===source.assetId&&allowed.path===source.path)))
                throw new ImageAdjustmentRejection("Os ajustes 3D devem preservar a pasta de saída e usar somente os modelos e texturas registrados neste candidato.");
            }else if(result.processorId!=="local-media-v1")throw new ImageAdjustmentRejection("Os ajustes exigem um candidato do processador de mídia local.");
            if(command.action==="adjust-vector"){
              if(original.type!=="image.vector")throw new ImageAdjustmentRejection("Os ajustes vetoriais exigem um candidato de ilustração vetorial local.");
              if(command.operation.output.slice(0,-4)!==original.output.slice(0,-4))throw new ImageAdjustmentRejection("Os ajustes devem preservar o nome e a pasta deste candidato vetorial; apenas SVG/PNG podem mudar.");
            }else if(command.action==="adjust-audio"){
              if(original.type!=="audio.render")throw new ImageAdjustmentRejection("Os ajustes de áudio exigem um candidato WAV do processador local.");
              if(command.operation.output!==original.output||command.operation.clips.some(clip=>!original.clips.some(source=>source.source.assetId===clip.source.assetId&&source.source.path===clip.source.path)))
                throw new ImageAdjustmentRejection("Os ajustes de áudio devem preservar o arquivo de saída e usar somente as fontes registradas neste candidato.");
            }else if(command.action==="adjust-image"){
              if(original.type!=="image.compose")throw new ImageAdjustmentRejection("Os ajustes visuais exigem um candidato de composição de imagem local.");
              if(command.operation.output!==original.output||command.operation.layers.length!==original.layers.length||command.operation.layers.some((layer,index)=>layer.source.assetId!==original.layers[index]!.source.assetId||layer.source.path!==original.layers[index]!.source.path))
                throw new ImageAdjustmentRejection("Os ajustes devem preservar as fontes, a ordem das camadas e o arquivo de saída deste candidato.");
            }
            const check=async()=>{
              if(command.action==="adjust-audio"&&command.operation.waveformBins!==undefined&&!await this.audioAnalysisSupport())throw new ImageAdjustmentRejection("Este motor precisa de atualização para gerar a forma de onda. O ajuste original foi preservado.");
              if(command.action==="adjust-image"&&command.operation.pngEncoding!==undefined&&!await this.pngSupport())throw new ImageAdjustmentRejection("Este motor precisa de atualização para escolher a codificação PNG. O ajuste original foi preservado.");
              const selected=await this.selected();if(selected.id!==project.id||selected.revision!==command.expectedRevision)throw new ImageAdjustmentRejection("O projeto ou a revisão mudou. Confira o candidato antes de processar.");
              const revision=await this.client.getGameRevision(project.id,command.expectedRevision);
              if(result.sourceAssets.some(source=>assetFingerprint(revision.document,source.id)!==source.hash))throw new ImageAdjustmentRejection("Uma fonte do candidato mudou. Revise suas versões antes de processar outra variante.");
            };
            await check();
            if(!await this.host.approve(`Processar uma nova variante de “${result.asset.role}” em “${project.title}”, revisão ${command.expectedRevision}? O candidato anterior será preservado e o jogo só mudará após aplicação.`))return {cancelled:true};
            writable();await check();
          }catch(error){
            // This invocation has not dispatched processing. It does not settle
            // an earlier call with the same request ID whose result was lost.
            if(error instanceof ImageAdjustmentRejection)return {imageAdjustmentRejected:true,message:error.message};
            throw error;
          }
          const next=await this.client.processGameAsset(command.requestId,project.id,command.expectedRevision,{...result.spec,operation:command.operation});
          return {...await this.snapshot(),requestedAssetJobId:next.id};
        }
        if(command.action==="export-asset")return {exported:await this.host.exportAsset(job.id)};
        if(command.action==="asset-result")return {projectId:project.id,expectedRevision:project.revision,result};
        if(command.action==="asset-media"){
          const file=result.files.find(file=>file.path===command.path),operation=result.spec.operation;
          if(file?.mime==="text/plain"&&operation.type==="library.copy"&&operation.selection.library.licenseFiles.some(name=>`${operation.outputBase}/${name}`===file.path)){
            if(file.size>256*1024)throw new Error("Exporte o candidato para ler este documento de licença integral.");
            const bytes=await this.client.downloadGameAssetFile(job.id,file.path);
            return {projectId:project.id,jobId:job.id,path:file.path,mime:file.mime,text:new TextDecoder("utf-8",{fatal:true}).decode(bytes)};
          }
          if(!file||!(["image/png","image/jpeg","image/webp","audio/wav","audio/mp4"].includes(file.mime)||isVectorPreview(result,file))||file.size>4*1024*1024)
            throw new Error("O preview aceita imagens/WAV/AAC e SVG vetorial reconhecido deste candidato com até 4 MiB.");
          return {projectId:project.id,jobId:job.id,path:file.path,mime:file.mime,
            data:(await this.client.downloadGameAssetFile(job.id,file.path)).toString("base64")};
        }
        this.write();if(project.revision!==command.expectedRevision)throw new Error("O projeto mudou. Confira o candidato novamente antes de aplicar.");
        if(!await this.host.approve(`Aplicar “${result.asset.role}” ao projeto “${project.title}”, revisão ${command.expectedRevision}, preservando o histórico?`))return {cancelled:true};
        this.write();if((await this.selected()).id!==project.id)throw new Error("O projeto selecionado mudou. Confira o candidato novamente.");
        await this.client.applyGameAsset(command.requestId,job.id,command.expectedRevision);return this.snapshot();
      }
      if(command.action==="revision-media"){
        const revision=await this.client.getGameRevision(project.id,command.revision);
        const file=revision.document.files.find(file=>file.path===command.path),asset=file&&revision.document.assets.find(asset=>asset.files.includes(file.path));
        if(!file||!asset||file.sha256!==command.sha256)throw new Error("O arquivo não corresponde ao asset e hash desta revisão. Consulte novamente a comparação original.");
        if(!["image/png","image/jpeg","image/webp","audio/wav","audio/mp4"].includes(file.mime)||file.size>4*1024*1024)throw new Error("A comparação aceita imagens PNG/JPEG/WebP, WAV e AAC/MP4 registrados com até 4 MiB por versão. Exporte outros formatos para inspecioná-los.");
        const data=await this.client.downloadGameFile(project.id,file.path,revision.revision);
        if(data.length!==file.size||createHash("sha256").update(data).digest("hex")!==file.sha256)throw new Error("Os bytes não correspondem ao arquivo preservado. A prévia não foi aberta.");
        if((await this.selected()).id!==project.id)throw new Error("O projeto selecionado mudou. Confira novamente a comparação original.");
        return {projectId:project.id,revision:revision.revision,contentHash:revision.contentHash,path:file.path,mime:file.mime,size:file.size,sha256:file.sha256,data:data.toString("base64")};
      }
      if(command.action==="media"){
        const revision=await this.client.getGameRevision(project.id),file=revision.document.files.find((file)=>file.path===command.path),asset=file&&revision.document.assets.find(asset=>asset.files.includes(file.path));
        if(!file||!asset)throw new Error("O arquivo não pertence a um asset desta revisão.");
        if(file.mime==="image/svg+xml"){
          if(!asset.processing)throw new Error("Exporte o SVG para inspecioná-lo. A prévia aceita somente o resultado vetorial reconhecido do serviço.");
          const result=await this.client.getGameAssetResult(asset.processing.jobId);
          if(result.projectId!==project.id||result.asset.id!==asset.id||!isVectorPreview(result,file))throw new Error("O SVG desta revisão diverge do candidato vetorial reconhecido. Preserve-o e revise sua origem.");
        }else if(!["image/png","image/jpeg","image/webp","audio/wav","audio/mp4"].includes(file.mime))throw new Error("Exporte este formato para inspecioná-lo.");
        if(file.size>4*1024*1024)throw new Error("Exporte este arquivo para inspecioná-lo. O preview aceita até 4 MiB.");
        const data=await this.client.downloadGameFile(project.id,file.path,revision.revision);return {projectId:project.id,path:file.path,mime:file.mime,data:data.toString("base64"),revision:revision.revision};
      }
      if(command.action==="validate"){
        this.write();const job=await this.job(command.buildId);if(job.kind!=="build"||job.state!=="completed")throw new Error("Escolha um build concluído.");
        if(!await this.host.approve(`Executar a verificação ${command.collectorId} no build da revisão ${job.revision}?`))return {cancelled:true};
        this.write();
        await this.client.startGameValidation(command.requestId,job.id,command.collectorId);return this.snapshot();
      }
      if(command.action!=="preview"&&command.action!=="export-build"&&command.action!=="capture"&&command.action!=="cancel"&&command.action!=="reconcile")throw new Error("Operação indisponível.");
      const job=await this.job(command.action==="preview"||command.action==="export-build"||command.action==="capture"?command.buildId:command.jobId);
      if(command.action==="cancel"){this.write();await this.client.cancelGameProduction(job.id);return this.snapshot();}
      if(command.action==="reconcile"){this.write();await this.client.reconcileGameProduction(job.id);return this.snapshot();}
      if(job.kind!=="build"||job.state!=="completed")throw new Error("O build ainda não foi confirmado pelo serviço.");
      if(command.action==="capture"){
        const report=(await this.client.getGameReports(job.id)).find((report)=>report.id===command.reportId),file=report?.evidence?.find((file)=>file.path===command.path);
        if(!file||file.mime!=="image/png"||file.size>4*1024*1024)throw new Error("Captura indisponível neste relatório.");
        return {mime:file.mime,data:(await this.client.downloadGameReportFile(command.reportId,command.path)).toString("base64"),revision:job.revision};
      }
      const artifact=await this.client.getGameArtifact(job.id);
      if(command.action==="export-build")return {exported:await this.host.exportBuild(artifact)};
      if(command.action==="preview"){
        if(!await this.host.approve(`Jogar o build de “${project.title}”, revisão ${artifact.revision}, em um preview isolado? Os saves desta janela são temporários.`))return {cancelled:true};
        await this.host.preview(artifact,(name)=>this.client.downloadGameArtifactFile(job.id,name));return {opened:true,revision:artifact.revision};
      }
      throw new Error("Operação indisponível.");
    }finally{this.busy=false;}
  }
}
export type GameStudioSnapshot=Awaited<ReturnType<GameStudioController["snapshot"]>>;
