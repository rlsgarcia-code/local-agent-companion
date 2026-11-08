import * as esbuild from 'esbuild';
import {mkdtemp,cp,writeFile,rm,readFile,lstat} from 'node:fs/promises';
import {spawn} from 'node:child_process';
import {createRequire} from 'node:module';
import {createServer} from 'node:http';
import {tmpdir} from 'node:os';
import * as path from 'node:path';
import {runTests} from '@vscode/test-electron';
import {createHash} from 'node:crypto';
const argument=name=>process.argv.find(value=>value.startsWith(name+'='))?.slice(name.length+1);
const project=process.cwd(),root=await mkdtemp(path.join(tmpdir(),'companion-editor-service-')),workspace=path.join(root,'workspace'),bundle=path.resolve(argument('--bundle-dir')||'engine-dist'),state=path.join(root,'engine-state');
await cp(path.join(project,'test/fixtures/extension-host-workspace'),workspace,{recursive:true});
const requests=[];
const server=createServer((request,response)=>{let raw='';request.on('data',part=>raw+=part);request.on('end',()=>{
 const body=JSON.parse(raw);requests.push({url:request.url,body});
 const system=body.messages.filter(message=>message.role==='system').map(message=>message.content).join('\n');
 let content,toolCalls;
 if(body.response_format?.json_schema?.name==='task_contract'||system.includes("Interpret the user's intended outcome"))content=JSON.stringify({outcome:'answer',objective:'Read approved fixture',requiredEvidence:'none',acceptanceCriteria:['Read the actual file']});
 else if(!body.tools?.length)content=JSON.stringify({verdict:'satisfied',reason:'The actual fixture was read'});
 else if(!body.messages.some(message=>message.role==='tool')){
  const tool=body.tools.find(tool=>tool.function.name==='read_file');if(!tool)throw Error('Actual editor tool missing');
  const deep=Object.hasOwn(tool.function.parameters.properties,'file_path');toolCalls=[{id:'fixture-read',type:'function',function:{name:'read_file',arguments:JSON.stringify(deep?{file_path:'/workspace/README.md'}:{path:'README.md'})}}];
 }else content='Shared engine fixture verified.';
 const send=()=>{
  if(!body.stream){response.writeHead(200,{'content-type':'application/json'});response.end(JSON.stringify({id:`fixture-${requests.length}`,object:'chat.completion',model:'fixture',choices:[{index:0,message:{role:'assistant',content:content??null,...(toolCalls?{tool_calls:toolCalls}:{})},finish_reason:toolCalls?'tool_calls':'stop'}],usage:{prompt_tokens:1,completion_tokens:1,total_tokens:2}}));return;}
  response.writeHead(200,{'content-type':'text/event-stream'});
  response.write('data: '+JSON.stringify({id:`fixture-${requests.length}`,object:'chat.completion.chunk',model:'fixture',choices:[{index:0,delta:{role:'assistant',...(content?{content}:{}),...(toolCalls?{tool_calls:toolCalls.map((tool,index)=>({...tool,index}))}:{})},finish_reason:null}]})+'\n\n');
  response.end('data: '+JSON.stringify({id:`fixture-${requests.length}`,object:'chat.completion.chunk',model:'fixture',choices:[{index:0,delta:{},finish_reason:toolCalls?'tool_calls':'stop'}]})+'\n\ndata: [DONE]\n\n');
 };
 if(content==='Shared engine fixture verified.'&&JSON.stringify(body.messages).includes('DETACH_FIXTURE'))setTimeout(send,1700);else send();
 });});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
await esbuild.build({entryPoints:['test/extension-service/index.ts'],outfile:path.join(root,'test.cjs'),bundle:true,platform:'node',format:'cjs',external:['vscode','playwright-core'],define:{__LOCAL_COMPANION_PROVIDER_VARIANT__:JSON.stringify('ollama')}});
const compiledVerifier=await esbuild.build({entryPoints:['packages/client-ts/src/bootstrap.ts'],bundle:true,platform:'node',format:'cjs',write:false});
const verifier={exports:{}};new Function('module','exports','require',compiledVerifier.outputFiles[0].text)(verifier,verifier.exports,createRequire(import.meta.url));
const manifestBytes=await readFile(path.join(bundle,'manifest.json'));
const manifest=JSON.parse(manifestBytes.toString()),signed=manifest.development!==true;
await verifier.exports.verifyBundle(bundle,signed?await readFile('release-keys/companion-ed25519.pub','utf8'):undefined,!signed);
const engine=spawn(path.join(bundle,process.platform==='win32'?'node.exe':'node'),[path.join(bundle,'service.cjs'),state],{stdio:['ignore','pipe','pipe']});let errors='';engine.stderr.on('data',chunk=>errors+=chunk);engine.stdout.resume();
try{
 for(let i=0;i<100;i++){try{await readFile(path.join(state,'runtime.json'));break;}catch{await new Promise(resolve=>setTimeout(resolve,50));}}
 await runTests({vscodeExecutablePath:process.env.VSCODE_EXECUTABLE_PATH,version:'1.106.0',extensionDevelopmentPath:project,extensionTestsPath:path.join(root,'test.cjs'),extensionTestsEnv:{COMPANION_FIXTURE_ROOT:root,COMPANION_FIXTURE_SIGNED:signed?"1":"0",COMPANION_FIXTURE_STATE:state,COMPANION_FIXTURE_BUNDLE:bundle,COMPANION_FIXTURE_PROVIDER:`http://127.0.0.1:${server.address().port}/v1`},launchArgs:[workspace,'--disable-extensions',`--user-data-dir=${path.join(root,'user')}`,`--extensions-dir=${path.join(root,'extensions')}`]});
 if(requests.some(request=>request.url!=='/v1/chat/completions'))throw Error('Unexpected inference route');
 if(!requests.length)throw Error('The editor fixture made no inference requests.');
 const report=argument('--report');
 if(report)await writeFile(path.resolve(report),JSON.stringify({engine:manifest.version,commit:manifest.commit,target:manifest.target,manifestSha256:createHash('sha256').update(manifestBytes).digest('hex'),signed,inference:'simulated-loopback-only',requests:requests.length,scenarios:['standard','deep','actual-editor-read','detach-and-recover'],kidOSRequired:false},null,2)+'\n');
 console.log('EDITOR_SERVICE_ROUTING_OK',requests.length);
}catch(error){await writeFile(path.join(tmpdir(),'editor-service-fixture-requests.json'),JSON.stringify(requests,null,2));await cp(state,path.join(tmpdir(),'editor-service-fixture-state'),{recursive:true,force:true,filter:async file=>!(await lstat(file)).isSocket()});console.error(errors);throw error;}
finally{engine.kill('SIGTERM');await new Promise(resolve=>server.close(resolve));await rm(root,{recursive:true,force:true,maxRetries:3,retryDelay:200});}
