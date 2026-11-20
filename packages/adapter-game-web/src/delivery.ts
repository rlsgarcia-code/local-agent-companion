import type { GameDocument } from "../../contracts/src/games";
import { GameProductionFailure } from "../../game-production/src/index";

export const webDeliveryPath = "engine/COMPANION-DELIVERY.json";
export const isWebResource = (name:string) =>
  (name.startsWith("assets/") || name.startsWith("data/")) && !/\.blend[0-9]*$/i.test(name);

/** No file probing, tree shaking of dynamic URLs or format substitution. Keep
 * declared metadata/notices of selected assets and their full provenance chain.
 * These are preserved declarations, never independent license verification. */
export function selectWebDelivery(document:GameDocument, requested:readonly string[], sourceHash:string) {
  const resources=document.files.filter(file=>isWebResource(file.path));
  const available=new Map(resources.map(file=>[file.path,file]));
  for(const name of requested)if(!available.has(name))throw new GameProductionFailure(
    `Delivery resource is absent from the exact project revision: ${name}`);
  const requestedSet=new Set(requested), selected=new Set(requested), relevant=new Set<string>();
  const assets=new Map(document.assets.map(asset=>[asset.id,asset]));
  const pending=document.assets.filter(asset=>asset.files.some(file=>selected.has(file))).map(asset=>asset.id);
  for(let index=0;index<pending.length;index++){
    const id=pending[index]!;if(relevant.has(id))continue;
    const asset=assets.get(id);if(!asset)throw new GameProductionFailure("The delivery provenance chain is incomplete.");
    relevant.add(id);pending.push(...asset.origin.referenceIds);
    for(const name of asset.files){
      const file=available.get(name);
      if(file && (file.mime.startsWith("text/") || file.mime==="application/json"))selected.add(name);
    }
  }
  // Project-order output is stable even if the explicit list is rearranged.
  const files=resources.filter(file=>selected.has(file.path));
  const record=({path,size,sha256}:{path:string;size:number;sha256:string})=>({path,size,sha256});
  const report={schemaVersion:1,sourceHash,policy:"explicit-with-provenance-metadata-v1",
    requested:[...requested],included:files.map(file=>({...record(file),reason:requestedSet.has(file.path)?"requested":"asset-metadata"})),
    omitted:resources.filter(file=>!selected.has(file.path)).map(record),
    assets:document.assets.filter(asset=>relevant.has(asset.id)).map(asset=>({id:asset.id,kind:asset.kind,
      placeholder:asset.placeholder,origin:asset.origin,files:asset.files.filter(name=>selected.has(name))})),
    licenseStatus:"declared-unverified"};
  const bytes=Buffer.from(JSON.stringify(report,null,2)+"\n");
  if(bytes.length>16*1024*1024)throw new GameProductionFailure("The explicit delivery inventory exceeds its 16 MiB budget.");
  return {files,report:{path:webDeliveryPath,mime:"application/json",data:bytes}};
}
