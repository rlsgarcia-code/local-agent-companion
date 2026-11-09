import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtemp, readFile, readdir, stat, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import * as path from "node:path";
import test from "node:test";
import { AgentService } from "../packages/agent-service/src/service";
import { Store } from "../packages/agent-service/src/store";
import { AgentClient } from "../packages/client-ts/src/index";
import { LocalServer } from "../packages/agent-service/src/server";
import { createClientCredential, ensureIdentity, ipcPath } from "../packages/agent-service/src/security";
import { modelAssistance, type ProviderSpec, type Registration } from "../packages/contracts/src/index";

const reg:Registration={id:"assistance",product:"companion-vscode",profile:"test",workspace:"/fixture",providers:["ollama"],hostTools:[]};
async function fixture() {
  const requests:{url:string;body:any}[]=[];
  const http=createServer((request,response)=>{let raw="";request.on("data",part=>raw+=part);request.on("end",()=>{
    const body=JSON.parse(raw);requests.push({url:request.url!,body});
    if(request.url==="/v1/embeddings") {
      response.writeHead(200,{"content-type":"application/json"});
      response.end(JSON.stringify({data:[{index:0,embedding:[0.1,0.2,0.3]}],model:"fixture",usage:{prompt_tokens:1,total_tokens:1}}));return;
    }
    const reflected = body.messages?.some((row:any)=>typeof row.content === "string" && row.content.includes("echo-fixture-credential"));
    const content=reflected ? String(request.headers.authorization).replace(/^Bearer /,"") : body.messages?.[0]?.content?.includes("catalog author") ? '{"mcpServers":{}}' : "ASSISTANCE_OK";
    const send = () => {
    if(body.stream) {
      response.writeHead(200,{"content-type":"text/event-stream"});
      for(const delta of [{role:"assistant",content},{}]) response.write("data: "+JSON.stringify({id:"probe",object:"chat.completion.chunk",model:"fixture",choices:[{index:0,delta,finish_reason:delta.role?null:"stop"}]})+"\n\n");
      response.end("data: [DONE]\n\n");
    } else {
      response.writeHead(200,{"content-type":"application/json"});
      response.end(JSON.stringify({id:"assist",object:"chat.completion",model:"fixture",choices:[{index:0,message:{role:"assistant",content},finish_reason:"stop"}]}));
    }
    };
    if (body.messages?.some((row:any)=>row.content === "WAIT_FIXTURE")) setTimeout(send,500);
    else send();
  });});
  await new Promise<void>(resolve=>http.listen(0,"127.0.0.1",resolve));
  const address=http.address() as {port:number};
  const provider:ProviderSpec={kind:"ollama",endpoint:`http://127.0.0.1:${address.port}/v1`,roles:{executor:"fixture"},authHeader:"authorization"};
  const directory=await mkdtemp(path.join(tmpdir(),"engine-assist-"));
  const store=new Store(path.join(directory,"metadata.sqlite"));
  const credential=await createClientCredential(directory,reg);store.register(credential);
  const service=new AgentService(store,directory);
  const identity=await ensureIdentity(directory),server=new LocalServer(service,directory);
  await server.listen();
  const client=new AgentClient({address:ipcPath(directory),certificate:identity.cert,credential});await client.connect();
  return {requests,provider,service,client,store,directory,async close(){client.close();await server.close();await new Promise<void>(resolve=>http.close(()=>resolve()));await rm(directory,{recursive:true,force:true});}};
}

test("model helpers use the service and exact inference routes without executing probe tools",async()=>{
  const f=await fixture();
  try {
    assert.equal((await f.client.assistModel({purpose:"advisor",provider:f.provider,prompt:"Return JSON"})).text,"ASSISTANCE_OK");
    const image=await f.client.upload("catalog-image",Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aP9sAAAAASUVORK5CYII=","base64"),"image/png");
    assert.equal((await f.client.assistModel({purpose:"catalog",provider:f.provider,instructions:"Documented MCP",images:[image.id]})).text,'{"mcpServers":{}}');
    await f.client.assistModel({purpose:"connection",provider:f.provider});
    const embedding=await f.client.assistModel({purpose:"embedding",provider:f.provider,model:"embedding-fixture"});
    assert.equal(embedding.dimensions,3);
    assert.deepEqual(f.requests.map(r=>r.url),["/v1/chat/completions","/v1/chat/completions","/v1/chat/completions","/v1/embeddings"]);
    assert.equal(f.requests[2]!.body.stream,true);
    assert.equal(f.requests[2]!.body.tools[0].function.name,"connection_probe");
    assert.match(f.requests[1]!.body.messages[1].content[1].image_url.url,/^data:image\/png;base64,/);
    assert.equal((f.store.db.prepare("SELECT count(*) AS n FROM receipts").get() as {n:number}).n,0);
  } finally {await f.close();}
});

test("assistance cannot forge a product, switch provider, borrow images, bypass KidOS or reuse a credential",async()=>{
  const f=await fixture();
  try {
    await assert.rejects(f.client.assistModel({purpose:"connection",provider:{...f.provider,kind:"openai",endpoint:"https://api.openai.com/v1"}}),/does not permit/);
    await assert.rejects(f.service.dispatch({...reg,product:"kidos"},"models.assist",{purpose:"connection",provider:f.provider},"host"),/protected adapter/);
    assert.equal(modelAssistance.safeParse({purpose:"advisor",provider:f.provider,prompt:"test",tools:["shell"]}).success,false);
    const image=await f.client.upload("private-image",Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aP9sAAAAASUVORK5CYII=","base64"),"image/png");
    await assert.rejects(f.service.dispatch({...reg,profile:"another"},"models.assist",{purpose:"catalog",provider:f.provider,instructions:"test",images:[image.id]},"host"),/not found/);
    const provider={...f.provider,credentialRef:"temporary"};
    await assert.rejects(f.client.assistModel({purpose:"advisor",provider,prompt:"test"}),/credential host/);
    await f.client.call("credentials.lease",{reference:"temporary",value:"fixture-ephemeral-assistance-secret"});
    assert.equal((await f.client.assistModel({purpose:"advisor",provider,prompt:"echo-fixture-credential"})).text,"[credential redacted]");
    await assert.rejects(f.client.assistModel({purpose:"advisor",provider,prompt:"test"}),/credential host/);
    assert.equal(f.requests.length,1);
    for (const entry of await readdir(f.directory,{recursive:true})) {
      const file=path.join(f.directory,entry);
      if((await stat(file)).isFile()) assert.equal((await readFile(file)).includes(Buffer.from("fixture-ephemeral-assistance-secret")),false,entry);
    }
  } finally {await f.close();}
});


test("an update waits for model assistance and service shutdown cancels its network request",async()=>{
  const f=await fixture();
  try {
    const pending=f.client.assistModel({purpose:"advisor",provider:f.provider,prompt:"WAIT_FIXTURE"});
    const rejected=assert.rejects(pending,/abort|stopping|closed|cancel/i);
    while (!f.requests.length) await new Promise(resolve=>setImmediate(resolve));
    const update=await f.client.call<{accepted:boolean}>("engine.quiesceIfIdle");
    assert.equal(update.accepted,false);
    await f.service.close();
    await rejected;
  } finally {await f.close();}
});
