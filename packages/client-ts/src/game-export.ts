import { randomUUID,createHash } from "node:crypto";
import { mkdir,writeFile,rename,rm,realpath } from "node:fs/promises";
import * as path from "node:path";
import type { AgentClient } from "./index";
import { gameFilePath,gameFileTreeConflict,type GameFile } from "../../contracts/src/games";
import type { GameArtifact } from "../../contracts/src/game-production";
import { gameAssetResult } from "../../contracts/src/game-assets";
import type { GamePlaytestExport } from "../../contracts/src/game-playtests";

/** Quote data and neutralize spreadsheet formulas, including leading whitespace. */
export function playtestRecordsCsv(data: GamePlaytestExport): string {
  const cell=(value:unknown)=>{let text=value==null?"":String(value);if(/^[=+@-]/.test(text.trimStart())||/^[\t\r\n]/.test(text))text=`'${text}`;return `"${text.replaceAll('"','""')}"`;};
  const rows:unknown[][]=[["participant_code","withdrawn","recorded_at","withdrawn_at","understood_without_help","action_seconds","experience_score","platform","device","browser","input","notes"]];
  for(const value of data.responses)rows.push(value.withdrawn?[value.participantId,true,value.recordedAt,value.withdrawnAt]:
    [value.participantId,false,value.recordedAt,"",value.understoodWithoutHelp,value.actionSeconds,value.experienceScore,value.environment.platform,value.environment.device,value.environment.browser,value.environment.input.join(";"),value.notes]);
  return rows.map(row=>Array.from({length:12},(_,index)=>cell(row[index])).join(",")).join("\r\n")+"\r\n";
}

/** The native host chooses the destination. A renderer never supplies a host path.
 * Everything is downloaded into a new private sibling and activated by rename. */
