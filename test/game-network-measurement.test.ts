import assert from "node:assert/strict";
import test from "node:test";
import { createHash, randomBytes } from "node:crypto";
import { createServer } from "node:http";
import { once } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { chromium, type Page, type Browser } from "playwright-core";
import { qualifyBrowser } from "../packages/adapter-game-browser/src/browser";
import { openGameArtifactPage } from "../packages/adapter-game-browser/src/isolation";
import { serveArtifactResources, type PinnedBrowserResources } from "../packages/adapter-game-browser/src/resources";
import { prepareColdNetworkMeasurement } from "../packages/adapter-game-browser/src/loading";

test("request-profile calibration precedes navigation, retains isolation and redacts capabilities/query data", async t => {
  const qualified = await qualifyBrowser();if (!qualified) { t.skip("Qualified Chromium unavailable");return; }
  const root = await mkdtemp(path.join(tmpdir(), "network-measurement-"));let browser: Browser | undefined;
  const data = new Map([ ["index.html", Buffer.from('<!doctype html><title>Owned calibration</title><link rel="icon" href="data:,">')], ["payload.bin", randomBytes(4 * 1024 * 1024)] ]);
  const artifact: PinnedBrowserResources = { engine: "phaser", entrypoint: "index.html", files: [...data].map(([path, bytes]) => ({ path,
    sha256: createHash("sha256").update(bytes).digest("hex"), size: bytes.length, mime: path.endsWith("html") ? "text/html" : "application/octet-stream" })) };
  let reads=0;
  const signal = AbortSignal.timeout(30000), access = { artifact, readFile: async (name: string) => { reads++;return data.get(name)!; } }, resources = await serveArtifactResources({ ...access, signal });
  let hits = 0;const canary = createServer((_request, response) => { hits++;response.end("No request may arrive"); });canary.listen(0,"127.0.0.1");await once(canary,"listening");
  const address = canary.address();assert.ok(address && typeof address === "object");
  let recorder: Awaited<ReturnType<typeof prepareColdNetworkMeasurement>> | undefined;
  try {
    browser = await chromium.launch({ executablePath: qualified.executablePath, headless: true, chromiumSandbox: true,
      env: { ...Object.fromEntries(["PATH","SystemRoot","WINDIR","TMP","TEMP"].filter(k => process.env[k] !== undefined).map(k => [k,process.env[k]])), HOME: root } });
    const errors: string[] = [], blocked: string[] = [];
    const opened = await openGameArtifactPage(browser, access, {width:640,height:360}, errors, blocked, signal, resources, async page => {
      assert.equal(page.url(), "about:blank");
      assert.equal(await page.evaluate(async url => { try { await fetch(url);return true; } catch { return false; } }, `http://127.0.0.1:${address.port}/canary`), false);
      assert.equal(hits, 0, "Resource guards must already exist before instrumentation");
      recorder = await prepareColdNetworkMeasurement(page, resources.origin, artifact.files);
    });
    const session = await opened.context.newCDPSession(opened.page), frame = await session.send("Page.getFrameTree");
    const world = await session.send("Page.createIsolatedWorld", { frameId:frame.frameTree.frame.id, worldName:"owned-calibration" });
    const result = await session.send("Runtime.evaluate", { contextId:world.executionContextId, awaitPromise:true, returnByValue:true,
      expression:"fetch('/payload.bin?opaque=private-query-canary').then(r=>r.arrayBuffer()).then(b=>b.byteLength)" });
    assert.equal(result.result.value,4*1024*1024);
    for(let i=0;i<100&&!recorder!.snapshot().requests.some(r=>r.file==="payload.bin"&&r.finished!==undefined&&r.appliedRuleId);i++)await new Promise(resolve=>setTimeout(resolve,20));
    const trace=recorder!.snapshot(), payload=trace.requests.find(r=>r.file==="payload.bin")!;
    assert.equal(payload.status,200);assert.equal(payload.failed,undefined);assert.equal(payload.fromDiskCache,false);assert.equal(payload.fromServiceWorker,false);
    assert.equal(payload.appliedRuleId,trace.ruleId);assert.ok(payload.encodedBytes!>=4*1024*1024);assert.ok(payload.durationMs!>=1500,"4MiB must not transfer instantly under20Mb/s");
    const serialized=JSON.stringify(trace);assert.ok(!serialized.includes(resources.cookie.value));assert.ok(!serialized.includes("private-query-canary"));assert.ok(!serialized.includes("Cookie"));
    await recorder!.close();await opened.context.close();
    const beforeReads=reads;
    await assert.rejects(openGameArtifactPage(browser,access,{width:640,height:360},[],[],signal,resources,async()=>{throw Error("Unsupported diagnostic");}),/Unsupported diagnostic/);
    assert.equal(reads,beforeReads);assert.equal(browser.contexts().length,0,"Failed instrumentation closes its context before any navigation");
  } finally {
    await recorder?.close();await browser?.close();await resources.close();canary.closeAllConnections();await new Promise<void>(resolve=>canary.close(()=>resolve()));await rm(root,{recursive:true,force:true});
  }
});

test("an unavailable protocol refuses the diagnostic without a deprecated or navigator-state fallback",async()=>{
  const sent:string[]=[];let detached=false;
  const session={on(){},async send(name:string){sent.push(name);if(name==="Network.emulateNetworkConditionsByRule")throw Error("Protocol method unavailable");},async detach(){detached=true;}};
  const page={context:()=>({newCDPSession:async()=>session})} as unknown as Page;
  await assert.rejects(prepareColdNetworkMeasurement(page,"http://127.0.0.1",[]),/Protocol method unavailable/);
  assert.equal(detached,true);assert.ok(!sent.includes("Network.emulateNetworkConditions"));assert.ok(!sent.includes("Network.overrideNetworkState"));
});
