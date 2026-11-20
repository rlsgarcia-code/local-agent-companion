import { chromium,type Browser } from "playwright-core";
import type { GameArtifact } from "../../contracts/src/game-production";
import { qualifyBrowser } from "./browser";
import { serveArtifactResources,type PinnedBrowserResources } from "./resources";
import { openGameArtifactPage } from "./isolation";

/** Explicit host preview of immutable build bytes. No Agent API listener, personal
 * browser profile, device permissions, model endpoint, external navigation or bridge. */
export async function openGamePreview(options:{artifact:GameArtifact;readFile(name:string):Promise<Uint8Array>;signal:AbortSignal;headless?:boolean}){
  return {...await openPinnedResourcePreview(options),revision:options.artifact.revision};
}

/** Shared isolation/lifetime only; this function grants no production identity. */
export async function openPinnedResourcePreview(options:{artifact:PinnedBrowserResources;readFile(name:string):Promise<Uint8Array>;signal:AbortSignal;headless?:boolean}){
  const qualified=await qualifyBrowser();if(!qualified)throw new Error("Instale Chrome ou Edge compatível para jogar neste preview. Nenhum navegador será baixado automaticamente.");
  options.signal.throwIfAborted();
  const resources=await serveArtifactResources(options);let browser:Browser|undefined,closing:Promise<void>|undefined;
  const errors:string[]=[],blocked:string[]=[];
  const close=()=>closing??=(async()=>{try{await browser?.close();}finally{await resources.close();options.signal.removeEventListener("abort",stop);}})();
  const stop=()=>{void close().catch(()=>{});};
  try{
    browser=await chromium.launch({executablePath:qualified.executablePath,headless:options.headless??false,chromiumSandbox:true,timeout:10000,args:["--force-webrtc-ip-handling-policy=disable_non_proxied_udp","--webrtc-ip-handling-policy=disable_non_proxied_udp"]});
    options.signal.addEventListener("abort",stop,{once:true});
    if(!qualified.version.includes(browser.version()))throw new Error("O navegador mudou durante a abertura do preview. Tente novamente.");
    options.signal.throwIfAborted();
    const opened=await openGameArtifactPage(browser,options,{width:960,height:540},errors,blocked,options.signal,resources);
    opened.page.on("close",stop);browser.on("disconnected",stop);
    options.signal.throwIfAborted();
    return {close,page:opened.page,errors,blocked};
  }catch(error){await close();throw error;}
}