export async function exportGameDirectory(options:{client:AgentClient;parent:string;source?:{projectId:string;revision:number};artifact?:GameArtifact;candidate?:{jobId:string};playtest?:{studyId:string;includeResponses:boolean}}){
  if([options.source,options.artifact,options.candidate,options.playtest].filter(Boolean).length!==1)throw new Error("Escolha fonte, build, candidato ou playtest para exportar.");
  const parent=await realpath(options.parent),id=randomUUID(),stage=path.join(parent,`.companion-export-${id}`),target=path.join(parent,`game-${id}`);
  await mkdir(stage,{mode:0o700});let bytes=0;
  async function save(name:string,data:Buffer){
    const [prefix,...rest]=name.split("/");gameFilePath.parse(["source","build","candidate"].includes(prefix!)&&rest.length?rest.join("/"):name);
    bytes+=data.length;if(bytes>1536*1024*1024)throw new Error("A exportação excedeu 1,5 GiB. Nenhum projeto existente foi alterado.");
    const output=path.join(stage,...name.split("/"));await mkdir(path.dirname(output),{recursive:true,mode:0o700});await writeFile(output,data,{flag:"wx",mode:0o600});
  }
  async function file(name:string,metadata:GameFile,read:()=>Promise<Buffer>){const data=await read();if(data.length!==metadata.size||createHash("sha256").update(data).digest("hex")!==metadata.sha256)throw new Error("O arquivo exportado não corresponde ao hash da revisão.");await save(name,data);}
  try{
    if(options.playtest){
      const result=await options.client.exportGamePlaytest(options.playtest.studyId,options.playtest.includeResponses);
      if(result.study.id!==options.playtest.studyId||result.includeResponses!==options.playtest.includeResponses)throw new Error("O estudo exportado não corresponde à seleção confirmada.");
      await save("playtest.json",Buffer.from(JSON.stringify(result,null,2)));
      if(result.includeResponses)await save("observations.csv",Buffer.from(playtestRecordsCsv(result)));
    }else if(options.candidate){
      // Resolve the immutable acknowledged result through the authenticated SDK;
      // never accept a renderer-supplied manifest or apply the candidate here.
      const result=gameAssetResult.parse(await options.client.getGameAssetResult(options.candidate.jobId));
      if(result.jobId!==options.candidate.jobId)throw new Error("O resultado não pertence ao trabalho escolhido.");
      for(const entry of result.files)await file(`candidate/${entry.path}`,entry,()=>options.client.downloadGameAssetFile(result.jobId,entry.path));
      await save("candidate.json",Buffer.from(JSON.stringify(result,null,2)));
    }else if(options.artifact){
      const artifact=options.artifact,conflict=gameFileTreeConflict(artifact.files.map((file)=>file.path));if(conflict)throw new Error(conflict.message);
      for(const entry of artifact.files)await file(`build/${entry.path}`,entry,()=>options.client.downloadGameArtifactFile(artifact.jobId,entry.path));
      await save("artifact.json",Buffer.from(JSON.stringify(artifact,null,2)));
    }else{
      const source=options.source!,archive=await options.client.exportGameProject(source.projectId);
      if(archive.revisions.at(-1)?.revision!==source.revision)throw new Error("O projeto mudou. Atualize antes de exportar.");
      const revision=archive.revisions.find((row)=>row.revision===source.revision);if(!revision)throw new Error("A revisão selecionada não está no histórico.");
      await save("project.json",Buffer.from(JSON.stringify(revision.document,null,2)));await save("history.json",Buffer.from(JSON.stringify(archive,null,2)));
      const workflow=await options.client.getGameWorkflow(source.projectId),events=[];
      if(workflow.revision!==source.revision||workflow.sourceHash!==revision.contentHash)throw new Error("O projeto mudou durante a exportação da produção. Atualize antes de exportar.");
      for(let cursor=0;;){const page=await options.client.readGameWorkflowEvents(source.projectId,cursor,100,workflow.eventCursor);events.push(...page.events);if(!page.hasMore)break;cursor=page.cursor;}
      await save("production.json",Buffer.from(JSON.stringify({schemaVersion:1,purpose:"Historical production domain and audit; not imported authority, budget grants or quality acceptance",snapshot:workflow,events},null,2)));
      const saved=new Set<string>();
      for(const row of archive.revisions)for(const entry of row.document.files)if(!saved.has(entry.sha256)){
        await file(`blobs/${entry.sha256}`,entry,()=>options.client.downloadGameFile(source.projectId,entry.path,row.revision));saved.add(entry.sha256);
      }
      for(const entry of revision.document.files)await file(`source/${entry.path}`,entry,()=>options.client.downloadGameFile(source.projectId,entry.path,source.revision));
    }
    await save("README.txt",Buffer.from("Companion Game Studio\n\nsource/: fonte editável da revisão selecionada.\nbuild/: build web autocontido; use um servidor HTTP local para jogar.\ncandidate/: arquivos de um candidato de mídia, incluindo formatos sem preview.\ncandidate.json: receita, fontes, origem/licença declaradas, toolchain e hashes do candidato; exportar não o aplica ao projeto.\nproject.json: design, assets e declarações de origem/licença.\nhistory.json e blobs/: histórico de domínio e arquivos por SHA-256.\nproduction.json: etapas e auditoria históricas; não concede orçamento, autoridade ou aceite ao importar.\nartifact.json: revisão e toolchain do build.\nplaytest.json: resumo e, apenas quando solicitado, observações declaradas pelo operador para um build exato. Não prova pessoas distintas, consentimento independente ou qualidade.\nobservations.csv: registros individuais solicitados explicitamente; códigos, notas e ambiente podem ser sensíveis. Células com aparência de fórmula recebem apóstrofo para leitura como texto.\n\nOs diretórios/metadados presentes dependem da exportação escolhida.\nEsta exportação não certifica qualidade, licenças ou playtest.\n"));
    await rename(stage,target);return target;
  }catch(error){await rm(stage,{recursive:true,force:true});throw error;}
}
